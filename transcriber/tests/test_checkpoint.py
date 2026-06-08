import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.checkpoint import (
    CheckpointWriter,
    build_header,
    checkpoint_path_for,
    load_checkpoint,
)
from mh_transcriber.formatters import TranscriptSegment


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        # A real source file so the size/mtime signature can be computed.
        self.source = self.dir / "lecture.mp4"
        self.source.write_bytes(b"fake media bytes")
        self.path = checkpoint_path_for(self.dir, self.source.stem)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, segments, *, model="large-v3-turbo", language="he"):
        writer = CheckpointWriter(
            self.path,
            build_header(source=self.source, model_name=model, language=language),
        )
        for segment in segments:
            writer.append(segment)
        writer.close()

    def test_roundtrip_returns_segments_and_offset(self):
        self._write(
            [
                TranscriptSegment(start=0.0, end=3.5, text="שלום"),
                TranscriptSegment(start=3.5, end=7.25, text="עולם"),
            ]
        )
        loaded = load_checkpoint(
            self.path, source=self.source, model_name="large-v3-turbo", language="he"
        )
        self.assertIsNotNone(loaded)
        segments, offset = loaded
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[1].text, "עולם")
        self.assertEqual(offset, 7.25)

    def test_missing_file_returns_none(self):
        self.assertIsNone(
            load_checkpoint(self.path, source=self.source, model_name="m", language="he")
        )

    def test_model_mismatch_is_ignored(self):
        self._write([TranscriptSegment(start=0.0, end=1.0, text="x")], model="medium")
        self.assertIsNone(
            load_checkpoint(
                self.path, source=self.source, model_name="large-v3-turbo", language="he"
            )
        )

    def test_language_mismatch_is_ignored(self):
        self._write([TranscriptSegment(start=0.0, end=1.0, text="x")], language="he")
        self.assertIsNone(
            load_checkpoint(
                self.path, source=self.source, model_name="large-v3-turbo", language="en"
            )
        )

    def test_changed_source_restarts_fresh(self):
        self._write([TranscriptSegment(start=0.0, end=2.0, text="x")])
        # Editing the source changes its size signature -> checkpoint is stale.
        self.source.write_bytes(b"different and longer media bytes now")
        self.assertIsNone(
            load_checkpoint(
                self.path, source=self.source, model_name="large-v3-turbo", language="he"
            )
        )

    def test_truncated_last_line_keeps_earlier_segments(self):
        self._write([TranscriptSegment(start=0.0, end=2.0, text="good")])
        # Simulate a crash mid-write by appending a partial JSON line.
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write('{"start": 2.0, "end": 4.0, "te')
        loaded = load_checkpoint(
            self.path, source=self.source, model_name="large-v3-turbo", language="he"
        )
        self.assertIsNotNone(loaded)
        segments, offset = loaded
        self.assertEqual(len(segments), 1)
        self.assertEqual(offset, 2.0)

    def test_header_only_checkpoint_returns_none(self):
        self._write([])
        self.assertIsNone(
            load_checkpoint(
                self.path, source=self.source, model_name="large-v3-turbo", language="he"
            )
        )

    def test_resume_appends_without_duplicating_header(self):
        self._write([TranscriptSegment(start=0.0, end=2.0, text="first")])
        # Re-opening the same path should append, not rewrite the header.
        writer = CheckpointWriter(
            self.path,
            build_header(source=self.source, model_name="large-v3-turbo", language="he"),
        )
        writer.append(TranscriptSegment(start=2.0, end=4.0, text="second"))
        writer.close()

        loaded = load_checkpoint(
            self.path, source=self.source, model_name="large-v3-turbo", language="he"
        )
        self.assertIsNotNone(loaded)
        segments, offset = loaded
        self.assertEqual([s.text for s in segments], ["first", "second"])
        self.assertEqual(offset, 4.0)


if __name__ == "__main__":
    unittest.main()
