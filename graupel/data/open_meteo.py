import asyncio
import httpx
import json
import re
import logging
import dateutil.parser
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from .models import MeteogramConfig, WeatherModel, Location
from ..resources import model_resource

logger = logging.getLogger(__name__)

VARIABLE_TO_OPENMETEO = {
    "temperature": "temperature_2m",
    "temperature_2m": "temperature_2m",
    "apparent_temperature": "apparent_temperature",
    "wind_speed": "wind_speed_10m",
    "wind_speed_10m": "wind_speed_10m",
    "wind_gusts": "wind_gusts_10m",
    "wind_gusts_10m": "wind_gusts_10m",
    "wind_direction": "wind_direction_10m",
    "wind_direction_10m": "wind_direction_10m",
    "cloud_cover": "cloud_cover",
    "precipitation": "precipitation",
    "precipitation_probability": "precipitation_probability",
    "weather_code": "weather_code",
    "cape": "cape",
    "cin": "convective_inhibition",
    "convective_inhibition": "convective_inhibition",
    "lightning_potential": "lightning_potential",
}

WEATHER_ICON_VARIABLES = ["weather_code"]

CONVECTIVE_VARIABLES = ["cape", "convective_inhibition", "lightning_potential"]

DEFAULT_VARIABLES = [
    "temperature",
    "apparent_temperature",
    "wind_speed",
    "wind_gusts",
    "wind_direction",
    "cloud_cover",
    "precipitation",
    "precipitation_probability",
]

# Core variables required for minimal forecast usefulness
CORE_VARIABLES = [
    "temperature",
    "wind_speed",
    "cloud_cover",
    "precipitation",
]

MODEL_TO_OPENMETEO = {
    "ICON-D2": "icon_d2",
    "ICON-EU": "icon_eu",
    "GFS": "ncep_gfs_seamless",
    "ECMWF-IFS": "ecmwf_ifs",
    "ECMWF IFS": "ecmwf_ifs",
    "ECMWF IFS HRES": "ecmwf_ifs",
    "ECMWF IFS HRES 9 km": "ecmwf_ifs",
    "ECMWF IFS HRES 9km": "ecmwf_ifs",
    "ECMWF IFS 0.4°": "ecmwf_ifs",
}

MODEL_ALIAS_MAP = {
    "gfs": "ncep_gfs_seamless",
    "gfs seamless": "ncep_gfs_seamless",
    "gfs_seamless": "ncep_gfs_seamless",
    "gfs_global": "ncep_gfs_global",
    "gfs global": "ncep_gfs_global",
    "gfs_hrrr": "ncep_hrrr_conus",
    "gfs_graphcast025": "ncep_gfs_graphcast025",
    "gem": "cmc_gem_seamless",
    "gem_seamless": "cmc_gem_seamless",
    "gem_global": "cmc_gem_gdps",
    "gem_regional": "cmc_gem_rdps",
    "gem_hrdps": "cmc_gem_hrdps",
    "icon": "icon_seamless",
    "icon-d2": "icon_d2",
    "icon-eu": "icon_eu",
    "icon global": "icon_global",
    "icon-global": "icon_global",
    "ecmwf-ifs": "ecmwf_ifs",
    "ecmwf ifs": "ecmwf_ifs",
    "ecmwf ifs hres": "ecmwf_ifs",
    "ecmwf ifs hres 9km": "ecmwf_ifs",
    "ecmwf ifs hres 9 km": "ecmwf_ifs",
    "ecmwf_ifs_hres": "ecmwf_ifs",
    "ecmwf_ifs_hres_9km": "ecmwf_ifs",
    "ecmwf-ifs 0.4°": "ecmwf_ifs",
    "ecmwf ifs 0.4°": "ecmwf_ifs",
    "ecmwf_aifs025": "ecmwf_aifs025_single",
    "icon_ch1": "meteoswiss_icon_ch1",
    "icon_ch2": "meteoswiss_icon_ch2",
    "meteoswiss_icon_ch1_hd": "meteoswiss_icon_ch1",
    "meteoswiss_icon_ch2_hd": "meteoswiss_icon_ch2",
    "meteofrance_arome_hd": "meteofrance_arome_france_hd",
    "ukmo_global_qpe1km": "ukmo_global_deterministic_10km",
}

_CATALOG_CACHE: Optional[List[WeatherModel]] = None
_CATALOG_LOAD_STATUS: str = (
    "unavailable"  # "refreshed", "local", "unavailable"
)


