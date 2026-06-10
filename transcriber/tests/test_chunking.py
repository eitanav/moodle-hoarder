import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.chunking import (
    chunk_result_path,
    plan_chunks,
    read_chunk_result,
    resume_signature,
    slice_wav,
    wav_duration_seconds,
    write_chunk_result,
)


def _write_silence_wav(path: Path, *, seconds: float, framerate: int = 16000) -> None:
    frames = int(round(seconds * framerate))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)  # 16-bit PCM
        wav.setframerate(framerate)
        wav.writeframes(b"\x00\x00" * frames)


class PlanChunksTests(unittest.TestCase):
    def test_even_split(self):
        chunks = plan_chunks(600.0, 300.0)
        self.assertEqual([(c.index, c.start, c.end) for c in chunks], [(0, 0.0, 300.0), (1, 300.0, 600.0)])

    def test_uneven_final_chunk_is_short(self):
        chunks = plan_chunks(700.0, 300.0)
        self.assertEqual(len(chunks), 3)
        self.assertEqual((chunks[-1].start, chunks[-1].end), (600.0, 700.0))

    def test_duration_at_or_below_chunk_is_single_window(self):
        self.assertEqual(len(plan_chunks(300.0, 300.0)), 1)
        self.assertEqual(len(plan_chunks(120.0, 300.0)), 1)

    def test_zero_or_negative_duration_yields_nothing(self):
        self.assertEqual(plan_chunks(0.0, 300.0), [])

    def test_invalid_chunk_length_raises(self):
        with self.assertRaises(ValueError):
            plan_chunks(100.0, 0)


class WavSliceTests(unittest.TestCase):
    def test_duration_and_slice_frame_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "full.wav"
            _write_silence_wav(src, seconds=10.0)
            self.assertAlmostEqual(wav_duration_seconds(src), 10.0, places=3)

            out = tmp_path / "slice.wav"
            slice_wav(wav_path=src, start=2.0, end=5.0, out_path=out)
            self.assertAlmostEqual(wav_duration_seconds(out), 3.0, places=3)

    def test_slice_clamps_past_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "full.wav"
            _write_silence_wav(src, seconds=4.0)
            out = tmp_path / "slice.wav"
            slice_wav(wav_path=src, start=3.0, end=99.0, out_path=out)
            self.assertAlmostEqual(wav_duration_seconds(out), 1.0, places=3)


class ResumeStateTests(unittest.TestCase):
    def test_roundtrip_chunk_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = chunk_result_path(Path(tmp), 3)
            self.assertTrue(path.name.endswith("0003.json"))
            segments = [{"start": 1.5, "end": 2.0, "text": "שלום"}]
            write_chunk_result(path, segments=segments)
            self.assertEqual(read_chunk_result(path), segments)

    def test_signature_changes_with_inputs(self):
        base = dict(source=Path("/x/a.mp4"), model_name="large-v3-turbo", chunk_length_s=1800, total_duration=3600)
        sig = resume_signature(**base)
        self.assertEqual(resume_signature(**base), sig)
        self.assertNotEqual(resume_signature(**{**base, "model_name": "medium"}), sig)
        self.assertNotEqual(resume_signature(**{**base, "chunk_length_s": 600}), sig)


if __name__ == "__main__":
    unittest.main()
