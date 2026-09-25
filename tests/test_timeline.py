from datetime import datetime, timedelta, timezone

import pytest

from graupel.data.timeline import (
    TimelineIntegrityError,
    build_hourly_timeline,
    canonical_timestamp,
    canonical_timestamp_ms,
    model_end_timestamp,
    parse_timestamp,
    resolve_timezone,
    validate_timestamp_sequence,
)


def test_equivalent_offsets_have_one_canonical_instant():
    utc = "2026-09-14T13:00:00Z"
    berlin = "2026-09-14T15:00:00+02:00"

    assert canonical_timestamp(berlin) == utc
    assert canonical_timestamp_ms(berlin) == canonical_timestamp_ms(utc)


def test_timezone_less_values_use_explicit_default_timezone():
    assert (
        canonical_timestamp("2026-09-14T15:00", "Europe/Berlin")
        == "2026-09-14T13:00:00Z"
    )


def test_duplicate_or_reversed_timestamps_are_rejected():
    with pytest.raises(TimelineIntegrityError, match="strictly increasing"):
        validate_timestamp_sequence(["2026-09-14T14:00Z", "2026-09-14T14:00Z"])


def test_missing_hour_is_reported_without_shifting_later_timestamp():
    timestamps = [
        "2026-09-14T14:00Z",
        "2026-09-14T16:00Z",
    ]

    anomalies = validate_timestamp_sequence(timestamps)

    assert len(anomalies) == 1
    assert anomalies[0]["actual_seconds"] == 2 * 60 * 60
    assert canonical_timestamp(timestamps[1]) == "2026-09-14T16:00:00Z"


def test_hourly_windows_and_model_horizons_are_half_open():
    start = "2026-09-14T00:00Z"
    end = model_end_timestamp(start, 3)

    assert end == "2026-09-14T03:00:00Z"
    assert build_hourly_timeline(start, end) == [
        "2026-09-14T00:00:00Z",
        "2026-09-14T01:00:00Z",
        "2026-09-14T02:00:00Z",
    ]


def test_dst_fallback_instants_remain_strictly_hourly_in_utc():
    # The local clock reads 02:30 twice on this date, but the explicit offsets
    # preserve two different instants separated by one real hour.
    timestamps = [
        "2026-10-25T02:30:00+02:00",
        "2026-10-25T02:30:00+01:00",
    ]

    assert (
        validate_timestamp_sequence(
            timestamps, expected_step=timedelta(hours=1)
        )
        == []
    )


@pytest.mark.parametrize(
    "tz_alias",
    [
        "GMT",
        "gmt",
        "UTC",
        "utc",
        "Etc/UTC",
        "etc/utc",
        "Etc/GMT",
        "etc/gmt",
        "Z",
        "z",
        " UTC ",
        "\tgmt\n",
    ],
)
def test_resolve_timezone_utc_aliases(tz_alias: str):
    resolved = resolve_timezone(tz_alias)
    assert resolved == timezone.utc


def test_resolve_timezone_iana():
    resolved = resolve_timezone("Europe/Berlin")
    assert resolved is not None
    dt = datetime(2026, 7, 1, 12, 0, tzinfo=resolved)
    assert dt.utcoffset() == timedelta(hours=2)


@pytest.mark.parametrize(
    "invalid_tz",
    [
        "Invalid/Timezone",
        "Europ/Berlin",
        "foo",
        "",
        "   ",
    ],
)
def test_resolve_timezone_invalid(invalid_tz: str):
    with pytest.raises(TimelineIntegrityError, match="Invalid"):
        resolve_timezone(invalid_tz)


@pytest.mark.parametrize(
    "tz_name",
    ["GMT", "UTC", "Etc/UTC", "Etc/GMT"],
)
def test_parse_timestamp_utc_defaults(tz_name: str):
    naive_str = "2026-09-14T12:00:00"
    canonical = canonical_timestamp(naive_str, default_timezone=tz_name)
    assert canonical == "2026-09-14T12:00:00Z"

    parsed = parse_timestamp(naive_str, default_timezone=tz_name)
    assert parsed == datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)


def test_parse_timestamp_explicit_utc_and_offsets():
    # Explicit Z and explicit offsets must not be overwritten by default_timezone
    ts_z = "2026-09-14T12:00:00Z"
    ts_offset_zero = "2026-09-14T12:00:00+00:00"
    ts_offset_plus2 = "2026-09-14T14:00:00+02:00"

    # Even if default_timezone is set to something else, explicit offset takes precedence
    assert (
        canonical_timestamp(ts_z, default_timezone="America/New_York")
        == "2026-09-14T12:00:00Z"
    )
    assert (
        canonical_timestamp(ts_offset_zero, default_timezone="Europe/Berlin")
        == "2026-09-14T12:00:00Z"
    )
    assert (
        canonical_timestamp(ts_offset_plus2, default_timezone="UTC")
        == "2026-09-14T12:00:00Z"
    )

    # Verify 14:00+02:00 and 12:00Z represent exact same instant
    dt_plus2 = parse_timestamp(ts_offset_plus2)
    dt_z = parse_timestamp(ts_z)
    assert dt_plus2 == dt_z


def test_get_user_timezone_derives_valid_tz(monkeypatch):
    from graupel.data.timeline import get_user_timezone, get_user_timezone_name

    tz_name = get_user_timezone_name()
    assert isinstance(tz_name, str)
    assert len(tz_name) > 0
    tz = get_user_timezone()
    assert tz is not None

    # Verify TZ environment override is respected
    monkeypatch.setenv("TZ", "America/New_York")
    assert get_user_timezone_name() == "America/New_York"
    assert get_user_timezone() == resolve_timezone("America/New_York")

    monkeypatch.setenv("TZ", "Asia/Tokyo")
    assert get_user_timezone_name() == "Asia/Tokyo"
    assert get_user_timezone() == resolve_timezone("Asia/Tokyo")
