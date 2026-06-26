import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.formatters import (
    TranscriptSegment,
    format_plain_text,
    format_srt,
    format_timestamp,
    format_vtt,
    write_outputs,
)


class FormatterTests(unittest.TestCase):
    def test_format_timestamp_srt_and_vtt(self):
        self.assertEqual(format_timestamp(3661.234), "01:01:01,234")
        self.assertEqual(format_timestamp(3661.234, vtt=True), "01:01:01.234")

    def test_text_and_subtitle_exports(self):
        segments = [TranscriptSegment(1.0, 2.5, "שלום עולם"), TranscriptSegment(3.0, 4.0, "בדיקה")]
        self.assertIn("[00:00:01.000 → 00:00:02.500] שלום עולם", format_plain_text(segments))
        self.assertIn("1\n00:00:01,000 --> 00:00:02,500\nשלום עולם", format_srt(segments))
        self.assertTrue(format_vtt(segments).startswith("WEBVTT\n\n00:00:01.000 --> 00:00:02.500"))

    def test_write_outputs(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "lecture.mp4"
            source.write_bytes(b"fake")
            paths = write_outputs(
                audio_path=source,
                output_dir=tmp_path / "out",
                model_name="large-v3-turbo",
                language="he",
                duration=12.0,
                segments=[{"start": 0, "end": 1.25, "text": "טקסט"}],
            )
            self.assertEqual(set(paths), {"txt", "srt", "vtt", "json"})
            self.assertEqual(paths["json"].read_text(encoding="utf-8").count("moodle-hoarder-transcript-v1"), 1)
            self.assertIn("טקסט", paths["txt"].read_text(encoding="utf-8"))

    def test_write_outputs_formats_subset(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "lecture.mp4"
            source.write_bytes(b"fake")
            out_dir = tmp_path / "out"
            paths = write_outputs(
                audio_path=source,
                output_dir=out_dir,
                model_name="base",
                language="he",
                segments=[{"start": 0, "end": 1.0, "text": "א"}],
                formats=["txt", "srt"],
            )
            self.assertEqual(set(paths), {"txt", "srt"})
            self.assertTrue((out_dir / "lecture.txt").exists())
            self.assertFalse((out_dir / "lecture.vtt").exists())
            self.assertFalse((out_dir / "lecture.json").exists())

    def test_write_outputs_invalid_formats_default_to_all(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "lecture.mp4"
            source.write_bytes(b"fake")
            paths = write_outputs(
                audio_path=source,
                output_dir=tmp_path / "out",
                model_name="base",
                language="he",
                segments=[{"start": 0, "end": 1.0, "text": "א"}],
                formats=["bogus"],
            )
            self.assertEqual(set(paths), {"txt", "srt", "vtt", "json"})


if __name__ == "__main__":
    unittest.main()
