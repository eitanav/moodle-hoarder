import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.audio import (
    build_ffmpeg_command,
    parse_ffmpeg_duration,
    parse_ffmpeg_progress_time,
)


class FfmpegCommandTests(unittest.TestCase):
    def test_no_seek_when_start_is_zero(self):
        command = build_ffmpeg_command(
            ffmpeg="ffmpeg",
            input_path=Path("in.mp4"),
            output_path=Path("out.wav"),
            start_seconds=0.0,
        )
        self.assertNotIn("-ss", command)
        self.assertEqual(command[:3], ["ffmpeg", "-hide_banner", "-y"])
        self.assertIn("16000", command)

    def test_seek_added_before_input_when_resuming(self):
        command = build_ffmpeg_command(
            ffmpeg="ffmpeg",
            input_path=Path("in.mp4"),
            output_path=Path("out.wav"),
            start_seconds=125.0,
        )
        self.assertIn("-ss", command)
        # Input seeking: -ss must come before -i for a fast resume.
        self.assertLess(command.index("-ss"), command.index("-i"))
        self.assertEqual(command[command.index("-ss") + 1], "125.000")


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
