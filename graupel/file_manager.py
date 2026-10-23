"""Open a folder in the system file manager (Config view, #197).

Windows uses ``os.startfile`` (Explorer), macOS ``open``, Linux and other
Unix systems ``xdg-open``. Errors are returned as text, never raised.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def open_folder(folder: Path) -> Optional[str]:
    """Open ``folder``; returns None on success, else a short error."""
    if not folder.is_dir():
        return f"{folder} does not exist"
    try:
        if sys.platform == "win32":
            os.startfile(str(folder))  # type: ignore[attr-defined]
            return None
        command = "open" if sys.platform == "darwin" else "xdg-open"
        executable = shutil.which(command)
        if executable is None:
            return f"No file manager found ({command} is missing)"
        # The file manager outlives the call; never wait for it.
        subprocess.Popen(
            [executable, str(folder)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return None
    except OSError as exc:
        logger.warning("Opening %s in a file manager failed: %s", folder, exc)
        return f"Cannot open {folder}: {exc}"
