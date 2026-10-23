"""Structured forecast archive with retention (system.md §9, #137)."""

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

import graupel.data.storage as storage_module
from graupel.data.api import MeteogramAPI
from graupel.data.models import (
    DataPoint,
    DetailedCloudForecast,
    HarmonizedForecastResponse,
    Location,
    MeteogramConfig,
    ModelAvailability,
    VerticalCloudLevel,
    VerticalCloudProfile,
    WeatherModel,
)
from graupel.data.quantities import QUANTITIES, Quantity
from graupel.data.service import ForecastService
from graupel.data.storage import Storage

from .test_forecast_archive_and_handover import GapClient

LOCATION = Location(name="Innsbruck", latitude=47.26921, longitude=11.40411)


@pytest.fixture
def storage(tmp_path):
    store = Storage(str(tmp_path / "meteogram.db"))
    yield store
    store.close()


def _config(location=LOCATION):
    models = [
        WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=12)
    ]
    return MeteogramConfig(
        name="Test",
        location=location,
        model_chain=models,
        main_model_chain=models,
        cloud_model_chain=[],
    )


def _response(extra_points=()):
    points = [
        DataPoint(
            timestamp=f"2026-10-18T{h:02d}:00:00Z",
            value=float(h),
            unit="°C",
            variable="temperature",
            model="ICON-EU",
        )
        for h in (1, 0, 2)
    ] + list(extra_points)
    profile = VerticalCloudProfile(
        timestamp="2026-10-18T00:00:00Z",
        source_model_id="icon_eu",
        levels=[
            VerticalCloudLevel(
                pressure_hpa=850, altitude_m_asl=1500, cloud_cover_percent=40
            )
        ],
    )
    return HarmonizedForecastResponse(
        combined_forecast=points,
        model_forecasts={"ICON-EU": points},
        vertical_cloud_model_forecasts={
            "ICON-EU": DetailedCloudForecast(location=LOCATION, profiles=[profile])
        },
        model_availability={
            "ICON-EU": ModelAvailability(
                model="ICON-EU",
                model_id="icon_eu",
                chain="main",
                last_run_init_time="2026-10-18T00:00:00Z",
            )
        },
        cloud_model_availability={
            "ICON-EU": ModelAvailability(
                model="ICON-EU",
                model_id="icon_eu",
                chain="cloud",
                last_run_init_time="2026-10-17T18:00:00Z",
            )
        },
    )


def _count(storage, table):
    conn = sqlite3.connect(storage.db_path)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


ALL_TABLES = (
    "forecast_fetch",
    "forecast_series",
    "api_fetch_archive",
    "model_run_availability",
)


@pytest.mark.asyncio
async def test_default_off_stores_nothing(storage):
    assert storage.get_settings()["archive_enabled"] is False
    service = ForecastService(client=GapClient(), storage=storage)
    result = await service.get_merged_forecast(_config(), variable="temperature")
    assert any(p.value is not None for p in result.combined_forecast)
    for table in ALL_TABLES:
        assert _count(storage, table) == 0, table
    assert storage.record_forecast_fetch(_response(), _config()) is None


@pytest.mark.asyncio
async def test_forecast_is_archived_when_enabled(storage):
    storage.update_settings({"archive_enabled": True, "mode": "power"})
    service = ForecastService(client=GapClient(), storage=storage)
    result = await service.get_merged_forecast(_config(), variable="temperature")

    fetches = storage.list_archived_fetches(LOCATION.latitude, LOCATION.longitude)
    assert len(fetches) == 1
    fetch = storage.get_archived_fetch(fetches[0]["id"])
    assert fetch["mode"] == "power"
    assert fetch["layout_id"] == "default"  # no own layout (#203)
    assert fetch["latitude"] == round(LOCATION.latitude, 4)
    assert fetch["location"]["name"] == "Innsbruck"
    assert [m["id"] for m in fetch["chain"]["main"]] == ["icon_eu"]
    assert fetch["config_version_id"] is None
    assert fetch["meta"]["generated_at"] == result.generated_at
    series = {(s["chain"], s["model"], s["variable"]): s for s in fetch["series"]}
    temperature = series[("main", "ICON-EU", "temperature")]
    expected = [
        p for p in result.model_forecasts["ICON-EU"] if p.variable == "temperature"
    ]
    assert temperature["timestamps"] == sorted(p.timestamp for p in expected)
    assert len(temperature["values"]) == len(expected)
    assert _count(storage, "api_fetch_archive") > 0
    assert _count(storage, "model_run_availability") > 0


