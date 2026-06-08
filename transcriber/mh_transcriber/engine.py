"""faster-whisper based local transcription engine."""

from __future__ import annotations

from collections.abc import Callable
import importlib.util
from pathlib import Path
import sys
from typing import Literal

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
) -> dict[str, Path]:
    """Transcribe one media file and export txt/srt/vtt/json files.

    faster-whisper uses PyAV internally, so common video containers such as MP4
    can be passed directly without a separate ffmpeg executable in most setups.
    """

    input_path = Path(input_path).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_dir = Path(output_dir or input_path.parent / "transcripts").expanduser().resolve()
    resolved_compute = _resolve_compute_type(device, compute_type)

    if progress:
        progress(f"Loading model {model_name} on {device} ({resolved_compute})...")

    if importlib.util.find_spec("faster_whisper") is None:
        requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
        raise RuntimeError(
            "Missing dependency faster-whisper. "
            "On Windows, run transcriber\\run_gui_windows.bat so it can install dependencies automatically. "
            f"Manual install for this Python: {sys.executable} -m pip install -r {requirements_path}"
        )

    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=resolved_compute)

    if progress:
        progress(f"Transcribing {input_path.name}...")

    segments_iter, info = model.transcribe(
        str(input_path),
        language=language or None,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    # Materialize the generator so we can write all output formats.
    segments = []
    for segment in segments_iter:
        segments.append(segment)
        if progress:
            progress(f"{segment.start:0.1f}s–{segment.end:0.1f}s {segment.text.strip()[:80]}")

    if progress:
        progress("Writing transcript files...")

    paths = write_outputs(
        audio_path=input_path,
        output_dir=output_dir,
        model_name=model_name,
        language=language or getattr(info, "language", "unknown"),
        duration=getattr(info, "duration", None),
        segments=segments,
    )

    if progress:
        progress(f"Done. Wrote files to {output_dir}")
    return paths
