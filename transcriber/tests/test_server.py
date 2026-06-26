import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber import server


def _wait_idle(state, timeout=5.0):
    """Block until the worker finishes the active warehouse."""

    deadline = time.monotonic() + timeout
    while state.active_warehouse_id is not None and time.monotonic() < deadline:
        time.sleep(0.02)


class ServerHelpersTest(unittest.TestCase):
    def test_safe_filename(self):
        self.assertEqual(server._safe_filename("../../etc/passwd"), "passwd")
        self.assertEqual(server._safe_filename("a/b/c lecture.mp4"), "c lecture.mp4")
        self.assertTrue(server._safe_filename("") .startswith("file-"))

    def test_safe_folder(self):
        self.assertEqual(server._safe_folder("Intro / 101"), "Intro _ 101")
        self.assertEqual(server._safe_folder(""), "warehouse")

    def test_percent_mapping(self):
        # ffmpeg phase maps into the first 15%.
        self.assertAlmostEqual(server._percent_for("Prepared audio 5s/10s (50.0%).", 0), 7.5)
        # decoded segments map into 15..100%.
        self.assertAlmostEqual(server._percent_for("Decoded 1s-2s (0.0%): hi", 0), 15.0)
        self.assertAlmostEqual(server._percent_for("Decoded 9s-10s (100.0%): hi", 0), 100.0)
        self.assertIsNone(server._percent_for("Loading model", 0))


class QueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self._tmpdir())
        # Redirect persistence + workspaces away from the real home dir.
        server.DATA_DIR = self.tmp
        server.WORKSPACES_DIR = self.tmp / "workspaces"
        server.STATE_PATH = self.tmp / "state.json"
        server.WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
        self.state = server.AppState()

    def _tmpdir(self):
        import tempfile

        d = tempfile.mkdtemp(prefix="mh-server-test-")
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        return d

    def _add_warehouse_with_file(self):
        src = self.tmp / "lecture.mp4"
        src.write_bytes(b"fake")
        wh = {
            "id": "wh1",
            "name": "course",
            "created_at": "now",
            "output_dir": str(self.tmp / "out"),
            "files": [{
                "id": "f1", "name": "lecture.mp4", "path": str(src), "size": 4,
                "status": "queued", "progress": 0, "message": "", "outputs": {}, "error": "",
            }],
        }
        self.state.warehouses.append(wh)
        return wh

    def test_queue_success(self):
        calls = {}

        def fake_transcribe(*, input_path, output_dir, progress=None, formats=None, **kwargs):
            calls["formats"] = formats
            calls["output_dir"] = output_dir
            if progress:
                progress("Decoded 9s-10s (100.0%): done")
            return {"txt": Path(output_dir) / "lecture.txt"}

        server.transcribe_file = fake_transcribe
        wh = self._add_warehouse_with_file()
        self.state.settings["formats"] = ["txt"]

        ok, _ = self.state.start_warehouse("wh1")
        self.assertTrue(ok)
        _wait_idle(self.state)

        f = wh["files"][0]
        self.assertEqual(f["status"], "done")
        self.assertEqual(f["progress"], 100)
        expected_txt = str(self.tmp / "out" / "course" / "lecture.txt")
        self.assertEqual(f["outputs"], {"txt": expected_txt})
        self.assertEqual(calls["formats"], ["txt"])
        # output dir gets a per-warehouse subfolder.
        self.assertTrue(str(calls["output_dir"]).endswith("course"))

    def test_queue_error_is_isolated(self):
        def boom(**kwargs):
            raise RuntimeError("no model")

        server.transcribe_file = boom
        wh = self._add_warehouse_with_file()

        self.state.start_warehouse("wh1")
        _wait_idle(self.state)

        f = wh["files"][0]
        self.assertEqual(f["status"], "error")
        self.assertIn("no model", f["error"])
        # Server stayed healthy: active warehouse cleared.
        self.assertIsNone(self.state.active_warehouse_id)

    def test_start_without_pending(self):
        wh = self._add_warehouse_with_file()
        wh["files"][0]["status"] = "done"
        ok, msg = self.state.start_warehouse("wh1")
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
