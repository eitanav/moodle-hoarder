"""Command line entrypoint for Moodle Hoarder Transcriber."""

from __future__ import annotations

import argparse
from pathlib import Path

from .diagnostics import collect_cuda_diagnostics
from .engine import DEFAULT_MODEL, RECOMMENDED_MODELS, transcribe_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Transcribe course recordings locally with faster-whisper.")
    parser.add_argument("input", type=Path, nargs="?", help="Audio/video file to transcribe, for example lecture.mp4")
    parser.add_argument("--out", type=Path, default=None, help="Output directory. Default: ./transcripts next to the input file")
    parser.add_argument("--model", default=DEFAULT_MODEL, choices=RECOMMENDED_MODELS, help="Whisper model to download/use")
    parser.add_argument("--language", default="he", help="Language code. Use he for Hebrew, or empty string for auto-detect")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"], help="Use cuda for NVIDIA GPU, cpu for CPU")
    parser.add_argument(
        "--compute-type",
        default="auto",
        choices=["auto", "float16", "int8_float16", "int8", "float32"],
        help="float16 is best for RTX GPUs; int8 is safer on CPU/low VRAM",
    )
    parser.add_argument("--beam-size", default=5, type=int, help="Higher can improve quality but is slower")
    parser.add_argument("--diagnose-gpu", action="store_true", help="Print CUDA/NVIDIA diagnostics and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.diagnose_gpu:
        print("CUDA/GPU diagnostics:")
        for line in collect_cuda_diagnostics():
            print("  " + line)
        return 0
    if args.input is None:
        build_parser().error("input is required unless --diagnose-gpu is used")

    def log(message: str) -> None:
        print(message, flush=True)

    paths = transcribe_file(
        input_path=args.input,
        output_dir=args.out,
        model_name=args.model,
        language=args.language,
        device=args.device,
        compute_type=args.compute_type,
        beam_size=args.beam_size,
        progress=log,
    )
    for kind, path in paths.items():
        print(f"{kind}: {path}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
