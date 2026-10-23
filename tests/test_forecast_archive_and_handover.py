import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from graupel.data.models import Location, MeteogramConfig, WeatherModel
from graupel.data.open_meteo import OpenMeteoClient
from graupel.data.service import ForecastService, get_fetch_horizon
from graupel.data.storage import Storage
from graupel.data.timeline import canonical_timestamp, parse_timestamp


class GapClient(OpenMeteoClient):
    """Hourly temperature per model with optional null hours per model."""

    def __init__(self, gaps=None, offsets=None):
        super().__init__()
        self.calls = []
        self.gaps = gaps or {}
        self.offsets = offsets or {}

    async def _get(self, params):
        self.calls.append(dict(params))
        if "daily" in params:
            return {"daily": {"time": [], "sunrise": [], "sunset": []}}
        model = params["models"]
        now_hour = datetime.now(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        )
        start = now_hour - timedelta(hours=params["past_hours"])
        count = params["past_hours"] + params["forecast_hours"]
        times = [start + timedelta(hours=i) for i in range(count)]
        gap_hours = self.gaps.get(model, set())
        values = [
            None
            if int((t - now_hour).total_seconds() // 3600) in gap_hours
            else self.offsets.get(model, 0.0) + i
            for i, t in enumerate(times)
        ]
        hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
        for var in params["hourly"].split(","):
            hourly[var] = values
        return {
            "timezone": "GMT",
            "hourly": hourly,
            "hourly_units": {"temperature_2m": "°C"},
        }


def _config(models):
    return MeteogramConfig(
        name="Test",
        location=Location(name="Test", latitude=47.0, longitude=11.0),
        model_chain=models,
        cloud_model_chain=[],
    )


def test_fetch_horizon_covers_dragged_boundaries_up_to_capability():
    # Catalogue: ICON-D2 is capable of 48h.
    icon_d2 = WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=24)
    assert get_fetch_horizon(icon_d2, 120) == 48
    assert get_fetch_horizon(icon_d2, 30) == 30
    # Never shorter than the configured horizon.
    unknown = WeatherModel(name="Unknown Model", max_forecast_horizon_hours=72)
    assert get_fetch_horizon(unknown, 120) == 72


@pytest.mark.asyncio
async def test_every_api_response_is_archived_but_never_read(tmp_path):
    db_path = tmp_path / "graupel.db"
    storage = Storage(str(db_path))
    storage.update_settings({"archive_enabled": True})
    client = GapClient()
    service = ForecastService(client=client, storage=storage)
    cfg = _config(
        [
            WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=10),
            WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24),
        ]
    )

    await service.get_merged_forecast(cfg, variable="temperature")
    first_call_count = len(client.calls)
    client.offsets = {"icon_eu": 1000.0}
    second = await service.get_merged_forecast(cfg, variable="temperature")

    # The second request is a full live request served from the API.
    assert len(client.calls) == 2 * first_call_count
    assert any(
        p.value is not None and p.value >= 1000.0
        for p in second.model_forecasts["ICON-EU"]
    )

    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT request_kind, model, params, response FROM api_fetch_archive"
        ).fetchall()
    finally:
        conn.close()
        storage.close()

    assert len(rows) == len(client.calls)
    kinds = {row[0] for row in rows}
    assert {"forecast", "sun_phases"} <= kinds
    forecast_rows = [row for row in rows if row[0] == "forecast"]
    assert {row[1] for row in forecast_rows} == {"icon_d2", "icon_eu"}
    assert "hourly" in json.loads(forecast_rows[0][3])
    assert json.loads(forecast_rows[0][2])["models"] == forecast_rows[0][1]


@pytest.mark.asyncio
async def test_archive_failure_does_not_break_forecast():
    class BrokenStorage(Storage):
        def is_archive_enabled(self):
            return True

        def archive_api_response(self, *args, **kwargs):
            raise sqlite3.OperationalError("disk full")

    service = ForecastService(client=GapClient(), storage=BrokenStorage())
    result = await service.get_merged_forecast(
        _config([WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=12)]),
        variable="temperature",
    )
    assert any(p.value is not None for p in result.combined_forecast)


