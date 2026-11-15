"""Regression tests for the real-engine adapter (app.physics.engine_adapter).

MOCKED OUTPUT, NOT PHYSICS: unless a test says otherwise, Sun and Earth positions
come from ``FakeSky``, which places each body at a chosen azimuth, elevation and
distance from the observer, and the terrain comes from a small fixture profile.
These tests check the adapter's plumbing (unit conversions, terrain selection,
visibility states, alignment, metrics, errors). The opt-in test at the end runs the
real SPICE kernels; it is the only one whose numbers are physical.
"""

import json
import math
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.models.results import ObstructionState
from app.physics.engine_adapter import (
    EARTH_RADIUS_KM,
    SUN_RADIUS_KM,
    PhysicsEngineAdapter,
    ProfileIndex,
    central_distance_m,
    select_terrain,
    sky_visibility_fraction,
)
from app.physics.factory import get_physics_engine
from app.physics.horizon.geometry import MOON_RADIUS_M, local_frame
from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, HorizonProfile
from app.physics.interface import EngineContractError, PhysicsEngineUnavailable, SimulationRequest
from app.timegrid import build_time_grid

BACKEND_DIR = Path(__file__).resolve().parents[2]
URL = "/api/v1/missions/evaluate"
START = datetime(2027, 1, 15, tzinfo=UTC)
AU_KM = 149_597_870.7
EARTH_DISTANCE_KM = 384_400.0

# Fixture site: a 1 degree skyline with a 10 degree wall from azimuth 170 to 190.
SITE = {"site_id": "test-site", "latitude_deg": -85.0, "longitude_deg": 30.0, "site_height_m": 1000.0}
WALL = (170.0, 190.0)


def _fixture_profile_document(**overrides) -> dict:
    azimuths = [5.0 * k for k in range(72)]
    document = {
        "format": "common-horizon/horizon-profile",
        "format_version": 1,
        **SITE,
        "observer_height_m": 2.0,
        "reference_radius_m": 1737400.0,
        "frame": "MOON_ME",
        "coarse": False,
        "summary": {"rays_without_any_data": 0, "rays_ran_out_of_data": 0, "rays_with_skyline_at_first_sample": 3},
        "sampling": {"near_field_skipped_m": 60.0},
        "elevation_models": [{"file": "FIXTURE_DEM.TIF"}],
        "citation": "Test fixture, not real terrain.",
        "computed_utc": "2026-11-15T00:00:00Z",
        "azimuth_deg": azimuths,
        "horizon_elevation_deg": [10.0 if WALL[0] <= a <= WALL[1] else 1.0 for a in azimuths],
    }
    document.update(overrides)
    return document


@pytest.fixture
def profile_dir(tmp_path) -> Path:
    directory = tmp_path / "horizon"
    directory.mkdir()
    (directory / "test-site.json").write_text(json.dumps(_fixture_profile_document()), encoding="utf-8")
    return directory


Track = Callable[[datetime], tuple[tuple[float, float, float], tuple[float, float, float]]]


@dataclass
class FakeSky:
    """Injected ephemeris: each body at (azimuth, elevation, distance) from the observer. MOCK, not physics."""

    latitude_deg: float
    longitude_deg: float
    observer_radius_km: float
    track: Track
    calls: int = 0
    moments: list[datetime] = field(default_factory=list)

    def __call__(self, moment: datetime):
        self.calls += 1
        self.moments.append(moment)
        sun, earth = self.track(moment)
        return self.position(*sun), self.position(*earth)

    def site_km(self) -> tuple[float, float, float]:
        up, _, _ = local_frame(self.latitude_deg, self.longitude_deg)
        return tuple(c * self.observer_radius_km for c in up)

    def position(self, azimuth_deg: float, elevation_deg: float, distance_km: float) -> list[float]:
        up, east, north = local_frame(self.latitude_deg, self.longitude_deg)
        az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
        direction = [
            math.cos(el) * math.sin(az) * e + math.cos(el) * math.cos(az) * n + math.sin(el) * u
            for e, n, u in zip(east, north, up, strict=True)
        ]
        return [s + distance_km * d for s, d in zip(self.site_km(), direction, strict=True)]


