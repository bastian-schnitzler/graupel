# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Licenses of GEN (REQ-094, DEC-006).

Generator code and `sources/` under MPL-2.0 with SPDX header in every
source file; data in `model-data/` under CC BY 4.0 (derived from Open-Meteo)
or MPL-2.0, named in `meta.license` of every data file and in REUSE.toml;
no GPL material and no checked-in `forecast.yml`.
"""

import json
import re
from pathlib import Path

import pytest

from graupel_gen.output import (
    CC_BY,
    FILE_LICENSES,
    LICENSE_URLS,
    MPL,
    OPEN_METEO_ATTRIBUTION,
    dump_json,
    make_meta,
    read_document,
    with_license,
    write_document,
)

from conftest import DATA

GENERATOR = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache", "node_modules"}
SOURCE_SUFFIXES = {".py", ".yaml", ".yml"}
# Files whose license differs from the generator's MPL-2.0.
SOURCE_LICENSES = {"tests/fixtures/forecast_models.yml": CC_BY}
EXHIBIT_A = (
    "This Source Code Form is subject to the terms of the Mozilla Public "
    "License, v. 2.0."
)
GPL = re.compile(r"GPL|General Public License", re.IGNORECASE)


def _files(root: Path):
    for path in sorted(root.rglob("*")):
        parts = path.relative_to(root).parts
        if path.is_file() and not any(
            p in SKIP_DIRS or p.endswith(".egg-info") for p in parts
        ):
            yield path


def _source_files():
    return [
        p
        for p in _files(GENERATOR)
        if p.suffix in SOURCE_SUFFIXES or p.name == "pyproject.toml"
    ]


def _header(path: Path) -> str:
    lines = path.read_text(encoding="utf-8").splitlines()[:10]
    return " ".join(
        line.lstrip("#").strip() for line in lines if line.startswith("#")
    )


def _toml(path: Path):
    tomllib = pytest.importorskip("tomllib")  # Python 3.11+
    return tomllib.loads(path.read_text(encoding="utf-8"))


def _data_files():
    return sorted(
        p.name
        for p in DATA.iterdir()
        if p.suffix in (".json", ".geojson") and p.name != "package.json"
    )


def test_finds_the_source_files():
    names = {p.relative_to(GENERATOR).as_posix() for p in _source_files()}
    assert {
        "pyproject.toml",
        "src/graupel_gen/cli.py",
        "sources/models.yaml",
        "tests/test_license.py",
        "tests/fixtures/forecast_models.yml",
    } <= names


@pytest.mark.parametrize(
    "path",
    _source_files(),
    ids=lambda p: p.relative_to(GENERATOR).as_posix(),
)
def test_every_source_file_has_an_spdx_header(path):
    rel = path.relative_to(GENERATOR).as_posix()
    expected = SOURCE_LICENSES.get(rel, MPL)
    header = _header(path)
    assert "SPDX-FileCopyrightText: 2026 Bastian Schnitzler" in header
    assert f"SPDX-License-Identifier: {expected}" in header
    if expected == MPL:
        assert EXHIBIT_A in header
    else:
        assert "Contains data derived from Open-Meteo.com" in header


def test_generator_is_mpl():
    text = (GENERATOR / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("Mozilla Public License Version 2.0")
    project = _toml(GENERATOR / "pyproject.toml")["project"]
    assert project["license"] == MPL
    assert "LICENSE" in project["license-files"]
    assert (GENERATOR / "THIRD_PARTY_LICENSES.md").exists()


def test_reuse_toml_of_generator_covers_files_without_header():
    reuse = _toml(GENERATOR / "REUSE.toml")
    covered = {
        path
        for a in reuse["annotations"]
        if a["SPDX-License-Identifier"] == MPL
        for path in a["path"]
    }
    assert {"README.md", "THIRD_PARTY_LICENSES.md", "uv.lock"} <= covered


def test_every_data_file_has_a_license_entry():
    assert _data_files() == sorted(FILE_LICENSES)


@pytest.mark.parametrize("name", sorted(FILE_LICENSES))
def test_every_data_file_names_its_license(name):
    meta = json.loads((DATA / name).read_text(encoding="utf-8"))["meta"]
    expected = FILE_LICENSES[name]
    assert meta["license"] == expected
    assert meta["license_url"] == LICENSE_URLS[expected]
    if expected == CC_BY:
        assert meta["attribution"] == OPEN_METEO_ATTRIBUTION
        assert "Open-Meteo.com" in meta["attribution"]
    else:
        assert "attribution" not in meta
    # license fields come first in meta
    assert list(meta)[:2] == ["license", "license_url"]


def test_derived_data_is_cc_by_and_own_data_mpl():
    assert {n for n, lic in FILE_LICENSES.items() if lic == CC_BY} == {
        "model_catalogue.json",
        "model_domains.json",
        "chain_zones.json",
        "chain_zones.geojson",
    }
    assert {n for n, lic in FILE_LICENSES.items() if lic == MPL} == {
        "quantities.json",
        "regions.geojson",
        "resolver_cases.json",
    }


def test_reuse_toml_of_model_data_matches_meta():
    reuse = _toml(DATA / "REUSE.toml")
    licenses = {
        path: a["SPDX-License-Identifier"]
        for a in reuse["annotations"]
        for path in a["path"]
    }
    for name, expected in FILE_LICENSES.items():
        assert licenses[name] == expected, name


def test_model_data_ships_license_texts():
    assert (DATA / "LICENSES" / "CC-BY-4.0.txt").read_text(
        encoding="utf-8"
    ).startswith("Creative Commons Attribution 4.0 International")
    assert (DATA / "LICENSES" / "MPL-2.0.txt").read_text(
        encoding="utf-8"
    ).startswith("Mozilla Public License Version 2.0")
    package = json.loads((DATA / "package.json").read_text(encoding="utf-8"))
    assert package["license"] == "CC-BY-4.0 AND MPL-2.0"
    for name in ("LICENSE", "LICENSES", "THIRD_PARTY_LICENSES.md"):
        assert (DATA / name).exists()
        assert name in package["files"]


def test_written_document_gets_its_license(tmp_path):
    for name, expected in FILE_LICENSES.items():
        path = tmp_path / name
        doc = {"meta": make_meta("test", []), "items": [1]}
        assert write_document(path, doc)
        meta = read_document(path)["meta"]
        assert meta["license"] == expected
        assert list(meta)[-3:] == ["generated_by", "generated_at", "sources"]
        # a second run with the same content leaves the file as it is
        before = path.read_bytes()
        assert not write_document(path, doc)
        assert path.read_bytes() == before


def test_with_license_keeps_key_order_and_replaces_old_fields():
    doc = {
        "type": "FeatureCollection",
        "meta": {"license": "old", "generated_by": "x"},
        "features": [],
    }
    out = with_license("chain_zones.geojson", doc)
    assert list(out) == ["type", "meta", "features"]
    assert out["meta"]["license"] == CC_BY
    assert list(out["meta"]) == [
        "license",
        "license_url",
        "attribution",
        "generated_by",
    ]
    assert with_license("other.json", doc) is doc
    assert dump_json(with_license("quantities.json", {"q": 1})).startswith(
        '{\n  "meta": {\n    "license": "MPL-2.0"'
    )


def test_no_gpl_in_generator_and_model_data():
    # The MPL-2.0 text names the GNU licenses as "Secondary Licenses".
    license_texts = {
        GENERATOR / "LICENSE",
        DATA / "LICENSES" / "MPL-2.0.txt",
    }
    me = Path(__file__).resolve()
    hits = [
        p.as_posix()
        for root in (GENERATOR, DATA)
        for p in _files(root)
        if p not in license_texts
        and p != me
        and GPL.search(p.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == []


def test_forecast_yml_is_not_checked_in():
    found = [
        p.as_posix()
        for root in (GENERATOR, DATA)
        for p in _files(root)
        if p.name == "forecast.yml"
    ]
    assert found == []
