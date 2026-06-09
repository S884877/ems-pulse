from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from services.supabase import get_supabase
from datetime import datetime, timedelta, timezone

router = APIRouter()

class ReportCreate(BaseModel):
    hospital_id: str
    wait_minutes: int = Field(..., ge=1, le=240)   # any value 1–240
    walk_in_bucket: int = Field(..., ge=10)
    is_waiting: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None

@router.post("/reports", status_code=201)
async def submit_report(report: ReportCreate):
    sb = get_supabase()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=30)

    data = {
        "hospital_id": report.hospital_id,
        "wait_minutes": report.wait_minutes,
        "walk_in_bucket": report.walk_in_bucket,
        "is_waiting": report.is_waiting,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "created_at": now.isoformat(),
        "expires_at": expires.isoformat(),
    }

    result = sb.table("reports").insert(data).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to insert report")

    return {
        "id": result.data[0]["id"],
        "message": "Thank you for reporting",
        "expires_at": expires.isoformat(),
    }
