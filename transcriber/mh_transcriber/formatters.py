"""Transcript export format helpers.

The transcription engine returns segment-like objects. These helpers keep the
output logic independent from faster-whisper so it can be tested without
loading a speech model.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class TranscriptSegment:
    """A normalized transcript segment with absolute timestamps."""

    start: float
    end: float
    text: str
    speaker: str | None = None


def normalize_segments(raw_segments: Iterable[object]) -> list[TranscriptSegment]:
    """Convert faster-whisper segments or dicts into TranscriptSegment objects."""

    normalized: list[TranscriptSegment] = []
    for segment in raw_segments:
        if isinstance(segment, TranscriptSegment):
            normalized.append(segment)
            continue
        if isinstance(segment, dict):
            normalized.append(
                TranscriptSegment(
                    start=float(segment.get("start", 0.0)),
                    end=float(segment.get("end", 0.0)),
                    text=str(segment.get("text", "")).strip(),
                    speaker=segment.get("speaker"),
                )
            )
            continue
        normalized.append(
            TranscriptSegment(
                start=float(getattr(segment, "start", 0.0)),
                end=float(getattr(segment, "end", 0.0)),
                text=str(getattr(segment, "text", "")).strip(),
                speaker=getattr(segment, "speaker", None),
            )
        )
    return normalized


def format_timestamp(seconds: float, *, vtt: bool = False) -> str:
    """Format seconds as an SRT/VTT timestamp."""

    seconds = max(0.0, float(seconds))
    millis = int(round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    separator = "." if vtt else ","
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{millis:03}"


def format_plain_text(segments: Sequence[TranscriptSegment]) -> str:
    """Create readable text with timestamps for humans and LLMs."""

    lines: list[str] = []
    for segment in segments:
        speaker = f" {segment.speaker}" if segment.speaker else ""
        lines.append(f"[{format_timestamp(segment.start, vtt=True)} → {format_timestamp(segment.end, vtt=True)}{speaker}] {segment.text}")
    return "\n".join(lines).strip() + ("\n" if lines else "")


def format_srt(segments: Sequence[TranscriptSegment]) -> str:
    """Create SubRip subtitles."""

    blocks: list[str] = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            f"{index}\n"
            f"{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}\n"
            f"{segment.text}"
        )
    return "\n\n".join(blocks).strip() + ("\n" if blocks else "")


def format_vtt(segments: Sequence[TranscriptSegment]) -> str:
    """Create WebVTT subtitles."""

    blocks = ["WEBVTT", ""]
    for segment in segments:
        blocks.append(
            f"{format_timestamp(segment.start, vtt=True)} --> {format_timestamp(segment.end, vtt=True)}\n"
            f"{segment.text}"
        )
        blocks.append("")
    return "\n".join(blocks).rstrip() + "\n"


SUPPORTED_FORMATS = ("txt", "srt", "vtt", "json")


def write_outputs(
    *,
    audio_path: Path,
    output_dir: Path,
    model_name: str,
    language: str,
    segments: Iterable[object],
    duration: float | None = None,
    formats: Iterable[str] | None = None,
) -> dict[str, Path]:
    """Write the requested transcript files and return their paths.

    ``formats`` selects which outputs to write (any subset of
    ``SUPPORTED_FORMATS``). When omitted, all four formats are written so older
    callers keep their previous behaviour.
    """

    selected = _normalize_formats(formats)

    output_dir.mkdir(parents=True, exist_ok=True)
    normalized = normalize_segments(segments)
    stem = audio_path.stem
    base = output_dir / stem

    writers = {
        "txt": lambda: base.with_suffix(".txt").write_text(
            format_plain_text(normalized), encoding="utf-8"
        ),
        "srt": lambda: base.with_suffix(".srt").write_text(
            format_srt(normalized), encoding="utf-8"
        ),
        "vtt": lambda: base.with_suffix(".vtt").write_text(
            format_vtt(normalized), encoding="utf-8"
        ),
        "json": lambda: base.with_suffix(".json").write_text(
            json.dumps(
                {
                    "schema": "moodle-hoarder-transcript-v1",
                    "source": str(audio_path),
                    "model": model_name,
                    "language": language,
                    "duration": duration,
                    "segments": [asdict(segment) for segment in normalized],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        ),
    }

    paths: dict[str, Path] = {}
    for fmt in SUPPORTED_FORMATS:
        if fmt not in selected:
            continue
        writers[fmt]()
        paths[fmt] = base.with_suffix(f".{fmt}")
    return paths


def _normalize_formats(formats: Iterable[str] | None) -> set[str]:
    """Validate requested formats, defaulting to all supported formats."""

    if formats is None:
        return set(SUPPORTED_FORMATS)
    selected = {str(fmt).lower().lstrip(".") for fmt in formats}
    selected &= set(SUPPORTED_FORMATS)
    return selected or set(SUPPORTED_FORMATS)