def _fixed(sun: tuple[float, float, float], earth: tuple[float, float, float]) -> Track:
    return lambda _moment: (sun, earth)


def _observer_radius_km(site_height_m: float, observer_height_m: float) -> float:
    return (MOON_RADIUS_M + site_height_m + observer_height_m) / 1000.0


def _sky_at_fixture(track: Track) -> FakeSky:
    return FakeSky(SITE["latitude_deg"], SITE["longitude_deg"], _observer_radius_km(SITE["site_height_m"], 2.0), track)


def _request(**overrides) -> SimulationRequest:
    values = {
        "latitude_deg": SITE["latitude_deg"],
        "longitude_deg": SITE["longitude_deg"],
        "altitude_m": None,
        "observer_height_m": 2.0,
        "start_utc": START,
        "duration_s": 6 * 3600.0,
        "time_step_s": 3600,
        "include_timeseries": True,
    }
    values.update(overrides)
    return SimulationRequest(**values)


# ------------------------------------------------------------------------------- missing data


def test_missing_kernel_directory_is_unavailable_and_hides_the_path(tmp_path, profile_dir):
    adapter = PhysicsEngineAdapter(spice_kernel_dir=tmp_path / "nowhere", horizon_profile_dir=profile_dir)

    with pytest.raises(PhysicsEngineUnavailable, match="SPICE kernel directory not found") as error:
        adapter.simulate(_request())
    assert str(tmp_path) not in str(error.value)
    assert adapter.info.available is False
    assert adapter.info.is_synthetic is False


def test_missing_kernel_files_are_named(tmp_path, profile_dir):
    kernels = tmp_path / "spice"
    kernels.mkdir()
    (kernels / "naif0012.tls").write_text("not a real kernel", encoding="utf-8")
    (kernels / "NAIF0012.TLS.bak").write_text("", encoding="utf-8")
    adapter = PhysicsEngineAdapter(spice_kernel_dir=kernels, horizon_profile_dir=profile_dir)

    with pytest.raises(PhysicsEngineUnavailable) as error:
        adapter.simulate(_request())
    message = str(error.value)
    assert "de440s.bsp" in message
    assert "moon_pa_de440_200625.bpc" in message
    assert "moon_de440_250416.tf" in message
    assert "naif0012.tls" not in message
    assert adapter.info.available is False


def test_missing_profile_directory_is_unavailable_not_smooth_sphere(tmp_path):
    adapter = PhysicsEngineAdapter(horizon_profile_dir=tmp_path / "no-profiles", body_positions=lambda _: None)

    with pytest.raises(PhysicsEngineUnavailable, match="horizon profiles are missing"):
        adapter.simulate(_request())
    assert adapter.info.available is False


def test_empty_profile_directory_is_unavailable(tmp_path):
    with pytest.raises(PhysicsEngineUnavailable, match="holds no profiles"):
        ProfileIndex.load(tmp_path)


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("{not json", "unreadable"),
        (json.dumps(_fixture_profile_document(frame="J2000")), "frame 'J2000'"),
        (json.dumps(_fixture_profile_document(reference_radius_m=1738000.0)), "reference radius"),
        (json.dumps(_fixture_profile_document(site_id="other-site")), "does not match its file name"),
        (json.dumps(_fixture_profile_document(horizon_elevation_deg=[1.0])), "unreadable"),
    ],
)
def test_invalid_stored_profile_is_an_explicit_error(tmp_path, content, message):
    (tmp_path / "test-site.json").write_text(content, encoding="utf-8")
    with pytest.raises(PhysicsEngineUnavailable, match=message):
        ProfileIndex.load(tmp_path)


