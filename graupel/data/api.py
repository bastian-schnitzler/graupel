import asyncio
from typing import List, Dict, Any, Optional
from .storage import Storage
from .service import ForecastService
from .models import MeteogramConfig, Location, WeatherModel
from .open_meteo import (
    get_model_catalog,
    get_catalog_load_status,
    to_open_meteo_model,
    get_default_cloud_model,
)


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

    default_definitions = [
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

    created_configs = []
    for defn in default_definitions:
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
        saved = self.storage.update(model_config)
        return saved.model_dump()

    def save_configuration(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates a meteogram configuration in storage."""
        model_config = MeteogramConfig(**config)
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
        response = self._run_async(
            self.service.get_merged_forecast(config, variables=variables)
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

    def get_most_used_locations(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Returns the top N most frequently selected locations from persistent storage.
        """
        locations = self.storage.get_most_used_locations(limit=limit)
        return [loc.model_dump() for loc in locations]

