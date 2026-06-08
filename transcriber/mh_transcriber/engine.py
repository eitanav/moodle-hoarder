"""faster-whisper based local transcription engine."""

from __future__ import annotations

from collections.abc import Callable
import importlib.util
from pathlib import Path
import tempfile
import sys
from typing import Literal

from .audio import prepare_audio_for_transcription
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


def _resolve_compute_type(device: Device, compute_type: ComputeType) -> str:
    if compute_type != "auto":
        return compute_type
    if device == "cpu":
        return "int8"
    return "float16"


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
) -> dict[str, Path]:
    """Transcribe one media file and export txt/srt/vtt/json files.

    By default, media is first converted to a mono 16 kHz WAV with ffmpeg. This
    makes long MP4/M4A inputs more predictable and provides progress before the
    first Whisper segment is decoded.
    """

    input_path = Path(input_path).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_dir = Path(output_dir or input_path.parent / "transcripts").expanduser().resolve()
    resolved_compute = _resolve_compute_type(device, compute_type)

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

    model = WhisperModel(model_name, device=device, compute_type=resolved_compute)

    if device in {"cuda", "auto"}:
        log_cuda_diagnostics(progress)

    if progress:
        progress("Model loaded. Preparing audio and starting transcription...")

    with tempfile.TemporaryDirectory(prefix="mh-transcriber-") as tmp:
        transcription_input = input_path
        if preprocess_audio:
            transcription_input = prepare_audio_for_transcription(
                input_path=input_path,
                work_dir=Path(tmp),
                progress=progress,
            )
        elif progress:
            progress("Audio preprocessing is disabled; passing media directly to faster-whisper.")

        if progress:
            progress(f"Transcribing {input_path.name}...")

        segments_iter, info = model.transcribe(
            str(transcription_input),
            language=language or None,
            beam_size=beam_size,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )

        duration = getattr(info, "duration", None)
        if progress and duration:
            progress(f"Audio duration: {duration / 60:0.1f} minutes. Progress appears as segments are decoded.")

        # Materialize the generator so we can write all output formats.
        segments = []
        for segment in segments_iter:
            segments.append(segment)
            if progress:
                percent = f" ({min(100.0, (segment.end / duration) * 100):0.1f}%)" if duration else ""
                progress(f"Decoded {segment.start:0.1f}s–{segment.end:0.1f}s{percent}: {segment.text.strip()[:80]}")

    if progress:
        progress("Writing transcript files...")

    paths = write_outputs(
        audio_path=input_path,
        output_dir=output_dir,
        model_name=model_name,
        language=language or getattr(info, "language", "unknown"),
        duration=duration,
        segments=segments,
    )

    if progress:
        progress(f"Done. Wrote files to {output_dir}")
    return paths
