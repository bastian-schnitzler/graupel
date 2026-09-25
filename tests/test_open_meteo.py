import pytest
import respx
import httpx
from graupel.data.models import Location, WeatherModel, MeteogramConfig
from graupel.data.open_meteo import OpenMeteoClient, to_open_meteo_model


@pytest.fixture
def sample_config():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=120),
    ]
    return MeteogramConfig(
        name="Berlin Setup", location=loc, model_chain=models
    )


@pytest.mark.asyncio
async def test_fetch_data_success(sample_config):
    client = OpenMeteoClient()

    mock_response = {
        "latitude": 52.52,
        "longitude": 13.405,
        "hourly": {
            "time": ["2024-01-01T00:00", "2024-01-01T01:00"],
            "temperature_2m": [2.5, 2.7],
        },
    }

    with respx.mock:
        respx.get("https://api.open-meteo.com/v1/forecast").mock(
            return_value=httpx.Response(200, json=mock_response)
        )

        result = await client.fetch_data(sample_config)

        assert result["latitude"] == 52.52
        assert "hourly" in result
        assert result["hourly"]["temperature_2m"] == [2.5, 2.7]
        assert (
            respx.calls.last.request.url.params["models"] == "icon_d2,icon_eu"
        )
        assert respx.calls.last.request.url.params["timezone"] == "GMT"


@pytest.mark.parametrize(
    ("display_name", "api_names"),
    [
        ("ICON-D2", ["icon_d2"]),
        ("ICON-EU", ["icon_eu"]),
        ("GFS", ["gfs_seamless", "ncep_gfs_seamless"]),
        ("ECMWF-IFS", ["ecmwf_ifs"]),
        ("icon_d2", ["icon_d2"]),
    ],
)
def test_model_name_mapping(display_name, api_names):
    assert to_open_meteo_model(display_name) in api_names


@pytest.mark.asyncio
async def test_fetch_data_error(sample_config):
    client = OpenMeteoClient(max_retries=0)

    with respx.mock:
        respx.get("https://api.open-meteo.com/v1/forecast").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )

        with pytest.raises(httpx.HTTPStatusError):
            await client.fetch_data(sample_config)


@pytest.mark.asyncio
async def test_fetch_data_retries_temporary_server_error(sample_config):
    client = OpenMeteoClient(max_retries=1, retry_backoff=0)
    successful_response = {
        "latitude": 52.52,
        "longitude": 13.405,
        "hourly": {
            "time": ["2024-01-01T00:00"],
            "temperature_2m": [2.5],
        },
    }

    with respx.mock:
        route = respx.get("https://api.open-meteo.com/v1/forecast").mock(
            side_effect=[
                httpx.Response(503, text="Service Unavailable"),
                httpx.Response(200, json=successful_response),
            ]
        )

        result = await client.fetch_data(
            sample_config, variables=["temperature"]
        )

    assert route.call_count == 2
    assert result["hourly"]["temperature_2m"] == [2.5]


def test_get_model_catalog():
    from graupel.data.open_meteo import get_model_catalog

    catalog = get_model_catalog()
    assert isinstance(catalog, list)
    assert len(catalog) > 0
    # verify ICON-D2 is in catalog
    icon_d2 = next(m for m in catalog if m.name == "ICON-D2")
    assert icon_d2 is not None
    assert icon_d2.id == "icon_d2"
    assert "missing_variables" in icon_d2.model_dump()
    assert len(icon_d2.missing_variables) == 0  # It supports all 10


def test_unsuitable_model_filtered_in_api():
    from graupel.data.api import MeteogramAPI

    api = MeteogramAPI()
    models = api.get_models()
    # Unsuitable Model has only 1 variable, so it should be filtered out
    assert not any(m["name"] == "Unsuitable Model" for m in models)


@pytest.mark.asyncio
async def test_fetch_data_with_unquoted_nan_response():
    client = OpenMeteoClient()
    raw_nan_response = (
        '{"latitude":nan,"longitude":nan,"generationtime_ms":0.004}'
    )

    with respx.mock:
        respx.get("https://api.open-meteo.com/v1/forecast").mock(
            return_value=httpx.Response(200, text=raw_nan_response)
        )
        res = await client._get({"models": "italia_meteo_arpae_icon_2i"})
        assert res["latitude"] is None
        assert res["longitude"] is None


def test_cloud_compatible_model_filtering_by_pressure_levels():
    from graupel.data.open_meteo import (
        is_cloud_compatible_model,
        get_model_catalog,
        get_default_cloud_model,
    )

    catalog = get_model_catalog()

    # 1. Default cloud model is ECMWF IFS 0.25° and is cloud compatible
    default_cloud = get_default_cloud_model()
    assert "IFS 0.25" in default_cloud.name
    assert is_cloud_compatible_model(default_cloud) is True
    assert len(default_cloud.pressure_levels_hpa) >= 10

    # 2. Models with >= 10 levels qualify
    icon_d2 = next(m for m in catalog if m.id == "icon_d2")
    assert is_cloud_compatible_model(icon_d2) is True
    assert len(icon_d2.pressure_levels_hpa) == 19

    ifs_025 = next(m for m in catalog if m.id == "ecmwf_ifs025")
    assert is_cloud_compatible_model(ifs_025) is True
    assert len(ifs_025.pressure_levels_hpa) == 13

    arome = next(m for m in catalog if m.id == "meteofrance_arome_france")
    assert is_cloud_compatible_model(arome) is True
    assert len(arome.pressure_levels_hpa) == 29

    # 3. ItaliaMeteo ICON-2i has only 6 levels (< 10) -> Disqualified
    icon_2i = next(m for m in catalog if m.id == "italia_meteo_arpae_icon_2i")
    assert len(icon_2i.pressure_levels_hpa) == 6
    assert is_cloud_compatible_model(icon_2i) is False

    # 4. Models without pressure levels (0 levels) -> Disqualified
    ch1 = next(m for m in catalog if m.id == "meteoswiss_icon_ch1")
    assert len(ch1.pressure_levels_hpa) == 0
    assert is_cloud_compatible_model(ch1) is False

    ifs_hres = next(m for m in catalog if m.id == "ecmwf_ifs")
    assert len(ifs_hres.pressure_levels_hpa) == 0
    assert is_cloud_compatible_model(ifs_hres) is False
