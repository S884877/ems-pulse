import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api.reports import router as reports_router
from api.hospitals import router as hospitals_router
from api.analytics import router as analytics_router

app = FastAPI(
    title="PULSE EMS Wall Time API",
    version="1.0.0",
    description="Real-time ED wall time prediction engine for EMS crews",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# ── API routes (registered first — take priority over static catch-all) ──
app.include_router(reports_router, prefix="/api")
app.include_router(hospitals_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

# ── Serve frontend static files ──
# html=True → serve index.html for unknown paths (SPA routing)
# Mounted LAST so /api/* routes above are never shadowed
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
