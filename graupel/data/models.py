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


class MergedForecastResult(BaseModel):
    merged_timestamps: List[str]
    merged_values: List[float | None]
    merged_model_source: List[str]
    raw_data: List[RawForecastData]
