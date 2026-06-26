"""faster-whisper based local transcription engine."""

from __future__ import annotations

from collections.abc import Callable, Iterable
import importlib
import importlib.util
import os
from pathlib import Path
import tempfile
import sys
import threading
import time
from typing import Literal

from .audio import prepare_audio_for_transcription
from .diagnostics import log_cuda_diagnostics
from .formatters import write_outputs
from .model_manager import download_model

ComputeType = Literal["auto", "float16", "int8_float16", "int8", "float32"]
Device = Literal["auto", "cuda", "cpu"]
ProgressCallback = Callable[[str], None]

DEFAULT_MODEL = "large-v3-turbo"
RECOMMENDED_MODELS = [
    "large-v3-turbo",
    "large-v3",
    "medium",
    "small",
    "base",
]


def _resolve_compute_type(device: Device, compute_type: ComputeType) -> str:
    if compute_type != "auto":
        return compute_type
    if device == "cpu":
        return "int8"
    return "float16"



def _prime_pyav_audio_namespace(progress: ProgressCallback | None = None) -> None:
    """Load PyAV audio submodules that faster-whisper expects as av.audio.*.

    Some PyAV builds do not expose ``av.audio`` until an audio submodule is
    imported explicitly. Without this, faster-whisper can fail with:
    ``module 'av' has no attribute 'audio'`` right before decoding.
    """

    if importlib.util.find_spec("av") is None:
        return
    try:
        import av

        audio_module = importlib.import_module("av.audio")
        resampler_module = importlib.import_module("av.audio.resampler")
        frame_module = importlib.import_module("av.audio.frame")
        # Some Windows/PyAV builds put the modules in sys.modules but do not
        # attach them as attributes. faster-whisper accesses av.audio.resampler,
        # so patch the namespace explicitly before decoding.
        if not hasattr(av, "audio"):
            av.audio = audio_module  # type: ignore[attr-defined]
        if not hasattr(av.audio, "resampler"):
            av.audio.resampler = resampler_module  # type: ignore[attr-defined]
        if not hasattr(av.audio, "frame"):
            av.audio.frame = frame_module  # type: ignore[attr-defined]
        if not hasattr(av.audio, "resampler"):
            raise AttributeError("PyAV did not expose av.audio.resampler after importing audio submodules")
    except Exception as exc:  # noqa: BLE001 - provide actionable GUI error instead of raw AttributeError
        requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
        raise RuntimeError(
            "PyAV/faster-whisper audio decoder is not initialized correctly. "
            f"Underlying error: {type(exc).__name__}: {exc}. "
            "If the underlying error mentions site/addpackage/.pth/distutils or UnicodeDecodeError, "
            "the local .venv is corrupted — delete transcriber\\.venv and re-run setup_windows.bat. "
            "Otherwise close the transcriber and run transcriber\\run_gui_windows.bat so dependencies can update. "
            f"Manual fix: {sys.executable} -m pip install --upgrade --force-reinstall -r {requirements_path}"
        ) from exc
    if progress:
        progress("PyAV audio decoder initialized.")


def _explain_cuda_library_error(exc: Exception) -> RuntimeError | None:
    """Translate a missing CUDA runtime library error into actionable guidance.

    CTranslate2 loads cuBLAS/cuDNN/cudart lazily, so a GPU driver can be
    present and healthy while the matching CUDA runtime DLLs (e.g.
    cublas64_12.dll) fail to load. That surfaces as a raw "Library ... is not
    found or cannot be loaded" error with no hint of the fix, often only once
    the first segment is actually decoded. _add_nvidia_pip_dll_directories()
    already tries to fix this automatically by exposing pip-installed
    nvidia-*-cu12 DLL folders to Windows; this only triggers when that was not
    enough (package missing entirely, or a DLL outside cuBLAS/cuDNN/cudart).
    """

    lowered = str(exc).lower()
    if "cublas" not in lowered and "cudnn" not in lowered and "cudart" not in lowered:
        return None
    return RuntimeError(
        "CUDA runtime library failed to load "
        f"({type(exc).__name__}: {exc}). "
        "Your NVIDIA GPU driver is present, but a CUDA runtime DLL "
        "(cuBLAS/cuDNN/cudart/nvJitLink) could not be loaded, even after this tool tried to expose "
        "and pre-load pip-installed NVIDIA DLLs automatically. Fix options: "
        "1) From transcriber\\.venv run: "
        "python -m pip install --upgrade nvidia-cublas-cu12 nvidia-cudnn-cu12 "
        "nvidia-cuda-runtime-cu12 nvidia-nvjitlink-cu12 nvidia-cuda-nvrtc-cu12 ; "
        "2) Or switch Device to cpu in the GUI (slower, no GPU runtime needed); "
        "3) Make sure your NVIDIA GPU driver is up to date."
    )


