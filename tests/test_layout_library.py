"""Meteogram configurations (layout library, system.md §4.3, #168)."""

import copy
import json

import pytest

from graupel.data.api import MeteogramAPI
from graupel.data.layouts import (
    NORMAL_LAYOUT,
    DEFAULT_LAYOUT_ID,
    POWER_DEFAULT_LAYOUT,
    validate_layout,
)
from graupel.data.models import Location, MeteogramConfig
from graupel.data.storage import Storage


@pytest.fixture
def storage():
    store = Storage(":memory:")
    yield store
    store.close()


@pytest.fixture
def api(storage):
    return MeteogramAPI(storage=storage)


def _ids(storage):
    return [entry["id"] for entry in storage.list_layouts()]


def _config(storage, layout_id=None):
    return storage.create(
        MeteogramConfig(
            name="Alpen",
            location=Location(name="Innsbruck", latitude=47.26, longitude=11.39),
            model_chain=[],
            layout_id=layout_id,
        )
    )


def test_fresh_library_is_seeded(storage):
    layouts = storage.list_layouts()
    assert [(e["id"], e["name"], e["builtin_id"], e["fixed"]) for e in layouts] == [
        (DEFAULT_LAYOUT_ID, "Default", "normal-default", True),
        ("power-default", "Power default", "power-default", False),
    ]
    normal = layouts[0]["layout"]
    assert normal["areas"] == validate_layout(NORMAL_LAYOUT)["areas"]
    assert normal["id"] == DEFAULT_LAYOUT_ID
    assert all(entry["error"] is None for entry in layouts)


def test_seeding_is_idempotent_and_survives_reopen(tmp_path):
    path = str(tmp_path / "meteogram.db")
    first = Storage(path)
    first.create_layout("Mine", POWER_DEFAULT_LAYOUT)
    first.close()
    reopened = Storage(path)
    try:
        assert [e["name"] for e in reopened.list_layouts()] == [
            "Default",
            "Power default",
            "Mine",
        ]
    finally:
        reopened.close()


def test_missing_default_entry_is_restored_first(tmp_path):
    path = str(tmp_path / "meteogram.db")
    first = Storage(path)
    with first._db_connection() as conn:
        with conn:
            conn.execute(
                "DELETE FROM meteogram_layouts WHERE id = ?",
                (DEFAULT_LAYOUT_ID,),
            )
    first.close()
    reopened = Storage(path)
    try:
        assert _ids(reopened) == [DEFAULT_LAYOUT_ID, "power-default"]
    finally:
        reopened.close()


def test_crud_and_order_persist(api, storage):
    a = api.create_layout("A")
    b = api.create_layout("B", position=1)
    assert _ids(storage) == [DEFAULT_LAYOUT_ID, b["id"], "power-default", a["id"]]
    # Without a layout, a new entry is a copy of the power default.
    assert a["layout"]["areas"] == validate_layout(POWER_DEFAULT_LAYOUT)["areas"]

    copy_of_a = api.duplicate_layout(a["id"])
    assert copy_of_a["name"] == "A (copy)"
    assert _ids(storage)[-2:] == [a["id"], copy_of_a["id"]]

    renamed = api.update_layout(b["id"], {"name": "  Bee "})
    assert renamed["name"] == "Bee"
    assert renamed["layout"]["name"] == "Bee"

    edited = copy.deepcopy(POWER_DEFAULT_LAYOUT)
    edited["showModelHeaders"] = False
    assert api.update_layout(a["id"], {"layout": edited})["layout"][
        "showModelHeaders"
    ] is False

    order = api.reorder_layouts(
        [copy_of_a["id"], DEFAULT_LAYOUT_ID, "power-default", a["id"], "nope"]
    )
    # Default stays first; entries left out keep their order at the end.
    assert [e["id"] for e in order] == [
        DEFAULT_LAYOUT_ID,
        copy_of_a["id"],
        "power-default",
        a["id"],
        b["id"],
    ]
    assert [e["position"] for e in order] == [0, 1, 2, 3, 4]

    assert api.delete_layout(b["id"]) == {"success": True}
    assert api.delete_layout(b["id"]) == {"success": False}
    assert b["id"] not in _ids(storage)


def test_create_never_goes_before_default(storage):
    created = storage.create_layout("First", POWER_DEFAULT_LAYOUT, position=0)
    assert _ids(storage)[:2] == [DEFAULT_LAYOUT_ID, created["id"]]


