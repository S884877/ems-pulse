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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reports_router, prefix="/api")
app.include_router(hospitals_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