def _add_nvidia_pip_dll_directories(progress: ProgressCallback | None = None) -> list[str]:
    """Make pip-installed NVIDIA CUDA runtime DLLs loadable on Windows.

    Packages like nvidia-cublas-cu12/nvidia-cudnn-cu12 ship cublas64_12.dll,
    cudnn64_9.dll, etc. under site-packages/nvidia/<name>/bin, but installing
    them is not enough to make CTranslate2 find them: Windows' "safe DLL
    search mode" (the default since Python 3.8) ignores PATH when an
    extension module loads a DLL, so the file can sit right there in
    site-packages and CTranslate2 still raises "... is not found or cannot be
    loaded". os.add_dll_directory() opts a folder back into that search, but
    it is still not sufficient on its own: CTranslate2's internal Windows
    loader calls LoadLibraryA without LOAD_LIBRARY_SEARCH_USER_DIRS, so it
    never consults directories registered via AddDllDirectory. The reliable
    fix is to also pre-load every DLL in those folders via ctypes.WinDLL()
    (which does honor added directories) before CTranslate2 lazily dlopens
    them by base name at first encode — Windows then returns the
    already-loaded module handle instead of re-resolving the search path.
    """

    added: list[str] = []
    if sys.platform != "win32":
        return added
    try:
        import nvidia  # type: ignore[import-not-found]
    except ImportError:
        return added
    bin_dirs: list[Path] = []
    for nvidia_path in getattr(nvidia, "__path__", []):
        nvidia_dir = Path(nvidia_path)
        if not nvidia_dir.is_dir():
            continue
        for sub in nvidia_dir.iterdir():
            bin_dir = sub / "bin"
            if not bin_dir.is_dir():
                continue
            try:
                os.add_dll_directory(str(bin_dir))  # type: ignore[attr-defined]
            except (OSError, AttributeError):
                continue
            bin_dirs.append(bin_dir)
            added.append(str(bin_dir))

    import ctypes

    preloaded: list[str] = []
    for bin_dir in bin_dirs:
        for dll_path in bin_dir.glob("*.dll"):
            try:
                ctypes.WinDLL(str(dll_path))
            except OSError:
                continue
            preloaded.append(dll_path.name)

    if progress and added:
        progress("Added NVIDIA CUDA runtime DLL directories: " + ", ".join(added))
    if progress and preloaded:
        progress(f"Pre-loaded {len(preloaded)} NVIDIA CUDA DLLs into the process.")
    return added


def _load_whisper_model_with_heartbeat(
    *,
    model_cls: object,
    model_name: str,
    device: str,
    compute_type: str,
    progress: ProgressCallback | None,
) -> object:
    """Load a Whisper model while emitting periodic progress messages.

    The faster-whisper constructor can block for a long time during first-run
    Hugging Face downloads or CTranslate2 initialization, so this keeps the GUI
    log alive and gives the user actionable next steps instead of appearing stuck.
    """

    stop = threading.Event()
    started_at = time.monotonic()

    def heartbeat() -> None:
        while not stop.wait(30):
            elapsed_minutes = (time.monotonic() - started_at) / 60
            if progress:
                progress(
                    f"Still loading model {model_name} ({elapsed_minutes:0.1f} min elapsed). "
                    "First run may be downloading; if this passes 10-15 min, try model=base/small once."
                )

    thread: threading.Thread | None = None
    if progress:
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
    try:
        return model_cls(model_name, device=device, compute_type=compute_type)
    finally:
        stop.set()
        if thread:
            thread.join(timeout=0.2)
        if progress:
            elapsed = time.monotonic() - started_at
            progress(f"Model load step finished after {elapsed:0.1f}s.")