def test_non_finite_ephemeris_position_is_a_contract_error(profile_dir):
    adapter = PhysicsEngineAdapter(
        horizon_profile_dir=profile_dir, body_positions=lambda _: ([math.nan, 0.0, 0.0], [1e6, 0.0, 0.0])
    )
    with pytest.raises(EngineContractError, match="three finite numbers"):
        adapter.simulate(_request())


def test_naive_start_time_is_rejected(profile_dir):
    adapter = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=lambda _: None)
    with pytest.raises(ValueError, match="timezone-aware"):
        adapter.simulate(_request(start_utc=datetime(2027, 1, 15)))  # naive on purpose


# --------------------------------------------------------------------------- terrain selection


def test_stored_profile_is_used_for_its_own_site_and_observer(profile_dir):
    sky = _sky_at_fixture(_fixed((90.0, 20.0, AU_KM), (0.0, 5.0, EARTH_DISTANCE_KM)))
    result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky).simulate(_request())

    assert result.site.elevation_m == SITE["site_height_m"]
    assert result.site.elevation_source == "terrain_model"
    assert result.site.slope_deg is None
    assert result.terrain_skyline is not None
    assert result.terrain_skyline.azimuth_deg == [5.0 * k for k in range(72)]
    assert max(result.terrain_skyline.horizon_elevation_deg) == 10.0
    assert not any("NOT included" in warning for warning in result.warnings)
    assert any("within 60 m" in warning for warning in result.warnings)
    assert any("3 of 72 azimuths" in warning for warning in result.warnings)
    assert any("slope_deg is null" in warning for warning in result.warnings)
    assert any("'test-site'" in source and "FIXTURE_DEM.TIF" in source for source in result.sources)
    assert any("INJECTED TEST POSITIONS" in source for source in result.sources)
    assert result.metrics.sky_visibility_fraction == pytest.approx(
        sky_visibility_fraction(ProfileIndex.load(profile_dir).profiles[0])
    )


def test_matching_supplied_altitude_keeps_the_profile_and_reports_input(profile_dir):
    terrain = select_terrain(ProfileIndex.load(profile_dir), _request(altitude_m=1000.3))
    assert terrain.stored is True
    assert terrain.site_height_m == 1000.3
    assert terrain.elevation_source == "input"


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"latitude_deg": SITE["latitude_deg"] + 0.002}, "within 50 m"),  # about 61 m north
        ({"observer_height_m": 0.0}, "observer 2 m above the surface, not 0 m"),
        ({"altitude_m": 1200.0}, "differs from the site height"),
    ],
)
def test_incompatible_profile_falls_back_to_smooth_sphere_with_a_warning(profile_dir, overrides, reason):
    terrain = select_terrain(ProfileIndex.load(profile_dir), _request(**overrides))

    assert terrain.stored is False
    assert terrain.skyline is None
    assert terrain.sky_visibility_fraction is None
    assert "Local terrain is NOT included" in terrain.warnings[0]
    assert reason in terrain.warnings[0]
    assert terrain.sources == ("Terrain: none (smooth sphere through the site, geometric horizon dip only).",)


def test_unknown_elevation_is_a_labelled_placeholder_not_a_measurement(profile_dir):
    terrain = select_terrain(ProfileIndex.load(profile_dir), _request(latitude_deg=10.0, longitude_deg=20.0))
    assert terrain.site_height_m == 0.0
    assert terrain.elevation_source == "synthetic_default"
    assert any("Site elevation is unknown" in warning for warning in terrain.warnings)

    supplied = select_terrain(ProfileIndex.load(profile_dir), _request(latitude_deg=10.0, altitude_m=-1500.0))
    assert supplied.site_height_m == -1500.0
    assert supplied.elevation_source == "input"
    assert not any("Site elevation is unknown" in warning for warning in supplied.warnings)


