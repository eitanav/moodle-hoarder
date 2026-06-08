import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.audio import parse_ffmpeg_duration, parse_ffmpeg_progress_time


class AudioParsingTests(unittest.TestCase):
    def test_parse_ffmpeg_duration(self):
        self.assertEqual(
            parse_ffmpeg_duration("  Duration: 01:02:03.45, start: 0.000000, bitrate: 128 kb/s"),
            3723.45,
        )

    def test_parse_ffmpeg_progress_time(self):
        self.assertEqual(
            parse_ffmpeg_progress_time("size=1234kB time=00:10:05.50 bitrate=128.0kbits/s speed=24x"),
            605.5,
        )

    def test_parse_missing_values(self):
        self.assertIsNone(parse_ffmpeg_duration("hello"))
        self.assertIsNone(parse_ffmpeg_progress_time("hello"))


if __name__ == "__main__":
    unittest.main()
