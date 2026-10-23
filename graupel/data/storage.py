import sqlite3
import datetime
import json
import logging
import math
import os
import uuid
from typing import Any, Dict, List, Optional
from .models import (
    DataPoint,
    DetailedCloudForecast,
    HarmonizedForecastResponse,
    MeteogramConfig,
    Location,
    ModelAvailability,
    VerticalCloudProfile,
)
from .layouts import (
    POWER_DEFAULT_LAYOUT,
    DEFAULT_LAYOUT_ID,
    DEFAULT_LAYOUT_NAME,
    LEGACY_NORMAL_MODE_LAYOUT_ID,
    SEEDED_LAYOUTS,
    builtin_layout,
    validate_layout,
)
from .quantities import QUANTITIES
from .settings import DEFAULT_SETTINGS, validate_settings

logger = logging.getLogger(__name__)

# Series name of a model's vertical cloud profile in `forecast_series`.
CLOUD_PROFILE_VARIABLE = "vertical_cloud_profile"
# Tables pruned by the archive retention, with their time column.
ARCHIVE_TABLES = (
    ("forecast_fetch", "fetched_at"),
    ("api_fetch_archive", "fetched_at"),
    ("model_run_availability", "recorded_at"),
)
# Parts of the data the Basic tab copies into a new data folder (system.md §8.2).
CONFIGURATION_TABLES = (
    "meteogram_configs",
    "meteogram_layouts",
    "app_settings",
    "location_history",
)
METEOGRAM_TABLES = (
    "forecast_fetch",
    "forecast_series",
    "model_chain_config_versions",
    "api_fetch_archive",
    "model_run_availability",
)
PRUNE_INTERVAL = datetime.timedelta(days=1)
EARTH_RADIUS_KM = 6371.0
# Database format (system.md §8.1, §13), stored in `db_meta`. Bump
# SCHEMA_VERSION on every format change and rewrite both keys then.
DB_APP_VERSION = "0.2.0"
# 2: one default layout instead of "Normal mode" + global layout (#203).
SCHEMA_VERSION = 2
# A database without `db_meta` comes from 0.1.x and is moved aside to this
# backup before its configurations are imported into a fresh database.
LEGACY_BACKUP_SUFFIX = ".0.1.0.bak"


def location_key(latitude: float, longitude: float) -> str:
    """Location id with the 4-decimal rounding of `location_history`."""
    return f"{round(latitude, 4):.4f}_{round(longitude, 4):.4f}"


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, a)))


_VERSION_STATE_COLUMNS = (
    "name, location_json, location_name_override, main_model_chain_json, "
    "cloud_model_chain_json, layout_id"
)


def _config_state(config: MeteogramConfig) -> tuple:
    """Versioned state of a configuration (system.md §9.5) without `layout_id`.

    Everything editable in the Model chains tab; position is not part of it.
    """
    main_chain = config.main_model_chain or config.model_chain or []
    return (
        config.name,
        config.location.model_dump_json(),
        getattr(config, "location_name_override", None),
        json.dumps([m.model_dump() for m in main_chain]),
        json.dumps([m.model_dump() for m in config.cloud_model_chain or []]),
    )