@pytest.mark.asyncio
async def test_earlier_model_never_fills_a_later_slice():
    # ICON-D2 is fetched beyond its configured 10h (for dragging); ICON-EU
    # misses hour 15. That hour must stay empty instead of using ICON-D2.
    client = GapClient(gaps={"icon_eu": {15}}, offsets={"icon_eu": 500.0})
    service = ForecastService(client=client)
    result = await service.get_merged_forecast(
        _config(
            [
                WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=10),
                WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24),
            ]
        ),
        variable="temperature",
    )

    t_now = parse_timestamp(result.forecast_start_time)
    gap_ts = canonical_timestamp(t_now + timedelta(hours=15))
    point = next(p for p in result.combined_forecast if p.timestamp == gap_ts)
    assert point.value is None
    assert point.model == "ICON-EU"
    # ICON-D2's own series still reaches into the dragged range.
    assert any(
        p.timestamp == gap_ts and p.value is not None
        for p in result.model_forecasts["ICON-D2"]
    )


@pytest.mark.asyncio
async def test_failing_cloud_model_only_drops_its_own_profiles():
    class CloudClient(GapClient):
        async def _get(self, params):
            if "cloud_cover_850hPa" in params.get("hourly", ""):
                if params["models"] == "icon_d2":
                    # Non-monotonic timestamps fail timeline validation.
                    return {
                        "hourly": {
                            "time": ["2026-10-06T01:00", "2026-10-06T00:00"]
                        }
                    }
                now_hour = datetime.now(timezone.utc).replace(
                    minute=0, second=0, microsecond=0
                )
                start = now_hour - timedelta(hours=params["past_hours"])
                count = params["past_hours"] + params["forecast_hours"]
                times = [start + timedelta(hours=i) for i in range(count)]
                hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
                for var in params["hourly"].split(","):
                    hourly[var] = [50.0] * count
                return {"hourly": hourly}
            return await super()._get(params)

    levels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400]
    cfg = MeteogramConfig(
        name="Clouds",
        location=Location(name="Test", latitude=47.0, longitude=11.0),
        model_chain=[
            WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24)
        ],
        cloud_model_chain=[
            WeatherModel(
                name="ICON-D2",
                id="icon_d2",
                max_forecast_horizon_hours=6,
                pressure_levels_hpa=levels,
            ),
            WeatherModel(
                name="ICON-EU",
                id="icon_eu",
                max_forecast_horizon_hours=24,
                pressure_levels_hpa=levels,
            ),
        ],
    )
    result = await ForecastService(client=CloudClient()).get_merged_forecast(
        cfg, variable="temperature"
    )

    assert result.vertical_cloud_forecast is not None
    assert result.vertical_cloud_model_forecasts["ICON-D2"].profiles == []
    assert len(result.vertical_cloud_model_forecasts["ICON-EU"].profiles) > 0
    sources = {p.source_model_name for p in result.vertical_cloud_forecast.profiles}
    assert sources == {"ICON-EU"}


@pytest.mark.asyncio
async def test_cloud_chain_hands_over_when_a_run_ends_before_its_horizon():
    # ICON-EU's run ends 3h before its configured 8h boundary (null rows,
    # like Open-Meteo); those hours must come from the next cloud model.
    run_end_hour = 5

    class RunEndClient(GapClient):
        async def _get(self, params):
            if "cloud_cover_850hPa" not in params.get("hourly", ""):
                return await super()._get(params)
            now_hour = datetime.now(timezone.utc).replace(
                minute=0, second=0, microsecond=0
            )
            start = now_hour - timedelta(hours=params["past_hours"])
            count = params["past_hours"] + params["forecast_hours"]
            times = [start + timedelta(hours=i) for i in range(count)]
            hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
            for var in params["hourly"].split(","):
                hourly[var] = [
                    None
                    if params["models"] == "icon_eu"
                    and t >= now_hour + timedelta(hours=run_end_hour)
                    else 40.0
                    for t in times
                ]
            return {"hourly": hourly}

    levels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400]
    cfg = MeteogramConfig(
        name="Clouds",
        location=Location(name="Test", latitude=47.0, longitude=11.0),
        model_chain=[
            WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=12)
        ],
        cloud_model_chain=[
            WeatherModel(
                name="ICON-EU",
                id="icon_eu",
                max_forecast_horizon_hours=8,
                pressure_levels_hpa=levels,
            ),
            WeatherModel(
                name="ECMWF IFS 0.25°",
                id="ecmwf_ifs025",
                max_forecast_horizon_hours=12,
                pressure_levels_hpa=levels,
            ),
        ],
    )
    result = await ForecastService(client=RunEndClient()).get_merged_forecast(
        cfg, variable="temperature"
    )

    t_now = parse_timestamp(result.forecast_start_time)
    by_ts = {
        p.timestamp: p.source_model_name
        for p in result.vertical_cloud_forecast.profiles
    }
    hour = lambda h: canonical_timestamp(t_now + timedelta(hours=h))  # noqa: E731
    assert by_ts[hour(run_end_hour - 1)] == "ICON-EU"
    for h in range(run_end_hour, 12):
        assert by_ts[hour(h)] == "ECMWF IFS 0.25°"
    assert [
        (t.from_model, t.to_model) for t in result.vertical_cloud_transitions
    ] == [("icon_eu", "ecmwf_ifs025")]
    assert result.vertical_cloud_transitions[0].timestamp == hour(run_end_hour)


