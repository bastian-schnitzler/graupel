"""Upgrade from a database written by the released graupel 0.1.0.

tests/fixtures/graupel-0.1.0.db was created with graupel 0.1.0 from PyPI
(tests/fixtures/make_graupel_0_1_0_db.py), so this covers the real 0.1.0
schema rather than a hand-written one (system.md §13).
"""

import shutil
from pathlib import Path

from graupel.data.api import MeteogramAPI
from graupel.data.storage import DB_APP_VERSION, SCHEMA_VERSION, Storage

FIXTURE = Path(__file__).parent / "fixtures" / "graupel-0.1.0.db"
NAMES = [
    "Eigene Kette",
    "Mein Alpenwetter",
    "Ostalpen",
    "Dolomiten",
    "Westalpen",
    "Westalpen",
]


def _copy(tmp_path):
    db = tmp_path / "meteogram.db"
    shutil.copyfile(FIXTURE, db)
    return db


def test_0_1_0_database_upgrades_and_keeps_configurations(tmp_path):
    db = _copy(tmp_path)

    storage = Storage(str(db))
    try:
        backup = tmp_path / "meteogram.db.0.1.0.bak"
        assert backup.read_bytes() == FIXTURE.read_bytes()
        assert storage.get_db_meta() == {
            "app_version": DB_APP_VERSION,
            "schema_version": str(SCHEMA_VERSION),
        }

        configs = storage.list_all()
        assert [c.name for c in configs] == NAMES
        assert [c.position for c in configs] == list(range(len(NAMES)))
        own, edited = configs[0], configs[1]
        assert own.location.name == "Hamburg"
        assert edited.location.name == "Garmisch-Partenkirchen"
        assert edited.location.elevation == 708
        assert all(c.model_chain for c in configs)
        assert {c.layout_id for c in configs} == {"power-default"}

        api = MeteogramAPI(storage=storage)
        # Edited 0.1.0 configurations start in power mode.
        assert api.get_settings()["mode"] == "power"
        listed = api.get_configurations()
        assert [c["name"] for c in listed] == NAMES
    finally:
        storage.close()


def test_upgraded_0_1_0_database_opens_unchanged(tmp_path):
    db = _copy(tmp_path)
    Storage(str(db)).close()
    migrated = db.read_bytes()

    reopened = Storage(str(db))
    try:
        assert [c.name for c in reopened.list_all()] == NAMES
    finally:
        reopened.close()
    assert db.read_bytes() == migrated
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "meteogram.db",
        "meteogram.db.0.1.0.bak",
    ]
