"""Meteogram layouts (system.md §4): schema, validation and built-in layouts.

A layout is an ordered list of drawing areas plus chart-wide options. Each
area gets `heightWeight / Σ heightWeight` of the plot height and draws its
series on shared axes. The frontend mirrors the schema in
`react/src/layouts/types.ts` and keeps a generated copy of the built-in
layouts (`react/src/layouts/builtinLayouts.generated.ts`, written by
`dev-tools/export_quantity_registry.py`).

Built-in layouts list only what differs from the defaults: per-quantity
colors, stroke widths and label positions of today's chart live in the
frontend presets (`react/src/layouts/seriesPresets.ts`).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Mapping, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from .quantities import QUANTITIES

AxisSide = Literal["left", "right"]


class _Strict(BaseModel):
    # Typos in a stored or edited layout must not be silently ignored.
    model_config = ConfigDict(extra="forbid")


class LayoutAxis(_Strict):
    # Quantity whose unit and label format the axis uses.
    quantity: Optional[str] = None
    # Unit text after the axis values ("°", "mm", "km/h").
    label: Optional[str] = None
    # auto: global min/max over all models (stable while dragging boundaries);
    # zero-based: 0..global max; fixed: min..max.
    range: Literal["auto", "fixed", "zero-based"] = "auto"
    min: Optional[float] = None
    max: Optional[float] = None
    # Reference line at value 0 when it lies inside the range (0 °C line).
    zeroLine: bool = False
    # Min/max value labels at the axis side.
    showLabels: bool = True

    @model_validator(mode="after")
    def _fixed_needs_bounds(self) -> "LayoutAxis":
        if self.range == "fixed":
            if self.min is None or self.max is None:
                raise ValueError("fixed axis range needs min and max")
            if self.min >= self.max:
                raise ValueError("fixed axis range needs min < max")
        return self


class LayoutAxes(_Strict):
    left: Optional[LayoutAxis] = None
    right: Optional[LayoutAxis] = None


class LayoutSeries(_Strict):
    quantity: str
    style: str
    enabled: bool = True
    # Overrides the quantity's chart color.
    color: Optional[str] = None
    # hidden: own scale without labels (precipitation probability 0–100 %).
    axis: Literal["left", "right", "hidden"] = "left"
    strokeWidth: Optional[float] = Field(default=None, gt=0)
    dashed: Optional[bool] = None
    # `|` where a curve stops before the end of its model slice.
    curveStops: bool = True
    # Daily min/max labels (line).
    extremeLabels: bool = False
    # Bars drawn white with an outline when this quantity is positive.
    snowFrom: Optional[str] = None
    # Draw into the upper (positive) or lower (negative) half around a
    # shared zero line (CAPE / CIN).
    half: Optional[Literal["upper", "lower"]] = None
    # Icon footprint in screen pixels (arrows, icons): sets icon density.
    iconFootprintPx: Optional[float] = Field(default=None, gt=0)


class LayoutBackground(_Strict):
    kind: Literal["vertical_cloud_profile"]
    enabled: bool = True
    # Extra height weight of the area while the background has data.
    heightWeight: float = Field(default=0.0, ge=0)
    maxAltitudeKm: float = Field(default=12.0, gt=0)
    altitudeLabels: bool = True
    terrainMask: bool = True


class LayoutArea(_Strict):
    id: str = Field(min_length=1)
    enabled: bool = True
    heightWeight: float = Field(default=1.0, gt=0)
    # Sunrise / sunset times on the first and last complete day (#171).
    sunTimes: bool = False
    axes: LayoutAxes = Field(default_factory=LayoutAxes)
    background: Optional[LayoutBackground] = None
    series: List[LayoutSeries] = Field(default_factory=list)


class MeteogramLayout(_Strict):
    id: str = Field(min_length=1)
    name: str
    version: int = 1
    # Orange model headers and dashed model boundaries.
    showModelHeaders: bool = True
    showDayHeader: bool = True
    showDaylight: bool = True
    showLocationLabel: Literal["top", "bottom", "none"] = "bottom"
    showCreatedTimestamp: bool = True
    areas: List[LayoutArea] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_content(self) -> "MeteogramLayout":
        enabled = [area for area in self.areas if area.enabled]
        if not enabled:
            raise ValueError("layout needs at least one enabled area")
        ids = [area.id for area in self.areas]
        if len(set(ids)) != len(ids):
            raise ValueError("area ids must be unique")
        for area in self.areas:
            for series in area.series:
                _check_series(area.id, series)
            if area.background is not None:
                _check_style(area.id, area.background.kind, "profile")
        return self


def _check_style(area_id: str, quantity_id: str, style: str) -> None:
    quantity = QUANTITIES.get(quantity_id)
    if quantity is None:
        raise ValueError(f"area {area_id}: unknown quantity: {quantity_id}")
    if style not in quantity.allowed_styles:
        raise ValueError(
            f"area {area_id}: style {style!r} not allowed for {quantity_id}"
        )


def _check_series(area_id: str, series: LayoutSeries) -> None:
    _check_style(area_id, series.quantity, series.style)
    if series.snowFrom is not None and series.snowFrom not in QUANTITIES:
        raise ValueError(
            f"area {area_id}: unknown quantity: {series.snowFrom}"
        )


def validate_layout(layout: Mapping[str, Any]) -> Dict[str, Any]:
    """Validated layout as plain dict (defaults filled in).

    Raises ValueError with a readable message for an invalid layout.
    """
    try:
        model = MeteogramLayout.model_validate(layout)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first.get("loc", ()))
        message = str(first.get("msg", "invalid layout"))
        message = message.removeprefix("Value error, ")
        raise ValueError(
            f"invalid layout{f' at {where}' if where else ''}: {message}"
        ) from None
    return model.model_dump()


# Today's chart (power mode default). Heights: 100 viewBox units per weight.
POWER_DEFAULT_LAYOUT: Dict[str, Any] = {
    "id": "power-default",
    "name": "Power default",
    "version": 1,
    "showModelHeaders": True,
    "showDayHeader": True,
    "showDaylight": True,
    "showLocationLabel": "bottom",
    "showCreatedTimestamp": True,
    "areas": [
        {
            "id": "temp",
            "heightWeight": 1.15,
            "sunTimes": True,
            "axes": {
                "left": {
                    "quantity": "temperature",
                    "label": "°",
                    "range": "auto",
                    "zeroLine": True,
                },
            },
            "series": [
                {"quantity": "apparent_temperature", "style": "line"},
                {
                    "quantity": "temperature",
                    "style": "line",
                    "extremeLabels": True,
                },
            ],
        },
        {
            "id": "precip",
            "heightWeight": 0.95,
            "axes": {
                "left": {
                    "quantity": "precipitation",
                    "label": "mm",
                    "range": "zero-based",
                },
            },
            "background": {
                "kind": "vertical_cloud_profile",
                "enabled": True,
                "heightWeight": 0.3,
            },
            "series": [
                {"quantity": "precipitation_rain_snow", "style": "bars"},
                {
                    "quantity": "precipitation_probability",
                    "style": "line",
                    "axis": "hidden",
                },
                {"quantity": "snow_depth", "style": "tooltip"},
                {"quantity": "weather_code", "style": "icons"},
            ],
        },
        {
            "id": "wind",
            "heightWeight": 1.05,
            "axes": {
                "left": {
                    "quantity": "wind_speed",
                    "label": "km/h",
                    "range": "zero-based",
                },
            },
            "series": [
                {"quantity": "wind_gusts", "style": "line"},
                {"quantity": "wind_speed", "style": "line"},
                {"quantity": "wind_direction", "style": "arrows"},
            ],
        },
        {
            "id": "convective",
            "heightWeight": 1.3,
            "axes": {
                "left": {
                    "quantity": "cape",
                    "label": "J/kg",
                    "range": "zero-based",
                },
                "right": {
                    "quantity": "lightning_potential",
                    "label": "J/kg",
                    "range": "fixed",
                    "min": 0,
                    "max": 30,
                },
            },
            "series": [
                {"quantity": "cape", "style": "area", "half": "upper"},
                {
                    "quantity": "convective_inhibition",
                    "style": "area",
                    "half": "lower",
                },
                {
                    "quantity": "lightning_potential",
                    "style": "line",
                    "axis": "right",
                    "half": "upper",
                },
            ],
        },
    ],
}

# Normal mode, built-in and read-only (system.md §4.4): no model headers, no cloud
# profile, no CAPE/CIN.
NORMAL_LAYOUT: Dict[str, Any] = {
    "id": "normal-default",
    "name": "Standard",
    "version": 1,
    "showModelHeaders": False,
    "showDayHeader": True,
    "showDaylight": True,
    "showLocationLabel": "bottom",
    "showCreatedTimestamp": True,
    "areas": [
        {
            "id": "temp",
            "heightWeight": 1.15,
            "sunTimes": True,
            "axes": {
                "left": {
                    "quantity": "temperature",
                    "label": "°",
                    "range": "auto",
                    "zeroLine": True,
                },
            },
            "series": [
                {"quantity": "apparent_temperature", "style": "line"},
                {
                    "quantity": "temperature",
                    "style": "line",
                    "extremeLabels": True,
                },
            ],
        },
        {
            "id": "precip",
            "heightWeight": 0.95,
            "axes": {
                "left": {
                    "quantity": "precipitation",
                    "label": "mm",
                    "range": "zero-based",
                },
            },
            "background": {
                "kind": "vertical_cloud_profile",
                "enabled": True,
                "heightWeight": 0.3,
            },
            "series": [
                {"quantity": "precipitation_rain_snow", "style": "bars"},
                {
                    "quantity": "precipitation_probability",
                    "style": "line",
                    "axis": "hidden",
                },
                {"quantity": "weather_code", "style": "icons"},
            ],
        },
        {
            "id": "wind",
            "heightWeight": 1.05,
            "axes": {
                "left": {
                    "quantity": "wind_speed",
                    "label": "km/h",
                    "range": "zero-based",
                },
            },
            "series": [
                {"quantity": "wind_gusts", "style": "line"},
                {"quantity": "wind_speed", "style": "line"},
                {"quantity": "wind_direction", "style": "arrows"},
            ],
        },
    ],
}

BUILTIN_LAYOUTS: Dict[str, Dict[str, Any]] = {
    layout["id"]: layout for layout in (POWER_DEFAULT_LAYOUT, NORMAL_LAYOUT)
}


def builtin_layouts() -> List[Dict[str, Any]]:
    """Built-in layouts, validated, with defaults filled in."""
    return [validate_layout(layout) for layout in BUILTIN_LAYOUTS.values()]


# Layout library (system.md §4.3, #168): stored meteogram configurations.
# The fixed first entry is the default layout (#203): normal mode, the Auto
# entry and every configuration without its own layout draw it. It can be
# edited and reset, but not renamed or deleted.
DEFAULT_LAYOUT_ID = "default"
DEFAULT_LAYOUT_NAME = "Default"
# Id of the fixed entry before schema version 2 (then "Normal mode").
LEGACY_NORMAL_MODE_LAYOUT_ID = "normal-mode"
# Entries seeded into an empty library: (id, name, built-in layout id).
SEEDED_LAYOUTS = (
    (DEFAULT_LAYOUT_ID, DEFAULT_LAYOUT_NAME, NORMAL_LAYOUT["id"]),
    (POWER_DEFAULT_LAYOUT["id"], "Power default", POWER_DEFAULT_LAYOUT["id"]),
)


def builtin_layout(builtin_id: str) -> Dict[str, Any]:
    """Validated copy of a built-in layout; raises KeyError when unknown."""
    return validate_layout(BUILTIN_LAYOUTS[builtin_id])


FRONTEND_LAYOUTS_PATH = "react/src/layouts/builtinLayouts.generated.ts"


def render_frontend_layouts() -> str:
    """TypeScript copy of the built-in layouts (defaults omitted)."""
    import json

    body = json.dumps(
        list(BUILTIN_LAYOUTS.values()), indent=2, ensure_ascii=False
    )
    return (
        "// Generated by dev-tools/export_quantity_registry.py from\n"
        "// graupel/data/layouts.py. Do not edit by hand.\n"
        'import type { ChartLayout } from "./types";\n'
        "\n"
        f"export const BUILTIN_LAYOUTS: ChartLayout[] = {body};\n"
    )
