import pytest

from graupel.data.api import MeteogramAPI
from graupel.data.auto_chain import (
    MIN_CLOUD_PRESSURE_LEVELS,
    list_auto_chains,
    list_regions,
    load_chain_zones,
    load_regions,
    region_chains,
    resolve_auto_chain,
)
from graupel.data.open_meteo import get_model_catalog


def _ids(chain):
    return [m.id for m in chain]


@pytest.mark.parametrize(
    "lat, lon, region",
    [
        (47.421, 10.985, "northern_alps"),  # Zugspitze
        (47.554, 12.923, "eastern_alps"),  # Watzmann
        (47.631, 13.002, "eastern_alps"),  # Berchtesgaden
        (47.492, 11.096, "northern_alps"),  # Garmisch-Partenkirchen
        (46.508, 10.542, "dolomites"),  # Ortler
        (45.9765, 7.6586, "western_alps_ch"),  # Matterhorn
        (45.8326, 6.8652, "western_alps_fr"),  # Mont Blanc
        (45.79, 6.97, "western_alps_fr"),  # Courmayeur (Aosta valley)
        (48.137, 11.576, "germany"),  # Munich
        (48.208, 16.373, "austria"),  # Vienna
        (48.857, 2.352, "france"),  # Paris
        (40.713, -74.006, "usa"),  # New York
        (69.65, 18.96, "nordic"),  # Tromsø (island)
        (48.57, 7.81, "germany"),  # Kehl, across the Rhine from Strasbourg
        (48.58, 7.75, "france"),  # Strasbourg
    ],
)
def test_spec_points_resolve_to_their_region(lat, lon, region):
    result = resolve_auto_chain(lat, lon)
    assert result["region_id"] == region
    assert result["resolution_reason"] == "region"


def test_mid_atlantic_is_global_fallback():
    # RDPS delivers data here but is coarser than IFS, so it is not used.
    result = resolve_auto_chain(40.0, -35.0)
    assert result["resolution_reason"] == "global_fallback"
    assert _ids(result["main_model_chain"]) == ["ecmwf_ifs"]
    assert _ids(result["cloud_model_chain"]) == ["ecmwf_ifs025"]


def test_region_chains_drop_models_that_miss_the_point():
    # Anchorage: HRRR and HRDPS miss Alaska's south coast, RDPS covers it.
    result = resolve_auto_chain(61.22, -149.9)
    assert result["region_id"] == "usa"
    assert _ids(result["main_model_chain"]) == ["cmc_gem_rdps", "ecmwf_ifs"]


def test_region_chains_drop_models_that_do_not_extend_the_horizon():
    # New York: HRDPS (48 h) would not extend HRRR (48 h).
    chain = _ids(resolve_auto_chain(40.713, -74.006)["main_model_chain"])
    assert chain == [
        "ncep_hrrr_conus",
        "cmc_gem_rdps",
        "ncep_nbm_conus",
        "ecmwf_ifs",
    ]


def test_domain_fallback_uses_regional_models_finer_than_ifs():
    result = resolve_auto_chain(25.03, 121.56)  # Taipei
    assert result["resolution_reason"] == "domain_fallback"
    assert result["region_id"] is None
    assert _ids(result["main_model_chain"]) == ["jma_msm", "ecmwf_ifs"]


def test_invalid_input_is_global_fallback():
    result = resolve_auto_chain("x", None)
    assert result["resolution_reason"] == "global_fallback"
    assert _ids(result["main_model_chain"]) == ["ecmwf_ifs"]


@pytest.mark.parametrize(
    "lat, lon",
    [
        (47.421, 10.985),
        (45.8326, 6.8652),
        (40.713, -74.006),
        (61.22, -149.9),
        (78.22, 15.65),
        (39.03, 125.75),
        (36.8, 10.18),
        (0.0, 0.0),
    ],
)
def test_chains_are_strictly_increasing_and_cloud_capable(lat, lon):
    result = resolve_auto_chain(lat, lon)
    for key, terminal in (
        ("main_model_chain", "ecmwf_ifs"),
        ("cloud_model_chain", "ecmwf_ifs025"),
    ):
        hours = [m.max_forecast_horizon_hours for m in result[key]]
        assert hours == sorted(set(hours)), key
        assert result[key][-1].id == terminal
    for model in result["cloud_model_chain"]:
        assert model.supports_vertical_cloud_profile
        assert len(model.pressure_levels_hpa) >= MIN_CLOUD_PRESSURE_LEVELS


def test_region_chains_use_catalogue_models():
    catalogue = {m.id: m for m in get_model_catalog()}
    for region in load_regions():
        for model_id in region["main_chain_ids"] + region["cloud_chain_ids"]:
            assert model_id in catalogue, (region["id"], model_id)
        for model_id in region["cloud_chain_ids"]:
            model = catalogue[model_id]
            assert model.supports_vertical_cloud_profile, model_id
            assert (
                len(model.pressure_levels_hpa) >= MIN_CLOUD_PRESSURE_LEVELS
            ), model_id


