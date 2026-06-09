# ── PULSE EMS — Railway Production Dockerfile ──────────────────────────────
# Uses official python:3.11-slim where pip works correctly.
# Serves both the FastAPI backend (/api/*) and the static frontend (/).

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies as a separate cached layer
# (only re-runs when requirements.txt changes, not on every code change)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy all source code (backend + frontend)
COPY . .

# Railway injects $PORT at runtime; default to 8000 for local docker run
ENV PORT=8000

# Start uvicorn — frontend served as StaticFiles from backend/main.py
CMD ["sh", "-c", "cd backend && uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
