"""Mission metrics and communication windows from a sampled visibility time series.

Pure Python, no physics: it only aggregates the per-sample disc fractions that the
engine adapter computed. The rules are the ones documented in
``backend/docs/API_CONTRACT.md``:

* a body counts as visible at a sample when any part of its disc is above the
  skyline (``visibility_fraction > 0``);
* sample-and-hold: interval ``k`` runs from ``times[k]`` to ``times[k + 1]`` and
  takes the state sampled at ``times[k]``. Every interval is weighted by its own
  duration, so the shorter final interval of a stay that is not a whole number of
  steps counts for exactly its length;
* durations are summed as ``timedelta`` values (whole microseconds), so the
  percentages cannot exceed 100 through floating-point rounding.

The resolution of every duration and event time is one time step.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta

from app.models.results import MissionMetrics, TimeWindow

_SECONDS_PER_HOUR = 3600.0


def _hours(span: timedelta) -> float:
    return span.total_seconds() / _SECONDS_PER_HOUR


def interval_runs(times: Sequence[datetime], flags: Sequence[bool]) -> list[tuple[int, int]]:
    """Index pairs ``(i, j)``: intervals ``i .. j-1`` all start with ``flags`` true.

    The run spans ``times[i]`` to ``times[j]``. ``flags`` has one entry per sample;
    the last sample's flag starts no interval and therefore never extends a run.
    """
    if len(times) != len(flags):
        raise ValueError("times and flags must have the same length")
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for k in range(len(times) - 1):
        if flags[k] and start is None:
            start = k
        elif not flags[k] and start is not None:
            runs.append((start, k))
            start = None
    if start is not None:
        runs.append((start, len(times) - 1))
    return runs


def _span(times: Sequence[datetime], run: tuple[int, int]) -> timedelta:
    return times[run[1]] - times[run[0]]


def _first_set(times: Sequence[datetime], visible: Sequence[bool]) -> tuple[float | None, datetime | None]:
    """Hours from the start to the first sample where a body visible at the start is no longer visible.

    ``(None, None)`` when the body is not visible at the start or never sets during the stay.
    """
    if not visible[0]:
        return None, None
    for k, is_visible in enumerate(visible):
        if not is_visible:
            return _hours(times[k] - times[0]), times[k]
    return None, None


def summarise(
    times: Sequence[datetime],
    sun_fraction: Sequence[float],
    earth_fraction: Sequence[float],
    sky_visibility_fraction: float | None,
) -> tuple[MissionMetrics, list[TimeWindow]]:
    """Metrics and Earth communication windows for one stay.

    ``sky_visibility_fraction`` is passed through unchanged (``None`` when terrain is not modelled).
    """
    if len(times) < 2:
        raise ValueError("at least two samples are needed")
    if not (len(times) == len(sun_fraction) == len(earth_fraction)):
        raise ValueError("times and fractions must have the same length")

    total = times[-1] - times[0]
    if total <= timedelta(0):
        raise ValueError("times must be increasing")

    sun_visible = [fraction > 0.0 for fraction in sun_fraction]
    earth_visible = [fraction > 0.0 for fraction in earth_fraction]

    sun_runs = interval_runs(times, sun_visible)
    dark_runs = interval_runs(times, [not visible for visible in sun_visible])
    earth_runs = interval_runs(times, earth_visible)

    sunlit = sum((_span(times, run) for run in sun_runs), timedelta(0))
    earth = sum((_span(times, run) for run in earth_runs), timedelta(0))

    time_to_sunset, sunset_utc = _first_set(times, sun_visible)
    time_to_earthset, earthset_utc = _first_set(times, earth_visible)

    metrics = MissionMetrics(
        sunlight_hours=_hours(sunlit),
        sunlight_percentage=min(100.0, 100.0 * (sunlit / total)),
        longest_sunlight_hours=_hours(max((_span(times, run) for run in sun_runs), default=timedelta(0))),
        longest_darkness_hours=_hours(max((_span(times, run) for run in dark_runs), default=timedelta(0))),
        earth_visibility_hours=_hours(earth),
        earth_visibility_percentage=min(100.0, 100.0 * (earth / total)),
        sky_visibility_fraction=sky_visibility_fraction,
        time_to_sunset_hours=time_to_sunset,
        sunset_utc=sunset_utc,
        time_to_earthset_hours=time_to_earthset,
        earthset_utc=earthset_utc,
    )
    windows = [
        TimeWindow(start_utc=times[i], end_utc=times[j], duration_hours=_hours(_span(times, (i, j))))
        for i, j in earth_runs
    ]
    return metrics, windows
