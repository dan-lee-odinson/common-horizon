"""The approved preset landing sites (``GET /sites``).

The authoritative list is ``web/src/api/examples/sites.json`` (also read by the horizon-profile
scripts). The Docker image cannot reach ``web/``, so ``app/data/preset_sites.json`` is an exact copy,
checked against the original by ``tests/test_shared_data_copies.py``.
"""

import json
from functools import lru_cache
from pathlib import Path

from app.models.website import Site, SiteListResponse, normalize_lon_east

PRESET_SITES_FILE = Path(__file__).resolve().parents[1] / "data" / "preset_sites.json"


@lru_cache
def preset_sites() -> SiteListResponse:
    raw = json.loads(PRESET_SITES_FILE.read_text(encoding="utf-8"))
    sites = [
        Site(
            id=entry["id"],
            name=entry["name"],
            lat=entry["lat"],
            lon_east=normalize_lon_east(entry["lon_east"]),
            note=entry.get("note"),
            default_hardware=list(entry.get("default_hardware", [])),
        )
        for entry in raw["sites"]
    ]
    ids = [site.id for site in sites]
    if len(set(ids)) != len(ids):
        raise ValueError(f"{PRESET_SITES_FILE.name} repeats a site id")
    return SiteListResponse(sites=sites)