def test_smooth_sphere_horizon_is_the_geometric_dip(profile_dir):
    terrain = select_terrain(ProfileIndex.load(profile_dir), _request(latitude_deg=0.0, observer_height_m=2.0))
    # -arccos(R / (R + 2 m)) on the 1737.4 km sphere (site height unknown: the 0 m placeholder).
    dip = -math.degrees(math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 2.0)))
    assert dip == pytest.approx(-0.086937, abs=1e-6)
    assert terrain.profile.max_elevation_deg == pytest.approx(dip, abs=1e-12)
    assert terrain.profile.min_elevation_deg == pytest.approx(dip, abs=1e-12)


def test_longitudes_east_of_180_match_a_profile_stored_in_0_to_360():
    assert central_distance_m(-89.684, 196.739, -89.684, 196.739 - 360.0) == pytest.approx(0.0, abs=1e-6)
    assert central_distance_m(0.0, 0.0, 0.0, 1.0) == pytest.approx(MOON_RADIUS_M * math.pi / 180.0)


def test_every_stored_profile_in_the_repository_loads_and_selects_itself():
    """Deployment data check: the profiles shipped in backend/data/horizon are valid and found."""
    index = ProfileIndex.load(DEFAULT_PROFILE_DIR)
    assert {p.site_id for p in index.profiles} >= {"shackleton-ridge", "nobile", "im-2-athena", "im-1-odysseus"}
    for profile in index.profiles:
        longitude = profile.longitude_deg - 360.0 if profile.longitude_deg > 180.0 else profile.longitude_deg
        terrain = select_terrain(index, _request(latitude_deg=profile.latitude_deg, longitude_deg=longitude))
        assert terrain.stored is True, profile.site_id
        assert terrain.profile.site_id == profile.site_id
        assert 0.0 < terrain.sky_visibility_fraction <= 1.0


def test_sky_visibility_fraction_is_the_solid_angle_above_the_skyline():
    flat = HorizonProfile.smooth_sphere()  # skyline below the horizontal everywhere
    assert sky_visibility_fraction(flat) == 1.0
    raised = HorizonProfile(
        site_id="x",
        latitude_deg=0.0,
        longitude_deg=0.0,
        site_height_m=0.0,
        observer_height_m=2.0,
        azimuth_deg=(0.0, 90.0, 180.0, 270.0),
        horizon_elevation_deg=(30.0, 30.0, 30.0, 30.0),
    )
    assert sky_visibility_fraction(raised) == pytest.approx(0.5)  # 1 - sin(30 degrees)


# ------------------------------------------------------------------- geometry and visibility


def test_positions_directions_and_angles_survive_the_conversion(profile_dir):
    sky = _sky_at_fixture(_fixed((123.456, 20.5, AU_KM), (301.0, 4.25, EARTH_DISTANCE_KM)))
    result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky).simulate(_request())

    series = result.timeseries
    assert series is not None and series.frame == "MOON_ME"
    assert series.sun.azimuth_deg[0] == pytest.approx(123.456, abs=1e-6)
    assert series.sun.elevation_deg[0] == pytest.approx(20.5, abs=1e-6)
    assert series.earth.azimuth_deg[0] == pytest.approx(301.0, abs=1e-6)
    assert series.earth.elevation_deg[0] == pytest.approx(4.25, abs=1e-6)

    sun_km, earth_km = sky(START)
    assert series.sun.position_km[0] == pytest.approx(sun_km, abs=1e-3)  # Moon-centred, km
    assert series.earth.position_km[0] == pytest.approx(earth_km, abs=1e-3)
    site = sky.site_km()
    offset = [e - s for e, s in zip(earth_km, site, strict=True)]
    norm = math.sqrt(sum(c * c for c in offset))
    assert series.earth.direction_unit[0] == pytest.approx([c / norm for c in offset], abs=1e-8)  # from the observer
    assert math.sqrt(sum(c * c for c in series.sun.direction_unit[0])) == pytest.approx(1.0, abs=1e-8)


