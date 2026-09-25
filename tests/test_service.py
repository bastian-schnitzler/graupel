import pytest
from datetime import datetime, timedelta, timezone
from graupel.data.models import Location, WeatherModel, MeteogramConfig
from graupel.data.service import (
    ForecastService,
    get_hours_since_midnight,
    get_past_hours_for_yesterday,
    get_yesterday_midnight_utc,
)
from graupel.data.open_meteo import OpenMeteoClient
from graupel.data.timeline import canonical_timestamp, parse_timestamp


class MockOpenMeteoClient(OpenMeteoClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model_calls = []

    async def _get(self, params: dict):
        self.last_params = params
        self.model_calls.append(params)
        model = params.get("models", "best_match")
        hourly_param = params.get("hourly", "temperature_2m")
        vars_requested = hourly_param.split(",")
        now_utc = datetime.now(timezone.utc)
        loc = Location(
            name="Test",
            latitude=params.get("latitude", 0.0),
            longitude=params.get("longitude", 0.0),
        )
        base_time = get_yesterday_midnight_utc(loc, now_utc)

        sample_count = params.get("past_hours", 0) + params.get(
            "forecast_hours", 24
        )
        timestamps = [
            (base_time + timedelta(hours=i)).isoformat()
            for i in range(sample_count)
        ]

        hourly_dict = {"time": timestamps}
        units_dict = {}

        for var in vars_requested:
            values = []
            for i in range(sample_count):
                if model == "icon_d2":
                    values.append(10.0 + i)  # 10 to 33
                elif model == "icon_eu":
                    values.append(20.0 + i)  # 20 to 43
                else:
                    values.append(30.0 + i)
            hourly_dict[var] = values

            if "temp" in var or "temperature" in var:
                units_dict[var] = "°C"
            elif "wind" in var and "direction" not in var:
                units_dict[var] = "km/h"
            elif "direction" in var:
                units_dict[var] = "°"
            elif "precip" in var and "prob" not in var:
                units_dict[var] = "mm"
            else:
                units_dict[var] = "%"

        return {"hourly": hourly_dict, "hourly_units": units_dict}


@pytest.fixture
def mock_client():
    return MockOpenMeteoClient()


@pytest.fixture
def config():
    loc = Location(name="Test", latitude=0.0, longitude=0.0)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    return MeteogramConfig(
        name="Test Config", location=loc, model_chain=models
    )


@pytest.mark.asyncio
async def test_forecast_service_merging(mock_client, config):
    service = ForecastService(client=mock_client)
    result = await service.get_merged_forecast(config, variable="temperature")

    assert len(result.raw_data) == 1 or len(result.raw_data) == 2
    assert "ICON-D2" in result.model_forecasts
    assert "ICON-EU" in result.model_forecasts

    # Individual model series checks
    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )

    icon_d2_series = result.model_forecasts["ICON-D2"]
    assert len(icon_d2_series) == past_hours_before_t_now + 10
    assert icon_d2_series[0].model == "ICON-D2"
    assert icon_d2_series[0].value == 10.0

    icon_eu_series = result.model_forecasts["ICON-EU"]
    assert len(icon_eu_series) == past_hours_before_t_now + 24
    assert icon_eu_series[0].model == "ICON-EU"
    assert icon_eu_series[0].value == 20.0

    # Combined series checks
    combined = result.combined_forecast
    assert len(combined) == past_hours_before_t_now + 24

    for i in range(past_hours_before_t_now + 24):
        pt = combined[i]
        if i < past_hours_before_t_now + 10:
            assert pt.model == "ICON-D2"
            assert pt.value == 10.0 + i
        else:
            assert pt.model == "ICON-EU"
            assert pt.value == 20.0 + i