def test_no_continent_regions():
    assert {r["priority"] for r in load_regions()} == {20, 30}


def test_api_exposes_regions_and_auto_chain(tmp_path):
    from graupel.data.storage import Storage

    api = MeteogramAPI(storage=Storage(db_path=str(tmp_path / "t.db")))
    regions = api.list_regions()
    assert regions[0]["priority"] == 30
    assert all("polygons" not in r for r in regions)
    assert {r["id"] for r in regions} == {r["id"] for r in list_regions()}
    result = api.resolve_auto_chain(48.137, 11.576)
    assert result["region_id"] == "germany"
    assert result["main_model_chain"][0]["id"] == "icon_d2"


def test_region_chains_keep_the_whole_preference_list():
    result = region_chains("usa")
    assert result["region_id"] == "usa"
    assert result["region_name"] == "USA"
    assert result["resolution_reason"] == "region"
    # Without a point no model is dropped for its domain; HRDPS still
    # leaves because it does not extend HRRR's horizon.
    assert _ids(result["main_model_chain"]) == [
        "ncep_hrrr_conus",
        "cmc_gem_rdps",
        "ncep_nbm_conus",
        "ecmwf_ifs",
    ]
    assert _ids(result["cloud_model_chain"])[-1] == "ecmwf_ifs025"


def test_region_chains_are_strictly_increasing_for_every_region():
    for region in load_regions():
        result = region_chains(region["id"])
        for key in ("main_model_chain", "cloud_model_chain"):
            hours = [m.max_forecast_horizon_hours for m in result[key]]
            assert hours == sorted(set(hours)), (region["id"], key)


def test_region_chains_unknown_region_is_none(tmp_path):
    from graupel.data.storage import Storage

    assert region_chains("atlantis") is None
    api = MeteogramAPI(storage=Storage(db_path=str(tmp_path / "t.db")))
    assert api.get_region_chains("atlantis") is None
    result = api.get_region_chains("germany")
    assert [m["id"] for m in result["main_model_chain"]] == [
        "icon_d2",
        "icon_eu",
        "ecmwf_ifs",
    ]


# --- Chain zones for "Start from auto configuration" (#198) ----------------


def test_shipped_chain_zones_match_the_resolver():
    for zone in load_chain_zones():
        lon, lat = zone["sample"]
        result = resolve_auto_chain(lat, lon)
        assert _ids(result["main_model_chain"]) == zone["main_chain_ids"]
        assert _ids(result["cloud_model_chain"]) == zone["cloud_chain_ids"]


def test_auto_chains_list_what_no_region_offers():
    region_keys = {
        (
            tuple(_ids(region_chains(r["id"])["main_model_chain"])),
            tuple(_ids(region_chains(r["id"])["cloud_model_chain"])),
        )
        for r in load_regions()
    }
    entries = list_auto_chains()
    keys = [
        (tuple(_ids(e["main_model_chain"])), tuple(_ids(e["cloud_model_chain"])))
        for e in entries
    ]
    assert len(keys) == len(set(keys))
    assert not set(keys) & region_keys
    by_main = {k[0]: e for k, e in zip(keys, entries)}
    # Intercontinental: RDPS where the USA / Canada / Nordic chains only
    # keep RDPS (southern Alaska, Arctic Canada, Svalbard).
    rdps = by_main[("cmc_gem_rdps", "ecmwf_ifs")]
    assert rdps["group"] == "Intercontinental"
    assert rdps["resolution_reason"] == "region"
    assert "USA" in rdps["regions"]
    # Domain fallback, e.g. North Africa and northern Mexico.
    arpege = by_main[("meteofrance_arpege_europe", "ecmwf_ifs")]
    assert (arpege["group"], arpege["resolution_reason"]) == (
        "Europe",
        "domain_fallback",
    )
    assert arpege["origin"] == "regional models"
    hrrr = by_main[("ncep_hrrr_conus", "ecmwf_ifs")]
    assert hrrr["group"] == "North America"
    # Global: IFS only.
    ifs = by_main[("ecmwf_ifs",)]
    assert (ifs["group"], ifs["name"], ifs["resolution_reason"]) == (
        "Global",
        "IFS HRES",
        "global_fallback",
    )
    assert _ids(ifs["cloud_model_chain"]) == ["ecmwf_ifs025"]


def test_api_lists_auto_chains_with_catalogue_models(tmp_path):
    from graupel.data.storage import Storage

    api = MeteogramAPI(storage=Storage(db_path=str(tmp_path / "t.db")))
    entries = api.list_auto_chains()
    assert entries and all(isinstance(e["id"], str) for e in entries)
    first = entries[0]["main_model_chain"][0]
    assert {"id", "name", "max_forecast_horizon_hours"} <= set(first)
