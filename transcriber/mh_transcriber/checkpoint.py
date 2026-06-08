"""Crash-safe transcription checkpoints for resuming long recordings.

Transcribing dozens of hours can fail half-way through (power loss, a closed
window, a CUDA hiccup). To avoid throwing away an hour of GPU work, the engine
appends every decoded segment to a small JSONL checkpoint next to the output.
If the same file is transcribed again, we detect the checkpoint, keep the
segments already decoded, and resume from the last segment's end time.

The checkpoint is deleted once the final transcript files are written, so a
leftover ``*.transcribe-progress.jsonl`` simply means a previous run did not
finish.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .formatters import TranscriptSegment

CHECKPOINT_SCHEMA = "moodle-hoarder-transcript-progress-v1"


def checkpoint_path_for(output_dir: Path, stem: str) -> Path:
    """Return the checkpoint path used for a given output dir and file stem."""

    return output_dir / f"{stem}.transcribe-progress.jsonl"


def _source_signature(source: Path) -> dict[str, int | None]:
    """A cheap fingerprint so a re-downloaded/edited source restarts fresh."""

    try:
        stat = source.stat()
    except OSError:
        return {"size": None, "mtime": None}
    return {"size": stat.st_size, "mtime": int(stat.st_mtime)}


def build_header(
    *,
    source: Path,
    model_name: str,
    language: str,
    duration: float | None = None,
) -> dict[str, object]:
    """Build the first JSONL line that identifies a checkpoint."""

    return {
        "schema": CHECKPOINT_SCHEMA,
        "source": str(source),
        "source_signature": _source_signature(source),
        "model": model_name,
        "language": language,
        "duration": duration,
    }


class CheckpointWriter:
    """Append decoded segments to a JSONL checkpoint, flushing after each one."""

    def __init__(self, path: Path, header: dict[str, object]) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("a", encoding="utf-8")
        # A brand new (or freshly cleared) file needs the identifying header.
        if self.path.stat().st_size == 0:
            self._write_line(header)

    def append(self, segment: TranscriptSegment) -> None:
        self._write_line(asdict(segment))

    def _write_line(self, obj: object) -> None:
        self._handle.write(json.dumps(obj, ensure_ascii=False) + "\n")
        # Flush so an abrupt crash still leaves a usable checkpoint on disk.
        self._handle.flush()

    def close(self) -> None:
        if not self._handle.closed:
            self._handle.close()


def load_checkpoint(
    path: Path,
    *,
    source: Path,
    model_name: str,
    language: str,
) -> tuple[list[TranscriptSegment], float] | None:
    """Load a matching checkpoint.

    Returns ``(segments, resume_offset)`` when a usable checkpoint exists for
    the same source, model and language, otherwise ``None``. The last line may
    be a partially written (truncated) segment if the previous run crashed
    mid-write; that line is ignored and the earlier segments are kept.
    """

    if not path.exists() or path.stat().st_size == 0:
        return None

    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return None

    try:
        header = json.loads(lines[0])
    except json.JSONDecodeError:
        return None

    if header.get("schema") != CHECKPOINT_SCHEMA:
        return None
    if header.get("model") != model_name or header.get("language") != language:
        return None
    if header.get("source_signature") != _source_signature(source):
        return None

    segments: list[TranscriptSegment] = []
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            # Truncated final line from a crash mid-write: stop and keep the rest.
            break
        segments.append(
            TranscriptSegment(
                start=float(data["start"]),
                end=float(data["end"]),
                text=str(data.get("text", "")),
                speaker=data.get("speaker"),
            )
        )

    if not segments:
        return None
    return segments, segments[-1].end