@pytest.mark.asyncio
async def test_forecast_service_zero_span_models(mock_client):
    loc = Location(name="Test", latitude=0.0, longitude=0.0)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=0),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=10),
        WeatherModel(name="GFS", max_forecast_horizon_hours=10),  # 0h span
        WeatherModel(name="ECMWF", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(
        name="Zero Span Config", location=loc, model_chain=models
    )

    service = ForecastService(client=mock_client)
    result = await service.get_merged_forecast(cfg, variable="temperature")

    combined = result.combined_forecast
    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    assert len(combined) == past_hours_before_t_now + 24

    for i in range(past_hours_before_t_now + 24):
        pt = combined[i]
        # ICON-D2 has 0h span -> [0h, 10h) must be ICON-EU.
        if i < past_hours_before_t_now + 10:
            assert pt.model == "ICON-EU"
        else:
            # GFS has 0h span -> the +10h boundary belongs to ECMWF.
            assert pt.model == "ECMWF"


@pytest.mark.asyncio
async def test_forecast_service_all_variables(mock_client, config):
    service = ForecastService(client=mock_client)
    result = await service.get_merged_forecast(config)

    assert "ICON-D2" in result.model_forecasts
    assert "ICON-EU" in result.model_forecasts

    expected_vars = {
        "temperature",
        "apparent_temperature",
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
        "cape",
        "convective_inhibition",
        "lightning_potential",
        "weather_code",
    }

    # Verify model forecasts include points for all variables
    icon_d2_vars = {pt.variable for pt in result.model_forecasts["ICON-D2"]}
    assert icon_d2_vars == expected_vars

    # Verify combined forecast includes points for all variables
    combined_vars = {pt.variable for pt in result.combined_forecast}
    assert combined_vars == expected_vars

    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    expected_timestamps = past_hours_before_t_now + 24
    assert len(result.combined_forecast) == expected_timestamps * len(expected_vars)


@pytest.mark.asyncio
async def test_forecast_service_requests_total_cloud_cover_only():
    """Verify API request builder requests cloud_cover but never cloud_cover_low/mid/high."""
    recorded_params = []

    class ParamCaptureClient(OpenMeteoClient):
        async def _get(self, params: dict):
            recorded_params.append(params)
            # Return minimal mock response
            now = datetime.now()
            hours = [
                (now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00")
                for i in range(12)
            ]
            hourly = {
                "time": hours,
                "temperature_2m": [15.0] * 12,
                "cloud_cover": [50.0] * 12,
            }
            hourly_units = {"temperature_2m": "°C", "cloud_cover": "%"}
            return {"hourly": hourly, "hourly_units": hourly_units}

    service = ForecastService(client=ParamCaptureClient())
    loc = Location(name="Bern", latitude=46.94, longitude=7.44)
    cfg = MeteogramConfig(
        name="Test Cloud Request",
        location=loc,
        model_chain=[
            WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12)
        ],
    )

    await service.get_merged_forecast(cfg)

    # Inspect the captured query params for weather model forecast calls
    model_calls = [
        p
        for p in recorded_params
        if "hourly" in p and p.get("models") == "icon_d2"
    ]
    assert len(model_calls) > 0
    main_call = model_calls[0]
    hourly_param = main_call.get("hourly", "")
    requested_vars = hourly_param.split(",")

    # Must contain total cloud coverage
    assert "cloud_cover" in requested_vars
    # Must NOT contain any of the aggregate layer variables
    assert "cloud_cover_low" not in requested_vars
    assert "cloud_cover_mid" not in requested_vars
    assert "cloud_cover_high" not in requested_vars
    # Must have no empty query segments
    assert all(len(v.strip()) > 0 for v in requested_vars)


@pytest.mark.asyncio
async def test_forecast_service_uses_next_model_at_exact_boundary():
    class BoundaryClient(OpenMeteoClient):
        async def _get(self, params: dict):
            model = params["models"]
            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Test",
                latitude=params.get("latitude", 0.0),
                longitude=params.get("longitude", 0.0),
            )
            base_time = get_yesterday_midnight_utc(loc, now_utc)
            sample_count = params.get("past_hours", 0) + params.get(
                "forecast_hours", 24
            )
            timestamps = [
                (base_time + timedelta(hours=i)).isoformat()
                for i in range(sample_count)
            ]

            if model == "icon_d2":
                values = [10.0 + i for i in range(sample_count)]
            else:
                values = [20.0 + i for i in range(sample_count)]

            return {
                "hourly": {"time": timestamps, "temperature_2m": values},
                "hourly_units": {"temperature_2m": "°C"},
            }

    client = BoundaryClient()
    loc = Location(name="Test", latitude=0.0, longitude=0.0)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(
        name="Boundary Test", location=loc, model_chain=models
    )
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")
    combined = result.combined_forecast

    now_utc = parse_timestamp(result.forecast_start_time)
    boundary = now_utc + timedelta(hours=10)
    pt10 = next(
        (
            p
            for p in combined
            if p.timestamp == canonical_timestamp(boundary)
        ),
        None,
    )
    assert pt10 is not None
    assert pt10.model == "ICON-EU"


