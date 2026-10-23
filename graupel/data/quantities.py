"""Quantity registry (system.md §5): the single source for fetch, storage and drawing.

Every forecast variable the app knows is defined here once. Open-Meteo
request names, harmonizer aliases, target units, warning rules and the
display set of a layout and the fetch set are all derived from this registry. The
frontend gets the same data through the `get_quantity_registry` bridge call
and keeps a generated fallback copy (`react/src/quantities/quantityRegistry.generated.ts`,
written by `dev-tools/export_quantity_registry.py`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional

# Where a quantity's values come from.
SOURCE_HOURLY = "hourly"  # one Open-Meteo `hourly` surface variable
SOURCE_PRESSURE_LEVEL = "pressure_level"  # one variable per pressure level
SOURCE_COMPOSITE = "composite"  # built from other quantities (`requires`)
# Computed in the frontend from its `requires` when the meteogram is drawn
# (system.md §5.1): never fetched, never archived.
SOURCE_DERIVED = "derived"

KINDS = ("point", "interval")
STYLES = ("line", "bars", "area", "arrows", "icons", "profile", "tooltip")

# Series options whose value names another quantity the series draws from.
SERIES_REFERENCE_KEYS = ("snowFrom",)


@dataclass(frozen=True)
class Quantity:
    id: str
    label: str
    unit: str
    # point: value at its timestamp; interval: start-stamped [t, t + 1h).
    kind: str
    source: str
    # Open-Meteo name; pressure-level names contain `{level}`.
    api_name: Optional[str] = None
    aliases: tuple = ()
    # Missing or incomplete for a model -> no warning, and it does not count
    # towards the model's delivered hours.
    optional: bool = False
    # The model catalogue probes it into `supported_variables`. Optional
    # catalogued quantities are only requested from models that list them.
    catalogued: bool = False
    # Used by the backend but not drawn. Every downloadable quantity is
    # fetched anyway (fetch set, system.md §9.3); the flag only documents this.
    always_fetch: bool = False
    # Keep the API unit (False: always report `unit`).
    unit_from_api: bool = True
    # Some model endpoints reject it: retry the request without it.
    retry_without: bool = False
    # Comes from the model's ensemble, not its main run. Ensembles run on
    # their own schedule and reach a different end, so such a quantity never
    # defines the model's delivered hours (boundary cap); missing values
    # still warn unless `optional`.
    ensemble: bool = False
    allowed_styles: tuple = ()
    requires: tuple = ()
    # Part of the fetch set and archived. False: derived or pressure-level
    # parts that come in through a composite quantity.
    downloadable: bool = True
    color: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["aliases"] = list(self.aliases)
        data["allowed_styles"] = list(self.allowed_styles)
        data["requires"] = list(self.requires)
        return data


_REGISTRY: tuple = (
    Quantity(
        id="temperature",
        label="Temperature",
        unit="°C",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="temperature_2m",
        aliases=("temp_2m", "temp", "t2m"),
        catalogued=True,
        allowed_styles=("line", "tooltip"),
        color="#dc2626",
    ),
    Quantity(
        id="apparent_temperature",
        label="Feels like",
        unit="°C",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="apparent_temperature",
        aliases=("apparent_temp", "feels_like"),
        catalogued=True,
        allowed_styles=("line", "tooltip"),
        color="#92400e",
    ),
    Quantity(
        id="wind_speed",
        label="Wind speed",
        unit="km/h",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="wind_speed_10m",
        aliases=("windspeed_10m",),
        catalogued=True,
        allowed_styles=("line", "tooltip"),
        color="#2563eb",
    ),
    Quantity(
        id="wind_gusts",
        label="Gusts",
        unit="km/h",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="wind_gusts_10m",
        aliases=("windgusts_10m",),
        catalogued=True,
        allowed_styles=("line", "tooltip"),
        color="#2563eb",
    ),
    Quantity(
        id="wind_direction",
        label="Direction",
        unit="°",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="wind_direction_10m",
        aliases=("winddirection_10m",),
        catalogued=True,
        allowed_styles=("arrows", "tooltip"),
        color="#334155",
    ),
    Quantity(
        id="cloud_cover",
        label="Cloud cover",
        unit="%",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="cloud_cover",
        aliases=("cloudcover",),
        catalogued=True,
        always_fetch=True,
        allowed_styles=("line", "area", "tooltip"),
        color="#64748b",
    ),
    Quantity(
        id="precipitation",
        label="Precip",
        unit="mm",
        kind="interval",
        source=SOURCE_HOURLY,
        api_name="precipitation",
        aliases=("precip",),
        catalogued=True,
        allowed_styles=("bars", "tooltip"),
        color="#3b82f6",
    ),
    Quantity(
        id="precipitation_probability",
        label="Precip. Prob.",
        unit="%",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="precipitation_probability",
        aliases=("precip_prob", "pop"),
        catalogued=True,
        ensemble=True,
        allowed_styles=("line", "tooltip"),
        color="#7c3aed",
    ),
    Quantity(
        id="snowfall",
        label="Snowfall",
        unit="cm",
        kind="interval",
        source=SOURCE_HOURLY,
        api_name="snowfall",
        optional=True,
        retry_without=True,
        allowed_styles=("bars", "tooltip"),
        color="#ffffff",
    ),
    Quantity(
        id="precipitation_rain_snow",
        label="Precip (rain/snow)",
        unit="mm",
        kind="interval",
        source=SOURCE_DERIVED,
        allowed_styles=("bars",),
        requires=("precipitation", "snowfall"),
        downloadable=False,
        color="#2563eb",
    ),
    Quantity(
        id="snowfall_with_rain",
        label="Snowfall with rain",
        unit="cm",
        kind="interval",
        source=SOURCE_DERIVED,
        allowed_styles=("bars",),
        requires=("precipitation", "snowfall"),
        downloadable=False,
        color="#ffffff",
    ),
    Quantity(
        id="snow_depth",
        label="Snow depth",
        unit="m",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="snow_depth",
        optional=True,
        retry_without=True,
        allowed_styles=("line", "area", "tooltip"),
        color="#0ea5e9",
    ),
    Quantity(
        id="cape",
        label="CAPE",
        unit="J/kg",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="cape",
        optional=True,
        catalogued=True,
        unit_from_api=False,
        allowed_styles=("area", "tooltip"),
        color="#ea580c",
    ),
    Quantity(
        id="convective_inhibition",
        label="CIN",
        unit="J/kg",
        kind="point",
        source=SOURCE_HOURLY,
        api_name="convective_inhibition",
        aliases=("cin",),
        optional=True,
        catalogued=True,
        unit_from_api=False,
        allowed_styles=("area", "tooltip"),
        color="#0891b2",
    ),
    Quantity(
        id="lightning_potential",
        label="LPI",
        unit="J/kg",
        kind="interval",
        source=SOURCE_HOURLY,
        api_name="lightning_potential",
        aliases=("lpi",),
        optional=True,
        catalogued=True,
        unit_from_api=False,
        allowed_styles=("line", "tooltip"),
        color="#ca8a04",
    ),
    Quantity(
        id="weather_code",
        label="Weather code",
        unit="wmo code",
        kind="interval",
        source=SOURCE_HOURLY,
        api_name="weather_code",
        optional=True,
        allowed_styles=("icons",),
    ),
    Quantity(
        id="cloud_cover_pressure_level",
        label="Cloud cover (pressure level)",
        unit="%",
        kind="interval",
        source=SOURCE_PRESSURE_LEVEL,
        api_name="cloud_cover_{level}hPa",
        downloadable=False,
    ),
    Quantity(
        id="geopotential_height_pressure_level",
        label="Geopotential height (pressure level)",
        unit="m",
        kind="point",
        source=SOURCE_PRESSURE_LEVEL,
        api_name="geopotential_height_{level}hPa",
        downloadable=False,
    ),
    Quantity(
        id="vertical_cloud_profile",
        label="Cloud profile",
        unit="%",
        kind="interval",
        source=SOURCE_COMPOSITE,
        allowed_styles=("profile",),
        requires=(
            "cloud_cover_pressure_level",
            "geopotential_height_pressure_level",
        ),
    ),
)

QUANTITIES: Dict[str, Quantity] = {q.id: q for q in _REGISTRY}


def get_quantity(quantity_id: str) -> Quantity:
    try:
        return QUANTITIES[quantity_id]
    except KeyError:
        raise ValueError(f"unknown quantity: {quantity_id}") from None


def all_quantities() -> List[Quantity]:
    return list(_REGISTRY)


def ordered(quantity_ids: Iterable[str]) -> List[str]:
    """Known ids in registry order, without duplicates."""
    wanted = set(quantity_ids)
    return [q.id for q in _REGISTRY if q.id in wanted]


def hourly_quantities() -> List[str]:
    return [q.id for q in _REGISTRY if q.source == SOURCE_HOURLY]


def optional_quantities() -> List[str]:
    return [q.id for q in _REGISTRY if q.optional]


def ensemble_quantities() -> List[str]:
    return [q.id for q in _REGISTRY if q.ensemble]


def main_run_excluded_quantities() -> List[str]:
    """Quantities that never define a model's delivered hours."""
    return [q.id for q in _REGISTRY if q.optional or q.ensemble]


