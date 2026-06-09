"""
Seed hospitals table from cleaned NY ED directory CSV.
Usage: python scripts/seed_from_csv.py
Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env
"""
import sys, os, csv, time
from typing import Optional, Tuple
import httpx
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from services.supabase import get_supabase

CSV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "ny_ed_hospitals_clean.csv"
)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "ems-pulse/1.0 (ems-pulse-app)"

def geocode_hospital(name: str, county: str) -> Optional[Tuple[float, float]]:
    for query in [f"{name}, {county}, NY", f"{name}, NY"]:
        try:
            resp = httpx.get(NOMINATIM_URL,
                params={"q": query, "format": "json", "limit": 1},
                headers={"User-Agent": USER_AGENT}, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if data:
                return (float(data[0]["lat"]), float(data[0]["lon"]))
        except Exception as e:
            print(f"  Geocode error for {name}: {e}")
    return None

def seed():
    sb = get_supabase()
    inserted = skipped = geocode_failed = 0

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} hospitals from CSV")

    for i, row in enumerate(rows):
        name = row["Hospital"].strip()
        county = row.get("County", "").strip()
        if not name:
            continue

        existing = sb.table("hospitals").select("id").eq("name", name).execute()
        if existing.data:
            skipped += 1
            continue

        print(f"[{i+1}/{len(rows)}] Geocoding: {name}...")
        coords = geocode_hospital(name, county)
        time.sleep(1)

        if not coords:
            print(f"  SKIPPED — could not geocode: {name}")
            geocode_failed += 1
            continue

        lat, lng = coords
        sb.table("hospitals").insert({
            "name": name, "city": county, "state": "NY",
            "latitude": lat, "longitude": lng, "source": "nydiverts_csv",
        }).execute()
        inserted += 1
        print(f"  ✓ Inserted: {name} ({lat:.4f}, {lng:.4f})")

    print(f"\nDone: {inserted} inserted, {skipped} skipped, {geocode_failed} geocode failures")

if __name__ == "__main__":
    seed()
