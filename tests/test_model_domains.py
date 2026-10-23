import json

import pytest

from graupel.data.model_domains import (
    domain_contains,
    load_model_domains,
    point_in_ring,
)
from graupel.resources import model_resource


def _catalogue_ids():
    with model_resource("model_catalogue.json").open(
        "r", encoding="utf-8"
    ) as source:
        return {m["id"] for m in json.load(source)}


def test_every_catalogue_model_has_a_domain():
    assert (
        set(load_model_domains()) == _catalogue_ids()
    ), "run python dev-tools/update_model_domains.py"


def test_point_in_ring():
    square = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    assert point_in_ring(5, 5, square)
    assert not point_in_ring(15, 5, square)
    assert not point_in_ring(5, -1, square)


@pytest.mark.parametrize(
    "model_id, lat, lon",
    [
        ("icon_d2", 48.137, 11.576),  # Munich
        ("icon_d2", 47.421, 10.985),  # Zugspitze
        ("meteofrance_arome_france", 48.857, 2.352),  # Paris
        ("meteofrance_arome_france_hd", 45.833, 6.865),  # Mont Blanc
        ("geosphere_arome_austria", 48.208, 16.373),  # Vienna
        ("meteoswiss_icon_ch1", 45.977, 7.659),  # Matterhorn
        ("italia_meteo_arpae_icon_2i", 46.508, 10.542),  # Ortler
        ("ukmo_uk_deterministic_2km", 51.507, -0.128),  # London
        ("metno_nordic", 59.913, 10.752),  # Oslo
        ("ncep_hrrr_conus", 40.713, -74.006),  # New York
        ("cmc_gem_hrdps", 45.501, -73.567),  # Montreal
        ("cmc_gem_rdps", 64.838, -147.716),  # Fairbanks
        ("jma_msm", 35.690, 139.692),  # Tokyo
        ("kma_ldps", 37.567, 126.978),  # Seoul
    ],
)
def test_regional_models_cover_their_home(model_id, lat, lon):
    assert domain_contains(model_id, lat, lon, margin_deg=0.3)


@pytest.mark.parametrize(
    "model_id, lat, lon",
    [
        ("icon_d2", 40.416, -3.704),  # Madrid
        ("meteofrance_arome_france", 52.520, 21.0),  # Warsaw
        ("geosphere_arome_austria", 41.902, 12.496),  # Rome
        ("ncep_hrrr_conus", 19.433, -99.133),  # Mexico City
        ("jma_msm", 13.756, 100.502),  # Bangkok
    ],
)
def test_regional_models_end_at_their_domain(model_id, lat, lon):
    assert domain_contains(model_id, lat, lon) is False


def test_south_atlantic_is_only_in_global_models():
    domains = load_model_domains()
    hits = {m for m in domains if domain_contains(m, -30.0, -20.0)}
    assert hits == {m for m, d in domains.items() if d == "global"}
    assert "ecmwf_ifs" in hits and "ecmwf_ifs025" in hits


def test_rdps_reaches_the_mid_atlantic():
    # Measured: the API delivers RDPS at 40 N 35 W; the spec's mid-Atlantic
    # global-fallback point (§6.4) is a resolver case, not a domain one.
    assert domain_contains("cmc_gem_rdps", 40.0, -35.0)


def test_margin_keeps_points_away_from_the_edge():
    # Walk east along 50 N to the ICON-D2 edge.
    east = 10.0
    while domain_contains("icon_d2", 50.0, east + 0.01):
        east += 0.01
    assert domain_contains("icon_d2", 50.0, east - 0.1)
    assert not domain_contains("icon_d2", 50.0, east - 0.1, margin_deg=0.5)


def test_unknown_model_has_no_domain():
    assert domain_contains("no_such_model", 0.0, 0.0) is None
