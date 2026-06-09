import { apiGet } from './api.js';
import { getState, requestLocation } from './location.js';

const ST = {
  hospitals: [],
  rawHospitals: [],
  top3: [],
  sortBy: 'wall',
  radiusMi: 30,
};

let pollTimer = null;
let lastUpdated = null;        // when we last got fresh API data
let mapInstance = null;
let mapMarkers = [];

// ── Public ────────────────────────────────────────────────────────────────────
export async function loadDashboard() {
  setLocBar('Getting your location…', 'Please wait');
  try {
    await requestLocation();
    const s = getState();
    setLocBar(
      s.locationName || 'Location found',
      `${s.lat.toFixed(4)}°N, ${Math.abs(s.lng).toFixed(4)}°W · tap to refresh`
    );
    await fetchAndRender(s.lat, s.lng);
    showControls();
    startPolling();
  } catch (err) {
    setLocBar('Location required', 'Tap to enable location access');
    document.getElementById('dash-hlist').innerHTML = `
      <div class="empty">
        <div class="ei">📍</div>
        <div class="et">Location required</div>
        <div class="es">Tap the bar above and allow location access when prompted</div>
      </div>`;
  }
}

export function stopDashboardPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Controls ──────────────────────────────────────────────────────────────────
export function setupDashboardControls() {
  document.querySelectorAll('.ctrl-pill[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ctrl-pill[data-sort]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      ST.sortBy = btn.dataset.sort;
      applySort();
      renderCards();
    });
  });

  document.querySelectorAll('.ctrl-pill[data-radius]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.ctrl-pill[data-radius]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      ST.radiusMi = parseInt(btn.dataset.radius);
      const s = getState();
      if (s.lat) { setHlistLoading(); await fetchAndRender(s.lat, s.lng); }
    });
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAndRender(lat, lng) {
  setHlistLoading();
  try {
    const data = await apiGet('/hospitals/nearby', { lat, lng, radius_mi: ST.radiusMi });
    ST.top3 = data.top_3 || [];
    ST.rawHospitals = data.all_in_radius || [];
    applySort();
    renderCards();
    renderBestPick();
    initOrUpdateMap(lat, lng);
    touchLastUpdated();
  } catch (err) {
    document.getElementById('dash-hlist').innerHTML =
      `<div class="empty"><div class="ei">⚠️</div><div class="et">Could not load hospitals</div><div class="es">${err.message}</div></div>`;
  }
}

function applySort() {
  const sorted = [...ST.rawHospitals];
  if (ST.sortBy === 'wall')         sorted.sort((a, b) => a.wall_time_minutes - b.wall_time_minutes);
  else if (ST.sortBy === 'distance') sorted.sort((a, b) => a.distance_miles - b.distance_miles);
  else                               sorted.sort((a, b) => a.total_minutes - b.total_minutes);
  ST.hospitals = sorted;
}

// ── Timestamp + staleness ─────────────────────────────────────────────────────
function touchLastUpdated() {
  lastUpdated = Date.now();
  updateTimestamp();
}

function updateTimestamp() {
  const el = document.getElementById('dash-sync');
  if (!el || !lastUpdated) return;
  const secs = Math.floor((Date.now() - lastUpdated) / 1000);
  if (secs < 10)       el.textContent = 'Live · Updated just now';
  else if (secs < 60)  el.textContent = `Live · Updated ${secs}s ago`;
  else if (secs < 1800) el.textContent = `Live · Updated ${Math.floor(secs / 60)}m ago`;
  else                 el.textContent = `⚠️ Data may be outdated — tap refresh`;
}
setInterval(updateTimestamp, 5000);

// ── Freshness helpers ─────────────────────────────────────────────────────────
// Returns object: { hasFreshData, reportCount, oldestMins, newestMins }
function freshnessInfo(h) {
  // API gives queue_count (waiting crews) — if 0 there are no active reports
  const reportCount = (h.queue_count || 0) + (h.report_count || 0);
  return {
    hasReports: (h.queue_count > 0 || (h.report_count != null && h.report_count > 0)),
    queueCount: h.queue_count || 0,
  };
}

// Freshness badge shown on each card
function freshnessBadge(h) {
  const { hasReports, queueCount } = freshnessInfo(h);
  if (!hasReports) {
    return `<div class="stale-banner">
      <span>🕐</span>
      <span>No crew reports in last 30 min — prediction is estimated, not live</span>
    </div>`;
  }
  return '';
}

// ── Severity ──────────────────────────────────────────────────────────────────
export function sevInfo(severity) {
  if (severity === 'clear')    return { cls: 'G', label: 'Clear' };
  if (severity === 'moderate') return { cls: 'A', label: 'Moderate' };
  if (severity === 'caution')  return { cls: 'O', label: 'Caution' };
  return { cls: 'R', label: 'High wait' };
}