def test_invalid_layout_is_rejected_on_write(api, storage):
    broken = copy.deepcopy(POWER_DEFAULT_LAYOUT)
    broken["areas"][0]["series"][0]["quantity"] = "no_such_quantity"
    with pytest.raises(ValueError, match="unknown quantity"):
        api.create_layout("Broken", broken)
    with pytest.raises(ValueError, match="unknown quantity"):
        api.update_layout("power-default", {"layout": broken})
    with pytest.raises(ValueError):
        api.create_layout("   ")
    with pytest.raises(ValueError, match="unknown layout field"):
        api.update_layout("power-default", {"colour": "red"})
    assert len(storage.list_layouts()) == 2


def test_default_entry_cannot_be_deleted_or_renamed(api, storage):
    with pytest.raises(ValueError):
        api.delete_layout(DEFAULT_LAYOUT_ID)
    with pytest.raises(ValueError):
        api.update_layout(DEFAULT_LAYOUT_ID, {"name": "Mine"})
    # Keeping the name is not a rename.
    api.update_layout(DEFAULT_LAYOUT_ID, {"name": "Default"})
    assert _ids(storage)[0] == DEFAULT_LAYOUT_ID


def test_every_layout_but_default_can_be_deleted(api, storage):
    # No global layout to keep alive any more (#203).
    other = api.create_layout("Other")
    api.delete_layout("power-default")
    api.delete_layout(other["id"])
    assert _ids(storage) == [DEFAULT_LAYOUT_ID]


def test_edit_and_reset_of_default_entry(api, storage):
    edited = copy.deepcopy(NORMAL_LAYOUT)
    edited["areas"] = edited["areas"][:1]
    api.update_layout(DEFAULT_LAYOUT_ID, {"layout": edited})
    # Normal mode (and every configuration without a layout) draws it.
    stored = storage.get_layout(DEFAULT_LAYOUT_ID)["layout"]
    assert [area["id"] for area in stored["areas"]] == ["temp"]
    assert stored["id"] == DEFAULT_LAYOUT_ID

    reset = api.reset_layout(DEFAULT_LAYOUT_ID)
    assert reset["layout"]["areas"] == validate_layout(NORMAL_LAYOUT)["areas"]
    assert reset["name"] == "Default"

    own = api.create_layout("Own")
    with pytest.raises(ValueError, match="built-in"):
        api.reset_layout(own["id"])


def test_invalid_stored_layout_reads_with_error(storage):
    broken = copy.deepcopy(NORMAL_LAYOUT)
    broken["areas"] = []
    with storage._db_connection() as conn:
        with conn:
            conn.execute(
                "UPDATE meteogram_layouts SET layout_json = ? WHERE id = ?",
                (json.dumps(broken), DEFAULT_LAYOUT_ID),
            )
            conn.execute(
                "UPDATE meteogram_layouts SET layout_json = ? WHERE id = ?",
                ("not json", "power-default"),
            )
    normal, power = storage.list_layouts()
    # The frontend draws the built-in fallback with a warning.
    assert normal["error"] and normal["layout"]["areas"] == []
    assert power["error"] and power["layout"] is None


def test_duplicate_of_invalid_layout_copies_its_builtin(api, storage):
    with storage._db_connection() as conn:
        with conn:
            conn.execute(
                "UPDATE meteogram_layouts SET layout_json = '{}' WHERE id = ?",
                (DEFAULT_LAYOUT_ID,),
            )
    copied = api.duplicate_layout(DEFAULT_LAYOUT_ID)
    assert copied["error"] is None
    assert copied["layout"]["areas"] == validate_layout(NORMAL_LAYOUT)["areas"]
    assert copied["builtin_id"] is None and copied["fixed"] is False


def test_delete_of_referenced_layout_falls_back_to_default(api, storage):
    own = api.create_layout("Own")
    using = _config(storage, layout_id=own["id"])
    other = _config(storage, layout_id="power-default")

    api.delete_layout(own["id"])

    assert storage.read(using.id).layout_id is None
    assert storage.read(other.id).layout_id == "power-default"


def test_configuration_layout_reference_is_checked(api, storage):
    config = _config(storage).model_dump()
    with pytest.raises(ValueError, match="unknown meteogram configuration"):
        api.save_configuration({**config, "layout_id": "missing"})
    with pytest.raises(ValueError, match="unknown meteogram configuration"):
        api.update_configuration(config["id"], {"layout_id": "missing"})
    saved = api.update_configuration(config["id"], {"layout_id": DEFAULT_LAYOUT_ID})
    assert saved["layout_id"] == DEFAULT_LAYOUT_ID
    # The global layout setting is gone (#203).
    with pytest.raises(ValueError, match="unknown setting"):
        api.update_settings({"global_layout_id": "power-default"})


