"""Copy PNG images to the system clipboard.

Used when the webview's own Clipboard API is unavailable. Windows gets the
registered "PNG" format, macOS the PNG pasteboard type via AppleScript, Linux
``image/png`` via wl-copy (Wayland) or xclip (X11).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import tempfile

logger = logging.getLogger(__name__)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def copy_png(png: bytes) -> bool:
    """Put ``png`` on the clipboard; returns False when no method works."""
    if not png.startswith(PNG_SIGNATURE):
        return False
    try:
        if sys.platform == "win32":
            return _copy_windows(png)
        if sys.platform == "darwin":
            return _copy_macos(png)
        return _copy_linux(png)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Copying PNG to the clipboard failed: %s", exc)
        return False


def _copy_windows(png: bytes) -> bool:
    if sys.platform != "win32":  # also lets mypy skip this body elsewhere
        return False
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.CloseClipboard.restype = wintypes.BOOL
    user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    user32.RegisterClipboardFormatW.restype = wintypes.UINT
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]

    gmem_moveable = 0x0002
    png_format = user32.RegisterClipboardFormatW("PNG")
    if not png_format:
        return False
    handle = kernel32.GlobalAlloc(gmem_moveable, len(png))
    if not handle:
        return False
    pointer = kernel32.GlobalLock(handle)
    if not pointer:
        kernel32.GlobalFree(handle)
        return False
    ctypes.memmove(pointer, png, len(png))
    kernel32.GlobalUnlock(handle)

    if not user32.OpenClipboard(None):
        kernel32.GlobalFree(handle)
        return False
    try:
        user32.EmptyClipboard()
        # On success the clipboard owns the memory; free it only on failure.
        if not user32.SetClipboardData(png_format, handle):
            kernel32.GlobalFree(handle)
            return False
        return True
    finally:
        user32.CloseClipboard()


def _copy_macos(png: bytes) -> bool:
    fd, path = tempfile.mkstemp(suffix=".png")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(png)
        script = (
            "set the clipboard to "
            f'(read (POSIX file "{path}") as «class PNGf»)'
        )
        result = subprocess.run(
            ["osascript", "-e", script], capture_output=True, timeout=10
        )
        return result.returncode == 0
    finally:
        os.unlink(path)


def _copy_linux(png: bytes) -> bool:
    commands = []
    if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy"):
        commands.append(["wl-copy", "--type", "image/png"])
    if shutil.which("xclip"):
        commands.append(
            ["xclip", "-selection", "clipboard", "-t", "image/png", "-i"]
        )
    for command in commands:
        result = subprocess.run(
            command, input=png, capture_output=True, timeout=10
        )
        if result.returncode == 0:
            return True
    return False