def transcribe_file(
    *,
    input_path: Path,
    output_dir: Path | None = None,
    model_name: str = DEFAULT_MODEL,
    language: str = "he",
    device: Device = "auto",
    compute_type: ComputeType = "auto",
    beam_size: int = 5,
    progress: ProgressCallback | None = None,
    preprocess_audio: bool = True,
    formats: Iterable[str] | None = None,
) -> dict[str, Path]:
    """Transcribe one media file and export txt/srt/vtt/json files.

    By default, media is first converted to a mono 16 kHz WAV with ffmpeg. This
    makes long MP4/M4A inputs more predictable and provides progress before the
    first Whisper segment is decoded.
    """

    input_path = Path(input_path).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_dir = Path(output_dir or input_path.parent / "transcripts").expanduser().resolve()
    resolved_compute = _resolve_compute_type(device, compute_type)

    with tempfile.TemporaryDirectory(prefix="mh-transcriber-") as tmp:
        transcription_input = input_path
        if preprocess_audio:
            transcription_input = prepare_audio_for_transcription(
                input_path=input_path,
                work_dir=Path(tmp),
                progress=progress,
            )
        elif progress:
            progress("Audio preprocessing is disabled; passing media directly to faster-whisper.")

        if progress:
            progress(f"Checking/downloading model {model_name} before loading...")
        model_path = download_model(model_name, progress=progress)

        if progress:
            progress(f"Loading model {model_name} on {device} ({resolved_compute}) from local cache...")
        if device in {"cuda", "auto"}:
            _add_nvidia_pip_dll_directories(progress)
            log_cuda_diagnostics(progress)

        if importlib.util.find_spec("faster_whisper") is None:
            requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
            raise RuntimeError(
                "Missing dependency faster-whisper. "
                "On Windows, run transcriber\\run_gui_windows.bat so it can install dependencies automatically. "
                f"Manual install for this Python: {sys.executable} -m pip install -r {requirements_path}"
            )

        from faster_whisper import WhisperModel

        try:
            model = _load_whisper_model_with_heartbeat(
                model_cls=WhisperModel,
                model_name=str(model_path),
                device=device,
                compute_type=resolved_compute,
                progress=progress,
            )
        except Exception as exc:  # noqa: BLE001 - translate known CUDA library failures
            translated = _explain_cuda_library_error(exc)
            if translated:
                raise translated from exc
            raise

        if device in {"cuda", "auto"}:
            log_cuda_diagnostics(progress)

        _prime_pyav_audio_namespace(progress)

        if progress:
            progress("Model loaded. Starting transcription...")
            progress(f"Transcribing {input_path.name}...")

        segments_iter, info = model.transcribe(
            str(transcription_input),
            language=language or None,
            beam_size=beam_size,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )

        duration = getattr(info, "duration", None)
        if progress and duration:
            progress(f"Audio duration: {duration / 60:0.1f} minutes. Progress appears as segments are decoded.")

        # Materialize the generator so we can write all output formats.
        segments = []
        try:
            for segment in segments_iter:
                segments.append(segment)
                if progress:
                    percent = f" ({min(100.0, (segment.end / duration) * 100):0.1f}%)" if duration else ""
                    progress(f"Decoded {segment.start:0.1f}s–{segment.end:0.1f}s{percent}: {str(segment.text or '').strip()[:80]}")
        except Exception as exc:  # noqa: BLE001 - translate known CUDA library failures
            translated = _explain_cuda_library_error(exc)
            if translated:
                raise translated from exc
            raise

    if progress:
        progress("Writing transcript files...")

    paths = write_outputs(
        audio_path=input_path,
        output_dir=output_dir,
        model_name=model_name,
        language=language or getattr(info, "language", "unknown"),
        duration=duration,
        segments=segments,
        formats=formats,
    )

    if progress:
        progress(f"Done. Wrote files to {output_dir}")
    return paths
