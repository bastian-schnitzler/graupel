import pytest
from datetime import datetime, timezone
from graupel.data.models import (
    Location,
    WeatherModel,
    DetailedCloudForecast,
    VerticalCloudProfile,
    VerticalCloudLevel,
)
from graupel.data.open_meteo import (
    resolve_vertical_cloud_source,
    is_location_in_model_coverage,
)
from graupel.data.service import ForecastService, estimate_altitude_m_asl
from graupel.data.storage import Storage


def test_location_coverage_checks():
    ch_loc = Location(name="Zurich", latitude=47.376, longitude=8.541)
    berlin_loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    ny_loc = Location(name="New York", latitude=40.712, longitude=-74.006)

    m_ch = WeatherModel(
        name="ICON-CH1",
        id="meteoswiss_icon_ch1",
        region="Switzerland / Alps",
        supports_vertical_cloud_profile=True,
    )
    m_eu = WeatherModel(
        name="ICON-EU",
        id="icon_eu",
        region="Europe",
        supports_vertical_cloud_profile=True,
    )
    m_global = WeatherModel(
        name="GFS Seamless",
        id="gfs_seamless",
        region="Global",
        supports_vertical_cloud_profile=True,
    )

    assert is_location_in_model_coverage(m_ch, ch_loc) is True
    assert is_location_in_model_coverage(m_ch, berlin_loc) is False

    assert is_location_in_model_coverage(m_eu, ch_loc) is True
    assert is_location_in_model_coverage(m_eu, berlin_loc) is True
    assert is_location_in_model_coverage(m_eu, ny_loc) is False

    assert is_location_in_model_coverage(m_global, ch_loc) is True
    assert is_location_in_model_coverage(m_global, ny_loc) is True


def test_resolve_vertical_cloud_source():
    ch_loc = Location(name="Zurich", latitude=47.376, longitude=8.541)
    berlin_loc = Location(name="Berlin", latitude=52.52, longitude=13.405)

    std_10_levels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400]
    m_ch1 = WeatherModel(
        name="ICON-CH1",
        id="meteoswiss_icon_ch1",
        region="Switzerland / Alps",
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=1.1,
        max_forecast_horizon_hours=33,
        pressure_levels_hpa=std_10_levels,
    )
    m_ch2 = WeatherModel(
        name="ICON-CH2",
        id="meteoswiss_icon_ch2",
        region="Switzerland / Alps",
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=2.1,
        max_forecast_horizon_hours=120,
        pressure_levels_hpa=std_10_levels,
    )
    m_global = WeatherModel(
        name="GFS Seamless",
        id="gfs_seamless",
        region="Global",
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=13.0,
        max_forecast_horizon_hours=384,
        pressure_levels_hpa=std_10_levels,
    )

    models = [m_ch1, m_ch2, m_global]
    start_time = "2026-09-11T00:00:00Z"

    # 1. Regional detailed model available for Switzerland at +10h
    best_0_33 = resolve_vertical_cloud_source(
        ch_loc, "2026-09-11T10:00:00Z", models, start_time=start_time
    )
    assert best_0_33 is not None
    assert best_0_33.id == "meteoswiss_icon_ch1"

    # 2. Regional horizon exceeded (+40h) -> falls back to next regional ICON-CH2
    best_40 = resolve_vertical_cloud_source(
        ch_loc, "2026-09-12T16:00:00Z", models, start_time=start_time
    )
    assert best_40 is not None
    assert best_40.id == "meteoswiss_icon_ch2"

    # 3. Horizon exceeded for all regional (+150h) -> falls back to global
    best_150 = resolve_vertical_cloud_source(
        ch_loc, "2026-09-17T06:00:00Z", models, start_time=start_time
    )
    assert best_150 is not None
    assert best_150.id == "gfs_seamless"

    # 4. Regional model outside geographical coverage (Berlin) -> skips ICON-CH1/CH2, picks global
    best_berlin = resolve_vertical_cloud_source(
        berlin_loc, "2026-09-11T10:00:00Z", models, start_time=start_time
    )
    assert best_berlin is not None
    assert best_berlin.id == "gfs_seamless"

    # 5. No detailed model available
    no_vcloud_models = [
        WeatherModel(
            name="Custom", id="c1", supports_vertical_cloud_profile=False
        )
    ]
    assert (
        resolve_vertical_cloud_source(
            ch_loc,
            "2026-09-11T10:00:00Z",
            no_vcloud_models,
            start_time=start_time,
        )
        is None
    )


