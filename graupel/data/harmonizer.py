import logging
from typing import List, Dict, Optional
from .models import RawForecastData, DataPoint
from .quantities import target_units, variable_aliases
from .timeline import (
    canonical_timestamp,
    validate_timestamp_sequence,
)


logger = logging.getLogger(__name__)


class Harmonizer:
    """
    Normalizes/harmonizes raw weather forecast datasets with differing units,
    variable names, or temporal resolutions into a common schema: DataPoint(timestamp, value, unit, variable, model).
    """

    # Lower-case raw names -> quantity id, and target units (quantity registry).
    VARIABLE_MAPPING = variable_aliases()

    TARGET_UNITS = target_units()

    @classmethod
    def normalize_variable(cls, raw_variable: str) -> str:
        var_lower = raw_variable.lower()
        return cls.VARIABLE_MAPPING.get(var_lower, raw_variable)

    @classmethod
    def convert_value_and_unit(
        cls, value: Optional[float], from_unit: str, target_variable: str
    ) -> tuple[Optional[float], str]:
        target_unit = cls.TARGET_UNITS.get(target_variable, from_unit)
        if value is None:
            return None, target_unit

        unit_str = from_unit.strip().lower()

        # Temperature conversions
        if target_variable in ["temperature", "apparent_temperature"]:
            if unit_str in ["k", "kelvin"]:
                return round(value - 273.15, 2), "°C"
            elif unit_str in ["°f", "f", "fahrenheit"]:
                return round((value - 32) * 5 / 9, 2), "°C"
            return value, "°C"

        # Wind speed & gusts conversions
        if target_variable in ["wind_speed", "wind_gusts"]:
            if unit_str in ["m/s", "ms"]:
                return round(value * 3.6, 2), "km/h"
            elif unit_str in ["mph"]:
                return round(value * 1.60934, 2), "km/h"
            elif unit_str in ["knots", "kt"]:
                return round(value * 1.852, 2), "km/h"
            return value, "km/h"

        return value, target_unit

    @classmethod
    def harmonize_raw_data(cls, raw_data: RawForecastData) -> List[DataPoint]:
        """
        Converts a single RawForecastData into a list of harmonized DataPoints.
        """
        norm_variable = cls.normalize_variable(raw_data.variable)
        harmonized_points: List[DataPoint] = []

        canonical_timestamps = [
            canonical_timestamp(timestamp) for timestamp in raw_data.timestamps
        ]
        anomalies = validate_timestamp_sequence(
            canonical_timestamps,
            dataset_name=f"{raw_data.model_name} / {norm_variable}",
        )
        if anomalies:
            logger.warning(
                "%s / %s has %d non-hourly timestamp gap(s): %s",
                raw_data.model_name,
                norm_variable,
                len(anomalies),
                anomalies,
            )

        if len(raw_data.values) != len(canonical_timestamps):
            if not (len(raw_data.values) == 0 and norm_variable == "weather_code"):
                logger.warning(
                    "%s / %s timestamp/value length mismatch: %d timestamps, "
                    "%d values; missing values remain null and extra values are ignored",
                    raw_data.model_name,
                    norm_variable,
                    len(canonical_timestamps),
                    len(raw_data.values),
                )

        for index, ts in enumerate(canonical_timestamps):
            val = raw_data.values[index] if index < len(raw_data.values) else None
            norm_val, norm_unit = cls.convert_value_and_unit(
                val, raw_data.unit, norm_variable
            )
            data_point = DataPoint(
                timestamp=ts,
                value=norm_val,
                unit=norm_unit,
                variable=norm_variable,
                model=raw_data.model_name,
            )
            harmonized_points.append(data_point)

        return harmonized_points
