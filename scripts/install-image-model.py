"""Bootstrap wrapper for the shared pinned ACS image installer."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/"engines/install-image.py"),run_name="__main__")