@pytest.mark.parametrize(
    ("sun", "fraction", "state"),
    [
        ((90.0, 5.0), 1.0, ObstructionState.VISIBLE),  # clear of the 1 degree skyline
        ((180.0, 5.0), 0.0, ObstructionState.TERRAIN_BLOCKED),  # behind the 10 degree wall
        ((90.0, 1.0), 0.5, ObstructionState.PARTIAL),  # centre on the skyline
        ((90.0, -2.0), 0.0, ObstructionState.BELOW_HORIZON),
    ],
)
def test_sun_visibility_states_against_the_stored_skyline(profile_dir, sun, fraction, state):
    sky = _sky_at_fixture(_fixed((*sun, AU_KM), (0.0, 30.0, EARTH_DISTANCE_KM)))
    result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky).simulate(_request())
    assert result.timeseries.sun.visibility_fraction[0] == pytest.approx(fraction, abs=1e-6)
    assert result.timeseries.sun.obstruction_state[0] == state


def test_disc_radius_follows_the_distance_at_each_sample(profile_dir):
    # Earth's centre 0.9 degrees above the 1 degree skyline: hidden in part at its mean distance
    # (radius 0.95 degrees), clear when it is twice as far (radius 0.475 degrees).
    near = _sky_at_fixture(_fixed((90.0, 20.0, AU_KM), (90.0, 1.9, EARTH_DISTANCE_KM)))
    far = _sky_at_fixture(_fixed((90.0, 20.0, AU_KM), (90.0, 1.9, 2 * EARTH_DISTANCE_KM)))
    near_result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=near).simulate(_request())
    far_result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=far).simulate(_request())

    assert math.degrees(math.asin(EARTH_RADIUS_KM / EARTH_DISTANCE_KM)) == pytest.approx(0.9507, abs=1e-4)
    assert near_result.timeseries.earth.obstruction_state[0] == ObstructionState.PARTIAL
    assert far_result.timeseries.earth.obstruction_state[0] == ObstructionState.VISIBLE
    assert math.degrees(math.asin(SUN_RADIUS_KM / AU_KM)) == pytest.approx(0.2665, abs=1e-4)


# ------------------------------------------------------------------ time series and metrics


def test_time_series_is_aligned_with_the_backend_grid_including_a_short_last_step(profile_dir):
    sky = _sky_at_fixture(_fixed((90.0, 20.0, AU_KM), (0.0, 5.0, EARTH_DISTANCE_KM)))
    request = _request(duration_s=2.5 * 3600, time_step_s=3600)
    result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky).simulate(request)

    expected = build_time_grid(START, 2.5 * 3600, 3600)
    assert result.timeseries.timestamps_utc == expected
    assert expected[-1] == START + timedelta(hours=2.5)
    assert sky.moments == expected  # SPICE was asked for exactly these instants
    for body in (result.timeseries.sun, result.timeseries.earth):
        assert len(body.position_km) == len(body.visibility_fraction) == len(body.obstruction_state) == 4


def test_metrics_and_windows_come_from_the_computed_series(profile_dir):
    # The Sun is up for the first 3 hours, then behind the wall. Earth sets after 2 hours.
    def track(moment):
        hours = (moment - START).total_seconds() / 3600
        sun = (90.0, 5.0, AU_KM) if hours < 3 else (180.0, 5.0, AU_KM)
        earth = (0.0, 5.0, EARTH_DISTANCE_KM) if hours < 2 else (0.0, -5.0, EARTH_DISTANCE_KM)
        return sun, earth

    result = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=_sky_at_fixture(track)).simulate(
        _request(duration_s=6 * 3600)
    )
    metrics = result.metrics
    assert metrics.sunlight_hours == pytest.approx(3.0)
    assert metrics.sunlight_percentage == pytest.approx(50.0)
    assert metrics.longest_darkness_hours == pytest.approx(3.0)
    assert metrics.time_to_sunset_hours == pytest.approx(3.0)
    assert metrics.earth_visibility_hours == pytest.approx(2.0)
    assert metrics.time_to_earthset_hours == pytest.approx(2.0)
    assert [(w.start_utc, w.end_utc) for w in result.communication_windows] == [(START, START + timedelta(hours=2))]
    assert result.timeseries.sun.obstruction_state[4] == ObstructionState.TERRAIN_BLOCKED
    assert result.timeseries.earth.obstruction_state[4] == ObstructionState.BELOW_HORIZON


