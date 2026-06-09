from fastapi import APIRouter, HTTPException
from services.supabase import get_supabase
from engine.predictor import predict_wall_time
from datetime import datetime, timedelta, timezone

router = APIRouter()

@router.get("/analytics/{hospital_id}")
async def get_hospital_analytics(hospital_id: str):
    sb = get_supabase()

    hospital = sb.table("hospitals").select("*").eq("id", hospital_id).execute()
    if not hospital.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    reports = sb.table("reports") \
        .select("*") \
        .eq("hospital_id", hospital_id) \
        .gte("created_at", cutoff) \
        .execute()

    prediction = predict_wall_time(hospital_id, reports.data or [])

    return {
        "hospital": hospital.data[0],
        "prediction": prediction,
    }
