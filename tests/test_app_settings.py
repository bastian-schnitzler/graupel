import json

import pytest

import graupel.API as bridge
from graupel.data.settings import DEFAULT_SETTINGS
from graupel.data.storage import Storage


@pytest.fixture
def storage():
    store = Storage(":memory:")
    yield store
    store.close()


def test_defaults_on_fresh_database(storage):
    assert storage.get_settings() == {
        "mode": "normal",
        "archive_enabled": False,
        "archive_retention_days": 365,
    }


def test_defaults_are_not_shared_between_calls(storage):
    storage.get_settings()["mode"] = "power"
    assert storage.get_settings()["mode"] == "normal"
    assert DEFAULT_SETTINGS["mode"] == "normal"



def test_round_trip_survives_reopen(tmp_path):
    path = str(tmp_path / "meteogram.db")
    first = Storage(path)
    result = first.update_settings(
        {
            "mode": "power",
            "archive_enabled": False,
            "archive_retention_days": None,
        }
    )
    first.close()
    assert result["mode"] == "power"

    reopened = Storage(path)
    try:
        assert reopened.get_settings() == {
            "mode": "power",
            "archive_enabled": False,
            "archive_retention_days": None,
        }
    finally:
        reopened.close()


def test_partial_update_keeps_other_keys(storage):
    storage.update_settings({"mode": "power"})
    settings = storage.update_settings({"archive_retention_days": 30})
    assert settings["mode"] == "power"
    assert settings["archive_retention_days"] == 30


@pytest.mark.parametrize(
    "changes",
    [
        {"mode": "expert"},
        {"mode": None},
        {"archive_enabled": 1},
        {"archive_enabled": "true"},
        {"archive_retention_days": 14},
        {"archive_retention_days": "30"},
        {"archive_retention_days": True},
        # Removed with #203: one default layout instead of a global one.
        {"global_layout_id": "power-default"},
        {"unknown_key": 1},
        # Removed with #139: every registered quantity is fetched.
        {"archive_quantities": ["cape"]},
        {"mode": "power", "archive_enabled": "yes"},
    ],
)
def test_invalid_values_are_rejected_and_nothing_is_stored(storage, changes):
    with pytest.raises(ValueError):
        storage.update_settings(changes)
    assert storage.get_settings() == DEFAULT_SETTINGS


def test_invalid_stored_row_reads_as_default(storage):
    with storage._db_connection() as conn:
        with conn:
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?)",
                ("mode", json.dumps("expert")),
            )
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?)",
                ("retired_key", json.dumps(1)),
            )
    assert storage.get_settings() == DEFAULT_SETTINGS


def test_bridge_exposes_settings():
    api = bridge.API(storage_path=":memory:")
    try:
        assert api.get_settings()["mode"] == "normal"
        assert api.update_settings({"mode": "power"})["mode"] == "power"
        assert api.get_settings()["mode"] == "power"
        with pytest.raises(ValueError):
            api.update_settings({"mode": "expert"})
    finally:
        api.storage.close()


# Start mode (system.md §3.1, §13): decided once on the first settings read.


def _api(storage):
    from graupel.data.api import MeteogramAPI

    return MeteogramAPI(storage=storage)


def test_new_install_starts_in_normal_mode(storage):
    api = _api(storage)
    assert api.get_settings()["mode"] == "normal"
    # Seeding the defaults afterwards does not change the decision.
    api.get_configurations()
    assert api.get_settings()["mode"] == "normal"


def test_untouched_seeded_defaults_start_in_normal_mode(storage):
    from graupel.data.api import init_default_configurations

    init_default_configurations(storage)
    assert _api(storage).get_settings()["mode"] == "normal"


def test_upgrade_with_user_configurations_starts_in_power_mode(storage):
    from graupel.data.api import init_default_configurations

    configs = init_default_configurations(storage)
    edited = configs[0]
    edited.name = "My Alps"
    storage.update(edited)
    assert _api(storage).get_settings()["mode"] == "power"


def test_edited_horizon_counts_as_user_configuration(storage):
    from graupel.data.api import init_default_configurations

    configs = init_default_configurations(storage)
    edited = configs[1]
    edited.main_model_chain[0].max_forecast_horizon_hours -= 6
    edited.model_chain = edited.main_model_chain
    storage.update(edited)
    assert _api(storage).get_settings()["mode"] == "power"


def test_stored_mode_wins_over_configurations(storage):
    from graupel.data.api import init_default_configurations

    configs = init_default_configurations(storage)
    storage.update_settings({"mode": "normal"})
    configs[0].name = "My Alps"
    storage.update(configs[0])
    assert _api(storage).get_settings()["mode"] == "normal"


def test_switching_mode_keeps_configurations(storage):
    api = _api(storage)
    before = api.get_configurations()
    api.update_settings({"mode": "power"})
    api.update_settings({"mode": "normal"})
    assert api.get_configurations() == before
    assert api.get_settings()["mode"] == "normal"
