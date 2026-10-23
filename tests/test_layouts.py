import copy
from pathlib import Path

import pytest

from graupel.data.layouts import (
    FRONTEND_LAYOUTS_PATH,
    NORMAL_LAYOUT,
    POWER_DEFAULT_LAYOUT,
    builtin_layouts,
    render_frontend_layouts,
    validate_layout,
)
from graupel.data.quantities import (
    QUANTITIES,
    SOURCE_DERIVED,
    display_set,
    fetch_set,
)

ROOT = Path(__file__).resolve().parent.parent


def _layout(**overrides):
    layout = copy.deepcopy(POWER_DEFAULT_LAYOUT)
    layout.update(overrides)
    return layout


def test_builtin_layouts_are_valid_and_fill_defaults():
    layouts = {layout["id"]: layout for layout in builtin_layouts()}
    assert set(layouts) == {"power-default", "normal-default"}
    power = layouts["power-default"]
    assert [area["id"] for area in power["areas"]] == [
        "temp",
        "precip",
        "wind",
        "convective",
    ]
    assert power["showModelHeaders"] is True
    assert power["areas"][0]["series"][1]["curveStops"] is True
    assert layouts["normal-default"]["showModelHeaders"] is False


def test_normal_layout_has_cloud_profile_and_no_convective_area():
    # Q1 answered: the normal layout includes the cloud profile (system.md §4.4).
    areas = NORMAL_LAYOUT["areas"]
    assert [area["id"] for area in areas] == ["temp", "precip", "wind"]
    assert [area.get("background") for area in areas] == [
        None,
        {"kind": "vertical_cloud_profile", "enabled": True, "heightWeight": 0.3},
        None,
    ]
    assert NORMAL_LAYOUT["showModelHeaders"] is False


def test_layouts_need_no_quantities_beyond_the_fetch_set():
    # Switching layout never needs a new request (system.md §9.3, #139).
    fetched = set(fetch_set())
    for layout in (POWER_DEFAULT_LAYOUT, NORMAL_LAYOUT):
        drawn = {
            quantity_id
            for quantity_id in display_set(layout)
            if QUANTITIES[quantity_id].source != SOURCE_DERIVED
        }
        assert drawn <= fetched, layout["id"]


@pytest.mark.parametrize(
    "layout, message",
    [
        (_layout(areas=[]), "at least 1 item"),
        (
            _layout(
                areas=[
                    {
                        "id": "a",
                        "series": [{"quantity": "nope", "style": "line"}],
                    }
                ]
            ),
            "unknown quantity: nope",
        ),
        (
            _layout(
                areas=[
                    {
                        "id": "a",
                        "series": [
                            {"quantity": "temperature", "style": "bars"}
                        ],
                    }
                ]
            ),
            "style 'bars' not allowed for temperature",
        ),
        (
            _layout(areas=[{"id": "a", "series": []}, {"id": "a"}]),
            "area ids must be unique",
        ),
        (
            _layout(areas=[{"id": "a", "enabled": False}]),
            "at least one enabled area",
        ),
        (
            _layout(
                areas=[
                    {
                        "id": "a",
                        "axes": {"left": {"range": "fixed", "min": 0}},
                    }
                ]
            ),
            "fixed axis range needs min and max",
        ),
        (
            _layout(areas=[{"id": "a", "heightWeight": 0}]),
            "greater than 0",
        ),
        (_layout(showModelHeader=False), "Extra inputs are not permitted"),
    ],
)
def test_invalid_layouts_are_rejected(layout, message):
    with pytest.raises(ValueError, match="invalid layout") as excinfo:
        validate_layout(layout)
    assert message in str(excinfo.value)


def test_frontend_layout_copy_is_up_to_date():
    generated = (ROOT / FRONTEND_LAYOUTS_PATH).read_text(encoding="utf-8")
    assert (
        generated == render_frontend_layouts()
    ), "run python dev-tools/export_quantity_registry.py"
