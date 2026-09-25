"""Canonical timestamp and forecast-window helpers.

All forecast joins use UTC instants.  Open-Meteo is requested in GMT, so a
timezone-less API timestamp is unambiguously UTC; callers handling another
source can provide its IANA timezone explicitly.

Forecast horizons are half-open intervals: ``[start, start + horizon)``.
Hourly values are start-stamped, so a 24 hour horizon contains samples at
hours 0 through 23 and its visual/model boundary is exactly hour 24.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo
import os
import sys
from typing import Iterable, Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import dateutil.parser


UTC = timezone.utc
HOUR = timedelta(hours=1)
_UTC_ALIASES = {"UTC", "GMT", "ETC/UTC", "ETC/GMT", "Z"}

_WINDOWS_TO_IANA = {
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Warsaw",
    "Romance Standard Time": "Europe/Paris",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "GTB Standard Time": "Europe/Bucharest",
    "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kyiv",
    "Israel Standard Time": "Asia/Jerusalem",
    "Arabic Standard Time": "Asia/Baghdad",
    "Arab Standard Time": "Asia/Riyadh",
    "Russian Standard Time": "Europe/Moscow",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "Pacific Standard Time": "America/Los_Angeles",
    "Alaskan Standard Time": "America/Anchorage",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "Tokyo Standard Time": "Asia/Tokyo",
    "China Standard Time": "Asia/Shanghai",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "India Standard Time": "Asia/Kolkata",
    "Singapore Standard Time": "Asia/Singapore",
    "Korea Standard Time": "Asia/Seoul",
    "New Zealand Standard Time": "Pacific/Auckland",
}


class TimelineIntegrityError(ValueError):
    """Raised when timestamps cannot safely participate in timeline joins."""


def resolve_timezone(value: str | tzinfo) -> tzinfo:
    """Resolve a timezone identifier string or object to a valid tzinfo instance.

    UTC/GMT aliases ('UTC', 'GMT', 'Etc/UTC', 'Etc/GMT', 'Z', case-insensitive)
    resolve directly to datetime.timezone.utc without relying on ZoneInfo or OS
    tzdata. Valid IANA timezone strings resolve via ZoneInfo.
    """
    if isinstance(value, tzinfo):
        return value

    if not isinstance(value, str):
        raise TimelineIntegrityError(f"Invalid timezone: {value!r}")

    normalized = value.strip()
    if not normalized:
        raise TimelineIntegrityError("Invalid empty timezone")

    if normalized.upper() in _UTC_ALIASES:
        return UTC

    try:
        return ZoneInfo(normalized)
    except Exception as error:
        raise TimelineIntegrityError(
            f"Invalid default timezone: {value!r}"
        ) from error


def get_user_timezone_name() -> str:
    """Derive the user's local IANA timezone name from Python environment and OS settings."""
    tz_env = os.environ.get("TZ")
    if tz_env:
        try:
            ZoneInfo(tz_env)
            return tz_env
        except Exception:
            pass

    if sys.platform == "win32":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SYSTEM\CurrentControlSet\Control\TimeZoneInformation",
            ) as key:
                val, _ = winreg.QueryValueEx(key, "TimeZoneKeyName")
                if val:
                    if val in _WINDOWS_TO_IANA:
                        return _WINDOWS_TO_IANA[val]
                    try:
                        ZoneInfo(val)
                        return val
                    except Exception:
                        pass
        except Exception:
            pass

    if os.path.exists("/etc/timezone"):
        try:
            with open("/etc/timezone", "r", encoding="utf-8") as f:
                cand = f.read().strip()
                if cand:
                    ZoneInfo(cand)
                    return cand
        except Exception:
            pass

    if os.path.exists("/etc/localtime"):
        try:
            real_path = os.path.realpath("/etc/localtime")
            for marker in ("/zoneinfo/", "/zoneinfo.default/"):
                if marker in real_path:
                    cand = real_path.split(marker)[-1]
                    ZoneInfo(cand)
                    return cand
        except Exception:
            pass

    local_dt = datetime.now().astimezone()
    tz = local_dt.tzinfo
    if tz and hasattr(tz, "key") and tz.key:
        try:
            ZoneInfo(tz.key)
            return tz.key
        except Exception:
            pass

    tzname = local_dt.tzname()
    if tzname:
        try:
            ZoneInfo(tzname)
            return tzname
        except Exception:
            pass

    offset = local_dt.utcoffset()
    if offset is not None:
        total_seconds = int(offset.total_seconds())
        if total_seconds == 0:
            return "UTC"
        hours = total_seconds // 3600
        # In IANA Etc/GMT, sign is inverted: Etc/GMT-2 is UTC+2
        iana_sign = "-" if hours >= 0 else "+"
        cand = f"Etc/GMT{iana_sign}{abs(hours)}"
        try:
            ZoneInfo(cand)
            return cand
        except Exception:
            pass

    return "UTC"


