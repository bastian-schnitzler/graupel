from __future__ import annotations

import logging
import math
import os
import sqlite3
import sys
import webbrowser
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog

from .data.api import MeteogramAPI
from .data.storage import Storage
from .config import APP_NAME

APP_LOGGER = "react_ui_frontend"


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

        if storage_path is None:
            if sys.platform == "win32":
                # Keep SQLite on the local Windows filesystem, including WSL runs.
                local = os.environ.get("LOCALAPPDATA")
                root = (
                    Path(local) if local else Path.home() / "AppData" / "Local"
                )
                data_dir = root / APP_NAME
                legacies = [
                    root / "cumulus" / "meteogram.db",
                    root / "Cumulus" / "meteogram.db",
                    root / "meteo" / "meteogram.db",
                ]
            else:
                data_dir = Path.home() / ("." + APP_NAME)
                legacies = [
                    Path.home() / ".cumulus" / "meteogram.db",
                    Path.home() / ".meteo" / "meteogram.db",
                ]
            data_dir.mkdir(parents=True, exist_ok=True)
            database = data_dir / "meteogram.db"
            if not database.exists():
                for legacy_db in legacies:
                    if legacy_db.is_file():
                        # SQLite backup includes committed WAL data and preserves the old DB.
                        temporary = database.with_suffix(".migration.db")
                        temporary.unlink(missing_ok=True)
                        source_conn = None
                        dest_conn = None
                        try:
                            source_conn = sqlite3.connect(
                                legacy_db.resolve().as_uri() + "?mode=ro",
                                uri=True,
                            )
                            dest_conn = sqlite3.connect(temporary)
                            source_conn.backup(dest_conn)
                        finally:
                            if dest_conn is not None:
                                dest_conn.close()
                            if source_conn is not None:
                                source_conn.close()

                        try:
                            temporary.replace(database)
                        finally:
                            temporary.unlink(missing_ok=True)
                        break
            storage_path = str(database)
        self.storage = Storage(storage_path)
        self.meteogram_api = MeteogramAPI(storage=self.storage)
        if logfile_py:
            logfile_py = str(Path(storage_path).parent / Path(logfile_py))
        if logfile_ui:
            logfile_ui = str(Path(storage_path).parent / Path(logfile_ui))
        self.init_logging(logfile_py, logfile_ui)

    def get_models(self) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_models()

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

    def get_most_used_locations(self, limit: int = 10) -> List[Dict[str, Any]]:
        return self.meteogram_api.get_most_used_locations(limit=limit)

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
