"""Version history of model chain configurations (system.md §9.5, #176)."""

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

import graupel.data.storage as storage_module
from graupel.data.models import Location, MeteogramConfig, WeatherModel
from graupel.data.storage import Storage

from .test_structured_forecast_archive import LOCATION, _config, _response


@pytest.fixture
def storage(tmp_path):
    store = Storage(str(tmp_path / "meteogram.db"))
    store.update_settings({"archive_enabled": True, "mode": "power"})
    yield store
    store.close()


@pytest.fixture
def clock(monkeypatch):
    """Controllable `_utc_now`; `clock.tick()` advances by one minute."""

    class Clock:
        now = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)

        def tick(self, minutes=1):
            self.now += timedelta(minutes=minutes)

    c = Clock()
    monkeypatch.setattr(storage_module, "_utc_now", lambda: c.now)
    return c


def _versions(storage):
    conn = sqlite3.connect(storage.db_path)
    try:
        return conn.execute(
            "SELECT version_id, config_id, valid_from, valid_to, name "
            "FROM model_chain_config_versions ORDER BY version_id"
        ).fetchall()
    finally:
        conn.close()


def _fetch(storage, config):
    fetch_id = storage.record_forecast_fetch(_response(), config)
    return storage.get_archived_fetch(fetch_id)


def test_autosave_writes_no_version(storage, clock):
    config = storage.create(_config())
    clock.tick()
    config.name = "Renamed"
    storage.update(config)
    assert _versions(storage) == []


def test_fetch_after_change_writes_new_version(storage, clock):
    config = storage.create(_config())
    created_at = clock.now.isoformat()
    clock.tick()
    first = _fetch(storage, config)
    version = storage.get_config_version(first["config_version_id"])
    assert version["valid_from"] == created_at
    assert version["valid_to"] is None
    assert version["name"] == "Test"
    assert version["layout_id"] == "default"  # no own layout (#203)
    assert [m["id"] for m in version["main_model_chain"]] == ["icon_eu"]
    assert version["cloud_model_chain"] == []

    clock.tick()
    config.main_model_chain = config.model_chain = [
        WeatherModel(
            name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=12
        )
    ]
    storage.update(config)
    saved_at = clock.now.isoformat()
    clock.tick()
    second = _fetch(storage, config)

    assert second["config_version_id"] != first["config_version_id"]
    old = storage.get_config_version(first["config_version_id"])
    new = storage.get_config_version(second["config_version_id"])
    assert old["valid_to"] == saved_at
    assert new["valid_from"] == saved_at
    assert new["valid_to"] is None
    assert [m["id"] for m in new["main_model_chain"]] == ["icon_d2"]
    for fetch, ver in ((first, old), (second, new)):
        assert ver["valid_from"] <= fetch["fetched_at"]
        assert ver["valid_to"] is None or fetch["fetched_at"] < ver["valid_to"]


def test_unchanged_config_reuses_version(storage, clock):
    config = storage.create(_config())
    clock.tick()
    first = _fetch(storage, config)
    clock.tick()
    # Autosave of an unchanged state and a reorder do not create a state.
    storage.update(config)
    storage.reorder([config.id])
    clock.tick()
    second = _fetch(storage, config)
    assert second["config_version_id"] == first["config_version_id"]
    assert len(_versions(storage)) == 1


def test_fetch_location_differs_from_config_location(storage, clock):
    config = storage.create(_config())
    manual = Location(name="Hafelekar", latitude=47.3125, longitude=11.3836)
    fetch = _fetch(storage, config.model_copy(update={"location": manual}))
    assert fetch["location"]["name"] == "Hafelekar"
    version = storage.get_config_version(fetch["config_version_id"])
    assert version["location"]["name"] == LOCATION.name


def test_layout_change_writes_new_version(storage, clock):
    config = storage.create(_config())
    clock.tick()
    first = _fetch(storage, config)
    clock.tick()
    config = storage.update(
        config.model_copy(update={"layout_id": "power-default"})
    )
    second = _fetch(storage, config)
    assert second["config_version_id"] != first["config_version_id"]
    new = storage.get_config_version(second["config_version_id"])
    assert new["layout_id"] == "power-default"
    assert new["valid_from"] == second["fetched_at"]
    old = storage.get_config_version(first["config_version_id"])
    assert old["valid_to"] == new["valid_from"]


def test_delete_closes_validity(storage, clock):
    config = storage.create(_config())
    clock.tick()
    fetch = _fetch(storage, config)
    clock.tick()
    storage.delete(config.id)
    version = storage.get_config_version(fetch["config_version_id"])
    assert version["valid_to"] == clock.now.isoformat()
    assert len(_versions(storage)) == 1


