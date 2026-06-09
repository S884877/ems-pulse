CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS hospitals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    address       TEXT,
    city          TEXT,
    state         TEXT DEFAULT 'NY',
    zip           TEXT,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    facility_type TEXT,
    source        TEXT DEFAULT 'nydiverts',
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hospitals_name ON hospitals (name);
CREATE INDEX IF NOT EXISTS idx_hospitals_name_trgm ON hospitals USING GIN (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id     UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    wait_minutes    INTEGER NOT NULL,
    walk_in_bucket  INTEGER NOT NULL,
    is_waiting      BOOLEAN DEFAULT true,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_reports_hospital_created ON reports (hospital_id, created_at DESC);

CREATE OR REPLACE FUNCTION hospitals_within_radius(
    origin_lat DOUBLE PRECISION,
    origin_lng DOUBLE PRECISION,
    radius_m   DOUBLE PRECISION
)
RETURNS SETOF hospitals
LANGUAGE SQL STABLE
AS $$
    SELECT * FROM hospitals
    WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
        radius_m
    )
    ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
    );
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_reports()
RETURNS void LANGUAGE SQL AS $$
    DELETE FROM reports WHERE expires_at < now();
$$;
