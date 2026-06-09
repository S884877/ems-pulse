import httpx
import asyncio
from datetime import datetime, timedelta

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"

_cache: dict[str, dict] = {}
_cache_ttl: dict[str, datetime] = {}
CACHE_TTL = timedelta(hours=24)

async def reverse_geocode(lat: float, lng: float) -> dict:
    key = f"{lat:.4f},{lng:.4f}"
    now = datetime.utcnow()

    if key in _cache and _cache_ttl.get(key, now) > now:
        return _cache[key]

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lng, "format": "json", "addressdetails": 1},
            headers={"User-Agent": "PULSE-EMS/1.0 (ems-routing-app)"},
        )
        resp.raise_for_status()
        data = resp.json()

    result = {
        "display_name": data.get("display_name", ""),
        "name": (
            data.get("address", {}).get("hospital")
            or data.get("address", {}).get("amenity")
            or data.get("address", {}).get("name")
            or data.get("display_name", "").split(",")[0]
        ),
        "address": data.get("address", {}),
        "lat": lat,
        "lng": lng,
    }

    _cache[key] = result
    _cache_ttl[key] = now + CACHE_TTL
    await asyncio.sleep(1)
    return result