// ── Cards ─────────────────────────────────────────────────────────────────────
function mkCard(h, rank) {
  const { cls, label } = sevInfo(h.severity);
  const distStr = h.distance_miles != null ? `${h.distance_miles} mi` : '—';

  // Caution flags banner
  const cautionBanner = (h.has_caution && h.caution_flags && h.caution_flags.length)
    ? `<div class="caution-banner">
        <span class="caution-icon">⚠️</span>
        <div class="caution-flags">${h.caution_flags.map(f => `<span class="caution-flag">${f}</span>`).join('')}</div>
       </div>`
    : '';

  // Stale data notice when no recent crew reports
  const staleNotice = freshnessBadge(h);

  return `
    <div class="hcard ${cls}" style="animation-delay:${rank * 0.04}s">
      <div class="htop">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="hrank">#${rank + 1}</span>
            <div class="hname">${h.name}</div>
          </div>
          <div class="haddr">${distStr} · ${h.drive_time_minutes} min drive · ${h.city || 'NY'}</div>
        </div>
        <div class="spill ${cls}"><div class="spdot"></div>${label}</div>
      </div>
      <div class="hstats">
        <div class="hst">
          <div class="hnum ${cls}">${h.wall_time_minutes}</div>
          <div class="hlbl">pred. wall</div>
        </div>
        <div class="hst">
          <div class="hnum N">${h.drive_time_minutes}</div>
          <div class="hlbl">drive min</div>
        </div>
        <div class="hst">
          <div class="hnum N">${h.total_minutes}</div>
          <div class="hlbl">total min</div>
        </div>
        <div class="hst">
          <div class="hnum N">${h.queue_count}</div>
          <div class="hlbl">crews waiting</div>
        </div>
      </div>
      ${cautionBanner}
      ${staleNotice}
    </div>`;
}

function renderBestPick() {
  const el = document.getElementById('dash-bestpick');
  if (!el || !ST.hospitals.length) return;
  const best = ST.hospitals[0];
  const { cls } = sevInfo(best.severity);
  const emoji = cls === 'G' ? '✅' : cls === 'A' ? '🟡' : cls === 'O' ? '🟠' : '🔴';
  const { hasReports } = freshnessInfo(best);
  const staleNote = !hasReports
    ? `<div style="font-family:var(--fm);font-size:9px;color:var(--O);margin-top:4px">⚠️ Estimated — no recent crew reports</div>`
    : '';
  el.style.display = 'block';
  el.innerHTML = `
    <div class="bestpick">
      <div class="bestpick-badge">${emoji}</div>
      <div class="bestpick-txt">
        <div class="bestpick-label">Best option right now</div>
        <div class="bestpick-name">${best.name}</div>
        <div class="bestpick-meta">${best.wall_time_minutes} min wall · ${best.distance_miles} mi · ${best.total_minutes} min total</div>
        ${staleNote}
      </div>
    </div>`;
}

function sortLabel() {
  if (ST.sortBy === 'wall')     return 'lowest wall time first';
  if (ST.sortBy === 'distance') return 'nearest first';
  return 'lowest total time first';
}

function renderCards() {
  const top3El = document.getElementById('dash-top3');
  const listEl = document.getElementById('dash-hlist');

  if (!ST.hospitals.length) {
    if (top3El) top3El.innerHTML = '';
    listEl.innerHTML = `
      <div class="empty">
        <div class="ei">🏥</div>
        <div class="et">No hospitals in range</div>
        <div class="es">Try increasing the radius</div>
      </div>`;
    return;
  }

  if (top3El) top3El.innerHTML = '';

  // How many have no fresh reports
  const staleCount = ST.hospitals.filter(h => !freshnessInfo(h).hasReports).length;
  const freshCount = ST.hospitals.length - staleCount;

  // Top bar showing data health
  const dataHealthBar = staleCount > 0
    ? `<div class="data-health-bar">
        <span>🟢 ${freshCount} live</span>
        <span class="dhb-sep">·</span>
        <span>🕐 ${staleCount} estimated</span>
        <span class="dhb-sep">·</span>
        <span>Last 30 min window</span>
       </div>`
    : `<div class="data-health-bar all-live">
        <span>🟢 All ${freshCount} hospitals have live crew reports</span>
       </div>`;

  const countStr = `${ST.hospitals.length} hospital${ST.hospitals.length !== 1 ? 's' : ''} within ${ST.radiusMi} mi · ${sortLabel()}`;
  listEl.innerHTML =
    `<div class="shead">${countStr}</div>` +
    dataHealthBar +
    ST.hospitals.map((h, i) => mkCard(h, i)).join('');
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  stopDashboardPolling();
  pollTimer = setInterval(async () => {
    try {
      const s = getState();
      if (!s.lat) return;
      const data = await apiGet('/hospitals/nearby', { lat: s.lat, lng: s.lng, radius_mi: ST.radiusMi });
      ST.top3 = data.top_3 || [];
      ST.rawHospitals = data.all_in_radius || [];
      applySort();
      renderCards();
      renderBestPick();
      updateMapMarkers();
      lastUpdated = Date.now();
    } catch { /* silent — keep showing current data */ }
  }, 20000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setLocBar(primary, secondary) {
  const p = document.getElementById('dash-loc-p');
  const s = document.getElementById('dash-loc-s');
  if (p) p.textContent = primary;
  if (s) s.textContent = secondary;
}

function showControls() {
  const el = document.getElementById('dash-controls');
  if (el) el.style.display = 'flex';
}

function setHlistLoading() {
  document.getElementById('dash-hlist').innerHTML =
    '<div class="empty"><div class="ei">⏳</div><div class="et">Loading hospitals…</div></div>';
  const t = document.getElementById('dash-top3');
  if (t) t.innerHTML = '';
  const bp = document.getElementById('dash-bestpick');
  if (bp) { bp.innerHTML = ''; bp.style.display = 'none'; }
}

// ── Map ───────────────────────────────────────────────────────────────────────
function sevColor(sev) {
  if (sev === 'clear')    return '#0F6844';
  if (sev === 'moderate') return '#944A00';
  if (sev === 'caution')  return '#C06000';
  return '#B02020';
}

function initOrUpdateMap(lat, lng) {
  const container = document.getElementById('map-container');
  const mapDiv    = document.getElementById('dash-map');
  if (!container || !mapDiv) return;
  container.style.display = 'block';

  if (!mapInstance) {
    mapInstance = L.map('dash-map').setView([lat, lng], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 18,
    }).addTo(mapInstance);
  } else {
    mapInstance.setView([lat, lng]);
  }
  updateMapMarkers(lat, lng);
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 250);
}

