"""Windows behavior is mocked; resources are real installed-package assets."""
import json
import struct
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from graupel import windows_integration as win
from graupel.resources import icon_path, icon_resource

SIZES = (16, 24, 32, 48, 64, 128, 256)


def test_icon_resources_and_ico_frames():
    assert icon_path().is_file()
    assert icon_resource("graupel.svg").is_file()
    ico = icon_resource("graupel.ico").read_bytes()
    assert struct.unpack_from("<HHH", ico) == (0, 1, len(SIZES))
    for index, size in enumerate(SIZES):
        png = icon_resource(f"graupel_{size}.png").read_bytes()
        assert struct.unpack_from(">II", png, 16) == (size, size)
        w, h, _, _, _, bits, length, offset = struct.unpack_from(
            "<BBBBHHII", ico, 6 + 16 * index
        )
        assert (w or 256, h or 256, bits) == (size, size, 32)
        assert ico[offset:offset + length] == png


def test_missing_icon_fails_explicitly():
    with pytest.raises(FileNotFoundError):
        icon_path("missing.ico")


@pytest.mark.parametrize("origin, installed", [
    ("/src/graupel/__init__.py", False),
    ("/venv/lib/python3.12/site-packages/graupel/__init__.py", True),
    (r"C:\pipx\venvs\graupel\Lib\site-packages\graupel\__init__.py", True),
])
def test_installed_detection(origin, installed):
    with patch("graupel.__spec__", SimpleNamespace(origin=origin)):
        assert win.is_installed_package() is installed


def test_launcher_prefers_current_pipx_environment(tmp_path):
    scripts = tmp_path / "pipx" / "venvs" / "graupel" / "Scripts"
    scripts.mkdir(parents=True)
    launcher = scripts / "graupel.exe"
    launcher.touch()
    ep = SimpleNamespace(name="graupel", dist=object())
    with (
        patch.object(win.sys, "executable", str(scripts / "python.exe")),
        patch("importlib.metadata.entry_points", return_value=[ep]),
        patch.object(win.shutil, "which") as which,
    ):
        assert win.find_graupel_launcher() == launcher
        which.assert_not_called()


def test_no_launcher_does_not_target_python(tmp_path):
    with (
        patch.object(win.sys, "executable", str(tmp_path / "python.exe")),
        patch("importlib.metadata.entry_points", return_value=[]),
        patch.object(win.shutil, "which", return_value=None),
    ):
        assert win.find_graupel_launcher() is None


def test_path_launcher_fallback(tmp_path):
    launcher = tmp_path / "tools" / "graupel.exe"
    with (
        patch.object(win.sys, "executable", str(tmp_path / "python.exe")),
        patch("importlib.metadata.entry_points", return_value=[]),
        patch.object(win.shutil, "which", return_value=str(launcher)),
    ):
        assert win.find_graupel_launcher() == launcher


@pytest.mark.parametrize("platform, installed", [("linux", True), ("win32", False)])
def test_shortcut_guards(platform, installed):
    with (
        patch.object(win.sys, "platform", platform),
        patch.object(win, "is_installed_package", return_value=installed),
        patch.object(win, "_write_shortcut") as write,
    ):
        win.ensure_start_menu_shortcut()
        write.assert_not_called()


