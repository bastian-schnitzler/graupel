# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Model domains: the committed data and the generator (mocked API)."""

import math

import httpx
import pytest
from shapely.geometry import Point, Polygon

from graupel_gen import domains as gen
from graupel_gen.http import RateLimiter
from graupel_gen.resolver import domain_contains, parse_domains, point_in_ring

LCC_WKT = (
    'PROJCRS["Lambert Conic Conformal",BASEGEOGCRS["GCS_Sphere",'
    'DATUM["D_Sphere",ELLIPSOID["Sphere",6371229,0]],'
    'UNIT["Degree",0.0174532925199433]],CONVERSION["Lambert Conic Conformal",'
    'METHOD["Lambert Conic Conformal (2SP)"],'
    'PARAMETER["Latitude of false origin",38.5],'
    'PARAMETER["Longitude of false origin",-97.5],'
    'PARAMETER["Latitude of 1st standard parallel",38.5],'
    'PARAMETER["Latitude of 2nd standard parallel",38.5]],'
    'CS[Cartesian,2],AXIS["easting",east],AXIS["northing",north],'
    'USAGE[SCOPE["grid"],BBOX[21.138,-122.72,47.84,-60.92]]]'
)
LATLON_WKT = (
    'GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",'
    'ELLIPSOID["WGS 84",6378137,298.257223563]],CS[ellipsoidal,2],'
    'USAGE[SCOPE["grid"],BBOX[{lat0},{lon0},{lat1},{lon1}]]]'
)


@pytest.fixture
def parsed(domains):
    return parse_domains(domains)


# --- committed data --------------------------------------------------------


def test_every_catalogue_model_has_a_domain(catalogue, domains):
    assert set(domains) == {m["id"] for m in catalogue}


def test_domain_entries_have_the_documented_shape(domains):
    for model_id, entry in domains.items():
        if entry == "global":
            continue
        assert entry["source"] in ("grid", "measured"), model_id
        ring = entry["polygon"]
        assert ring[0] == ring[-1] and len(ring) >= 4, model_id
        assert all(-90 <= lat <= 90 for _, lat in ring), model_id


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
        ("geosphere_claef_austria", 46.9655, 11.0076),  # Sölden
        ("geosphere_claef_austria", 50.08, 14.43),  # Praha
        ("meteoswiss_icon_ch1", 45.977, 7.659),  # Matterhorn
        ("italia_meteo_arpae_icon_2i", 46.508, 10.542),  # Ortler
        ("ukmo_uk_deterministic_2km", 51.507, -0.128),  # London
        ("metno_nordic", 59.913, 10.752),  # Oslo
        ("ncep_hrrr_conus", 40.713, -74.006),  # New York
        ("ncep_rrfs_conus", 40.713, -74.006),  # New York
        ("ncep_rrfs_conus", 41.878, -87.630),  # Chicago
        ("ncep_rrfs_conus", 39.739, -104.990),  # Denver
        ("ncep_rrfs_conus", 25.762, -80.192),  # Miami
        ("cmc_gem_hrdps", 45.501, -73.567),  # Montreal
        ("cmc_gem_rdps", 64.838, -147.716),  # Fairbanks
        ("jma_msm", 35.690, 139.692),  # Tokyo
    ],
)
def test_regional_models_cover_their_home(parsed, model_id, lat, lon):
    assert domain_contains(parsed, model_id, lat, lon, margin_deg=0.3)


@pytest.mark.parametrize(
    "model_id, lat, lon",
    [
        ("icon_d2", 40.416, -3.704),  # Madrid
        ("meteofrance_arome_france", 52.520, 21.0),  # Warsaw
        ("geosphere_arome_austria", 41.902, 12.496),  # Rome
        ("geosphere_claef_austria", 41.902, 12.496),  # Rome
        ("ncep_hrrr_conus", 19.433, -99.133),  # Mexico City
        ("ncep_rrfs_conus", 19.433, -99.133),  # Mexico City
        ("jma_msm", 13.756, 100.502),  # Bangkok
    ],
)
def test_regional_models_end_at_their_domain(parsed, model_id, lat, lon):
    assert domain_contains(parsed, model_id, lat, lon) is False