class RunEndMainClient(GapClient):
    """ICON-EU's latest run ends 3h before its configured 10h horizon."""

    async def _get(self, params):
        response = await super()._get(params)
        if params.get("models") == "icon_eu" and "hourly" in response:
            now_hour = datetime.now(timezone.utc).replace(
                minute=0, second=0, microsecond=0
            )
            times = response["hourly"]["time"]
            for var, values in response["hourly"].items():
                if var == "time":
                    continue
                response["hourly"][var] = [
                    None
                    if parse_timestamp(t) >= now_hour + timedelta(hours=7)
                    else v
                    for t, v in zip(times, values)
                ]
        return response

    async def fetch_model_metadata(self, model_id):
        if model_id == "icon_eu":
            # 2026-10-06T09:00Z init, available 11:58:41Z
            return {
                "last_run_initialisation_time": 1791277200,
                "last_run_availability_time": 1791287921,
            }
        return {}


def _run_end_config():
    return _config(
        [
            WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=10),
            WeatherModel(name="ECMWF IFS", id="ecmwf_ifs", max_forecast_horizon_hours=20),
        ]
    )


@pytest.mark.asyncio
async def test_chain_is_capped_to_hours_delivered_by_the_latest_run(tmp_path):
    db_path = tmp_path / "graupel.db"
    storage = Storage(str(db_path))
    storage.update_settings({"archive_enabled": True})
    service = ForecastService(client=RunEndMainClient(), storage=storage)
    result = await service.get_merged_forecast(_run_end_config(), variable="temperature")

    t_now = parse_timestamp(result.forecast_start_time)
    icon = result.model_availability["ICON-EU"]
    assert icon.available_hours == 7
    assert icon.valid_until == canonical_timestamp(t_now + timedelta(hours=7))
    assert icon.last_run_init_time == "2026-10-06T09:00:00Z"
    assert icon.last_run_availability_time == "2026-10-06T11:58:41Z"
    # ECMWF delivers its whole fetched window: no cap.
    assert result.model_availability["ECMWF IFS"].available_hours is None

    # The boundary moves to +7h: ECMWF fills 7h..20h, ICON-EU never shows nulls.
    at = {p.timestamp: p for p in result.combined_forecast}
    for h in range(0, 7):
        point = at[canonical_timestamp(t_now + timedelta(hours=h))]
        assert point.model == "ICON-EU" and point.value is not None
    for h in range(7, 20):
        assert at[canonical_timestamp(t_now + timedelta(hours=h))].model == "ECMWF IFS"

    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT chain, model, available_hours, last_run_init_time "
            "FROM model_run_availability ORDER BY model"
        ).fetchall()
        meta_rows = conn.execute(
            "SELECT model FROM api_fetch_archive WHERE request_kind = 'model_meta'"
        ).fetchall()
    finally:
        conn.close()
        storage.close()
    assert ("main", "ICON-EU", 7, "2026-10-06T09:00:00Z") in rows
    assert ("main", "ECMWF IFS", None, None) in rows
    assert meta_rows == [("icon_eu",)]


