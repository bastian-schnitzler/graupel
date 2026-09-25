"""Windows-specific integration helpers for the graupel application.

This module is imported only at runtime; all public functions guard against
non-Windows platforms internally so callers need not duplicate that check.

Installed-vs-source detection
------------------------------
We consider the package to be *installed* (not a source checkout) when
``graupel.__spec__.origin`` (the path to ``graupel/__init__.py``) resides under
a directory whose name is ``site-packages``.  Source checkouts have their
``graupel`` package directly inside the repository tree, not under any
``site-packages``.

Launcher discovery
-------------------
``find_graupel_launcher()`` searches for the GUI-script entry-point executable
in decreasing order of reliability:

1. ``importlib.metadata`` entry_points for the "graupel" console/gui-scripts
   group → resolves the actual script path that was installed.
2. A ``graupel.exe`` / ``graupel`` binary adjacent to ``sys.executable`` (works
   for standard ``pip install`` into a venv).
3. ``shutil.which("graupel")`` as a last resort.

Shortcut management
--------------------
``ensure_start_menu_shortcut()`` uses a small inline PowerShell script to
create or update ``%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\graupel.lnk``
via the ``WScript.Shell`` COM object — no extra dependencies required.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .config import APP_NAME, APP_DESCRIPTION, WINDOWS_APP_ID, SHORTCUT_NAME

_log = logging.getLogger(__name__)

# PowerShell is a console application. Graupel is launched through a Windows
# GUI entry point, so explicitly suppress the child console window.
_POWERSHELL_CREATION_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)

APP_EXE = APP_NAME + ".exe"
APP_ICO = "graupel.ico"
SHORTCUT_DESCRIPTION = APP_DESCRIPTION
# The AppUserModelID groups our process, window, and Start Menu shortcut
# into one Windows desktop identity so the taskbar shows the graupel icon
# instead of the Python/pipx launcher icon.


def set_app_user_model_id() -> None:
    """Set the Windows AppUserModelID for the current process."""
    if sys.platform != "win32":
        return

    try:
        import ctypes  # noqa: PLC0415

        set_app_id = (
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID
        )
        set_app_id.argtypes = [ctypes.c_wchar_p]
        set_app_id.restype = ctypes.c_long

        result = set_app_id(WINDOWS_APP_ID)

        if result != 0:
            _log.warning(
                "SetCurrentProcessExplicitAppUserModelID failed: HRESULT=%s",
                result,
            )

    except Exception as exc:  # noqa: BLE001
        _log.debug("Could not set AppUserModelID: %s", exc)


# ---------------------------------------------------------------------------
# Installed-vs-source detection
# ---------------------------------------------------------------------------


def is_installed_package() -> bool:
    """Return ``True`` when running from an installed package.

    Heuristic: the ``graupel`` package's ``__spec__.origin`` (its
    ``__init__.py``) must live under a ``site-packages`` directory.
    Source-checkout runs have the package directly in the repository tree.
    """
    try:
        import graupel  # noqa: PLC0415

        spec = graupel.__spec__
        if spec is None or spec.origin is None:
            return False
        origin = str(spec.origin)
        # Split on both path separators so this works on Windows (\ or /) and
        # when a Windows-style path is evaluated on Linux (e.g. in tests).
        import re  # noqa: PLC0415

        parts = re.split(r"[/\\]", origin)
        return "site-packages" in parts
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Launcher discovery
# ---------------------------------------------------------------------------


def find_graupel_launcher() -> Path | None:
    """Return the path to the installed ``graupel`` GUI launcher executable.

    Returns ``None`` when nothing suitable can be found.  Never returns
    a path to ``python.exe`` / ``pythonw.exe``.
    """
    # 1. Ask importlib.metadata for the entry-point script.
    try:
        from importlib.metadata import entry_points  # noqa: PLC0415

        eps = entry_points(group="gui_scripts") or []
        for ep in eps:
            if ep.name == APP_NAME and ep.dist is not None:
                # The installed script lives next to sys.executable in venvs,
                # or in a tool-specific bin dir for uv/pipx.
                scripts_dir = Path(sys.executable).parent
                for name in (
                    APP_EXE,
                    APP_NAME,
                ):
                    candidate = scripts_dir / name
                    if candidate.is_file():
                        return candidate
        # Also try console_scripts in case pyproject had it there.
        eps2 = entry_points(group="console_scripts") or []
        for ep in eps2:
            if ep.name == APP_NAME and ep.dist is not None:
                scripts_dir = Path(sys.executable).parent
                for name in (APP_EXE, APP_NAME):
                    candidate = scripts_dir / name
                    if candidate.is_file():
                        return candidate
    except Exception:
        pass

    # 2. Look next to sys.executable (standard venv layout).
    scripts_dir = Path(sys.executable).parent
    for name in (APP_EXE, APP_NAME):
        candidate = scripts_dir / name
        if candidate.is_file():
            return candidate

    # 3. PATH lookup as a last resort.
    found = shutil.which(APP_NAME)
    if found:
        p = Path(found)
        # Reject if it resolves to a python interpreter.
        if "python" not in p.name.lower():
            return p

    return None


# ---------------------------------------------------------------------------
# Shortcut management (Windows only)
# ---------------------------------------------------------------------------


def _shortcut_path() -> Path:
    appdata = Path.home() / "AppData" / "Roaming"
    # Use %APPDATA% for redirected roaming profiles.
    appdata_env = os.environ.get("APPDATA")
    if appdata_env:
        appdata = Path(appdata_env)
    return (
        appdata
        / "Microsoft"
        / "Windows"
        / "Start Menu"
        / "Programs"
        / SHORTCUT_NAME
    )


def _read_shortcut_properties(lnk: Path) -> dict[str, str]:
    """Read all functional shortcut properties without line/empty-value loss."""
    escaped_lnk = str(lnk).replace("'", "''")
    escaped_parent = str(lnk.parent).replace("'", "''")
    escaped_name = lnk.name.replace("'", "''")
    ps = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('{escaped_lnk}')
$shell = New-Object -ComObject Shell.Application
$item = $shell.Namespace('{escaped_parent}').ParseName('{escaped_name}')
@{{TargetPath=$lnk.TargetPath; Arguments=$lnk.Arguments;
WorkingDirectory=$lnk.WorkingDirectory; IconLocation=$lnk.IconLocation;
Description=$lnk.Description; AppUserModelID=$item.ExtendedProperty('System.AppUserModel.ID')}} | ConvertTo-Json -Compress
"""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=True,
            creationflags=_POWERSHELL_CREATION_FLAGS,
        )
        properties = json.loads(result.stdout)
        return properties if isinstance(properties, dict) else {}
    except Exception:
        return {}


