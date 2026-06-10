"""faster-whisper based local transcription engine."""

from __future__ import annotations

from collections.abc import Callable
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import sys
import threading
import time
from typing import Literal

from .audio import prepare_audio_for_transcription
from .chunking import (
    chunk_result_path,
    plan_chunks,
    read_chunk_result,
    resume_signature,
    slice_wav,
    wav_duration_seconds,
    write_chunk_result,
)
from .diagnostics import log_cuda_diagnostics
from .formatters import write_outputs

ComputeType = Literal["auto", "float16", "int8_float16", "int8", "float32"]
Device = Literal["auto", "cuda", "cpu"]
ProgressCallback = Callable[[str], None]

DEFAULT_MODEL = "large-v3-turbo"
RECOMMENDED_MODELS = [
    "large-v3-turbo",
    "large-v3",
    "medium",
    "small",
    "base",
]

# Chunk windows shorter than this are pointless and only add boundary cuts, so
# chunking stays off for ordinary short lectures and only kicks in for long ones.
MIN_CHUNK_LENGTH_S = 60.0

_VAD_PARAMETERS = {"min_silence_duration_ms": 500}


def _resolve_compute_type(device: Device, compute_type: ComputeType) -> str:
    if compute_type != "auto":
        return compute_type
    if device == "cpu":
        return "int8"
    return "float16"



def _load_whisper_model_with_heartbeat(
    *,
    model_cls: object,
    model_name: str,
    device: str,
    compute_type: str,
    progress: ProgressCallback | None,
) -> object:
    """Load a Whisper model while emitting periodic progress messages.

    The faster-whisper constructor can block for a long time during first-run
    Hugging Face downloads or CTranslate2 initialization, so this keeps the GUI
    log alive and gives the user actionable next steps instead of appearing stuck.
    """

    stop = threading.Event()
    started_at = time.monotonic()

    def heartbeat() -> None:
        while not stop.wait(30):
            elapsed_minutes = (time.monotonic() - started_at) / 60
            if progress:
                progress(
                    f"Still loading model {model_name} ({elapsed_minutes:0.1f} min elapsed). "
                    "First run may be downloading; if this passes 10-15 min, try model=base/small once."
                )

    thread: threading.Thread | None = None
    if progress:
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
    try:
        return model_cls(model_name, device=device, compute_type=compute_type)
    finally:
        stop.set()
        if thread:
            thread.join(timeout=0.2)
        if progress:
            elapsed = time.monotonic() - started_at
            progress(f"Model load step finished after {elapsed:0.1f}s.")

def _decode_window(
    *,
    model: object,
    wav_path: Path,
    language: str,
    beam_size: int,
    offset: float = 0.0,
    duration_total: float | None = None,
    progress: ProgressCallback | None = None,
) -> list[dict]:
    """Decode one WAV and return segment dicts with absolute timestamps.

    ``offset`` is added to each segment time so that chunk windows sliced from a
    longer recording report their true position in the source.
    """

    segments_iter, _info = model.transcribe(  # type: ignore[attr-defined]
        str(wav_path),
        language=language or None,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters=_VAD_PARAMETERS,
    )

    decoded: list[dict] = []
    for segment in segments_iter:
        start = float(segment.start) + offset
        end = float(segment.end) + offset
        text = segment.text.strip()
        decoded.append({"start": start, "end": end, "text": text})
        if progress:
            percent = ""
            if duration_total:
                percent = f" ({min(100.0, (end / duration_total) * 100):0.1f}%)"
            progress(f"Decoded {start:0.1f}s–{end:0.1f}s{percent}: {text[:80]}")
    return decoded


def _transcribe_chunked(
    *,
    model: object,
    prepared_wav: Path,
    output_dir: Path,
    input_path: Path,
    model_name: str,
    language: str,
    beam_size: int,
    chunk_length_s: float,
    total_duration: float,
    resume: bool,
    tmp_dir: Path,
    progress: ProgressCallback | None,
) -> list[dict]:
    """Transcribe a long recording window-by-window, resuming if possible."""

    chunks = plan_chunks(total_duration, chunk_length_s)
    resume_dir = output_dir / f".mh_resume_{input_path.stem}"
    manifest_path = resume_dir / "manifest.json"
    signature = resume_signature(
        source=input_path,
        model_name=model_name,
        chunk_length_s=chunk_length_s,
        total_duration=total_duration,
    )

    # Only reuse a resume directory whose settings match this run; otherwise the
    # partial results on disk belong to a different file/model/chunk size.
    reuse = False
    if resume and manifest_path.exists():
        try:
            reuse = json.loads(manifest_path.read_text(encoding="utf-8")) == signature
        except (ValueError, OSError):
            reuse = False
    if resume_dir.exists() and not reuse:
        shutil.rmtree(resume_dir, ignore_errors=True)
    resume_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")

    if progress:
        progress(
            f"Long recording: splitting into {len(chunks)} chunks of up to "
            f"{chunk_length_s / 60:0.0f} min each. Resume is enabled, so an interrupted "
            "run will continue from the last finished chunk."
        )

    all_segments: list[dict] = []
    for chunk in chunks:
        result_path = chunk_result_path(resume_dir, chunk.index)
        human_index = chunk.index + 1
        if resume and result_path.exists():
            if progress:
                progress(
                    f"Chunk {human_index}/{len(chunks)} ({chunk.start / 60:0.1f}–"
                    f"{chunk.end / 60:0.1f} min) already done — loaded from checkpoint."
                )
            all_segments.extend(read_chunk_result(result_path))
            continue

        if progress:
            progress(
                f"Transcribing chunk {human_index}/{len(chunks)} "
                f"({chunk.start / 60:0.1f}–{chunk.end / 60:0.1f} min)..."
            )
        chunk_wav = tmp_dir / f"chunk_{chunk.index:04d}.wav"
        slice_wav(wav_path=prepared_wav, start=chunk.start, end=chunk.end, out_path=chunk_wav)
        try:
            decoded = _decode_window(
                model=model,
                wav_path=chunk_wav,
                language=language,
                beam_size=beam_size,
                offset=chunk.start,
                duration_total=total_duration,
                progress=progress,
            )
        finally:
            chunk_wav.unlink(missing_ok=True)
        write_chunk_result(result_path, segments=decoded)
        all_segments.extend(decoded)

    # Whole recording transcribed successfully — drop the checkpoint directory.
    shutil.rmtree(resume_dir, ignore_errors=True)
    return all_segments


