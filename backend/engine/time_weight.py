import math
from typing import Optional
from datetime import datetime, timezone

LAMBDA = 0.05

def compute_weight(age_minutes: float) -> float:
    return math.exp(-LAMBDA * age_minutes)

def weighted_average(reports: list[dict]) -> Optional[float]:
    if not reports:
        return None
    now = datetime.now(timezone.utc)
    total_weight = 0.0
    weighted_sum = 0.0
    for r in reports:
        age = (now - r["created_at"]).total_seconds() / 60.0
        w = compute_weight(age)
        weighted_sum += w * r["wait_minutes"]
        total_weight += w
    return weighted_sum / total_weight if total_weight > 0 else None
