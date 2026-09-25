import pytest
from graupel.data.models import RawForecastData, DataPoint
from graupel.data.harmonizer import Harmonizer


def test_normalize_variable():
    assert Harmonizer.normalize_variable("temperature") == "temperature"
    assert Harmonizer.normalize_variable("temperature_2m") == "temperature"
    assert Harmonizer.normalize_variable("temp_2m") == "temperature"
    assert Harmonizer.normalize_variable("temp") == "temperature"
    assert Harmonizer.normalize_variable("t2m") == "temperature"
    assert (
        Harmonizer.normalize_variable("apparent_temperature")
        == "apparent_temperature"
    )
    assert (
        Harmonizer.normalize_variable("apparent_temp")
        == "apparent_temperature"
    )
    assert (
        Harmonizer.normalize_variable("feels_like") == "apparent_temperature"
    )

    assert Harmonizer.normalize_variable("wind_speed") == "wind_speed"
    assert Harmonizer.normalize_variable("wind_speed_10m") == "wind_speed"
    assert Harmonizer.normalize_variable("windspeed_10m") == "wind_speed"

    assert Harmonizer.normalize_variable("wind_gusts") == "wind_gusts"
    assert Harmonizer.normalize_variable("wind_gusts_10m") == "wind_gusts"

    assert Harmonizer.normalize_variable("wind_direction") == "wind_direction"
    assert (
        Harmonizer.normalize_variable("winddirection_10m") == "wind_direction"
    )

    assert Harmonizer.normalize_variable("cloud_cover") == "cloud_cover"
    assert Harmonizer.normalize_variable("cloudcover") == "cloud_cover"

    assert Harmonizer.normalize_variable("precipitation") == "precipitation"
    assert Harmonizer.normalize_variable("precip") == "precipitation"

    assert (
        Harmonizer.normalize_variable("precipitation_probability")
        == "precipitation_probability"
    )
    assert (
        Harmonizer.normalize_variable("precip_prob")
        == "precipitation_probability"
    )

    assert Harmonizer.normalize_variable("unknown_var") == "unknown_var"


def test_convert_unit_temperature():
    # Celsius (no conversion)
    val, unit = Harmonizer.convert_value_and_unit(20.0, "°C", "temperature")
    assert val == 20.0
    assert unit == "°C"

    # Kelvin to Celsius
    val, unit = Harmonizer.convert_value_and_unit(293.15, "K", "temperature")
    assert val == 20.0
    assert unit == "°C"

    # Fahrenheit to Celsius
    val, unit = Harmonizer.convert_value_and_unit(68.0, "°F", "temperature")
    assert val == 20.0
    assert unit == "°C"


def test_convert_unit_wind_speed_and_gusts():
    # m/s to km/h
    val, unit = Harmonizer.convert_value_and_unit(10.0, "m/s", "wind_speed")
    assert val == 36.0
    assert unit == "km/h"

    # knots to km/h
    val, unit = Harmonizer.convert_value_and_unit(10.0, "knots", "wind_gusts")
    assert val == 18.52
    assert unit == "km/h"

    # mph to km/h
    val, unit = Harmonizer.convert_value_and_unit(10.0, "mph", "wind_speed")
    assert val == 16.09
    assert unit == "km/h"


def test_convert_unit_other_variables():
    # wind direction
    val, unit = Harmonizer.convert_value_and_unit(180.0, "°", "wind_direction")
    assert val == 180.0
    assert unit == "°"

    # cloud cover
    val, unit = Harmonizer.convert_value_and_unit(75.0, "%", "cloud_cover")
    assert val == 75.0
    assert unit == "%"

    # precipitation
    val, unit = Harmonizer.convert_value_and_unit(2.5, "mm", "precipitation")
    assert val == 2.5
    assert unit == "mm"

    # precipitation probability
    val, unit = Harmonizer.convert_value_and_unit(
        80.0, "%", "precipitation_probability"
    )
    assert val == 80.0
    assert unit == "%"


def test_harmonize_raw_data():
    raw = RawForecastData(
        model_name="ICON-D2",
        fetch_time="2024-01-01T00:00:00Z",
        timestamps=["2024-01-01T00:00", "2024-01-01T01:00"],
        values=[293.15, None],
        unit="K",
        variable="temp_2m",
        max_horizon_hours=48,
    )

    pts = Harmonizer.harmonize_raw_data(raw)
    assert len(pts) == 2

    assert isinstance(pts[0], DataPoint)
    assert pts[0].timestamp == "2024-01-01T00:00:00Z"
    assert pts[0].value == 20.0
    assert pts[0].unit == "°C"
    assert pts[0].variable == "temperature"
    assert pts[0].model == "ICON-D2"

    assert pts[1].value is None
    assert pts[1].unit == "°C"


def test_harmonize_preserves_missing_hour_and_pads_short_value_array(caplog):
    raw = RawForecastData(
        model_name="GFS Seamless",
        fetch_time="2026-09-14T00:00:00Z",
        timestamps=[
            "2026-09-14T14:00:00Z",
            "2026-09-14T16:00:00Z",
            "2026-09-14T17:00:00Z",
        ],
        values=[14.0, 16.0],
        unit="°C",
        variable="temperature_2m",
        max_horizon_hours=384,
    )

    points = Harmonizer.harmonize_raw_data(raw)

    assert [point.timestamp for point in points] == [
        "2026-09-14T14:00:00Z",
        "2026-09-14T16:00:00Z",
        "2026-09-14T17:00:00Z",
    ]
    assert [point.value for point in points] == [14.0, 16.0, None]
    assert "non-hourly timestamp gap" in caplog.text
    assert "timestamp/value length mismatch" in caplog.text
