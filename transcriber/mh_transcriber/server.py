"""Local web app for Moodle Hoarder Transcriber.

A small standard-library HTTP server that serves a browser UI (matching the
extension theme) and exposes a JSON API for:

* warehouses (מחסנים) — named collections of media files,
* drag-and-drop / uploaded files queued per warehouse,
* sequential transcription of a warehouse with live progress (SSE),
* a configurable output location and output formats,
* persistent settings (model / device / compute / language / theme).

The actual speech-to-text work is delegated to :func:`engine.transcribe_file`,
so no transcription dependency is needed just to run the server. Everything is
bound to localhost; recordings never leave the machine.
"""

from __future__ import annotations

import json
import mimetypes
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass, field
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .engine import DEFAULT_MODEL, RECOMMENDED_MODELS, transcribe_file
from .formatters import SUPPORTED_FORMATS

WEB_DIR = Path(__file__).resolve().parent / "web"
DATA_DIR = Path.home() / ".moodle-hoarder-transcriber"
WORKSPACES_DIR = DATA_DIR / "workspaces"
STATE_PATH = DATA_DIR / "state.json"
DEFAULT_OUTPUT_DIR = Path.home() / "MoodleHoarder" / "Transcripts"

DEVICES = ["auto", "cuda", "cpu"]
COMPUTE_TYPES = ["auto", "float16", "int8_float16", "int8", "float32"]
THEMES = ["system", "light", "dark"]
ACCENTS = ["pink", "blue"]

DEFAULT_SETTINGS: dict[str, Any] = {
    "output_dir": str(DEFAULT_OUTPUT_DIR),
    "formats": list(SUPPORTED_FORMATS),
    "model": DEFAULT_MODEL,
    "language": "he",
    "device": "auto",
    "compute_type": "auto",
    "beam_size": 5,
    "preprocess_audio": True,
    "theme": "system",
    "accent": "pink",
}


class StopTranscription(Exception):
    """Raised from the progress callback to abort the current file."""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _safe_filename(name: str) -> str:
    """Reduce an arbitrary upload name to a safe basename."""

    name = unquote(name or "").replace("\\", "/").split("/")[-1].strip()
    name = name.replace("\x00", "")
    cleaned = "".join(ch for ch in name if ch not in '<>:"|?*').strip()
    return cleaned or f"file-{uuid.uuid4().hex[:8]}"


def _safe_folder(name: str) -> str:
    """Turn a warehouse name into a filesystem-friendly folder name."""

    cleaned = "".join(ch if ch not in '<>:"|?*/\\' else "_" for ch in (name or "")).strip()
    cleaned = cleaned.strip(". ")
    return cleaned or "warehouse"


def _percent_for(message: str, current: float) -> float | None:
    """Map an engine progress line to an overall 0–100 percent for one file.

    ffmpeg preparation maps to the first 15%; decoded segments map to 15–100%
    so the bar advances smoothly across both phases instead of resetting.
    """

    import re

    match = re.search(r"\(([\d.]+)%\)", message)
    if not match:
        return None
    try:
        raw = float(match.group(1))
    except ValueError:
        return None
    if "Prepared audio" in message:
        return min(15.0, raw * 0.15)
    if "Decoded" in message:
        return 15.0 + min(85.0, raw * 0.85)
    return max(current, min(100.0, raw))


