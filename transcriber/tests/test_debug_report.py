import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.debug_report import _safe_text, build_debug_report, write_debug_report


class DebugReportTests(unittest.TestCase):
    def test_build_debug_report_contains_core_sections(self):
        report = build_debug_report(settings={"model": "base"}, recent_log=["hello"])

        self.assertEqual(report["schema"], "moodle-hoarder-transcriber-debug-v1")
        self.assertEqual(report["settings"]["model"], "base")
        self.assertEqual(report["recent_log"], ["hello"])
        self.assertIn("python", report)
        self.assertIn("packages", report)
        self.assertIn("cuda_diagnostics", report)
        self.assertIn("modules", report)

    def test_write_debug_report_json(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "debug.json"
            written = write_debug_report(path, settings={"device": "cpu"})

            self.assertEqual(written, path.resolve())
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["settings"]["device"], "cpu")

    def test_safe_text_handles_none_bytes_and_strings(self):
        self.assertEqual(_safe_text(None), "")
        self.assertEqual(_safe_text(b" hello "), "hello")
        self.assertEqual(_safe_text(" hello "), "hello")


if __name__ == "__main__":
    unittest.main()