@pytest.mark.asyncio
async def test_forecast_service_empty_model_produces_empty_segment():
    class PartialFailureClient(OpenMeteoClient):
        async def _get(self, params: dict):
            model = params.get("models", "")
            if "icon_ch1" in model.lower():
                raise RuntimeError(
                    "Open-Meteo API Error: No data is available for this location for model 'icon_ch1'"
                )

            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Test",
                latitude=params.get("latitude", 0.0),
                longitude=params.get("longitude", 0.0),
            )
            base_time = get_yesterday_midnight_utc(loc, now_utc)
            sample_count = params.get("past_hours", 0) + params.get(
                "forecast_hours", 24
            )
            timestamps = [
                (base_time + timedelta(hours=i)).isoformat()
                for i in range(sample_count)
            ]
            values = [20.0 + i for i in range(sample_count)]
            return {
                "hourly": {"time": timestamps, "temperature_2m": values},
                "hourly_units": {"temperature_2m": "°C"},
            }

    client = PartialFailureClient()
    loc = Location(name="Test Loc", latitude=50.0, longitude=8.0)
    models = [
        WeatherModel(
            name="MeteoSwiss ICON-CH1", max_forecast_horizon_hours=10
        ),
        WeatherModel(name="GFS Seamless", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(
        name="Partial Chain", location=loc, model_chain=models
    )
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")

    assert "MeteoSwiss ICON-CH1" in result.model_forecasts
    assert "GFS Seamless" in result.model_forecasts
    assert all(
        p.value is None for p in result.model_forecasts["MeteoSwiss ICON-CH1"]
    )

    combined = result.combined_forecast
    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    assert len(combined) == past_hours_before_t_now + 24

    # [0h, 10h) is ICON-CH1's specified range and remains empty.
    icon_ch1_pts = [p for p in combined if p.model == "MeteoSwiss ICON-CH1"]
    assert len(icon_ch1_pts) == past_hours_before_t_now + 10
    assert all(p.value is None for p in icon_ch1_pts)

    # The +10h boundary through +23h uses GFS Seamless.
    gfs_pts = [p for p in combined if p.model == "GFS Seamless"]
    assert len(gfs_pts) == 14
    assert all(p.value is not None for p in gfs_pts)


@pytest.mark.asyncio
async def test_forecast_service_all_models_fail_raises():
    class AllFailClient(OpenMeteoClient):
        async def _get(self, params: dict):
            raise RuntimeError("API Offline")

    client = AllFailClient()
    loc = Location(name="Test", latitude=0.0, longitude=0.0)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(name="Fail Config", location=loc, model_chain=models)
    service = ForecastService(client=client)

    with pytest.raises(RuntimeError, match="API Offline"):
        await service.get_merged_forecast(cfg, variable="temperature")


@pytest.mark.asyncio
async def test_forecast_service_later_model_empty_extends_horizon():
    class LaterModelFailClient(OpenMeteoClient):
        async def _get(self, params: dict):
            model = params.get("models", "")
            if model == "icon_eu":
                raise RuntimeError("No data for ICON-EU")

            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Test",
                latitude=params.get("latitude", 0.0),
                longitude=params.get("longitude", 0.0),
            )
            base_time = get_yesterday_midnight_utc(loc, now_utc)
            sample_count = params.get("past_hours", 0) + params.get(
                "forecast_hours", 12
            )
            timestamps = [
                (base_time + timedelta(hours=i)).isoformat()
                for i in range(sample_count)
            ]
            values = [15.0 + i for i in range(sample_count)]
            return {
                "hourly": {"time": timestamps, "temperature_2m": values},
                "hourly_units": {"temperature_2m": "°C"},
            }

    client = LaterModelFailClient()
    loc = Location(name="Test Loc", latitude=50.0, longitude=8.0)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(name="Chain Test", location=loc, model_chain=models)
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")
    combined = result.combined_forecast

    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    assert len(combined) == past_hours_before_t_now + 24

    d2_pts = [p for p in combined if p.model == "ICON-D2"]
    eu_pts = [p for p in combined if p.model == "ICON-EU"]

    assert len(d2_pts) == past_hours_before_t_now + 12
    assert all(p.value is not None for p in d2_pts)

    assert len(eu_pts) == 12
    assert all(p.value is None for p in eu_pts)


@pytest.mark.asyncio
async def test_forecast_service_variable_handover_on_model_run_end():
    class MissingProbClient(OpenMeteoClient):
        async def _get(self, params: dict):
            model = params.get("models", "")
            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Austria",
                latitude=params.get("latitude", 47.3),
                longitude=params.get("longitude", 11.4),
            )
            base_time = get_yesterday_midnight_utc(loc, now_utc)
            hourly_param = params.get("hourly", "")
            vars_requested = hourly_param.split(",")

            sample_count = params.get("past_hours", 0) + params.get(
                "forecast_hours", 20
            )

            past_hours_before_t_now = int(
                (now_utc.replace(minute=0, second=0, microsecond=0) - base_time).total_seconds() / 3600
            )
            if "geosphere" in model:
                # GeoSphere only produces past_hours + 6 hours (future hours 0..5)
                geo_count = past_hours_before_t_now + 6
                timestamps = [
                    (base_time + timedelta(hours=i)).isoformat()
                    for i in range(geo_count)
                ]
                hourly = {"time": timestamps}
                units = {}
                for v in vars_requested:
                    if v == "precipitation_probability":
                        hourly[v] = [None] * geo_count
                        units[v] = "%"
                    elif v == "temperature_2m":
                        hourly[v] = [10.0 + i for i in range(geo_count)]
                        units[v] = "°C"
                    else:
                        hourly[v] = [0.0] * geo_count
                        units[v] = ""
                return {"hourly": hourly, "hourly_units": units}
            else:
                timestamps = [
                    (base_time + timedelta(hours=i)).isoformat()
                    for i in range(sample_count)
                ]
                hourly = {"time": timestamps}
                units = {}
                for v in vars_requested:
                    if v == "precipitation_probability":
                        hourly[v] = [20.0 + i for i in range(sample_count)]
                        units[v] = "%"
                    elif v == "temperature_2m":
                        hourly[v] = [15.0 + i for i in range(sample_count)]
                        units[v] = "°C"
                    else:
                        hourly[v] = [0.0] * sample_count
                        units[v] = ""
                return {"hourly": hourly, "hourly_units": units}

    client = MissingProbClient()
    loc = Location(name="Austria", latitude=47.3, longitude=11.4)
    models = [
        WeatherModel(
            name="GeoSphere AROME Austria", max_forecast_horizon_hours=10
        ),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=20),
    ]
    cfg = MeteogramConfig(
        name="Handover Test", location=loc, model_chain=models
    )
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(
        cfg, variables=["temperature", "precipitation_probability"]
    )
    combined = result.combined_forecast

    now_utc = parse_timestamp(result.forecast_start_time)
    for i in range(6):
        ts = canonical_timestamp(now_utc + timedelta(hours=i))
        temp_pt = next(
            p
            for p in combined
            if p.timestamp == ts and p.variable == "temperature"
        )
        prob_pt = next(
            p
            for p in combined
            if p.timestamp == ts and p.variable == "precipitation_probability"
        )
        assert temp_pt.model == "GeoSphere AROME Austria"
        assert prob_pt.model == "GeoSphere AROME Austria"

    for i in range(6, 11):
        ts = canonical_timestamp(now_utc + timedelta(hours=i))
        temp_pt = next(
            p
            for p in combined
            if p.timestamp == ts and p.variable == "temperature"
        )
        prob_pt = next(
            p
            for p in combined
            if p.timestamp == ts and p.variable == "precipitation_probability"
        )
        assert temp_pt.model == "ICON-EU"
        assert prob_pt.model == "ICON-EU"


