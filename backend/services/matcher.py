from rapidfuzz import fuzz

def match_hospital(osm_name: str, candidates: list[dict]) -> dict:
    scored = []
    for h in candidates:
        score = fuzz.token_sort_ratio(osm_name.lower(), h["name"].lower())
        scored.append((score, h))

    scored.sort(key=lambda x: x[0], reverse=True)

    if not scored:
        return {"confidence": 0, "auto_selected": False, "matched": False, "hospital": None, "alternatives": []}

    top_score, top_hospital = scored[0]
    alts = [h for s, h in scored[1:6]]

    if top_score >= 85:
        return {"confidence": top_score, "auto_selected": True, "matched": True, "hospital": top_hospital, "alternatives": alts[:3]}

    if top_score >= 60:
        return {"confidence": top_score, "auto_selected": False, "matched": True, "hospital": top_hospital, "alternatives": alts[:3]}

    return {"confidence": top_score, "auto_selected": False, "matched": False, "hospital": None, "alternatives": alts[:5]}
