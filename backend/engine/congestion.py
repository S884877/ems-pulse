def congestion_multiplier(walk_in_bucket: int) -> float:
    if walk_in_bucket >= 30:
        return 1.5
    elif walk_in_bucket >= 20:
        return 1.3
    elif walk_in_bucket >= 15:
        return 1.15
    return 1.0

def resolve_walk_in_bucket(reports: list[dict]) -> int:
    buckets = [r.get("walk_in_bucket", 10) for r in reports]
    return max(buckets) if buckets else 10

def caution_flags(wall_time: int, queue_count: int, walk_in_bucket: int) -> dict:
    flags = []
    if walk_in_bucket >= 20:
        flags.append("High walk-in volume")
    if queue_count >= 3:
        flags.append("Multiple crews waiting")
    if wall_time >= 30:
        flags.append("Predicted wait exceeds 30 min")
    return {
        "has_caution": len(flags) > 0,
        "flags": flags,
        "level": "caution" if len(flags) >= 1 else "normal",
    }