def _shortcut_icon_path() -> Path:
    """Keep a content-addressed icon after zip extraction or pipx reinstall.

    A changed icon gets a new filename, also avoiding Windows' stale icon cache.
    """
    from .resources import icon_resource

    data = icon_resource(APP_ICO).read_bytes()
    local = os.environ.get("LOCALAPPDATA")
    root = Path(local) if local else Path.home() / "AppData" / "Local"
    path = (
        root
        / APP_NAME
        / "icons"
        / (APP_NAME + "-" + hashlib.sha256(data).hexdigest()[:16] + ".ico")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file() or path.read_bytes() != data:
        path.write_bytes(data)
    return path


def _remove_legacy_shortcuts(lnk: Path, launcher: Path) -> None:
    """Remove only owned pre-Graupel links after Graupel is available."""
    legacy_identities = (
        ("Meteo.lnk", {"meteo.exe", "meteo"}, "Meteo — Meteogram Forecast App"),
        (
            "Cumulus.lnk",
            {"cumulus.exe", "cumulus"},
            "Cumulus — Meteogram Forecast App",
        ),
    )
    launcher_target = str(launcher).replace("\\", "/")
    for filename, executable_names, expected_description in legacy_identities:
        legacy = lnk.with_name(filename)
        if not legacy.is_file():
            continue
        properties = _read_shortcut_properties(legacy)
        target = properties.get("TargetPath", "").replace("\\", "/")
        name = target.rsplit("/", 1)[-1].lower()
        description = properties.get("Description", "")
        if target == launcher_target or (
            name in executable_names and description == expected_description
        ):
            legacy.unlink()


def _write_shortcut(lnk: Path, target: Path, icon: Path) -> None:
    """Create or overwrite a .lnk shortcut via PowerShell WScript.Shell."""

    t = str(target).replace("'", "''")
    i = str(icon).replace("'", "''")
    l = str(lnk).replace("'", "''")
    working_dir = str(target.parent).replace("'", "''")

    ps_create = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('{l}')
$lnk.TargetPath = '{t}'
$lnk.Arguments = ''
$lnk.WorkingDirectory = '{working_dir}'
$lnk.IconLocation = '{i},0'
$lnk.Description = '{APP_DESCRIPTION}'
$lnk.Save()
"""
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_create],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
        creationflags=_POWERSHELL_CREATION_FLAGS,
    )

    # Step 2: stamp the AppUserModelID on the shortcut's property store.
    # This tells Windows to group this shortcut with our process and taskbar
    # button under one identity, so "Pin to Taskbar" works correctly too.
    lnk_escaped = str(lnk).replace("'", "''")
    app_id_escaped = WINDOWS_APP_ID.replace("'", "''")
    ps_appid = r"""
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class LnkAppId {
    static readonly Guid IID_IPropertyStore =
        new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    // System.AppUserModel.ID  (PKEY_AppUserModel_ID)
    static readonly Guid FMTID_AppUserModel =
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    const uint PID_APPUSERMODEL_ID = 5;
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(
        string pszPath, IntPtr pbc, uint grfFlags,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        out IPropertyStore ppv);
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        void GetCount(out uint c);
        void GetAt(uint i, out PropertyKey k);
        void GetValue(ref PropertyKey k, out PropVariant v);
        void SetValue(ref PropertyKey k, ref PropVariant v);
        void Commit();
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Sequential)]
    public struct PropVariant {
        public ushort vt, reserved1, reserved2, reserved3;
        public IntPtr pszVal, unused;
    }
    public static void SetId(string lnkPath, string appId) {
        IPropertyStore ps;
        // GPS_READWRITE = 2
        int hr = SHGetPropertyStoreFromParsingName(
            lnkPath, IntPtr.Zero, 2, IID_IPropertyStore, out ps);
        Marshal.ThrowExceptionForHR(hr);
        var key = new PropertyKey {
            fmtid = FMTID_AppUserModel, pid = PID_APPUSERMODEL_ID };
        var pv = new PropVariant {
            vt = 31 /* VT_LPWSTR */,
            pszVal = Marshal.StringToCoTaskMemUni(appId) };
        ps.SetValue(ref key, ref pv);
        ps.Commit();
        Marshal.ReleaseComObject(ps);
        Marshal.FreeCoTaskMem(pv.pszVal);
    }
}
'@
[LnkAppId]::SetId('lnk_escaped_placeholder', 'appid_placeholder')
""".replace("lnk_escaped_placeholder", lnk_escaped).replace(
        "appid_placeholder", app_id_escaped
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_appid],
        capture_output=True,
        text=True,
        timeout=20,
        creationflags=_POWERSHELL_CREATION_FLAGS,
        # The basic shortcut remains usable if identity stamping fails.
    )
    if result.returncode != 0:
        _log.warning(
            "Could not stamp shortcut AppUserModelID: %s", result.stderr
        )


def ensure_start_menu_shortcut() -> None:
    """Idempotently create or update the Windows Start Menu shortcut.

    Guards:
    - Only runs on Windows.
    - Only runs when the package is installed (not a source checkout).
    - Errors are logged but never re-raised so the application still starts.
    """
    if sys.platform != "win32":
        return

    if not is_installed_package():
        _log.debug(
            "Skipping Start Menu shortcut: running from source checkout."
        )
        return

    try:
        launcher = find_graupel_launcher()
        if launcher is None:
            _log.warning(
                "Could not locate the installed graupel launcher; "
                "skipping Start Menu shortcut."
            )
            return

        ico = _shortcut_icon_path()
        lnk = _shortcut_path()
        expected = {
            "TargetPath": str(launcher),
            "Arguments": "",
            "WorkingDirectory": str(launcher.parent),
            "IconLocation": f"{ico},0",
            "Description": APP_DESCRIPTION,
            "AppUserModelID": WINDOWS_APP_ID,
        }
        if lnk.is_file() and _read_shortcut_properties(lnk) == expected:
            _remove_legacy_shortcuts(lnk, launcher)
            _log.debug("Start Menu shortcut is already up-to-date.")
            return

        lnk.parent.mkdir(parents=True, exist_ok=True)
        _write_shortcut(lnk, launcher, ico)
        _remove_legacy_shortcuts(lnk, launcher)

    except Exception as exc:
        _log.warning("Failed to create/update Start Menu shortcut: %s", exc)
