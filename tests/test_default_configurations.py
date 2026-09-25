import pytest
import uuid
from graupel.data.storage import Storage
from graupel.data.service import ForecastService
from graupel.data.api import MeteogramAPI
from graupel.data.models import Location, WeatherModel, MeteogramConfig
from tests.test_service import MockOpenMeteoClient


@pytest.fixture
def storage():
    db_name = f"file:memdb_{uuid.uuid4().hex}?mode=memory&cache=shared"
    return Storage(db_name)


@pytest.fixture
def api(storage):
    client = MockOpenMeteoClient()
    service = ForecastService(client=client)
    return MeteogramAPI(storage=storage, service=service)


def test_empty_database_creates_exactly_5_configurations(api):
    """Completely empty database -> exactly 5 default configurations are created."""
    configs = api.get_configurations()
    assert len(configs) == 5

    expected_names = [
        "Nordalpen",
        "Ostalpen",
        "Dolomiten",
        "Westalpen",
        "Westalpen",
    ]
    actual_names = [c["name"] for c in configs]
    assert actual_names == expected_names


def test_second_startup_creates_no_duplicates(storage, api):
    """Second startup / second get_configurations call -> still exactly 5 configurations, no duplicates."""
    first_run = api.get_configurations()
    assert len(first_run) == 5

    # Simulate second application start with the same underlying database
    second_api = MeteogramAPI(storage=storage)
    second_run = second_api.get_configurations()
    assert len(second_run) == 5
    assert [c["id"] for c in second_run] == [c["id"] for c in first_run]


def test_prepopulated_database_receives_no_default_configurations(storage):
    """Database already containing at least one configuration -> no automatic defaults are added."""
    custom_loc = Location(name="Custom Peak", latitude=46.0, longitude=10.0)
    custom_cfg = MeteogramConfig(
        name="User Custom Config",
        location=custom_loc,
        model_chain=[WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)],
    )
    storage.create(custom_cfg)

    api = MeteogramAPI(storage=storage)
    configs = api.get_configurations()

    assert len(configs) == 1
    assert configs[0]["name"] == "User Custom Config"


def test_model_chains_and_ordering_are_correct_for_every_generated_configuration(api):
    """Model chains, ordering, IDs, display names, and horizons are correct for every default configuration."""
    configs = api.get_configurations()
    config_map = {c["name"]: c for c in configs}

    expected_configs = [
        {
            "name": "Nordalpen",
            "loc_name": "Zugspitze",
            "main": [
                ("icon_d2", "ICON-D2", 48),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs", "ECMWF IFS HRES 9km", 345),
            ],
            "cloud": [
                ("icon_d2", "ICON-D2", 48),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs025", "ECMWF IFS 0.25°", 345),
            ],
        },
        {
            "name": "Ostalpen",
            "loc_name": "Watzmann",
            "main": [
                ("geosphere_arome_austria", "GeoSphere AROME Austria", 60),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs", "ECMWF IFS HRES 9km", 345),
            ],
            "cloud": [
                ("icon_d2", "ICON-D2", 48),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs025", "ECMWF IFS 0.25°", 345),
            ],
        },
        {
            "name": "Dolomiten",
            "loc_name": "Ortler",
            "main": [
                ("italia_meteo_arpae_icon_2i", "ItaliaMeteo ARPAE ICON-2i", 67),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs", "ECMWF IFS HRES 9km", 345),
            ],
            "cloud": [
                ("icon_d2", "ICON-D2", 48),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs025", "ECMWF IFS 0.25°", 345),
            ],
        },
        {
            "name": "Westalpen",
            "loc_name": "Matterhorn",
            "main": [
                ("meteoswiss_icon_ch1", "MeteoSwiss ICON CH1", 33),
                ("meteoswiss_icon_ch2", "MeteoSwiss ICON CH2", 120),
                ("ecmwf_ifs", "ECMWF IFS HRES 9km", 345),
            ],
            "cloud": [
                ("icon_d2", "ICON-D2", 48),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs025", "ECMWF IFS 0.25°", 345),
            ],
        },
        {
            "name": "Westalpen",
            "loc_name": "Mont Blanc",
            "main": [
                ("meteofrance_arome_france_hd", "AROME France HD", 46),
                ("meteoswiss_icon_ch2", "MeteoSwiss ICON CH2", 120),
                ("ecmwf_ifs", "ECMWF IFS HRES 9km", 345),
            ],
            "cloud": [
                ("meteofrance_arome_france", "AROME France", 46),
                ("icon_eu", "ICON-EU", 120),
                ("ecmwf_ifs025", "ECMWF IFS 0.25°", 345),
            ],
        },
    ]

    for idx, expected in enumerate(expected_configs):
        cfg = configs[idx]
        assert cfg["name"] == expected["name"]
        assert cfg["location"]["name"] == expected["loc_name"]

        # Verify main model chain
        main_chain = cfg.get("main_model_chain") or cfg.get("model_chain")
        assert main_chain is not None
        actual_main = [(m["id"], m["name"], m["max_forecast_horizon_hours"]) for m in main_chain]
        assert actual_main == expected["main"], f"Main chain mismatch for {expected['name']} ({expected['loc_name']}): expected {expected['main']}, got {actual_main}"

        # Verify cloud model chain
        cloud_chain = cfg.get("cloud_model_chain")
        assert cloud_chain is not None
        actual_cloud = [(m["id"], m["name"], m["max_forecast_horizon_hours"]) for m in cloud_chain]
        assert actual_cloud == expected["cloud"], f"Cloud chain mismatch for {expected['name']} ({expected['loc_name']}): expected {expected['cloud']}, got {actual_cloud}"
