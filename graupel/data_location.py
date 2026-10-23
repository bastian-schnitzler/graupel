"""Location of the Graupel data folder.

The data folder holds the SQLite database (``meteogram.db``) and the log
files. Its location is stored *outside* the data folder, in the platform's
native settings store, so that the folder can be moved:

========  ===============================================================
Windows   Registry ``HKEY_CURRENT_USER\\Software\\Graupel``, value
          ``DataDir`` (``REG_SZ``), via ``winreg``.
macOS     User defaults domain ``io.github.bastian-schnitzler.graupel``,
          key ``DataDir``, via ``defaults read/write/delete``. The plist is
          never edited directly: ``cfprefsd`` caches it.
Linux     ``$XDG_CONFIG_HOME/graupel/config.toml`` (default
          ``~/.config/graupel/config.toml``), key ``data_dir``.
========  ===============================================================

A missing or unusable pointer (not set, folder gone, not writable, no
database) falls back to the default data folder with a logged warning; it
never raises.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, List, Optional, Protocol

from .config import APP_NAME

logger = logging.getLogger(__name__)

DATABASE_NAME = "meteogram.db"
WINDOWS_REGISTRY_KEY = r"Software\Graupel"
WINDOWS_REGISTRY_VALUE = "DataDir"
MACOS_DEFAULTS_DOMAIN = "io.github.bastian-schnitzler.graupel"
MACOS_DEFAULTS_KEY = "DataDir"
LINUX_CONFIG_KEY = "data_dir"


class DataDirBackend(Protocol):
    def read(self) -> Optional[str]: ...

    def write(self, path: str) -> None: ...

    def clear(self) -> None: ...


def _winreg() -> Any:
    # Imported lazily and untyped: the module exists only on Windows.
    import importlib

    return importlib.import_module("winreg")


class WindowsRegistryBackend:
    def read(self) -> Optional[str]:
        winreg = _winreg()

        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, WINDOWS_REGISTRY_KEY
            ) as key:
                value, kind = winreg.QueryValueEx(key, WINDOWS_REGISTRY_VALUE)
        except FileNotFoundError:
            return None
        if kind not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
            raise ValueError(f"DataDir has registry type {kind}, not REG_SZ")
        if kind == winreg.REG_EXPAND_SZ:
            return os.path.expandvars(str(value))
        return str(value)

    def write(self, path: str) -> None:
        winreg = _winreg()

        with winreg.CreateKeyEx(
            winreg.HKEY_CURRENT_USER, WINDOWS_REGISTRY_KEY, 0,
            winreg.KEY_SET_VALUE,
        ) as key:
            winreg.SetValueEx(
                key, WINDOWS_REGISTRY_VALUE, 0, winreg.REG_SZ, path
            )

    def clear(self) -> None:
        winreg = _winreg()

        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, WINDOWS_REGISTRY_KEY, 0,
                winreg.KEY_SET_VALUE,
            ) as key:
                winreg.DeleteValue(key, WINDOWS_REGISTRY_VALUE)
        except FileNotFoundError:
            pass


class MacDefaultsBackend:
    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["defaults", *args],
            capture_output=True,
            text=True,
            timeout=10,
        )

    def read(self) -> Optional[str]:
        result = self._run("read", MACOS_DEFAULTS_DOMAIN, MACOS_DEFAULTS_KEY)
        if result.returncode != 0:
            # `defaults read` fails when the domain or key does not exist.
            return None
        # `defaults` terminates the printed value with a newline.
        return result.stdout.rstrip("\n")

    def write(self, path: str) -> None:
        result = self._run(
            "write", MACOS_DEFAULTS_DOMAIN, MACOS_DEFAULTS_KEY, "-string", path
        )
        if result.returncode != 0:
            raise OSError(f"defaults write failed: {result.stderr.strip()}")

    def clear(self) -> None:
        # Fails harmlessly when the key does not exist.
        self._run("delete", MACOS_DEFAULTS_DOMAIN, MACOS_DEFAULTS_KEY)


_TOML_LINE = re.compile(rf"^\s*{LINUX_CONFIG_KEY}\s*=")


class LinuxConfigFileBackend:
    @property
    def path(self) -> Path:
        base = os.environ.get("XDG_CONFIG_HOME")
        root = Path(base) if base else Path.home() / ".config"
        return root / APP_NAME / "config.toml"

    def read(self) -> Optional[str]:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            import tomllib
        except ModuleNotFoundError:  # Python 3.10
            for line in text.splitlines():
                if _TOML_LINE.match(line):
                    value = json.loads(line.split("=", 1)[1].strip())
                    if not isinstance(value, str):
                        raise ValueError(f"{LINUX_CONFIG_KEY} is not a string")
                    return value
            return None
        value = tomllib.loads(text).get(LINUX_CONFIG_KEY)
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError(f"{LINUX_CONFIG_KEY} is not a string")
        return value

    def _write_lines(self, lines: List[str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            "".join(line + "\n" for line in lines), encoding="utf-8"
        )
        temporary.replace(self.path)

    def _other_lines(self) -> List[str]:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        return [line for line in text.splitlines() if not _TOML_LINE.match(line)]

    def write(self, path: str) -> None:
        # A JSON string with ASCII escapes is a valid TOML basic string.
        # The key goes first so it never lands inside a [table].
        self._write_lines(
            [f"{LINUX_CONFIG_KEY} = {json.dumps(path)}"] + self._other_lines()
        )

    def clear(self) -> None:
        if not self.path.exists():
            return
        lines = self._other_lines()
        if any(line.strip() for line in lines):
            self._write_lines(lines)
        else:
            self.path.unlink()


def _backend() -> DataDirBackend:
    if sys.platform == "win32":
        return WindowsRegistryBackend()
    if sys.platform == "darwin":
        return MacDefaultsBackend()
    return LinuxConfigFileBackend()


def default_data_dir() -> Path:
    """`%LOCALAPPDATA%\\graupel` on Windows, `~/.graupel` elsewhere."""
    if sys.platform == "win32":
        # Keep SQLite on the local Windows filesystem, including WSL runs.
        local = os.environ.get("LOCALAPPDATA")
        root = Path(local) if local else Path.home() / "AppData" / "Local"
        return root / APP_NAME
    return Path.home() / ("." + APP_NAME)


def read_data_dir() -> Optional[Path]:
    """Return the stored data-folder pointer, or None (never raises)."""
    try:
        value = _backend().read()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read the data folder setting: %s", exc)
        return None
    if value is None or not value.strip():
        return None
    return Path(value.strip())


def write_data_dir(path: Path | str) -> None:
    _backend().write(str(Path(path)))


def clear_data_dir() -> None:
    _backend().clear()


def check_writable(folder: Path) -> Optional[str]:
    """Return a reason why `folder` cannot hold the data, or None."""
    if not folder.is_absolute():
        return f"{folder} is not an absolute path"
    if not folder.is_dir():
        return f"{folder} is not a folder"
    probe = folder / f".graupel-write-test-{uuid.uuid4().hex}"
    try:
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as exc:
        return f"{folder} is not writable ({exc})"
    return None


def resolve_data_dir(warnings: Optional[List[str]] = None) -> Path:
    """Return the data folder to use.

    The stored pointer wins when its folder exists, is writable and holds the
    database. Otherwise the default folder is returned and the reason is
    logged (and appended to `warnings` so it can be re-logged once file
    logging is configured).
    """
    stored = read_data_dir()
    if stored is None:
        return default_data_dir()
    reason = check_writable(stored)
    if reason is None and not (stored / DATABASE_NAME).is_file():
        reason = f"{stored} contains no {DATABASE_NAME}"
    if reason is None:
        return stored
    message = (
        f"Stored data folder is unusable, using the default "
        f"{default_data_dir()}: {reason}"
    )
    logger.warning(message)
    if warnings is not None:
        warnings.append(message)
    return default_data_dir()


def copy_data_parts(
    source: Path,
    destination: Path,
    configuration: bool = True,
    meteogram: bool = True,
) -> None:
    """Create a fresh database at `destination` with the chosen parts.

    The new database gets its own `db_meta` and seeded meteogram
    configurations (system.md §8.2); *configuration* copies the model chain
    configurations, layouts, app settings and location history, *meteogram*
    the forecast archive, raw API responses and run availability. It is
    written to a temporary file first and renamed only after it passed
    `PRAGMA integrity_check` and every copied table has the source's row
    count; `source` stays untouched. Connections are closed explicitly:
    Windows cannot rename a file with an open handle.
    """
    from .data.storage import CONFIGURATION_TABLES, METEOGRAM_TABLES, Storage

    tables = (CONFIGURATION_TABLES if configuration else ()) + (
        METEOGRAM_TABLES if meteogram else ()
    )
    temporary = destination.with_suffix(".migration.db")
    temporary.unlink(missing_ok=True)
    conn = None
    try:
        Storage(str(temporary)).close()
        conn = sqlite3.connect(temporary.resolve().as_uri(), uri=True)
        conn.execute(
            "ATTACH DATABASE ? AS source",
            (source.resolve().as_uri() + "?mode=ro",),
        )
        with conn:
            for table in tables:
                info = conn.execute(f'PRAGMA main.table_info("{table}")')
                columns = ", ".join(f'"{row[1]}"' for row in info)
                conn.execute(f'DELETE FROM main."{table}"')
                conn.execute(
                    f'INSERT INTO main."{table}" ({columns}) '
                    f'SELECT {columns} FROM source."{table}"'
                )
        for table in tables:
            copied, expected = (
                conn.execute(
                    f'SELECT COUNT(*) FROM {schema}."{table}"'
                ).fetchone()[0]
                for schema in ("main", "source")
            )
            if copied != expected:
                raise OSError(f"Copied table {table} differs from source")
        conn.execute("DETACH DATABASE source")
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise OSError(f"Copied database {temporary} is corrupt")
    except BaseException:
        if conn is not None:
            conn.close()
            conn = None
        temporary.unlink(missing_ok=True)
        raise
    finally:
        if conn is not None:
            conn.close()
    try:
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
