# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Links of the catalogue: `documentation_url` and `provider_url` (REQ-688).

The URLs are only checked for their form; tests never request them.
"""

import shutil

import pytest

from graupel_gen.sources import DEFAULT_SOURCES_DIR, check_url, load_sources

OPEN_METEO_DOCS = "https://open-meteo.com/en/docs"

# Non-seamless models that knowingly have no documentation link. Every entry
# needs a reason; a model listed here that has a link fails the test below.
DOCUMENTATION_EXCEPTIONS: dict = {}


def _is_blend(model_id):
    return model_id == "best_match" or "seamless" in model_id


@pytest.mark.parametrize(
    "url",
    [
        "https://www.dwd.de",
        "https://open-meteo.com/en/docs/dwd-api",
        "https://rapidrefresh.noaa.gov/hrrr/",
    ],
)
def test_valid_urls(url):
    assert check_url(url, "test") == url


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "www.dwd.de",
        "http://www.dwd.de",
        "ftp://www.dwd.de",
        "https://",
        "https:///docs",
        "https://localhost/docs",
        " https://www.dwd.de",
        "https://www.dwd.de/a b",
        "https://[::1",
    ],
)
def test_invalid_urls_are_errors(url):
    with pytest.raises(ValueError, match="test"):
        check_url(url, "test")


def _sources_dir(tmp_path, old, new):
    directory = tmp_path / "sources"
    shutil.copytree(DEFAULT_SOURCES_DIR, directory)
    path = directory / "models.yaml"
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    return directory


def test_invalid_documentation_url_in_the_sources_is_an_error(tmp_path):
    directory = _sources_dir(
        tmp_path,
        'documentation_url: "https://www.ecmwf.int/',
        'documentation_url: "http://www.ecmwf.int/',
    )
    with pytest.raises(ValueError, match="ecmwf_ifs: documentation_url"):
        load_sources(directory)


def test_invalid_provider_url_in_the_sources_is_an_error(tmp_path):
    directory = _sources_dir(
        tmp_path, '"DWD": "https://www.dwd.de"', '"DWD": "www.dwd.de"'
    )
    with pytest.raises(ValueError, match="provider_urls: DWD"):
        load_sources(directory)


def test_provider_without_homepage_in_the_sources_is_an_error(tmp_path):
    directory = _sources_dir(
        tmp_path, '  "CHMI": "https://www.chmi.cz"\n', ""
    )
    with pytest.raises(ValueError, match="'CHMI' has no homepage"):
        load_sources(directory)


def test_every_active_model_has_its_provider_homepage(catalogue, sources):
    for model in catalogue:
        if not model["active"]:
            continue
        url = model["provider_url"]
        assert url, model["id"]
        assert check_url(url, model["id"]) == url
        assert url == sources.provider_urls[model["provider"]], model["id"]


def test_every_model_has_documentation_or_is_an_exception(catalogue):
    for model in catalogue:
        url = model["documentation_url"]
        if _is_blend(model["id"]):
            continue
        if model["id"] in DOCUMENTATION_EXCEPTIONS:
            assert url is None, f"{model['id']} has a link: drop the exception"
            continue
        assert url, model["id"]
        assert check_url(url, model["id"]) == url


def test_exceptions_are_catalogued_models(catalogue):
    ids = {m["id"] for m in catalogue}
    assert set(DOCUMENTATION_EXCEPTIONS) <= ids


def test_blends_link_the_open_meteo_documentation(catalogue):
    blends = [m for m in catalogue if _is_blend(m["id"])]
    assert len(blends) >= 10
    for model in blends:
        assert model["documentation_url"].startswith(OPEN_METEO_DOCS), (
            model["id"]
        )


def test_documentation_links_of_well_known_models(catalogue):
    links = {m["id"]: m["documentation_url"] for m in catalogue}
    assert links["icon_d2"].startswith("https://www.dwd.de/")
    assert links["ecmwf_ifs"].startswith("https://www.ecmwf.int/")
    assert links["ncep_hrrr_conus"].startswith(
        "https://rapidrefresh.noaa.gov/"
    )
    assert links["best_match"] == OPEN_METEO_DOCS
    assert links["icon_seamless"] == f"{OPEN_METEO_DOCS}/dwd-api"