def get_canonical_model_id(
    raw_id: Optional[str], raw_name: Optional[str]
) -> str:
    if raw_id:
        clean_id = raw_id.strip().lower()
        if clean_id in MODEL_ALIAS_MAP:
            return MODEL_ALIAS_MAP[clean_id]
        return clean_id
    if raw_name:
        clean_name = (
            raw_name.strip().lower().replace("-", "_").replace(" ", "_")
        )
        if clean_name in MODEL_ALIAS_MAP:
            return MODEL_ALIAS_MAP[clean_name]
        return clean_name
    return "unknown_model"


def merge_catalog_entries(
    base: Dict[str, Any],
    override: Dict[str, Any],
    source_priority: bool = False,
) -> Dict[str, Any]:
    """
    Merges metadata from override into base.
    If source_priority is True, override takes priority for non-None fields.
    If source_priority is False, base takes priority for existing non-None fields.
    Logs warnings if conflicting values are found for significant fields.
    """
    merged = dict(base)
    canonical_id = merged.get("id") or override.get("id")
    for key, new_val in override.items():
        if new_val is None or new_val == "":
            continue
        old_val = merged.get(key)
        if old_val is not None and old_val != "" and old_val != new_val:
            if key in (
                "name",
                "spatial_resolution_km",
                "spatial_resolution",
                "temporal_resolution_hours",
                "temporal_resolution",
                "max_forecast_hours",
                "max_forecast_horizon_hours",
                "provider",
                "region",
                "geographical_coverage",
            ):
                resolved = new_val if source_priority else old_val
                logger.warning(
                    f"Conflicting metadata for canonical model '{canonical_id}': "
                    f"field '{key}' has '{old_val}' vs '{new_val}'. Resolving to '{resolved}'."
                )
        if old_val is None or old_val == "" or source_priority:
            merged[key] = new_val
    return merged


def _load_raw_catalog_file() -> List[Dict[str, Any]]:
    for filename in ("model_catalogue.json", "model_catalog.json"):
        resource = model_resource(filename)
        if resource.is_file():
            try:
                with resource.open("r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(
                    "Error reading packaged model catalog %s: %s",
                    filename,
                    e,
                )
    return []


def _process_catalog_raw_data(
    data: List[Dict[str, Any]],
) -> List[WeatherModel]:
    canonical_map: Dict[str, Dict[str, Any]] = {}

    for item in data:
        name = item.get("name")
        raw_id = item.get("id")
        if not name and not raw_id:
            continue

        cid = get_canonical_model_id(raw_id, name)
        item_copy = dict(item)
        item_copy["id"] = cid

        if cid in canonical_map:
            canonical_map[cid] = merge_catalog_entries(
                canonical_map[cid], item_copy, source_priority=False
            )
        else:
            canonical_map[cid] = item_copy

    models: List[WeatherModel] = []
    for cid, item in canonical_map.items():
        supported_vars = [
            v
            for v in item.get("supported_variables", [])
            if v
            not in ("cloud_cover_low", "cloud_cover_mid", "cloud_cover_high")
        ]
        item["supported_variables"] = supported_vars

        # Calculate missing optional variables from DEFAULT_VARIABLES
        missing = [v for v in DEFAULT_VARIABLES if v not in supported_vars]
        item["missing_variables"] = missing

        # Filter out truly unsuitable models (e.g. fewer than 2 supported variables)
        if len(supported_vars) < 2:
            continue

        try:
            model_obj = WeatherModel(**item)
            models.append(model_obj)
        except Exception as e:
            logger.warning(
                f"Skipping model {item.get('name')} due to parsing error: {e}"
            )

    return models


def load_catalog(force_refresh: bool = False) -> List[WeatherModel]:
    global _CATALOG_CACHE, _CATALOG_LOAD_STATUS

    if _CATALOG_CACHE is not None and not force_refresh:
        return _CATALOG_CACHE

    raw_data = _load_raw_catalog_file()
    if raw_data:
        _CATALOG_CACHE = _process_catalog_raw_data(raw_data)
        _CATALOG_LOAD_STATUS = "local"
    else:
        _CATALOG_CACHE = []
        _CATALOG_LOAD_STATUS = "unavailable"

    return _CATALOG_CACHE


def get_catalog_load_status() -> str:
    global _CATALOG_LOAD_STATUS
    if _CATALOG_CACHE is None:
        load_catalog()
    return _CATALOG_LOAD_STATUS


def get_model_catalog() -> List[WeatherModel]:
    return load_catalog()