def test_south_atlantic_is_only_in_global_models(parsed):
    hits = {m for m in parsed if domain_contains(parsed, m, -30.0, -20.0)}
    assert hits == {m for m, d in parsed.items() if d == "global"}
    assert "ecmwf_ifs" in hits and "ecmwf_ifs025" in hits


def test_rdps_reaches_the_mid_atlantic(parsed):
    # Measured: the API delivers RDPS at 40 N 35 W; the mid-Atlantic
    # global-fallback point is a resolver case, not a domain one.
    assert domain_contains(parsed, "cmc_gem_rdps", 40.0, -35.0)


def test_rdps_closes_over_the_north_pole(parsed, domains):
    # The 5° strip between the first and last boundary point (43.5-48.6 W,
    # central Greenland, Labrador Sea) belongs to RDPS (REQ-441).
    assert domain_contains(parsed, "cmc_gem_rdps", 72.0, -46.0)
    assert domain_contains(parsed, "cmc_gem_rdps", 89.5, -46.0)
    assert domain_contains(parsed, "cmc_gem_rdps", 85.0, 120.0)
    assert Polygon(domains["cmc_gem_rdps"]["polygon"]).is_valid


def test_polygons_around_a_pole_span_360_degrees(domains):
    polar = 0
    for model, entry in domains.items():
        if isinstance(entry, str):
            continue
        polygon = entry["polygon"]
        assert gen.close_polar_polygon(polygon) == polygon, model
        cap = [lon for lon, lat in polygon if abs(lat) == 90]
        if cap:
            polar += 1
            assert max(cap) - min(cap) == pytest.approx(360.0), model
    assert polar == 1


def test_margin_keeps_points_away_from_the_edge(parsed):
    east = 10.0
    while domain_contains(parsed, "icon_d2", 50.0, east + 0.01):
        east += 0.01
    assert domain_contains(parsed, "icon_d2", 50.0, east - 0.1)
    assert not domain_contains(
        parsed, "icon_d2", 50.0, east - 0.1, margin_deg=0.5
    )


def test_unknown_model_has_no_domain(parsed):
    assert domain_contains(parsed, "no_such_model", 0.0, 0.0) is None


# --- grid from crs_wkt -----------------------------------------------------


def test_proj_string_of_a_lambert_grid():
    ps = gen.proj_string(LCC_WKT)
    assert ps.startswith("+proj=lcc +lat_1=38.5 +lat_2=38.5 +lat_0=38.5")
    assert gen.proj_string(LATLON_WKT) is None


def test_unsupported_projection_is_an_error():
    with pytest.raises(gen.DomainError):
        gen.proj_string('METHOD["Mercator"]')


def test_lambert_grid_corners_round_trip():
    grid = gen.Grid(LCC_WKT)
    assert grid.metric and not grid.geographic and not grid.is_global()
    x0, y0, x1, y1 = grid.rect
    lon, lat = grid.inverse(x0, y0)
    assert lon == pytest.approx(-122.72, abs=1e-6)
    assert lat == pytest.approx(21.138, abs=1e-6)
    ring = Polygon(grid.ring(grid.rect))
    assert ring.is_valid
    assert ring.contains(Point(-97.5, 38.5))
    assert not ring.contains(Point(-97.5, 60.0))
    assert not ring.contains(Point(-97.5, 15.0))


def test_global_and_regional_lonlat_grids():
    world = LATLON_WKT.format(lat0=-90, lon0=-180, lat1=90, lon1=179.9)
    assert gen.Grid(world).is_global()
    europe = gen.Grid(LATLON_WKT.format(lat0=43, lon0=-4, lat1=56, lon1=20))
    assert not europe.is_global()
    assert europe.rect == (-4.0, 43.0, 20.0, 56.0)
    probes = europe.edge_probes(europe.rect)
    assert len(probes) == 24
    assert {expected for expected, _, _ in probes} == {True, False}


def test_ring_across_the_antimeridian_is_not_split():
    grid = gen.Grid(LATLON_WKT.format(lat0=40, lon0=170, lat1=60, lon1=-170))
    ring = grid.ring((170.0, 40.0, 190.0, 60.0), n=10)
    lons = [lon for lon, _ in ring]
    assert max(lons) - min(lons) == pytest.approx(20.0)


def _rays_around_the_pole(n=48, start=-43.5):
    lons = [start + 360 * k / n for k in range(n)]
    lats = [60 + 10 * math.sin(math.radians(4 * x)) for x in lons]
    return lons, [round(y, 3) for y in lats]


