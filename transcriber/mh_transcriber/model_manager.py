"""Model download helpers for faster-whisper."""

from __future__ import annotations

from collections.abc import Callable
import importlib.util
import sys
import threading
import time
from pathlib import Path

ProgressCallback = Callable[[str], None]

MODEL_REPOS = {
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large-v3-turbo": "deepdml/faster-whisper-large-v3-turbo-ct2",
}


def model_repo(model_name: str) -> str:
    """Return the Hugging Face repository used by faster-whisper for a model."""

    return MODEL_REPOS.get(model_name, model_name)


def ensure_huggingface_hub() -> None:
    if importlib.util.find_spec("huggingface_hub") is None:
        requirements_path = Path(__file__).resolve().parents[1] / "requirements.txt"
        raise RuntimeError(
            "Missing dependency huggingface_hub. "
            "Launch via transcriber\\run_web_windows.bat (or run_gui_windows.bat) so it can install "
            "dependencies automatically into the dedicated .venv. "
            f"Manual install for this Python: {sys.executable} -m pip install -r {requirements_path}"
        )


def download_model(model_name: str, progress: ProgressCallback | None = None) -> Path:
    """Download a faster-whisper model with visible progress.

    The audio is not uploaded anywhere. This only downloads public model files
    from Hugging Face into the local cache so transcription can run offline-ish
    afterwards (apart from future cache misses).
    """

    ensure_huggingface_hub()
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    repo_id = model_repo(model_name)
    if progress:
        progress(f"Downloading model files for {model_name} from {repo_id}...")
        progress("Only model weights are downloaded; recordings are not uploaded.")

    class ProgressTqdm(tqdm):  # type: ignore[misc]
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, **kwargs)
            self._last_report = 0.0

        def update(self, n: int = 1) -> bool | None:  # type: ignore[override]
            result = super().update(n)
            now = time.monotonic()
            if progress and now - self._last_report >= 1.0:
                self._last_report = now
                total = self.total or 0
                current = self.n
                if total:
                    percent = min(100.0, current / total * 100)
                    progress(f"Model download progress: {current}/{total} files ({percent:0.1f}%).")
                else:
                    progress(f"Model download progress: {current} files checked/downloaded.")
            return result

    stop = threading.Event()
    started = time.monotonic()

    def heartbeat() -> None:
        while not stop.wait(20):
            if progress:
                elapsed = (time.monotonic() - started) / 60
                progress(f"Still downloading/checking {model_name} ({elapsed:0.1f} min elapsed).")

    thread: threading.Thread | None = None
    if progress:
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
    try:
        path = snapshot_download(repo_id=repo_id, tqdm_class=ProgressTqdm)
    finally:
        stop.set()
        if thread:
            thread.join(timeout=0.2)

    cache_path = Path(path)
    if progress:
        progress(f"Model ready in cache: {cache_path}")
    return cache_path
