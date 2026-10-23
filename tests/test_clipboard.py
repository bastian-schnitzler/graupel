import base64
import subprocess

import pytest

import graupel.API as bridge
import graupel.clipboard as clipboard

PNG = clipboard.PNG_SIGNATURE + b"rest-of-png"


def _must_not_copy(data):
    pytest.fail("must not copy")


def test_bridge_decodes_base64_png_and_copies(monkeypatch):
    copied = []
    monkeypatch.setattr(
        bridge, "copy_png", lambda data: copied.append(data) or True
    )
    api = bridge.API(storage_path=":memory:")
    assert api.copy_png_to_clipboard(base64.b64encode(PNG).decode()) is True
    assert copied == [PNG]


@pytest.mark.parametrize("payload", [None, 42, "", "not base64!", "@@@@"])
def test_bridge_rejects_invalid_payloads(monkeypatch, payload):
    monkeypatch.setattr(bridge, "copy_png", _must_not_copy)
    api = bridge.API(storage_path=":memory:")
    assert api.copy_png_to_clipboard(payload) is False


def test_bridge_rejects_oversized_payload(monkeypatch):
    monkeypatch.setattr(bridge, "MAX_CLIPBOARD_PNG_BASE64", 8)
    monkeypatch.setattr(bridge, "copy_png", _must_not_copy)
    api = bridge.API(storage_path=":memory:")
    assert api.copy_png_to_clipboard(base64.b64encode(PNG).decode()) is False


def test_copy_png_requires_png_signature(monkeypatch):
    monkeypatch.setattr(clipboard.sys, "platform", "linux")
    monkeypatch.setattr(clipboard, "_copy_linux", _must_not_copy)
    assert clipboard.copy_png(b"GIF89a...") is False


def test_linux_prefers_wl_copy_on_wayland_then_xclip(monkeypatch):
    monkeypatch.setattr(clipboard.sys, "platform", "linux")
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setattr(
        clipboard.shutil, "which", lambda name: f"/usr/bin/{name}"
    )
    calls = []

    def fake_run(command, input, capture_output, timeout):
        calls.append((command, input))
        failed = command[0] == "wl-copy"
        return subprocess.CompletedProcess(command, 1 if failed else 0)

    monkeypatch.setattr(clipboard.subprocess, "run", fake_run)
    assert clipboard.copy_png(PNG) is True
    assert [c[0][0] for c in calls] == ["wl-copy", "xclip"]
    assert calls[1][0] == [
        "xclip", "-selection", "clipboard", "-t", "image/png", "-i"
    ]
    assert all(c[1] == PNG for c in calls)


def test_linux_without_tools_fails(monkeypatch):
    monkeypatch.setattr(clipboard.sys, "platform", "linux")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setattr(clipboard.shutil, "which", lambda name: None)
    assert clipboard.copy_png(PNG) is False


def test_macos_reads_temp_file_as_png_class(monkeypatch):
    monkeypatch.setattr(clipboard.sys, "platform", "darwin")
    seen = {}

    def fake_run(command, capture_output, timeout):
        script = command[2]
        path = script.split('POSIX file "')[1].split('"')[0]
        with open(path, "rb") as handle:
            seen["data"] = handle.read()
        seen["script"] = script
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(clipboard.subprocess, "run", fake_run)
    assert clipboard.copy_png(PNG) is True
    assert seen["data"] == PNG
    assert "«class PNGf»" in seen["script"]


def test_platform_errors_are_reported_as_failure(monkeypatch):
    monkeypatch.setattr(clipboard.sys, "platform", "win32")

    def boom(data):
        raise OSError("clipboard busy")

    monkeypatch.setattr(clipboard, "_copy_windows", boom)
    assert clipboard.copy_png(PNG) is False
