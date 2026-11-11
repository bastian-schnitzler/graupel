# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json
from pathlib import Path

import httpx
import pytest

from graupel_gen.output import DEFAULT_OUT_DIR
from graupel_gen.resolver import Resolver
from graupel_gen.sources import load_sources

DATA = DEFAULT_OUT_DIR
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Tests never reach the network; mocked transports still work."""

    def refuse(self, request):
        raise AssertionError(f"network request in a test: {request.url}")

    async def refuse_async(self, request):
        raise AssertionError(f"network request in a test: {request.url}")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)
    monkeypatch.setattr(
        httpx.AsyncHTTPTransport, "handle_async_request", refuse_async
    )


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def sources():
    return load_sources()


@pytest.fixture(scope="session")
def catalogue():
    return load("model_catalogue.json")["models"]


@pytest.fixture(scope="session")
def domains():
    return load("model_domains.json")["models"]


@pytest.fixture(scope="session")
def region_features():
    return load("regions.geojson")["features"]


@pytest.fixture(scope="session")
def resolver(catalogue, domains, region_features):
    return Resolver(catalogue, domains, region_features)