def test_metric_only_runs_skip_the_series_and_reuse_overlapping_samples(profile_dir):
    def track(moment):
        hours = (moment - START).total_seconds() / 3600
        return (90.0 if hours % 5 < 3 else 180.0, 5.0, AU_KM), (0.0, 5.0 - hours % 4, EARTH_DISTANCE_KM)

    sky = _sky_at_fixture(track)
    adapter = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky)
    day = 86_400.0
    full = adapter.simulate(_request(duration_s=2 * day))
    calls_after_full = sky.calls

    shifted = adapter.simulate(
        _request(start_utc=START + timedelta(days=1), duration_s=2 * day, include_timeseries=False)
    )

    assert shifted.timeseries is None
    assert shifted.terrain_skyline is None
    # The first day of the shifted run was already sampled: only the 24 new hours are computed.
    assert sky.calls - calls_after_full == 24

    fresh = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=_sky_at_fixture(track)).simulate(
        _request(start_utc=START + timedelta(days=1), duration_s=2 * day)
    )
    assert shifted.metrics == fresh.metrics
    assert shifted.communication_windows == fresh.communication_windows
    assert full.metrics != shifted.metrics or full.communication_windows != shifted.communication_windows


def test_cache_is_not_shared_between_sites(profile_dir):
    sky = _sky_at_fixture(_fixed((90.0, 5.0, AU_KM), (0.0, 5.0, EARTH_DISTANCE_KM)))
    adapter = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky)
    adapter.simulate(_request(include_timeseries=False))
    calls = sky.calls
    adapter.simulate(_request(latitude_deg=0.0, include_timeseries=False))
    assert sky.calls - calls == 7  # every sample recomputed for the other site


# ------------------------------------------------------------------------------- API level


def test_evaluate_endpoint_labels_adapter_output_as_physics_with_sources(app, client, mission_payload, profile_dir):
    sky = _sky_at_fixture(_fixed((90.0, 5.0, AU_KM), (0.0, 5.0, EARTH_DISTANCE_KM)))
    adapter = PhysicsEngineAdapter(horizon_profile_dir=profile_dir, body_positions=sky)
    app.dependency_overrides[get_physics_engine] = lambda: adapter
    mission_payload["landing_site"] = {"latitude_deg": SITE["latitude_deg"], "longitude_deg": SITE["longitude_deg"]}
    mission_payload["launch_delay_days"] = 2
    mission_payload["hardware_requirements"] = {"min_sunlight_percentage": 50, "max_slope_deg": 10}

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert response.headers["X-Data-Source"] == "physics_engine"
    assert body["provenance"]["is_synthetic"] is False
    assert body["provenance"]["engine_name"] == "common-horizon-physics"
    assert any("INJECTED TEST POSITIONS" in source for source in body["provenance"]["sources"])
    assert body["site"]["elevation_source"] == "terrain_model"
    assert body["terrain_skyline"] is not None
    assert [case["launch_delay_days"] for case in body["launch_delay_results"]] == [0, 1, 2]
    slope = next(r for r in body["requirement_results"] if r["requirement"] == "max_slope_deg")
    assert slope["actual"] is None
    assert slope["passed"] is None  # unknown slope is never a pass
    assert body["requirements_passed"] is None


