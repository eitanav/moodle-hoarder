import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.diagnostics import format_nvidia_snapshot, parse_nvidia_smi_csv


class DiagnosticsTests(unittest.TestCase):
    def test_parse_nvidia_smi_csv(self):
        snapshots = parse_nvidia_smi_csv("NVIDIA GeForce RTX 3070 Laptop GPU, 8192, 2048, 37\n")

        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].name, "NVIDIA GeForce RTX 3070 Laptop GPU")
        self.assertEqual(snapshots[0].memory_total_mb, 8192)
        self.assertEqual(snapshots[0].memory_used_mb, 2048)
        self.assertEqual(snapshots[0].memory_free_mb, 6144)
        self.assertEqual(snapshots[0].utilization_gpu_percent, 37)

    def test_format_nvidia_snapshot(self):
        snapshots = parse_nvidia_smi_csv("RTX 3070 Laptop, 8192, 4096, 12\n")

        self.assertEqual(
            format_nvidia_snapshot(snapshots),
            ["GPU 0: RTX 3070 Laptop, VRAM 4096MB/8192MB, free 4096MB, utilization 12%"],
        )


if __name__ == "__main__":
    unittest.main()