@pytest.mark.asyncio
async def test_forecast_service_sun_phases():
    class SunClient(OpenMeteoClient):
        def __init__(self):
            super().__init__()
            self.calls = []

        async def _get(self, params: dict):
            self.calls.append(params)
            base_time = datetime(2026, 9, 12, 0, 0, tzinfo=timezone.utc)
            timestamps = [
                (base_time + timedelta(hours=i)).isoformat() for i in range(24)
            ]
            return {
                "hourly": {"time": timestamps, "temperature_2m": [15.0] * 24},
                "hourly_units": {"temperature_2m": "°C"},
                "daily": {
                    "time": ["2026-09-12", "2026-09-13"],
                    "sunrise": ["2026-09-12T07:07", "2026-09-13T07:08"],
                    "sunset": ["2026-09-12T19:49", "2026-09-13T19:47"],
                },
            }

    client = SunClient()
    loc = Location(
        name="Lausanne",
        latitude=46.52,
        longitude=6.63,
        timezone="Europe/Zurich",
    )
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=24)]
    cfg = MeteogramConfig(name="Sun Test", location=loc, model_chain=models)
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")

    assert client.calls[0].get("timezone") == "GMT"
    assert client.calls[0].get("daily") == "sunrise,sunset"
    assert len(result.sun_phases) == 2
    assert result.sun_phases[0].day == "2026-09-12"
    assert result.sun_phases[0].sunrise == "2026-09-12T07:07:00Z"
    assert result.sun_phases[0].sunset == "2026-09-12T19:49:00Z"
    assert result.sun_phases[1].day == "2026-09-13"
    assert result.sun_phases[1].sunrise == "2026-09-13T07:08:00Z"
    assert result.sun_phases[1].sunset == "2026-09-13T19:47:00Z"


@pytest.mark.asyncio
async def test_forecast_service_sun_phases_fallback():
    class FallbackSunClient(OpenMeteoClient):
        def __init__(self):
            super().__init__()
            self.calls = []

        async def _get(self, params: dict):
            self.calls.append(params)
            if "hourly" in params:
                # Model request returns no daily
                base_time = datetime(2026, 9, 12, 0, 0, tzinfo=timezone.utc)
                timestamps = [
                    (base_time + timedelta(hours=i)).isoformat()
                    for i in range(24)
                ]
                return {
                    "hourly": {
                        "time": timestamps,
                        "temperature_2m": [15.0] * 24,
                    },
                    "hourly_units": {"temperature_2m": "°C"},
                }
            else:
                # Standalone sun phases fallback call
                return {
                    "daily": {
                        "time": ["2026-09-12"],
                        "sunrise": ["2026-09-12T07:07"],
                        "sunset": ["2026-09-12T19:49"],
                    }
                }

    client = FallbackSunClient()
    loc = Location(name="Test Loc", latitude=46.52, longitude=6.63)
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=24)]
    cfg = MeteogramConfig(
        name="Fallback Sun Test", location=loc, model_chain=models
    )
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")

    assert client.calls[0].get("timezone") == "GMT"
    assert len(result.sun_phases) == 1
    assert result.sun_phases[0].sunrise == "2026-09-12T07:07:00Z"
    assert result.sun_phases[0].sunset == "2026-09-12T19:49:00Z"


@pytest.mark.asyncio
async def test_forecast_service_16_day_sun_phases():
    class Sun16Client(OpenMeteoClient):
        def __init__(self):
            super().__init__()
            self.calls = []

        async def _get(self, params: dict):
            self.calls.append(params)
            if "daily" in params:
                days = [f"2026-09-{12 + i:02d}" for i in range(16)]
                sunrises = [f"{d}T07:00" for d in days]
                sunsets = [f"{d}T19:30" for d in days]
                return {
                    "daily": {
                        "time": days,
                        "sunrise": sunrises,
                        "sunset": sunsets,
                    }
                }
            return {"hourly": {"time": []}, "hourly_units": {}}

    client = Sun16Client()
    loc = Location(
        name="Zurich",
        latitude=47.37,
        longitude=8.54,
        timezone="Europe/Zurich",
    )
    service = ForecastService(client=client)
    periods = await service.fetch_sun_phases(loc, forecast_days=16)

    assert len(periods) == 16
    assert client.calls[0]["forecast_days"] == 16
    assert client.calls[0]["daily"] == "sunrise,sunset"
    assert client.calls[0]["timezone"] == "GMT"
    assert periods[0].day == "2026-09-12"
    assert periods[15].day == "2026-09-27"


