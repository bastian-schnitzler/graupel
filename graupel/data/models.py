from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import pydantic
from pydantic import BaseModel, Field, model_validator


class Location(BaseModel):
    name: str
    latitude: float
    longitude: float
    country: Optional[str] = None
    admin1: Optional[str] = None
    elevation: Optional[float] = None
    timezone: Optional[str] = None


class WeatherModel(BaseModel):
    id: Optional[str] = None
    name: str  # e.g., "ICON-D2", "ICON-EU", "GFS"
    short_name: Optional[str] = None  # nickname for the model header
    provider: Optional[str] = None
    region: Optional[str] = None
    geographical_coverage: Optional[str] = None
    spatial_resolution_km: Optional[float] = None
    spatial_resolution: Optional[float] = None
    temporal_resolution_hours: Optional[float] = None
    temporal_resolution: Optional[float] = None
    max_forecast_hours: Optional[int] = Field(default=None, ge=0)
    max_forecast_horizon_hours: int = Field(default=24, ge=0)
    supported_variables: List[str] = Field(default_factory=list)
    missing_variables: List[str] = Field(default_factory=list)
    active: bool = True
    unavailable: bool = False
    description: Optional[str] = None
    supports_vertical_cloud_profile: bool = False
    supports_pressure_level_cloud_cover: bool = False
    supports_geopotential_height: bool = False
    pressure_levels_hpa: List[int] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def populate_aliases_and_defaults(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        # Max forecast horizon
        if (
            "max_forecast_hours" in data
            and "max_forecast_horizon_hours" not in data
        ):
            data["max_forecast_horizon_hours"] = data["max_forecast_hours"]
        elif (
            "max_forecast_horizon_hours" in data
            and "max_forecast_hours" not in data
        ):
            data["max_forecast_hours"] = data["max_forecast_horizon_hours"]

        # Spatial resolution
        if (
            "spatial_resolution_km" in data
            and "spatial_resolution" not in data
        ):
            data["spatial_resolution"] = data["spatial_resolution_km"]
        elif (
            "spatial_resolution" in data
            and "spatial_resolution_km" not in data
        ):
            data["spatial_resolution_km"] = data["spatial_resolution"]

        # Temporal resolution
        if (
            "temporal_resolution_hours" in data
            and "temporal_resolution" not in data
        ):
            data["temporal_resolution"] = data["temporal_resolution_hours"]
        elif (
            "temporal_resolution" in data
            and "temporal_resolution_hours" not in data
        ):
            data["temporal_resolution_hours"] = data["temporal_resolution"]

        # Region / geographical coverage
        if "region" in data and "geographical_coverage" not in data:
            data["geographical_coverage"] = data["region"]
        elif "geographical_coverage" in data and "region" not in data:
            data["region"] = data["geographical_coverage"]

        return data


class MeteogramConfig(BaseModel):
    id: str | None = None
    name: str
    location: Location
    model_chain: List[WeatherModel] = Field(default_factory=list)
    main_model_chain: Optional[List[WeatherModel]] = None
    cloud_model_chain: Optional[List[WeatherModel]] = None
    position: Optional[int] = None
    # Meteogram configuration (layout) id; None = global layout (system.md §4.3).
    layout_id: Optional[str] = None
    # Display name of the location, e.g. "INSB"; None = place name (§16.12).
    location_name_override: Optional[str] = None

    @pydantic.field_validator("location_name_override")
    @classmethod
    def blank_override_is_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    @pydantic.model_validator(mode="before")
    @classmethod
    def handle_chain_aliases_and_migrations(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        # Resolve main chain aliases: prefer model_chain if present, else mainModelChain / main_model_chain
        main_chain = (
            data.get("model_chain")
            if "model_chain" in data
            else (data.get("mainModelChain") or data.get("main_model_chain"))
        )
        if main_chain is not None:
            data["main_model_chain"] = main_chain
            data["model_chain"] = main_chain

        # Resolve cloud chain aliases and migration
        # Note: If "cloudModelChain" or "cloud_model_chain" is present (even if []), preserve it.
        # If neither is present, migrate legacy config by assigning default cloud chain.
        has_cloud = "cloudModelChain" in data or "cloud_model_chain" in data
        if has_cloud:
            cloud_val = (
                data.get("cloudModelChain")
                if "cloudModelChain" in data
                else data.get("cloud_model_chain")
            )
            data["cloud_model_chain"] = cloud_val
        else:
            from .open_meteo import get_default_cloud_model

            data["cloud_model_chain"] = [get_default_cloud_model()]

        return data

    @pydantic.model_validator(mode="after")
    def validate_chains(self) -> "MeteogramConfig":
        self.main_model_chain = self.model_chain

        def check_chain(chain: List[WeatherModel], chain_name: str) -> None:
            last_horizon = 0
            for model in chain:
                if model.max_forecast_horizon_hours < 0:
                    raise ValueError(
                        f"Model horizon cannot be negative. "
                        f"Model '{model.name}' in {chain_name} has horizon {model.max_forecast_horizon_hours}."
                    )
                if model.max_forecast_horizon_hours < last_horizon:
                    raise ValueError(
                        f"Model horizons must be non-decreasing. "
                        f"Model '{model.name}' in {chain_name} has horizon {model.max_forecast_horizon_hours}, "
                        f"but previous model had {last_horizon}."
                    )
                last_horizon = model.max_forecast_horizon_hours

        if self.model_chain:
            check_chain(self.model_chain, "main model chain")
        if self.cloud_model_chain:
            check_chain(self.cloud_model_chain, "cloud model chain")

        return self

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        if name == "model_chain":
            object.__setattr__(self, "main_model_chain", value)
        elif name == "main_model_chain":
            object.__setattr__(self, "model_chain", value)


class RawForecastData(BaseModel):
    model_name: str
    fetch_time: str
    forecast_run_time: str | None = None
    timestamps: List[str]
    values: List[float | None]
    unit: str
    variable: str = "temperature"
    max_horizon_hours: int


class DataPoint(BaseModel):
    timestamp: str
    value: float | None
    unit: str
    variable: str
    model: str


class VerticalCloudLevel(BaseModel):
    pressure_hpa: float
    altitude_m_asl: Optional[float] = None
    cloud_cover_percent: Optional[float] = None


class VerticalCloudProfile(BaseModel):
    timestamp: str
    source_model_id: str
    source_model_name: Optional[str] = None
    source_run: Optional[str] = None
    levels: List[VerticalCloudLevel] = Field(default_factory=list)


class DetailedCloudForecast(BaseModel):
    location: Location
    profiles: List[VerticalCloudProfile] = Field(default_factory=list)


class VerticalCloudTransition(BaseModel):
    timestamp: str
    from_model: str
    to_model: str


class SunPeriod(BaseModel):
    day: str
    sunrise: str
    sunset: str


class VariableTimelineCoverage(BaseModel):
    variable: str
    sample_count: int
    valid_sample_count: int
    first_timestamp: Optional[str] = None
    last_timestamp: Optional[str] = None
    first_valid_timestamp: Optional[str] = None
    last_valid_timestamp: Optional[str] = None
    expected_start: str
    expected_end_exclusive: str
    expected_last_timestamp: Optional[str] = None
    complete: bool
    spacing_anomalies: List[Dict[str, Any]] = Field(default_factory=list)


class ModelTimelineDiagnostics(BaseModel):
    model: str
    expected_start: str
    expected_end_exclusive: str
    variables: Dict[str, VariableTimelineCoverage] = Field(default_factory=dict)


class RunSegment(BaseModel):
    """Hours of a model series that come from one run (UTC instants).

    ``valid_from``/``valid_until`` are None at the open ends of the series.
    """

    run_init_time: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    # Length of the run itself (last sample - init), native resolution.
    run_length_hours: Optional[int] = None


class EnsembleRunInfo(BaseModel):
    """Newest run of the ensemble delivering a model's precipitation
    probability, as published in the ensemble's ``meta.json``."""

    model_id: str
    run_init_time: Optional[str] = None
    run_availability_time: Optional[str] = None
    # Exclusive end of the newest ensemble run's data.
    data_end_time: Optional[str] = None
    update_interval_hours: Optional[float] = None


class ModelAvailability(BaseModel):
    """Data actually delivered by a model's latest runs for one forecast.

    ``available_hours`` counts hours from ``forecast_start_time`` through the
    last valid sample; ``None`` means data reaches the end of the requested
    window, so the model needs no cap.
    """

    model: str
    model_id: Optional[str] = None
    chain: str  # "main" or "cloud"
    available_hours: Optional[int] = None
    valid_until: Optional[str] = None  # exclusive end of the available data
    last_run_init_time: Optional[str] = None
    last_run_availability_time: Optional[str] = None
    # Set only when Open-Meteo mixes runs: the older run delivering the end.
    data_end_run_init_time: Optional[str] = None
    # Runs the series is composed of, newest first (Open-Meteo overwrites
    # only the hours a new run computes).
    run_segments: List[RunSegment] = Field(default_factory=list)
    # Ensemble behind ``precipitation_probability`` and the exclusive end of
    # the last valid probability sample (main chain only).
    ensemble: Optional[EnsembleRunInfo] = None
    probability_valid_until: Optional[str] = None


class AutoChainInfo(BaseModel):
    """Auto chain a normal-mode forecast used (system.md §3.3, §6.3)."""

    region_id: Optional[str] = None
    region_name: Optional[str] = None
    resolution_reason: str
    # Chains actually stitched: models without data are already dropped.
    main_model_chain: List[WeatherModel] = Field(default_factory=list)
    cloud_model_chain: List[WeatherModel] = Field(default_factory=list)
    dropped_models: List[str] = Field(default_factory=list)
    dropped_cloud_models: List[str] = Field(default_factory=list)


class HarmonizedForecastResponse(BaseModel):
    combined_forecast: List[DataPoint]
    model_forecasts: Dict[str, List[DataPoint]]
    raw_data: List[RawForecastData] = []
    vertical_cloud_forecast: Optional[DetailedCloudForecast] = None
    vertical_cloud_transitions: List[VerticalCloudTransition] = Field(
        default_factory=list
    )
    vertical_cloud_model_forecasts: Dict[str, DetailedCloudForecast] = Field(
        default_factory=dict
    )
    sun_phases: List[SunPeriod] = Field(default_factory=list)
    forecast_start_time: Optional[str] = None
    timeline_start: Optional[str] = None
    timeline_end: Optional[str] = None
    user_timezone: Optional[str] = None
    timeline_diagnostics: Dict[str, ModelTimelineDiagnostics] = Field(
        default_factory=dict
    )
    # Keyed by model name; Meteogram View caps each chain to these hours.
    model_availability: Dict[str, ModelAvailability] = Field(
        default_factory=dict
    )
    cloud_model_availability: Dict[str, ModelAvailability] = Field(
        default_factory=dict
    )
    # Set only for auto chain (normal mode) forecasts.
    auto_chain: Optional[AutoChainInfo] = None
    # UTC instant the forecast was generated; drawn below the meteogram.
    generated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    )


class MergedForecastResult(BaseModel):
    merged_timestamps: List[str]
    merged_values: List[float | None]
    merged_model_source: List[str]
    raw_data: List[RawForecastData]
