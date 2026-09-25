import json
import logging
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("catalogue_builder")

STANDARD_VARIABLES = [
    "temperature",
    "apparent_temperature",
    "wind_speed",
    "wind_gusts",
    "wind_direction",
    "cloud_cover",
    "precipitation",
    "precipitation_probability",
]

PROVIDER_URLS = {
    "DWD": "https://open-meteo.com/en/docs/dwd-api",
    "NOAA": "https://open-meteo.com/en/docs/gfs-api",
    "Météo-France": "https://open-meteo.com/en/docs/meteofrance-api",
    "ECMWF": "https://open-meteo.com/en/docs/ecmwf-api",
    "UK Met Office": "https://open-meteo.com/en/docs/ukmo-api",
    "JMA": "https://open-meteo.com/en/docs/jma-api",
    "MeteoSwiss": "https://open-meteo.com/en/docs/meteoswiss-api",
    "MET Norway": "https://open-meteo.com/en/docs/metno-api",
    "GEM": "https://open-meteo.com/en/docs/gem-api",
    "BOM": "https://open-meteo.com/en/docs/bom-api",
    "CMA": "https://open-meteo.com/en/docs/cma-api",
    "KNMI": "https://open-meteo.com/en/docs/knmi-api",
    "DMI": "https://open-meteo.com/en/docs/dmi-api",
}