def test_ring_around_a_pole_spans_exactly_360_degrees():
    lons, lats = _rays_around_the_pole()
    ring = gen.close_ring(lons, lats)
    boundary = [p for p in ring if abs(p[1]) != 90]
    assert boundary[-1] == pytest.approx((lons[0] + 360, lats[0]))
    assert ring[-2:] == [(lons[0] + 360, 90.0), (lons[0], 90.0)]
    poly = Polygon(ring)
    assert poly.is_valid
    # Every meridian crosses the domain north of its boundary.
    for lon in range(-180, 180, 5):
        x = lon if lon >= lons[0] else lon + 360
        assert poly.contains(Point(x, 85.0)), lon
    # Also with the boundary walked westwards and around the South Pole.
    south = gen.close_ring(lons[::-1], [-y for y in lats[::-1]])
    assert south[-2][1] == south[-1][1] == -90.0
    assert abs(south[-2][0] - south[-1][0]) == pytest.approx(360.0)
    assert Polygon(south).is_valid


def test_ring_not_around_a_pole_is_left_open():
    lons, lats = [0.0, 10.0, 10.0, 0.0], [40.0, 40.0, 50.0, 50.0]
    assert gen.close_ring(lons, lats) == list(zip(lons, lats))


def test_stored_polar_polygon_is_closed_again():
    # As stored before REQ-441: the last boundary step was missing.
    lons, lats = _rays_around_the_pole(n=12)
    old = [[x, y] for x, y in zip(lons, lats)]
    old += [[lons[-1], 90.0], [lons[0], 90.0], old[0]]
    fixed = gen.close_polar_polygon(old)
    assert fixed[-4:] == [
        [lons[0] + 360, lats[0]],
        [lons[0] + 360, 90.0],
        [lons[0], 90.0],
        [lons[0], lats[0]],
    ]
    assert gen.close_polar_polygon(fixed) == fixed
    # Starting at the pole vertices changes nothing.
    rotated = old[-3:-1] + old[:-3] + [old[-3]]
    assert Polygon(gen.close_polar_polygon(rotated)).equals(Polygon(fixed))
    regional = [[0.0, 40.0], [10.0, 40.0], [10.0, 50.0], [0.0, 40.0]]
    assert gen.close_polar_polygon(regional) == regional
    domains = gen.close_polar_domains(
        {"a": "global", "b": {"source": "measured", "polygon": old}}
    )
    assert domains["a"] == "global"
    assert domains["b"] == {"source": "measured", "polygon": fixed}


# --- resolve (mocked has_data) ---------------------------------------------


def _meta_for(wkt):
    return lambda path: {"crs_wkt": wkt}


def test_grid_domain_when_the_edges_agree(sources):
    wkt = LATLON_WKT.format(lat0=43, lon0=-4, lat1=56, lon1=20)
    box = Polygon([(-4, 43), (20, 43), (20, 56), (-4, 56)])

    def has_data(model, lat, lon):
        return box.contains(Point(lon, lat))

    entry = gen.resolve("icon_d2", {}, sources, has_data, _meta_for(wkt))
    assert entry["source"] == "grid"
    poly = Polygon(entry["polygon"])
    assert poly.area == pytest.approx(box.area, rel=0.01)


def test_measured_domain_when_the_edges_disagree(sources):
    wkt = LATLON_WKT.format(lat0=43, lon0=-4, lat1=56, lon1=20)
    # Data only in a disc around the grid centre (like an ICON native grid).
    disc = Point(8.0, 49.5).buffer(5.0)
    calls = []

    def has_data(model, lat, lon):
        calls.append((lat, lon))
        return disc.contains(Point(lon, lat))

    entry = gen.resolve("icon_d2", {}, sources, has_data, _meta_for(wkt))
    assert entry["source"] == "measured"
    poly = Polygon(entry["polygon"])
    assert poly.is_valid
    assert poly.area == pytest.approx(disc.area, rel=0.05)
    assert len(calls) < 2000


