from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import graupel.API as bridge
from graupel.data.models import Location, MeteogramConfig


def test_windows_default_persists_outside_working_directory(
    monkeypatch, tmp_path
):
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.chdir(project)
    monkeypatch.setattr(bridge.sys, "platform", "win32")
    local_app_data = tmp_path / "Local"
    monkeypatch.setenv("LOCALAPPDATA", str(local_app_data))

    api = bridge.API()
    config = MeteogramConfig(
        name="Saved configuration",
        location=Location(name="Berlin", latitude=52.52, longitude=13.405),
        model_chain=[],
    )
    # Bridge calls run on worker threads in pywebview.
    with ThreadPoolExecutor(max_workers=1) as executor:
        saved = executor.submit(api.storage.create, config).result()
    api.storage.close()

    reopened = bridge.API()
    try:
        assert reopened.storage.read(saved.id).name == "Saved configuration"
        assert (
            Path(reopened.storage.db_path)
            == local_app_data / "graupel" / "meteogram.db"
        )
        assert not (project / "meteogram.db").exists()
    finally:
        reopened.storage.close()


def test_windows_default_without_local_app_data(monkeypatch, tmp_path):
    monkeypatch.setattr(bridge.sys, "platform", "win32")
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.setattr(bridge.Path, "home", lambda: tmp_path)

    api = bridge.API()
    try:
        assert Path(api.storage.db_path) == (
            tmp_path / "AppData" / "Local" / "graupel" / "meteogram.db"
        )
    finally:
        api.storage.close()


def test_non_windows_default(monkeypatch, tmp_path):
    monkeypatch.setattr(bridge.sys, "platform", "linux")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(bridge.Path, "home", lambda: tmp_path)

    api = bridge.API()
    try:
        assert (
            Path(api.storage.db_path) == tmp_path / ".graupel" / "meteogram.db"
        )
        assert Path(api.storage.db_path).is_file()
    finally:
        api.storage.close()


def test_explicit_paths_override_windows_default(monkeypatch, tmp_path):
    monkeypatch.setattr(bridge.sys, "platform", "win32")
    local_app_data = tmp_path / "Local"
    monkeypatch.setenv("LOCALAPPDATA", str(local_app_data))

    for storage_path in (":memory:", str(tmp_path / "custom.db")):
        api = bridge.API(storage_path=storage_path)
        try:
            assert api.storage.db_path == storage_path
            assert api.storage.list_all() == []
        finally:
            api.storage.close()
    assert not local_app_data.exists()


@pytest.mark.parametrize("legacy_directory", ["meteo", "cumulus", "Cumulus"])
def test_legacy_database_is_copied_once_without_losing_presets(
    monkeypatch, tmp_path, legacy_directory
):
    from graupel.data.storage import Storage

    monkeypatch.setattr(bridge.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    legacy = tmp_path / legacy_directory / "meteogram.db"
    legacy.parent.mkdir()
    old = Storage(str(legacy))
    config = old.create(
        MeteogramConfig(
            name="Legacy preset",
            location=Location(name="Berlin", latitude=52, longitude=13),
            model_chain=[],
        )
    )
    old.close()
    api = bridge.API()
    try:
        assert api.storage.read(config.id).name == "Legacy preset"
        api.storage.delete(config.id)
    finally:
        api.storage.close()
    reopened = bridge.API()
    try:
        assert reopened.storage.list_all() == []
        assert legacy.is_file()
    finally:
        reopened.storage.close()


def test_migration_recovers_from_stale_temporary_file(monkeypatch, tmp_path):
    from graupel.data.storage import Storage

    monkeypatch.setattr(bridge.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    legacy = tmp_path / "meteo" / "meteogram.db"
    legacy.parent.mkdir()
    old = Storage(str(legacy))
    config = old.create(
        MeteogramConfig(
            name="Recovered preset",
            location=Location(name="Berlin", latitude=52, longitude=13),
            model_chain=[],
        )
    )
    old.close()

    stale_temp = tmp_path / "graupel" / "meteogram.migration.db"
    stale_temp.parent.mkdir(parents=True, exist_ok=True)
    stale_temp.write_text("corrupt stale file")

    api = bridge.API()
    try:
        assert api.storage.read(config.id).name == "Recovered preset"
        assert not stale_temp.exists()
    finally:
        api.storage.close()


def test_bridge_get_user_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Rome")
    api = bridge.API(storage_path=":memory:")
    try:
        assert api.get_user_timezone() == "Europe/Rome"
    finally:
        api.storage.close()
