import json

from graupel.data.model_short_names import MODEL_SHORT_NAMES, short_name_for
from graupel.data.open_meteo import load_catalog
from graupel.resources import model_resource


def _catalogue(filename):
    with model_resource(filename).open("r", encoding="utf-8") as source:
        return json.load(source)


def test_catalogue_carries_the_curated_short_names():
    stored = {
        m["id"]: m.get("short_name")
        for m in _catalogue("model_catalogue.json")
    }
    assert stored == {
        model_id: short_name_for(model_id) for model_id in stored
    }, "run python dev-tools/update_catalog.py --short-names-only"


def test_short_names_belong_to_catalogue_models_and_are_unique():
    ids = {m["id"] for m in _catalogue("model_catalogue.json")}
    assert set(MODEL_SHORT_NAMES) <= ids
    names = list(MODEL_SHORT_NAMES.values())
    assert len(names) == len(set(names))


def test_weather_model_exposes_short_name():
    models = {m.id: m for m in load_catalog(force_refresh=True)}
    assert models["geosphere_arome_austria"].short_name == "AROME AT"
    assert models["ncep_gfs_seamless"].short_name == "GFS SL"
    assert all(
        m.short_name is None for m in models.values() if len(m.name) <= 10
    )