def catalogued_quantities() -> List[str]:
    return [q.id for q in _REGISTRY if q.catalogued]


def expected_quantities() -> List[str]:
    """Hourly quantities a model is warned about when it lacks them."""
    return [
        q.id for q in _REGISTRY if q.source == SOURCE_HOURLY and not q.optional
    ]


def variable_aliases() -> Dict[str, str]:
    """Lower-case id, Open-Meteo name and alias -> quantity id."""
    mapping: Dict[str, str] = {}
    for q in _REGISTRY:
        names = [q.id, *q.aliases]
        if q.api_name and "{" not in q.api_name:
            names.append(q.api_name)
        for name in names:
            mapping[name.lower()] = q.id
    return mapping


def open_meteo_names() -> Dict[str, str]:
    """Id, Open-Meteo name and alias -> Open-Meteo hourly name."""
    mapping: Dict[str, str] = {}
    for q in _REGISTRY:
        if q.source != SOURCE_HOURLY or not q.api_name:
            continue
        for name in (q.id, q.api_name, *q.aliases):
            mapping[name] = q.api_name
    return mapping


def target_units() -> Dict[str, str]:
    return {q.id: q.unit for q in _REGISTRY if q.source == SOURCE_HOURLY}


def expand_requires(quantity_ids: Iterable[str]) -> List[str]:
    """The given quantities plus everything they require, transitively."""
    seen: set = set()
    stack = list(quantity_ids)
    while stack:
        quantity = get_quantity(stack.pop())
        if quantity.id in seen:
            continue
        seen.add(quantity.id)
        stack.extend(quantity.requires)
    return ordered(seen)