# --------------------------------------------------------------------------- #
# Server-sent events hub
# --------------------------------------------------------------------------- #
class Hub:
    """Fan-out of state snapshots to connected EventSource clients."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue[str]] = set()

    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self._lock:
            self._subscribers.discard(q)

    def publish(self, payload: str) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                # Slow client: drop the oldest snapshot and keep the newest.
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except queue.Empty:
                    pass


# --------------------------------------------------------------------------- #
# Application state
# --------------------------------------------------------------------------- #
@dataclass
class AppState:
    settings: dict[str, Any] = field(default_factory=lambda: dict(DEFAULT_SETTINGS))
    warehouses: list[dict[str, Any]] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    active_warehouse_id: str | None = None
    stop_requested: bool = False

    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    hub: Hub = field(default_factory=Hub, repr=False)
    _last_broadcast: float = field(default=0.0, repr=False)

    # ---- persistence -----------------------------------------------------
    @classmethod
    def load(cls) -> "AppState":
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
        state = cls()
        if STATE_PATH.exists():
            try:
                data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            merged = dict(DEFAULT_SETTINGS)
            merged.update(data.get("settings", {}))
            state.settings = merged
            for wh in data.get("warehouses", []):
                state.warehouses.append(_normalize_warehouse(wh))
        return state

    def save(self) -> None:
        with self.lock:
            payload = {
                "settings": self.settings,
                "warehouses": [
                    {
                        "id": wh["id"],
                        "name": wh["name"],
                        "created_at": wh["created_at"],
                        "output_dir": wh.get("output_dir") or "",
                        "files": [
                            {k: f.get(k) for k in (
                                "id", "name", "path", "size", "status",
                                "progress", "message", "outputs", "error",
                            )}
                            for f in wh["files"]
                        ],
                    }
                    for wh in self.warehouses
                ],
            }
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATE_PATH)

    # ---- lookups ---------------------------------------------------------
    def warehouse(self, warehouse_id: str) -> dict[str, Any] | None:
        for wh in self.warehouses:
            if wh["id"] == warehouse_id:
                return wh
        return None

    def file_in(self, warehouse: dict[str, Any], file_id: str) -> dict[str, Any] | None:
        for f in warehouse["files"]:
            if f["id"] == file_id:
                return f
        return None

    # ---- public snapshot + broadcast ------------------------------------
    def public_state(self) -> dict[str, Any]:
        with self.lock:
            return {
                "settings": dict(self.settings),
                "warehouses": [
                    {
                        "id": wh["id"],
                        "name": wh["name"],
                        "created_at": wh["created_at"],
                        "output_dir": wh.get("output_dir") or "",
                        "files": [
                            {
                                "id": f["id"],
                                "name": f["name"],
                                "size": f.get("size", 0),
                                "status": f.get("status", "queued"),
                                "progress": round(float(f.get("progress", 0)), 1),
                                "message": f.get("message", ""),
                                "outputs": f.get("outputs", {}),
                                "error": f.get("error", ""),
                            }
                            for f in wh["files"]
                        ],
                    }
                    for wh in self.warehouses
                ],
                "active_warehouse_id": self.active_warehouse_id,
                "running": self.active_warehouse_id is not None,
                "log": self.log[-200:],
                "meta": {
                    "models": list(RECOMMENDED_MODELS),
                    "devices": list(DEVICES),
                    "compute_types": list(COMPUTE_TYPES),
                    "formats": list(SUPPORTED_FORMATS),
                    "themes": list(THEMES),
                    "accents": list(ACCENTS),
                    "default_output_dir": str(DEFAULT_OUTPUT_DIR),
                },
            }

    def broadcast(self, *, force: bool = True) -> None:
        now = time.monotonic()
        if not force and now - self._last_broadcast < 0.3:
            return
        self._last_broadcast = now
        self.hub.publish(json.dumps(self.public_state(), ensure_ascii=False))

    def append_log(self, message: str) -> None:
        line = f"[{datetime.now():%H:%M:%S}] {message}"
        with self.lock:
            self.log.append(line)
            if len(self.log) > 1000:
                self.log = self.log[-1000:]

    # ---- transcription worker -------------------------------------------
    def start_warehouse(self, warehouse_id: str) -> tuple[bool, str]:
        with self.lock:
            if self.active_warehouse_id is not None:
                return False, "כבר רץ תמלול. עצור אותו או חכה שיסתיים."
            warehouse = self.warehouse(warehouse_id)
            if warehouse is None:
                return False, "מחסן לא נמצא."
            pending = [f for f in warehouse["files"] if f.get("status") in ("queued", "error", "stopped")]
            if not pending:
                return False, "אין קבצים בהמתנה לתמלול במחסן הזה."
            self.active_warehouse_id = warehouse_id
            self.stop_requested = False
            for f in pending:
                f["status"] = "queued"
                f["progress"] = 0
                f["message"] = "ממתין בתור"
                f["error"] = ""
        self.append_log(f"מתחיל תמלול ברצף של מחסן '{warehouse['name']}' ({len(pending)} קבצים).")
        self.broadcast()
        thread = threading.Thread(target=self._run_warehouse, args=(warehouse_id,), daemon=True)
        thread.start()
        return True, "התחיל"

    def request_stop(self) -> None:
        with self.lock:
            self.stop_requested = True
        self.append_log("התקבלה בקשת עצירה. נעצור אחרי הקטע הנוכחי.")
        self.broadcast()

    def _run_warehouse(self, warehouse_id: str) -> None:
        try:
            while True:
                with self.lock:
                    if self.stop_requested:
                        break
                    warehouse = self.warehouse(warehouse_id)
                    if warehouse is None:
                        break
                    next_file = next(
                        (f for f in warehouse["files"] if f.get("status") == "queued"),
                        None,
                    )
                if next_file is None:
                    break
                self._transcribe_one(warehouse, next_file)
        finally:
            with self.lock:
                self.active_warehouse_id = None
                self.stop_requested = False
            self.append_log("התור הסתיים.")
            self.broadcast()
            self.save()

    def _effective_output_dir(self, warehouse: dict[str, Any]) -> Path:
        base = warehouse.get("output_dir") or self.settings.get("output_dir") or str(DEFAULT_OUTPUT_DIR)
        return Path(base).expanduser() / _safe_folder(warehouse["name"])

    def _transcribe_one(self, warehouse: dict[str, Any], file_entry: dict[str, Any]) -> None:
        with self.lock:
            file_entry["status"] = "running"
            file_entry["progress"] = 0
            file_entry["message"] = "מתחיל..."
            file_entry["error"] = ""
            settings = dict(self.settings)
        self.append_log(f"מתמלל: {file_entry['name']}")
        self.broadcast()

        def progress(message: str) -> None:
            if self.stop_requested:
                raise StopTranscription()
            with self.lock:
                file_entry["message"] = message[:240]
                pct = _percent_for(message, float(file_entry.get("progress", 0)))
                if pct is not None:
                    file_entry["progress"] = pct
            self.append_log(message)
            self.broadcast(force=False)

        try:
            output_dir = self._effective_output_dir(warehouse)
            paths = transcribe_file(
                input_path=Path(file_entry["path"]),
                output_dir=output_dir,
                model_name=settings.get("model", DEFAULT_MODEL),
                language=settings.get("language", "he"),
                device=settings.get("device", "auto"),
                compute_type=settings.get("compute_type", "auto"),
                beam_size=int(settings.get("beam_size", 5)),
                progress=progress,
                preprocess_audio=bool(settings.get("preprocess_audio", True)),
                formats=settings.get("formats"),
            )
        except StopTranscription:
            with self.lock:
                file_entry["status"] = "stopped"
                file_entry["message"] = "בוטל"
            self.append_log(f"בוטל: {file_entry['name']}")
            self.broadcast()
        except Exception as exc:  # noqa: BLE001 - surface engine errors to the UI
            with self.lock:
                file_entry["status"] = "error"
                file_entry["error"] = str(exc)
                file_entry["message"] = "שגיאה"
            self.append_log(f"שגיאה ב-{file_entry['name']}: {exc}")
            self.broadcast()
        else:
            with self.lock:
                file_entry["status"] = "done"
                file_entry["progress"] = 100
                file_entry["message"] = "הושלם"
                file_entry["outputs"] = {k: str(v) for k, v in paths.items()}
            self.append_log(f"הושלם: {file_entry['name']}")
            self.broadcast()
        self.save()


def _normalize_warehouse(raw: dict[str, Any]) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    for f in raw.get("files", []):
        path = f.get("path", "")
        exists = bool(path) and Path(path).exists()
        status = f.get("status", "queued")
        # Reset transient states from a previous run that was interrupted.
        if status == "running":
            status = "queued"
        if not exists:
            status = "missing"
        files.append(
            {
                "id": f.get("id") or uuid.uuid4().hex,
                "name": f.get("name", Path(path).name if path else "file"),
                "path": path,
                "size": f.get("size", 0),
                "status": status,
                "progress": f.get("progress", 0) if status == "done" else 0,
                "message": f.get("message", "") if status in ("done", "missing") else "",
                "outputs": f.get("outputs", {}) or {},
                "error": "" if status != "missing" else "הקובץ המקורי לא נמצא בדיסק.",
            }
        )
    return {
        "id": raw.get("id") or uuid.uuid4().hex,
        "name": raw.get("name", "מחסן"),
        "created_at": raw.get("created_at") or datetime.now().isoformat(timespec="seconds"),
        "output_dir": raw.get("output_dir") or "",
        "files": files,
    }


# --------------------------------------------------------------------------- #
# Native folder helpers (best effort, desktop only)
# --------------------------------------------------------------------------- #
_PICK_FOLDER_SCRIPT = (
    "import tkinter as tk\n"
    "from tkinter import filedialog\n"
    "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
    "print(filedialog.askdirectory() or '')\n"
)


def pick_folder_dialog(initial: str = "") -> str | None:
    """Open a native folder picker in a child process; return the chosen path."""

    try:
        result = subprocess.run(
            [sys.executable, "-c", _PICK_FOLDER_SCRIPT],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    path = (result.stdout or "").strip().splitlines()
    return path[-1].strip() if path else ""


def open_in_file_manager(path: str) -> bool:
    """Open a folder in the OS file manager (best effort)."""

    target = Path(path).expanduser()
    if not target.exists():
        target = target.parent
    if not target.exists():
        return False
    try:
        if sys.platform == "win32":
            os.startfile(str(target))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return True
    except (OSError, subprocess.SubprocessError):
        return False


# --------------------------------------------------------------------------- #
# HTTP request handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "MoodleHoarderTranscriber/1.0"
    state: AppState  # injected on the server instance

    # Silence default noisy logging.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    # ---- low level helpers ----------------------------------------------
    def _is_local(self) -> bool:
        return self.client_address and self.client_address[0] in ("127.0.0.1", "::1", "localhost")

    def _send_json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message: str, status: int = 400) -> None:
        self._send_json({"ok": False, "error": message}, status=status)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b""

    def _read_json(self) -> dict[str, Any]:
        raw = self._read_body()
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    # ---- routing ---------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        if not self._is_local():
            self._error("forbidden", 403)
            return
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/" or path == "/index.html":
            self._serve_static("index.html")
        elif path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
        elif path == "/api/state":
            self._send_json(self.state.public_state())
        elif path == "/api/events":
            self._serve_events()
        elif path == "/api/download":
            self._serve_download(parse_qs(parsed.query))
        else:
            self._error("not found", 404)

    def do_POST(self) -> None:  # noqa: N802
        if not self._is_local():
            self._error("forbidden", 403)
            return
        path = urlparse(self.path).path
        parts = [p for p in path.split("/") if p]
        try:
            if path == "/api/settings":
                self._update_settings()
            elif path == "/api/warehouses":
                self._create_warehouse()
            elif len(parts) == 4 and parts[:2] == ["api", "warehouses"] and parts[3] == "files":
                self._upload_file(parts[2])
            elif len(parts) == 4 and parts[:2] == ["api", "warehouses"] and parts[3] == "rename":
                self._rename_warehouse(parts[2])
            elif len(parts) == 4 and parts[:2] == ["api", "warehouses"] and parts[3] == "start":
                self._start_warehouse(parts[2])
            elif path == "/api/stop":
                self.state.request_stop()
                self._send_json({"ok": True})
            elif path == "/api/pick-folder":
                self._pick_folder()
            elif path == "/api/open-folder":
                self._open_folder()
            else:
                self._error("not found", 404)
        except BrokenPipeError:
            pass

    def do_DELETE(self) -> None:  # noqa: N802
        if not self._is_local():
            self._error("forbidden", 403)
            return
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) == 3 and parts[:2] == ["api", "warehouses"]:
            self._delete_warehouse(parts[2])
        elif len(parts) == 5 and parts[:2] == ["api", "warehouses"] and parts[3] == "files":
            self._delete_file(parts[2], parts[4])
        else:
            self._error("not found", 404)

    # ---- static + downloads ---------------------------------------------
    def _serve_static(self, rel: str) -> None:
        rel = rel.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR not in target.parents or not target.is_file():
            self._error("not found", 404)
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_download(self, query: dict[str, list[str]]) -> None:
        wanted = (query.get("path") or [""])[0]
        if not wanted:
            self._error("missing path", 400)
            return
        target = Path(unquote(wanted)).expanduser().resolve()
        allowed = set()
        for wh in self.state.warehouses:
            for f in wh["files"]:
                for p in (f.get("outputs") or {}).values():
                    allowed.add(str(Path(p).resolve()))
        if str(target) not in allowed or not target.is_file():
            self._error("forbidden", 403)
            return
        data = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Disposition", f'attachment; filename="{target.name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_events(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = self.state.hub.subscribe()
        try:
            self.wfile.write(f"data: {json.dumps(self.state.public_state(), ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=15)
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.state.hub.unsubscribe(q)

    # ---- settings + warehouses ------------------------------------------
    def _update_settings(self) -> None:
        data = self._read_json()
        with self.state.lock:
            settings = self.state.settings
            if "output_dir" in data:
                settings["output_dir"] = str(data["output_dir"] or "").strip()
            if "formats" in data and isinstance(data["formats"], list):
                fmts = [f for f in data["formats"] if f in SUPPORTED_FORMATS]
                settings["formats"] = fmts or list(SUPPORTED_FORMATS)
            if data.get("model") in RECOMMENDED_MODELS:
                settings["model"] = data["model"]
            if "language" in data:
                settings["language"] = str(data["language"]).strip()
            if data.get("device") in DEVICES:
                settings["device"] = data["device"]
            if data.get("compute_type") in COMPUTE_TYPES:
                settings["compute_type"] = data["compute_type"]
            if "beam_size" in data:
                try:
                    settings["beam_size"] = max(1, min(10, int(data["beam_size"])))
                except (TypeError, ValueError):
                    pass
            if "preprocess_audio" in data:
                settings["preprocess_audio"] = bool(data["preprocess_audio"])
            if data.get("theme") in THEMES:
                settings["theme"] = data["theme"]
            if data.get("accent") in ACCENTS:
                settings["accent"] = data["accent"]
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True, "settings": self.state.settings})

    def _create_warehouse(self) -> None:
        data = self._read_json()
        name = str(data.get("name", "")).strip() or f"מחסן {len(self.state.warehouses) + 1}"
        warehouse = {
            "id": uuid.uuid4().hex,
            "name": name,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "output_dir": "",
            "files": [],
        }
        with self.state.lock:
            self.state.warehouses.append(warehouse)
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True, "warehouse": warehouse})

    def _rename_warehouse(self, warehouse_id: str) -> None:
        data = self._read_json()
        with self.state.lock:
            warehouse = self.state.warehouse(warehouse_id)
            if warehouse is None:
                self._error("warehouse not found", 404)
                return
            if "name" in data and str(data["name"]).strip():
                warehouse["name"] = str(data["name"]).strip()
            if "output_dir" in data:
                warehouse["output_dir"] = str(data["output_dir"] or "").strip()
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True})

    def _delete_warehouse(self, warehouse_id: str) -> None:
        with self.state.lock:
            if self.state.active_warehouse_id == warehouse_id:
                self._error("לא ניתן למחוק מחסן בזמן שהוא מתמלל.", 409)
                return
            warehouse = self.state.warehouse(warehouse_id)
            if warehouse is None:
                self._error("warehouse not found", 404)
                return
            self.state.warehouses = [w for w in self.state.warehouses if w["id"] != warehouse_id]
        shutil.rmtree(WORKSPACES_DIR / warehouse_id, ignore_errors=True)
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True})

    def _upload_file(self, warehouse_id: str) -> None:
        with self.state.lock:
            warehouse = self.state.warehouse(warehouse_id)
            if warehouse is None:
                self._error("warehouse not found", 404)
                return
        name = _safe_filename(self.headers.get("X-Filename", ""))
        body = self._read_body()
        if not body:
            self._error("empty file", 400)
            return
        file_id = uuid.uuid4().hex
        dest_dir = WORKSPACES_DIR / warehouse_id / file_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        dest.write_bytes(body)
        entry = {
            "id": file_id,
            "name": name,
            "path": str(dest),
            "size": len(body),
            "status": "queued",
            "progress": 0,
            "message": "ממתין",
            "outputs": {},
            "error": "",
        }
        with self.state.lock:
            warehouse["files"].append(entry)
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True, "file": entry})

    def _delete_file(self, warehouse_id: str, file_id: str) -> None:
        with self.state.lock:
            warehouse = self.state.warehouse(warehouse_id)
            if warehouse is None:
                self._error("warehouse not found", 404)
                return
            entry = self.state.file_in(warehouse, file_id)
            if entry and entry.get("status") == "running":
                self._error("לא ניתן למחוק קובץ שמתמלל כרגע.", 409)
                return
            warehouse["files"] = [f for f in warehouse["files"] if f["id"] != file_id]
        shutil.rmtree(WORKSPACES_DIR / warehouse_id / file_id, ignore_errors=True)
        self.state.save()
        self.state.broadcast()
        self._send_json({"ok": True})

    def _start_warehouse(self, warehouse_id: str) -> None:
        ok, message = self.state.start_warehouse(warehouse_id)
        self._send_json({"ok": ok, "message": message}, status=200 if ok else 409)

    # ---- native helpers --------------------------------------------------
    def _pick_folder(self) -> None:
        data = self._read_json()
        path = pick_folder_dialog(str(data.get("initial", "")))
        if path is None:
            self._send_json({"ok": False, "error": "בורר התיקיות לא זמין בסביבה הזו."})
            return
        self._send_json({"ok": True, "path": path})

    def _open_folder(self) -> None:
        data = self._read_json()
        ok = open_in_file_manager(str(data.get("path", "")))
        self._send_json({"ok": ok})


# --------------------------------------------------------------------------- #
# Server bootstrap
# --------------------------------------------------------------------------- #
def create_server(host: str = "127.0.0.1", port: int = 8765) -> tuple[ThreadingHTTPServer, AppState]:
    state = AppState.load()
    handler = type("BoundHandler", (Handler,), {"state": state})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    return httpd, state


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run the Moodle Hoarder Transcriber web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically")
    args = parser.parse_args(argv)

    httpd, _ = create_server(args.host, args.port)
    url = f"http://{args.host}:{args.port}/"
    print(f"Moodle Hoarder Transcriber UI: {url}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