@pytest.mark.asyncio
async def test_forecast_service_past_hours_anchored_horizon():
    from graupel.data.service import get_local_now

    loc = Location(
        name="Berlin",
        latitude=52.52,
        longitude=13.405,
        timezone="Europe/Berlin",
    )
    now_local = get_local_now(loc)
    today_str = now_local.strftime("%Y-%m-%d")
    expected_past_hours = get_past_hours_for_yesterday(loc)

    class PastHoursClient(OpenMeteoClient):
        def __init__(self):
            super().__init__()
            self.model_calls = []

        async def _get(self, params: dict):
            if "daily" in params:
                return {
                    "daily": {
                        "time": [today_str],
                        "sunrise": [f"{today_str}T06:30"],
                        "sunset": [f"{today_str}T19:30"],
                    }
                }

            self.model_calls.append(dict(params))
            model = params["models"]
            horizon = params.get("forecast_hours", 24)
            past_hours = params.get("past_hours", 0)

            now_utc = datetime.now(timezone.utc)
            base_midnight = get_yesterday_midnight_utc(loc, now_utc)
            total_hours = past_hours + horizon
            timestamps = [
                (base_midnight + timedelta(hours=i)).isoformat()
                for i in range(total_hours)
            ]
            temp_values = [
                10.0 + i if "d2" in model else 20.0 + i
                for i in range(total_hours)
            ]

            return {
                "hourly": {
                    "time": timestamps,
                    "temperature_2m": temp_values,
                },
                "hourly_units": {"temperature_2m": "°C"},
            }

    client = PastHoursClient()
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=30),
    ]
    cfg = MeteogramConfig(name="Past Test", location=loc, model_chain=models)
    service = ForecastService(client=client)

    result = await service.get_merged_forecast(cfg, variable="temperature")

    # Verify query parameters
    weather_calls = [
        c
        for c in client.model_calls
        if "temperature_2m" in c.get("hourly", "")
    ]
    assert len(weather_calls) == 2
    assert weather_calls[0]["past_hours"] == expected_past_hours
    assert weather_calls[0]["forecast_hours"] == 10

    # Verify forecast_start_time
    expected_t_now = canonical_timestamp(
        now_local.replace(minute=0, second=0, microsecond=0)
    )
    assert result.forecast_start_time == expected_t_now

    # Check timestamps start at yesterday midnight 00:00
    expected_yesterday_midnight = canonical_timestamp(
        get_yesterday_midnight_utc(loc, parse_timestamp(expected_t_now))
    )
    assert result.combined_forecast[0].timestamp == expected_yesterday_midnight

    # For past timestamps (< t_now), primary model must be ICON-D2
    past_pts = [
        p
        for p in result.combined_forecast
        if parse_timestamp(p.timestamp) < parse_timestamp(expected_t_now)
    ]
    for p in past_pts:
        assert p.model == "ICON-D2"

    # From t_now onwards, ICON-D2 must cover the 10 forecast hours
    future_pts = [
        p
        for p in result.combined_forecast
        if parse_timestamp(p.timestamp) >= parse_timestamp(expected_t_now)
    ]
    assert len(future_pts) >= 10
    for i, p in enumerate(future_pts[:10]):
        assert p.model == "ICON-D2"

    # At 10h from t_now, ICON-EU takes over
    if len(future_pts) > 10:
        assert future_pts[10].model == "ICON-EU"


@pytest.mark.asyncio
async def test_forecast_service_dual_chains_and_empty_cloud_chain():
    loc = Location(
        name="Berlin",
        latitude=52.52,
        longitude=13.405,
        timezone="Europe/Berlin",
    )
    main_models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=24)]

    # 1. Empty cloud chain: no cloud requests, vertical_cloud_forecast is None
    client_empty = MockOpenMeteoClient()
    service_empty = ForecastService(client=client_empty)
    cfg_empty = MeteogramConfig(
        name="No Clouds",
        location=loc,
        model_chain=main_models,
        cloud_model_chain=[],
    )
    res_empty = await service_empty.get_merged_forecast(cfg_empty)
    assert res_empty.vertical_cloud_forecast is None
    assert len(res_empty.vertical_cloud_transitions) == 0
    # Confirm no cloud calls were made
    cloud_calls = [
        c
        for c in client_empty.model_calls
        if "cloud_cover_1000hPa" in c.get("hourly", "")
    ]
    assert len(cloud_calls) == 0

    # 2. Dual chain: cloud model chain horizon longer than main chain (345h vs 24h)
    # The timeline and vertical cloud profile must be clamped to the main chain maximum horizon!
    cloud_models = [
        WeatherModel(
            name="ECMWF IFS 0.25°",
            id="ecmwf_ifs025",
            max_forecast_horizon_hours=345,
            pressure_levels_hpa=[
                1000,
                925,
                850,
                700,
                600,
                500,
                400,
                300,
                250,
                200,
                150,
                100,
                50,
            ],
        )
    ]
    client_dual = MockOpenMeteoClient()
    service_dual = ForecastService(client=client_dual)
    cfg_dual = MeteogramConfig(
        name="Dual Chains",
        location=loc,
        model_chain=main_models,
        cloud_model_chain=cloud_models,
    )
    res_dual = await service_dual.get_merged_forecast(cfg_dual)

    # Confirm cloud forecast was retrieved
    assert res_dual.vertical_cloud_forecast is not None
    # Main chain max horizon is 24h -> total timestamps <= 24 + past_hours + 1
    # Cloud profiles must be strictly bounded to the same timestamps
    assert len(res_dual.vertical_cloud_forecast.profiles) <= len(
        res_dual.combined_forecast
    )
    assert (
        "ECMWF IFS 0.25°" in res_dual.vertical_cloud_model_forecasts
        or "ecmwf_ifs025" in res_dual.vertical_cloud_model_forecasts
    )


