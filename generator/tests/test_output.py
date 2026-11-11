# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Output files, their meta header and the offline CLI commands."""

import json
import re

import pytest

from graupel_gen import cli
from graupel_gen.output import (
    dump_geojson,
    dump_json,
    make_meta,
    write_document,
)

from conftest import DATA

DATA_FILES = [
    "model_catalogue.json",
    "model_domains.json",
    "regions.geojson",
    "chain_zones.json",
    "chain_zones.geojson",
    "quantities.json",
    "resolver_cases.json",
]


@pytest.mark.parametrize("name", DATA_FILES)
def test_every_data_file_has_a_meta_header(name):
    doc = json.loads((DATA / name).read_text(encoding="utf-8"))
    meta = doc["meta"]
    # Files keep the version that wrote them; only the format is fixed.
    assert re.match(r"graupel-gen \d+\.\d+\.\d+ ", meta["generated_by"])
    assert meta["generated_at"].endswith("Z")
    assert meta["sources"] and all("name" in s for s in meta["sources"])


def test_unchanged_document_is_not_rewritten(tmp_path):
    path = tmp_path / "x.json"
    doc = {"meta": make_meta("test", []), "items": [1, 2]}
    assert write_document(path, doc)
    before = path.read_bytes()
    later = {**doc, "meta": {**doc["meta"], "generated_at": "2099-01-01T00:00:00Z"}}
    assert not write_document(path, later)
    assert path.read_bytes() == before
    changed = {**later, "items": [1, 2, 3]}
    assert write_document(path, changed)
    assert json.loads(path.read_text())["items"] == [1, 2, 3]


def test_geojson_has_one_feature_per_line():
    doc = {
        "type": "FeatureCollection",
        "meta": {"generated_by": "x"},
        "features": [
            {"type": "Feature", "properties": {"id": i}, "geometry": None}
            for i in range(3)
        ],
    }
    text = dump_geojson(doc)
    assert json.loads(text) == doc
    assert len(text.splitlines()) == 5


def test_offline_catalog_converts_an_old_catalogue(tmp_path, catalogue):
    old = []
    for entry in catalogue:
        item = {
            k: v
            for k, v in entry.items()
            if k not in ("meta_path", "ensemble_meta_path")
        }
        levels = bool(entry["pressure_levels_hpa"])
        item["supports_vertical_cloud_profile"] = levels
        old.append(item)
    old_path = tmp_path / "old_catalogue.json"
    old_path.write_text(json.dumps(old), encoding="utf-8")
    out = tmp_path / "out"

    with pytest.raises(SystemExit) as done:
        cli.main(
            ["catalog", "--offline", "--existing", str(old_path), "--out", str(out)]
        )
    assert done.value.code == 0

    doc = json.loads((out / "model_catalogue.json").read_text("utf-8"))
    assert doc["models"] == catalogue
    assert doc["meta"]["sources"][0]["version"] == "unknown"
    assert (out / "quantities.json").exists()


def test_offline_catalog_drops_quantities_no_longer_catalogued(
    tmp_path, catalogue
):
    old = [dict(entry) for entry in catalogue]
    old[0]["supported_variables"] = old[0]["supported_variables"] + [
        "cape",
        "convective_inhibition",
    ]
    old_path = tmp_path / "old_catalogue.json"
    old_path.write_text(json.dumps(old), encoding="utf-8")
    out = tmp_path / "out"

    with pytest.raises(SystemExit) as done:
        cli.main(
            ["catalog", "--offline", "--existing", str(old_path), "--out", str(out)]
        )
    assert done.value.code == 0

    doc = json.loads((out / "model_catalogue.json").read_text("utf-8"))
    assert doc["models"] == catalogue


def test_offline_domains_needs_a_domain_per_model(tmp_path, catalogue, domains):
    out = tmp_path / "out"
    out.mkdir()
    (out / "model_catalogue.json").write_text(
        dump_json({"meta": {}, "models": catalogue}), encoding="utf-8"
    )
    partial = {k: v for k, v in domains.items() if k != "icon_d2"}
    (out / "model_domains.json").write_text(
        dump_json({"meta": {}, "models": partial}), encoding="utf-8"
    )
    with pytest.raises(SystemExit, match="icon_d2"):
        cli.main(["domains", "--offline", "--out", str(out)])


def test_offline_regions_takes_over_a_zone_list(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    for name in ("model_catalogue.json", "model_domains.json", "regions.geojson"):
        (out / name).write_bytes((DATA / name).read_bytes())
    old = {"zones": json.loads((DATA / "chain_zones.json").read_text("utf-8"))["zones"]}
    old_path = tmp_path / "old_zones.json"
    old_path.write_text(json.dumps(old), encoding="utf-8")

    with pytest.raises(SystemExit) as done:
        cli.main(
            ["regions", "--offline", "--existing", str(old_path), "--out", str(out)]
        )
    assert done.value.code == 0
    zones = json.loads((out / "chain_zones.json").read_text("utf-8"))
    assert zones["zones"] == old["zones"]
    cases = json.loads((out / "resolver_cases.json").read_text("utf-8"))
    assert cases["cases"]
    assert not (out / "chain_zones.geojson").exists()
