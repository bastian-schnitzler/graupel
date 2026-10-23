"""Full run of dev-tools/update_catalog.py against recorded API answers.

The answers are rebuilt from the committed catalogue (the API is not
reachable from tests): a model delivers values for its catalogued
variables and its pressure levels, and its single run lasts its horizon.
"""

import asyncio
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "graupel" / "models" / "model_catalogue.json"
RUN = datetime(2026, 10, 23, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def update_catalog():
    spec = importlib.util.spec_from_file_location(
        "update_catalog", ROOT / "dev-tools" / "update_catalog.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _committed():
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


def _yaml_models(update_catalog):
    text = (ROOT / "dev-tools" / "forecast.yml").read_text(encoding="utf-8")
    return update_catalog.extract_models_enum(text)


def _recorded_api(update_catalog, catalogue, status=None, requests=None):
    """Mock transport answering like the API did for `catalogue`."""
    models = {m["id"]: m for m in catalogue}
    api_names = {
        q.api_name: q.id for q in update_catalog.PROBE_QUANTITIES
    }

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
        for name in params["hourly"].split(","):
            if name.startswith("cloud_cover_") and name.endswith("hPa"):
                level = int(name[len("cloud_cover_"):-3])
                has = level in model["pressure_levels_hpa"]
            else:
                has = api_names.get(name) in model["supported_variables"]
            hourly[name] = [1.0 if has else None] * len(times)
        return httpx.Response(200, json={"latitude": 50.0, "hourly": hourly})

    return httpx.MockTransport(handler)


def _run(update_catalog, existing, transport):
    async def go():
        async with httpx.AsyncClient(transport=transport) as client:
            return await update_catalog.build_catalog(
                _yaml_models(update_catalog), existing, client
            )

    return asyncio.run(go())


def test_full_run_reproduces_the_committed_catalogue(update_catalog):
    committed = _committed()
    transport = _recorded_api(update_catalog, committed)

    result = _run(update_catalog, committed, transport)

    assert len(result) == 50
    assert update_catalog.dump_catalogue(result) == CATALOGUE.read_text(
        encoding="utf-8"
    )


def test_probe_asks_for_every_downloadable_quantity(update_catalog):
    committed = _committed()
    requests = []
    transport = _recorded_api(update_catalog, committed, requests=requests)

    _run(update_catalog, committed[:1], transport)

    probe = next(
        r
        for r in requests
        if r.url.host == "api.open-meteo.com" and "hourly" in r.url.params
    )
    asked = probe.url.params["hourly"].split(",")
    for name in (
        "apparent_temperature",
        "snowfall",
        "snow_depth",
        "weather_code",
        "cloud_cover_975hPa",
        "cloud_cover_10hPa",
    ):
        assert name in asked


def test_failed_probe_keeps_the_entry(update_catalog):
    committed = _committed()
    transport = _recorded_api(
        update_catalog, committed, status={"icon_d2": 500}
    )
    changed = [dict(m) for m in committed]
    icon_d2 = next(m for m in changed if m["id"] == "icon_d2")
    icon_d2["supported_variables"] = ["temperature"]

    result = _run(update_catalog, changed, transport)

    assert next(m for m in result if m["id"] == "icon_d2") == icon_d2


def test_changed_probe_updates_only_probed_fields(update_catalog):
    committed = _committed()
    upstream = [dict(m) for m in committed]
    icon_eu = next(m for m in upstream if m["id"] == "icon_eu")
    icon_eu["supported_variables"] = icon_eu["supported_variables"] + [
        "lightning_potential"
    ]
    icon_eu["pressure_levels_hpa"] = [1000, 850, 500]
    transport = _recorded_api(update_catalog, upstream)

    result = _run(update_catalog, committed, transport)

    entry = next(m for m in result if m["id"] == "icon_eu")
    old = next(m for m in committed if m["id"] == "icon_eu")
    assert "lightning_potential" in entry["supported_variables"]
    assert entry["pressure_levels_hpa"] == [1000, 850, 500]
    for key in ("name", "provider", "region", "spatial_resolution_km"):
        assert entry[key] == old[key]
    others = [m for m in result if m["id"] != "icon_eu"]
    assert others == [m for m in committed if m["id"] != "icon_eu"]


def test_probe_retries_without_rejected_quantities(update_catalog):
    committed = _committed()
    inner = _recorded_api(update_catalog, committed)

    def handler(request):
        names = request.url.params.get("hourly", "").split(",")
        if "snowfall" in names and request.url.host == "api.open-meteo.com":
            return httpx.Response(400)
        return inner.handle_request(request)

    result = _run(update_catalog, committed, httpx.MockTransport(handler))

    assert result == committed