@pytest.mark.asyncio
async def test_gfs_384_hour_window_reports_variable_specific_shortfall():
    class GfsCoverageClient(OpenMeteoClient):
        def __init__(self):
            super().__init__()
            self.weather_calls = []

        async def _get(self, params: dict):
            if "daily" in params:
                return {"daily": {"time": [], "sunrise": [], "sunset": []}}

            self.weather_calls.append(dict(params))
            past_hours = params.get("past_hours", 0)
            horizon = params["forecast_hours"]
            sample_count = past_hours + horizon
            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Berlin",
                latitude=52.52,
                longitude=13.405,
                timezone="Europe/Berlin",
            )
            start = get_yesterday_midnight_utc(loc, now_utc)
            past_hours_before_t_now = int(
                (now_utc.replace(minute=0, second=0, microsecond=0) - start).total_seconds() / 3600
            )
            sample_count = past_hours_before_t_now + horizon
            timestamps = [
                (start + timedelta(hours=index)).isoformat()
                for index in range(sample_count)
            ]
            requested = params["hourly"].split(",")
            hourly = {"time": timestamps}
            units = {}
            for variable in requested:
                if variable == "temperature_2m":
                    hourly[variable] = [1.0] * (sample_count - 10) + [None] * 10
                    units[variable] = "°C"
                elif variable == "precipitation_probability":
                    hourly[variable] = [50.0] * sample_count
                    units[variable] = "%"
                else:
                    hourly[variable] = [0.0] * sample_count
                    units[variable] = ""
            return {
                "timezone": "GMT",
                "hourly": hourly,
                "hourly_units": units,
            }
            requested = params["hourly"].split(",")
            hourly = {"time": timestamps}
            units = {}
            for variable in requested:
                if variable == "temperature_2m":
                    hourly[variable] = [1.0] * (sample_count - 10) + [None] * 10
                    units[variable] = "°C"
                elif variable == "precipitation_probability":
                    hourly[variable] = [50.0] * sample_count
                    units[variable] = "%"
                else:
                    hourly[variable] = [0.0] * sample_count
                    units[variable] = ""
            return {
                "timezone": "GMT",
                "hourly": hourly,
                "hourly_units": units,
            }

    client = GfsCoverageClient()
    config = MeteogramConfig(
        name="GFS coverage",
        location=Location(
            name="Berlin",
            latitude=52.52,
            longitude=13.405,
            timezone="Europe/Berlin",
        ),
        model_chain=[
            WeatherModel(
                name="GFS Seamless", max_forecast_horizon_hours=384
            )
        ],
        cloud_model_chain=[],
    )

    result = await ForecastService(client=client).get_merged_forecast(
        config,
        variables=["temperature", "precipitation_probability"],
    )

    call = client.weather_calls[0]
    assert call["models"] == "ncep_gfs_seamless"
    assert call["forecast_hours"] == 384
    assert call["timezone"] == "GMT"

    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    assert len(result.combined_forecast) == (past_hours_before_t_now + 384) * 2

    diagnostics = result.timeline_diagnostics["GFS Seamless"]
    temperature = diagnostics.variables["temperature"]
    probability = diagnostics.variables["precipitation_probability"]

    assert diagnostics.expected_end_exclusive == result.timeline_end
    assert temperature.sample_count == 384
    assert temperature.valid_sample_count == 374
    assert temperature.complete is False
    assert temperature.last_valid_timestamp < temperature.expected_last_timestamp
    assert probability.sample_count == 384
    assert probability.valid_sample_count == 384
    assert probability.complete is True


@pytest.mark.asyncio
async def test_missing_source_hour_does_not_shift_forecast_origin_or_later_values():
    class MissingHourClient(OpenMeteoClient):
        async def _get(self, params: dict):
            if "daily" in params:
                return {"daily": {"time": [], "sunrise": [], "sunset": []}}

            past_hours = params.get("past_hours", 0)
            horizon = params["forecast_hours"]
            now_utc = datetime.now(timezone.utc)
            loc = Location(
                name="Berlin",
                latitude=52.52,
                longitude=13.405,
                timezone="Europe/Berlin",
            )
            start = get_yesterday_midnight_utc(loc, now_utc)
            past_hours_before_t_now = int(
                (now_utc.replace(minute=0, second=0, microsecond=0) - start).total_seconds() / 3600
            )
            missing_index = past_hours_before_t_now + 2
            indices = [
                index
                for index in range(past_hours_before_t_now + horizon)
                if index != missing_index
            ]
            timestamps = [
                (start + timedelta(hours=index)).isoformat()
                for index in indices
            ]
            return {
                "timezone": "GMT",
                "hourly": {
                    "time": timestamps,
                    "temperature_2m": [float(index) for index in indices],
                },
                "hourly_units": {"temperature_2m": "°C"},
            }

    location = Location(
        name="Berlin",
        latitude=52.52,
        longitude=13.405,
        timezone="Europe/Berlin",
    )
    config = MeteogramConfig(
        name="Missing hour",
        location=location,
        model_chain=[
            WeatherModel(name="ICON-EU", max_forecast_horizon_hours=6)
        ],
        cloud_model_chain=[],
    )

    result = await ForecastService(client=MissingHourClient()).get_merged_forecast(
        config, variable="temperature"
    )

    now_utc = parse_timestamp(result.forecast_start_time)
    yesterday_midnight_utc = parse_timestamp(result.timeline_start)
    past_hours_before_t_now = int(
        (now_utc - yesterday_midnight_utc).total_seconds() / 3600
    )
    missing_time = now_utc + timedelta(hours=2)
    later_time = now_utc + timedelta(hours=3)

    assert result.forecast_start_time == canonical_timestamp(now_utc)
    missing_point = next(
        point
        for point in result.combined_forecast
        if point.timestamp == canonical_timestamp(missing_time)
    )
    later_point = next(
        point
        for point in result.combined_forecast
        if point.timestamp == canonical_timestamp(later_time)
    )
    assert missing_point.value is None
    assert later_point.value == float(past_hours_before_t_now + 3)

    coverage = result.timeline_diagnostics["ICON-EU"].variables["temperature"]
    assert coverage.complete is False
    assert len(coverage.spacing_anomalies) == 1


