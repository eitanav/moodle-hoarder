"""Chunking and resume support for long-recording transcription.

Lectures that run for hours can fail or get cancelled mid-way, and re-running
from scratch wastes a lot of GPU time. This module splits the prepared WAV into
fixed-length windows so that:

- progress is reported per chunk, and
- an interrupted run can resume from the last completed chunk instead of
  re-transcribing everything.

The audio is sliced straight from the prepared 16 kHz mono WAV with the stdlib
``wave`` module, so no extra ffmpeg pass is needed. Per-chunk results are stored
as small JSON files in a resume directory next to the transcripts; the directory
is deleted once the full transcript is written successfully.

These helpers are deliberately free of any faster-whisper dependency so they can
be unit tested without loading a speech model.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import wave

# Bumping this invalidates resume directories written by older versions so a
# stale on-disk format can never be loaded into a newer run.
RESUME_FORMAT_VERSION = 1


@dataclass(frozen=True)
class ChunkPlan:
    """One transcription window, with absolute timestamps in the source."""

    index: int
    start: float
    end: float


def plan_chunks(total_duration: float, chunk_length_s: float) -> list[ChunkPlan]:
    """Split a duration into consecutive, non-overlapping windows.

    The final window is shorter when the duration does not divide evenly. A
    duration at or below ``chunk_length_s`` yields a single window covering the
    whole recording.
    """

    if chunk_length_s <= 0:
        raise ValueError("chunk_length_s must be positive")
    if total_duration <= 0:
        return []

    chunks: list[ChunkPlan] = []
    index = 0
    start = 0.0
    # Guard against floating point dust producing a tiny trailing chunk.
    while start < total_duration - 1e-6:
        end = min(start + chunk_length_s, total_duration)
        chunks.append(ChunkPlan(index=index, start=start, end=end))
        index += 1
        start = end
    return chunks


def wav_duration_seconds(wav_path: Path) -> float:
    """Return the exact duration of a PCM WAV file in seconds."""

    with wave.open(str(wav_path), "rb") as src:
        framerate = src.getframerate()
        if framerate <= 0:
            return 0.0
        return src.getnframes() / float(framerate)


def slice_wav(*, wav_path: Path, start: float, end: float, out_path: Path) -> Path:
    """Write the ``[start, end)`` window of a PCM WAV to ``out_path``.

    Timestamps are clamped to the file bounds, so a window that runs slightly
    past the end of the recording simply yields whatever frames remain.
    """

    with wave.open(str(wav_path), "rb") as src:
        params = src.getparams()
        framerate = src.getframerate()
        total_frames = src.getnframes()
        start_frame = min(max(0, int(round(start * framerate))), total_frames)
        end_frame = min(max(start_frame, int(round(end * framerate))), total_frames)
        src.setpos(start_frame)
        frames = src.readframes(end_frame - start_frame)

    out_path = Path(out_path)
    with wave.open(str(out_path), "wb") as dst:
        dst.setnchannels(params.nchannels)
        dst.setsampwidth(params.sampwidth)
        dst.setframerate(params.framerate)
        dst.writeframes(frames)
    return out_path


def resume_signature(
    *,
    source: Path,
    model_name: str,
    chunk_length_s: float,
    total_duration: float,
) -> dict[str, object]:
    """Describe a run so an existing resume directory can be matched to it."""

    return {
        "format": RESUME_FORMAT_VERSION,
        "source": str(source),
        "model": model_name,
        "chunk_length_s": round(float(chunk_length_s), 3),
        "duration": round(float(total_duration), 3),
    }


def chunk_result_path(resume_dir: Path, index: int) -> Path:
    return Path(resume_dir) / f"chunk_{index:04d}.json"


def write_chunk_result(path: Path, *, segments: list[dict]) -> None:
    """Persist one chunk's segments (absolute timestamps) atomically."""

    path = Path(path)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps({"segments": segments}, ensure_ascii=False),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def read_chunk_result(path: Path) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    segments = data.get("segments", [])
    return [
        {
            "start": float(seg.get("start", 0.0)),
            "end": float(seg.get("end", 0.0)),
            "text": str(seg.get("text", "")),
        }
        for seg in segments
    ]
