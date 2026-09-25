#!/usr/bin/env python3
"""
dev-tools/update_catalog.py

Fetches the Open-Meteo OpenAPI specification (forecast.yml), extracts the
models enum, probes the Open-Meteo API to determine each model's supported
variables, forecast horizon, and vertical level support, and updates the
application's model catalog (model_catalogue.json and model_catalog.json).
"""

import asyncio
import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import httpx
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("update_catalog")

OPENAPI_YAML_URL = "https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml"
API_BASE_URL = "https://api.open-meteo.com/v1/forecast"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
LOCAL_YAML_PATH = os.path.join(SCRIPT_DIR, "forecast.yml")
OUT_CATALOGUE_JSON = os.path.join(
    PROJECT_ROOT, "graupel", "models", "model_catalogue.json"
)
OUT_COMPAT_CATALOG_JSON = os.path.join(
    PROJECT_ROOT, "graupel", "models", "model_catalog.json"
)

STANDARD_VARIABLES = [
    "temperature",
    "wind_speed",
    "wind_gusts",
    "wind_direction",
    "cloud_cover",
    "precipitation",
    "precipitation_probability",
]

API_VAR_TO_STANDARD = {
    "temperature_2m": "temperature",
    "wind_speed_10m": "wind_speed",
    "wind_gusts_10m": "wind_gusts",
    "wind_direction_10m": "wind_direction",
    "cloud_cover": "cloud_cover",
    "precipitation": "precipitation",
    "precipitation_probability": "precipitation_probability",
    "cape": "cape",
    "convective_inhibition": "convective_inhibition",
    "lightning_potential": "lightning_potential",
}

DEFAULT_PRESSURE_LEVELS = [
    1000,
    950,
    925,
    900,
    850,
    800,
    700,
    600,
    500,
    400,
    300,
    250,
    200,
    150,
    100,
]

TEST_COORDS_MAP = {
    "cma": (39.9, 116.4),  # Beijing, China
    "bom": (-33.8, 151.2),  # Sydney, Australia
    "hrrr": (40.7, -74.0),  # New York, USA
    "nbm": (40.7, -74.0),  # New York, USA
    "nam": (40.7, -74.0),  # New York, USA
    "jma": (35.6, 139.7),  # Tokyo, Japan
    "kma": (37.5, 127.0),  # Seoul, Korea
    "west": (49.2, -123.1),  # Vancouver, Canada
    "gem": (45.5, -73.6),  # Montreal, Canada
    "geosphere": (47.5, 14.5),  # Austria
    "knmi": (52.1, 5.2),  # Utrecht, Netherlands
    "dmi": (55.7, 12.6),  # Copenhagen, Denmark
    "metno": (59.9, 10.7),  # Oslo, Norway
    "italia": (44.5, 11.3),  # Bologna, Italy
    "chmi": (50.1, 14.4),  # Prague, Czechia
    "meteoswiss": (46.8, 8.2),  # Bern, Switzerland
    "icon_ch": (46.8, 8.2),  # Switzerland
    "arome": (48.8, 2.3),  # Paris, France
    "arpege": (48.8, 2.3),  # Paris, France
    "meteofrance": (48.8, 2.3),  # Paris, France
    "ukmo": (51.5, -0.1),  # London, UK
}

