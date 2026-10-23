"""App settings (system.md §8.1): defaults and validation.

Settings are stored as JSON values in the `app_settings` table, one row per
key. Rows that are missing or no longer valid read as the default.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Mapping

MODES = ("normal", "power")
ARCHIVE_RETENTION_CHOICES = (7, 30, 90, 365)  # days; None = forever

DEFAULT_SETTINGS: Dict[str, Any] = {
    "mode": "normal",
    # system.md §9.3: nothing is archived on disk unless the user enables it.
    "archive_enabled": False,
    "archive_retention_days": 365,
}


def _mode(value: Any) -> str:
    if value not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    return value


def _archive_enabled(value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError("archive_enabled must be true or false")
    return value


def _archive_retention_days(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool) or value not in ARCHIVE_RETENTION_CHOICES:
        raise ValueError(
            "archive_retention_days must be one of "
            f"{', '.join(map(str, ARCHIVE_RETENTION_CHOICES))} or null (forever)"
        )
    return int(value)


VALIDATORS: Dict[str, Callable[[Any], Any]] = {
    "mode": _mode,
    "archive_enabled": _archive_enabled,
    "archive_retention_days": _archive_retention_days,
}


def validate_settings(changes: Mapping[str, Any]) -> Dict[str, Any]:
    """Return the normalized changes; raise ValueError on any invalid entry.

    All entries are checked before anything is returned, so a partly
    invalid update is rejected as a whole.
    """
    if not isinstance(changes, Mapping):
        raise ValueError("settings changes must be an object")
    unknown = sorted(set(changes) - set(VALIDATORS))
    if unknown:
        raise ValueError(f"unknown setting(s): {', '.join(unknown)}")
    return {key: VALIDATORS[key](value) for key, value in changes.items()}
