from __future__ import annotations

import base64
import binascii
import logging
import math
import sys
import webbrowser
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog

from .data.api import MeteogramAPI
from .data.storage import Storage
from .data_location import (
    DATABASE_NAME,
    check_writable,
    copy_data_parts,
    default_data_dir,
    resolve_data_dir,
    write_data_dir,
)
from .clipboard import copy_png
from .file_manager import open_folder

APP_LOGGER = "react_ui_frontend"


# Upper bound for an exported PNG passed over the bridge (base64 text).
MAX_CLIPBOARD_PNG_BASE64 = 64 * 1024 * 1024


class API:
    """
    pywebview Bridge API exposing MeteogramAPI methods to Javascript.
    """

    def __init__(
        self,
        logfile_py: Optional[str] = None,
        logfile_ui: Optional[str] = None,
        storage_path: Optional[str] = None,
    ) -> None:

        data_dir_warnings: List[str] = []
        if storage_path is None:
            data_dir = resolve_data_dir(data_dir_warnings)
            data_dir.mkdir(parents=True, exist_ok=True)
            database = data_dir / DATABASE_NAME
            storage_path = str(database)
        self.storage = Storage(storage_path)
        self.meteogram_api = MeteogramAPI(storage=self.storage)
        # Log file names, re-applied to the new folder on a data-folder change.
        self._logfile_names = (logfile_py, logfile_ui)
        if logfile_py:
            logfile_py = str(Path(storage_path).parent / Path(logfile_py))
        if logfile_ui:
            logfile_ui = str(Path(storage_path).parent / Path(logfile_ui))
        self.init_logging(logfile_py, logfile_ui)
        for warning in data_dir_warnings:
            logging.getLogger(__name__).warning(warning)

    def get_models(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_models()

    def get_quantity_registry(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_quantity_registry()

    def get_user_timezone(self) -> str:
        return self.meteogram_api.get_user_timezone()

    def get_configurations(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_configurations()

    def create_configuration(
        self, config: Dict[str, Any], position: Optional[int] = None
    ) -> Dict[str, Any]:
        return self.meteogram_api.create_configuration(
            config, position=position
        )

    def update_configuration(
        self, configuration_id: str, changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self.meteogram_api.update_configuration(
            configuration_id, changes
        )

    def save_configuration(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return self.meteogram_api.save_configuration(config)

    def delete_configuration(self, configuration_id: str) -> Dict[str, bool]:
        return self.meteogram_api.delete_configuration(configuration_id)

    def get_forecast(
        self,
        location: Optional[Dict[str, Any]] = None,
        configuration_id: Optional[str] = None,
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self.meteogram_api.get_forecast(
            location=location,
            configuration_id=configuration_id,
            variables=variables,
        )

    def get_auto_forecast(
        self,
        location: Dict[str, Any],
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self.meteogram_api.get_auto_forecast(
            location=location, variables=variables
        )

    def resolve_auto_chain(
        self,
        latitude: float,
        longitude: float,
        elevation: Optional[float] = None,
    ) -> Dict[str, Any]:
        return self.meteogram_api.resolve_auto_chain(
            latitude, longitude, elevation
        )

    def list_regions(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.list_regions()

    def get_region_chains(self, region_id: str) -> Optional[Dict[str, Any]]:
        return self.meteogram_api.get_region_chains(region_id)

    def list_auto_chains(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.list_auto_chains()

    def refresh_forecast(
        self,
        location: Optional[Dict[str, Any]] = None,
        configuration_id: Optional[str] = None,
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self.meteogram_api.refresh_forecast(
            location=location,
            configuration_id=configuration_id,
            variables=variables,
        )

    def reorder_configurations(
        self, configuration_ids: List[str]
    ) -> List[Dict[str, Any]]:
        return self.meteogram_api.reorder_configurations(configuration_ids)

    def record_location_selection(
        self, location: Dict[str, Any]
    ) -> Dict[str, bool]:
        return self.meteogram_api.record_location_selection(location)

    def get_most_used_locations(
        self, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_most_used_locations(limit=limit)

    def get_settings(self) -> Dict[str, Any]:
        return self.meteogram_api.get_settings()

    def update_settings(self, changes: Dict[str, Any]) -> Dict[str, Any]:
        return self.meteogram_api.update_settings(changes)

    def get_layouts(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_layouts()

    def create_layout(
        self,
        name: str,
        layout: Optional[Dict[str, Any]] = None,
        position: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self.meteogram_api.create_layout(name, layout, position)

    def duplicate_layout(self, layout_id: str) -> Dict[str, Any]:
        return self.meteogram_api.duplicate_layout(layout_id)

    def update_layout(
        self, layout_id: str, changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self.meteogram_api.update_layout(layout_id, changes)

    def reset_layout(self, layout_id: str) -> Dict[str, Any]:
        return self.meteogram_api.reset_layout(layout_id)

    def delete_layout(self, layout_id: str) -> Dict[str, bool]:
        return self.meteogram_api.delete_layout(layout_id)

    def reorder_layouts(self, layout_ids: List[str]) -> List[Dict[str, Any]]:
        return self.meteogram_api.reorder_layouts(layout_ids)

    def list_archived_forecasts(
        self, latitude: float, longitude: float, radius_km: float = 1.0
    ) -> List[Dict[str, Any]]:
        return self.meteogram_api.list_archived_forecasts(
            latitude, longitude, radius_km=radius_km
        )

    def get_archived_forecast(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        return self.meteogram_api.get_archived_forecast(fetch_id)

    def get_historic_forecast(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        return self.meteogram_api.get_historic_forecast(fetch_id)

    def delete_archive(self) -> Dict[str, bool]:
        return self.meteogram_api.delete_archive()

    def get_data_dir(self) -> Dict[str, Any]:
        """Current data folder and whether it is the platform default."""
        current = Path(self.storage.db_path).parent
        return {
            "data_dir": str(current),
            "default_data_dir": str(default_data_dir()),
            "is_default": current == default_data_dir(),
        }

    def open_data_dir(self) -> Dict[str, Any]:
        """Open the current data folder in the system file manager (#197).

        Takes no path: only the folder `get_data_dir` reports is opened.
        """
        if self.storage.db_path == ":memory:" or "mode=memory" in (
            self.storage.db_path
        ):
            return {"ok": False, "error": "The data is kept in memory only"}
        error = open_folder(Path(self.storage.db_path).parent)
        return {"ok": error is None, "error": error}

    def get_archive_stats(self) -> Dict[str, int]:
        return self.meteogram_api.get_archive_stats()

    def choose_data_dir(self) -> Optional[str]:
        """Folder picked in the native folder dialog, or None if cancelled."""
        import webview

        if not webview.windows:
            return None
        folder_dialog = getattr(webview, "FileDialog", None)
        dialog_type = (
            folder_dialog.FOLDER
            if folder_dialog is not None
            else getattr(webview, "FOLDER_DIALOG")
        )
        result = webview.windows[0].create_file_dialog(
            dialog_type, directory=str(Path(self.storage.db_path).parent)
        )
        if not result:
            return None
        return str(result[0] if isinstance(result, (list, tuple)) else result)

    def change_data_dir(
        self,
        path: str,
        copy_configuration: bool = True,
        copy_meteogram: bool = True,
    ) -> Dict[str, Any]:
        """Point the app at a new data folder (system.md §8.2, #140).

        Validates that the folder is writable and holds no database yet,
        creates a fresh database there with the chosen parts of the current
        one (configuration data and/or meteogram data), verifies it, stores
        the new pointer and switches the running storage and log files to
        it. The old database stays where it was; no restart is needed.
        """
        if not isinstance(path, str) or not path.strip():
            raise ValueError("Choose a folder for the data")
        if self.storage.db_path == ":memory:" or "mode=memory" in (
            self.storage.db_path
        ):
            raise ValueError("An in-memory database cannot be moved")
        source = Path(self.storage.db_path)
        target_dir = Path(path.strip()).expanduser()
        if not target_dir.is_absolute():
            raise ValueError(f"{target_dir} is not an absolute path")
        target_dir = target_dir.resolve()
        if target_dir == source.parent.resolve():
            raise ValueError("The data is already in this folder")
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ValueError(f"Cannot create {target_dir}: {exc}") from exc
        reason = check_writable(target_dir)
        if reason is not None:
            raise ValueError(reason)
        target = target_dir / DATABASE_NAME
        if target.exists():
            raise ValueError(
                f"{target_dir} already contains a {DATABASE_NAME}; "
                "choose an empty folder"
            )
        # Storage opens one connection per call; closing the shared one too
        # leaves no handle open (Windows cannot copy or rename locked files).
        self.storage.close()
        copy_data_parts(
            source,
            target,
            configuration=bool(copy_configuration),
            meteogram=bool(copy_meteogram),
        )
        write_data_dir(target_dir)
        self.storage.db_path = str(target)
        logfile_py, logfile_ui = self._logfile_names
        if logfile_py or logfile_ui:
            self.init_logging(
                str(target_dir / logfile_py) if logfile_py else None,
                str(target_dir / logfile_ui) if logfile_ui else None,
            )
        return {
            "data_dir": str(target_dir),
            "previous_data_dir": str(source.parent),
        }

    def open_external_url(self, url: str) -> bool:
        """Open only absolute HTTP(S) URLs in the system default browser."""
        if not isinstance(url, str) or any(
            char.isspace() or ord(char) < 32 for char in url
        ):
            return False
        try:
            parsed = urlsplit(url)
            if (
                parsed.scheme.lower() not in ("http", "https")
                or not parsed.hostname
            ):
                return False
            if parsed.username is not None or parsed.password is not None:
                return False
            if "\\" in url:
                return False
            # Accessing port also rejects malformed or out-of-range ports.
            parsed.port
        except ValueError:
            return False
        try:
            return bool(webbrowser.open(url))
        except webbrowser.Error:
            return False

    def copy_png_to_clipboard(self, png_base64: str) -> bool:
        """Copy a base64-encoded PNG (meteogram export) to the clipboard."""
        if not isinstance(png_base64, str) or not png_base64:
            return False
        if len(png_base64) > MAX_CLIPBOARD_PNG_BASE64:
            return False
        try:
            png = base64.b64decode(png_base64, validate=True)
        except (binascii.Error, ValueError):
            return False
        return copy_png(png)

    def move_cursor_to(
        self,
        screen_x: float,
        screen_y: float,
        device_pixel_ratio: float = 1,
    ) -> bool:
        """Move the real Windows cursor to an absolute CSS screen position.

        Chromium reports wheel/pointer coordinates in CSS pixels, while the
        DPI-aware Win32 cursor APIs use physical screen pixels. Absolute
        coordinates prevent fractional rounding errors from accumulating over
        repeated zoom steps.
        """
        values = (screen_x, screen_y, device_pixel_ratio)
        if not all(isinstance(value, (int, float)) for value in values):
            return False
        if not all(math.isfinite(float(value)) for value in values):
            return False
        if not 0.5 <= float(device_pixel_ratio) <= 8:
            return False
        if sys.platform != "win32":
            return False

        import ctypes

        user32 = ctypes.windll.user32
        target_x = round(float(screen_x) * device_pixel_ratio)
        target_y = round(float(screen_y) * device_pixel_ratio)
        return bool(user32.SetCursorPos(target_x, target_y))

    def init_logging(
        self, logfile_py_path: str | None, logfile_ui_path: str | None
    ) -> None:
        logfile_py = Path(logfile_py_path) if logfile_py_path else None
        logfile_ui = Path(logfile_ui_path) if logfile_ui_path else None
        if logfile_py is not None:
            logfile_py.parent.mkdir(parents=True, exist_ok=True)
            logging.basicConfig(
                filename=logfile_py,
                level=logging.INFO,
                format="%(message)s",
                force=True,
            )

        self.logging = logfile_ui is not None
        if self.logging:
            assert logfile_ui is not None
            logfile_ui.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(logfile_ui, encoding="utf-8")
            file_handler.setLevel(logging.INFO)
            file_handler.setFormatter(logging.Formatter("%(message)s"))

            app_logger = logging.getLogger(APP_LOGGER)
            app_logger.setLevel(logging.INFO)
            for handler in list(app_logger.handlers):
                handler.close()
            app_logger.handlers.clear()
            app_logger.addHandler(file_handler)

            # Critical: don't forward our records to the root logger
            app_logger.propagate = False

            structlog.configure(
                processors=[
                    structlog.processors.TimeStamper(fmt="iso"),
                    structlog.processors.add_log_level,
                    structlog.processors.JSONRenderer(),
                ],
                logger_factory=structlog.stdlib.LoggerFactory(),
            )

            self.log = structlog.get_logger(APP_LOGGER)
        else:
            self.log = None

    def log_ui_error(
        self,
        typescript_function: str = "",
        api_function: str = "",
        error_message: str = "",
        error_description: str = "",
        description_of_typescript_function: str = "",
        api_function_input_data: Any = None,
        api_function_output_data: Any = None,
    ) -> None:
        if self.logging and self.log is not None:
            self.log.critical(
                "UI error",
                ts_function=typescript_function,
                ts_fun_descr=description_of_typescript_function,
                py_function=api_function,
                msg=error_message,
                descr=error_description,
                api_input=api_function_input_data,
                api_output=api_function_output_data,
            )
