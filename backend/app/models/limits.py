"""Validation limits for mission inputs.

PROVISIONAL: these bounds are backend proposals not yet validated against the
physics engine (see backend/docs/API_CONTRACT.md, "Provisional technical assumptions").
They live in one place so they can be tuned without touching the models.
"""

import os
from datetime import UTC, datetime

LATITUDE_MIN_DEG = -90.0
LATITUDE_MAX_DEG = 90.0
LONGITUDE_MIN_DEG = -180.0
LONGITUDE_MAX_DEG = 180.0

# Site elevation relative to the 1737.4 km lunar reference sphere used by LOLA.
# Lunar topography spans roughly -9.1 km to +10.8 km; the bounds add a margin.
ALTITUDE_MIN_M = -10_000.0
ALTITUDE_MAX_M = 11_000.0

OBSERVER_HEIGHT_MIN_M = 0.0
OBSERVER_HEIGHT_MAX_M = 1_000.0

# Supported mission window. Must stay inside the ephemeris kernel coverage of the engine.
MISSION_WINDOW_START_UTC = datetime(2000, 1, 1, tzinfo=UTC)
MISSION_WINDOW_END_UTC = datetime(2100, 1, 1, tzinfo=UTC)

# One Julian year (365.25 d), matching the website. MAX_SAMPLES still bounds the response size.
STAY_DURATION_MAX_DAYS = 365.25
TIME_STEP_MIN_S = 60
TIME_STEP_MAX_S = 86_400

# Caps the time-series length so a full response stays well below the 6 MB
# synchronous AWS Lambda response payload limit (checked by tests).
MAX_SAMPLES = 10_000


def _positive_int_from_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = int(raw)  # a malformed value stops the service at start-up instead of being ignored
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


# Work budget of one evaluation: distinct Sun/Earth sample timestamps over the baseline and every
# launch-delay case together (two cases share timestamps when the delay between them is a whole number of time steps). Sized for the
# Lambda deployment (512 MB, 60 s timeout, about a third of a vCPU): about 7 s for the real engine on
# a laptop at a polar site, leaving room for slower Lambda CPU. Not yet measured on Lambda.
MAX_TOTAL_SAMPLES = _positive_int_from_env("CH_MAX_TOTAL_SAMPLES", 20_000)

# One synodic month (~29.5 days) covers a full lunar illumination cycle.
LAUNCH_DELAY_MAX_DAYS = 30
LAUNCH_DELAY_STEP_MAX_DAYS = 30

HARDWARE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$"

# ---- Website API (GET /sites, GET /catalog, POST /check, POST /evaluate) ----
# Site ids include custom points typed on the website, e.g. "custom:-89.6840:196.7390".
SITE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,79}$"
SITE_NAME_MAX_LENGTH = 120
# East-positive longitude as the website sends it: 0..360, with -180..0 also accepted and normalised.
LON_EAST_MIN_DEG = -180.0
LON_EAST_MAX_DEG = 360.0
MAX_SITES_PER_EVALUATION = 25
# The website's own bounds (web/src/state/app.ts: MIN_STAY_DAYS, MAX_STORAGE_KWH).
STAY_MIN_DAYS = 1.0
MAX_STORAGE_KWH = 1_000_000.0
# Upper limit on the count of one catalog item in a request (a request limit, not a hardware figure).
MAX_HARDWARE_COUNT = 10
# Transit time (launch to landing) the caller may state; the team has not fixed one (see the report).
TRANSIT_MAX_DAYS = 30.0
# All sites of one POST /evaluate together may use at most this many samples; the time step grows
# (from one hour) to stay inside it, so 17 sites x 365 days cannot exceed the Lambda timeout.
WEBSITE_MAX_TOTAL_SAMPLES = 20_000