class EnsembleOutlastsMainRunClient(GapClient):
    """ICON-EU main run ends at +7h; its ensemble probability runs on."""

    async def _get(self, params):
        response = await super()._get(params)
        if params.get("models") == "icon_eu" and "hourly" in response:
            now_hour = datetime.now(timezone.utc).replace(
                minute=0, second=0, microsecond=0
            )
            times = response["hourly"]["time"]
            for var, values in response["hourly"].items():
                if var in ("time", "precipitation_probability"):
                    continue
                response["hourly"][var] = [
                    None
                    if parse_timestamp(t) >= now_hour + timedelta(hours=7)
                    else v
                    for t, v in zip(times, values)
                ]
        return response


@pytest.mark.asyncio
async def test_ensemble_probability_does_not_extend_the_main_run(tmp_path):
    storage = Storage(str(tmp_path / "graupel.db"))
    service = ForecastService(
        client=EnsembleOutlastsMainRunClient(), storage=storage
    )
    try:
        result = await service.get_merged_forecast(
            _run_end_config(),
            variables=["temperature", "precipitation_probability"],
        )
    finally:
        storage.close()

    t_now = parse_timestamp(result.forecast_start_time)
    icon = result.model_availability["ICON-EU"]
    # The boundary follows the main run (+7h), not the probability (+10h).
    assert icon.available_hours == 7
    at = {
        (p.timestamp, p.variable): p for p in result.combined_forecast
    }
    after = canonical_timestamp(t_now + timedelta(hours=7))
    assert at[(after, "temperature")].model == "ECMWF IFS"
    assert at[(after, "temperature")].value is not None


@pytest.mark.asyncio
async def test_missing_hours_inside_a_slice_are_not_filled_from_other_models():
    # ICON-EU has data until +10h but misses hour 3: it stays empty.
    client = GapClient(gaps={"icon_eu": {3}})
    result = await ForecastService(client=client).get_merged_forecast(
        _run_end_config(), variable="temperature"
    )
    t_now = parse_timestamp(result.forecast_start_time)
    gap = canonical_timestamp(t_now + timedelta(hours=3))
    point = next(p for p in result.combined_forecast if p.timestamp == gap)
    assert point.model == "ICON-EU"
    assert point.value is None


@pytest.mark.asyncio
async def test_mixed_runs_are_split_into_run_segments(tmp_path):
    """Newest run ends after 5h; the older run delivers the rest."""
    now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    newest_init = now_hour - timedelta(hours=2)
    older_init = newest_init - timedelta(hours=6)

    class MixedRunsClient(GapClient):
        def __init__(self):
            super().__init__()
            self.single_runs = []

        async def fetch_model_metadata(self, model_id):
            if model_id != "ecmwf_ifs":
                return {}
            return {
                "last_run_initialisation_time": int(newest_init.timestamp()),
                "data_end_time": int((now_hour + timedelta(hours=5)).timestamp()),
                "update_interval_seconds": 21600,
            }

        async def fetch_single_run(self, model_id, run, latitude, longitude, forecast_hours):
            self.single_runs.append(run)
            start = parse_timestamp(run + ":00Z")
            times = [start + timedelta(hours=i) for i in range(forecast_hours)]
            return {
                "hourly": {
                    "time": [t.strftime("%Y-%m-%dT%H:%M") for t in times],
                    "temperature_2m": [1.0] * len(times),
                }
            }

    db_path = tmp_path / "graupel.db"
    storage = Storage(str(db_path))
    storage.update_settings({"archive_enabled": True})
    client = MixedRunsClient()
    cfg = _config(
        [WeatherModel(name="ECMWF IFS", id="ecmwf_ifs", max_forecast_horizon_hours=20)]
    )
    result = await ForecastService(client=client, storage=storage).get_merged_forecast(
        cfg, variable="temperature"
    )

    info = result.model_availability["ECMWF IFS"]
    boundary = canonical_timestamp(now_hour + timedelta(hours=5))
    assert [s.model_dump() for s in info.run_segments] == [
        {
            "run_init_time": canonical_timestamp(newest_init),
            "valid_from": None,
            "valid_until": boundary,
            "run_length_hours": 6,
        },
        {
            "run_init_time": canonical_timestamp(older_init),
            "valid_from": boundary,
            "valid_until": None,
            # The stub run covers the requested hours through hour 20 + 8.
            "run_length_hours": 28,
        },
    ]
    assert info.data_end_run_init_time == canonical_timestamp(older_init)
    assert client.single_runs == [older_init.strftime("%Y-%m-%dT%H:%M")]

    conn = sqlite3.connect(db_path)
    try:
        stored = conn.execute(
            "SELECT run_segments, data_end_run_init_time FROM model_run_availability"
        ).fetchone()
    finally:
        conn.close()
        storage.close()
    assert len(json.loads(stored[0])) == 2
    assert stored[1] == canonical_timestamp(older_init)