@pytest.fixture
def shortcut(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
    monkeypatch.setattr(win, "is_installed_package", lambda: True)
    launcher = tmp_path / "Scripts" / "graupel.exe"
    launcher.parent.mkdir()
    launcher.touch()
    monkeypatch.setattr(win, "find_graupel_launcher", lambda: launcher)
    icon = win._shortcut_icon_path()
    lnk = win._shortcut_path()
    properties = dict(TargetPath=str(launcher), Arguments="",
                      WorkingDirectory=str(launcher.parent),
                      IconLocation=f"{icon},0", Description=win.SHORTCUT_DESCRIPTION, AppUserModelID=win.WINDOWS_APP_ID)
    return lnk, launcher, icon, properties


def test_shortcut_name_and_durable_icon(shortcut):
    lnk, _, icon, _ = shortcut
    assert lnk.name == "Graupel.lnk"
    assert icon.read_bytes() == icon_resource("graupel.ico").read_bytes()
    assert win._shortcut_icon_path() == icon
    assert win.WINDOWS_APP_ID.startswith("Graupel.")


@pytest.mark.parametrize("stale", [None, "TargetPath", "Arguments", "WorkingDirectory", "IconLocation", "Description", "AppUserModelID"])
def test_create_and_repair_all_shortcut_properties(shortcut, stale):
    lnk, launcher, icon, properties = shortcut
    if stale:
        lnk.parent.mkdir(parents=True)
        lnk.touch()
        properties[stale] = "outdated"
    with (
        patch.object(win.sys, "platform", "win32"),
        patch.object(win, "_read_shortcut_properties", return_value=properties),
        patch.object(win, "_write_shortcut") as write,
    ):
        win.ensure_start_menu_shortcut()
        write.assert_called_once_with(lnk, launcher, icon)


def test_repeated_setup_is_idempotent(shortcut):
    lnk, _, _, properties = shortcut
    def create(*args):
        lnk.touch()
    with (
        patch.object(win.sys, "platform", "win32"),
        patch.object(win, "_read_shortcut_properties", return_value=properties),
        patch.object(win, "_write_shortcut", side_effect=create) as write,
    ):
        win.ensure_start_menu_shortcut()
        win.ensure_start_menu_shortcut()
        write.assert_called_once()
        assert list(lnk.parent.glob("*.lnk")) == [lnk]


@pytest.mark.parametrize(
    "filename,target,description",
    [
        (
            "Meteo.lnk",
            r"C:\old\Scripts\meteo.exe",
            "Meteo — Meteogram Forecast App",
        ),
        (
            "Cumulus.lnk",
            r"C:\old\Scripts\cumulus.exe",
            "Cumulus — Meteogram Forecast App",
        ),
    ],
)
@pytest.mark.parametrize("owned", [True, False])
def test_legacy_shortcuts_removed_only_if_owned(
    shortcut, filename, target, description, owned
):
    lnk, _, _, properties = shortcut
    lnk.parent.mkdir(parents=True)
    lnk.touch()
    legacy = lnk.with_name(filename)
    legacy.touch()
    old = dict(
        TargetPath=target,
        Description=description if owned else "My unrelated shortcut",
    )

    def read(path):
        return old if path == legacy else properties

    with (
        patch.object(win.sys, "platform", "win32"),
        patch.object(win, "_read_shortcut_properties", side_effect=read),
        patch.object(win, "_write_shortcut") as write,
    ):
        win.ensure_start_menu_shortcut()
        write.assert_not_called()
        assert legacy.exists() is not owned


def test_failed_creation_preserves_legacy(shortcut):
    lnk, _, _, _ = shortcut
    lnk.parent.mkdir(parents=True)
    legacies = [lnk.with_name("Meteo.lnk"), lnk.with_name("Cumulus.lnk")]
    for legacy in legacies:
        legacy.touch()
    with (
        patch.object(win.sys, "platform", "win32"),
        patch.object(win, "_write_shortcut", side_effect=RuntimeError("failure")),
    ):
        win.ensure_start_menu_shortcut()
        assert all(legacy.is_file() for legacy in legacies)


def test_read_properties_keeps_empty_arguments_and_quoted_paths(tmp_path):
    properties = dict(
        TargetPath="C:\\O'Brien\\graupel.exe",
        Arguments="",
        WorkingDirectory="C:\\O'Brien",
        IconLocation="C:\\icons\\graupel.ico,0",
        Description=win.SHORTCUT_DESCRIPTION,
        AppUserModelID=win.WINDOWS_APP_ID,
    )
    with patch.object(
        win.subprocess,
        "run",
        return_value=SimpleNamespace(stdout=json.dumps(properties)),
    ) as run:
        assert win._read_shortcut_properties(tmp_path / "O'Brien.lnk") == properties
        assert "O''Brien.lnk" in run.call_args.args[0][-1]
        assert run.call_args.kwargs["check"] is True
        assert (
            run.call_args.kwargs["creationflags"]
            == win._POWERSHELL_CREATION_FLAGS
        )


def test_write_sets_target_arguments_directory_icon_and_appid(shortcut):
    lnk, launcher, icon, _ = shortcut
    with patch.object(win.subprocess, "run") as run:
        win._write_shortcut(lnk, launcher, icon)
    create = run.call_args_list[0].args[0][-1]
    assert f"$lnk.TargetPath = '{launcher}'" in create
    assert "$lnk.Arguments = ''" in create
    assert f"$lnk.WorkingDirectory = '{launcher.parent}'" in create
    assert f"$lnk.IconLocation = '{icon},0'" in create
    assert win.WINDOWS_APP_ID in run.call_args_list[1].args[0][-1]
    assert all(
        call.kwargs["creationflags"] == win._POWERSHELL_CREATION_FLAGS
        for call in run.call_args_list
    )


def test_windows_window_icon_and_shortcut_failure_isolated(tmp_path, monkeypatch):
    import graupel.__main__ as entrypoint
    calls = []
    fake = SimpleNamespace(
        create_window=lambda *args, **kw: calls.append((args, kw)),
        start=lambda **kw: calls.append(("start", kw)),
    )
    monkeypatch.setitem(sys.modules, "webview", fake)
    monkeypatch.setattr(entrypoint, "API", lambda *a: object())
    monkeypatch.chdir(tmp_path)
    with (
        patch.object(entrypoint, "set_app_user_model_id") as identity,
        patch.object(win, "ensure_start_menu_shortcut", side_effect=RuntimeError("failure")),
        patch.object(entrypoint.sys, "platform", "win32"),
    ):
        entrypoint.main(SimpleNamespace(invoked_subcommand=None))
    identity.assert_called_once()
    assert calls[0][0][0] == "Graupel"
    assert "icon" not in calls[0][1]
    assert calls[1] == ("start", {"icon": str(icon_path())})