def test_series_per_model_run_and_quantity_with_cloud_profiles(storage):
    storage.update_settings({"archive_enabled": True})
    fetch_id = storage.record_forecast_fetch(_response(), _config())
    fetch = storage.get_archived_fetch(fetch_id)
    by_key = {(s["chain"], s["variable"]): s for s in fetch["series"]}
    temperature = by_key[("main", "temperature")]
    assert temperature["run_init_time"] == "2026-10-18T00:00:00Z"
    assert temperature["model_id"] == "icon_eu"
    assert temperature["timestamps"] == [
        "2026-10-18T00:00:00Z",
        "2026-10-18T01:00:00Z",
        "2026-10-18T02:00:00Z",
    ]
    assert temperature["values"] == [0.0, 1.0, 2.0]
    clouds = by_key[("cloud", "vertical_cloud_profile")]
    assert clouds["run_init_time"] == "2026-10-17T18:00:00Z"
    assert clouds["values"][0][0]["cloud_cover_percent"] == 40


def test_derived_quantities_are_never_stored(storage, monkeypatch):
    monkeypatch.setitem(
        QUANTITIES,
        "precipitation_rain_snow",
        Quantity(
            id="precipitation_rain_snow",
            label="Precipitation (rain/snow)",
            unit="mm",
            kind="interval",
            source="derived",
            downloadable=False,
        ),
    )
    storage.update_settings({"archive_enabled": True})
    derived = DataPoint(
        timestamp="2026-10-18T00:00:00Z",
        value=1.0,
        unit="mm",
        variable="precipitation_rain_snow",
        model="ICON-EU",
    )
    fetch_id = storage.record_forecast_fetch(_response([derived]), _config())
    variables = {s["variable"] for s in storage.get_archived_fetch(fetch_id)["series"]}
    assert "precipitation_rain_snow" not in variables
    assert "temperature" in variables


def _age_rows(storage, days):
    old = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conn = sqlite3.connect(storage.db_path)
    try:
        with conn:
            conn.execute("UPDATE forecast_fetch SET fetched_at = ?", (old,))
            conn.execute("UPDATE api_fetch_archive SET fetched_at = ?", (old,))
            conn.execute(
                "UPDATE model_run_availability SET recorded_at = ?", (old,)
            )
    finally:
        conn.close()


def _fill(storage):
    storage.record_forecast_fetch(_response(), _config())
    storage.archive_api_response("forecast", {"models": "icon_eu"}, {})
    storage.record_model_availability(
        list(_response().model_availability.values()), LOCATION, None
    )


def test_prune_by_retention_covers_all_archive_tables(storage):
    storage.update_settings({"archive_enabled": True, "archive_retention_days": 7})
    _fill(storage)
    _age_rows(storage, 8)
    _fill(storage)  # recent rows survive
    storage.prune_archive()
    for table in ALL_TABLES:
        assert _count(storage, table) > 0, table
    assert _count(storage, "forecast_fetch") == 1
    assert _count(storage, "api_fetch_archive") == 1
    assert _count(storage, "model_run_availability") == 1
    fetch_ids = {f["id"] for f in storage.list_archived_fetches(47.2692, 11.4041)}
    conn = sqlite3.connect(storage.db_path)
    try:
        series_ids = {
            row[0] for row in conn.execute("SELECT fetch_id FROM forecast_series")
        }
    finally:
        conn.close()
    assert series_ids == fetch_ids


def test_retention_forever_keeps_everything(storage):
    storage.update_settings(
        {"archive_enabled": True, "archive_retention_days": None}
    )
    _fill(storage)
    _age_rows(storage, 5000)
    storage.prune_archive()
    assert _count(storage, "forecast_fetch") == 1


