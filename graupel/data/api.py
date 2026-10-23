import asyncio
import logging
from typing import List, Dict, Any, Optional
from .storage import Storage
from .service import ForecastService
from .models import AutoChainInfo, MeteogramConfig, Location, WeatherModel
from .open_meteo import (
    get_model_catalog,
    get_catalog_load_status,
    to_open_meteo_model,
    get_default_cloud_model,
)
from .layouts import POWER_DEFAULT_LAYOUT, builtin_layout
from .quantities import export_registry
from . import auto_chain

logger = logging.getLogger(__name__)


class MeteogramAPI:
    """
    API exposed to pywebview / React frontend.
    Provides methods:
      - get_forecast(location=None, configuration_id=None, variables=None)
      - get_models()
      - get_configurations()
      - refresh_forecast(location=None, configuration_id=None, variables=None)
    """

    def __init__(
        self,
        storage: Optional[Storage] = None,
        service: Optional[ForecastService] = None,
    ):
        self.storage = storage or Storage()
        self.service = service or ForecastService(storage=self.storage)

    def _run_async(self, coro):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # If called within an existing running event loop
            import nest_asyncio

            nest_asyncio.apply()
            return loop.run_until_complete(coro)
        else:
            return asyncio.run(coro)

    def get_models(self) -> List[Dict[str, Any]]:
        """Returns list of all supported weather models in catalogue."""
        catalog = get_model_catalog()
        return [m.model_dump() for m in catalog]

    def get_catalog_status(self) -> str:
        """Returns catalogue load status: 'refreshed', 'local', or 'unavailable'."""
        return get_catalog_load_status()

    def get_quantity_registry(self) -> List[Dict[str, Any]]:
        """Returns the quantity registry (system.md §5) for the frontend."""
        return export_registry()


# Configurations seeded into an empty database (one per Alpine region).
DEFAULT_CONFIG_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": "Nordalpen",
        "location": Location(
            name="Zugspitze",
            latitude=47.4211,
            longitude=10.9853,
            country="Germany",
            admin1="Bavaria",
            elevation=2962.0,
        ),
        "main_chain_ids": ["icon_d2", "icon_eu", "ecmwf_ifs"],
        "cloud_chain_ids": ["icon_d2", "icon_eu", "ecmwf_ifs025"],
    },
    {
        "name": "Ostalpen",
        "location": Location(
            name="Watzmann",
            latitude=47.5542,
            longitude=12.9228,
            country="Germany",
            admin1="Bavaria",
            elevation=2713.0,
            timezone="Europe/Berlin",
        ),
        "main_chain_ids": [
            "geosphere_arome_austria",
            "icon_eu",
            "ecmwf_ifs",
        ],
        "cloud_chain_ids": ["icon_d2", "icon_eu", "ecmwf_ifs025"],
    },
    {
        "name": "Dolomiten",
        "location": Location(
            name="Ortler",
            latitude=46.5083,
            longitude=10.5417,
            country="Italy",
            admin1="Trentino-Alto Adige/Südtirol",
            elevation=3905.0,
            timezone="Europe/Rome",
        ),
        "main_chain_ids": [
            "italia_meteo_arpae_icon_2i",
            "icon_eu",
            "ecmwf_ifs",
        ],
        "cloud_chain_ids": ["icon_d2", "icon_eu", "ecmwf_ifs025"],
    },
    {
        "name": "Westalpen",
        "location": Location(
            name="Matterhorn",
            latitude=45.9765,
            longitude=7.6586,
            country="Switzerland",
            admin1="Valais",
            elevation=4478.0,
            timezone="Europe/Zurich",
        ),
        "main_chain_ids": [
            "meteoswiss_icon_ch1",
            "meteoswiss_icon_ch2",
            "ecmwf_ifs",
        ],
        "cloud_chain_ids": ["icon_d2", "icon_eu", "ecmwf_ifs025"],
    },
    {
        "name": "Westalpen",
        "location": Location(
            name="Mont Blanc",
            latitude=45.8326,
            longitude=6.8652,
            country="France",
            admin1="Auvergne-Rhône-Alpes",
            elevation=4809.0,
            timezone="Europe/Paris",
        ),
        "main_chain_ids": [
            "meteofrance_arome_france_hd",
            "meteoswiss_icon_ch2",
            "ecmwf_ifs",
        ],
        "cloud_chain_ids": [
            "meteofrance_arome_france",
            "icon_eu",
            "ecmwf_ifs025",
        ],
    },
]


