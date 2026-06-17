"""Audio preparation helpers for transcription."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import importlib.util
import re
import shutil
import subprocess
import sys
import time

ProgressCallback = Callable[[str], None]

_DURATION_RE = re.compile(r"Duration: (?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}(?:\.\d+)?)")
_TIME_RE = re.compile(r"time=(?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}(?:\.\d+)?)")


def _timestamp_to_seconds(hours: str, minutes: str, seconds: str) -> float:
    return (int(hours) * 3600) + (int(minutes) * 60) + float(seconds)


def parse_ffmpeg_duration(line: str) -> float | None:
    """Extract the source duration from one ffmpeg stderr line."""

    match = _DURATION_RE.search(line)
    if not match:
        return None
    return _timestamp_to_seconds(match["h"], match["m"], match["s"])


def parse_ffmpeg_progress_time(line: str) -> float | None:
    """Extract the latest processed timestamp from one ffmpeg stderr line."""

    match = _TIME_RE.search(line)
    if not match:
        return None
    return _timestamp_to_seconds(match["h"], match["m"], match["s"])


def _resolve_ffmpeg_executable() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    if importlib.util.find_spec("imageio_ffmpeg") is None:
        requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
        raise RuntimeError(
            "ffmpeg was not found. Run transcriber\\run_gui_windows.bat to install bundled ffmpeg support, "
            f"or install manually with: {sys.executable} -m pip install -r {requirements_path}"
        )
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def prepare_audio_for_transcription(
    *,
    input_path: Path,
    work_dir: Path,
    progress: ProgressCallback | None = None,
) -> Path:
    """Convert any supported media file to mono 16 kHz WAV before Whisper decoding.

    PyAV can usually decode media directly, but long MP4/M4A files can sit for a
    long time before faster-whisper yields the first segment. Doing this explicit
    ffmpeg step gives visible progress and produces a simple WAV for transcription.
    """

    ffmpeg = _resolve_ffmpeg_executable()
    output_path = work_dir / f"{input_path.stem}.mh-transcriber.16k.wav"
    command = [
        ffmpeg,
        "-hide_banner",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(output_path),
    ]

    if progress:
        progress("Preparing audio with ffmpeg before transcription...")
        progress("This avoids silent stalls while reading long MP4/M4A files.")

    started_at = time.monotonic()
    duration: float | None = None
    last_reported_second = -10.0
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    stderr_tail: list[str] = []
    assert process.stderr is not None
    for raw_line in process.stderr:
        line = raw_line.strip()
        if line:
            stderr_tail.append(line)
            stderr_tail = stderr_tail[-8:]
        parsed_duration = parse_ffmpeg_duration(line)
        if parsed_duration:
            duration = parsed_duration
            if progress:
                progress(f"Audio/video duration detected: {duration / 60:0.1f} minutes.")
        progress_time = parse_ffmpeg_progress_time(line)
        if progress_time is not None and progress_time - last_reported_second >= 10:
            last_reported_second = progress_time
            if progress:
                if duration:
                    percent = min(100.0, (progress_time / duration) * 100)
                    progress(f"Prepared audio {progress_time:0.1f}s/{duration:0.1f}s ({percent:0.1f}%).")
                else:
                    progress(f"Prepared audio through {progress_time:0.1f}s.")

    return_code = process.wait()
    if return_code != 0 or not output_path.exists() or output_path.stat().st_size == 0:
        tail = "\n".join(stderr_tail) if stderr_tail else "No ffmpeg stderr output captured."
        raise RuntimeError(f"ffmpeg audio preparation failed with exit code {return_code}. Last output:\n{tail}")

    if progress:
        elapsed = time.monotonic() - started_at
        progress(f"Audio prepared in {elapsed:0.1f}s. Starting Whisper decoding from WAV...")
    return output_path