def test_pruning_still_applies_after_archiving_is_disabled(storage):
    storage.update_settings({"archive_enabled": True, "archive_retention_days": 30})
    _fill(storage)
    _age_rows(storage, 31)
    storage.update_settings({"archive_enabled": False})
    storage.prune_archive()
    for table in ALL_TABLES:
        assert _count(storage, table) == 0, table


def test_prune_runs_on_startup_and_then_daily(storage, monkeypatch):
    calls = []
    monkeypatch.setattr(
        storage, "prune_archive", lambda now=None: calls.append(now) or None
    )
    start = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)
    assert storage.prune_archive_if_due(start)
    storage._last_prune_at = start
    assert not storage.prune_archive_if_due(start + timedelta(hours=23))
    assert storage.prune_archive_if_due(start + timedelta(hours=24))
    assert len(calls) == 2


def test_api_prunes_on_startup(storage):
    storage.update_settings({"archive_enabled": True, "archive_retention_days": 7})
    _fill(storage)
    _age_rows(storage, 8)
    MeteogramAPI(storage=storage)
    assert _count(storage, "forecast_fetch") == 0


def test_delete_archive(storage):
    storage.update_settings({"archive_enabled": True})
    _fill(storage)
    storage.update_settings({"mode": "power"})
    assert MeteogramAPI(storage=storage).delete_archive() == {"success": True}
    for table in ALL_TABLES:
        assert _count(storage, table) == 0, table
    # Settings and configurations are not archive data.
    assert storage.get_settings()["mode"] == "power"
    assert storage.get_settings()["archive_enabled"] is True


def test_archive_stats_count_fetches_and_size(storage):
    assert storage.get_archive_stats() == {"fetches": 0, "bytes": 0}
    storage.update_settings({"archive_enabled": True})
    _fill(storage)
    stats = MeteogramAPI(storage=storage).get_archive_stats()
    assert stats["fetches"] == 1
    assert stats["bytes"] > 0
    storage.delete_archive()
    assert storage.get_archive_stats() == {"fetches": 0, "bytes": 0}


def test_shorter_retention_prunes_at_once(storage):
    storage.update_settings(
        {"archive_enabled": True, "archive_retention_days": 90}
    )
    _fill(storage)
    _age_rows(storage, 31)
    api = MeteogramAPI(storage=storage)
    assert _count(storage, "forecast_fetch") == 1
    api.update_settings({"archive_retention_days": 30})
    assert _count(storage, "forecast_fetch") == 0


def test_query_by_location_radius(storage):
    storage.update_settings({"archive_enabled": True})
    near = Location(name="Near", latitude=47.2742, longitude=11.4041)  # ~0.56 km
    far = Location(name="Far", latitude=47.2892, longitude=11.4041)  # ~2.2 km
    east = Location(name="East", latitude=47.2692, longitude=11.4241)  # ~1.5 km
    for loc in (LOCATION, near, far, east):
        storage.record_forecast_fetch(_response(), _config(loc))

    names = [
        f["location"]["name"]
        for f in storage.list_archived_fetches(47.26921, 11.40411)
    ]
    assert names == ["Near", "Innsbruck"]  # newest first
    wider = storage.list_archived_fetches(47.26921, 11.40411, radius_km=3)
    assert {f["location"]["name"] for f in wider} == {
        "Innsbruck",
        "Near",
        "Far",
        "East",
    }
    assert storage.get_archived_fetch(999) is None


def test_location_key_matches_location_history_rounding():
    assert storage_module.location_key(47.269214, 11.404109) == "47.2692_11.4041"


def test_archive_failure_does_not_break_forecast(storage):
    class BrokenStorage(Storage):
        def record_forecast_fetch(self, *args, **kwargs):
            raise sqlite3.OperationalError("disk full")

    import asyncio

    broken = BrokenStorage()
    result = asyncio.run(
        ForecastService(client=GapClient(), storage=broken).get_merged_forecast(
            _config(), variable="temperature"
        )
    )
    broken.close()
    assert any(p.value is not None for p in result.combined_forecast)