def test_largest_response_still_fits_the_lambda_payload_limit(app, client, mission_payload, profile_dir):
    from app.models import limits

    sky = _sky_at_fixture(lambda m: ((m.minute * 6.0, 1.0, AU_KM), (m.minute * 6.0, 0.5, EARTH_DISTANCE_KM)))
    app.dependency_overrides[get_physics_engine] = lambda: PhysicsEngineAdapter(
        horizon_profile_dir=profile_dir, body_positions=sky
    )
    mission_payload["landing_site"] = {"latitude_deg": SITE["latitude_deg"], "longitude_deg": SITE["longitude_deg"]}
    mission_payload["time_step_s"] = 60
    mission_payload["stay_duration_days"] = (limits.MAX_SAMPLES - 1) * 60 / 86_400

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 200, response.text
    assert len(response.json()["timeseries"]["timestamps_utc"]) == limits.MAX_SAMPLES
    assert len(response.content) < 6 * 1024 * 1024


def test_adapter_does_not_import_offline_dem_code():
    """rasterio-based terrain generation must stay out of the service at run time."""
    code = (
        "import sys; import app.physics.engine_adapter as a; "
        "import app.physics.engine.positions, app.physics.engine.frames, app.physics.engine.kernel_loader; "
        "bad = [m for m in ('rasterio', 'app.physics.engine.terrain', 'app.physics.engine.horizon', "
        "'app.physics.horizon.compute', 'app.physics.horizon.dem') if m in sys.modules]; "
        "print(bad); sys.exit(1 if bad else 0)"
    )
    completed = subprocess.run(
        [sys.executable, "-c", code], check=False, cwd=BACKEND_DIR, capture_output=True, text=True
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


# ----------------------------------------------------- opt-in: REAL SPICE kernels (physical output)

KERNEL_DIR = os.environ.get("CH_SPICE_KERNEL_DIR") or os.environ.get("CH_NAIF_DIR")


@pytest.mark.skipif(not KERNEL_DIR, reason="set CH_SPICE_KERNEL_DIR to the four NAIF kernels to run the real-sky check")
def test_real_kernels_reproduce_the_stored_2027_check_at_shackleton_ridge():
    """PHYSICAL OUTPUT: real SPICE kernels and the stored profile, compared with an independent run.

    ``backend/data/horizon_validation/results_2027.json`` was produced by scripts/validate_horizon.py
    (hourly, 2027, the engine's position functions). The adapter must agree with it, and its angles
    must agree with the engine's own ``compute_sun_earth_angles``.
    """
    from app.physics.engine.ephemeris import compute_sun_earth_angles

    stored = json.loads((BACKEND_DIR / "data/horizon_validation/results_2027.json").read_text(encoding="utf-8"))
    expected = stored["sites"]["shackleton-ridge"]["results"]["terrain"]
    adapter = PhysicsEngineAdapter(spice_kernel_dir=KERNEL_DIR)
    request = SimulationRequest(
        latitude_deg=-89.684,
        longitude_deg=196.739 - 360.0,
        altitude_m=None,
        observer_height_m=2.0,
        start_utc=datetime(2027, 1, 1, tzinfo=UTC),
        duration_s=8759 * 3600.0,  # 8760 hourly samples, as in the stored check
        time_step_s=3600,
    )

    result = adapter.simulate(request)

    assert result.site.elevation_source == "terrain_model"
    assert result.metrics.sunlight_percentage == pytest.approx(expected["sun_any_part_visible_percent"], abs=0.05)
    assert result.metrics.earth_visibility_percentage == pytest.approx(
        expected["earth_any_part_visible_percent"], abs=0.05
    )
    assert result.metrics.longest_darkness_hours == pytest.approx(expected["longest_dark_period_hours"], abs=1.0)

    angles = compute_sun_earth_angles(-89.684, 196.739, request.start_utc, 48 * 3600.0, 3600.0)
    for k, sample in enumerate(angles):
        assert result.timeseries.sun.elevation_deg[k] == pytest.approx(sample["sun_elevation_deg"], abs=0.01)
        assert result.timeseries.earth.elevation_deg[k] == pytest.approx(sample["earth_elevation_deg"], abs=0.01)
        sun_azimuth_gap = (result.timeseries.sun.azimuth_deg[k] - sample["sun_azimuth_deg"] + 180.0) % 360.0 - 180.0
        assert abs(sun_azimuth_gap) < 0.01
