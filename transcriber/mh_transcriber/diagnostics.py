"""Runtime diagnostics for local GPU transcription."""

from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import subprocess
from collections.abc import Callable, Iterable


@dataclass(frozen=True)
class NvidiaSmiSnapshot:
    """One row returned by nvidia-smi."""

    name: str
    memory_total_mb: int | None
    memory_used_mb: int | None
    utilization_gpu_percent: int | None

    @property
    def memory_free_mb(self) -> int | None:
        if self.memory_total_mb is None or self.memory_used_mb is None:
            return None
        return max(0, self.memory_total_mb - self.memory_used_mb)


def _parse_int(value: str) -> int | None:
    value = value.strip()
    if not value or value.upper() == "N/A":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def parse_nvidia_smi_csv(output: str) -> list[NvidiaSmiSnapshot]:
    """Parse CSV output from nvidia-smi query-gpu."""

    snapshots: list[NvidiaSmiSnapshot] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 4:
            continue
        snapshots.append(
            NvidiaSmiSnapshot(
                name=parts[0],
                memory_total_mb=_parse_int(parts[1]),
                memory_used_mb=_parse_int(parts[2]),
                utilization_gpu_percent=_parse_int(parts[3]),
            )
        )
    return snapshots


def get_nvidia_smi_snapshot(timeout_seconds: float = 4.0) -> list[NvidiaSmiSnapshot]:
    """Return current NVIDIA GPU state, or an empty list when nvidia-smi is unavailable."""

    command = [
        "nvidia-smi",
        "--query-gpu=name,memory.total,memory.used,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout_seconds)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    return parse_nvidia_smi_csv(result.stdout)


def format_nvidia_snapshot(snapshots: Iterable[NvidiaSmiSnapshot]) -> list[str]:
    """Format NVIDIA diagnostics as human-readable log lines."""

    lines: list[str] = []
    for index, snapshot in enumerate(snapshots):
        total = f"{snapshot.memory_total_mb}MB" if snapshot.memory_total_mb is not None else "unknown"
        used = f"{snapshot.memory_used_mb}MB" if snapshot.memory_used_mb is not None else "unknown"
        free = f", free {snapshot.memory_free_mb}MB" if snapshot.memory_free_mb is not None else ""
        util = (
            f"{snapshot.utilization_gpu_percent}%"
            if snapshot.utilization_gpu_percent is not None
            else "unknown"
        )
        lines.append(f"GPU {index}: {snapshot.name}, VRAM {used}/{total}{free}, utilization {util}")
    return lines


def collect_cuda_diagnostics() -> list[str]:
    """Collect safe CUDA/CTranslate2 diagnostics without requiring faster-whisper to be installed."""

    lines: list[str] = []
    if importlib.util.find_spec("ctranslate2") is None:
        lines.append("CTranslate2 is not installed yet; run setup first.")
    else:
        import ctranslate2

        try:
            cuda_devices = ctranslate2.get_cuda_device_count()
        except Exception as exc:  # noqa: BLE001 - diagnostics should not crash transcription
            lines.append(f"CTranslate2 CUDA device check failed: {exc}")
        else:
            lines.append(f"CTranslate2 CUDA devices: {cuda_devices}")
        try:
            compute_types = sorted(ctranslate2.get_supported_compute_types("cuda"))
        except Exception as exc:  # noqa: BLE001 - diagnostics should not crash transcription
            lines.append(f"CTranslate2 CUDA compute type check failed: {exc}")
        else:
            lines.append("CTranslate2 CUDA compute types: " + ", ".join(compute_types))

    snapshots = get_nvidia_smi_snapshot()
    if snapshots:
        lines.extend(format_nvidia_snapshot(snapshots))
    else:
        lines.append("nvidia-smi is unavailable or returned no GPUs.")
    return lines


def log_cuda_diagnostics(progress: Callable[[str], None] | None) -> None:
    """Send CUDA diagnostics to a progress callback."""

    if not progress:
        return
    progress("CUDA/GPU diagnostics:")
    for line in collect_cuda_diagnostics():
        progress("  " + line)
