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


@pytest.mark.asyncio
async def test_vertical_cloud_storage_and_service():
    storage = Storage(":memory:")
    service = ForecastService(storage=storage)

    loc = Location(
        name="Zurich", latitude=47.376, longitude=8.541, elevation=408
    )

    # Save mock vertical cloud forecast to storage
    mock_forecast = DetailedCloudForecast(
        location=loc,
        profiles=[
            VerticalCloudProfile(
                timestamp="2026-09-11T00:00:00Z",
                source_model_id="meteoswiss_icon_ch1",
                source_model_name="ICON-CH1",
                levels=[
                    VerticalCloudLevel(
                        pressure_hpa=1000,
                        altitude_m_asl=110,
                        cloud_cover_percent=20,
                    ),
                    VerticalCloudLevel(
                        pressure_hpa=850,
                        altitude_m_asl=1450,
                        cloud_cover_percent=80,
                    ),
                    VerticalCloudLevel(
                        pressure_hpa=500,
                        altitude_m_asl=5570,
                        cloud_cover_percent=40,
                    ),
                ],
            )
        ],
    )

    storage.save_vertical_cloud_forecast(
        loc, "meteoswiss_icon_ch1", mock_forecast
    )

    read_back = storage.read_vertical_cloud_forecast(
        loc, "meteoswiss_icon_ch1"
    )
    assert read_back is not None
    assert len(read_back.profiles) == 1
    assert read_back.profiles[0].levels[1].cloud_cover_percent == 80


@pytest.mark.asyncio
async def test_get_vertical_cloud_forecast_source_transitions():
    storage = Storage(":memory:")
    service = ForecastService(storage=storage)

    loc = Location(
        name="Zurich", latitude=47.376, longitude=8.541, elevation=408
    )

    std_10_levels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400]
    m_ch1 = WeatherModel(
        name="ICON-CH1",
        id="meteoswiss_icon_ch1",
        region="Switzerland / Alps",
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=1.1,
        max_forecast_horizon_hours=2,
        pressure_levels_hpa=std_10_levels,
    )
    m_global = WeatherModel(
        name="GFS Seamless",
        id="gfs_seamless",
        region="Global",
        supports_vertical_cloud_profile=True,
        spatial_resolution_km=13.0,
        max_forecast_horizon_hours=10,
        pressure_levels_hpa=std_10_levels,
    )

    # Seed mock storage forecasts for both models
    storage.save_vertical_cloud_forecast(
        loc,
        "meteoswiss_icon_ch1",
        DetailedCloudForecast(
            location=loc,
            profiles=[
                VerticalCloudProfile(
                    timestamp="2026-09-11T00:00:00Z",
                    source_model_id="meteoswiss_icon_ch1",
                    source_model_name="ICON-CH1",
                    levels=[
                        VerticalCloudLevel(
                            pressure_hpa=850,
                            altitude_m_asl=1450,
                            cloud_cover_percent=50,
                        )
                    ],
                ),
                VerticalCloudProfile(
                    timestamp="2026-09-11T01:00:00Z",
                    source_model_id="meteoswiss_icon_ch1",
                    source_model_name="ICON-CH1",
                    levels=[
                        VerticalCloudLevel(
                            pressure_hpa=850,
                            altitude_m_asl=1450,
                            cloud_cover_percent=60,
                        )
                    ],
                ),
            ],
        ),
    )

    storage.save_vertical_cloud_forecast(
        loc,
        "gfs_seamless",
        DetailedCloudForecast(
            location=loc,
            profiles=[
                VerticalCloudProfile(
                    timestamp="2026-09-11T03:00:00Z",
                    source_model_id="gfs_seamless",
                    source_model_name="GFS Seamless",
                    levels=[
                        VerticalCloudLevel(
                            pressure_hpa=850,
                            altitude_m_asl=1450,
                            cloud_cover_percent=30,
                        )
                    ],
                ),
            ],
        ),
    )

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