class Storage:
    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._shared_memory_conn = None
        self._last_prune_at: Optional[datetime.datetime] = None
        if "?mode=memory" in self.db_path or self.db_path == ":memory:":
            # Keep a persistent connection for in-memory databases
            # so the database isn't destroyed when the connection closes.
            self._shared_memory_conn = self._get_connection()
        imported = self._move_aside_0_1_x()
        self._init_db()
        if imported:
            self._import_configs(imported)

    def _get_connection(self):
        if self._shared_memory_conn is not None:
            return self._shared_memory_conn
        if "mode=memory" in self.db_path or "cache=shared" in self.db_path:
            return sqlite3.connect(self.db_path, uri=True)
        return sqlite3.connect(self.db_path)

    from contextlib import contextmanager

    @contextmanager
    def _db_connection(self):
        conn = self._get_connection()
        try:
            yield conn
        finally:
            if conn != self._shared_memory_conn:
                conn.close()

    def close(self):
        if self._shared_memory_conn is not None:
            self._shared_memory_conn.close()
            self._shared_memory_conn = None

    def _init_db(self):
        with self._db_connection() as conn:
            with conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS meteogram_configs (
                        id TEXT PRIMARY KEY,
                        data TEXT NOT NULL,
                        position INTEGER DEFAULT 0,
                        state_since TEXT
                    )
                    """)
                # Write-only archive of every Open-Meteo response. The
                # application never reads it back for display.
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS api_fetch_archive (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        fetched_at TEXT NOT NULL,
                        request_kind TEXT NOT NULL,
                        model TEXT,
                        latitude REAL,
                        longitude REAL,
                        params TEXT NOT NULL,
                        response TEXT NOT NULL
                    )
                    """)
                # Write-only log of the hours each model's latest run really
                # delivered and of its run time (shown in Meteogram View).
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS model_run_availability (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        recorded_at TEXT NOT NULL,
                        chain TEXT NOT NULL,
                        model TEXT NOT NULL,
                        model_id TEXT,
                        latitude REAL,
                        longitude REAL,
                        forecast_start TEXT,
                        available_hours INTEGER,
                        valid_until TEXT,
                        last_run_init_time TEXT,
                        last_run_availability_time TEXT,
                        data_end_run_init_time TEXT,
                        run_segments TEXT
                    )
                    """)
                # Structured forecast archive (system.md §9): one fetch per
                # completed forecast, one series per model and quantity.
                # Only the historic viewer reads it, never the live view.
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS forecast_fetch (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        fetched_at TEXT NOT NULL,
                        location_key TEXT NOT NULL,
                        latitude REAL NOT NULL,
                        longitude REAL NOT NULL,
                        location_name TEXT,
                        location_json TEXT NOT NULL,
                        mode TEXT,
                        region_id TEXT,
                        chain_json TEXT NOT NULL,
                        layout_id TEXT,
                        config_id TEXT,
                        config_version_id INTEGER,
                        meta_json TEXT NOT NULL
                    )
                    """)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS forecast_fetch_location "
                    "ON forecast_fetch (latitude, longitude)"
                )
                # Version history of model chain configurations (system.md §9.5):
                # written only when an archived forecast uses a new state.
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS model_chain_config_versions (
                        version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        config_id TEXT NOT NULL,
                        valid_from TEXT NOT NULL,
                        valid_to TEXT,
                        name TEXT NOT NULL,
                        location_json TEXT NOT NULL,
                        location_name_override TEXT,
                        main_model_chain_json TEXT NOT NULL,
                        cloud_model_chain_json TEXT NOT NULL,
                        layout_id TEXT
                    )
                    """)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS config_versions_config "
                    "ON model_chain_config_versions (config_id)"
                )
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS forecast_series (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        fetch_id INTEGER NOT NULL
                            REFERENCES forecast_fetch (id) ON DELETE CASCADE,
                        chain TEXT NOT NULL,
                        model TEXT NOT NULL,
                        model_id TEXT,
                        run_init_time TEXT,
                        variable TEXT NOT NULL,
                        unit TEXT,
                        timestamps_json TEXT NOT NULL,
                        values_json TEXT NOT NULL
                    )
                    """)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS forecast_series_fetch "
                    "ON forecast_series (fetch_id)"
                )
                # App settings (mode, archive, layout), JSON values.
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS app_settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS location_history (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        latitude REAL NOT NULL,
                        longitude REAL NOT NULL,
                        elevation REAL,
                        country TEXT,
                        admin1 TEXT,
                        timezone TEXT,
                        selection_count INTEGER DEFAULT 1,
                        last_selected_at TEXT NOT NULL
                    )
                    """)
                # Meteogram configurations (layout library, system.md §4.3).
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS meteogram_layouts (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        position INTEGER NOT NULL,
                        layout_json TEXT NOT NULL,
                        builtin_id TEXT
                    )
                    """)
                self._migrate_to_default_layout(conn)
                self._seed_layouts(conn)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS db_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """)
                conn.execute(
                    "INSERT OR IGNORE INTO db_meta (key, value) VALUES (?, ?)",
                    ("app_version", DB_APP_VERSION),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO db_meta (key, value) VALUES (?, ?)",
                    ("schema_version", str(SCHEMA_VERSION)),
                )

    def get_db_meta(self) -> Dict[str, str]:
        with self._db_connection() as conn:
            rows = conn.execute("SELECT key, value FROM db_meta").fetchall()
        return {key: value for key, value in rows}

    def _move_aside_0_1_x(self) -> List[tuple]:
        """Move a 0.1.x database aside and return its configurations.

        0.1.x files carry no version information, so a file with tables but
        without `db_meta` is one. Only the configurations (data, position)
        are read; archives, location history and settings stay in the
        backup (system.md §13).
        """
        if self._shared_memory_conn is not None or "mode=memory" in self.db_path:
            return []
        if not os.path.isfile(self.db_path):
            return []
        conn = sqlite3.connect(self.db_path)
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            if not tables or "db_meta" in tables:
                return []
            configs: List[tuple] = []
            if "meteogram_configs" in tables:
                columns = [
                    row[1]
                    for row in conn.execute(
                        "PRAGMA table_info(meteogram_configs)"
                    )
                ]
                position = "position" if "position" in columns else "NULL"
                configs = conn.execute(
                    f"SELECT data, {position} FROM meteogram_configs "
                    f"ORDER BY {position} ASC, rowid ASC"
                ).fetchall()
            # Fold a write-ahead log into the main file before moving it.
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            # Windows cannot move a file with an open connection.
            conn.close()
        backup = self.db_path + LEGACY_BACKUP_SUFFIX
        counter = 1
        while os.path.exists(backup):
            counter += 1
            backup = f"{self.db_path}.0.1.0-{counter}.bak"
        os.replace(self.db_path, backup)
        for suffix in ("-wal", "-shm"):
            if os.path.exists(self.db_path + suffix):
                os.replace(self.db_path + suffix, backup + suffix)
        logger.warning(
            "Database %s has no version information (0.1.x); moved it to %s "
            "and importing %d configuration(s)",
            self.db_path,
            backup,
            len(configs),
        )
        return configs

    def _import_configs(self, rows: List[tuple]) -> None:
        with self._db_connection() as conn:
            # The save time is unknown: state_since stays NULL, so the first
            # config version starts at the first archived fetch.
            with conn:
                index = 0
                for data, _position in rows:
                    try:
                        cfg = MeteogramConfig.model_validate_json(data)
                    except Exception:
                        logger.exception(
                            "Skipping unreadable 0.1.x configuration %r", data
                        )
                        continue
                    if cfg.id is None:
                        cfg.id = str(uuid.uuid4())
                    cfg.position = index
                    # 0.1.x drew the full chart; the Default entry is the
                    # simpler normal layout (#203).
                    cfg.layout_id = POWER_DEFAULT_LAYOUT["id"]
                    conn.execute(
                        "INSERT OR REPLACE INTO meteogram_configs "
                        "(id, data, position) VALUES (?, ?, ?)",
                        (cfg.id, cfg.model_dump_json(), index),
                    )
                    index += 1

    def get_settings(self) -> Dict[str, Any]:
        """Return all app settings; missing or invalid rows read as default."""
        settings = {
            key: json.loads(json.dumps(value))
            for key, value in DEFAULT_SETTINGS.items()
        }
        with self._db_connection() as conn:
            rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
        for key, raw in rows:
            if key not in settings:
                continue
            try:
                settings.update(validate_settings({key: json.loads(raw)}))
            except ValueError as exc:
                logger.warning("Ignoring stored setting %s: %s", key, exc)
        return settings

    def is_archive_enabled(self) -> bool:
        return bool(self.get_settings()["archive_enabled"])

    def get_stored_setting_keys(self) -> List[str]:
        """Keys that have a stored row (valid or not)."""
        with self._db_connection() as conn:
            rows = conn.execute("SELECT key FROM app_settings").fetchall()
        return [row[0] for row in rows]

    def update_settings(self, changes: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and store `changes` in one transaction; return all settings."""
        validated = validate_settings(changes)
        with self._db_connection() as conn:
            with conn:
                conn.executemany(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    [(key, json.dumps(value)) for key, value in validated.items()],
                )
        return self.get_settings()

    # --- Meteogram configurations (layout library, system.md §4.3, #168) ---

    @staticmethod
    def _migrate_to_default_layout(conn) -> None:
        """Schema 1 -> 2 (#203): merge "Normal mode" and the global layout.

        The fixed entry becomes "Default". Configurations without their own
        layout that drew a different global layout keep drawing it: they
        get it as their own `layout_id`. The `global_layout_id` setting is
        dropped. Runs before seeding, so the entry is renamed, not re-added.
        """
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if "db_meta" not in tables:
            return  # fresh database: created with the current schema
        row = conn.execute(
            "SELECT value FROM db_meta WHERE key = 'schema_version'"
        ).fetchone()
        if row is None or int(row[0]) >= 2:
            return
        legacy = LEGACY_NORMAL_MODE_LAYOUT_ID
        layouts = [
            r[0]
            for r in conn.execute(
                "SELECT id FROM meteogram_layouts ORDER BY position, rowid"
            )
        ]
        stored = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'global_layout_id'"
        ).fetchone()
        try:
            stored_id = json.loads(stored[0]) if stored else None
        except ValueError:
            stored_id = None
        # The layout schema 1 drew for configurations without their own:
        # the stored global layout, else "power-default", else the first
        # power layout (chooseChartLayout).
        power = [layout_id for layout_id in layouts if layout_id != legacy]
        if stored_id == legacy:
            global_id = None  # its followers already draw the merged entry
        elif stored_id in power:
            global_id = stored_id
        elif "power-default" in power:
            global_id = "power-default"
        else:
            global_id = power[0] if power else None
        for config_id, raw in conn.execute(
            "SELECT id, data FROM meteogram_configs"
        ).fetchall():
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            layout_id = data.get("layout_id")
            if layout_id is None and global_id is not None:
                data["layout_id"] = global_id
            elif layout_id == legacy:
                data["layout_id"] = None
            else:
                continue
            conn.execute(
                "UPDATE meteogram_configs SET data = ? WHERE id = ?",
                (json.dumps(data), config_id),
            )
        conn.execute(
            "UPDATE meteogram_layouts SET id = ?, name = ? WHERE id = ?",
            (DEFAULT_LAYOUT_ID, DEFAULT_LAYOUT_NAME, legacy),
        )
        for table in ("forecast_fetch", "model_chain_config_versions"):
            conn.execute(
                f"UPDATE {table} SET layout_id = ? WHERE layout_id = ?",
                (DEFAULT_LAYOUT_ID, legacy),
            )
        conn.execute("DELETE FROM app_settings WHERE key = 'global_layout_id'")
        conn.execute(
            "UPDATE db_meta SET value = ? WHERE key = 'schema_version'",
            (str(SCHEMA_VERSION),),
        )

    @staticmethod
    def _seed_layouts(conn) -> None:
        """Seed an empty library; restore a missing Default entry."""
        count = conn.execute("SELECT COUNT(*) FROM meteogram_layouts").fetchone()[0]
        seeds = SEEDED_LAYOUTS if count == 0 else ()
        has_normal = conn.execute(
            "SELECT 1 FROM meteogram_layouts WHERE id = ?",
            (DEFAULT_LAYOUT_ID,),
        ).fetchone()
        if count and not has_normal:
            conn.execute("UPDATE meteogram_layouts SET position = position + 1")
            seeds = SEEDED_LAYOUTS[:1]
        for position, (layout_id, name, builtin_id) in enumerate(seeds):
            layout = builtin_layout(builtin_id)
            layout.update(id=layout_id, name=name)
            conn.execute(
                "INSERT INTO meteogram_layouts "
                "(id, name, position, layout_json, builtin_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (layout_id, name, position, json.dumps(layout), builtin_id),
            )

    @staticmethod
    def _layout_row(row) -> Dict[str, Any]:
        layout_id, name, position, raw, builtin_id = row
        entry: Dict[str, Any] = {
            "id": layout_id,
            "name": name,
            "position": position,
            "builtin_id": builtin_id,
            "fixed": layout_id == DEFAULT_LAYOUT_ID,
            "layout": None,
            "error": None,
        }
        try:
            layout = json.loads(raw)
            if isinstance(layout, dict):
                layout.update(id=layout_id, name=name)
            entry["layout"] = layout
            validate_layout(layout)
        except (ValueError, TypeError) as exc:
            # The frontend draws the built-in fallback with a warning.
            logger.warning("Stored layout %s is invalid: %s", layout_id, exc)
            entry["error"] = str(exc)
        return entry

    _LAYOUT_COLUMNS = "id, name, position, layout_json, builtin_id"

    def list_layouts(self) -> List[Dict[str, Any]]:
        """All meteogram configurations in order; Default first."""
        with self._db_connection() as conn:
            rows = conn.execute(
                f"SELECT {self._LAYOUT_COLUMNS} FROM meteogram_layouts "
                "ORDER BY id != ?, position ASC, rowid ASC",
                (DEFAULT_LAYOUT_ID,),
            ).fetchall()
        return [self._layout_row(row) for row in rows]

    def get_layout(self, layout_id: str) -> Optional[Dict[str, Any]]:
        with self._db_connection() as conn:
            row = conn.execute(
                f"SELECT {self._LAYOUT_COLUMNS} FROM meteogram_layouts "
                "WHERE id = ?",
                (layout_id,),
            ).fetchone()
        return self._layout_row(row) if row else None

    @staticmethod
    def _layout_name(name: Any) -> str:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("layout name must not be empty")
        return name.strip()

    def create_layout(
        self,
        name: str,
        layout: Dict[str, Any],
        position: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Store a new layout after the given position (default: at the end)."""
        import uuid

        layout_id = str(uuid.uuid4())
        name = self._layout_name(name)
        validated = validate_layout({**layout, "id": layout_id, "name": name})
        with self._db_connection() as conn:
            with conn:
                if position is None:
                    position = conn.execute(
                        "SELECT COALESCE(MAX(position), -1) + 1 "
                        "FROM meteogram_layouts"
                    ).fetchone()[0]
                else:
                    # Nothing goes before the Default entry.
                    position = max(1, int(position))
                    conn.execute(
                        "UPDATE meteogram_layouts SET position = position + 1 "
                        "WHERE position >= ?",
                        (position,),
                    )
                conn.execute(
                    "INSERT INTO meteogram_layouts "
                    "(id, name, position, layout_json, builtin_id) "
                    "VALUES (?, ?, ?, ?, NULL)",
                    (layout_id, name, position, json.dumps(validated)),
                )
        return self.get_layout(layout_id)  # type: ignore[return-value]

    def update_layout(
        self,
        layout_id: str,
        name: Optional[str] = None,
        layout: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Rename and/or replace a layout; the Default entry keeps its name."""
        existing = self.get_layout(layout_id)
        if existing is None:
            raise KeyError(f"Layout with id {layout_id} not found")
        if name is not None:
            name = self._layout_name(name)
            if existing["fixed"] and name != existing["name"]:
                raise ValueError("the Default entry cannot be renamed")
        new_name = name if name is not None else existing["name"]
        with self._db_connection() as conn:
            with conn:
                if layout is not None:
                    validated = validate_layout(
                        {**layout, "id": layout_id, "name": new_name}
                    )
                    conn.execute(
                        "UPDATE meteogram_layouts "
                        "SET name = ?, layout_json = ? WHERE id = ?",
                        (new_name, json.dumps(validated), layout_id),
                    )
                else:
                    conn.execute(
                        "UPDATE meteogram_layouts SET name = ? WHERE id = ?",
                        (new_name, layout_id),
                    )
        return self.get_layout(layout_id)  # type: ignore[return-value]

    def reset_layout(self, layout_id: str) -> Dict[str, Any]:
        """Restore the built-in layout an entry was seeded from."""
        existing = self.get_layout(layout_id)
        if existing is None:
            raise KeyError(f"Layout with id {layout_id} not found")
        if not existing["builtin_id"]:
            raise ValueError("only built-in entries can be reset")
        return self.update_layout(
            layout_id, layout=builtin_layout(existing["builtin_id"])
        )

    def delete_layout(self, layout_id: str) -> None:
        """Delete a layout; configurations using it fall back to the default.

        The Default entry cannot be deleted.
        """
        if layout_id == DEFAULT_LAYOUT_ID:
            raise ValueError("the Default entry cannot be deleted")
        layouts = self.list_layouts()
        if not any(entry["id"] == layout_id for entry in layouts):
            raise KeyError(f"Layout with id {layout_id} not found")
        remaining = [
            entry["id"]
            for entry in layouts
            if not entry["fixed"] and entry["id"] != layout_id
        ]
        with self._db_connection() as conn:
            with conn:
                conn.execute(
                    "DELETE FROM meteogram_layouts WHERE id = ?", (layout_id,)
                )
                for position, remaining_id in enumerate(
                    [DEFAULT_LAYOUT_ID] + remaining
                ):
                    conn.execute(
                        "UPDATE meteogram_layouts SET position = ? WHERE id = ?",
                        (position, remaining_id),
                    )
                rows = conn.execute(
                    "SELECT id, data FROM meteogram_configs"
                ).fetchall()
                for config_id, raw in rows:
                    try:
                        data = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(data, dict) and data.get("layout_id") == layout_id:
                        data["layout_id"] = None
                        conn.execute(
                            "UPDATE meteogram_configs SET data = ? WHERE id = ?",
                            (json.dumps(data), config_id),
                        )

    def reorder_layouts(self, ordered_ids: List[str]) -> List[Dict[str, Any]]:
        """Store a new order; Default stays first, unknown ids are ignored."""
        known = [entry["id"] for entry in self.list_layouts()]
        order = [DEFAULT_LAYOUT_ID] + [
            layout_id
            for layout_id in dict.fromkeys(ordered_ids)
            if layout_id in known and layout_id != DEFAULT_LAYOUT_ID
        ]
        # Entries missing from the request keep their relative order at the end.
        order += [layout_id for layout_id in known if layout_id not in order]
        with self._db_connection() as conn:
            with conn:
                conn.executemany(
                    "UPDATE meteogram_layouts SET position = ? WHERE id = ?",
                    [(position, layout_id) for position, layout_id in enumerate(order)],
                )
        return self.list_layouts()

    def create(
        self, config: MeteogramConfig, position: Optional[int] = None
    ) -> MeteogramConfig:
        if config.id is None:
            import uuid

            config.id = str(uuid.uuid4())

        with self._db_connection() as conn:
            with conn:
                if position is None:
                    cursor = conn.execute(
                        "SELECT COALESCE(MAX(position), -1) + 1 FROM meteogram_configs"
                    )
                    pos = cursor.fetchone()[0]
                else:
                    pos = position
                    conn.execute(
                        "UPDATE meteogram_configs SET position = position + 1 WHERE position >= ?",
                        (pos,),
                    )
                config.position = pos
                conn.execute(
                    "INSERT INTO meteogram_configs "
                    "(id, data, position, state_since) VALUES (?, ?, ?, ?)",
                    (
                        config.id,
                        config.model_dump_json(),
                        pos,
                        _utc_now().isoformat(),
                    ),
                )
        return config

    def read(self, config_id: str) -> Optional[MeteogramConfig]:
        with self._db_connection() as conn:
            cursor = conn.execute(
                "SELECT data, position FROM meteogram_configs WHERE id = ?",
                (config_id,),
            )
            row = cursor.fetchone()
            if row:
                cfg = MeteogramConfig.model_validate_json(row[0])
                cfg.position = row[1]
                return cfg
            return None

    def update(self, config: MeteogramConfig) -> MeteogramConfig:
        if config.id is None:
            raise ValueError("Config ID cannot be None for update")
        with self._db_connection() as conn:
            with conn:
                row = conn.execute(
                    "SELECT data FROM meteogram_configs WHERE id = ?",
                    (config.id,),
                ).fetchone()
                if row is not None and _config_state(
                    MeteogramConfig.model_validate_json(row[0])
                ) != _config_state(config):
                    # The configuration got a new state: a later archived
                    # fetch dates its version from here (system.md §9.5).
                    conn.execute(
                        "UPDATE meteogram_configs SET state_since = ? "
                        "WHERE id = ?",
                        (_utc_now().isoformat(), config.id),
                    )
                if config.position is not None:
                    cursor = conn.execute(
                        "UPDATE meteogram_configs SET data = ?, position = ? WHERE id = ?",
                        (config.model_dump_json(), config.position, config.id),
                    )
                else:
                    cursor = conn.execute(
                        "UPDATE meteogram_configs SET data = ? WHERE id = ?",
                        (config.model_dump_json(), config.id),
                    )
                if cursor.rowcount == 0:
                    raise KeyError(f"Config with id {config.id} not found")
        return config

    def delete(self, config_id: str) -> None:
        with self._db_connection() as conn:
            with conn:
                cursor = conn.execute(
                    "SELECT position FROM meteogram_configs WHERE id = ?",
                    (config_id,),
                )
                row = cursor.fetchone()
                if not row:
                    raise KeyError(f"Config with id {config_id} not found")
                deleted_pos = row[0]
                conn.execute(
                    "DELETE FROM meteogram_configs WHERE id = ?", (config_id,)
                )
                # Versions stay for the archive; only their validity ends.
                conn.execute(
                    "UPDATE model_chain_config_versions SET valid_to = ? "
                    "WHERE config_id = ? AND valid_to IS NULL",
                    (_utc_now().isoformat(), config_id),
                )
                if deleted_pos is not None:
                    conn.execute(
                        "UPDATE meteogram_configs SET position = position - 1 WHERE position > ?",
                        (deleted_pos,),
                    )

    def reorder(self, ordered_ids: List[str]) -> None:
        with self._db_connection() as conn:
            with conn:
                for idx, cfg_id in enumerate(ordered_ids):
                    cursor = conn.execute(
                        "SELECT data FROM meteogram_configs WHERE id = ?",
                        (cfg_id,),
                    )
                    row = cursor.fetchone()
                    if row:
                        try:
                            cfg = MeteogramConfig.model_validate_json(row[0])
                            cfg.position = idx
                            conn.execute(
                                "UPDATE meteogram_configs SET position = ?, data = ? WHERE id = ?",
                                (idx, cfg.model_dump_json(), cfg_id),
                            )
                        except Exception:
                            conn.execute(
                                "UPDATE meteogram_configs SET position = ? WHERE id = ?",
                                (idx, cfg_id),
                            )

    def list_all(self) -> List[MeteogramConfig]:
        with self._db_connection() as conn:
            cursor = conn.execute(
                "SELECT data, position FROM meteogram_configs ORDER BY position ASC, rowid ASC"
            )
            configs = []
            for row in cursor.fetchall():
                cfg = MeteogramConfig.model_validate_json(row[0])
                cfg.position = row[1]
                configs.append(cfg)
            return configs

    def record_location_selection(self, location: Location) -> None:
        loc_id = location_key(location.latitude, location.longitude)
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._db_connection() as conn:
            with conn:
                conn.execute(
                    """
                    INSERT INTO location_history (
                        id, name, latitude, longitude, elevation, country, admin1, timezone, selection_count, last_selected_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        selection_count = selection_count + 1,
                        last_selected_at = excluded.last_selected_at,
                        name = excluded.name,
                        elevation = COALESCE(excluded.elevation, location_history.elevation),
                        country = COALESCE(excluded.country, location_history.country),
                        admin1 = COALESCE(excluded.admin1, location_history.admin1),
                        timezone = COALESCE(excluded.timezone, location_history.timezone)
                    """,
                    (
                        loc_id,
                        location.name,
                        round(location.latitude, 4),
                        round(location.longitude, 4),
                        location.elevation,
                        location.country,
                        location.admin1,
                        location.timezone,
                        now_iso,
                    ),
                )

    def archive_api_response(
        self,
        request_kind: str,
        params: Dict[str, Any],
        response: Dict[str, Any],
    ) -> None:
        """Append one raw API response to the write-only fetch archive.

        Stores nothing while archiving is disabled (system.md §9.3).
        """
        if not self.is_archive_enabled():
            return
        fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._db_connection() as conn:
            with conn:
                conn.execute(
                    """
                    INSERT INTO api_fetch_archive (
                        fetched_at, request_kind, model, latitude, longitude, params, response
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        fetched_at,
                        request_kind,
                        params.get("models"),
                        params.get("latitude"),
                        params.get("longitude"),
                        json.dumps(params, default=str),
                        json.dumps(response, default=str),
                    ),
                )

    def record_model_availability(
        self,
        availabilities: List[ModelAvailability],
        location: Location,
        forecast_start: Optional[str],
    ) -> None:
        """Append per-model run availability rows (never read back).

        Stores nothing while archiving is disabled (system.md §9.3).
        """
        if not self.is_archive_enabled():
            return
        recorded_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._db_connection() as conn:
            with conn:
                conn.executemany(
                    """
                    INSERT INTO model_run_availability (
                        recorded_at, chain, model, model_id, latitude, longitude,
                        forecast_start, available_hours, valid_until,
                        last_run_init_time, last_run_availability_time,
                        data_end_run_init_time, run_segments
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            recorded_at,
                            a.chain,
                            a.model,
                            a.model_id,
                            location.latitude,
                            location.longitude,
                            forecast_start,
                            a.available_hours,
                            a.valid_until,
                            a.last_run_init_time,
                            a.last_run_availability_time,
                            a.data_end_run_init_time,
                            json.dumps(
                                [seg.model_dump() for seg in a.run_segments]
                            ),
                        )
                        for a in availabilities
                    ],
                )

    def get_most_used_locations(
        self, limit: Optional[int] = None
    ) -> List[Location]:
        """Stored locations, most selected first; all of them by default."""
        with self._db_connection() as conn:
            cursor = conn.execute(
                """
                SELECT name, latitude, longitude, elevation, country, admin1, timezone
                FROM location_history
                ORDER BY selection_count DESC, last_selected_at DESC
                LIMIT ?
                """,
                # SQLite: a negative LIMIT returns every row.
                (limit if limit is not None and limit >= 0 else -1,),
            )
            rows = cursor.fetchall()
            return [
                Location(
                    name=row[0],
                    latitude=row[1],
                    longitude=row[2],
                    elevation=row[3],
                    country=row[4],
                    admin1=row[5],
                    timezone=row[6],
                )
                for row in rows
            ]


    # ----------------------------------------------------------------------
    # Structured forecast archive (system.md §9)
    # ----------------------------------------------------------------------

    def record_forecast_fetch(
        self,
        response: HarmonizedForecastResponse,
        config: MeteogramConfig,
        region_id: Optional[str] = None,
    ) -> Optional[int]:
        """Store a completed forecast; return its fetch id.

        Stores nothing and returns None while archiving is disabled.
        In power mode a fetch with a stored configuration references the
        configuration's version (system.md §9.5); normal mode and unsaved
        configurations (Auto entry) keep only the chain snapshot.
        Quantities the registry marks as not downloadable (derived ones,
        system.md §5.1) are never stored; only their sources are.
        """
        settings = self.get_settings()
        if not settings["archive_enabled"]:
            return None
        location = config.location
        main_chain = config.main_model_chain or config.model_chain
        availability: Dict[str, ModelAvailability] = {
            **{f"main:{k}": v for k, v in response.model_availability.items()},
            **{
                f"cloud:{k}": v
                for k, v in response.cloud_model_availability.items()
            },
        }

        def run_of(chain: str, model: str) -> tuple:
            entry = availability.get(f"{chain}:{model}")
            if entry is None:
                return None, None
            return entry.model_id, entry.last_run_init_time

        series_rows = []
        for model, points in response.model_forecasts.items():
            by_variable: Dict[str, List[Any]] = {}
            for point in points:
                quantity = QUANTITIES.get(point.variable)
                if quantity is not None and not quantity.downloadable:
                    continue
                by_variable.setdefault(point.variable, []).append(point)
            model_id, run_init = run_of("main", model)
            for variable, var_points in by_variable.items():
                var_points.sort(key=lambda p: p.timestamp)
                series_rows.append(
                    (
                        "main",
                        model,
                        model_id,
                        run_init,
                        variable,
                        var_points[0].unit,
                        json.dumps([p.timestamp for p in var_points]),
                        json.dumps([p.value for p in var_points]),
                    )
                )
        for model, forecast in response.vertical_cloud_model_forecasts.items():
            if not forecast.profiles:
                continue
            model_id, run_init = run_of("cloud", model)
            profiles = sorted(forecast.profiles, key=lambda p: p.timestamp)
            series_rows.append(
                (
                    "cloud",
                    model,
                    model_id or profiles[0].source_model_id,
                    run_init,
                    CLOUD_PROFILE_VARIABLE,
                    "%",
                    json.dumps([p.timestamp for p in profiles]),
                    json.dumps(
                        [
                            [level.model_dump() for level in p.levels]
                            for p in profiles
                        ]
                    ),
                )
            )

        meta = {
            "generated_at": response.generated_at,
            "forecast_start_time": response.forecast_start_time,
            "timeline_start": response.timeline_start,
            "timeline_end": response.timeline_end,
            "user_timezone": response.user_timezone,
            "sun_phases": [p.model_dump() for p in response.sun_phases],
            "vertical_cloud_transitions": [
                t.model_dump() for t in response.vertical_cloud_transitions
            ],
            "model_availability": {
                k: v.model_dump() for k, v in response.model_availability.items()
            },
            "cloud_model_availability": {
                k: v.model_dump()
                for k, v in response.cloud_model_availability.items()
            },
        }
        chain = {
            "main": [m.model_dump() for m in main_chain or []],
            "cloud": [m.model_dump() for m in config.cloud_model_chain or []],
        }
        fetched_at = _utc_now().isoformat()
        with self._db_connection() as conn:
            with conn:
                config_version_id = None
                if settings["mode"] == "power" and config.id is not None:
                    config_version_id = self._config_version(
                        conn,
                        config.id,
                        config.layout_id or DEFAULT_LAYOUT_ID,
                        fetched_at,
                    )
                cursor = conn.execute(
                    """
                    INSERT INTO forecast_fetch (
                        fetched_at, location_key, latitude, longitude,
                        location_name, location_json, mode, region_id,
                        chain_json, layout_id, config_id, config_version_id,
                        meta_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        fetched_at,
                        location_key(location.latitude, location.longitude),
                        round(location.latitude, 4),
                        round(location.longitude, 4),
                        location.name,
                        location.model_dump_json(),
                        settings["mode"],
                        region_id,
                        json.dumps(chain),
                        config.layout_id or DEFAULT_LAYOUT_ID,
                        config.id,
                        config_version_id,
                        json.dumps(meta, default=str),
                    ),
                )
                fetch_id = cursor.lastrowid
                conn.executemany(
                    """
                    INSERT INTO forecast_series (
                        fetch_id, chain, model, model_id, run_init_time,
                        variable, unit, timestamps_json, values_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [(fetch_id, *row) for row in series_rows],
                )
        return fetch_id

    def _config_version(
        self, conn, config_id: str, layout_id: str, now: str
    ) -> Optional[int]:
        """Id of the version for the stored state of a configuration.

        Reuses the latest version while the state is unchanged; otherwise
        closes it and writes a new one. None if the configuration is not
        stored (the fetch then keeps only its chain snapshot).
        """
        row = conn.execute(
            "SELECT data, state_since FROM meteogram_configs WHERE id = ?",
            (config_id,),
        ).fetchone()
        if row is None:
            return None
        config = MeteogramConfig.model_validate_json(row[0])
        state = _config_state(config)
        latest = conn.execute(
            "SELECT version_id, valid_from, valid_to, "
            f"{_VERSION_STATE_COLUMNS} FROM model_chain_config_versions "
            "WHERE config_id = ? "
            "ORDER BY version_id DESC LIMIT 1",
            (config_id,),
        ).fetchone()
        valid_from = row[1] or now
        if latest is not None:
            version_id, latest_from, latest_to = latest[:3]
            latest_state = tuple(latest[3:-1])
            if latest_state == state and latest_to is None:
                if latest[-1] == layout_id:
                    return version_id
                # Only the layout changed: no save time to date it from.
                valid_from = now
            # No back-dated edits: a version starts after its predecessor.
            valid_from = max(valid_from, latest_from, latest_to or "")
            if latest_to is None:
                conn.execute(
                    "UPDATE model_chain_config_versions SET valid_to = ? "
                    "WHERE version_id = ?",
                    (valid_from, version_id),
                )
        valid_from = min(valid_from, now)
        cursor = conn.execute(
            "INSERT INTO model_chain_config_versions "
            f"(config_id, valid_from, {_VERSION_STATE_COLUMNS}) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (config_id, valid_from, *state, layout_id),
        )
        return cursor.lastrowid

    def get_config_version(self, version_id: int) -> Optional[Dict[str, Any]]:
        """One configuration version (historic viewer only, #144)."""
        with self._db_connection() as conn:
            row = conn.execute(
                "SELECT version_id, config_id, valid_from, valid_to, "
                f"{_VERSION_STATE_COLUMNS} FROM model_chain_config_versions "
                "WHERE version_id = ?",
                (version_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "version_id": row[0],
            "config_id": row[1],
            "valid_from": row[2],
            "valid_to": row[3],
            "name": row[4],
            "location": json.loads(row[5]),
            "location_name_override": row[6],
            "main_model_chain": json.loads(row[7]),
            "cloud_model_chain": json.loads(row[8]),
            "layout_id": row[9],
        }

    @staticmethod
    def _fetch_summary(row: tuple) -> Dict[str, Any]:
        return {
            "id": row[0],
            "fetched_at": row[1],
            "latitude": row[2],
            "longitude": row[3],
            "location": json.loads(row[4]),
            "mode": row[5],
            "region_id": row[6],
            "chain": json.loads(row[7]),
            "layout_id": row[8],
            "config_id": row[9],
            "config_version_id": row[10],
        }

    _FETCH_COLUMNS = (
        "id, fetched_at, latitude, longitude, location_json, mode, "
        "region_id, chain_json, layout_id, config_id, config_version_id"
    )

    def list_archived_fetches(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 1.0,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Archived fetches within `radius_km` of a location, newest first.

        Read API for the historic viewer only (system.md §9.4, §10).
        """
        dlat = math.degrees(radius_km / EARTH_RADIUS_KM)
        cos_lat = max(math.cos(math.radians(latitude)), 1e-6)
        dlon = min(180.0, dlat / cos_lat)
        with self._db_connection() as conn:
            rows = conn.execute(
                f"SELECT {self._FETCH_COLUMNS} FROM forecast_fetch "
                "WHERE latitude BETWEEN ? AND ? "
                "ORDER BY fetched_at DESC, id DESC",
                (latitude - dlat, latitude + dlat),
            ).fetchall()
        result = []
        for row in rows:
            delta_lon = abs((row[3] - longitude + 180.0) % 360.0 - 180.0)
            if delta_lon > dlon:
                continue
            if _distance_km(latitude, longitude, row[2], row[3]) > radius_km:
                continue
            result.append(self._fetch_summary(row))
            if limit is not None and len(result) >= limit:
                break
        versions = self._version_summaries(
            {f["config_version_id"] for f in result} - {None}
        )
        for fetch in result:
            fetch["config_version"] = versions.get(fetch["config_version_id"])
        return result

    def _version_summaries(self, version_ids) -> Dict[int, Dict[str, Any]]:
        """Name and validity of configuration versions (Q9, #144)."""
        if not version_ids:
            return {}
        ids = sorted(version_ids)
        with self._db_connection() as conn:
            rows = conn.execute(
                "SELECT version_id, name, valid_from, valid_to "
                "FROM model_chain_config_versions WHERE version_id IN "
                f"({', '.join('?' for _ in ids)})",
                ids,
            ).fetchall()
        return {
            row[0]: {
                "version_id": row[0],
                "name": row[1],
                "valid_from": row[2],
                "valid_to": row[3],
            }
            for row in rows
        }

    def get_archived_fetch(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        """One archived fetch with all its series (historic viewer only)."""
        with self._db_connection() as conn:
            row = conn.execute(
                f"SELECT {self._FETCH_COLUMNS}, meta_json FROM forecast_fetch "
                "WHERE id = ?",
                (fetch_id,),
            ).fetchone()
            if row is None:
                return None
            series = conn.execute(
                """
                SELECT chain, model, model_id, run_init_time, variable, unit,
                       timestamps_json, values_json
                FROM forecast_series WHERE fetch_id = ? ORDER BY id
                """,
                (fetch_id,),
            ).fetchall()
        fetch = self._fetch_summary(row[:-1])
        fetch["meta"] = json.loads(row[-1])
        fetch["series"] = [
            {
                "chain": s[0],
                "model": s[1],
                "model_id": s[2],
                "run_init_time": s[3],
                "variable": s[4],
                "unit": s[5],
                "timestamps": json.loads(s[6]),
                "values": json.loads(s[7]),
            }
            for s in series
        ]
        return fetch

    def get_historic_forecast(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        """An archived fetch as a forecast response (historic viewer, §10).

        Returns the fetch summary (with its configuration version) and a
        `HarmonizedForecastResponse` built from the stored series, so the
        frontend stitches and draws it like a live forecast.
        """
        fetch = self.get_archived_fetch(fetch_id)
        if fetch is None:
            return None
        meta = fetch.pop("meta")
        location = Location.model_validate(fetch["location"])
        model_forecasts: Dict[str, List[DataPoint]] = {}
        cloud_forecasts: Dict[str, DetailedCloudForecast] = {}
        for series in fetch.pop("series"):
            pairs = zip(series["timestamps"], series["values"])
            if series["chain"] == "cloud":
                cloud_forecasts[series["model"]] = DetailedCloudForecast(
                    location=location,
                    profiles=[
                        VerticalCloudProfile(
                            timestamp=timestamp,
                            source_model_id=(
                                series["model_id"] or series["model"]
                            ),
                            source_model_name=series["model"],
                            source_run=series["run_init_time"],
                            levels=levels,
                        )
                        for timestamp, levels in pairs
                    ],
                )
                continue
            model_forecasts.setdefault(series["model"], []).extend(
                DataPoint(
                    timestamp=timestamp,
                    value=value,
                    unit=series["unit"],
                    variable=series["variable"],
                    model=series["model"],
                )
                for timestamp, value in pairs
            )
        response = HarmonizedForecastResponse(
            combined_forecast=[],
            model_forecasts=model_forecasts,
            vertical_cloud_model_forecasts=cloud_forecasts,
            **{
                key: meta[key]
                for key in (
                    "forecast_start_time",
                    "timeline_start",
                    "timeline_end",
                    "user_timezone",
                    "sun_phases",
                    "vertical_cloud_transitions",
                    "model_availability",
                    "cloud_model_availability",
                    "generated_at",
                )
                if meta.get(key) is not None
            },
        )
        fetch["config_version"] = self._version_summaries(
            {fetch["config_version_id"]} - {None}
        ).get(fetch["config_version_id"])
        return {"fetch": fetch, "forecast": response.model_dump()}

    def _delete_fetches(self, conn, where: str, params: tuple) -> None:
        conn.execute(
            "DELETE FROM forecast_series WHERE fetch_id IN "
            f"(SELECT id FROM forecast_fetch {where})",
            params,
        )
        conn.execute(f"DELETE FROM forecast_fetch {where}", params)
        # Versions live only as long as an archived fetch references them.
        conn.execute(
            "DELETE FROM model_chain_config_versions WHERE version_id NOT IN "
            "(SELECT config_version_id FROM forecast_fetch "
            "WHERE config_version_id IS NOT NULL)"
        )

    def prune_archive(
        self,
        retention_days: Any = "setting",
        now: Optional[datetime.datetime] = None,
    ) -> None:
        """Delete archived rows older than the retention (system.md §9.3).

        Applies to the forecast archive, `api_fetch_archive` and
        `model_run_availability`. `retention_days=None` keeps everything
        (forever); the default reads `archive_retention_days`.
        """
        if retention_days == "setting":
            retention_days = self.get_settings()["archive_retention_days"]
        now = now or _utc_now()
        self._last_prune_at = now
        if retention_days is None:
            return
        cutoff = (now - datetime.timedelta(days=retention_days)).isoformat()
        with self._db_connection() as conn:
            with conn:
                for table, column in ARCHIVE_TABLES:
                    if table == "forecast_fetch":
                        self._delete_fetches(
                            conn, f"WHERE {column} < ?", (cutoff,)
                        )
                    else:
                        conn.execute(
                            f"DELETE FROM {table} WHERE {column} < ?",
                            (cutoff,),
                        )

    def prune_archive_if_due(
        self, now: Optional[datetime.datetime] = None
    ) -> bool:
        """Prune on the first call (startup) and then once per day."""
        now = now or _utc_now()
        if (
            self._last_prune_at is not None
            and now - self._last_prune_at < PRUNE_INTERVAL
        ):
            return False
        self.prune_archive(now=now)
        return True

    def get_archive_stats(self) -> Dict[str, int]:
        """Archived forecasts and the approximate size of all archive rows.

        The size sums the stored values of every archive table (forecast
        archive, config versions, raw API responses, run availability); it
        leaves out SQLite page overhead and free pages.
        """
        size = 0
        with self._db_connection() as conn:
            fetches = conn.execute(
                "SELECT COUNT(*) FROM forecast_fetch"
            ).fetchone()[0]
            for table in METEOGRAM_TABLES:
                columns = [
                    row[1]
                    for row in conn.execute(f'PRAGMA table_info("{table}")')
                ]
                total = " + ".join(
                    f'COALESCE(SUM(LENGTH("{column}")), 0)'
                    for column in columns
                )
                size += conn.execute(
                    f'SELECT {total} FROM "{table}"'
                ).fetchone()[0]
        return {"fetches": int(fetches), "bytes": int(size)}

    def delete_archive(self) -> None:
        """Delete all archived forecast data ("delete archived data", #140)."""
        with self._db_connection() as conn:
            with conn:
                self._delete_fetches(conn, "", ())
                conn.execute("DELETE FROM api_fetch_archive")
                conn.execute("DELETE FROM model_run_availability")