def _enabled(entry: Mapping[str, Any]) -> bool:
    return entry.get("enabled", True) is not False


def display_set(layout: Mapping[str, Any]) -> List[str]:
    """Quantities a layout draws: series and backgrounds plus `requires`.

    Disabled areas, series and backgrounds are skipped. Unknown quantities
    raise ValueError.
    """
    direct: List[str] = []
    for area in layout.get("areas", []):
        if not _enabled(area):
            continue
        background = area.get("background")
        if background and _enabled(background):
            direct.append(background["kind"])
        for series in area.get("series", []):
            if not _enabled(series):
                continue
            direct.append(series["quantity"])
            direct.extend(
                series[key] for key in SERIES_REFERENCE_KEYS if series.get(key)
            )
    return expand_requires(direct)


def fetch_set() -> List[str]:
    """Quantities to download: every registered downloadable quantity (§9.3).

    The same set is fetched in both modes, independent of the layout, so a
    layout change never needs new data. Derived quantities are left out;
    their sources are registered quantities themselves. Model-gated optional
    quantities are filtered per model by `requested_from_model`.
    """
    ids = [q.id for q in _REGISTRY if q.downloadable]
    return [
        quantity_id
        for quantity_id in expand_requires(ids)
        if QUANTITIES[quantity_id].source != SOURCE_DERIVED
    ]


def requested_from_model(
    quantity_id: str, supported_variables: Optional[Iterable[str]]
) -> bool:
    """Whether to ask a model for a quantity (system.md §5, last rule).

    Optional catalogued quantities are only requested when the model lists
    them in `supported_variables`; `None` (model not in the catalogue)
    leaves them out as well. Everything else, including names the registry
    does not know, is requested.
    """
    quantity = QUANTITIES.get(quantity_id)
    if quantity is None or not (quantity.optional and quantity.catalogued):
        return True
    return quantity_id in set(supported_variables or ())


def export_registry() -> List[Dict[str, Any]]:
    """Registry as JSON-serializable dicts for the frontend."""
    return [q.to_dict() for q in _REGISTRY]


FRONTEND_REGISTRY_PATH = "react/src/quantities/quantityRegistry.generated.ts"


def render_frontend_registry() -> str:
    """TypeScript fallback copy of the registry (offline runs and tests)."""
    import json

    body = json.dumps(export_registry(), indent=2, ensure_ascii=False)
    return (
        "// Generated by dev-tools/export_quantity_registry.py from\n"
        "// graupel/data/quantities.py. Do not edit by hand.\n"
        'import type { QuantityDefinition } from "./types";\n'
        "\n"
        f"export const BUILTIN_QUANTITY_REGISTRY: QuantityDefinition[] = {body};\n"
    )
