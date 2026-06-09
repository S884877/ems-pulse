from datetime import datetime, timezone
from .time_weight import weighted_average, compute_weight
from .congestion import congestion_multiplier, resolve_walk_in_bucket, caution_flags

C = 15
P_DEFAULT = 15

def predict_wall_time(hospital_id: str, recent_reports: list[dict]) -> dict:
    now = datetime.now(timezone.utc)

    waiting = [r for r in recent_reports if r.get("is_waiting", True)]
    cleared = [r for r in recent_reports if not r.get("is_waiting", True)]

    total_weight = 0.0
    for r in waiting:
        age = (now - r["created_at"]).total_seconds() / 60.0
        w = compute_weight(age)
        total_weight += w
    Q = total_weight

    Pk = weighted_average(cleared) or P_DEFAULT
    W_hat = C + (Q * Pk * 0.5)

    wi_bucket = resolve_walk_in_bucket(recent_reports)
    multiplier = congestion_multiplier(wi_bucket)
    W_adjusted = round(W_hat * multiplier)

    if not cleared and waiting:
        W_adjusted = max(W_adjusted, C + round(len(waiting) * 3 * multiplier))

    # Hard cap at 120 minutes
    W_adjusted = min(W_adjusted, 120)

    severity = "clear"
    if W_adjusted >= 45:
        severity = "high"
    elif W_adjusted >= 30:
        severity = "caution"
    elif W_adjusted >= 20:
        severity = "moderate"

    caution = caution_flags(W_adjusted, len(waiting), wi_bucket)

    return {
        "hospital_id": hospital_id,
        "wall_time_minutes": W_adjusted,
        "queue_count": len(waiting),
        "processing_penalty": round(Pk, 1),
        "walk_in_bucket": wi_bucket,
        "congestion_multiplier": multiplier,
        "severity": severity,
        **caution,
        "report_count": len(recent_reports),
        "computed_at": now.isoformat(),
    }
