import json
import logging
import ctypes
from types import SimpleNamespace
from pathlib import Path
import pytest

import graupel.API as bridge
from graupel.data.models import Location, MeteogramConfig


def test_api_init_logging_enabled(tmp_path):
    py_log = tmp_path / "logs" / "py.log"
    ui_log = tmp_path / "logs" / "ui.log"

    api = bridge.API(
        logfile_py=str(py_log),
        logfile_ui=str(ui_log),
        storage_path=":memory:",
    )

    assert api.logging is True
    assert api.log is not None

    # UI structured error logging
    api.log_ui_error(
        typescript_function="handleClick",
        api_function="get_forecast",
        error_message="Network timeout",
        error_description="Error: timeout after 5000ms\n    at fetch",
        description_of_typescript_function="Handles refresh button click",
        api_function_input_data={"location": "Berlin"},
        api_function_output_data={"status": 504},
    )

    assert ui_log.exists()
    ui_lines = ui_log.read_text(encoding="utf-8").strip().splitlines()
    assert len(ui_lines) == 1

    entry = json.loads(ui_lines[0])
    assert entry["event"] == "UI error"
    assert entry["level"] == "critical"
    assert entry["ts_function"] == "handleClick"
    assert entry["py_function"] == "get_forecast"
    assert entry["msg"] == "Network timeout"
    assert entry["descr"] == "Error: timeout after 5000ms\n    at fetch"
    assert entry["ts_fun_descr"] == "Handles refresh button click"
    assert entry["api_input"] == {"location": "Berlin"}
    assert entry["api_output"] == {"status": 504}
    assert "timestamp" in entry

    # General structlog backend error logging (as used in main.py)
    api.log.error(
        "Backend error", error="Simulated crash", error_type="ValueError"
    )
    ui_lines2 = ui_log.read_text(encoding="utf-8").strip().splitlines()
    assert len(ui_lines2) == 2
    entry2 = json.loads(ui_lines2[1])
    assert entry2["event"] == "Backend error"
    assert entry2["error"] == "Simulated crash"

    # Standard python logging to py_log
    logging.info("Python backend standard message")
    assert py_log.exists()
    py_content = py_log.read_text(encoding="utf-8")
    assert "Python backend standard message" in py_content

    # UI logs must not propagate to py_log
    assert "Network timeout" not in py_content
    assert "UI error" not in py_content


def test_api_init_logging_disabled():
    api = bridge.API(storage_path=":memory:")

    assert api.logging is False
    assert api.log is None

    # Calling log_ui_error must safely no-op without raising
    api.log_ui_error(
        typescript_function="test",
        api_function="test",
        error_message="msg",
        error_description="desc",
        description_of_typescript_function="fn_desc",
    )


def test_api_reorder_configurations():
    api = bridge.API(storage_path=":memory:")
    loc = {"name": "Berlin", "latitude": 52.52, "longitude": 13.405}
    cfg1 = api.create_configuration(
        {"name": "One", "location": loc, "model_chain": []}
    )
    cfg2 = api.create_configuration(
        {"name": "Two", "location": loc, "model_chain": []}
    )

    reordered = api.reorder_configurations([cfg2["id"], cfg1["id"]])
    assert [c["name"] for c in reordered] == ["Two", "One"]


@pytest.mark.parametrize(
    ("scale", "expected"),
    [(1.0, (110, 200)), (1.25, (138, 250)), (1.5, (165, 300))],
)
def test_move_cursor_converts_absolute_css_position_for_windows_dpi(
    monkeypatch, scale, expected
):
    api = bridge.API(storage_path=":memory:")
    calls = []

    class User32:
        @staticmethod
        def SetCursorPos(x, y):
            calls.append((x, y))
            return 1

    monkeypatch.setattr(bridge.sys, "platform", "win32")
    monkeypatch.setattr(
        ctypes, "windll", SimpleNamespace(user32=User32()), raising=False
    )

    assert api.move_cursor_to(110, 200, scale) is True
    assert calls == [expected]


def test_move_cursor_is_safe_off_windows_and_rejects_invalid_input():
    api = bridge.API(storage_path=":memory:")
    assert api.move_cursor_to(10, 20, 1) is False
    assert api.move_cursor_to(float("nan"), 20, 1) is False
    assert api.move_cursor_to(10, 20, 0) is False