MODEL_METADATA_REGISTRY: Dict[str, Dict[str, Any]] = {
    "best_match": {
        "name": "Best Match",
        "provider": "Open-Meteo",
        "region": "Global",
        "spatial_resolution_km": 2.2,
        "max_forecast_hours": 384,
    },
    "ecmwf_ifs": {
        "name": "ECMWF IFS HRES 9 km",
        "provider": "ECMWF",
        "region": "Global",
        "spatial_resolution_km": 9.0,
        "max_forecast_hours": 240,
        "supports_vcloud": True,
    },
    "ecmwf_ifs025": {
        "name": "ECMWF IFS 0.25°",
        "provider": "ECMWF",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 240,
        "supports_vcloud": True,
    },
    "ecmwf_aifs025_single": {
        "name": "ECMWF AIFS 0.25°",
        "provider": "ECMWF",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 360,
    },
    "cma_grapes_global": {
        "name": "CMA GRAPES Global",
        "provider": "CMA",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 240,
    },
    "bom_access_global": {
        "name": "ACCESS-G",
        "provider": "BOM",
        "region": "Global",
        "spatial_resolution_km": 12.0,
        "max_forecast_hours": 240,
    },
    "ncep_gfs_seamless": {
        "name": "GFS Seamless",
        "provider": "NOAA",
        "region": "Global",
        "spatial_resolution_km": 13.0,
        "max_forecast_hours": 384,
        "supports_vcloud": True,
    },
    "ncep_gfs_global": {
        "name": "GFS Global",
        "provider": "NOAA",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 384,
        "supports_vcloud": True,
    },
    "ncep_hrrr_conus": {
        "name": "HRRR Conus",
        "provider": "NOAA",
        "region": "North America",
        "spatial_resolution_km": 3.0,
        "max_forecast_hours": 48,
    },
    "ncep_nbm_conus": {
        "name": "NBM Conus",
        "provider": "NOAA",
        "region": "North America",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 240,
    },
    "ncep_nam_conus": {
        "name": "NAM Conus",
        "provider": "NOAA",
        "region": "North America",
        "spatial_resolution_km": 12.0,
        "max_forecast_hours": 84,
    },
    "ncep_gfs_graphcast025": {
        "name": "GraphCast 0.25°",
        "provider": "NOAA",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 240,
    },
    "ncep_aigfs025": {
        "name": "AIGFS 0.25°",
        "provider": "NOAA",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 360,
    },
    "ncep_hgefs025_ensemble_mean": {
        "name": "HGEFS 0.25° Ensemble Mean",
        "provider": "NOAA",
        "region": "Global",
        "spatial_resolution_km": 25.0,
        "max_forecast_hours": 384,
    },
    "jma_seamless": {
        "name": "JMA Seamless",
        "provider": "JMA",
        "region": "Global / Japan",
        "spatial_resolution_km": 5.0,
        "max_forecast_hours": 192,
        "supports_vcloud": True,
    },
    "jma_msm": {
        "name": "JMA MSM",
        "provider": "JMA",
        "region": "Japan",
        "spatial_resolution_km": 5.0,
        "max_forecast_hours": 78,
    },
    "jma_gsm": {
        "name": "JMA GSM",
        "provider": "JMA",
        "region": "Global",
        "spatial_resolution_km": 20.0,
        "max_forecast_hours": 192,
    },
    "kma_seamless": {
        "name": "KMA Seamless",
        "provider": "KMA",
        "region": "Global / Korea",
        "spatial_resolution_km": 1.5,
        "max_forecast_hours": 120,
    },
    "kma_ldps": {
        "name": "KMA LDPS",
        "provider": "KMA",
        "region": "Korea",
        "spatial_resolution_km": 1.5,
        "max_forecast_hours": 48,
    },
    "kma_gdps": {
        "name": "KMA GDPS",
        "provider": "KMA",
        "region": "Global",
        "spatial_resolution_km": 10.0,
        "max_forecast_hours": 288,
    },
    "icon_seamless": {
        "name": "ICON Seamless",
        "provider": "DWD",
        "region": "Global / Regional",
        "spatial_resolution_km": 2.2,
        "max_forecast_hours": 180,
        "supports_vcloud": True,
    },
    "icon_global": {
        "name": "ICON Global",
        "provider": "DWD",
        "region": "Global",
        "spatial_resolution_km": 13.0,
        "max_forecast_hours": 180,
        "supports_vcloud": True,
    },
    "icon_eu": {
        "name": "ICON-EU",
        "provider": "DWD",
        "region": "Europe",
        "spatial_resolution_km": 7.0,
        "max_forecast_hours": 120,
        "supports_vcloud": True,
    },
    "icon_d2": {
        "name": "ICON-D2",
        "provider": "DWD",
        "region": "Central Europe",
        "spatial_resolution_km": 2.2,
        "max_forecast_hours": 48,
        "supports_vcloud": True,
    },
    "cmc_gem_seamless": {
        "name": "GEM Seamless",
        "provider": "GEM",
        "region": "Global / North America",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 168,
        "supports_vcloud": True,
    },
    "cmc_gem_gdps": {
        "name": "GEM GDPS Global",
        "provider": "GEM",
        "region": "Global",
        "spatial_resolution_km": 15.0,
        "max_forecast_hours": 240,
    },
    "cmc_gem_rdps": {
        "name": "GEM RDPS Regional",
        "provider": "GEM",
        "region": "North America",
        "spatial_resolution_km": 10.0,
        "max_forecast_hours": 84,
    },
    "cmc_gem_hrdps": {
        "name": "GEM HRDPS Continental",
        "provider": "GEM",
        "region": "Canada",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 48,
    },
    "cmc_gem_hrdps_west": {
        "name": "GEM HRDPS West",
        "provider": "GEM",
        "region": "Western Canada",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 48,
    },
    "meteofrance_seamless": {
        "name": "Météo-France Seamless",
        "provider": "Météo-France",
        "region": "Global / France",
        "spatial_resolution_km": 1.3,
        "max_forecast_hours": 114,
        "supports_vcloud": True,
    },
    "meteofrance_arpege_world": {
        "name": "ARPEGE World",
        "provider": "Météo-France",
        "region": "Global",
        "spatial_resolution_km": 10.0,
        "max_forecast_hours": 114,
        "supports_vcloud": True,
    },
    "meteofrance_arpege_europe": {
        "name": "ARPEGE Europe",
        "provider": "Météo-France",
        "region": "Europe",
        "spatial_resolution_km": 7.5,
        "max_forecast_hours": 114,
        "supports_vcloud": True,
    },
    "meteofrance_arome_france": {
        "name": "AROME France",
        "provider": "Météo-France",
        "region": "France",
        "spatial_resolution_km": 1.3,
        "max_forecast_hours": 42,
        "supports_vcloud": True,
    },
    "meteofrance_arome_france_hd": {
        "name": "AROME France HD",
        "provider": "Météo-France",
        "region": "France",
        "spatial_resolution_km": 1.5,
        "max_forecast_hours": 42,
        "supports_vcloud": True,
    },
    "italia_meteo_arpae_icon_2i": {
        "name": "ItaliaMeteo ARPAE ICON 2I",
        "provider": "ItaliaMeteo / ARPAE",
        "region": "Italy",
        "spatial_resolution_km": 2.2,
        "max_forecast_hours": 48,
        "supports_vcloud": True,
    },
    "metno_seamless": {
        "name": "MET Norway Seamless",
        "provider": "MET Norway",
        "region": "Nordic",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 60,
    },
    "metno_nordic": {
        "name": "MET Norway Nordic",
        "provider": "MET Norway",
        "region": "Nordic",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 60,
    },
    "knmi_seamless": {
        "name": "KNMI Seamless",
        "provider": "KNMI",
        "region": "Europe / Netherlands",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 48,
    },
    "knmi_harmonie_arome_europe": {
        "name": "KNMI Harmonie AROME Europe",
        "provider": "KNMI",
        "region": "Europe",
        "spatial_resolution_km": 5.0,
        "max_forecast_hours": 48,
    },
    "knmi_harmonie_arome_netherlands": {
        "name": "KNMI Harmonie AROME Netherlands",
        "provider": "KNMI",
        "region": "Netherlands",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 48,
    },
    "dmi_seamless": {
        "name": "DMI Seamless",
        "provider": "DMI",
        "region": "Europe / Denmark",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 54,
    },
    "dmi_harmonie_arome_europe": {
        "name": "DMI Harmonie AROME Europe",
        "provider": "DMI",
        "region": "Europe",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 54,
    },
    "ukmo_seamless": {
        "name": "UKMO Seamless",
        "provider": "UK Met Office",
        "region": "Global / UK",
        "spatial_resolution_km": 2.0,
        "max_forecast_hours": 144,
        "supports_vcloud": True,
    },
    "ukmo_global_deterministic_10km": {
        "name": "UKMO Global 10km",
        "provider": "UK Met Office",
        "region": "Global",
        "spatial_resolution_km": 10.0,
        "max_forecast_hours": 144,
    },
    "ukmo_uk_deterministic_2km": {
        "name": "UKMO UK 2km",
        "provider": "UK Met Office",
        "region": "UK",
        "spatial_resolution_km": 2.0,
        "max_forecast_hours": 120,
    },
    "meteoswiss_icon_seamless": {
        "name": "MeteoSwiss ICON Seamless",
        "provider": "MeteoSwiss",
        "region": "Switzerland / Alps",
        "spatial_resolution_km": 1.1,
        "max_forecast_hours": 120,
        "supports_vcloud": True,
    },
    "meteoswiss_icon_ch1": {
        "name": "MeteoSwiss ICON-CH1",
        "provider": "MeteoSwiss",
        "region": "Switzerland / Alps",
        "spatial_resolution_km": 1.1,
        "max_forecast_hours": 33,
        "supports_vcloud": True,
    },
    "meteoswiss_icon_ch2": {
        "name": "MeteoSwiss ICON-CH2",
        "provider": "MeteoSwiss",
        "region": "Central Europe / Alps",
        "spatial_resolution_km": 2.1,
        "max_forecast_hours": 120,
        "supports_vcloud": True,
    },
    "geosphere_seamless": {
        "name": "GeoSphere Austria Seamless",
        "provider": "GeoSphere Austria",
        "region": "Austria / Alps",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 72,
    },
    "geosphere_arome_austria": {
        "name": "GeoSphere AROME Austria",
        "provider": "GeoSphere Austria",
        "region": "Austria / Alps",
        "spatial_resolution_km": 2.5,
        "max_forecast_hours": 60,
    },
}