def test_normal_mode_and_unsaved_config_have_no_version(storage, clock):
    assert _fetch(storage, _config())["config_version_id"] is None  # Auto
    config = storage.create(_config())
    storage.update_settings({"mode": "normal"})
    assert _fetch(storage, config)["config_version_id"] is None
    assert _versions(storage) == []


def test_nothing_written_with_archiving_off(storage, clock):
    storage.update_settings({"archive_enabled": False})
    config = storage.create(_config())
    assert storage.record_forecast_fetch(_response(), config) is None
    assert _versions(storage) == []


def test_pruning_keeps_referenced_versions(storage, clock):
    config = storage.create(_config())
    clock.tick()
    old = _fetch(storage, config)
    clock.tick(60 * 24 * 10)
    config.name = "Renamed"
    storage.update(config)
    clock.tick()
    recent = _fetch(storage, config)
    storage.prune_archive(retention_days=7, now=clock.now)

    remaining = [row[0] for row in _versions(storage)]
    assert remaining == [recent["config_version_id"]]
    assert storage.get_config_version(old["config_version_id"]) is None

    storage.delete_archive()
    assert _versions(storage) == []


def test_imported_0_1_x_config_versions_start_at_fetch(tmp_path):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE meteogram_configs "
        "(id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER DEFAULT 0)"
    )
    legacy = _config().model_copy(update={"id": "legacy"})
    conn.execute(
        "INSERT INTO meteogram_configs VALUES (?, ?, 0)",
        ("legacy", legacy.model_dump_json()),
    )
    conn.commit()
    conn.close()
    store = Storage(str(path))
    store.update_settings({"archive_enabled": True, "mode": "power"})
    fetch = _fetch(store, store.read("legacy"))
    version = store.get_config_version(fetch["config_version_id"])
    # Without a known save time the version starts at the fetch.
    assert version["valid_from"] == fetch["fetched_at"]
    store.close()


def test_own_layout_of_configuration_is_versioned(storage, clock):
    # A configuration's own layout wins over the default one (#168, #203).
    config = storage.create(
        _config().model_copy(update={"layout_id": "power-default"})
    )
    clock.tick()
    fetch = _fetch(storage, config)
    assert fetch["layout_id"] == "power-default"
    version = storage.get_config_version(fetch["config_version_id"])
    assert version["layout_id"] == "power-default"


def test_location_name_override_is_stored_and_versioned(storage, clock):
    def with_override(config, override):
        return MeteogramConfig.model_validate(
            {**config.model_dump(), "location_name_override": override}
        )

    config = storage.create(with_override(_config(), "  INSB "))
    assert storage.read(config.id).location_name_override == "INSB"
    clock.tick()
    first = _fetch(storage, config)
    version = storage.get_config_version(first["config_version_id"])
    assert version["location_name_override"] == "INSB"

    clock.tick()
    config = storage.update(with_override(config, ""))
    assert storage.read(config.id).location_name_override is None
    clock.tick()
    second = _fetch(storage, config)
    assert second["config_version_id"] != first["config_version_id"]


def test_historic_forecast_rebuilds_the_response_with_version(storage, clock):
    config = storage.create(_config())
    clock.tick()
    fetch_id = storage.record_forecast_fetch(_response(), config)

    listed = storage.list_archived_fetches(
        LOCATION.latitude, LOCATION.longitude
    )
    assert listed[0]["config_version"]["name"] == "Test"
    assert listed[0]["config_version"]["valid_to"] is None

    historic = storage.get_historic_forecast(fetch_id)
    assert historic["fetch"]["id"] == fetch_id
    assert historic["fetch"]["config_version"]["name"] == "Test"
    forecast = historic["forecast"]
    temps = forecast["model_forecasts"]["ICON-EU"]
    assert [p["value"] for p in temps] == [0.0, 1.0, 2.0]
    assert temps[0]["variable"] == "temperature"
    clouds = forecast["vertical_cloud_model_forecasts"]
    profiles = clouds["ICON-EU"]["profiles"]
    assert profiles[0]["levels"][0]["cloud_cover_percent"] == 40
    assert "ICON-EU" in forecast["model_availability"]
    assert storage.get_historic_forecast(fetch_id + 99) is None


def test_historic_forecast_without_version_in_normal_mode(storage, clock):
    storage.update_settings({"mode": "normal"})
    fetch_id = storage.record_forecast_fetch(_response(), _config())
    fetch = storage.get_historic_forecast(fetch_id)["fetch"]
    assert fetch["config_version"] is None