def transcribe_file(
    *,
    input_path: Path,
    output_dir: Path | None = None,
    model_name: str = DEFAULT_MODEL,
    language: str = "he",
    device: Device = "auto",
    compute_type: ComputeType = "auto",
    beam_size: int = 5,
    progress: ProgressCallback | None = None,
    preprocess_audio: bool = True,
    chunk_length_s: int | float | None = None,
    resume: bool = True,
) -> dict[str, Path]:
    """Transcribe one media file and export txt/srt/vtt/json files.

    By default, media is first converted to a mono 16 kHz WAV with ffmpeg. This
    makes long MP4/M4A inputs more predictable and provides progress before the
    first Whisper segment is decoded.

    When ``chunk_length_s`` is set and the recording is longer than it, the audio
    is transcribed window-by-window and each finished window is checkpointed to a
    resume directory next to the output. If the run is cancelled or crashes, a
    later run with the same file/model/chunk size continues from the last finished
    window instead of starting over. Chunking requires ``preprocess_audio`` since
    it slices the prepared WAV; it is skipped (with a note) otherwise.
    """

    input_path = Path(input_path).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_dir = Path(output_dir or input_path.parent / "transcripts").expanduser().resolve()
    resolved_compute = _resolve_compute_type(device, compute_type)

    with tempfile.TemporaryDirectory(prefix="mh-transcriber-") as tmp:
        tmp_dir = Path(tmp)
        transcription_input = input_path
        prepared_wav: Path | None = None
        if preprocess_audio:
            prepared_wav = prepare_audio_for_transcription(
                input_path=input_path,
                work_dir=tmp_dir,
                progress=progress,
            )
            transcription_input = prepared_wav
        elif progress:
            progress("Audio preprocessing is disabled; passing media directly to faster-whisper.")

        if progress:
            progress(f"Loading model {model_name} on {device} ({resolved_compute})...")
            progress("First run can take several minutes because the model may be downloading and initializing.")
        if device in {"cuda", "auto"}:
            log_cuda_diagnostics(progress)

        if importlib.util.find_spec("faster_whisper") is None:
            requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
            raise RuntimeError(
                "Missing dependency faster-whisper. "
                "On Windows, run transcriber\\run_gui_windows.bat so it can install dependencies automatically. "
                f"Manual install for this Python: {sys.executable} -m pip install -r {requirements_path}"
            )

        from faster_whisper import WhisperModel

        model = _load_whisper_model_with_heartbeat(
            model_cls=WhisperModel,
            model_name=model_name,
            device=device,
            compute_type=resolved_compute,
            progress=progress,
        )

        if device in {"cuda", "auto"}:
            log_cuda_diagnostics(progress)

        if progress:
            progress("Model loaded. Starting transcription...")
            progress(f"Transcribing {input_path.name}...")

        # The prepared WAV gives an exact duration up front, used both for
        # progress percentages and to decide whether chunking is worthwhile.
        duration: float | None = wav_duration_seconds(prepared_wav) if prepared_wav else None

        # Decide whether to use the chunk+resume path. It needs the prepared WAV
        # (to slice) and only helps for recordings longer than one chunk.
        use_chunking = (
            chunk_length_s is not None
            and float(chunk_length_s) >= MIN_CHUNK_LENGTH_S
        )
        if use_chunking and prepared_wav is None:
            if progress:
                progress("Chunked resume needs audio preprocessing; falling back to a single pass.")
            use_chunking = False
        if use_chunking and duration is not None and duration <= float(chunk_length_s):
            use_chunking = False  # Short enough to do in one pass.

        if use_chunking:
            segments = _transcribe_chunked(
                model=model,
                prepared_wav=prepared_wav,
                output_dir=output_dir,
                input_path=input_path,
                model_name=model_name,
                language=language,
                beam_size=beam_size,
                chunk_length_s=float(chunk_length_s),
                total_duration=duration,
                resume=resume,
                tmp_dir=tmp_dir,
                progress=progress,
            )
        else:
            if progress and duration:
                progress(f"Audio duration: {duration / 60:0.1f} minutes. Progress appears as segments are decoded.")
            segments = _decode_window(
                model=model,
                wav_path=Path(transcription_input),
                language=language,
                beam_size=beam_size,
                duration_total=duration,
                progress=progress,
            )

    if progress:
        progress("Writing transcript files...")

    paths = write_outputs(
        audio_path=input_path,
        output_dir=output_dir,
        model_name=model_name,
        language=language or "unknown",
        duration=duration,
        segments=segments,
    )

    if progress:
        progress(f"Done. Wrote files to {output_dir}")
    return paths