def get_user_timezone() -> tzinfo:
    """Derive the user's local tzinfo from Python environment and OS settings."""
    name = get_user_timezone_name()
    return resolve_timezone(name)


def parse_timestamp(
    value: str | datetime, default_timezone: str = "UTC"
) -> datetime:
    """Return an aware UTC datetime for an ISO timestamp or datetime."""
    try:
        parsed = (
            dateutil.parser.isoparse(value)
            if isinstance(value, str)
            else value
        )
    except (TypeError, ValueError) as error:
        raise TimelineIntegrityError(f"Invalid timestamp: {value!r}") from error

    if not isinstance(parsed, datetime):
        raise TimelineIntegrityError(f"Invalid timestamp: {value!r}")

    if parsed.tzinfo is None:
        tz = resolve_timezone(default_timezone)
        parsed = parsed.replace(tzinfo=tz)

    return parsed.astimezone(UTC)


def canonical_timestamp(
    value: str | datetime, default_timezone: str = "UTC"
) -> str:
    """Serialize a timestamp as an explicit UTC ISO-8601 instant."""
    parsed = parse_timestamp(value, default_timezone)
    return parsed.isoformat().replace("+00:00", "Z")


def canonical_timestamp_ms(
    value: str | datetime, default_timezone: str = "UTC"
) -> int:
    """Return integer Unix milliseconds for stable map keys and comparisons."""
    return round(parse_timestamp(value, default_timezone).timestamp() * 1000)


def validate_timestamp_sequence(
    timestamps: Sequence[str],
    *,
    expected_step: Optional[timedelta] = HOUR,
    dataset_name: str = "dataset",
) -> list[dict[str, object]]:
    """Validate strict ordering and report, but do not fill, spacing gaps."""
    parsed = [parse_timestamp(timestamp) for timestamp in timestamps]
    anomalies: list[dict[str, object]] = []

    for index in range(1, len(parsed)):
        delta = parsed[index] - parsed[index - 1]
        if delta <= timedelta(0):
            raise TimelineIntegrityError(
                f"{dataset_name}: timestamps must be strictly increasing; "
                f"index {index - 1}={timestamps[index - 1]!r}, "
                f"index {index}={timestamps[index]!r}"
            )
        if expected_step is not None and delta != expected_step:
            anomalies.append(
                {
                    "after_timestamp": canonical_timestamp(parsed[index - 1]),
                    "before_timestamp": canonical_timestamp(parsed[index]),
                    "actual_seconds": delta.total_seconds(),
                    "expected_seconds": expected_step.total_seconds(),
                }
            )

    return anomalies


def build_hourly_timeline(start: str | datetime, end: str | datetime) -> list[str]:
    """Build a half-open hourly timeline from absolute instants."""
    current = parse_timestamp(start)
    end_time = parse_timestamp(end)
    if end_time <= current:
        return []

    result: list[str] = []
    while current < end_time:
        result.append(canonical_timestamp(current))
        current += HOUR
    return result


def model_end_timestamp(start: str | datetime, horizon_hours: int) -> str:
    """Return the exclusive end instant for a configured model horizon."""
    return canonical_timestamp(parse_timestamp(start) + timedelta(hours=horizon_hours))


def normalize_timestamp_values(
    timestamps: Iterable[str], default_timezone: str = "UTC"
) -> list[str]:
    """Normalize a sequence without changing its order or filling gaps."""
    return [canonical_timestamp(value, default_timezone) for value in timestamps]
