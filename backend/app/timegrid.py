"""Shared time-grid rules so validation and engines agree on the sample count."""

from datetime import datetime, timedelta

SECONDS_PER_DAY = 86_400.0
_EPSILON_S = 1e-6


def count_samples(duration_s: float, step_s: float) -> int:
    """Number of timestamps from start to end inclusive, stepping by ``step_s``.

    The end of the stay is always included, so a duration that is not a whole
    multiple of the step gets one extra (shorter) final interval.
    """
    full_steps, remainder = divmod(duration_s, step_s)
    return int(full_steps) + 1 + (1 if remainder > _EPSILON_S else 0)


def build_time_grid(start: datetime, duration_s: float, step_s: float) -> list[datetime]:
    end = start + timedelta(seconds=duration_s)
    full_steps, remainder = divmod(duration_s, step_s)
    grid = [start + timedelta(seconds=k * step_s) for k in range(int(full_steps) + 1)]
    if remainder > _EPSILON_S:
        grid.append(end)
    return grid
