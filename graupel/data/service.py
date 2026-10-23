from datetime import datetime, timezone, timedelta, tzinfo
from typing import List, Dict, Any, Optional, Tuple

from .models import (
    AutoChainInfo,
    MeteogramConfig,
    Location,
    WeatherModel,
    RawForecastData,
    DataPoint,
    HarmonizedForecastResponse,
    VerticalCloudLevel,
    VerticalCloudProfile,
    DetailedCloudForecast,
    EnsembleRunInfo,
    VerticalCloudTransition,
    SunPeriod,
    VariableTimelineCoverage,
    ModelTimelineDiagnostics,
    ModelAvailability,
    RunSegment,
)
from .open_meteo import (
    VARIABLE_TO_OPENMETEO,
    OpenMeteoClient,
    to_open_meteo_model,
    get_model_catalog,
    resolve_vertical_cloud_source,
    ensemble_meta_path,
)
from .harmonizer import Harmonizer
from .quantities import (
    QUANTITIES,
    fetch_set,
    main_run_excluded_quantities,
    optional_quantities,
    requested_from_model,
)
from .storage import Storage
from .timeline import (
    HOUR,
    build_hourly_timeline,
    canonical_timestamp,
    get_user_timezone,
    get_user_timezone_name,
    model_end_timestamp,
    parse_timestamp,
    validate_timestamp_sequence,
)

# Hours requested when probing a run newer than the model metadata names.
SINGLE_RUN_PROBE_HOURS = 400

DEFAULT_PRESSURE_LEVELS = [
    1000,
    950,
    925,
    900,
    850,
    800,
    700,
    600,
    500,
    400,
    300,
    250,
    200,
    150,
    100,
]


def estimate_altitude_m_asl(pressure_hpa: float) -> float:
    """Estimates altitude in meters ASL from pressure using the standard barometric formula."""
    return round(44330.0 * (1.0 - (pressure_hpa / 1013.25) ** 0.1903), 1)


import math


def get_local_tz(location: Location) -> timezone:
    """Resolve tzinfo for a location based on its timezone or longitude offset."""
    tz_str = getattr(location, "timezone", None)
    if tz_str and tz_str != "auto":
        try:
            from .timeline import resolve_timezone

            return resolve_timezone(tz_str)
        except Exception:
            pass

    if getattr(location, "longitude", None) is not None:
        approx_offset_hours = round(location.longitude / 15.0)
        return timezone(timedelta(hours=approx_offset_hours))

    return timezone.utc


def get_local_now(location: Location) -> datetime:
    """Resolve current local time for a location based on its timezone or longitude offset."""
    loc_tz = get_local_tz(location)
    return datetime.now(loc_tz)


def get_yesterday_midnight_utc(
    location: Optional[Location] = None,
    reference_time: Optional[datetime] = None,
    target_tz: Optional[tzinfo] = None,
) -> datetime:
    """Return the aware UTC datetime corresponding to 00:00 local time of the previous calendar day."""
    if reference_time is None:
        reference_time = datetime.now(timezone.utc)

    if target_tz is not None:
        loc_tz = target_tz
    elif (
        location is not None
        and getattr(location, "timezone", None)
        and location.timezone != "auto"
    ):
        loc_tz = get_local_tz(location)
    else:
        loc_tz = get_user_timezone()

    now_local = reference_time.astimezone(loc_tz)
    today_midnight_local = now_local.replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    yesterday_date = today_midnight_local.date() - timedelta(days=1)
    yesterday_midnight_local = datetime(
        yesterday_date.year,
        yesterday_date.month,
        yesterday_date.day,
        0,
        0,
        0,
        tzinfo=loc_tz,
    )
    return yesterday_midnight_local.astimezone(timezone.utc)


def get_hours_since_midnight(
    location: Optional[Location] = None,
    reference_time: Optional[datetime] = None,
    target_tz: Optional[tzinfo] = None,
) -> int:
    """Return absolute elapsed hours since local midnight of TODAY, including DST days."""
    if reference_time is None:
        reference_time = datetime.now(timezone.utc)
    if target_tz is not None:
        loc_tz = target_tz
    elif (
        location is not None
        and getattr(location, "timezone", None)
        and location.timezone != "auto"
    ):
        loc_tz = get_local_tz(location)
    else:
        loc_tz = get_user_timezone()
    now_local = reference_time.astimezone(loc_tz)
    today_midnight_local = now_local.replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    elapsed = (
        reference_time - today_midnight_local.astimezone(timezone.utc)
    ).total_seconds() / 3600.0
    return max(0, min(25, int(elapsed)))


def get_past_hours_for_yesterday(
    location: Optional[Location] = None,
    reference_time: Optional[datetime] = None,
    target_tz: Optional[tzinfo] = None,
) -> int:
    """Return past_hours count needed for API requests to cover back to yesterday 00:00 local time."""
    if reference_time is None:
        reference_time = datetime.now(timezone.utc)
    yesterday_midnight_utc = get_yesterday_midnight_utc(
        location, reference_time, target_tz=target_tz
    )
    elapsed = (
        reference_time - yesterday_midnight_utc
    ).total_seconds() / 3600.0
    return max(24, math.ceil(elapsed) + 2)


def find_catalog_model(model_name: str) -> Optional[WeatherModel]:
    """Return the catalogue entry for a configured model name or id."""
    target = to_open_meteo_model(model_name)
    return next(
        (
            m
            for m in get_model_catalog()
            if (m.id or to_open_meteo_model(m.name)) == target
        ),
        None,
    )


def get_fetch_horizon(model: WeatherModel, chain_max_horizon: int) -> int:
    """Return the hours to request for a chain model.

    Meteogram View may drag a boundary beyond the stored horizon, up to the
    model's catalogue capability and never past the chain end. Fetching that
    range keeps a dragged slice filled with the model's own data.
    """
    configured = model.max_forecast_horizon_hours
    catalog_model = find_catalog_model(model.id or model.name)
    capable = (
        catalog_model.max_forecast_horizon_hours
        if catalog_model is not None
        else configured
    )
    return max(configured, min(capable, chain_max_horizon))