def to_open_meteo_model(model_name: str) -> str:
    """Translate the model label used by the UI to an Open-Meteo model ID."""
    catalog = get_model_catalog()
    clean_input = model_name.strip().lower()

    # Direct match by id or name in catalog
    for m in catalog:
        if m.id and m.id.lower() == clean_input:
            return m.id
        if m.name.lower() == clean_input:
            return m.id or m.name

    # Check alias map
    if clean_input in MODEL_ALIAS_MAP:
        return MODEL_ALIAS_MAP[clean_input]

    normalized_key = clean_input.replace("-", "_").replace(" ", "_")
    if normalized_key in MODEL_ALIAS_MAP:
        return MODEL_ALIAS_MAP[normalized_key]

    for m in catalog:
        if (
            m.name.lower().replace("-", "_").replace(" ", "_")
            == normalized_key
            and m.id
        ):
            return m.id

    return MODEL_TO_OPENMETEO.get(model_name.strip().upper(), normalized_key)


def is_location_in_model_coverage(
    model: WeatherModel, location: Location
) -> bool:
    """
    Checks if a location (lat, lon) falls within the geographical coverage area of a weather model.
    """
    reg = (model.region or model.geographical_coverage or "").lower()
    cid = (model.id or "").lower()
    lat = location.latitude
    lon = location.longitude

    if "global" in reg:
        return True

    if "switzerland" in reg or "alps" in reg or "meteoswiss" in cid:
        return 45.0 <= lat <= 48.5 and 5.5 <= lon <= 11.0

    if "italy" in reg or "italia" in cid or "arpae" in cid:
        return 35.5 <= lat <= 47.2 and 6.5 <= lon <= 18.6

    if cid == "icon_d2" or "central europe" in reg:
        return 43.0 <= lat <= 58.0 and 2.0 <= lon <= 20.0

    if "france" in reg or "arome" in cid:
        return 41.0 <= lat <= 52.0 and -5.5 <= lon <= 10.0

    if "united kingdom" in reg or "uk" in reg or "ukv" in cid:
        return 49.0 <= lat <= 61.0 and -11.0 <= lon <= 2.5

    if "netherlands" in reg:
        return 50.5 <= lat <= 53.7 and 3.2 <= lon <= 7.3

    if "scandinavia" in reg or "nordic" in reg:
        return 54.0 <= lat <= 71.0 and 4.0 <= lon <= 32.0

    if (
        "north america" in reg
        or "canada" in reg
        or cid in ("gfs_hrrr", "gem_regional", "gem_hrdps")
    ):
        return 24.0 <= lat <= 72.0 and -170.0 <= lon <= -50.0

    if "japan" in reg or cid == "jma_msm":
        return 24.0 <= lat <= 46.0 and 122.0 <= lon <= 146.0

    if "europe" in reg:
        return 34.0 <= lat <= 72.0 and -25.0 <= lon <= 45.0

    return True


def is_cloud_compatible_model(model: WeatherModel) -> bool:
    """
    Checks whether a model is eligible for the detailed vertical cloud-profile chain.
    Requires vertical cloud profile support (pressure level clouds + geopotential heights)
    with at least 10 vertical levels.
    """
    if not model.active or model.unavailable:
        return False

    supports_clouds = model.supports_vertical_cloud_profile or (
        model.supports_pressure_level_cloud_cover
        and model.supports_geopotential_height
    )
    if not supports_clouds:
        return False

    levels = model.pressure_levels_hpa or []
    return len(levels) >= 10


def get_default_cloud_model() -> WeatherModel:
    """
    Returns the deterministic default weather model for cloud coverage: ECMWF IFS 0.25°.
    """
    catalog = get_model_catalog()
    for m in catalog:
        if (
            m.id and m.id.lower() == "ecmwf_ifs025"
        ) or "ifs 0.25" in m.name.lower():
            return WeatherModel(
                id=m.id or "ecmwf_ifs025",
                name=m.name,
                provider=m.provider,
                region=m.region,
                spatial_resolution_km=m.spatial_resolution_km,
                temporal_resolution_hours=m.temporal_resolution_hours,
                max_forecast_horizon_hours=m.max_forecast_horizon_hours
                or m.max_forecast_hours
                or 345,
                max_forecast_hours=m.max_forecast_hours or 345,
                supports_vertical_cloud_profile=True,
                supports_pressure_level_cloud_cover=True,
                supports_geopotential_height=True,
                pressure_levels_hpa=m.pressure_levels_hpa
                or [
                    1000,
                    925,
                    850,
                    700,
                    600,
                    500,
                    400,
                    300,
                    250,
                    200,
                    150,
                    100,
                    50,
                ],
            )

    return WeatherModel(
        id="ecmwf_ifs025",
        name="ECMWF IFS 0.25°",
        provider="ECMWF",
        region="Global",
        spatial_resolution_km=25.0,
        temporal_resolution_hours=1.0,
        max_forecast_horizon_hours=345,
        max_forecast_hours=345,
        supports_vertical_cloud_profile=True,
        supports_pressure_level_cloud_cover=True,
        supports_geopotential_height=True,
        pressure_levels_hpa=[
            1000,
            925,
            850,
            700,
            600,
            500,
            400,
            300,
            250,
            200,
            150,
            100,
            50,
        ],
    )