def test_barometric_altitude_estimate():
    # 1000 hPa ~ 110m
    alt1000 = estimate_altitude_m_asl(1000)
    assert 50 <= alt1000 <= 200

    # 500 hPa ~ 5570m
    alt500 = estimate_altitude_m_asl(500)
    assert 5000 <= alt500 <= 6000


class _FakeCloudClient:
    """Serves fixed hourly 850 hPa cloud values per Open-Meteo model id."""

    def __init__(self, cloud_by_model):
        self.cloud_by_model = cloud_by_model
        self.calls = []

    async def _get(self, params):
        self.calls.append(params)
        series = self.cloud_by_model.get(params["models"], {})
        times = list(series)
        return {
            "timezone": "GMT",
            "hourly": {
                "time": times,
                "cloud_cover_850hPa": [series[t] for t in times],
                "geopotential_height_850hPa": [1450.0] * len(times),
            },
        }


def _cloud_model(name, model_id, horizon, region="Europe", resolution_km=7.0):
    # Cloud-chain eligibility requires at least 10 pressure levels.
    return WeatherModel(
        name=name,
        id=model_id,
        region=region,
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=resolution_km,
        max_forecast_horizon_hours=horizon,
        pressure_levels_hpa=[1000, 950, 925, 900, 850, 800, 700, 600, 500, 400],
    )


def _level_850(profile):
    return next(l for l in profile.levels if l.pressure_hpa == 850)


@pytest.mark.asyncio
async def test_vertical_cloud_forecast_is_fetched_live_without_sqlite_cache(
    tmp_path,
):
    import sqlite3

    db_path = tmp_path / "meteogram.db"
    conn = sqlite3.connect(db_path)
    try:
        # A database from an older version still contains the former cache.
        conn.execute(
            "CREATE TABLE vertical_cloud_forecasts (id TEXT PRIMARY KEY, data TEXT)"
        )
        conn.commit()
    finally:
        conn.close()

    storage = Storage(str(db_path))
    client = _FakeCloudClient({"icon_eu": {"2026-09-11T00:00": 80.0}})
    service = ForecastService(client=client, storage=storage)
    loc = Location(name="Zugspitze", latitude=47.4211, longitude=10.9853)
    model = _cloud_model("ICON-EU", "icon_eu", 6)

    first = await service.fetch_vertical_cloud_model_forecast(loc, model)
    client.cloud_by_model["icon_eu"] = {"2026-09-11T00:00": 20.0}
    second = await service.fetch_vertical_cloud_model_forecast(loc, model)

    assert len(client.calls) == 2
    assert _level_850(first.profiles[0]).cloud_cover_percent == 80
    assert _level_850(second.profiles[0]).cloud_cover_percent == 20

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    finally:
        conn.close()
    storage.close()
    assert "vertical_cloud_forecasts" not in tables


@pytest.mark.asyncio
async def test_get_vertical_cloud_forecast_source_transitions():
    loc = Location(
        name="Zurich", latitude=47.376, longitude=8.541, elevation=408
    )
    m_ch1 = _cloud_model(
        "ICON-CH1",
        "meteoswiss_icon_ch1",
        2,
        region="Switzerland / Alps",
        resolution_km=1.1,
    )
    m_global = _cloud_model(
        "GFS Seamless", "gfs_seamless", 10, region="Global", resolution_km=13.0
    )

    client = _FakeCloudClient(
        {
            "meteoswiss_icon_ch1": {
                "2026-09-11T00:00": 50.0,
                "2026-09-11T01:00": 60.0,
            },
            # Requests use the prefixed Open-Meteo id for GFS.
            "ncep_gfs_seamless": {"2026-09-11T03:00": 30.0},
        }
    )
    service = ForecastService(client=client, storage=Storage(":memory:"))

    timestamps = [
        "2026-09-11T00:00:00Z",
        "2026-09-11T01:00:00Z",
        "2026-09-11T03:00:00Z",
    ]
    vforecast, transitions = await service.get_vertical_cloud_forecast(
        loc, timestamps, [m_ch1, m_global]
    )

    assert len(vforecast.profiles) == 3
    assert vforecast.profiles[0].source_model_id == "meteoswiss_icon_ch1"
    assert vforecast.profiles[2].source_model_id == "gfs_seamless"
    assert len(transitions) == 1
    assert transitions[0].from_model == "meteoswiss_icon_ch1"
    assert transitions[0].to_model == "gfs_seamless"