# Catalog model definitions mapping canonical model ID to provider & metadata matching keys
MODEL_DEFINITIONS = [
    {
        "id": "icon_seamless",
        "name": "ICON Seamless",
        "provider": "DWD",
        "doc_match": "ICON Global",
        "region": "Global / Regional",
        "override_res": 2.2,
        "override_max_hours": 180,
    },
    {
        "id": "icon_d2",
        "name": "ICON-D2",
        "provider": "DWD",
        "doc_match": "ICON D2",
        "region": "Central Europe",
    },
    {
        "id": "icon_eu",
        "name": "ICON-EU",
        "provider": "DWD",
        "doc_match": "ICON Europe",
        "region": "Europe",
    },
    {
        "id": "icon_global",
        "name": "ICON Global",
        "provider": "DWD",
        "doc_match": "ICON Global",
        "region": "Global",
    },
    {
        "id": "ecmwf_ifs025",
        "name": "ECMWF IFS 0.25°",
        "provider": "ECMWF",
        "doc_match": "IFS 0.25",
        "region": "Global",
        "override_res": 25.0,
        "override_max_hours": 240,
    },
    {
        "id": "ecmwf_ifs",
        "name": "ECMWF-IFS 0.4°",
        "provider": "ECMWF",
        "doc_match": "IFS 0.25",
        "region": "Global",
        "override_res": 40.0,
        "override_max_hours": 240,
    },
    {
        "id": "ecmwf_aifs025",
        "name": "ECMWF AIFS 0.25°",
        "provider": "ECMWF",
        "doc_match": "AIFS Single",
        "region": "Global",
        "override_res": 25.0,
        "override_max_hours": 360,
    },
    {
        "id": "gfs_seamless",
        "name": "GFS Seamless",
        "provider": "NOAA",
        "doc_match": "GFS",
        "region": "Global",
    },
    {
        "id": "gfs_global",
        "name": "GFS Global",
        "provider": "NOAA",
        "doc_match": "GFS Pressure Variables",
        "region": "Global",
        "override_res": 25.0,
    },
    {
        "id": "gfs_hrrr",
        "name": "HRRR",
        "provider": "NOAA",
        "doc_match": "HRRR Conus",
        "region": "North America",
        "override_max_hours": 48,
    },
    {
        "id": "gfs_graphcast025",
        "name": "GraphCast 0.25°",
        "provider": "NOAA",
        "doc_match": "AIGFS 0.25°",
        "region": "Global",
        "override_res": 25.0,
        "override_max_hours": 240,
    },
    {
        "id": "meteofrance_seamless",
        "name": "Météo-France Seamless",
        "provider": "Météo-France",
        "doc_match": "ARPEGE World",
        "region": "Global / France",
        "override_res": 1.3,
        "override_max_hours": 114,
    },
    {
        "id": "meteofrance_arpege_world",
        "name": "ARPEGE World",
        "provider": "Météo-France",
        "doc_match": "ARPEGE World",
        "region": "Global",
        "override_max_hours": 114,
    },
    {
        "id": "meteofrance_arpege_europe",
        "name": "ARPEGE Europe",
        "provider": "Météo-France",
        "doc_match": "ARPEGE Europe",
        "region": "Europe",
        "override_res": 7.5,
        "override_max_hours": 114,
    },
    {
        "id": "meteofrance_arome_france",
        "name": "AROME France",
        "provider": "Météo-France",
        "doc_match": "AROME France",
        "region": "France",
        "override_res": 1.3,
        "override_max_hours": 42,
    },
    {
        "id": "meteofrance_arome_hd",
        "name": "AROME France HD",
        "provider": "Météo-France",
        "doc_match": "AROME France HD",
        "region": "France",
        "override_res": 1.5,
        "override_max_hours": 42,
    },
    {
        "id": "jma_seamless",
        "name": "JMA Seamless",
        "provider": "JMA",
        "doc_match": "GSM",
        "region": "Global / Japan",
        "override_res": 5.0,
    },
    {
        "id": "jma_msm",
        "name": "JMA MSM",
        "provider": "JMA",
        "doc_match": "MSM",
        "region": "Japan",
        "override_max_hours": 78,
    },
    {
        "id": "jma_gsm",
        "name": "JMA GSM",
        "provider": "JMA",
        "doc_match": "GSM",
        "region": "Global",
        "override_res": 20.0,
    },
    {
        "id": "gem_seamless",
        "name": "GEM Seamless",
        "provider": "GEM",
        "doc_match": "GEM Global",
        "region": "Global / North America",
        "override_res": 2.5,
    },
    {
        "id": "gem_global",
        "name": "GEM Global",
        "provider": "GEM",
        "doc_match": "GEM Global",
        "region": "Global",
    },
    {
        "id": "gem_regional",
        "name": "GEM Regional",
        "provider": "GEM",
        "doc_match": "GEM RDPS Regional",
        "region": "North America",
    },
    {
        "id": "gem_hrdps",
        "name": "GEM HRDPS",
        "provider": "GEM",
        "doc_match": "GEM HRDPS Continental",
        "region": "Canada",
    },
    {
        "id": "bom_access_global",
        "name": "ACCESS-G",
        "provider": "BOM",
        "doc_match": "ACCESS-G",
        "region": "Global",
        "override_res": 12.0,
    },
    {
        "id": "ukmo_seamless",
        "name": "UKMO Seamless",
        "provider": "UK Met Office",
        "doc_match": "UKMO Global",
        "region": "Global / UK",
        "override_res": 2.0,
    },
    {
        "id": "ukmo_global_qpe1km",
        "name": "UKMO Global",
        "provider": "UK Met Office",
        "doc_match": "UKMO Global",
        "region": "Global",
        "override_max_hours": 144,
    },
    {
        "id": "ukmo_uk_deterministic_2km",
        "name": "UKMO UK 2km",
        "provider": "UK Met Office",
        "doc_match": "UKMO UKV",
        "region": "United Kingdom",
        "override_max_hours": 120,
    },
    {
        "id": "cma_grapes_global",
        "name": "CMA GRAPES Global",
        "provider": "CMA",
        "doc_match": "GFS GRAPES",
        "region": "Global",
    },
    {
        "id": "knmi_seamless",
        "name": "KNMI Harmonie Seamless",
        "provider": "KNMI",
        "doc_match": "KNMI HARMONIE AROME Netherlands",
        "region": "Europe / Netherlands",
        "override_max_hours": 48,
    },
    {
        "id": "knmi_harmonie_arome_europe",
        "name": "KNMI Harmonie Europe",
        "provider": "KNMI",
        "doc_match": "KNMI HARMONIE AROME Europe",
        "region": "Europe",
        "override_res": 2.5,
        "override_max_hours": 48,
    },
    {
        "id": "knmi_harmonie_arome_netherlands",
        "name": "KNMI Harmonie Netherlands",
        "provider": "KNMI",
        "doc_match": "KNMI HARMONIE AROME Netherlands",
        "region": "Netherlands",
        "override_res": 2.5,
        "override_max_hours": 48,
    },
    {
        "id": "dmi_seamless",
        "name": "DMI Harmonie Seamless",
        "provider": "DMI",
        "doc_match": "DMI HARMONIE AROME DINI",
        "region": "Europe",
        "override_res": 3.0,
        "override_max_hours": 54,
    },
    {
        "id": "dmi_harmonie_arome_europe",
        "name": "DMI Harmonie Europe",
        "provider": "DMI",
        "doc_match": "DMI HARMONIE AROME DINI",
        "region": "Europe",
        "override_res": 3.0,
        "override_max_hours": 54,
    },
    {
        "id": "metno_nordic",
        "name": "MET Norway Nordic",
        "provider": "MET Norway",
        "doc_match": "MET Nordic",
        "region": "Scandinavia / Nordic",
        "override_res": 2.5,
    },
    {
        "id": "meteoswiss_icon_ch1",
        "name": "MeteoSwiss ICON-CH1",
        "provider": "MeteoSwiss",
        "doc_match": "ICON CH1",
        "region": "Switzerland / Alps",
        "override_res": 1.1,
        "override_max_hours": 33,
    },
    {
        "id": "meteoswiss_icon_ch2",
        "name": "MeteoSwiss ICON-CH2",
        "provider": "MeteoSwiss",
        "doc_match": "ICON CH2",
        "region": "Switzerland / Alps",
        "override_res": 2.1,
        "override_max_hours": 120,
    },
]