def get_test_coordinates(model_id: str) -> Tuple[float, float]:
    """Selects coordinates inside the operational coverage area of a model."""
    m_lower = model_id.lower()
    for prefix, coords in TEST_COORDS_MAP.items():
        if prefix in m_lower:
            return coords
    return (50.0, 8.0)


def fetch_openapi_yaml(timeout: float = 20.0) -> str:
    """Fetches the official forecast.yml from the Open-Meteo GitHub repository."""
    logger.info(
        f"Downloading OpenAPI specification from {OPENAPI_YAML_URL}..."
    )
    try:
        resp = httpx.get(
            OPENAPI_YAML_URL,
            timeout=timeout,
            headers={"User-Agent": "MeteoApp-CatalogSync/1.0"},
        )
        resp.raise_for_status()
        content = resp.text

        # Cache locally
        os.makedirs(SCRIPT_DIR, exist_ok=True)
        with open(LOCAL_YAML_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        logger.info(
            f"Saved local snapshot to {LOCAL_YAML_PATH} ({len(content)} bytes)"
        )
        return content
    except Exception as e:
        logger.warning(f"Could not download forecast.yml from GitHub ({e}).")
        if os.path.exists(LOCAL_YAML_PATH):
            logger.info(f"Reading from cached local file {LOCAL_YAML_PATH}")
            with open(LOCAL_YAML_PATH, "r", encoding="utf-8") as f:
                return f.read()
        raise


def extract_models_enum(yaml_content: str) -> List[str]:
    """Parses forecast.yml and extracts models enum."""
    spec = yaml.safe_load(yaml_content)
    parameters = spec["paths"]["/v1/forecast"]["get"]["parameters"]
    for param in parameters:
        if param.get("name") == "models":
            models_list = list(param["schema"]["items"]["enum"])
            logger.info(
                f"Extracted {len(models_list)} model IDs from OpenAPI YAML"
            )
            return models_list
    raise RuntimeError("Parameter 'models' not found in OpenAPI specification")


async def fetch_official_website_model_labels(
    client: httpx.AsyncClient,
) -> Dict[str, str]:
    """Dynamically fetches official model display names from open-meteo-website options."""
    routes = [
        "dwd-api",
        "gfs-api",
        "meteofrance-api",
        "ecmwf-api",
        "ukmo-api",
        "kma-api",
        "jma-api",
        "meteoswiss-api",
        "metno-api",
        "gem-api",
        "bom-api",
        "cma-api",
        "knmi-api",
        "dmi-api",
        "italia-meteo-arpae-api",
        "geosphere-austria-api",
        "chmi-api",
    ]
    base = "https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs"
    model_labels: Dict[str, str] = {}
    for r in routes:
        try:
            resp = await client.get(f"{base}/{r}/options.ts", timeout=5.0)
            if resp.status_code == 200:
                matches = re.findall(
                    r"\{\s*value:\s*[\'\"]([^\'\"]+)[\'\"],\s*label:\s*[\'\"]([^\'\"]+)[\'\"]\s*\}",
                    resp.text,
                )
                for val, lbl in matches:
                    model_labels[val] = lbl
        except Exception:
            pass
    return model_labels


def parse_nominal_resolution(name: str) -> Optional[float]:
    """Extracts explicit resolution from model display name (e.g. '9km', '0.25°', '1.1km')."""
    m_deg = re.search(r"0\.(\d+)°", name)
    if m_deg:
        deg_str = m_deg.group(1)
        if deg_str == "25":
            return 25.0
        elif deg_str in ("4", "40"):
            return 40.0
        elif deg_str == "11":
            return 11.0
        return round(float("0." + deg_str) * 111.19, 1)

    m_km = re.search(r"(\d+(?:\.\d+)?)\s*km\b", name, re.IGNORECASE)
    if m_km:
        return float(m_km.group(1))
    return None


async def probe_model_properties(
    client: httpx.AsyncClient,
    model_id: str,
    semaphore: asyncio.Semaphore,
) -> Dict[str, Any]:
    """Queries Open-Meteo API to discover variable support, horizon, temporal resolution, and spatial grid resolution."""
    async with semaphore:
        lat, lon = get_test_coordinates(model_id)
        api_vars = list(API_VAR_TO_STANDARD.keys())

        params = {
            "latitude": lat,
            "longitude": lon,
            "models": model_id,
            "forecast_hours": 384,
            "hourly": ",".join(
                api_vars
                + ["cloud_cover_1000hPa", "geopotential_height_1000hPa"]
            ),
        }

        detected: Dict[str, Any] = {
            "supported_variables": list(STANDARD_VARIABLES),
            "max_forecast_hours": None,
            "temporal_resolution_hours": 1,
            "spatial_resolution_km": None,
            "supports_vcloud": False,
        }

        for attempt in range(3):
            try:
                resp = await client.get(API_BASE_URL, params=params)
                if resp.status_code == 429:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                if resp.status_code == 200:
                    data = resp.json()
                    hourly = data.get("hourly", {})

                    # 1. Determine supported variables & horizon
                    supported: List[str] = []
                    max_valid_pts = 0

                    for api_var, std_var in API_VAR_TO_STANDARD.items():
                        vals = hourly.get(api_var, [])
                        non_null = sum(1 for v in vals if v is not None)
                        if non_null > 0:
                            supported.append(std_var)
                            max_valid_pts = max(max_valid_pts, non_null)

                    if supported:
                        detected["supported_variables"] = supported

                    if max_valid_pts > 0:
                        detected["max_forecast_hours"] = max_valid_pts

                    # 2. Determine temporal resolution from timestamps
                    time_points = hourly.get("time", [])
                    if len(time_points) >= 2:
                        try:
                            from datetime import datetime

                            t0 = datetime.fromisoformat(time_points[0])
                            t1 = datetime.fromisoformat(time_points[1])
                            diff_hours = (t1 - t0).total_seconds() / 3600.0
                            if diff_hours > 0:
                                detected["temporal_resolution_hours"] = (
                                    1
                                    if diff_hours >= 1
                                    else round(diff_hours, 2)
                                )
                        except Exception:
                            pass

                    # 3. Check vertical pressure levels
                    cc_1000 = hourly.get("cloud_cover_1000hPa", [])
                    gh_1000 = hourly.get("geopotential_height_1000hPa", [])
                    if any(v is not None for v in cc_1000) or any(
                        v is not None for v in gh_1000
                    ):
                        detected["supports_vcloud"] = True

                    # 4. Probe spatial grid spacing dynamically via API grid node snapping
                    base_lat = data.get("latitude")
                    if base_lat is not None:
                        for step in [
                            0.005,
                            0.01,
                            0.015,
                            0.02,
                            0.025,
                            0.03,
                            0.05,
                            0.07,
                            0.1,
                            0.15,
                            0.2,
                            0.25,
                            0.4,
                            0.5,
                        ]:
                            try:
                                r_step = await client.get(
                                    API_BASE_URL,
                                    params={
                                        "latitude": lat + step,
                                        "longitude": lon,
                                        "models": model_id,
                                        "hourly": "temperature_2m",
                                    },
                                )
                                if r_step.status_code == 200:
                                    d_step = r_step.json()
                                    new_lat = d_step.get("latitude")
                                    if (
                                        new_lat is not None
                                        and abs(new_lat - base_lat) > 0.0005
                                    ):
                                        detected["spatial_resolution_km"] = (
                                            round(
                                                abs(new_lat - base_lat)
                                                * 111.19,
                                                1,
                                            )
                                        )
                                        break
                            except Exception:
                                pass

                    logger.info(
                        f"Model {model_id:30s} -> Spatial: {detected['spatial_resolution_km']} km | "
                        f"Temporal: {detected['temporal_resolution_hours']}h | "
                        f"Horizon: {detected['max_forecast_hours']}h | "
                        f"Vars: {len(detected['supported_variables'])} | VCloud: {detected['supports_vcloud']}"
                    )
                    break
                else:
                    logger.debug(
                        f"Model {model_id:30s} returned HTTP {resp.status_code}"
                    )
                    break
            except Exception as e:
                logger.debug(
                    f"Probe request failed for model '{model_id}': {e}"
                )
                if attempt < 2:
                    await asyncio.sleep(0.5)

        return detected


def clean_display_name(model_id: str) -> str:
    """Generates a clean human-readable name for models not in registry."""
    words = model_id.replace("_", " ").split()
    capitalized = [
        w.upper() if len(w) <= 4 or w.isdigit() else w.capitalize()
        for w in words
    ]
    return " ".join(capitalized)


async def build_catalog(yaml_models: List[str]) -> List[Dict[str, Any]]:
    """Builds the complete catalogue covering all models in the OpenAPI YAML."""
    logger.info(f"Probing {len(yaml_models)} models via Open-Meteo API...")
    semaphore = asyncio.Semaphore(5)  # Rate limiting concurrency

    async with httpx.AsyncClient(timeout=25.0) as client:
        website_labels = await fetch_official_website_model_labels(client)
        tasks = [
            probe_model_properties(client, model_id, semaphore)
            for model_id in yaml_models
        ]
        probe_results = await asyncio.gather(*tasks)

    catalogue: List[Dict[str, Any]] = []

    for model_id, probed in zip(yaml_models, probe_results):
        meta = MODEL_METADATA_REGISTRY.get(model_id, {})

        # Official display name from website options, or registry, or clean name
        official_name = (
            website_labels.get(model_id)
            or meta.get("name")
            or clean_display_name(model_id)
        )
        provider = meta.get("provider") or "National Weather Service"
        region = meta.get("region") or "Global"

        # Spatial resolution:
        # 1. Nominal from official name or registry
        nominal_res = parse_nominal_resolution(official_name) or meta.get(
            "spatial_resolution_km"
        )
        # 2. Live probed grid step from Open-Meteo API
        probed_res = probed.get("spatial_resolution_km")
        if nominal_res is not None:
            spatial_res = nominal_res
        elif probed_res is not None:
            spatial_res = probed_res
        else:
            spatial_res = 10.0

        # Temporal resolution from live API response
        temporal_res = (
            probed.get("temporal_resolution_hours")
            or meta.get("temporal_resolution_hours")
            or 1
        )

        # Horizon: live probed horizon, or verified registry value if higher / stable regression
        reg_hours = meta.get("max_forecast_hours")
        probed_hours = probed.get("max_forecast_hours")
        if reg_hours and probed_hours:
            final_hours = max(reg_hours, probed_hours)
        else:
            final_hours = reg_hours or probed_hours or 48

        # Variables: ensure supported_variables does not contain non-supported vars
        final_vars = probed.get("supported_variables") or list(
            STANDARD_VARIABLES
        )
        for core_var in (
            "temperature",
            "wind_speed",
            "cloud_cover",
            "precipitation",
        ):
            if core_var not in final_vars:
                final_vars.append(core_var)

        supports_vcloud = (
            meta.get("supports_vcloud")
            or probed.get("supports_vcloud")
            or False
        )
        pressure_levels = (
            list(DEFAULT_PRESSURE_LEVELS) if supports_vcloud else []
        )

        entry = {
            "id": model_id,
            "name": official_name,
            "provider": provider,
            "region": region,
            "spatial_resolution_km": float(spatial_res),
            "temporal_resolution_hours": temporal_res,
            "max_forecast_hours": int(final_hours),
            "supported_variables": final_vars,
            "active": True,
            "supports_vertical_cloud_profile": supports_vcloud,
            "supports_pressure_level_cloud_cover": supports_vcloud,
            "supports_geopotential_height": supports_vcloud,
            "pressure_levels_hpa": pressure_levels,
        }
        catalogue.append(entry)

    logger.info(f"Successfully compiled catalog with {len(catalogue)} models.")
    return catalogue


def save_catalog_files(catalogue: List[Dict[str, Any]]) -> None:
    """Writes the updated catalog to both target locations."""
    os.makedirs(os.path.dirname(OUT_CATALOGUE_JSON), exist_ok=True)
    with open(OUT_CATALOGUE_JSON, "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)
        f.write("\n")
    logger.info(f"Updated {OUT_CATALOGUE_JSON} with {len(catalogue)} entries.")

    compat_list = []
    for item in catalogue:
        compat_item = {
            "id": item["id"],
            "name": item["name"],
            "spatial_resolution": item["spatial_resolution_km"],
            "temporal_resolution": item["temporal_resolution_hours"],
            "max_forecast_horizon_hours": item["max_forecast_hours"],
            "supported_variables": item["supported_variables"],
            "geographical_coverage": item["region"],
            "supports_vertical_cloud_profile": item[
                "supports_vertical_cloud_profile"
            ],
            "supports_pressure_level_cloud_cover": item[
                "supports_pressure_level_cloud_cover"
            ],
            "supports_geopotential_height": item[
                "supports_geopotential_height"
            ],
            "pressure_levels_hpa": item["pressure_levels_hpa"],
        }
        compat_list.append(compat_item)

    with open(OUT_COMPAT_CATALOG_JSON, "w", encoding="utf-8") as f:
        json.dump(compat_list, f, indent=2)
        f.write("\n")
    logger.info(
        f"Updated {OUT_COMPAT_CATALOG_JSON} with {len(compat_list)} entries."
    )


async def main_async() -> int:
    yaml_content = fetch_openapi_yaml()
    yaml_models = extract_models_enum(yaml_content)
    catalogue = await build_catalog(yaml_models)
    save_catalog_files(catalogue)
    logger.info("Catalog sync completed successfully.")
    return 0


def main() -> None:
    sys.exit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
