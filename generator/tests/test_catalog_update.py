# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Full catalogue run against recorded API answers.

The answers are rebuilt from the committed catalogue (the API is not
reachable from tests): a model delivers values for its catalogued
variables and its pressure levels, and its single run lasts its horizon.
"""

import asyncio
import dataclasses
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from graupel_gen import catalog
from graupel_gen.http import USER_AGENT, RateLimiter
from graupel_gen.output import dump_json

from conftest import DATA, FIXTURES

RUN = datetime(2026, 10, 23, 0, tzinfo=timezone.utc)


def _committed():
    return json.loads(
        (DATA / "model_catalogue.json").read_text(encoding="utf-8")
    )["models"]


def _yaml_models():
    text = (FIXTURES / "forecast_models.yml").read_text(encoding="utf-8")
    return catalog.extract_models_enum(text)


def _recorded_api(catalogue, status=None, requests=None, extra=None):
    """Mock transport answering like the API did for `catalogue`."""
    models = {m["id"]: m for m in catalogue}
    models.update(extra or {})
    api_names = {q.api_name: q.id for q in catalog.PROBE_QUANTITIES}

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if requests is not None:
            requests.append(request)
        if request.url.path.endswith("/static/meta.json"):
            return httpx.Response(
                200,
                json={
                    "last_run_initialisation_time": RUN.timestamp(),
                    "update_interval_seconds": 86400,
                    "temporal_resolution_seconds": 3600,
                },
            )
        if request.url.host == "raw.githubusercontent.com":
            return httpx.Response(404)
        model = models[params["models"]]
        if status and model["id"] in status:
            return httpx.Response(status[model["id"]])
        if request.url.host.startswith("single-runs"):
            hours = model["max_forecast_hours"]
            times = [
                (RUN + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M")
                for h in range(hours + 1)
            ]
            return httpx.Response(
                200,
                json={
                    "hourly": {
                        "time": times,
                        "temperature_2m": [1.0] * len(times),
                    }
                },
            )
        times = ["2026-10-23T00:00", "2026-10-23T01:00", "2026-10-23T02:00"]
        hourly = {"time": times}
        for name in params.get("hourly", "").split(","):
            if name.startswith("cloud_cover_") and name.endswith("hPa"):
                level = int(name[len("cloud_cover_") : -3])
                has = level in model["pressure_levels_hpa"]
            else:
                has = api_names.get(name) in model["supported_variables"]
            hourly[name] = [1.0 if has else None] * len(times)
        return httpx.Response(200, json={"latitude": 50.0, "hourly": hourly})

    return httpx.MockTransport(handler)


def _run(sources, existing, transport, enum=None, only=None):
    async def go():
        async with httpx.AsyncClient(transport=transport) as client:
            return await catalog.build_catalog(
                enum if enum is not None else _yaml_models(),
                existing,
                client,
                sources,
                RateLimiter(None),
                only,
            )

    return asyncio.run(go())


def test_full_run_reproduces_the_committed_catalogue(sources):
    committed = _committed()
    transport = _recorded_api(committed)

    result = _run(sources, committed, transport)

    assert len(result) == 47
    assert dump_json(result) == dump_json(committed)


def test_probe_asks_for_every_downloadable_quantity(sources):
    committed = _committed()
    requests = []
    transport = _recorded_api(committed, requests=requests)

    _run(sources, committed[:1], transport, only=[committed[0]["id"]])

    probe = next(
        r
        for r in requests
        if r.url.host == "api.open-meteo.com" and "hourly" in r.url.params
    )
    asked = probe.url.params["hourly"].split(",")
    for name in (
        "apparent_temperature",
        "dew_point_2m",
        "relative_humidity_2m",
        "snowfall",
        "snow_depth",
        "weather_code",
        "cloud_cover_975hPa",
        "cloud_cover_10hPa",
    ):
        assert name in asked


def test_failed_probe_keeps_the_entry(sources):
    committed = _committed()
    transport = _recorded_api(committed, status={"icon_d2": 500})
    changed = [dict(m) for m in committed]
    icon_d2 = next(m for m in changed if m["id"] == "icon_d2")
    icon_d2["supported_variables"] = ["temperature"]

    result = _run(sources, changed, transport)

    assert next(m for m in result if m["id"] == "icon_d2") == icon_d2


def test_changed_probe_updates_only_probed_fields(sources):
    committed = _committed()
    upstream = [dict(m) for m in committed]
    icon_eu = next(m for m in upstream if m["id"] == "icon_eu")
    icon_eu["supported_variables"] = [
        v for v in icon_eu["supported_variables"] if v != "wind_gusts"
    ]
    icon_eu["pressure_levels_hpa"] = [1000, 850, 500]
    transport = _recorded_api(upstream)

    result = _run(sources, committed, transport)

    entry = next(m for m in result if m["id"] == "icon_eu")
    old = next(m for m in committed if m["id"] == "icon_eu")
    assert "wind_gusts" in old["supported_variables"]
    assert "wind_gusts" not in entry["supported_variables"]
    assert entry["pressure_levels_hpa"] == [1000, 850, 500]
    for key in ("name", "provider", "region", "spatial_resolution_km"):
        assert entry[key] == old[key]
    others = [m for m in result if m["id"] != "icon_eu"]
    assert others == [m for m in committed if m["id"] != "icon_eu"]


def test_probe_retries_without_rejected_quantities(sources):
    committed = _committed()
    inner = _recorded_api(committed)

    def handler(request):
        names = request.url.params.get("hourly", "").split(",")
        if "snowfall" in names and request.url.host == "api.open-meteo.com":
            return httpx.Response(400)
        return inner.handle_request(request)

    result = _run(sources, committed, httpx.MockTransport(handler))

    assert result == committed


def test_models_no_longer_in_the_enum_are_removed(sources):
    committed = _committed()
    enum = [m["id"] for m in committed if m["id"] != "ncep_nam_conus"]

    result = _run(sources, committed, _recorded_api(committed), enum=enum)

    assert [m["id"] for m in result] == enum


def test_excluded_models_are_removed(sources):
    committed = _committed()
    excluded = committed[1]
    enum = [m["id"] for m in committed]
    sources_with = dataclasses.replace(
        sources, excluded_models=[excluded["id"]]
    )

    result = _run(sources_with, committed, _recorded_api(committed), enum=enum)

    assert [m["id"] for m in result] == enum[:1] + enum[2:]
    assert catalog.without_excluded(committed, sources_with) == result


def test_new_model_gets_derived_fields(sources):
    committed = _committed()
    new = {
        "id": "dwd_icon_new_2km",
        "max_forecast_hours": 30,
        "supported_variables": ["temperature", "wind_speed"],
        "pressure_levels_hpa": [],
    }
    transport = _recorded_api(committed, extra={new["id"]: new})
    enum = _yaml_models() + [new["id"]]

    result = _run(sources, committed, transport, enum=enum)

    entry = next(m for m in result if m["id"] == new["id"])
    assert entry["provider"] == "DWD"
    assert entry["name"] == "DWD ICON NEW 2KM"
    assert entry["spatial_resolution_km"] == 2.0
    assert entry["max_forecast_hours"] == 30
    assert entry["meta_path"] == "dwd_icon_new_2km"
    assert entry["ensemble_meta_path"] is None
    assert entry["short_name"] is None
    assert entry["documentation_url"] is None
    assert entry["provider_url"] == "https://www.dwd.de"
    assert [m for m in result if m is not entry] == committed


def test_extra_models_are_kept_and_probed_without_the_enum(sources):
    # REQ-768: RRFS is missing from the OpenAPI enum, the API serves it.
    committed = _committed()
    assert "ncep_rrfs_conus" not in _yaml_models()
    assert "ncep_rrfs_conus" in sources.extra_models
    new = {
        "id": "dwd_icon_new_2km",
        "max_forecast_hours": 30,
        "supported_variables": ["temperature", "wind_speed"],
        "pressure_levels_hpa": [],
    }
    requests = []
    transport = _recorded_api(
        committed, requests=requests, extra={new["id"]: new}
    )
    sources_with = dataclasses.replace(
        sources, extra_models=[*sources.extra_models, new["id"]]
    )

    result = _run(sources_with, committed, transport)

    ids = [m["id"] for m in result]
    assert ids == [m["id"] for m in committed] + [new["id"]]
    assert result[-1]["max_forecast_hours"] == 30
    probed = {r.url.params.get("models") for r in requests}
    assert {"ncep_rrfs_conus", new["id"]} <= probed


def test_entry_missing_a_curated_field_does_not_fail(sources):
    committed = _committed()
    broken = [dict(m) for m in committed]
    del broken[0]["provider"]
    del broken[0]["active"]
    sources_without = dataclasses.replace(
        sources,
        models={k: v for k, v in sources.models.items() if k != "best_match"},
    )

    result = _run(sources_without, broken, _recorded_api(committed))

    assert result[0]["provider"] == "Unknown"
    assert result[0]["provider_url"] is None
    assert result[0]["documentation_url"] == committed[0]["documentation_url"]
    assert result[0]["active"] is True
    assert result[1:] == committed[1:]


def test_curated_fields_win_over_the_existing_entry(sources):
    committed = _committed()
    stale = [dict(m) for m in committed]
    stale[0]["name"] = "Old name"

    result = _run(sources, stale, _recorded_api(committed))

    assert result == committed


def test_curated_documentation_url_wins_over_the_existing_entry(sources):
    committed = _committed()
    stale = [dict(m) for m in committed]
    icon_d2 = next(m for m in stale if m["id"] == "icon_d2")
    icon_d2["documentation_url"] = "https://example.org/old"

    result = _run(sources, stale, _recorded_api(committed))

    assert result == committed
    assert catalog.refresh_entry(icon_d2, sources) == next(
        m for m in committed if m["id"] == "icon_d2"
    )
    assert (
        next(m for m in result if m["id"] == "icon_d2")["documentation_url"]
        == sources.models["icon_d2"]["documentation_url"]
    )


def test_existing_documentation_url_stays_without_a_curated_one(sources):
    committed = _committed()
    entry = dict(next(m for m in committed if m["id"] == "icon_d2"))
    entry["documentation_url"] = "https://example.org/icon-d2"
    models = dict(sources.models)
    models["icon_d2"] = {
        k: v for k, v in models["icon_d2"].items() if k != "documentation_url"
    }
    uncurated = dataclasses.replace(sources, models=models)

    refreshed = catalog.refresh_entry(entry, uncurated)

    assert refreshed["documentation_url"] == "https://example.org/icon-d2"
    del entry["documentation_url"]
    assert catalog.refresh_entry(entry, uncurated)["documentation_url"] is None


def test_provider_url_is_the_homepage_of_the_provider(sources):
    committed = _committed()
    stale = [dict(m) for m in committed]
    for m in stale:
        m["provider_url"] = "https://example.org"
    homepages = {**sources.provider_urls, "DWD": "https://www.dwd.de/EN/"}
    changed = dataclasses.replace(sources, provider_urls=homepages)

    result = _run(changed, stale, _recorded_api(committed))

    for entry in result:
        assert entry["provider_url"] == homepages[entry["provider"]]
    assert next(m for m in result if m["id"] == "icon_eu")[
        "provider_url"
    ] == "https://www.dwd.de/EN/"


def test_provider_without_homepage_is_an_error(sources):
    homepages = {
        k: v for k, v in sources.provider_urls.items() if k != "MeteoSwiss"
    }
    missing = dataclasses.replace(sources, provider_urls=homepages)
    entry = next(m for m in _committed() if m["id"] == "meteoswiss_icon_ch1")

    with pytest.raises(ValueError, match="MeteoSwiss"):
        catalog.refresh_entry(entry, missing)


def test_invalid_documentation_url_in_the_catalogue_is_an_error(sources):
    entry = dict(next(m for m in _committed() if m["id"] == "icon_d2"))
    entry["documentation_url"] = "http://www.dwd.de"
    models = dict(sources.models)
    models["icon_d2"] = {
        k: v for k, v in models["icon_d2"].items() if k != "documentation_url"
    }

    with pytest.raises(ValueError, match="icon_d2"):
        catalog.refresh_entry(
            entry, dataclasses.replace(sources, models=models)
        )


def test_probe_points_come_from_the_sources(sources):
    committed = _committed()
    requests = []
    _run(
        sources,
        committed,
        _recorded_api(committed, requests=requests),
        only=["jma_msm"],
    )
    probe = next(r for r in requests if "hourly" in r.url.params)
    assert probe.url.params["latitude"] == "35.6"
    assert probe.url.params["longitude"] == "139.7"
    assert sources.probe_point("ecmwf_ifs") == (50.0, 8.0)


def test_requests_carry_the_user_agent(sources):
    assert USER_AGENT.startswith("graupel-gen/0.5.0 ")


def test_nominal_resolution_from_names():
    assert catalog.parse_nominal_resolution("ECMWF IFS 0.25°") == 25.0
    assert catalog.parse_nominal_resolution("UKMO UK 2km") == 2.0
    assert catalog.parse_nominal_resolution("GFS 0.11°") == 11.0
    assert catalog.parse_nominal_resolution("ICON-D2") is None


@pytest.mark.parametrize(
    "model_id, path",
    [
        ("best_match", None),
        ("icon_seamless", None),
        ("icon_global", "dwd_icon"),
        ("metno_nordic", "metno_nordic_pp"),
        ("ecmwf_ifs", "ecmwf_ifs"),
    ],
)
def test_meta_paths(sources, model_id, path):
    assert sources.meta_path(model_id) == path