def test_configuration_without_layout_id_reads_as_default(storage):
    config = _config(storage)
    with storage._db_connection() as conn:
        data = json.loads(
            conn.execute(
                "SELECT data FROM meteogram_configs WHERE id = ?", (config.id,)
            ).fetchone()[0]
        )
    data.pop("layout_id")
    with storage._db_connection() as conn:
        with conn:
            conn.execute(
                "UPDATE meteogram_configs SET data = ? WHERE id = ?",
                (json.dumps(data), config.id),
            )
    assert storage.read(config.id).layout_id is None


# --- Schema 1 -> 2: one default layout (#203) ------------------------------


def _schema_1_database(path, global_layout_id):
    """A database as schema 1 left it: "Normal mode" entry + global layout."""
    store = Storage(path)
    own = store.create_layout("Own", POWER_DEFAULT_LAYOUT)
    following = _config(store)
    pinned_normal = _config(store, layout_id=DEFAULT_LAYOUT_ID)
    pinned_own = _config(store, layout_id=own["id"])
    with store._db_connection() as conn:
        with conn:
            conn.execute(
                "UPDATE meteogram_layouts SET id = 'normal-mode', "
                "name = 'Normal mode' WHERE id = ?",
                (DEFAULT_LAYOUT_ID,),
            )
            for config_id, raw in conn.execute(
                "SELECT id, data FROM meteogram_configs"
            ).fetchall():
                data = json.loads(raw)
                if data.get("layout_id") == DEFAULT_LAYOUT_ID:
                    data["layout_id"] = "normal-mode"
                    conn.execute(
                        "UPDATE meteogram_configs SET data = ? WHERE id = ?",
                        (json.dumps(data), config_id),
                    )
            if global_layout_id is not None:
                conn.execute(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?)",
                    ("global_layout_id", json.dumps(global_layout_id)),
                )
            conn.execute(
                "INSERT INTO forecast_fetch (fetched_at, location_key, "
                "latitude, longitude, location_json, chain_json, layout_id, "
                "meta_json) VALUES ('t', 'k', 0, 0, '{}', '{}', "
                "'normal-mode', '{}')"
            )
            conn.execute(
                "UPDATE db_meta SET value = '1' WHERE key = 'schema_version'"
            )
    store.close()
    return own, following, pinned_normal, pinned_own


@pytest.mark.parametrize(
    "global_choice, expected",
    [
        (None, "power-default"),  # no row: schema 1 default "power-default"
        ("own", "own"),
        ("normal-mode", None),  # already drew the merged entry
    ],
)
def test_migration_keeps_what_each_configuration_draws(
    tmp_path, global_choice, expected
):
    path = str(tmp_path / "meteogram.db")
    store = Storage(path)
    own_id = store.create_layout("Own", POWER_DEFAULT_LAYOUT)["id"]
    store.close()
    resolve = {"own": own_id}
    _, following, pinned_normal, pinned_own = _schema_1_database(
        path, resolve.get(global_choice, global_choice)
    )

    migrated = Storage(path)
    try:
        assert migrated.get_db_meta()["schema_version"] == "2"
        layouts = migrated.list_layouts()
        assert (layouts[0]["id"], layouts[0]["name"]) == (
            DEFAULT_LAYOUT_ID,
            "Default",
        )
        assert "normal-mode" not in _ids(migrated)
        # Followed the global layout: now pinned to it (or the default).
        assert migrated.read(following.id).layout_id == resolve.get(
            expected, expected
        )
        # Pinned to "Normal mode": now follows the default entry.
        assert migrated.read(pinned_normal.id).layout_id is None
        assert migrated.read(pinned_own.id).layout_id == pinned_own.layout_id
        assert "global_layout_id" not in migrated.get_stored_setting_keys()
        assert "global_layout_id" not in migrated.get_settings()
        with migrated._db_connection() as conn:
            assert conn.execute(
                "SELECT layout_id FROM forecast_fetch"
            ).fetchall() == [(DEFAULT_LAYOUT_ID,)]
    finally:
        migrated.close()

    # Opening again changes nothing.
    again = Storage(path)
    try:
        assert len(again.list_layouts()) == len(layouts)
        assert again.read(pinned_normal.id).layout_id is None
    finally:
        again.close()