def init_default_configurations(storage: Storage) -> List[MeteogramConfig]:
    """
    Creates the 5 default weather configurations when the database contains no weather configurations yet.
    Initialization is idempotent.
    """
    configs = storage.list_all()
    if configs:
        return configs

    catalog = get_model_catalog()
    catalog_map = {m.id: m for m in catalog if m.id}

    def resolve_model(model_id: str) -> WeatherModel:
        if model_id in catalog_map:
            return catalog_map[model_id].model_copy()
        raise RuntimeError(
            f"Required default weather model ID '{model_id}' not found in model catalogue."
        )

    created_configs = []
    for defn in DEFAULT_CONFIG_DEFINITIONS:
        main_models = [resolve_model(mid) for mid in defn["main_chain_ids"]]
        cloud_models = [resolve_model(mid) for mid in defn["cloud_chain_ids"]]
        config = MeteogramConfig(
            name=defn["name"],
            location=defn["location"],
            model_chain=main_models,
            main_model_chain=main_models,
            cloud_model_chain=cloud_models,
        )
        saved = storage.create(config)
        created_configs.append(saved)

    return created_configs


def _chain_signature(chain: Optional[List[WeatherModel]]) -> List[Any]:
    return [
        (
            (m.id or to_open_meteo_model(m.name)).lower(),
            m.max_forecast_horizon_hours,
        )
        for m in chain or []
    ]


def _config_signature(
    name: str,
    location: Location,
    main: Optional[List[WeatherModel]],
    cloud: Optional[List[WeatherModel]],
) -> Any:
    return (
        name,
        location.name,
        round(location.latitude, 4),
        round(location.longitude, 4),
        _chain_signature(main),
        _chain_signature(cloud),
    )


def has_user_configurations(configs: List[MeteogramConfig]) -> bool:
    """True when the stored configurations differ from the seeded defaults.

    A database without configurations, or with the untouched defaults, holds
    nothing the user set up. Default horizons come from the current catalogue,
    so defaults seeded under an older catalogue count as user configurations:
    that errs towards power mode, where nothing is hidden.
    """
    if not configs:
        return False
    catalog_map = {m.id: m for m in get_model_catalog() if m.id}
    defaults = []
    for defn in DEFAULT_CONFIG_DEFINITIONS:
        ids = defn["main_chain_ids"] + defn["cloud_chain_ids"]
        if any(mid not in catalog_map for mid in ids):
            return True
        defaults.append(
            _config_signature(
                defn["name"],
                defn["location"],
                [catalog_map[mid] for mid in defn["main_chain_ids"]],
                [catalog_map[mid] for mid in defn["cloud_chain_ids"]],
            )
        )
    stored = [
        _config_signature(
            c.name,
            c.location,
            c.main_model_chain or c.model_chain,
            c.cloud_model_chain,
        )
        for c in configs
    ]
    return stored != defaults


def ensure_initial_mode(storage: Storage) -> None:
    """Store the start mode once (system.md §3.1, §13).

    New installations start in normal mode; databases from 0.1.x with
    configurations the user set up start in power mode, so nobody loses
    their setup on upgrade. Later starts keep the stored mode.
    """
    if "mode" in storage.get_stored_setting_keys():
        return
    configs = storage.list_all()
    mode = "power" if has_user_configurations(configs) else "normal"
    storage.update_settings({"mode": mode})


