import importlib

for module_name in ("av.audio", "av.audio.resampler", "av.audio.frame"):
    try:
        importlib.import_module(module_name)
    except ImportError:
        break

from mh_transcriber.gui import main

if __name__ == "__main__":
    raise SystemExit(main())
