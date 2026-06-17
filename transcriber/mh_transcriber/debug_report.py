"""Debug report generation for Moodle Hoarder Transcriber."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import traceback
from typing import Any

from .diagnostics import collect_cuda_diagnostics

INTERESTING_PACKAGES = [
    "faster-whisper",
    "ctranslate2",
    "av",
    "numpy",
    "onnxruntime",
    "huggingface-hub",
    "tokenizers",
    "imageio-ffmpeg",
    "tkinterdnd2",
]


def _package_version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "not installed"


def _safe_text(value: Any) -> str:
    """Convert subprocess output to a report-safe string."""

    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace").strip()
    return str(value).strip()


def _run_command(command: Sequence[str], timeout_seconds: float = 12.0) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except FileNotFoundError:
        return {"available": False, "error": "command not found", "command": list(command)}
    except subprocess.TimeoutExpired as exc:
        return {
            "available": True,
            "timed_out": True,
            "command": list(command),
            "stdout": _safe_text(exc.stdout),
            "stderr": _safe_text(exc.stderr),
        }
    return {
        "available": True,
        "returncode": result.returncode,
        "command": list(command),
        "stdout": _safe_text(result.stdout),
        "stderr": _safe_text(result.stderr),
    }


def _resolve_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    if importlib.util.find_spec("imageio_ffmpeg") is None:
        return None
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _file_info(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    expanded = Path(path).expanduser()
    info: dict[str, Any] = {
        "path": str(expanded),
        "exists": expanded.exists(),
    }
    if expanded.exists():
        stat = expanded.stat()
        info.update(
            {
                "resolved_path": str(expanded.resolve()),
                "size_bytes": stat.st_size,
                "modified_utc": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "suffix": expanded.suffix,
            }
        )
    return info


def _media_probe(input_path: Path | None) -> dict[str, Any] | None:
    if input_path is None or not Path(input_path).expanduser().exists():
        return None
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        return {"ffmpeg": "not available"}
    return _run_command([ffmpeg, "-hide_banner", "-i", str(Path(input_path).expanduser())], timeout_seconds=20)


def _python_module_checks() -> dict[str, Any]:
    checks: dict[str, Any] = {}
    for module in [
        "faster_whisper",
        "ctranslate2",
        "av",
        "av.audio",
        "av.audio.resampler",
        "av.audio.frame",
        "imageio_ffmpeg",
        "tkinterdnd2",
    ]:
        try:
            spec = importlib.util.find_spec(module)
        except Exception as exc:  # noqa: BLE001 - record import machinery failures
            checks[module] = {"available": False, "error": repr(exc)}
        else:
            checks[module] = {"available": spec is not None, "origin": getattr(spec, "origin", None) if spec else None}
    return checks


def build_debug_report(
    *,
    input_path: Path | None = None,
    output_dir: Path | None = None,
    settings: Mapping[str, Any] | None = None,
    recent_log: Sequence[str] | None = None,
    error: BaseException | None = None,
) -> dict[str, Any]:
    """Build a JSON-serializable diagnostic report."""

    report: dict[str, Any] = {
        "schema": "moodle-hoarder-transcriber-debug-v1",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "python": {
            "executable": sys.executable,
            "version": sys.version,
            "prefix": sys.prefix,
            "base_prefix": sys.base_prefix,
            "path_head": sys.path[:8],
        },
        "packages": {package: _package_version(package) for package in INTERESTING_PACKAGES},
        "modules": _python_module_checks(),
        "commands": {
            "git_head": _run_command(["git", "rev-parse", "--short", "HEAD"], timeout_seconds=4),
            "git_status": _run_command(["git", "status", "--short"], timeout_seconds=4),
            "nvidia_smi": _run_command(["nvidia-smi"], timeout_seconds=8),
        },
        "cuda_diagnostics": collect_cuda_diagnostics(),
        "ffmpeg_path": _resolve_ffmpeg(),
        "input_file": _file_info(input_path),
        "output_dir": _file_info(output_dir),
        "media_probe": _media_probe(input_path),
        "settings": dict(settings or {}),
        "recent_log": list(recent_log or []),
    }
    if error is not None:
        report["error"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": "".join(traceback.format_exception(type(error), error, error.__traceback__)),
        }
    return report


def write_debug_report(
    output_path: Path,
    *,
    input_path: Path | None = None,
    output_dir: Path | None = None,
    settings: Mapping[str, Any] | None = None,
    recent_log: Sequence[str] | None = None,
    error: BaseException | None = None,
) -> Path:
    """Write a debug report JSON file and return its resolved path."""

    output_path = Path(output_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report = build_debug_report(
        input_path=input_path,
        output_dir=output_dir,
        settings=settings,
        recent_log=recent_log,
        error=error,
    )
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path