class LaggingMetadataClient(GapClient):
    """meta.json names a run 5h ago that may not explain the served data."""

    def __init__(self, published_runs, meta_run_hours):
        super().__init__()
        self.now_hour = datetime.now(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        )
        self.meta_init = self.now_hour - timedelta(hours=5)
        self.meta_run_hours = meta_run_hours
        self.published = published_runs
        self.single_runs = []

    async def fetch_model_metadata(self, model_id):
        if model_id != "icon_eu":
            return {}
        return {
            "last_run_initialisation_time": int(self.meta_init.timestamp()),
            "last_run_availability_time": int(self.meta_init.timestamp()),
            "data_end_time": int(
                (
                    self.meta_init + timedelta(hours=self.meta_run_hours)
                ).timestamp()
            ),
            "update_interval_seconds": 10800,
        }

    async def fetch_single_run(
        self, model_id, run, latitude, longitude, forecast_hours
    ):
        self.single_runs.append(run)
        start = parse_timestamp(run + ":00Z")
        if start not in self.published:
            raise RuntimeError("400 Bad Request: run not available")
        times = [start + timedelta(hours=i) for i in range(121)]
        return {
            "hourly": {
                "time": [t.strftime("%Y-%m-%dT%H:%M") for t in times],
                "temperature_2m": [1.0] * len(times),
            }
        }


async def _icon_eu_run_info(client, tmp_path):
    storage = Storage(str(tmp_path / "graupel.db"))
    try:
        result = await ForecastService(
            client=client, storage=storage
        ).get_merged_forecast(_run_end_config(), variable="temperature")
    finally:
        storage.close()
    return result.model_availability["ICON-EU"]


@pytest.mark.asyncio
async def test_consistent_metadata_needs_no_extra_run_requests(tmp_path):
    # The metadata run (31h) reaches beyond the served data: nothing to probe.
    client = LaggingMetadataClient(published_runs=set(), meta_run_hours=31)
    icon = await _icon_eu_run_info(client, tmp_path)
    assert client.single_runs == []
    assert icon.last_run_init_time == canonical_timestamp(client.meta_init)


@pytest.mark.asyncio
async def test_newer_run_is_probed_when_metadata_cannot_explain_the_data(
    tmp_path,
):
    now_hour = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    newer = now_hour - timedelta(hours=2)
    # The metadata run ends after 3h, no older run covers the rest, yet data
    # is served: a newer run must exist.
    client = LaggingMetadataClient(published_runs={newer}, meta_run_hours=3)
    icon = await _icon_eu_run_info(client, tmp_path)

    assert icon.last_run_init_time == canonical_timestamp(newer)
    # Availability time of a run the metadata does not list is unknown.
    assert icon.last_run_availability_time is None
    # The newer 120h run covers the whole series: one segment.
    assert [s.run_init_time for s in icon.run_segments] == [
        canonical_timestamp(newer)
    ]
    assert icon.run_segments[0].run_length_hours == 120
    # Probing forward stops before the next init time, which is in the future.
    newer_label = newer.strftime("%Y-%m-%dT%H:%M")
    assert client.single_runs[-1] == newer_label
    assert client.single_runs.count(newer_label) == 1


@pytest.mark.asyncio
async def test_metadata_run_is_kept_when_no_newer_run_is_published(tmp_path):
    client = LaggingMetadataClient(published_runs=set(), meta_run_hours=3)
    icon = await _icon_eu_run_info(client, tmp_path)
    assert icon.last_run_init_time == canonical_timestamp(client.meta_init)
    assert icon.last_run_availability_time == canonical_timestamp(
        client.meta_init
    )


