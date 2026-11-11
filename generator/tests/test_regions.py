# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Region building on synthetic countries (no Natural Earth needed)."""

import pytest
from shapely.geometry import Point, box, shape

from graupel_gen import regions as gen
from graupel_gen.resolver import Resolver
from graupel_gen.sources import Sources


def _countries():
    return [
        {"code": "DE", "continent": "Europe", "geometry": box(6, 47.27, 15, 55)},
        {"code": "AT", "continent": "Europe", "geometry": box(9.5, 46.4, 17, 47.27)},
        {"code": "IT", "continent": "Europe", "geometry": box(7, 40, 18, 46.4)},
    ]


def _config(real):
    keys = ("alps_d2_south_edge", "alps_north_edge", "kufstein_lon", "inzell_lon")
    by_id = {r["id"]: r for r in real["regions"]}
    return {
        **{k: real[k] for k in keys},
        "regions": [
            by_id["northern_alps"],
            by_id["dolomites"],
            by_id["germany"],
            by_id["austria"],
            by_id["italy"],
        ],
    }


@pytest.fixture(scope="module")
def built():
    from graupel_gen.sources import load_sources

    sources = Sources(regions=_config(load_sources().regions))
    return sources, gen.build_regions(_countries(), sources)


def test_regions_keep_the_order_and_chains_of_the_sources(built):
    sources, features = built
    assert [f["properties"]["id"] for f in features] == [
        r["id"] for r in sources.regions["regions"]
    ]
    northern = features[0]["properties"]
    assert northern["priority"] == 30
    assert northern["main_chain_ids"] == ["icon_d2", "icon_eu", "ecmwf_ifs"]
    assert features[2]["properties"]["group"] == "Europe"


def test_alpine_region_lies_between_its_edges_inside_its_countries(built):
    _, features = built
    northern = shape(features[0]["geometry"])
    assert northern.bounds[1] >= 47.27 - 1e-6  # only German territory here
    assert northern.bounds[3] <= 47.85 + 1e-3
    assert northern.contains(Point(11.0, 47.6))


def test_regions_are_disjoint_and_include_coastal_waters(built):
    _, features = built
    shapes = [shape(f["geometry"]) for f in features]
    for i, a in enumerate(shapes):
        for b in shapes[i + 1 :]:
            assert a.intersection(b).area < 1e-4
    germany = shapes[2]
    assert germany.contains(Point(10.0, 55.5))  # 0.5° off the coast
    assert not germany.contains(Point(10.0, 56.3))  # beyond 1.0°
    assert not germany.contains(Point(11.0, 47.6))  # Northern Alps


def test_resolver_on_the_built_regions(built, catalogue, domains):
    _, features = built
    resolver = Resolver(catalogue, domains, features)
    assert resolver.resolve(47.6, 11.0)["region_id"] == "northern_alps"
    assert resolver.resolve(52.5, 13.4)["region_id"] == "germany"
    assert resolver.resolve(55.5, 10.0)["region_id"] == "germany"


def test_unknown_alpine_build_is_an_error():
    config = {
        "alps_d2_south_edge": [[9.5, 47.4], [12.9, 47.7]],
        "alps_north_edge": [[12.95, 47.85], [9.5, 47.75]],
        "kufstein_lon": 12.17,
        "inzell_lon": 12.75,
    }
    with pytest.raises(ValueError, match="unknown alpine build"):
        gen.alpine_geometry(
            {"build": "spiral", "countries": ["DE"]}, config, _countries()
        )


def test_region_without_known_country_is_an_error():
    sources = Sources(
        regions={
            "regions": [
                {
                    "id": "atlantis",
                    "name": "Atlantis",
                    "priority": 20,
                    "countries": ["QQ"],
                    "main": ["ecmwf_ifs"],
                    "cloud": ["ecmwf_ifs025"],
                }
            ]
        }
    )
    with pytest.raises(ValueError, match="atlantis"):
        gen.build_regions(_countries(), sources)


def test_zone_ids_name_both_chains():
    zone = {
        "main_chain_ids": ["icon_d2", "ecmwf_ifs"],
        "cloud_chain_ids": ["ecmwf_ifs025"],
    }
    assert gen.zone_id(zone) == "icon_d2.ecmwf_ifs~ecmwf_ifs025"


def test_unquoted_norway_is_rejected(tmp_path):
    from graupel_gen.sources import DEFAULT_SOURCES_DIR, load_sources

    for name in ("models.yaml", "short_names.yaml", "resolver_points.yaml"):
        (tmp_path / name).write_text(
            (DEFAULT_SOURCES_DIR / name).read_text("utf-8"), "utf-8"
        )
    (tmp_path / "regions.yaml").write_text(
        "regions:\n  - id: nordic\n    countries: [NO, SE]\n", "utf-8"
    )
    with pytest.raises(ValueError, match="nordic"):
        load_sources(tmp_path)


def test_country_codes_of_the_sources_are_strings(sources):
    nordic = next(r for r in sources.regions["regions"] if r["id"] == "nordic")
    assert "NO" in nordic["countries"]