def resolve_vertical_cloud_source(
    location: Location,
    forecast_timestamp: Union[str, datetime],
    available_models: List[WeatherModel],
    start_time: Optional[Union[str, datetime]] = None,
) -> Optional[WeatherModel]:
    """
    Deterministically resolves the optimal weather model for vertical cloud profiles based on:
    - Support for vertical cloud profiles / pressure levels (minimum 10 levels)
    - Location geographical coverage
    - Forecast timestamp offset / model max forecast horizon
    - Spatial and temporal resolution priority
    """
    offset_hours = 0.0
    if start_time is not None:
        t_target = (
            dateutil.parser.isoparse(forecast_timestamp)
            if isinstance(forecast_timestamp, str)
            else forecast_timestamp
        )
        t_start = (
            dateutil.parser.isoparse(start_time)
            if isinstance(start_time, str)
            else start_time
        )
        offset_hours = (t_target - t_start).total_seconds() / 3600.0

    candidates: List[WeatherModel] = []
    for model in available_models:
        if not is_cloud_compatible_model(model):
            continue

        if not is_location_in_model_coverage(model, location):
            continue

        max_horizon = (
            model.max_forecast_horizon_hours or model.max_forecast_hours or 0
        )
        if offset_hours > max_horizon:
            continue

        candidates.append(model)

    if not candidates:
        return None

    def sort_key(m: WeatherModel):
        res = (
            m.spatial_resolution_km
            if m.spatial_resolution_km is not None
            else (
                m.spatial_resolution
                if m.spatial_resolution is not None
                else 999.0
            )
        )
        temp_res = (
            m.temporal_resolution_hours
            if m.temporal_resolution_hours is not None
            else (
                m.temporal_resolution
                if m.temporal_resolution is not None
                else 1.0
            )
        )
        return (res, temp_res, m.id or m.name)

    candidates.sort(key=sort_key)
    return candidates[0]


class OpenMeteoClient:
    RETRYABLE_STATUS_CODES = {500, 502, 503, 504}

    def __init__(
        self,
        base_url: str = "https://api.open-meteo.com/v1/forecast",
        timeout: float = 60.0,
        max_retries: int = 2,
        retry_backoff: float = 0.5,
    ):
        self.base_url = base_url
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff = retry_backoff

    async def _get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    response = await client.get(self.base_url, params=params)
                    response.raise_for_status()
                    try:
                        return response.json()
                    except Exception:
                        # Open-Meteo returns unquoted `nan` when a location is out of bounds for regional models
                        cleaned = re.sub(r":\s*nan\b", ": null", response.text)
                        return json.loads(cleaned)
                except httpx.HTTPStatusError as error:
                    if (
                        error.response.status_code
                        not in self.RETRYABLE_STATUS_CODES
                        or attempt == self.max_retries
                    ):
                        try:
                            err_data = error.response.json()
                            reason = err_data.get("reason", "")
                            if reason:
                                model_name = params.get("models", "")
                                if "no data is available" in reason.lower():
                                    raise RuntimeError(
                                        f"Open-Meteo API Error: {reason} for model '{model_name}'. "
                                        f"The selected location ({params.get('latitude')}, {params.get('longitude')}) is outside this model's geographic coverage."
                                    ) from error
                                raise RuntimeError(
                                    f"Open-Meteo API Error: {reason} (model: {model_name})"
                                ) from error
                        except (RuntimeError, httpx.HTTPStatusError):
                            raise
                        except Exception:
                            pass
                        raise
                except httpx.TransportError:
                    if attempt == self.max_retries:
                        raise

                await asyncio.sleep(self.retry_backoff * (2**attempt))

        raise RuntimeError("Open-Meteo request exhausted without a response")

    async def fetch_data(
        self, config: MeteogramConfig, variables: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Fetches forecast data for a given configuration from the Open-Meteo API.
        """
        models = [to_open_meteo_model(m.name) for m in config.model_chain]
        vars_to_fetch = variables or DEFAULT_VARIABLES
        openmeteo_vars = [
            VARIABLE_TO_OPENMETEO.get(v, v) for v in vars_to_fetch
        ]

        params = {
            "latitude": config.location.latitude,
            "longitude": config.location.longitude,
            "hourly": ",".join(openmeteo_vars),
            "models": ",".join(models) if models else "best_match",
            "daily": "sunrise,sunset",
            # Transport absolute UTC instants; location timezone is only for
            # labels and astronomical display in the presentation layer.
            "timezone": "GMT",
        }

        return await self._get(params)