function updateMapMarkers(centerLat, centerLng) {
  if (!mapInstance) return;
  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];

  const s = getState();
  const lat = centerLat != null ? centerLat : s.lat;
  const lng = centerLng != null ? centerLng : s.lng;

  if (lat && lng) {
    mapMarkers.push(
      L.circleMarker([lat, lng], { radius: 9, fillColor: '#1C4F8A', color: '#fff', weight: 2.5, fillOpacity: 1 })
       .addTo(mapInstance).bindPopup('<b>Your location</b>')
    );
  }

  ST.hospitals.forEach(h => {
    if (!h.latitude || !h.longitude) return;
    const { hasReports } = freshnessInfo(h);
    const color = sevColor(h.severity);
    const m = L.circleMarker([h.latitude, h.longitude], {
      radius: 11, fillColor: color, color: '#fff',
      weight: hasReports ? 2 : 1,
      fillOpacity: hasReports ? 0.9 : 0.45,   // dim pins with no fresh data
      dashArray: hasReports ? null : '4,3',
    }).addTo(mapInstance)
      .bindPopup(
        `<b>${h.name}</b><br>` +
        `Wall: <b>${h.wall_time_minutes} min</b> · ${h.distance_miles} mi<br>` +
        (hasReports ? `🟢 Live data` : `🕐 Estimated — no recent reports`)
      );
    mapMarkers.push(m);
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
let _dashSearchTimer = null;

export function setupDashboardSearch() {
  const input = document.getElementById('dash-search');
  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    const container = document.getElementById('dash-search-results');
    clearTimeout(_dashSearchTimer);

    if (q.length < 2) { container.innerHTML = ''; return; }
    container.innerHTML = '<p style="font-family:var(--fm);font-size:11px;color:var(--i3);padding:8px 0">Searching…</p>';

    _dashSearchTimer = setTimeout(async () => {
      try {
        const data = await apiGet('/hospitals/search', { q });
        if (!data.results || !data.results.length) {
          container.innerHTML = '<p style="font-family:var(--fm);font-size:11px;color:var(--i3);padding:8px 0">No hospitals found.</p>';
          return;
        }
        const results = [...data.results].sort((a, b) => a.wall_time_minutes - b.wall_time_minutes);
        container.innerHTML = results.map((h, i) => {
          const { cls, label } = sevInfo(h.severity);
          const hasReports = (h.queue_count > 0);
          const cautionBanner = (h.has_caution && h.caution_flags && h.caution_flags.length)
            ? `<div class="caution-banner"><span class="caution-icon">⚠️</span><div class="caution-flags">${h.caution_flags.map(f => `<span class="caution-flag">${f}</span>`).join('')}</div></div>`
            : '';
          const staleNote = !hasReports
            ? `<div class="stale-banner"><span>🕐</span><span>No crew reports in last 30 min — estimated only</span></div>`
            : '';
          return `
            <div class="hcard ${cls}" style="animation-delay:${i * 0.04}s">
              <div class="htop">
                <div style="flex:1;min-width:0">
                  <div class="hname">${h.name}</div>
                  <div class="haddr">${h.city || 'New York State'}</div>
                </div>
                <div class="spill ${cls}"><div class="spdot"></div>${label}</div>
              </div>
              <div class="hstats" style="grid-template-columns:repeat(2,1fr)">
                <div class="hst"><div class="hnum ${cls}">${h.wall_time_minutes}</div><div class="hlbl">pred. wall min</div></div>
                <div class="hst"><div class="hnum N">${h.queue_count != null ? h.queue_count : '—'}</div><div class="hlbl">crews waiting</div></div>
              </div>
              ${cautionBanner}
              ${staleNote}
            </div>`;
        }).join('');
      } catch (err) {
        container.innerHTML = `<p style="font-size:12px;color:#B02020;padding:8px 0">Search error: ${err.message}</p>`;
      }
    }, 300);
  });
}