def compute_available_hours(
    valid_times: List[datetime], t_now: datetime, fetched_hours: int
) -> Tuple[Optional[int], Optional[str]]:
    """Hours from ``t_now`` through the last valid sample (start-stamped).

    Returns ``(None, None)`` when data reaches the end of the fetched window,
    i.e. the latest run does not limit the requested range, and when the
    model delivered no data at all: a failed or out-of-domain model keeps its
    configured slice, which then stays visibly empty.
    """
    if not valid_times:
        return None, None
    future = [t for t in valid_times if t >= t_now]
    if not future:
        return 0, canonical_timestamp(t_now)
    hours = int((max(future) - t_now).total_seconds() // 3600) + 1
    if hours >= fetched_hours:
        return None, None
    return hours, canonical_timestamp(t_now + timedelta(hours=hours))


def cap_chain_to_availability(
    chain: List[WeatherModel], availability: Dict[str, ModelAvailability]
) -> List[WeatherModel]:
    """Move each boundary to the hours the model's latest run delivers.

    The next model starts right at the capped boundary, so no model is shown
    for hours it has no data for. Boundaries stay non-decreasing.
    """
    capped: List[WeatherModel] = []
    previous = 0
    for model in chain:
        horizon = model.max_forecast_horizon_hours
        info = availability.get(model.name)
        if info is not None and info.available_hours is not None:
            horizon = min(horizon, info.available_hours)
        horizon = max(horizon, previous)
        capped.append(
            model.model_copy(update={"max_forecast_horizon_hours": horizon})
        )
        previous = horizon
    return capped


def _epoch_to_timestamp(value: Any) -> Optional[str]:
    if isinstance(value, (int, float)) and value > 0:
        return canonical_timestamp(datetime.fromtimestamp(value, timezone.utc))
    return None


def has_core_values(points: List[DataPoint]) -> bool:
    """True when a model delivered any main-run (non-optional) value."""
    excluded = set(main_run_excluded_quantities())
    return any(
        p.value is not None and p.variable not in excluded for p in points
    )


def has_cloud_values(profile: Optional[VerticalCloudProfile]) -> bool:
    """True when a profile carries at least one cloud cover value.

    Open-Meteo returns null rows for hours after the end of a model run.
    """
    return bool(
        profile
        and any(
            level.cloud_cover_percent is not None for level in profile.levels
        )
    )


class ForecastService:
    def __init__(
        self, client: OpenMeteoClient = None, storage: Storage = None
    ):
        self.client = client or OpenMeteoClient()
        self.storage = storage or Storage()

    def _extract_sun_periods(
        self, raw_response: Dict[str, Any]
    ) -> List[SunPeriod]:
        daily = raw_response.get("daily", {})
        times = daily.get("time", [])
        sunrises = daily.get("sunrise", [])
        sunsets = daily.get("sunset", [])
        periods: List[SunPeriod] = []
        response_timezone = raw_response.get("timezone") or "UTC"
        for day_str, sr, ss in zip(times, sunrises, sunsets):
            if sr and ss:
                periods.append(
                    SunPeriod(
                        day=day_str,
                        sunrise=canonical_timestamp(sr, response_timezone),
                        sunset=canonical_timestamp(ss, response_timezone),
                    )
                )
        return periods

    async def _api_get(
        self, params: Dict[str, Any], request_kind: str
    ) -> Dict[str, Any]:
        """Perform a live API request and append its response to the archive.

        The archive is write-only: forecasts are never served from it.
        """
        raw_response = await self.client._get(params)
        try:
            self.storage.archive_api_response(
                request_kind, params, raw_response
            )
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                f"Failed to archive {request_kind} API response: {e}"
            )
        return raw_response

    async def _fetch_run_info(
        self, model_ids: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch latest run times per model id from Open-Meteo metadata."""
        run_info: Dict[str, Dict[str, Any]] = {}
        for model_id in dict.fromkeys(model_ids):
            meta: Dict[str, Any] = {}
            try:
                meta = await self.client.fetch_model_metadata(model_id)
                if meta:
                    self.storage.archive_api_response(
                        "model_meta", {"models": model_id}, meta
                    )
            except Exception as e:
                import logging

                logging.getLogger(__name__).warning(
                    f"Failed to fetch run metadata for '{model_id}': {e}"
                )
            run_info[model_id] = {
                "init": _epoch_to_timestamp(
                    meta.get("last_run_initialisation_time")
                ),
                "available": _epoch_to_timestamp(
                    meta.get("last_run_availability_time")
                ),
                # Raw values to detect mixed runs (newest run end, cadence).
                "init_epoch": meta.get("last_run_initialisation_time"),
                "data_end_epoch": meta.get("data_end_time"),
                "interval_seconds": meta.get("update_interval_seconds"),
                "resolution_seconds": meta.get("temporal_resolution_seconds"),
            }
        return run_info

    async def _probe_newer_run(
        self,
        model_id: str,
        info: Dict[str, Any],
        location: Location,
        now: datetime,
        max_probes: int = 4,
    ) -> Optional[Tuple[datetime, datetime]]:
        """Newest run after the metadata run that already has data.

        Probes run init times one update interval apart, starting after the
        metadata run, until a run is missing or lies in the future. Returns
        ``(run init, exclusive end of its data)`` or None.
        """
        init_epoch = info.get("init_epoch")
        interval_seconds = info.get("interval_seconds")
        if not isinstance(init_epoch, (int, float)) or not isinstance(
            interval_seconds, (int, float)
        ):
            return None
        if interval_seconds <= 0:
            return None
        interval = timedelta(seconds=int(interval_seconds))
        run = datetime.fromtimestamp(init_epoch, timezone.utc) + interval
        newest: Optional[Tuple[datetime, datetime]] = None
        for _ in range(max_probes):
            if run > now:
                break
            params = {
                "models": model_id,
                "run": run.strftime("%Y-%m-%dT%H:%M"),
            }
            try:
                raw = await self.client.fetch_single_run(
                    model_id,
                    params["run"],
                    location.latitude,
                    location.longitude,
                    SINGLE_RUN_PROBE_HOURS,
                )
            except Exception:
                # Not published yet (Open-Meteo answers 400).
                break
            try:
                self.storage.archive_api_response("single_run", params, raw)
            except Exception:
                pass
            hourly = raw.get("hourly", {}) if isinstance(raw, dict) else {}
            values = next(
                (v for key, v in hourly.items() if key != "time"), []
            )
            valid = [
                parse_timestamp(t)
                for t, v in zip(hourly.get("time", []), values)
                if v is not None
            ]
            if not valid:
                break
            newest = (run, max(valid) + HOUR)
            run += interval
        return newest

    async def _fetch_ensemble_info(
        self, model_id: str
    ) -> Optional[EnsembleRunInfo]:
        """Newest run of the ensemble behind the model's probability."""
        import logging

        path = ensemble_meta_path(model_id)
        if path is None:
            return None
        try:
            meta = await self.client.fetch_ensemble_metadata(model_id)
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Failed to fetch ensemble metadata for '{model_id}': {e}"
            )
            return None
        if not meta:
            return None
        try:
            self.storage.archive_api_response(
                "ensemble_meta", {"models": path}, meta
            )
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Failed to archive ensemble metadata for '{model_id}': {e}"
            )
        interval = meta.get("update_interval_seconds")
        return EnsembleRunInfo(
            model_id=path,
            run_init_time=_epoch_to_timestamp(
                meta.get("last_run_initialisation_time")
            ),
            run_availability_time=_epoch_to_timestamp(
                meta.get("last_run_availability_time")
            ),
            data_end_time=_epoch_to_timestamp(meta.get("data_end_time")),
            update_interval_hours=(
                interval / 3600
                if isinstance(interval, (int, float))
                else None
            ),
        )

    async def _resolve_run_segments(
        self,
        model_id: str,
        info: Dict[str, Any],
        data_end: datetime,
        location: Location,
        now: Optional[datetime] = None,
    ) -> List[RunSegment]:
        """Split a model series into the runs it comes from, newest first.

        Open-Meteo overwrites only the hours a new run computes, so when the
        newest run is shorter (e.g. ECMWF 06Z 144h after 00Z 360h) later
        hours come from earlier runs. Each hour belongs to the most recent
        run that covers it. Returns [] without run metadata.

        ``meta.json`` can lag behind the served data (it still named the
        ICON-EU 15Z run while the 18Z run was served). Only when the runs it
        names cannot explain where the data ends are newer runs probed; a
        newer run found replaces the metadata run in ``info`` (``init``,
        ``available`` unknown), so the model card names it too.
        """
        segments, covered_end = await self._build_run_segments(
            model_id, info, data_end, location
        )
        if covered_end is None or covered_end >= data_end:
            return segments
        newer = await self._probe_newer_run(
            model_id, info, location, now or datetime.now(timezone.utc)
        )
        if newer is None:
            return segments
        run_init, run_end = newer
        info.update(
            {
                "init": canonical_timestamp(run_init),
                # Unknown for a run the metadata does not list.
                "available": None,
                "init_epoch": int(run_init.timestamp()),
                "data_end_epoch": int(run_end.timestamp()),
            }
        )
        segments, _ = await self._build_run_segments(
            model_id, info, data_end, location
        )
        return segments

    async def _build_run_segments(
        self,
        model_id: str,
        info: Dict[str, Any],
        data_end: datetime,
        location: Location,
    ) -> Tuple[List[RunSegment], Optional[datetime]]:
        """Run segments from the newest run in ``info`` backwards.

        Also returns how far those runs reach (None when unknown), so the
        caller can tell whether they explain the data end.
        """
        init_epoch = info.get("init_epoch")
        newest_end_epoch = info.get("data_end_epoch")
        if not isinstance(init_epoch, (int, float)):
            return [], None
        native_hours = max(
            1, int(info.get("resolution_seconds") or 3600) // 3600
        )

        def run_length(run_start: datetime, last_sample: datetime) -> int:
            # Coarser models are padded to hourly at the end: round down.
            hours = int((last_sample - run_start).total_seconds() // 3600)
            return hours - hours % native_hours

        newest_init = datetime.fromtimestamp(init_epoch, timezone.utc)
        newest = RunSegment(run_init_time=canonical_timestamp(newest_init))
        if not isinstance(newest_end_epoch, (int, float)):
            return [newest], None
        newest_end = datetime.fromtimestamp(newest_end_epoch, timezone.utc)
        newest.run_length_hours = run_length(newest_init, newest_end - HOUR)
        if data_end <= newest_end:
            return [newest], newest_end
        newest.valid_until = canonical_timestamp(newest_end)
        segments = [newest]
        covered_end = newest_end
        interval = timedelta(seconds=int(info.get("interval_seconds") or 21600))
        # An older run never reaches further than a newer run of the longest
        # run length, so the search stops at the first such run.
        catalog_model = find_catalog_model(model_id)
        longest_run = (
            catalog_model.max_forecast_hours if catalog_model else None
        )
        for k in range(1, 9):
            run = newest_init - k * interval
            hours = int((data_end - run).total_seconds() // 3600) + 1
            params = {"models": model_id, "run": run.strftime("%Y-%m-%dT%H:%M")}
            try:
                raw = await self.client.fetch_single_run(
                    model_id,
                    params["run"],
                    location.latitude,
                    location.longitude,
                    hours,
                )
                self.storage.archive_api_response("single_run", params, raw)
            except Exception as e:
                import logging

                logging.getLogger(__name__).warning(
                    f"Failed to fetch run {params['run']} of '{model_id}': {e}"
                )
                continue
            hourly = raw.get("hourly", {}) if isinstance(raw, dict) else {}
            values = next(
                (v for key, v in hourly.items() if key != "time"), []
            )
            valid = [
                parse_timestamp(t)
                for t, v in zip(hourly.get("time", []), values)
                if v is not None
            ]
            if not valid:
                continue
            run_end = max(valid) + HOUR
            if run_end <= covered_end:
                continue
            segment_end = min(run_end, data_end)
            segments.append(
                RunSegment(
                    run_init_time=canonical_timestamp(run),
                    run_length_hours=run_length(run, max(valid)),
                    valid_from=canonical_timestamp(covered_end),
                    valid_until=(
                        None
                        if segment_end >= data_end
                        else canonical_timestamp(segment_end)
                    ),
                )
            )
            covered_end = segment_end
            if covered_end >= data_end:
                break
            if longest_run and run_length(run, max(valid)) >= longest_run:
                break
        return segments, covered_end

    async def fetch_sun_phases(
        self,
        location: Location,
        forecast_days: int = 16,
        timezone_str: Optional[str] = None,
    ) -> List[SunPeriod]:
        """Fetch sunrise/sunset including yesterday via the existing best-match endpoint."""
        params = {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "daily": "sunrise,sunset",
            # Two UTC past days also cover yesterday in every location timezone.
            "past_days": 2,
            # All data transport uses UTC. Location timezones are display-only.
            "timezone": "GMT",
            "forecast_days": min(16, max(1, forecast_days)),
            "models": "best_match",
        }
        raw = await self._api_get(params, "sun_phases")
        return self._extract_sun_periods(raw)

    async def _fetch_raw_model_datasets(
        self,
        config: MeteogramConfig,
        model_name: str,
        horizon: int,
        variables: List[str],
        past_hours: Optional[int] = None,
    ) -> List[RawForecastData]:
        """Fetch raw data for specified variables for a specific model."""
        catalog_model = find_catalog_model(model_name)
        supported = catalog_model.supported_variables if catalog_model else None
        openmeteo_vars = [
            VARIABLE_TO_OPENMETEO.get(v, v) for v in variables
            if requested_from_model(Harmonizer.normalize_variable(v), supported)
        ]
        if past_hours is None:
            user_tz = get_user_timezone()
            past_hours = get_past_hours_for_yesterday(target_tz=user_tz)

        params = {
            "latitude": config.location.latitude,
            "longitude": config.location.longitude,
            "hourly": ",".join(openmeteo_vars),
            "models": to_open_meteo_model(model_name),
            "forecast_hours": horizon,
            "past_hours": past_hours,
            # Avoid browser/local-time ambiguity and DST duplicate hours.
            "timezone": "GMT",
        }

        try:
            raw_response = await self._api_get(params, "forecast")
        except Exception:
            # Some model endpoints reject optional snow fields. Keep the rest of
            # that model's forecast available in this case.
            rejectable = {
                q.api_name for q in QUANTITIES.values() if q.retry_without
            }
            if not rejectable.intersection(openmeteo_vars):
                raise
            fallback_vars = [v for v in openmeteo_vars if v not in rejectable]
            params["hourly"] = ",".join(fallback_vars)
            raw_response = await self._api_get(params, "forecast")

        hourly = raw_response.get("hourly", {})
        hourly_units = raw_response.get("hourly_units", {})
        fetch_time = canonical_timestamp(datetime.now(timezone.utc))
        response_timezone = raw_response.get("timezone") or "UTC"
        timestamps = [
            canonical_timestamp(timestamp, response_timezone)
            for timestamp in hourly.get("time", [])
        ]
        validate_timestamp_sequence(
            timestamps,
            dataset_name=f"{model_name} API timeline",
        )

        raw_datasets: List[RawForecastData] = []
        # Preserve a requested variable even when the upstream response omits its
        # value array. The harmonizer will represent it as timestamped nulls.
        keys_to_process = list(dict.fromkeys(openmeteo_vars))

        for raw_var in keys_to_process:
            vals = hourly.get(raw_var, [])
            dataset = RawForecastData(
                model_name=model_name,
                fetch_time=fetch_time,
                forecast_run_time=None,
                timestamps=timestamps,
                values=vals,
                unit=hourly_units.get(raw_var, ""),
                variable=raw_var,
                max_horizon_hours=horizon,
            )
            raw_datasets.append(dataset)

        return raw_datasets

    async def _fetch_raw_model_data(
        self,
        config: MeteogramConfig,
        model_name: str,
        horizon: int,
        variable: str = "temperature",
        past_hours: Optional[int] = None,
    ) -> RawForecastData:
        """Fetch single raw dataset (for backward compatibility)."""
        datasets = await self._fetch_raw_model_datasets(
            config, model_name, horizon, [variable], past_hours=past_hours
        )
        if datasets:
            return datasets[0]
        return RawForecastData(
            model_name=model_name,
            fetch_time=canonical_timestamp(datetime.now(timezone.utc)),
            timestamps=[],
            values=[],
            unit="",
            variable=variable,
            max_horizon_hours=horizon,
        )

    async def get_merged_forecast(
        self,
        config: MeteogramConfig,
        variables: Optional[List[str]] = None,
        variable: Optional[str] = None,
        reference_time: Optional[datetime] = None,
        auto_chain: Optional[AutoChainInfo] = None,
    ) -> HarmonizedForecastResponse:
        """
        Fetches all models individually for requested variables, harmonizes raw data into standardized DataPoints,
        and returns both individual model series and a combined forecast series where transitions
        happen based on max_forecast_horizon_hours in the configuration.

        With `auto_chain` (normal mode, system.md §3.3) models without any data
        for the location are dropped from both chains, so the next model
        takes over their slice; the response's `auto_chain` lists the chains
        actually used and the dropped models.
        """
        if not config.model_chain:
            raise ValueError("Configuration contains no forecast models.")

        if variables is not None:
            target_variables = variables
        elif variable is not None:
            target_variables = [variable]
        else:
            # All registered surface quantities, in both modes and for every
            # layout (system.md §9.3); the cloud profile is fetched separately for
            # the cloud chain.
            target_variables = [
                v for v in fetch_set()
                if QUANTITIES[v].source == "hourly"
            ]

        raw_datasets: List[RawForecastData] = []
        model_forecasts: Dict[str, List[DataPoint]] = {}
        fetch_errors: Dict[str, Exception] = {}

        # Fetch astronomical sunrise and sunset periods directly for up to 16 days
        sun_phases: List[SunPeriod] = []
        if config.location:
            try:
                sun_phases = await self.fetch_sun_phases(
                    config.location, forecast_days=16
                )
            except Exception as e:
                import logging

                logging.getLogger(__name__).warning(
                    f"Failed to fetch sun phases: {e}"
                )

        now_utc = (
            parse_timestamp(reference_time)
            if reference_time is not None
            else datetime.now(timezone.utc)
        )
        user_tz = get_user_timezone()
        user_tz_name = get_user_timezone_name()
        yesterday_midnight_utc = get_yesterday_midnight_utc(
            config.location, now_utc, target_tz=user_tz
        )
        past_hours = get_past_hours_for_yesterday(
            config.location, now_utc, target_tz=user_tz
        )
        max_chain_horizon = max(
            (m.max_forecast_horizon_hours for m in config.model_chain),
            default=0,
        )
        fetch_horizons = {
            m.name: get_fetch_horizon(m, max_chain_horizon)
            for m in config.model_chain
        }

        # Fetch and harmonize each model
        for weather_model in config.model_chain:
            try:
                model_raw_list = await self._fetch_raw_model_datasets(
                    config,
                    weather_model.name,
                    fetch_horizons[weather_model.name],
                    variables=target_variables,
                    past_hours=past_hours,
                )
                raw_datasets.extend(model_raw_list)

                harmonized_pts: List[DataPoint] = []
                for raw_data in model_raw_list:
                    pts = Harmonizer.harmonize_raw_data(raw_data)
                    harmonized_pts.extend(pts)

                model_forecasts[weather_model.name] = harmonized_pts
            except Exception as e:
                import logging

                logging.getLogger(__name__).warning(
                    f"Failed to fetch forecast data for model '{weather_model.name}': {e}"
                )
                fetch_errors[weather_model.name] = e
                model_forecasts[weather_model.name] = []

        if len(fetch_errors) == len(config.model_chain) and not raw_datasets:
            first_err = next(iter(fetch_errors.values()))
            raise first_err

        dropped_models: List[str] = []
        dropped_cloud_models: List[str] = []
        if auto_chain is not None:
            dropped_models = [
                m.name
                for m in config.model_chain
                if not has_core_values(model_forecasts.get(m.name, []))
            ]
            if len(dropped_models) == len(config.model_chain):
                # Nothing delivers data: keep the chain, its slices stay empty.
                dropped_models = []
            if dropped_models:
                kept = [
                    m for m in config.model_chain
                    if m.name not in dropped_models
                ]
                for name in dropped_models:
                    model_forecasts.pop(name, None)
                raw_datasets = [
                    d for d in raw_datasets
                    if d.model_name not in dropped_models
                ]
                config = config.model_copy(
                    update={"model_chain": kept, "main_model_chain": kept}
                )
                max_chain_horizon = max(
                    m.max_forecast_horizon_hours for m in kept
                )

        if not raw_datasets:
            return HarmonizedForecastResponse(
                combined_forecast=[],
                model_forecasts=model_forecasts,
                raw_data=[],
                sun_phases=sun_phases,
                user_timezone=user_tz_name,
            )

        # Establish one absolute timeline from the shared request origin and the
        # configured model horizon. Source array lengths never define the window.
        all_timestamps_set: set[str] = set()
        for d in raw_datasets:
            all_timestamps_set.update(d.timestamps)

        source_timestamps = sorted(
            all_timestamps_set, key=lambda value: parse_timestamp(value)
        )

        if not source_timestamps:
            return HarmonizedForecastResponse(
                combined_forecast=[],
                model_forecasts=model_forecasts,
                raw_data=raw_datasets,
                sun_phases=sun_phases,
                user_timezone=user_tz_name,
            )

        # The visible timeline always begins at local midnight of the previous calendar day
        timeline_start_dt = yesterday_midnight_utc
        t_now = now_utc.replace(minute=0, second=0, microsecond=0)
        t_now_iso = canonical_timestamp(t_now)
        timeline_end_iso = model_end_timestamp(t_now, max_chain_horizon)
        all_timestamps = build_hourly_timeline(
            canonical_timestamp(timeline_start_dt), timeline_end_iso
        )

        # Determine normalized target variable names to look for
        normalized_vars = list(
            dict.fromkeys(
                [Harmonizer.normalize_variable(v) for v in target_variables]
            )
        )

        # Track default or discovered units per normalized variable
        DEFAULT_UNITS = Harmonizer.TARGET_UNITS
        var_units: Dict[str, str] = {}
        for d in raw_datasets:
            norm_v = Harmonizer.normalize_variable(d.variable)
            if d.unit and norm_v not in var_units:
                quantity = QUANTITIES.get(norm_v)
                var_units[norm_v] = (
                    quantity.unit
                    if quantity and not quantity.unit_from_api
                    else d.unit
                )

        # Clip each model to its fetched absolute half-open interval (which
        # covers boundaries dragged in Meteogram View) and record actual
        # variable availability for the configured model range separately.
        timeline_diagnostics: Dict[str, ModelTimelineDiagnostics] = {}
        for weather_model in config.model_chain:
            expected_end = parse_timestamp(
                model_end_timestamp(
                    t_now, weather_model.max_forecast_horizon_hours
                )
            )
            fetched_end = parse_timestamp(
                model_end_timestamp(
                    t_now, fetch_horizons[weather_model.name]
                )
            )
            fetched_points = [
                point
                for point in model_forecasts.get(weather_model.name, [])
                if timeline_start_dt
                <= parse_timestamp(point.timestamp)
                < fetched_end
            ]
            fetched_points.sort(
                key=lambda point: (
                    parse_timestamp(point.timestamp),
                    point.variable,
                )
            )
            model_forecasts[weather_model.name] = fetched_points
            model_points = [
                point
                for point in fetched_points
                if parse_timestamp(point.timestamp) < expected_end
            ]

            variable_diagnostics: Dict[str, VariableTimelineCoverage] = {}
            expected_last = (
                expected_end - HOUR
                if weather_model.max_forecast_horizon_hours > 0
                else None
            )
            for norm_var in normalized_vars:
                variable_points = [
                    point
                    for point in model_points
                    if point.variable == norm_var
                    and parse_timestamp(point.timestamp) >= t_now
                ]
                variable_points.sort(
                    key=lambda point: parse_timestamp(point.timestamp)
                )
                valid_points = [
                    point
                    for point in variable_points
                    if point.value is not None
                ]
                variable_times = [
                    point.timestamp for point in variable_points
                ]
                spacing_anomalies = validate_timestamp_sequence(
                    variable_times,
                    dataset_name=f"{weather_model.name} / {norm_var}",
                )
                valid_time_set = {
                    parse_timestamp(point.timestamp) for point in valid_points
                }
                expected_sample_count = max(
                    0, weather_model.max_forecast_horizon_hours
                )
                complete = bool(
                    expected_last is None
                    or (
                        expected_last in valid_time_set
                        and len(valid_time_set) == expected_sample_count
                        and not spacing_anomalies
                    )
                )

                coverage = VariableTimelineCoverage(
                    variable=norm_var,
                    sample_count=len(variable_points),
                    valid_sample_count=len(valid_points),
                    first_timestamp=(
                        variable_points[0].timestamp
                        if variable_points
                        else None
                    ),
                    last_timestamp=(
                        variable_points[-1].timestamp
                        if variable_points
                        else None
                    ),
                    first_valid_timestamp=(
                        valid_points[0].timestamp if valid_points else None
                    ),
                    last_valid_timestamp=(
                        valid_points[-1].timestamp if valid_points else None
                    ),
                    expected_start=t_now_iso,
                    expected_end_exclusive=canonical_timestamp(expected_end),
                    expected_last_timestamp=(
                        canonical_timestamp(expected_last)
                        if expected_last is not None
                        else None
                    ),
                    complete=complete,
                    spacing_anomalies=spacing_anomalies,
                )
                variable_diagnostics[norm_var] = coverage

                if not coverage.complete and norm_var not in optional_quantities():
                    import logging

                    logging.getLogger(__name__).warning(
                        "%s / %s: expected hourly data through %s "
                        "(model boundary %s exclusive), received valid data "
                        "only through %s",
                        weather_model.name,
                        norm_var,
                        coverage.expected_last_timestamp,
                        coverage.expected_end_exclusive,
                        coverage.last_valid_timestamp,
                    )

            timeline_diagnostics[weather_model.name] = (
                ModelTimelineDiagnostics(
                    model=weather_model.name,
                    expected_start=t_now_iso,
                    expected_end_exclusive=canonical_timestamp(expected_end),
                    variables=variable_diagnostics,
                )
            )

        # Hours each model's latest run really delivers (core variables only).
        cloud_chain = config.cloud_model_chain
        if cloud_chain is None:
            from .open_meteo import get_default_cloud_model

            cloud_chain = [get_default_cloud_model()]
        run_info = await self._fetch_run_info(
            [
                m.id or to_open_meteo_model(m.name)
                for m in list(config.model_chain) + list(cloud_chain)
            ]
        )

        def availability_for(
            model: WeatherModel,
            chain_name: str,
            valid_times: List[datetime],
            fetched_hours: int,
        ) -> ModelAvailability:
            model_id = model.id or to_open_meteo_model(model.name)
            hours, valid_until = compute_available_hours(
                valid_times, t_now, fetched_hours
            )
            info = run_info.get(model_id, {})
            return ModelAvailability(
                model=model.name,
                model_id=model_id,
                chain=chain_name,
                available_hours=hours,
                valid_until=valid_until,
                last_run_init_time=info.get("init"),
                last_run_availability_time=info.get("available"),
            )

        # Only main-run quantities define the delivered hours: optional ones
        # may be missing, and ensemble ones (precipitation probability) end
        # where the ensemble run ends, often hours after the main run.
        optional_variables = set(main_run_excluded_quantities())
        model_availability: Dict[str, ModelAvailability] = {}
        models_with_data: set[Tuple[str, str]] = set()
        for weather_model in config.model_chain:
            core_times = [
                parse_timestamp(point.timestamp)
                for point in model_forecasts.get(weather_model.name, [])
                if point.value is not None
                and point.variable not in optional_variables
            ]
            if core_times:
                models_with_data.add(("main", weather_model.name))
            model_availability[weather_model.name] = availability_for(
                weather_model,
                "main",
                core_times,
                fetch_horizons[weather_model.name],
            )
        capped_chain = cap_chain_to_availability(
            config.model_chain, model_availability
        )

        # Populate empty models in model_forecasts so every model in chain is represented
        for weather_model in config.model_chain:
            if not model_forecasts.get(weather_model.name):
                empty_pts: List[DataPoint] = []
                for ts in all_timestamps:
                    current_time = parse_timestamp(ts)
                    hrs = (
                        0.0
                        if current_time < t_now
                        else (current_time - t_now).total_seconds() / 3600.0
                    )
                    if hrs < weather_model.max_forecast_horizon_hours:
                        for norm_var in normalized_vars:
                            unit = var_units.get(
                                norm_var, DEFAULT_UNITS.get(norm_var, "")
                            )
                            empty_pts.append(
                                DataPoint(
                                    timestamp=ts,
                                    value=None,
                                    unit=unit,
                                    variable=norm_var,
                                    model=weather_model.name,
                                )
                            )
                model_forecasts[weather_model.name] = empty_pts

        # Determine active models in the capped chain (span > 0)
        active_chain: List[WeatherModel] = []
        for idx, m in enumerate(capped_chain):
            prev_h = (
                capped_chain[idx - 1].max_forecast_horizon_hours
                if idx > 0
                else 0
            )
            if m.max_forecast_horizon_hours > prev_h:
                active_chain.append(m)

        effective_chain = active_chain if active_chain else capped_chain

        forecast_lookup: Dict[str, Dict[tuple[str, str], DataPoint]] = {}
        for weather_model in effective_chain:
            point_lookup: Dict[tuple[str, str], DataPoint] = {}
            for point in model_forecasts.get(weather_model.name, []):
                point_lookup[
                    (canonical_timestamp(point.timestamp), point.variable)
                ] = point
            forecast_lookup[weather_model.name] = point_lookup

        combined_forecast: List[DataPoint] = []

        for ts in all_timestamps:
            current_time = parse_timestamp(ts)

            # Determine primary model for this horizon:
            # Past hours before t_now are assigned to the primary model (effective_chain[0])
            if current_time < t_now:
                primary_model = effective_chain[0]
            else:
                hours_from_now = (
                    current_time - t_now
                ).total_seconds() / 3600.0
                primary_model = None
                for weather_model in effective_chain:
                    if (
                        hours_from_now
                        < weather_model.max_forecast_horizon_hours
                    ):
                        primary_model = weather_model
                        break
                if primary_model is None and effective_chain:
                    primary_model = effective_chain[-1]

            # Each model only ever shows its own data inside its (capped)
            # slice; missing hours stay empty instead of borrowing another
            # model's values.
            for norm_var in normalized_vars:
                selected_point = None

                if primary_model:
                    pt = forecast_lookup.get(primary_model.name, {}).get(
                        (ts, norm_var)
                    )
                    if pt is not None and pt.value is not None:
                        selected_point = pt

                # If still no point, emit an empty DataPoint with value=None for the primary model
                if selected_point is None and primary_model:
                    unit = var_units.get(
                        norm_var, DEFAULT_UNITS.get(norm_var, "")
                    )
                    selected_point = DataPoint(
                        timestamp=ts,
                        value=None,
                        unit=unit,
                        variable=norm_var,
                        model=primary_model.name,
                    )

                if selected_point is not None:
                    combined_forecast.append(selected_point)

        # Vertical Cloud Profile Source Chain Execution
        vertical_cloud_forecast = None
        vertical_cloud_transitions: List[VerticalCloudTransition] = []
        vertical_cloud_model_forecasts: Dict[str, DetailedCloudForecast] = {}

        cloud_model_availability: Dict[str, ModelAvailability] = {}

        if cloud_chain and len(cloud_chain) > 0 and all_timestamps:
            try:
                # 1. Fetch each model in cloud_chain. A failing model only
                # loses its own profiles, never the whole cloud panel.
                max_cloud_horizon = max(
                    (m.max_forecast_horizon_hours for m in cloud_chain),
                    default=0,
                )
                for c_model in cloud_chain:
                    cid = c_model.id or to_open_meteo_model(c_model.name)
                    cloud_fetch_hours = get_fetch_horizon(
                        c_model, max_cloud_horizon
                    )
                    try:
                        c_forecast = (
                            await self.fetch_vertical_cloud_model_forecast(
                                config.location,
                                c_model,
                                horizon_hours=cloud_fetch_hours,
                            )
                        )
                    except Exception as e:
                        import logging

                        logging.getLogger(__name__).warning(
                            f"Failed to fetch vertical clouds for model "
                            f"'{c_model.name}': {e}"
                        )
                        c_forecast = DetailedCloudForecast(
                            location=config.location, profiles=[]
                        )
                    vertical_cloud_model_forecasts[c_model.name] = c_forecast
                    if cid:
                        vertical_cloud_model_forecasts[cid] = c_forecast
                    cloud_times = [
                        parse_timestamp(profile.timestamp)
                        for profile in c_forecast.profiles
                        if has_cloud_values(profile)
                    ]
                    if cloud_times:
                        models_with_data.add(("cloud", c_model.name))
                    cloud_model_availability[c_model.name] = availability_for(
                        c_model, "cloud", cloud_times, cloud_fetch_hours
                    )

                if auto_chain is not None:
                    with_data = [
                        m for m in cloud_chain
                        if ("cloud", m.name) in models_with_data
                    ]
                    if with_data and len(with_data) < len(cloud_chain):
                        for m in cloud_chain:
                            if m in with_data:
                                continue
                            dropped_cloud_models.append(m.name)
                            cloud_model_availability.pop(m.name, None)
                            vertical_cloud_model_forecasts.pop(m.name, None)
                            if m.id:
                                vertical_cloud_model_forecasts.pop(m.id, None)
                        cloud_chain = with_data

                # 2. Cap to run availability, then filter active models
                capped_cloud_chain = cap_chain_to_availability(
                    cloud_chain, cloud_model_availability
                )
                active_cloud_chain = [
                    m
                    for idx, m in enumerate(capped_cloud_chain)
                    if m.max_forecast_horizon_hours
                    > (
                        capped_cloud_chain[idx - 1].max_forecast_horizon_hours
                        if idx > 0
                        else 0
                    )
                ]
                effective_cloud_chain = (
                    active_cloud_chain
                    if active_cloud_chain
                    else capped_cloud_chain
                )

                composite_profiles: List[VerticalCloudProfile] = []
                last_c_model_id: Optional[str] = None

                cloud_profile_lookup: Dict[str, Dict[str, VerticalCloudProfile]] = {}
                for key, forecast in vertical_cloud_model_forecasts.items():
                    cloud_profile_lookup[key] = {
                        canonical_timestamp(profile.timestamp): profile
                        for profile in forecast.profiles
                    }

                def valid_cloud_profile(
                    c_m: WeatherModel, ts: str
                ) -> Optional[VerticalCloudProfile]:
                    c_id = c_m.id or to_open_meteo_model(c_m.name)
                    prof = cloud_profile_lookup.get(c_m.name, {}).get(
                        ts
                    ) or cloud_profile_lookup.get(c_id, {}).get(ts)
                    return prof if has_cloud_values(prof) else None

                for ts in all_timestamps:
                    current_dt = parse_timestamp(ts)
                    if current_dt < t_now:
                        primary_c_model = effective_cloud_chain[0]
                    else:
                        hours_from_now = (
                            current_dt - t_now
                        ).total_seconds() / 3600.0
                        primary_c_model = None
                        for c_m in effective_cloud_chain:
                            if (
                                hours_from_now
                                < c_m.max_forecast_horizon_hours
                            ):
                                primary_c_model = c_m
                                break

                    matching_prof = (
                        valid_cloud_profile(primary_c_model, ts)
                        if primary_c_model is not None
                        else None
                    )
                    if primary_c_model is not None:
                        cid = primary_c_model.id or to_open_meteo_model(
                            primary_c_model.name
                        )
                        if matching_prof:
                            composite_profiles.append(
                                VerticalCloudProfile(
                                    timestamp=ts,
                                    source_model_id=cid,
                                    source_model_name=primary_c_model.name,
                                    source_run=matching_prof.source_run,
                                    levels=matching_prof.levels,
                                )
                            )
                            if (
                                last_c_model_id is not None
                                and last_c_model_id != cid
                            ):
                                vertical_cloud_transitions.append(
                                    VerticalCloudTransition(
                                        timestamp=ts,
                                        from_model=last_c_model_id,
                                        to_model=cid,
                                    )
                                )
                            last_c_model_id = cid
                        else:
                            last_c_model_id = None
                    else:
                        last_c_model_id = None

                vertical_cloud_forecast = DetailedCloudForecast(
                    location=config.location, profiles=composite_profiles
                )
            except Exception as e:
                import logging

                logging.getLogger(__name__).warning(
                    f"Failed to resolve vertical cloud profile: {e}"
                )

        # Mixed runs: which runs each model's series is composed of.
        run_segments_cache: Dict[Tuple[str, str], List[RunSegment]] = {}
        for chain_name, availabilities, models in (
            ("main", model_availability, config.model_chain),
            ("cloud", cloud_model_availability, cloud_chain or []),
        ):
            max_horizon = max(
                (m.max_forecast_horizon_hours for m in models), default=0
            )
            for model in models:
                info_entry = availabilities.get(model.name)
                if info_entry is None or not info_entry.model_id:
                    continue
                if info_entry.available_hours is not None:
                    if info_entry.available_hours == 0:
                        continue
                    data_end = parse_timestamp(info_entry.valid_until)
                elif (chain_name, model.name) in models_with_data:
                    data_end = t_now + timedelta(
                        hours=get_fetch_horizon(model, max_horizon)
                    )
                else:
                    continue
                key = (info_entry.model_id, canonical_timestamp(data_end))
                if key not in run_segments_cache:
                    run_segments_cache[key] = await self._resolve_run_segments(
                        info_entry.model_id,
                        run_info.setdefault(info_entry.model_id, {}),
                        data_end,
                        config.location,
                        datetime.now(timezone.utc),
                    )
                segments = run_segments_cache[key]
                # A newer run than meta.json names may have been found.
                corrected = run_info.get(info_entry.model_id, {})
                info_entry.last_run_init_time = corrected.get("init")
                info_entry.last_run_availability_time = corrected.get(
                    "available"
                )
                info_entry.run_segments = [
                    seg.model_copy() for seg in segments
                ]
                if len(segments) > 1:
                    info_entry.data_end_run_init_time = segments[-1].run_init_time

        # Precipitation probability comes from the model's ensemble, which
        # Open-Meteo publishes separately (often later than the main run).
        ensemble_cache: Dict[str, Optional[EnsembleRunInfo]] = {}
        for weather_model in config.model_chain:
            info_entry = model_availability.get(weather_model.name)
            if info_entry is None or not info_entry.model_id:
                continue
            probability_times = [
                parse_timestamp(point.timestamp)
                for point in model_forecasts.get(weather_model.name, [])
                if point.value is not None
                and point.variable == "precipitation_probability"
            ]
            if probability_times:
                info_entry.probability_valid_until = canonical_timestamp(
                    max(probability_times) + HOUR
                )
            if info_entry.model_id not in ensemble_cache:
                ensemble_cache[info_entry.model_id] = (
                    await self._fetch_ensemble_info(info_entry.model_id)
                )
            ensemble = ensemble_cache[info_entry.model_id]
            if ensemble is not None:
                info_entry.ensemble = ensemble.model_copy()

        try:
            self.storage.record_model_availability(
                list(model_availability.values())
                + list(cloud_model_availability.values()),
                config.location,
                t_now_iso,
            )
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                f"Failed to store model run availability: {e}"
            )

        response = HarmonizedForecastResponse(
            combined_forecast=combined_forecast,
            model_forecasts=model_forecasts,
            raw_data=raw_datasets,
            vertical_cloud_forecast=vertical_cloud_forecast,
            vertical_cloud_transitions=vertical_cloud_transitions,
            vertical_cloud_model_forecasts=vertical_cloud_model_forecasts,
            sun_phases=sun_phases,
            forecast_start_time=t_now_iso,
            timeline_start=canonical_timestamp(timeline_start_dt),
            timeline_end=timeline_end_iso,
            user_timezone=user_tz_name,
            timeline_diagnostics=timeline_diagnostics,
            model_availability=model_availability,
            cloud_model_availability=cloud_model_availability,
        )
        if auto_chain is not None:
            response.auto_chain = auto_chain.model_copy(
                update={
                    "main_model_chain": list(config.model_chain),
                    "cloud_model_chain": list(cloud_chain or []),
                    "dropped_models": dropped_models,
                    "dropped_cloud_models": dropped_cloud_models,
                }
            )
            config = config.model_copy(
                update={"cloud_model_chain": list(cloud_chain or [])}
            )
        # Structured archive (system.md §9.3); stores nothing while disabled.
        try:
            self.storage.record_forecast_fetch(response, config)
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                f"Failed to archive forecast: {e}"
            )
        return response

    async def fetch_vertical_cloud_model_forecast(
        self,
        location: Location,
        model: WeatherModel,
        horizon_hours: Optional[int] = None,
    ) -> DetailedCloudForecast:
        """
        Fetches the vertical cloud pressure-level forecast for a single model across its full horizon.
        """
        model_id = model.id or to_open_meteo_model(model.name)
        levels_to_fetch = model.pressure_levels_hpa or DEFAULT_PRESSURE_LEVELS
        horizon = horizon_hours or (
            model.max_forecast_horizon_hours or model.max_forecast_hours or 72
        )

        var_list = []
        for p in levels_to_fetch:
            var_list.append(f"cloud_cover_{p}hPa")
            var_list.append(f"geopotential_height_{p}hPa")

        user_tz = get_user_timezone()
        past_hours = get_past_hours_for_yesterday(target_tz=user_tz)
        params = {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "hourly": ",".join(var_list),
            "models": to_open_meteo_model(model.name),
            "forecast_hours": horizon,
            "past_hours": past_hours,
            "timezone": "GMT",
        }

        try:
            raw_response = await self._api_get(params, "vertical_cloud")
        except Exception:
            # Fallback mock empty if fetch fails
            raw_response = {}

        hourly = raw_response.get("hourly", {})
        response_timezone = raw_response.get("timezone") or "UTC"
        timestamps = [
            canonical_timestamp(timestamp, response_timezone)
            for timestamp in hourly.get("time", [])
        ]
        validate_timestamp_sequence(
            timestamps,
            dataset_name=f"{model.name} vertical cloud timeline",
        )

        profiles: List[VerticalCloudProfile] = []

        for idx, ts in enumerate(timestamps):
            level_objs: List[VerticalCloudLevel] = []
            for p in levels_to_fetch:
                cc_vals = hourly.get(f"cloud_cover_{p}hPa", [])
                gh_vals = hourly.get(f"geopotential_height_{p}hPa", [])

                cc_val = cc_vals[idx] if idx < len(cc_vals) else None
                gh_val = gh_vals[idx] if idx < len(gh_vals) else None

                alt_asl = (
                    float(gh_val)
                    if gh_val is not None
                    else estimate_altitude_m_asl(p)
                )
                cc_percent = float(cc_val) if cc_val is not None else None

                level_objs.append(
                    VerticalCloudLevel(
                        pressure_hpa=float(p),
                        altitude_m_asl=alt_asl,
                        cloud_cover_percent=cc_percent,
                    )
                )

            # Sort levels by altitude ascending
            level_objs.sort(
                key=lambda l: (
                    l.altitude_m_asl if l.altitude_m_asl is not None else 0.0
                )
            )

            profiles.append(
                VerticalCloudProfile(
                    timestamp=ts,
                    source_model_id=model_id,
                    source_model_name=model.name,
                    levels=level_objs,
                )
            )

        return DetailedCloudForecast(location=location, profiles=profiles)

    async def get_vertical_cloud_forecast(
        self,
        location: Location,
        timestamps: List[str],
        available_models: List[WeatherModel],
        start_time: Optional[str] = None,
    ) -> tuple[DetailedCloudForecast, List[VerticalCloudTransition]]:
        """
        Constructs a continuous vertical cloud forecast across requested timestamps by automatically
        selecting the optimal vertical cloud model for each timestamp.
        """
        if not timestamps:
            return DetailedCloudForecast(location=location, profiles=[]), []

        canonical_timestamps = sorted(
            {canonical_timestamp(timestamp) for timestamp in timestamps},
            key=lambda timestamp: parse_timestamp(timestamp),
        )
        validate_timestamp_sequence(
            canonical_timestamps,
            dataset_name="requested vertical cloud timeline",
        )
        ref_start_time = canonical_timestamp(
            start_time or canonical_timestamps[0]
        )
        model_forecast_cache: Dict[str, DetailedCloudForecast] = {}

        composite_profiles: List[VerticalCloudProfile] = []
        transitions: List[VerticalCloudTransition] = []
        last_model_id: Optional[str] = None

        for ts in canonical_timestamps:
            best_model = resolve_vertical_cloud_source(
                location, ts, available_models, start_time=ref_start_time
            )
            if best_model is None:
                # No detailed model available for this timestamp
                last_model_id = None
                continue

            best_model_id = best_model.id or to_open_meteo_model(
                best_model.name
            )

            if best_model_id not in model_forecast_cache:
                m_forecast = await self.fetch_vertical_cloud_model_forecast(
                    location, best_model
                )
                model_forecast_cache[best_model_id] = m_forecast

            m_forecast = model_forecast_cache[best_model_id]
            matching_profile = next(
                (
                    p
                    for p in m_forecast.profiles
                    if canonical_timestamp(p.timestamp) == ts
                ),
                None,
            )

            if matching_profile:
                # Clone profile ensuring source_model_id and source_model_name are preserved
                prof_copy = VerticalCloudProfile(
                    timestamp=ts,
                    source_model_id=best_model_id,
                    source_model_name=best_model.name,
                    source_run=matching_profile.source_run,
                    levels=matching_profile.levels,
                )
                composite_profiles.append(prof_copy)

                if (
                    last_model_id is not None
                    and last_model_id != best_model_id
                ):
                    transitions.append(
                        VerticalCloudTransition(
                            timestamp=ts,
                            from_model=last_model_id,
                            to_model=best_model_id,
                        )
                    )
                last_model_id = best_model_id
            else:
                last_model_id = None

        return (
            DetailedCloudForecast(
                location=location, profiles=composite_profiles
            ),
            transitions,
        )