def test_global_grid_and_blends(sources):
    world = LATLON_WKT.format(lat0=-90, lon0=-180, lat1=90, lon1=180)
    assert (
        gen.resolve(
            "ecmwf_ifs", {}, sources, lambda *a: True, _meta_for(world)
        )
        == "global"
    )
    no_meta = lambda path: None  # noqa: E731
    assert (
        gen.resolve("icon_seamless", {}, sources, lambda *a: True, no_meta)
        == "global"
    )
    done = {"meteoswiss_icon_ch2": {"source": "grid", "polygon": [[0, 0]]}}
    assert (
        gen.resolve(
            "meteoswiss_icon_seamless", done, sources, lambda *a: False, no_meta
        )
        is done["meteoswiss_icon_ch2"]
    )
    with pytest.raises(gen.DomainError):
        gen.resolve("knmi_seamless", {}, sources, lambda *a: False, no_meta)


def test_build_domains_keeps_finished_models_on_error(sources):
    wkt = LATLON_WKT.format(lat0=43, lon0=-4, lat1=56, lon1=20)
    box = Polygon([(-4, 43), (20, 43), (20, 56), (-4, 56)])
    existing = {"icon_eu": "old", "jma_msm": "old"}

    def has_data(model, lat, lon):
        if model == "icon_eu":
            raise gen.DomainError("no answer")
        return box.contains(Point(lon, lat))

    result, error = gen.build_domains(
        ["icon_d2", "icon_eu", "jma_msm"],
        existing,
        sources,
        has_data,
        _meta_for(wkt),
    )
    assert isinstance(error, gen.DomainError)
    assert result["icon_d2"]["source"] == "grid"
    assert result["icon_eu"] == "old" and result["jma_msm"] == "old"


def test_build_domains_only_derives_the_given_models(sources):
    existing = {"icon_d2": "old", "icon_eu": "old"}

    def fail(*args):
        raise AssertionError("not asked")

    world = LATLON_WKT.format(lat0=-90, lon0=-180, lat1=90, lon1=180)
    result, error = gen.build_domains(
        ["icon_d2", "icon_eu", "ecmwf_ifs"],
        existing,
        sources,
        fail,
        _meta_for(world),
        only=["ecmwf_ifs"],
    )
    assert error is None
    assert result == {
        "ecmwf_ifs": "global",
        "icon_d2": "old",
        "icon_eu": "old",
    }


# --- API probe ---------------------------------------------------------------


def _probe(handler, sleeps):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return gen.ApiProbe(
        client, RateLimiter(None), max_attempts=4, sleep=sleeps.append
    )


def test_only_the_no_data_answer_counts_as_outside():
    sleeps = []

    def handler(request):
        lat = float(request.url.params["latitude"])
        if lat > 50:
            return httpx.Response(
                400,
                json={
                    "error": True,
                    "reason": "No data is available for this location",
                },
            )
        if lat < 0:
            return httpx.Response(
                400, json={"error": True, "reason": "Parameter invalid"}
            )
        return httpx.Response(200, json={"hourly": {"time": []}})

    probe = _probe(handler, sleeps)
    assert probe.has_data("icon_d2", 48.0, 11.0) is True
    assert probe.has_data("icon_d2", 60.0, 11.0) is False
    assert probe.has_data("icon_d2", 90.0, 11.0) is False  # never asked
    with pytest.raises(gen.DomainError, match="Parameter invalid"):
        probe.has_data("icon_d2", -10.0, 11.0)
    assert sleeps == []


def test_rate_limits_are_retried_a_bounded_number_of_times():
    sleeps = []
    answers = iter([429, 503, 200])

    def handler(request):
        status = next(answers)
        if status == 200:
            return httpx.Response(200, json={"hourly": {}})
        return httpx.Response(status)

    assert _probe(handler, sleeps).has_data("icon_d2", 48.0, 11.0)
    assert len(sleeps) == 2

    sleeps.clear()
    probe = _probe(lambda request: httpx.Response(429), sleeps)
    with pytest.raises(gen.DomainError, match="no answer"):
        probe.has_data("icon_d2", 48.0, 11.0)
    assert len(sleeps) == 4
    assert max(sleeps) <= 60.0


def test_fetch_meta_returns_none_for_unknown_paths():
    def handler(request):
        if "dwd_icon_d2" in request.url.path:
            return httpx.Response(200, json={"crs_wkt": "x"})
        return httpx.Response(404)

    probe = _probe(handler, [])
    assert probe.fetch_meta("dwd_icon_d2") == {"crs_wkt": "x"}
    assert probe.fetch_meta("nothing") is None
