from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ReportCreate(BaseModel):
    hospital_id: str
    wait_minutes: int
    walk_in_bucket: int
    is_waiting: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
