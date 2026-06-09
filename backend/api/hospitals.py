from fastapi import APIRouter, HTTPException, Query
from services.supabase import get_supabase
from engine.predictor import predict_wall_time
from datetime import datetime, timezone, timedelta
import math

router = APIRouter()

DRIVE_SPEED_MPH = 40

async def get_reports_for_hospital(sb, hospital_id: str) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    result = sb.table("reports") \
        .select("*") \
        .eq("hospital_id", hospital_id) \
        .gte("created_at", cutoff) \
        .execute()
    reports = result.data or []
    for r in reports:
        if isinstance(r.get("created_at"), str):
            try:
                r["created_at"] = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
            except Exception:
                r["created_at"] = datetime.now(timezone.utc)
        if isinstance(r.get("expires_at"), str):
            try:
                r["expires_at"] = datetime.fromisoformat(r["expires_at"].replace("Z", "+00:00"))
            except Exception:
                r["expires_at"] = datetime.now(timezone.utc)
    return reports

@router.get("/hospitals/nearby")
async def hospitals_nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_mi: float = Query(30)
):
    sb = get_supabase()
    radius_m = radius_mi * 1609.34

    try:
        result = sb.rpc("hospitals_within_radius", {
            "origin_lat": lat,
            "origin_lng": lng,
            "radius_m": radius_m,
        }).execute()
        hospitals = result.data or []
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Database query failed: {exc}")

    enriched = []
    for h in hospitals:
        recent = await get_reports_for_hospital(sb, h["id"])
        pred = predict_wall_time(h["id"], recent)

        h_lat = h.get("latitude") or 0
        h_lng = h.get("longitude") or 0

        # More accurate distance using haversine approximation
        dlat = (h_lat - lat) * 69.0
        dlng = (h_lng - lng) * 69.0 * math.cos(math.radians(lat))
        dist_mi = round(math.sqrt(dlat ** 2 + dlng ** 2), 1)
        drive_min = max(1, round(dist_mi / DRIVE_SPEED_MPH * 60))

        enriched.append({
            "hospital_id": h["id"],
            "name": h["name"],
            "address": h.get("address", ""),
            "city": h.get("city", ""),
            # ← include coords so frontend map can place pins
            "latitude": h_lat,
            "longitude": h_lng,
            "distance_miles": dist_mi,
            "drive_time_minutes": drive_min,
            "wall_time_minutes": pred["wall_time_minutes"],
            "total_minutes": drive_min + pred["wall_time_minutes"],
            "severity": pred["severity"],
            "queue_count": pred["queue_count"],
            "congestion_multiplier": pred["congestion_multiplier"],
            "walk_in_bucket": pred["walk_in_bucket"],
            "has_caution": pred.get("has_caution", False),
            "caution_flags": pred.get("flags", []),
            "caution_level": pred.get("level", "normal"),
        })

    enriched.sort(key=lambda x: x["total_minutes"])

    return {
        "origin": {"lat": lat, "lng": lng},
        "radius_miles": radius_mi,
        "top_3": enriched[:3],
        "all_in_radius": enriched,
    }

@router.get("/hospitals/search")
async def search_hospitals(q: str = Query(..., min_length=2, max_length=100)):
    sb = get_supabase()

    # Strip LIKE wildcards from user input to prevent unexpected matches
    safe_q = q.replace("%", "").replace("\\", "").strip()
    if not safe_q:
        return {"query": q, "results": []}

    # Search by name OR city — fixes "Brooklyn" / "Albany" city searches
    try:
        result = sb.table("hospitals") \
            .select("id, name, address, city, latitude, longitude") \
            .or_(f"name.ilike.%{safe_q}%,city.ilike.%{safe_q}%") \
            .limit(20) \
            .execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Search query failed: {exc}")

    results = []
    for h in result.data or []:
        recent = await get_reports_for_hospital(sb, h["id"])
        pred = predict_wall_time(h["id"], recent)
        results.append({
            "hospital_id": h["id"],
            "name": h["name"],
            "address": h.get("address", ""),
            "city": h.get("city", ""),
            "wall_time_minutes": pred["wall_time_minutes"],
            "severity": pred["severity"],
            "queue_count": pred["queue_count"],
            "congestion_multiplier": pred["congestion_multiplier"],
            "walk_in_bucket": pred["walk_in_bucket"],
            "has_caution": pred.get("has_caution", False),
            "caution_flags": pred.get("flags", []),
        })

    return {"query": q, "results": results}

@router.get("/hospitals/match")
async def match_hospital_endpoint(
    lat: float = Query(...),
    lng: float = Query(...),
    name: str = Query("")
):
    from services.geocode import reverse_geocode
    from services.matcher import match_hospital

    osm_name = name
    if not osm_name:
        try:
            geo = await reverse_geocode(lat, lng)
            osm_name = geo.get("name", "")
        except Exception:
            osm_name = ""

    if not osm_name:
        return {
            "matched": False,
            "confidence": 0,
            "auto_selected": False,
            "hospital": None,
            "alternatives": [],
        }

    sb = get_supabase()
    candidates = sb.table("hospitals").select("*").execute().data or []
    match_result = match_hospital(osm_name, candidates)

    return {
        "matched": match_result["matched"],
        "confidence": match_result["confidence"],
        "auto_selected": match_result["auto_selected"],
        "hospital": match_result["hospital"],
        "alternatives": match_result["alternatives"],
    }
