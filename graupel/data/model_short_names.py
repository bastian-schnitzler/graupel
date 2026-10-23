"""Curated nicknames (`short_name`) for the orange model header (system.md §16.7).

The catalogue generator `dev-tools/update_catalog.py` copies these into the
catalogue. Only models
whose name is longer than 10 characters get a nickname; "SL" = Seamless.
"""

from typing import Dict, Optional

MODEL_SHORT_NAMES: Dict[str, str] = {
    "cma_grapes_global": "GRAPES",
    "dmi_seamless": "DMI SL",
    "dmi_harmonie_arome_europe": "DMI HARM",
    "icon_seamless": "ICON SL",
    "icon_global": "ICON",
    "ecmwf_ifs": "IFS HRES",
    "ecmwf_ifs025": "IFS",
    "ecmwf_aifs025_single": "AIFS",
    "cmc_gem_seamless": "GEM SL",
    "cmc_gem_rdps": "RDPS",
    "cmc_gem_hrdps": "HRDPS",
    "cmc_gem_hrdps_west": "HRDPS W",
    "geosphere_seamless": "GeoS SL",
    "geosphere_arome_austria": "AROME AT",
    "italia_meteo_arpae_icon_2i": "ICON-2I",
    "jma_seamless": "JMA SL",
    "kma_seamless": "KMA SL",
    "kma_ldps": "KMA LDPS",
    "kma_gdps": "KMA GDPS",
    "knmi_seamless": "KNMI SL",
    "knmi_harmonie_arome_europe": "KNMI HARM",
    "knmi_harmonie_arome_netherlands": "KNMI HARM NL",
    "metno_seamless": "MetNo SL",
    "metno_nordic": "MetNo",
    "meteoswiss_icon_seamless": "ICON-CH SL",
    "meteoswiss_icon_ch1": "ICON-CH1",
    "meteoswiss_icon_ch2": "ICON-CH2",
    "meteofrance_seamless": "MF SL",
    "meteofrance_arpege_world": "ARPEGE",
    "meteofrance_arpege_europe": "ARPEGE EU",
    "meteofrance_arome_france": "AROME FR",
    "meteofrance_arome_france_hd": "AROME HD",
    "ncep_gfs_seamless": "GFS SL",
    "ncep_gfs_global": "GFS",
    "ncep_gfs_graphcast025": "GraphCast",
    "ncep_aigfs025": "AIGFS",
    "ncep_hgefs025_ensemble_mean": "HGEFS Mean",
    "ukmo_seamless": "UKMO SL",
    "ukmo_global_deterministic_10km": "UKMO 10km",
    "ukmo_uk_deterministic_2km": "UKMO UK",
}


def short_name_for(model_id: Optional[str]) -> Optional[str]:
    """Nickname of a catalogue model id, None when the full name is used."""
    return MODEL_SHORT_NAMES.get(model_id or "")
