import logging
import sqlite3
import subprocess
import sys
import types
from pathlib import Path

import pytest

import graupel.API as bridge
import graupel.data_location as data_location
from graupel.data.models import Location, MeteogramConfig
from graupel.data.storage import SCHEMA_VERSION, Storage


def _config(name):
    return MeteogramConfig(
        name=name,
        location=Location(name="Berlin", latitude=52.52, longitude=13.405),
        model_chain=[],
    )


# --- Linux config file -----------------------------------------------------


def test_linux_backend_round_trip_keeps_other_keys(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    backend = data_location.LinuxConfigFileBackend()
    assert backend.path == tmp_path / "xdg" / "graupel" / "config.toml"
    assert backend.read() is None

    backend.path.parent.mkdir(parents=True)
    backend.path.write_text("[windows]\nstart_menu = true\n", encoding="utf-8")
    folder = 'C:\\Users\\Bä "x"'
    backend.write(folder)
    assert backend.read() == folder
    backend.write("/data/graupel")
    assert backend.read() == "/data/graupel"
    assert "start_menu = true" in backend.path.read_text(encoding="utf-8")

    backend.clear()
    assert backend.read() is None
    assert backend.path.read_text(encoding="utf-8") == (
        "[windows]\nstart_menu = true\n"
    )


def test_linux_backend_default_location_and_clear_removes_file(
    monkeypatch, tmp_path
):
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setattr(data_location.Path, "home", lambda: tmp_path)
    backend = data_location.LinuxConfigFileBackend()
    assert backend.path == tmp_path / ".config" / "graupel" / "config.toml"
    backend.write("/data")
    backend.clear()
    assert not backend.path.exists()


# --- macOS user defaults ---------------------------------------------------


def test_macos_backend_uses_defaults_command(monkeypatch):
    store = {}
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        action, domain, key = command[1:4]
        assert command[0] == "defaults"
        assert domain == "io.github.bastian-schnitzler.graupel"
        assert key == "DataDir"
        if action == "write":
            assert command[4] == "-string"
            store[key] = command[5]
            return subprocess.CompletedProcess(command, 0, "", "")
        if action == "read":
            if key not in store:
                return subprocess.CompletedProcess(
                    command, 1, "", "does not exist"
                )
            return subprocess.CompletedProcess(
                command, 0, store[key] + "\n", ""
            )
        store.pop(key, None)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(data_location.subprocess, "run", fake_run)
    backend = data_location.MacDefaultsBackend()
    assert backend.read() is None
    backend.write("/Users/b/Graupel Data")
    assert backend.read() == "/Users/b/Graupel Data"
    backend.clear()
    assert backend.read() is None
    assert [call[1] for call in calls] == [
        "read", "write", "read", "delete", "read"
    ]


# --- Windows registry ------------------------------------------------------


def _fake_winreg():
    values = {}
    module = types.ModuleType("winreg")
    module.HKEY_CURRENT_USER = "HKCU"
    module.KEY_SET_VALUE = 2
    module.REG_SZ = 1
    module.REG_EXPAND_SZ = 2

    class Key:
        def __init__(self, path, create=False):
            if not create and path not in values:
                raise FileNotFoundError(path)
            values.setdefault(path, {})
            self.path = path

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def open_key(root, path, *args):
        assert root == "HKCU"
        return Key(path)

    def create_key_ex(root, path, *args):
        assert root == "HKCU"
        return Key(path, create=True)

    def query_value_ex(key, name):
        if name not in values[key.path]:
            raise FileNotFoundError(name)
        return values[key.path][name]

    def set_value_ex(key, name, reserved, kind, value):
        values[key.path][name] = (value, kind)

    def delete_value(key, name):
        if name not in values[key.path]:
            raise FileNotFoundError(name)
        del values[key.path][name]

    module.OpenKey = open_key
    module.CreateKeyEx = create_key_ex
    module.QueryValueEx = query_value_ex
    module.SetValueEx = set_value_ex
    module.DeleteValue = delete_value
    return module, values


def test_windows_backend_uses_hkcu_registry(monkeypatch):
    winreg, values = _fake_winreg()
    monkeypatch.setitem(sys.modules, "winreg", winreg)
    backend = data_location.WindowsRegistryBackend()
    assert backend.read() is None
    backend.clear()
    backend.write(r"D:\Graupel")
    assert values[r"Software\Graupel"]["DataDir"] == (r"D:\Graupel", 1)
    assert backend.read() == r"D:\Graupel"
    backend.clear()
    assert backend.read() is None


def test_backend_is_chosen_by_platform(monkeypatch):
    monkeypatch.undo()  # drop the autouse in-memory backend
    for platform, kind in (
        ("win32", data_location.WindowsRegistryBackend),
        ("darwin", data_location.MacDefaultsBackend),
        ("linux", data_location.LinuxConfigFileBackend),
    ):
        monkeypatch.setattr(data_location.sys, "platform", platform)
        assert isinstance(data_location._backend(), kind)


# --- Resolution ------------------------------------------------------------


def test_unset_pointer_uses_default(monkeypatch, tmp_path):
    monkeypatch.setattr(data_location.sys, "platform", "linux")
    monkeypatch.setattr(data_location.Path, "home", lambda: tmp_path)
    assert data_location.read_data_dir() is None
    assert data_location.resolve_data_dir() == tmp_path / ".graupel"


def test_unreadable_store_falls_back_without_crash(monkeypatch, caplog):
    class Broken:
        def read(self):
            raise OSError("registry unavailable")

    monkeypatch.setattr(data_location, "_backend", lambda: Broken())
    with caplog.at_level(logging.WARNING):
        assert data_location.read_data_dir() is None
    assert "registry unavailable" in caplog.text


@pytest.mark.parametrize("problem", ["gone", "no_database", "relative"])
def test_unusable_pointer_falls_back_to_default_with_warning(
    monkeypatch, tmp_path, data_dir_backend, caplog, problem
):
    monkeypatch.setattr(data_location.sys, "platform", "linux")
    monkeypatch.setattr(data_location.Path, "home", lambda: tmp_path)
    pointer = tmp_path / "chosen"
    if problem == "no_database":
        pointer.mkdir()
    if problem == "relative":
        pointer = Path("relative/folder")
    data_dir_backend.value = str(pointer)
    warnings = []
    with caplog.at_level(logging.WARNING):
        assert data_location.resolve_data_dir(warnings) == tmp_path / ".graupel"
    assert len(warnings) == 1
    assert "unusable" in caplog.text


def test_unusable_pointer_starts_the_bridge_on_the_default(
    monkeypatch, tmp_path, data_dir_backend
):
    monkeypatch.setattr(bridge.sys, "platform", "linux")
    monkeypatch.setattr(bridge.Path, "home", lambda: tmp_path)
    data_dir_backend.value = str(tmp_path / "gone")
    api = bridge.API()
    try:
        assert Path(api.storage.db_path) == (
            tmp_path / ".graupel" / "meteogram.db"
        )
    finally:
        api.storage.close()


# --- Changing the data folder ----------------------------------------------


def _linux_home(monkeypatch, tmp_path):
    monkeypatch.setattr(bridge.sys, "platform", "linux")
    monkeypatch.setattr(bridge.Path, "home", lambda: tmp_path)


def test_change_data_dir_copies_switches_and_keeps_old_copy(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    # Databases under old application names are not looked up (system.md §13).
    legacy = tmp_path / ".meteo" / "meteogram.db"
    legacy.parent.mkdir()
    old = Storage(str(legacy))
    legacy_config = old.create(_config("Legacy preset"))
    old.close()
    legacy_bytes = legacy.read_bytes()

    api = bridge.API()
    old_db = Path(api.storage.db_path)
    assert old_db == tmp_path / ".graupel" / "meteogram.db"
    saved = api.storage.create(_config("Before move"))
    api.update_settings({"mode": "power"})

    target = tmp_path / "Graupel Data"
    result = api.change_data_dir(str(target))
    assert result == {
        "data_dir": str(target),
        "previous_data_dir": str(old_db.parent),
    }
    assert data_dir_backend.value == str(target)
    assert api.get_data_dir()["data_dir"] == str(target)
    assert api.get_data_dir()["is_default"] is False

    # This session continues on the new copy.
    moved = api.storage.create(_config("After move"))
    assert api.storage.read(moved.id) is not None
    api.storage.close()
    assert old_db.is_file()
    assert Storage(str(old_db)).read(moved.id) is None

    # Next start uses the pointer; nothing is read from legacy folders.
    reopened = bridge.API()
    try:
        assert Path(reopened.storage.db_path) == target / "meteogram.db"
        assert reopened.storage.read(saved.id).name == "Before move"
        assert reopened.storage.read(legacy_config.id) is None
        assert reopened.storage.read(moved.id).name == "After move"
        assert reopened.get_settings()["mode"] == "power"
    finally:
        reopened.storage.close()
    assert legacy.read_bytes() == legacy_bytes
    assert not (target / "meteogram.migration.db").exists()


def test_change_data_dir_rejects_unusable_targets(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    api = bridge.API()
    try:
        current = str(Path(api.storage.db_path).parent)
        occupied = tmp_path / "occupied"
        occupied.mkdir()
        (occupied / "meteogram.db").write_bytes(b"other data")
        a_file = tmp_path / "file.txt"
        a_file.write_text("x")
        for path in ("", "relative/folder", current, str(occupied),
                     str(a_file)):
            with pytest.raises(ValueError):
                api.change_data_dir(path)
        assert data_dir_backend.value is None
        assert (occupied / "meteogram.db").read_bytes() == b"other data"
        assert api.storage.list_all() == []
    finally:
        api.storage.close()


def test_change_data_dir_rejects_unwritable_folder(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    monkeypatch.setattr(
        bridge, "check_writable", lambda folder: f"{folder} is not writable"
    )
    api = bridge.API()
    try:
        with pytest.raises(ValueError, match="not writable"):
            api.change_data_dir(str(tmp_path / "readonly"))
        assert data_dir_backend.value is None
    finally:
        api.storage.close()


def test_failed_copy_keeps_pointer_and_storage(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)

    def broken_copy(source, destination, **parts):
        raise OSError("disk full")

    monkeypatch.setattr(bridge, "copy_data_parts", broken_copy)
    api = bridge.API()
    old_path = api.storage.db_path
    try:
        with pytest.raises(OSError):
            api.change_data_dir(str(tmp_path / "target"))
        assert data_dir_backend.value is None
        assert api.storage.db_path == old_path
    finally:
        api.storage.close()


def _table_count(db_path, table):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def _filled_api(monkeypatch, tmp_path):
    _linux_home(monkeypatch, tmp_path)
    api = bridge.API()
    api.storage.create(_config("Mine"))
    api.update_settings(
        {
            "mode": "power",
            "archive_enabled": True,
            "archive_retention_days": 30,
        }
    )
    api.storage.record_location_selection(
        Location(name="Graz", latitude=47.07, longitude=15.44)
    )
    layout = api.create_layout("My layout")
    api.storage.archive_api_response("forecast", {"models": "icon_eu"}, {})
    return api, layout


@pytest.mark.parametrize(
    ("configuration", "meteogram"),
    [(True, True), (True, False), (False, True), (False, False)],
)
def test_change_data_dir_copies_selected_parts(
    monkeypatch, tmp_path, data_dir_backend, configuration, meteogram
):
    api, layout = _filled_api(monkeypatch, tmp_path)
    old_db = Path(api.storage.db_path)
    api.storage.close()
    old_bytes = old_db.read_bytes()
    target = tmp_path / "new"
    try:
        api.change_data_dir(
            str(target),
            copy_configuration=configuration,
            copy_meteogram=meteogram,
        )
        new_db = target / "meteogram.db"
        assert api.storage.db_path == str(new_db)
        # A fresh database with its own format record.
        assert api.storage.get_db_meta()["schema_version"] == str(
            SCHEMA_VERSION
        )
        names = [c.name for c in api.storage.list_all()]
        layout_ids = [entry["id"] for entry in api.storage.list_layouts()]
        settings = api.storage.get_settings()
        history = api.storage.get_most_used_locations()
        if configuration:
            assert names == ["Mine"]
            assert layout["id"] in layout_ids
            assert settings["mode"] == "power"
            assert settings["archive_retention_days"] == 30
            assert [loc.name for loc in history] == ["Graz"]
        else:
            assert names == []
            assert layout["id"] not in layout_ids
            assert "default" in layout_ids  # seeded library
            assert api.storage.get_stored_setting_keys() == []
            assert history == []
        archived = _table_count(new_db, "api_fetch_archive")
        assert archived == (1 if meteogram else 0)
    finally:
        api.storage.close()
    assert old_db.read_bytes() == old_bytes
    assert not (target / "meteogram.migration.db").exists()


def test_change_data_dir_switches_log_files(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    root_handlers = list(logging.getLogger().handlers)
    api = bridge.API("log.py.txt", "log.ui.txt")
    try:
        target = tmp_path / "moved"
        api.change_data_dir(str(target))
        api.log_ui_error("fn", "api", "boom")
        logging.getLogger("graupel.test").warning("after move")
        for handler in logging.getLogger().handlers:
            handler.flush()
        assert "boom" in (target / "log.ui.txt").read_text(encoding="utf-8")
        py_log = (target / "log.py.txt").read_text(encoding="utf-8")
        assert "after move" in py_log
    finally:
        api.storage.close()
        for handler in logging.getLogger(bridge.APP_LOGGER).handlers:
            handler.close()
        logging.getLogger(bridge.APP_LOGGER).handlers.clear()
        for handler in logging.getLogger().handlers:
            handler.close()
        logging.getLogger().handlers[:] = root_handlers


def test_in_memory_database_cannot_be_moved(tmp_path):
    api = bridge.API(storage_path=":memory:")
    try:
        with pytest.raises(ValueError):
            api.change_data_dir(str(tmp_path / "target"))
    finally:
        api.storage.close()


def test_choose_data_dir_uses_native_folder_dialog(monkeypatch, tmp_path):
    calls = []

    class Window:
        def create_file_dialog(self, dialog_type, directory=""):
            calls.append((dialog_type, directory))
            return (str(tmp_path / "picked"),)

    fake = types.SimpleNamespace(
        windows=[Window()], FileDialog=types.SimpleNamespace(FOLDER="folder")
    )
    monkeypatch.setitem(sys.modules, "webview", fake)
    api = bridge.API(storage_path=str(tmp_path / "meteogram.db"))
    try:
        assert api.choose_data_dir() == str(tmp_path / "picked")
        assert calls == [("folder", str(tmp_path))]
        fake.windows[0].create_file_dialog = lambda *a, **k: None
        assert api.choose_data_dir() is None
        fake.windows = []
        assert api.choose_data_dir() is None
    finally:
        api.storage.close()


# --- Opening the data folder (#197) ----------------------------------------


import graupel.file_manager as file_manager  # noqa: E402


@pytest.mark.parametrize(
    "platform, command", [("linux", "xdg-open"), ("darwin", "open")]
)
def test_open_data_dir_runs_the_platform_opener(
    monkeypatch, tmp_path, data_dir_backend, platform, command
):
    _linux_home(monkeypatch, tmp_path)
    api = bridge.API()
    data_dir = Path(api.storage.db_path).parent
    monkeypatch.setattr(file_manager.sys, "platform", platform)
    monkeypatch.setattr(file_manager.shutil, "which", lambda c: f"/bin/{c}")
    calls = []
    monkeypatch.setattr(
        file_manager.subprocess,
        "Popen",
        lambda args, **kwargs: calls.append(args),
    )
    assert api.open_data_dir() == {"ok": True, "error": None}
    assert calls == [[f"/bin/{command}", str(data_dir)]]
    api.storage.close()


def test_open_data_dir_uses_startfile_on_windows(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    api = bridge.API()
    monkeypatch.setattr(file_manager.sys, "platform", "win32")
    opened = []
    monkeypatch.setattr(
        file_manager.os, "startfile", opened.append, raising=False
    )
    assert api.open_data_dir()["ok"] is True
    assert opened == [str(Path(api.storage.db_path).parent)]
    api.storage.close()


def test_open_data_dir_reports_failures(
    monkeypatch, tmp_path, data_dir_backend
):
    _linux_home(monkeypatch, tmp_path)
    api = bridge.API()
    monkeypatch.setattr(file_manager.sys, "platform", "linux")
    monkeypatch.setattr(file_manager.shutil, "which", lambda c: None)
    result = api.open_data_dir()
    assert result["ok"] is False
    assert "xdg-open" in result["error"]

    monkeypatch.setattr(file_manager.shutil, "which", lambda c: "/bin/x")

    def broken(*args, **kwargs):
        raise OSError("no display")

    monkeypatch.setattr(file_manager.subprocess, "Popen", broken)
    result = api.open_data_dir()
    assert result == {
        "ok": False,
        "error": f"Cannot open {Path(api.storage.db_path).parent}: no display",
    }
    api.storage.close()


def test_open_folder_reports_a_missing_folder(tmp_path):
    missing = tmp_path / "gone"
    assert file_manager.open_folder(missing) == f"{missing} does not exist"