@pytest.mark.asyncio
async def test_probability_end_and_ensemble_run_are_reported(tmp_path):
    """The ensemble behind the probability lags: probability ends at +6h."""
    now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ensemble_init = now_hour - timedelta(hours=10)

    class LaggingEnsembleClient(GapClient):
        def __init__(self):
            super().__init__()
            self.ensemble_requests = []

        async def _get(self, params):
            response = await super()._get(params)
            hourly = response.get("hourly", {})
            if "precipitation_probability" in hourly:
                hourly["precipitation_probability"] = [
                    None if parse_timestamp(t) >= now_hour + timedelta(hours=6) else v
                    for t, v in zip(hourly["time"], hourly["precipitation_probability"])
                ]
            return response

        async def fetch_ensemble_metadata(self, model_id):
            self.ensemble_requests.append(model_id)
            return {
                "last_run_initialisation_time": int(ensemble_init.timestamp()),
                "last_run_availability_time": int(now_hour.timestamp()),
                "data_end_time": int((now_hour + timedelta(hours=6)).timestamp()),
                "update_interval_seconds": 21600,
            }

    db_path = tmp_path / "graupel.db"
    storage = Storage(str(db_path))
    storage.update_settings({"archive_enabled": True})
    client = LaggingEnsembleClient()
    result = await ForecastService(client=client, storage=storage).get_merged_forecast(
        _run_end_config(), variables=["temperature", "precipitation_probability"]
    )

    icon = result.model_availability["ICON-EU"]
    assert icon.probability_valid_until == canonical_timestamp(
        now_hour + timedelta(hours=6)
    )
    assert icon.available_hours is None  # temperature still reaches +10h
    assert icon.ensemble is not None
    assert icon.ensemble.model_dump() == {
        "model_id": "dwd_icon_eu_eps_native",
        "run_init_time": canonical_timestamp(ensemble_init),
        "run_availability_time": canonical_timestamp(now_hour),
        "data_end_time": canonical_timestamp(now_hour + timedelta(hours=6)),
        "update_interval_hours": 6.0,
    }
    assert result.model_availability["ECMWF IFS"].ensemble.model_id == (
        "ecmwf_ifs025_ensemble"
    )
    # One metadata request per model, each archived.
    assert sorted(client.ensemble_requests) == ["ecmwf_ifs", "icon_eu"]
    conn = sqlite3.connect(db_path)
    try:
        archived = conn.execute(
            "SELECT model FROM api_fetch_archive "
            "WHERE request_kind = 'ensemble_meta' ORDER BY model"
        ).fetchall()
    finally:
        conn.close()
        storage.close()
    assert archived == [("dwd_icon_eu_eps_native",), ("ecmwf_ifs025_ensemble",)]


def test_ensemble_meta_path_names_the_probability_source():
    from graupel.data.open_meteo import ensemble_meta_path

    assert ensemble_meta_path("meteoswiss_icon_ch2") == "meteoswiss_icon_ch2_ensemble"
    assert ensemble_meta_path("ECMWF_IFS") == "ecmwf_ifs025_ensemble"
    assert ensemble_meta_path("ncep_gfs_global") == "ncep_gefs05"
    assert ensemble_meta_path("meteofrance_arome_france") is None


@pytest.mark.asyncio
async def test_backward_run_search_stops_at_a_longest_length_run(tmp_path):
    now_hour = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    meta_init = now_hour - timedelta(hours=5)
    older = meta_init - timedelta(hours=3)
    # Every older run would be published with ICON-EU's longest length.
    client = LaggingMetadataClient(
        published_runs={meta_init - timedelta(hours=3 * k) for k in range(1, 9)},
        meta_run_hours=3,
    )
    storage = Storage(str(tmp_path / "graupel.db"))
    try:
        segments, covered_end = await ForecastService(
            client=client, storage=storage
        )._build_run_segments(
            "icon_eu",
            {
                "init_epoch": int(meta_init.timestamp()),
                "data_end_epoch": int(
                    (meta_init + timedelta(hours=3)).timestamp()
                ),
                "interval_seconds": 10800,
            },
            now_hour + timedelta(hours=300),
            Location(name="Test", latitude=47.0, longitude=11.0),
        )
    finally:
        storage.close()

    # The first older run is 120h long: no earlier run can reach further.
    assert client.single_runs == [older.strftime("%Y-%m-%dT%H:%M")]
    assert [s.run_init_time for s in segments] == [
        canonical_timestamp(meta_init),
        canonical_timestamp(older),
    ]
    assert covered_end == older + timedelta(hours=121)