@pytest.mark.asyncio
async def test_get_merged_forecast_with_gmt_timezone_response():
    """Regression test: verify get_merged_forecast handles timezone='GMT' from provider response."""

    class GMTResponseClient(OpenMeteoClient):
        async def _get(self, params: dict):
            if "daily" in params:
                return {
                    "timezone": "GMT",
                    "daily": {
                        "time": ["2026-09-14"],
                        "sunrise": ["2026-09-14T06:00"],
                        "sunset": ["2026-09-14T18:00"],
                    },
                }

            now_utc = datetime.now(timezone.utc)
            loc = Location(name="Offenbach am Main", latitude=50.1, longitude=8.76)
            base_midnight = get_yesterday_midnight_utc(loc, now_utc)
            past_hours = params.get("past_hours", 0)
            horizon = params.get("forecast_hours", 24)
            sample_count = past_hours + horizon

            timestamps = [
                (base_midnight + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M")
                for i in range(sample_count)
            ]

            return {
                "timezone": "GMT",
                "hourly": {
                    "time": timestamps,
                    "temperature_2m": [15.0] * sample_count,
                },
                "hourly_units": {"temperature_2m": "°C"},
            }

    loc = Location(name="Offenbach am Main", latitude=50.1, longitude=8.76)
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12)]
    config = MeteogramConfig(
        name="Offenbach Test", location=loc, model_chain=models, cloud_model_chain=[]
    )

    service = ForecastService(client=GMTResponseClient())
    result = await service.get_merged_forecast(config, variable="temperature")

    assert len(result.combined_forecast) > 0
    assert result.combined_forecast[0].value == 15.0
    assert result.combined_forecast[0].timestamp.endswith("Z")


from zoneinfo import ZoneInfo


@pytest.mark.asyncio
async def test_yesterday_visible_range_for_different_current_times():
    """Regression test: verify start timestamp is identical for different current times on the same day."""
    loc = Location(
        name="Berlin",
        latitude=52.52,
        longitude=13.405,
        timezone="Europe/Berlin",
    )
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=30),
    ]
    cfg = MeteogramConfig(
        name="Regression Test Times", location=loc, model_chain=models
    )

    test_times = [
        datetime(2026, 9, 14, 0, 5, tzinfo=ZoneInfo("Europe/Berlin")),
        datetime(2026, 9, 14, 6, 0, tzinfo=ZoneInfo("Europe/Berlin")),
        datetime(2026, 9, 14, 12, 0, tzinfo=ZoneInfo("Europe/Berlin")),
        datetime(2026, 9, 14, 23, 59, tzinfo=ZoneInfo("Europe/Berlin")),
    ]

    expected_start_iso = "2026-09-12T22:00:00Z"  # Sun 13.09 00:00 CEST = Sat 12.09 22:00 UTC

    class TestTimesClient(OpenMeteoClient):
        async def _get(self, params: dict):
            if "daily" in params:
                return {"daily": {"time": [], "sunrise": [], "sunset": []}}

            past_hours = params.get("past_hours", 0)
            horizon = params["forecast_hours"]
            base = parse_timestamp(expected_start_iso)
            sample_count = past_hours + horizon
            timestamps = [
                (base + timedelta(hours=i)).isoformat()
                for i in range(sample_count)
            ]
            model = params.get("models", "")
            temp_vals = [
                10.0 + i if "d2" in model else 20.0 + i for i in range(sample_count)
            ]
            return {
                "timezone": "GMT",
                "hourly": {"time": timestamps, "temperature_2m": temp_vals},
                "hourly_units": {"temperature_2m": "°C"},
            }

    client = TestTimesClient()
    service = ForecastService(client=client)

    results = []
    for ref_local in test_times:
        ref_utc = ref_local.astimezone(timezone.utc)
        res = await service.get_merged_forecast(
            cfg, variable="temperature", reference_time=ref_utc
        )
        results.append((ref_local, res))

    # 1. In all cases the start timestamp must be identical for the same calendar day.
    first_start = results[0][1].timeline_start
    assert first_start == expected_start_iso
    for ref_local, res in results:
        assert res.timeline_start == expected_start_iso

        # 2. Model for yesterday must equal model for current day initial segment (ICON-D2)
        past_points = [
            p
            for p in res.combined_forecast
            if parse_timestamp(p.timestamp) < parse_timestamp(res.forecast_start_time)
        ]
        assert len(past_points) >= 24
        for p in past_points:
            assert p.model == "ICON-D2"

        # 3. Verify adding yesterday does not alter future model-boundary relative to forecast_start_time
        t_now = parse_timestamp(res.forecast_start_time)
        boundary_10h = canonical_timestamp(t_now + timedelta(hours=10))
        pt_at_10h = next(
            p for p in res.combined_forecast if p.timestamp == boundary_10h
        )
        assert pt_at_10h.model == "ICON-EU"

        # 4. End of forecast horizon remains t_now + 30h
        expected_end = canonical_timestamp(t_now + timedelta(hours=30))
        assert res.timeline_end == expected_end


