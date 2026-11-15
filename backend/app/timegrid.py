"""Shared time-grid rules so validation and engines agree on the sample count."""

from collections.abc import Iterable
from datetime import datetime, timedelta

SECONDS_PER_DAY = 86_400.0
_EPSILON_S = 1e-6
_MICROSECOND = timedelta(microseconds=1)


def count_samples(duration_s: float, step_s: float) -> int:
    """Number of timestamps from start to end inclusive, stepping by ``step_s``.

    The end of the stay is always included, so a duration that is not a whole
    multiple of the step gets one extra (shorter) final interval.
    """
    full_steps, remainder = divmod(duration_s, step_s)
    return int(full_steps) + 1 + (1 if remainder > _EPSILON_S else 0)


def count_distinct_samples(duration_s: float, step_s: int, start_offsets_s: Iterable[float]) -> int:
    """Distinct timestamps across several grids, one starting at each offset (seconds) from a common start.

    Each grid is laid out exactly as ``build_time_grid`` does it, in whole microseconds, so a
    timestamp shared by two grids (for example when ``step_s`` divides a day and the offsets are
    whole days) is counted once. This is the number of Sun/Earth samples a launch-delay sweep
    computes when runs reuse shared timestamps.
    """
    full_steps, remainder = divmod(duration_s, step_s)
    step_us = timedelta(seconds=step_s) // _MICROSECOND
    grid = {k * step_us for k in range(int(full_steps) + 1)}
    if remainder > _EPSILON_S:
        grid.add(timedelta(seconds=duration_s) // _MICROSECOND)
    distinct: set[int] = set()
    for offset_s in start_offsets_s:
        shift = timedelta(seconds=offset_s) // _MICROSECOND
        distinct.update(sample + shift for sample in grid)
    return len(distinct)


def build_time_grid(start: datetime, duration_s: float, step_s: float) -> list[datetime]:
    end = start + timedelta(seconds=duration_s)
    full_steps, remainder = divmod(duration_s, step_s)
    grid = [start + timedelta(seconds=k * step_s) for k in range(int(full_steps) + 1)]
    if remainder > _EPSILON_S:
        grid.append(end)
    return grid
