"""Small desktop GUI for local recording transcription."""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .engine import DEFAULT_MODEL, RECOMMENDED_MODELS, transcribe_file

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
except ImportError:  # Drag-and-drop is optional; file picker still works.
    DND_FILES = None
    TkinterDnD = None


class TranscriberApp:
    def __init__(self) -> None:
        root_cls = TkinterDnD.Tk if TkinterDnD else tk.Tk
        self.root = root_cls()
        self.root.title("Moodle Hoarder Transcriber")
        self.root.geometry("760x560")
        self.root.minsize(680, 480)

        self.input_path = tk.StringVar()
        self.output_dir = tk.StringVar()
        self.model = tk.StringVar(value=DEFAULT_MODEL)
        self.device = tk.StringVar(value="cuda")
        self.compute_type = tk.StringVar(value="float16")
        self.language = tk.StringVar(value="he")
        self.status = tk.StringVar(value="בחר קובץ הקלטה או גרור אותו לחלון")
        self._messages: queue.Queue[str] = queue.Queue()
        self._worker: threading.Thread | None = None

        self._build_ui()
        self.root.after(150, self._drain_messages)

    def _build_ui(self) -> None:
        frame = ttk.Frame(self.root, padding=18)
        frame.pack(fill="both", expand=True)

        title = ttk.Label(frame, text="Moodle Hoarder Transcriber", font=("Segoe UI", 18, "bold"))
        title.pack(anchor="w")
        subtitle = ttk.Label(
            frame,
            text="תמלול מקומי להקלטות קורסים בעברית · פלט TXT/SRT/VTT/JSON עם timestamps",
            wraplength=700,
        )
        subtitle.pack(anchor="w", pady=(4, 16))

        drop = ttk.LabelFrame(frame, text="קובץ הקלטה")
        drop.pack(fill="x", pady=(0, 12))
        drop_inner = ttk.Frame(drop, padding=12)
        drop_inner.pack(fill="x")
        self.input_entry = ttk.Entry(drop_inner, textvariable=self.input_path)
        self.input_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(drop_inner, text="בחר קובץ", command=self._choose_file).pack(side="left", padx=(8, 0))
        if DND_FILES:
            self.input_entry.drop_target_register(DND_FILES)
            self.input_entry.dnd_bind("<<Drop>>", self._on_drop)
            drop.configure(text="קובץ הקלטה (אפשר גם Drag & Drop)")

        options = ttk.LabelFrame(frame, text="הגדרות")
        options.pack(fill="x", pady=(0, 12))
        grid = ttk.Frame(options, padding=12)
        grid.pack(fill="x")

        ttk.Label(grid, text="מודל").grid(row=0, column=0, sticky="w")
        ttk.Combobox(grid, textvariable=self.model, values=RECOMMENDED_MODELS, state="readonly").grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Label(grid, text="שפה").grid(row=0, column=2, sticky="w")
        ttk.Entry(grid, textvariable=self.language, width=8).grid(row=0, column=3, sticky="w", padx=8)

        ttk.Label(grid, text="Device").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(grid, textvariable=self.device, values=["cuda", "auto", "cpu"], state="readonly").grid(row=1, column=1, sticky="ew", padx=8, pady=(8, 0))
        ttk.Label(grid, text="Compute").grid(row=1, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(
            grid,
            textvariable=self.compute_type,
            values=["float16", "int8_float16", "int8", "auto", "float32"],
            state="readonly",
        ).grid(row=1, column=3, sticky="ew", padx=8, pady=(8, 0))
        grid.columnconfigure(1, weight=1)

        out = ttk.LabelFrame(frame, text="תיקיית פלט")
        out.pack(fill="x", pady=(0, 12))
        out_inner = ttk.Frame(out, padding=12)
        out_inner.pack(fill="x")
        ttk.Entry(out_inner, textvariable=self.output_dir).pack(side="left", fill="x", expand=True)
        ttk.Button(out_inner, text="בחר תיקייה", command=self._choose_output_dir).pack(side="left", padx=(8, 0))

        action = ttk.Frame(frame)
        action.pack(fill="x", pady=(0, 12))
        self.start_button = ttk.Button(action, text="התחל תמלול", command=self._start)
        self.start_button.pack(side="left")
        ttk.Label(action, textvariable=self.status).pack(side="left", padx=12)

        log_frame = ttk.LabelFrame(frame, text="לוג")
        log_frame.pack(fill="both", expand=True)
        self.log = tk.Text(log_frame, height=12, wrap="word")
        self.log.pack(fill="both", expand=True, padx=8, pady=8)

    def _choose_file(self) -> None:
        path = filedialog.askopenfilename(
            title="בחר הקלטה",
            filetypes=[("Media files", "*.mp4 *.mp3 *.m4a *.wav *.webm *.mov *.mkv"), ("All files", "*.*")],
        )
        if path:
            self.input_path.set(path)
            if not self.output_dir.get():
                self.output_dir.set(str(Path(path).parent / "transcripts"))

    def _choose_output_dir(self) -> None:
        path = filedialog.askdirectory(title="בחר תיקיית פלט")
        if path:
            self.output_dir.set(path)

    def _on_drop(self, event: object) -> None:
        data = getattr(event, "data", "").strip()
        if data.startswith("{") and data.endswith("}"):
            data = data[1:-1]
        if data:
            self.input_path.set(data)
            if not self.output_dir.get():
                self.output_dir.set(str(Path(data).parent / "transcripts"))

    def _start(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        if not self.input_path.get():
            messagebox.showerror("חסר קובץ", "בחר או גרור קובץ הקלטה קודם.")
            return
        self.start_button.configure(state="disabled")
        self.status.set("מתמלל...")
        self.log.delete("1.0", "end")
        self._worker = threading.Thread(target=self._run_transcription, daemon=True)
        self._worker.start()

    def _run_transcription(self) -> None:
        try:
            paths = transcribe_file(
                input_path=Path(self.input_path.get()),
                output_dir=Path(self.output_dir.get()) if self.output_dir.get() else None,
                model_name=self.model.get(),
                language=self.language.get(),
                device=self.device.get(),
                compute_type=self.compute_type.get(),
                progress=self._messages.put,
            )
            self._messages.put("DONE:" + "\n".join(f"{key}: {value}" for key, value in paths.items()))
        except Exception as exc:  # noqa: BLE001 - surface GUI errors to the user
            self._messages.put("ERROR:" + str(exc))

    def _drain_messages(self) -> None:
        while True:
            try:
                message = self._messages.get_nowait()
            except queue.Empty:
                break
            if message.startswith("DONE:"):
                self.start_button.configure(state="normal")
                self.status.set("הסתיים")
                self.log.insert("end", "\n" + message[5:] + "\n")
                messagebox.showinfo("התמלול הסתיים", message[5:])
            elif message.startswith("ERROR:"):
                self.start_button.configure(state="normal")
                self.status.set("נכשל")
                self.log.insert("end", "\nשגיאה: " + message[6:] + "\n")
                messagebox.showerror("שגיאה", message[6:])
            else:
                self.log.insert("end", message + "\n")
                self.log.see("end")
        self.root.after(150, self._drain_messages)

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    TranscriberApp().run()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