@pytest.mark.asyncio
async def test_dst_yesterday_visible_range():
    """Test DST spring forward and fall back transitions to ensure calendar-aware local midnight calculations."""
    loc = Location(
        name="Berlin",
        latitude=52.52,
        longitude=13.405,
        timezone="Europe/Berlin",
    )
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=24)]
    cfg = MeteogramConfig(name="DST Test", location=loc, model_chain=models)

    # 1. Spring forward: 2026-03-29 (Berlin jumps 02:00 -> 03:00)
    # On Mon 30.03.2026 12:00 CEST, yesterday 00:00 local is Sun 29.03.2026 00:00 CET (+01:00 = 2026-03-28T23:00:00Z)
    now_spring = datetime(2026, 3, 30, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
    yesterday_spring = get_yesterday_midnight_utc(loc, now_spring.astimezone(timezone.utc))
    assert canonical_timestamp(yesterday_spring) == "2026-03-28T23:00:00Z"

    # 2. Fall back: 2026-10-25 (Berlin jumps 03:00 -> 02:00)
    # On Mon 26.10.2026 12:00 CET, yesterday 00:00 local is Sun 25.10.2026 00:00 CEST (+02:00 = 2026-10-24T22:00:00Z)
    now_fall = datetime(2026, 10, 26, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
    yesterday_fall = get_yesterday_midnight_utc(loc, now_fall.astimezone(timezone.utc))
    assert canonical_timestamp(yesterday_fall) == "2026-10-24T22:00:00Z"


@pytest.mark.asyncio
async def test_sun_phases_include_yesterday_with_timezone_conversion():
    class SunClient:
        async def _get(self, params):
            assert params["past_days"] == 2
            assert params["forecast_days"] == 16
            assert params["daily"] == "sunrise,sunset"
            return {"timezone": "Europe/Berlin", "daily": {
                "time": ["2026-09-15", "2026-09-16"],
                "sunrise": ["2026-09-15T06:59", "2026-09-16T07:01"],
                "sunset": ["2026-09-15T19:40", "2026-09-16T19:38"]}}
    periods = await ForecastService(client=SunClient()).fetch_sun_phases(
        Location(name="Alps", latitude=46, longitude=8, timezone="Europe/Berlin"))
    assert [p.day for p in periods] == ["2026-09-15", "2026-09-16"]
    assert periods[0].sunrise == "2026-09-15T04:59:00Z"
    assert periods[1].sunrise == "2026-09-16T05:01:00Z"


@pytest.mark.asyncio
async def test_convective_requests_follow_catalogue_and_absent_lpi_is_silent(mock_client, config, caplog):
    config.cloud_model_chain = []
    result = await ForecastService(client=mock_client).get_merged_forecast(config)
    calls = [p for p in mock_client.model_calls if p.get("models") in ("icon_d2", "icon_eu")]
    assert "lightning_potential" in calls[0]["hourly"].split(",")
    assert "lightning_potential" not in calls[1]["hourly"].split(",")
    for call in calls:
        assert {"cape", "convective_inhibition"} <= set(call["hourly"].split(","))
    assert not any("lightning_potential" in record.message for record in caplog.records)
    boundary = parse_timestamp(result.forecast_start_time) + timedelta(hours=10)
    for point in result.combined_forecast:
        if point.variable not in ("cape", "convective_inhibition", "lightning_potential"):
            continue
        expected_model = "ICON-D2" if parse_timestamp(point.timestamp) < boundary else "ICON-EU"
        assert point.model == expected_model
        assert point.unit == "J/kg"
        if point.variable == "lightning_potential" and expected_model == "ICON-EU":
            assert point.value is None
    raw_lpi = next(raw for raw in result.raw_data if raw.variable == "lightning_potential")
    assert raw_lpi.values[-1] > 30
    harmonized_lpi = [p for p in result.model_forecasts["ICON-D2"] if p.variable == "lightning_potential"][-1]
    assert harmonized_lpi.value > 30
    raw_index = raw_lpi.timestamps.index(harmonized_lpi.timestamp)
    assert harmonized_lpi.value == raw_lpi.values[raw_index]


@pytest.mark.asyncio
async def test_weather_codes_requested_and_missing_values_are_silent(config, caplog):
    class WeatherClient(MockOpenMeteoClient):
        async def _get(self, params):
            response = await super()._get(params)
            if params.get("models") == "icon_d2":
                response["hourly"]["weather_code"] = [95] * len(response["hourly"]["time"])
            else:
                response["hourly"].pop("weather_code", None)
                response["hourly_units"].pop("weather_code", None)
            return response
    client = WeatherClient()
    config.cloud_model_chain = []
    result = await ForecastService(client=client).get_merged_forecast(config)
    assert all("weather_code" in call["hourly"].split(",") for call in client.model_calls if "hourly" in call)
    boundary = parse_timestamp(result.forecast_start_time) + timedelta(hours=10)
    codes = [p for p in result.combined_forecast if p.variable == "weather_code"]
    assert codes
    for point in codes:
        if parse_timestamp(point.timestamp) < boundary:
            assert point.model == "ICON-D2"
            assert point.value == 95
        else:
            assert point.model == "ICON-EU"
            assert point.value is None
    assert not any("weather_code" in record.message for record in caplog.records)
