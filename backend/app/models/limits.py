"""Validation limits for mission inputs.

PROVISIONAL: these bounds are backend proposals awaiting confirmation from the
physics owner (see backend/docs/API_CONTRACT.md, "Open questions for physics").
They live in one place so they can be tuned without touching the models.
"""

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

STAY_DURATION_MAX_DAYS = 365.0
TIME_STEP_MIN_S = 60
TIME_STEP_MAX_S = 86_400

# Caps the time-series length so a full response stays well below the 6 MB
# synchronous AWS Lambda response payload limit (checked by tests).
MAX_SAMPLES = 10_000

# One synodic month (~29.5 days) covers a full lunar illumination cycle.
LAUNCH_DELAY_MAX_DAYS = 30
LAUNCH_DELAY_STEP_MAX_DAYS = 30

HARDWARE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$"