class MeteogramAPI:
    """
    API exposed to pywebview / React frontend.
    Provides methods:
      - get_forecast(location=None, configuration_id=None, variables=None)
      - get_models()
      - get_configurations()
      - refresh_forecast(location=None, configuration_id=None, variables=None)
    """

    def __init__(
        self,
        storage: Optional[Storage] = None,
        service: Optional[ForecastService] = None,
    ):
        self.storage = storage or Storage()
        self.service = service or ForecastService(storage=self.storage)
        self._prune_archive()

    def _prune_archive(self) -> None:
        """Apply the archive retention on startup and once per day."""
        try:
            self.storage.prune_archive_if_due()
        except Exception as e:
            logger.warning(f"Failed to prune forecast archive: {e}")

    def _run_async(self, coro):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # If called within an existing running event loop
            import nest_asyncio

            nest_asyncio.apply()
            return loop.run_until_complete(coro)
        else:
            return asyncio.run(coro)

    def get_models(self) -> List[Dict[str, Any]]:
        """Returns list of all supported weather models in catalogue."""
        catalog = get_model_catalog()
        return [m.model_dump() for m in catalog]

    def get_catalog_status(self) -> str:
        """Returns catalogue load status: 'refreshed', 'local', or 'unavailable'."""
        return get_catalog_load_status()

    def get_quantity_registry(self) -> List[Dict[str, Any]]:
        """Returns the quantity registry (system.md §5) for the frontend."""
        return export_registry()

    def resolve_auto_chain(
        self,
        latitude: float,
        longitude: float,
        elevation: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Location-based main and cloud chain (system.md §6.3)."""
        result = auto_chain.resolve_auto_chain(latitude, longitude, elevation)
        for key in ("main_model_chain", "cloud_model_chain"):
            result[key] = [m.model_dump() for m in result[key]]
        return result

    def list_regions(self) -> List[Dict[str, Any]]:
        """Auto chain regions without geometry (system.md §6.2)."""
        return auto_chain.list_regions()

    def get_region_chains(self, region_id: str) -> Optional[Dict[str, Any]]:
        """A region's main and cloud chain without a point (system.md §6.5)."""
        result = auto_chain.region_chains(region_id)
        if result is None:
            return None
        for key in ("main_model_chain", "cloud_model_chain"):
            result[key] = [m.model_dump() for m in result[key]]
        return result

    def list_auto_chains(self) -> List[Dict[str, Any]]:
        """Fallback and coverage-filtered chains without a region (#198)."""
        entries = auto_chain.list_auto_chains()
        for entry in entries:
            for key in ("main_model_chain", "cloud_model_chain"):
                entry[key] = [m.model_dump() for m in entry[key]]
        return entries

    def get_user_timezone(self) -> str:
        """Return the user's local IANA timezone name derived from Python."""
        from .timeline import get_user_timezone_name

        return get_user_timezone_name()

    def get_configurations(self) -> List[Dict[str, Any]]:
        """Returns list of saved meteogram configurations. Ensures default configurations exist on empty DB."""
        configs = init_default_configurations(self.storage)
        catalog = get_model_catalog()

        # Check unavailable / deprecated models in configs against catalogue
        catalog_identifiers = set()
        for m in catalog:
            catalog_identifiers.add(m.name.lower())
            if m.id:
                catalog_identifiers.add(m.id.lower())

        dumped_configs = []
        for c in configs:
            c_dict = c.model_dump()
            for chain_key in (
                "model_chain",
                "main_model_chain",
                "cloud_model_chain",
            ):
                for m in c_dict.get(chain_key) or []:
                    model_name = m["name"].lower()
                    model_id = (m.get("id") or "").lower()
                    resolved_id = to_open_meteo_model(m["name"]).lower()
                    if (
                        model_name not in catalog_identifiers
                        and model_id not in catalog_identifiers
                        and resolved_id not in catalog_identifiers
                    ):
                        m["unavailable"] = True
                    elif (
                        not m.get("id") and resolved_id in catalog_identifiers
                    ):
                        m["id"] = resolved_id
            dumped_configs.append(c_dict)

        return dumped_configs

    def create_configuration(
        self, config: Dict[str, Any], position: Optional[int] = None
    ) -> Dict[str, Any]:
        """Creates a new meteogram configuration in storage immediately and assigns a persistent ID."""
        model_config = MeteogramConfig(**config)
        self._check_layout_reference(model_config.layout_id)
        saved = self.storage.create(model_config, position=position)
        return saved.model_dump()

    def reorder_configurations(
        self, configuration_ids: List[str]
    ) -> List[Dict[str, Any]]:
        """Updates the sequential order of configurations and returns the updated list."""
        self.storage.reorder(configuration_ids)
        return self.get_configurations()

    def update_configuration(
        self, configuration_id: str, changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Updates an existing configuration by ID with partial or full changes."""
        existing = self.storage.read(configuration_id)
        if not existing:
            raise KeyError(
                f"Configuration with id {configuration_id} not found"
            )

        merged = existing.model_dump()
        merged.update(changes)
        merged["id"] = configuration_id

        model_config = MeteogramConfig(**merged)
        self._check_layout_reference(model_config.layout_id)
        saved = self.storage.update(model_config)
        return saved.model_dump()

    def save_configuration(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates a meteogram configuration in storage."""
        model_config = MeteogramConfig(**config)
        self._check_layout_reference(model_config.layout_id)
        if model_config.id:
            try:
                saved = self.storage.update(model_config)
            except KeyError:
                saved = self.storage.create(model_config)
        else:
            saved = self.storage.create(model_config)
        return saved.model_dump()

    def delete_configuration(self, configuration_id: str) -> Dict[str, bool]:
        """Deletes a configuration by ID."""
        try:
            self.storage.delete(configuration_id)
            return {"success": True}
        except KeyError:
            return {"success": False}

    def _resolve_config(
        self,
        location: Optional[Dict[str, Any]] = None,
        configuration_id: Optional[str] = None,
    ) -> MeteogramConfig:
        if configuration_id:
            cfg = self.storage.read(configuration_id)
            if not cfg:
                raise ValueError(
                    f"Configuration with id '{configuration_id}' not found."
                )
            if location:
                loc = (
                    Location(**location)
                    if isinstance(location, dict)
                    else location
                )
                cfg = cfg.model_copy(update={"location": loc})
            return cfg

        if location:
            catalog = get_model_catalog()
            loc = (
                Location(**location)
                if isinstance(location, dict)
                else location
            )
            default_chain = [
                m
                for m in catalog
                if m.id
                in ("icon_d2", "icon_eu", "gfs_seamless", "ncep_gfs_seamless")
            ]
            default_chain.sort(key=lambda m: m.max_forecast_horizon_hours)
            if not default_chain:
                default_chain = [
                    WeatherModel(
                        name="ICON-D2", max_forecast_horizon_hours=48
                    ),
                    WeatherModel(
                        name="ICON-EU", max_forecast_horizon_hours=120
                    ),
                    WeatherModel(
                        name="GFS Seamless", max_forecast_horizon_hours=384
                    ),
                ]
            return MeteogramConfig(
                name=f"Forecast for {loc.name}",
                location=loc,
                model_chain=default_chain,
                main_model_chain=default_chain,
                cloud_model_chain=[get_default_cloud_model()],
            )

        # Fallback to first available config in storage if exists
        configs = self.storage.list_all()
        if configs:
            return configs[0]

        raise ValueError(
            "Either location or configuration_id must be provided."
        )

    def get_forecast(
        self,
        location: Optional[Dict[str, Any]] = None,
        configuration_id: Optional[str] = None,
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Retrieves harmonized forecast data (both combined series and individual model series).
        """
        config = self._resolve_config(location, configuration_id)
        self._prune_archive()
        response = self._run_async(
            self.service.get_merged_forecast(config, variables=variables)
        )
        return response.model_dump()

    def get_auto_forecast(
        self,
        location: Dict[str, Any],
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Normal-mode forecast with the auto chain of the location.

        The chain is resolved for the location (system.md §6.3); models without
        data there are dropped and the next model takes over (system.md §3.3).
        The response's `auto_chain` names region and the chains used.
        """
        loc = (
            Location(**location) if isinstance(location, dict) else location
        )
        resolved = auto_chain.resolve_auto_chain(
            loc.latitude, loc.longitude, loc.elevation
        )
        main = resolved["main_model_chain"]
        cloud = resolved["cloud_model_chain"]
        config = MeteogramConfig(
            name=resolved["region_name"] or "Auto",
            location=loc,
            model_chain=main,
            main_model_chain=main,
            cloud_model_chain=cloud,
        )
        info = AutoChainInfo(
            region_id=resolved["region_id"],
            region_name=resolved["region_name"],
            resolution_reason=resolved["resolution_reason"],
            main_model_chain=main,
            cloud_model_chain=cloud,
        )
        self._prune_archive()
        response = self._run_async(
            self.service.get_merged_forecast(
                config, variables=variables, auto_chain=info
            )
        )
        return response.model_dump()

    def refresh_forecast(
        self,
        location: Optional[Dict[str, Any]] = None,
        configuration_id: Optional[str] = None,
        variables: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Forces a refresh/re-fetch of forecast data.
        """
        return self.get_forecast(
            location=location,
            configuration_id=configuration_id,
            variables=variables,
        )

    def record_location_selection(self, location: Dict[str, Any]) -> Dict[str, bool]:
        """
        Records an explicit user location selection in persistent storage.
        """
        loc_obj = Location.model_validate(location)
        self.storage.record_location_selection(loc_obj)
        return {"success": True}

    def get_most_used_locations(
        self, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Stored locations, most selected first; all without a limit."""
        locations = self.storage.get_most_used_locations(limit=limit)
        return [loc.model_dump() for loc in locations]

    def get_settings(self) -> Dict[str, Any]:
        """Returns all app settings (mode, archive)."""
        ensure_initial_mode(self.storage)
        return self.storage.get_settings()

    def update_settings(self, changes: Dict[str, Any]) -> Dict[str, Any]:
        """Validates and stores the given settings; returns all settings.

        Raises ValueError and stores nothing when any entry is invalid.
        """
        settings = self.storage.update_settings(changes)
        if "archive_retention_days" in changes:
            # A shorter retention applies at once, not at the next daily prune.
            self.storage.prune_archive()
        return settings

    # --- Meteogram configurations (layout library, system.md §4.3, #168) ---

    def _check_layout_reference(self, layout_id: Optional[str]) -> None:
        if layout_id is not None and self.storage.get_layout(layout_id) is None:
            raise ValueError(f"unknown meteogram configuration: {layout_id}")

    def get_layouts(self) -> List[Dict[str, Any]]:
        """Meteogram configurations in order, Default entry first."""
        return self.storage.list_layouts()

    def create_layout(
        self,
        name: str,
        layout: Optional[Dict[str, Any]] = None,
        position: Optional[int] = None,
    ) -> Dict[str, Any]:
        """New layout; without `layout` a copy of the built-in power default."""
        source = layout or builtin_layout(POWER_DEFAULT_LAYOUT["id"])
        return self.storage.create_layout(name, source, position=position)

    def duplicate_layout(self, layout_id: str) -> Dict[str, Any]:
        """Copy of a layout, placed directly after it."""
        source = self.storage.get_layout(layout_id)
        if source is None:
            raise KeyError(f"Layout with id {layout_id} not found")
        layout = source["layout"]
        if source["error"] or not isinstance(layout, dict):
            # An invalid stored layout is drawn as its built-in fallback.
            layout = builtin_layout(
                source["builtin_id"] or POWER_DEFAULT_LAYOUT["id"]
            )
        return self.storage.create_layout(
            f"{source['name']} (copy)", layout, position=source["position"] + 1
        )

    def update_layout(
        self, layout_id: str, changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Renames (`name`) and/or replaces (`layout`) a layout."""
        unknown = sorted(set(changes) - {"name", "layout"})
        if unknown:
            raise ValueError(f"unknown layout field(s): {', '.join(unknown)}")
        return self.storage.update_layout(
            layout_id, name=changes.get("name"), layout=changes.get("layout")
        )

    def reset_layout(self, layout_id: str) -> Dict[str, Any]:
        """Restores the built-in layout of a seeded entry (Default)."""
        return self.storage.reset_layout(layout_id)

    def delete_layout(self, layout_id: str) -> Dict[str, bool]:
        """Deletes a layout; configurations using it use the Default entry."""
        try:
            self.storage.delete_layout(layout_id)
            return {"success": True}
        except KeyError:
            return {"success": False}

    def reorder_layouts(self, layout_ids: List[str]) -> List[Dict[str, Any]]:
        """Stores a new order (Default stays first); returns all layouts."""
        return self.storage.reorder_layouts(layout_ids)

    def list_archived_forecasts(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 1.0,
    ) -> List[Dict[str, Any]]:
        """Archived fetches near a location, newest first (historic viewer)."""
        return self.storage.list_archived_fetches(
            latitude, longitude, radius_km=radius_km
        )

    def get_archived_forecast(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        """One archived fetch with its series (historic viewer)."""
        return self.storage.get_archived_fetch(int(fetch_id))

    def get_historic_forecast(self, fetch_id: int) -> Optional[Dict[str, Any]]:
        """An archived fetch drawn like a live forecast (system.md §10, #144)."""
        return self.storage.get_historic_forecast(int(fetch_id))

    def get_archive_stats(self) -> Dict[str, int]:
        """Number of archived forecasts and approximate archive size (#140)."""
        return self.storage.get_archive_stats()

    def delete_archive(self) -> Dict[str, bool]:
        """Deletes all archived forecast data (system.md §9.3, #140)."""
        self.storage.delete_archive()
        return {"success": True}
