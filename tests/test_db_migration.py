"""Database format version and migration from 0.1.x (system.md §8.1, §13)."""

import sqlite3

from graupel.data.api import MeteogramAPI, init_default_configurations
from graupel.data.models import Location, MeteogramConfig
from graupel.data.storage import (
    DB_APP_VERSION,
    SCHEMA_VERSION,
    Storage,
)


def _config(name, config_id):
    return MeteogramConfig(
        id=config_id,
        name=name,
        location=Location(name="Berlin", latitude=52.52, longitude=13.405),
        model_chain=[],
    )


def _write_0_1_x_db(path, configs):
    """A 0.1.x database: no `db_meta`, archives and location history."""
    conn = sqlite3.connect(path)
    with conn:
        conn.execute(
            "CREATE TABLE meteogram_configs (id TEXT PRIMARY KEY, "
            "data TEXT NOT NULL, position INTEGER DEFAULT 0)"
        )
        for position, cfg in configs:
            conn.execute(
                "INSERT INTO meteogram_configs VALUES (?, ?, ?)",
                (cfg.id, cfg.model_dump_json(), position),
            )
        conn.execute(
            "CREATE TABLE api_fetch_archive (id INTEGER PRIMARY KEY, "
            "fetched_at TEXT, request_kind TEXT, model TEXT, latitude REAL, "
            "longitude REAL, params TEXT, response TEXT)"
        )
        conn.execute(
            "INSERT INTO api_fetch_archive VALUES "
            "(1, '2026-01-01', 'forecast', 'icon_d2', 1, 2, '{}', '{}')"
        )
        conn.execute(
            "CREATE TABLE model_run_availability (id INTEGER PRIMARY KEY, "
            "recorded_at TEXT, chain TEXT, model TEXT)"
        )
        conn.execute(
            "INSERT INTO model_run_availability VALUES "
            "(1, '2026-01-01', 'main', 'ICON-D2')"
        )
        conn.execute(
            "CREATE TABLE location_history (id TEXT PRIMARY KEY, name TEXT, "
            "latitude REAL, longitude REAL, elevation REAL, country TEXT, "
            "admin1 TEXT, timezone TEXT, selection_count INTEGER, "
            "last_selected_at TEXT)"
        )
        conn.execute(
            "INSERT INTO location_history VALUES ('1.0000_2.0000', "
            "'Somewhere', 1, 2, NULL, NULL, NULL, NULL, 3, '2026-01-01')"
        )
    conn.close()


def _count(storage, table):
    with storage._db_connection() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_fresh_database_gets_db_meta(tmp_path):
    storage = Storage(str(tmp_path / "meteogram.db"))
    try:
        assert storage.get_db_meta() == {
            "app_version": DB_APP_VERSION,
            "schema_version": str(SCHEMA_VERSION),
        }
    finally:
        storage.close()
    assert not (tmp_path / "meteogram.db.0.1.0.bak").exists()


def test_in_memory_database_gets_db_meta():
    storage = Storage(":memory:")
    try:
        assert storage.get_db_meta()["app_version"] == DB_APP_VERSION
    finally:
        storage.close()


def test_0_1_x_database_is_backed_up_and_configurations_imported(tmp_path):
    db = tmp_path / "meteogram.db"
    _write_0_1_x_db(
        str(db),
        [(1, _config("Second", "b")), (0, _config("First", "a"))],
    )
    original = db.read_bytes()

    storage = Storage(str(db))
    try:
        backup = tmp_path / "meteogram.db.0.1.0.bak"
        assert backup.read_bytes() == original
        assert storage.get_db_meta()["app_version"] == DB_APP_VERSION
        configs = storage.list_all()
        assert [(c.id, c.name, c.position) for c in configs] == [
            ("a", "First", 0),
            ("b", "Second", 1),
        ]
        # 0.1.x drew the full chart: keep it rather than the Default entry.
        assert {c.layout_id for c in configs} == {"power-default"}
        for table in (
            "api_fetch_archive",
            "model_run_availability",
            "location_history",
            "app_settings",
        ):
            assert _count(storage, table) == 0
        # Imported user configurations start in power mode.
        assert MeteogramAPI(storage=storage).get_settings()["mode"] == "power"
    finally:
        storage.close()

    # A second start opens the migrated database without migrating again.
    migrated = db.read_bytes()
    reopened = Storage(str(db))
    try:
        assert [c.name for c in reopened.list_all()] == ["First", "Second"]
    finally:
        reopened.close()
    assert db.read_bytes() == migrated
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "meteogram.db",
        "meteogram.db.0.1.0.bak",
    ]


def test_0_1_x_database_with_seeded_defaults_starts_in_normal_mode(tmp_path):
    db = tmp_path / "meteogram.db"
    seeded = Storage(":memory:")
    defaults = init_default_configurations(seeded)
    seeded.close()
    _write_0_1_x_db(str(db), list(enumerate(defaults)))

    storage = Storage(str(db))
    try:
        assert [c.name for c in storage.list_all()] == [
            c.name for c in defaults
        ]
        assert MeteogramAPI(storage=storage).get_settings()["mode"] == "normal"
    finally:
        storage.close()


def test_0_1_x_wal_files_move_with_the_backup(tmp_path):
    db = tmp_path / "meteogram.db"
    _write_0_1_x_db(str(db), [(0, _config("Kept", "k"))])
    holder = sqlite3.connect(str(db))
    holder.execute("PRAGMA journal_mode=WAL")
    with holder:
        holder.execute(
            "UPDATE meteogram_configs SET data = ? WHERE id = 'k'",
            (_config("Renamed in WAL", "k").model_dump_json(),),
        )
    holder.close()

    storage = Storage(str(db))
    try:
        assert [c.name for c in storage.list_all()] == ["Renamed in WAL"]
    finally:
        storage.close()
    assert not (tmp_path / "meteogram.db-wal").exists()
    backup = sqlite3.connect(str(tmp_path / "meteogram.db.0.1.0.bak"))
    try:
        (data,) = backup.execute(
            "SELECT data FROM meteogram_configs"
        ).fetchone()
    finally:
        backup.close()
    assert "Renamed in WAL" in data


def test_existing_backup_is_never_overwritten(tmp_path):
    db = tmp_path / "meteogram.db"
    (tmp_path / "meteogram.db.0.1.0.bak").write_bytes(b"earlier backup")
    _write_0_1_x_db(str(db), [(0, _config("Kept", "k"))])

    Storage(str(db)).close()
    earlier = tmp_path / "meteogram.db.0.1.0.bak"
    assert earlier.read_bytes() == b"earlier backup"
    assert (tmp_path / "meteogram.db.0.1.0-2.bak").is_file()


def test_database_with_db_meta_is_opened_unchanged(tmp_path):
    db = tmp_path / "meteogram.db"
    first = Storage(str(db))
    first.create(_config("Mine", "m"))
    first.close()
    before = db.read_bytes()

    reopened = Storage(str(db))
    try:
        assert [c.name for c in reopened.list_all()] == ["Mine"]
    finally:
        reopened.close()
    assert db.read_bytes() == before
    assert not (tmp_path / "meteogram.db.0.1.0.bak").exists()