def parse_hours(text: str) -> Optional[int]:
    text = text.lower()
    if "day" in text:
        m = re.search(r"([\d\.]+)\s*day", text)
        if m:
            return int(float(m.group(1)) * 24)
    if "hour" in text:
        m = re.search(r"([\d\.]+)\s*hour", text)
        if m:
            return int(float(m.group(1)))
    return None


def parse_resolution(text: str) -> Optional[float]:
    m = re.search(r"~\s*([\d\.]+)\s*km", text)
    if m:
        return float(m.group(1))
    m = re.search(r"([\d\.]+)\s*km", text)
    if m:
        return float(m.group(1))
    m = re.search(r"([\d\.]+)\s*°", text)
    if m:
        deg = float(m.group(1))
        return round(deg * 100, 1) if deg >= 0.1 else round(deg * 111, 1)
    return None


def fetch_provider_doc_tables() -> Dict[str, List[Dict[str, str]]]:
    doc_tables: Dict[str, List[Dict[str, str]]] = {}
    for provider, url in PROVIDER_URLS.items():
        logger.info(f"Fetching provider documentation from {url}...")
        req = urllib.request.Request(
            url, headers={"User-Agent": "GraupelCatalogueBuilder/1.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8")
                tables = re.findall(
                    r"<table[^>]*>(.*?)</table>", html, re.DOTALL
                )
                if tables:
                    rows = re.findall(
                        r"<tr[^>]*>(.*?)</tr>", tables[0], re.DOTALL
                    )
                    headers = []
                    parsed_rows = []
                    for r in rows:
                        cols = [
                            re.sub(r"<[^>]+>", "", c).strip()
                            for c in re.findall(
                                r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.DOTALL
                            )
                        ]
                        if not headers:
                            headers = [h.lower() for h in cols]
                            continue
                        if cols:
                            row_dict = dict(zip(headers, cols))
                            parsed_rows.append(row_dict)
                    doc_tables[provider] = parsed_rows
        except Exception as e:
            logger.error(f"Failed to fetch doc for {provider} ({url}): {e}")
            raise RuntimeError(
                f"Could not download upstream metadata for {provider}: {e}"
            ) from e
    return doc_tables


def generate_catalogue() -> List[Dict[str, Any]]:
    doc_tables = fetch_provider_doc_tables()
    catalogue = []
    # Documentation tables describe surface defaults; preserve separately probed
    # optional capabilities rather than advertising LPI for every model.
    existing_capabilities = {}
    existing_catalogue = Path(__file__).resolve().parent.parent / "models" / "model_catalogue.json"
    if existing_catalogue.is_file():
        with existing_catalogue.open("r", encoding="utf-8") as source:
            existing_capabilities = {
                m["id"]: [v for v in m.get("supported_variables", [])
                          if v in ("cape", "convective_inhibition", "lightning_potential")]
                for m in json.load(source)
            }

    for defn in MODEL_DEFINITIONS:
        cid = defn["id"]
        cname = defn["name"]
        provider = defn["provider"]
        doc_match = defn["doc_match"]
        region = defn["region"]

        rows = doc_tables.get(provider, [])
        matched_row = None
        for r in rows:
            model_cell = r.get("weather model", "")
            if doc_match.lower() in model_cell.lower():
                matched_row = r
                break

        if not matched_row and rows:
            matched_row = rows[0]

        parsed_hours = (
            parse_hours(matched_row.get("forecast length", ""))
            if matched_row
            else None
        )
        parsed_res = (
            parse_resolution(matched_row.get("spatial resolution", ""))
            if matched_row
            else None
        )

        final_hours = defn.get("override_max_hours") or parsed_hours or 48
        final_res = defn.get("override_res") or parsed_res or 10.0

        MODEL_PRESSURE_LEVELS: Dict[str, List[int]] = {
            "icon": [
                1000,
                975,
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
                70,
                50,
                30,
            ],
            "ecmwf_open": [
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
            "meteofrance": [
                1000,
                950,
                925,
                900,
                850,
                800,
                750,
                700,
                650,
                600,
                550,
                500,
                450,
                400,
                350,
                300,
                275,
                250,
                225,
                200,
                175,
                150,
                125,
                100,
                70,
                50,
                30,
                20,
                10,
            ],
            "gfs": [
                1000,
                975,
                950,
                925,
                900,
                875,
                850,
                825,
                800,
                775,
                750,
                725,
                700,
                675,
                650,
                625,
                600,
                575,
                550,
                525,
                500,
                475,
                450,
                425,
                400,
                375,
                350,
                325,
                300,
                275,
                250,
                225,
                200,
                175,
                150,
                125,
                100,
                70,
                50,
                40,
                30,
                20,
                15,
                10,
            ],
            "chmi": [
                1000,
                950,
                925,
                850,
                800,
                700,
                600,
                500,
                450,
                400,
                350,
                300,
                275,
                250,
                200,
                150,
                100,
            ],
            "italia_icon2i": [1000, 925, 850, 700, 500, 250],
            "jma": [
                1000,
                975,
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
            ],
            "gem": [
                1000,
                950,
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
            ],
            "ukmo": [
                1000,
                950,
                925,
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
            ],
            "grapes": [
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
            ],
            "standard": [
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
            ],
        }

        # Models explicitly known to lack pressure level datasets in Open-Meteo
        no_vcloud_models = {
            "ecmwf_ifs",  # IFS HRES 9km
            "meteofrance_arome_france_hd",  # AROME HD 1.5km
            "meteoswiss_icon_ch1",
            "meteoswiss_icon_ch2",
            "meteoswiss_icon_seamless",
            "geosphere_seamless",
            "geosphere_arome_austria",
            "chmi_aladin_cz",
        }

        pressure_levels: List[int] = []
        if cid in no_vcloud_models:
            supports_vcloud = False
            pressure_levels = []
        elif cid in ("icon_seamless", "icon_d2", "icon_eu", "icon_global"):
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["icon"]
        elif cid in ("ecmwf_ifs025", "ecmwf_aifs025_single"):
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["ecmwf_open"]
        elif cid in (
            "meteofrance_arome_france",
            "meteofrance_arpege_europe",
            "meteofrance_arpege_world",
            "meteofrance_seamless",
        ):
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["meteofrance"]
        elif "gfs" in cid or "hrrr" in cid:
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["gfs"]
        elif cid == "italia_meteo_arpae_icon_2i":
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["italia_icon2i"]
        elif cid in ("jma_seamless", "jma_gsm", "jma_msm"):
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["jma"]
        elif "gem" in cid:
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["gem"]
        elif "ukmo" in cid:
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["ukmo"]
        elif "grapes" in cid:
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["grapes"]
        elif cid == "best_match":
            supports_vcloud = True
            pressure_levels = MODEL_PRESSURE_LEVELS["standard"]
        else:
            supports_vcloud = False
            pressure_levels = []

        model_entry = {
            "id": cid,
            "name": cname,
            "provider": provider,
            "region": region,
            "spatial_resolution_km": final_res,
            "temporal_resolution_hours": 1,
            "max_forecast_hours": final_hours,
            "supported_variables": list(STANDARD_VARIABLES),
            "active": True,
            "supports_vertical_cloud_profile": supports_vcloud,
            "supports_pressure_level_cloud_cover": supports_vcloud,
            "supports_geopotential_height": supports_vcloud,
            "pressure_levels_hpa": pressure_levels,
        }

        # Exclude precipitation probability for models known not to produce ensemble probability
        if cid in (
            "meteofrance_arpege_world",
            "meteofrance_arpege_europe",
            "meteofrance_arome_france",
            "meteofrance_arome_hd",
        ):
            model_entry["supported_variables"] = [
                v
                for v in STANDARD_VARIABLES
                if v != "precipitation_probability"
            ]

        model_entry["supported_variables"].extend(existing_capabilities.get(cid, []))
        catalogue.append(model_entry)
        logger.info(
            f"Validated model {cid:30s} | Provider: {provider:15s} | Res: {final_res:4.1f}km | Horizon: {final_hours:3d}h"
        )

    return catalogue


def main():
    logger.info("Starting catalogue rebuild from upstream sources...")
    catalogue = generate_catalogue()

    models_dir = Path(__file__).resolve().parents[1] / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    out_file1 = models_dir / "model_catalogue.json"
    out_file2 = models_dir / "model_catalog.json"

    with open(out_file1, "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)
        f.write("\n")
    logger.info(f"Saved {len(catalogue)} models to {out_file1}")

    # Also update the compatibility catalogue shipped with the package.
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

    with open(out_file2, "w", encoding="utf-8") as f:
        json.dump(compat_list, f, indent=2)
        f.write("\n")
    logger.info(f"Saved compat catalogue to {out_file2}")


if __name__ == "__main__":
    main()
