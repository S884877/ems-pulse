import { apiGet } from './api.js';
import { getState, requestLocation, setManualLocation, clearLocationCache, geocodeLocation } from './location.js';

const ST = {
  hospitals: [],
  rawHospitals: [],
  top3: [],
  sortBy: 'wall',
  radiusMi: 30,
};

let pollTimer = null;
let lastUpdated = null;
let mapInstance = null;
let mapMarkers = [];

// ── Public ────────────────────────────────────────────────────────────────────
export async function loadDashboard() {
  setLocBar('Getting your location…', 'Please wait');
  try {
    await requestLocation();
    const s = getState();
    updateLocBar(s);
    await fetchAndRender(s.lat, s.lng);
    showControls();
    startPolling();
  } catch (err) {
    setLocBar('Location unavailable', 'Tap to set your location');
    document.getElementById('dash-hlist').innerHTML = `
      <div class="empty">
        <div class="ei">📍</div>
        <div class="et">Location required</div>
        <div class="es">Allow GPS access or pick a location manually to see nearby hospitals</div>
        <button class="empty-loc-btn" id="btn-empty-setloc">Set location</button>
      </div>`;
    document.getElementById('btn-empty-setloc')?.addEventListener('click', openLocPicker);
  }
}

export function stopDashboardPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Location bar display ──────────────────────────────────────────────────────
function updateLocBar(s) {
  const lngDir = s.lng < 0 ? 'W' : 'E';
  const manualTag = s.isManual ? ' · manual' : '';
  setLocBar(
    s.locationName || 'Location found',
    `${s.lat.toFixed(4)}°N, ${Math.abs(s.lng).toFixed(4)}°${lngDir}${manualTag} · tap to change`
  );
}

// ── Location Picker ───────────────────────────────────────────────────────────
export function openLocPicker() {
  const overlay = document.getElementById('loc-overlay');
  if (!overlay) { loadDashboard(); return; }
  overlay.style.display = 'flex';
  setTimeout(() => document.getElementById('loc-search-input')?.focus(), 100);
}

function closeLocPicker() {
  const overlay = document.getElementById('loc-overlay');
  if (overlay) overlay.style.display = 'none';
  const input = document.getElementById('loc-search-input');
  if (input) input.value = '';
  const results = document.getElementById('loc-search-results');
  if (results) results.innerHTML = '';
}

export function setupLocPicker() {
  // Close button
  document.getElementById('loc-overlay-close')?.addEventListener('click', closeLocPicker);

  // Close on backdrop click
  document.getElementById('loc-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'loc-overlay') closeLocPicker();
  });

  // GPS button
  document.getElementById('loc-gps-btn')?.addEventListener('click', async () => {
    closeLocPicker();
    clearLocationCache();
    setLocBar('Getting GPS location…', 'Please wait');
    try {
      await requestLocation();
      const s = getState();
      updateLocBar(s);
      setHlistLoading();
      await fetchAndRender(s.lat, s.lng);
      showControls();
      startPolling();
    } catch {
      setLocBar('GPS unavailable', 'Tap to set location manually');
    }
  });

  // Quick-pick buttons
  document.querySelectorAll('.loc-qbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      const name = btn.dataset.name;
      applyManualLocation(lat, lng, name);
    });
  });

  // Free-text search
  const input = document.getElementById('loc-search-input');
  const results = document.getElementById('loc-search-results');
  if (!input || !results) return;

  let searchTimer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 3) { results.innerHTML = ''; return; }

    results.innerHTML = '<p class="loc-search-hint">Searching…</p>';
    searchTimer = setTimeout(async () => {
      try {
        const hits = await geocodeLocation(q);
        if (!hits.length) {
          results.innerHTML = '<p class="loc-search-hint">No locations found — try a different query</p>';
          return;
        }
        results.innerHTML = '';
        hits.forEach(h => {
          const btn = document.createElement('button');
          btn.className = 'loc-result-btn';
          btn.textContent = h.display;
          btn.addEventListener('click', () => applyManualLocation(h.lat, h.lng, h.name));
          results.appendChild(btn);
        });
      } catch (err) {
        results.innerHTML = `<p class="loc-search-hint" style="color:#B02020">Search failed: ${err.message}</p>`;
      }
    }, 350);
  });
}

async function applyManualLocation(lat, lng, name) {
  setManualLocation(lat, lng, name);
  closeLocPicker();
  updateLocBar(getState());
  setHlistLoading();
  await fetchAndRender(lat, lng);
  showControls();
  startPolling();
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
      if (s.lat) {
        setHlistLoading();
        await fetchAndRender(s.lat, s.lng);
      } else {
        openLocPicker();
      }
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

// Severity priority map — lower number = shown first (most critical at top)
const _SEV = { high: 0, caution: 1, moderate: 2, clear: 3 };

function applySort() {
  const sorted = [...ST.rawHospitals];

  if (ST.sortBy === 'wall') {
    // ── Severity-first sort: high → caution → moderate → clear ──
    // Within the same severity bucket, highest wall time first.
    // This matches the user expectation:
    //   "very high, high, moderate at top → clear at bottom"
    sorted.sort((a, b) => {
      const pa = _SEV[a.severity] ?? 4;
      const pb = _SEV[b.severity] ?? 4;
      if (pa !== pb) return pa - pb;                        // severity group
      return b.wall_time_minutes - a.wall_time_minutes;    // then wall time ↓
    });
  } else if (ST.sortBy === 'distance') {
    sorted.sort((a, b) => a.distance_miles - b.distance_miles);
  } else {
    sorted.sort((a, b) => a.total_minutes - b.total_minutes);
  }

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
  if (secs < 10)        el.textContent = 'Live · Updated just now';
  else if (secs < 60)   el.textContent = `Live · Updated ${secs}s ago`;
  else if (secs < 1800) el.textContent = `Live · Updated ${Math.floor(secs / 60)}m ago`;
  else                  el.textContent = `⚠️ Data may be outdated — tap refresh`;
}
setInterval(updateTimestamp, 5000);

// ── Freshness helpers ─────────────────────────────────────────────────────────
function freshnessInfo(h) {
  return {
    hasReports: (h.queue_count > 0 || (h.report_count != null && h.report_count > 0)),
    queueCount: h.queue_count || 0,
  };
}

function freshnessBadge(h) {
  const { hasReports } = freshnessInfo(h);
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

  const cautionBanner = (h.has_caution && h.caution_flags && h.caution_flags.length)
    ? `<div class="caution-banner">
        <span class="caution-icon">⚠️</span>
        <div class="caution-flags">${h.caution_flags.map(f => `<span class="caution-flag">${f}</span>`).join('')}</div>
       </div>`
    : '';

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
  if (!el) return;

  // ── "Best" is always the lowest total_minutes hospital ──
  // NEVER use ST.hospitals[0] here — that depends on the current sort order.
  // After the severity-sort change, hospitals[0] is the MOST congested, not the best.
  // We always want to recommend the fastest overall destination.
  const pool = ST.top3.length ? ST.top3 : ST.rawHospitals;
  if (!pool.length) { el.style.display = 'none'; return; }
  const best = [...pool].sort((a, b) => a.total_minutes - b.total_minutes)[0];

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
  if (ST.sortBy === 'wall')     return 'most congested first — high · caution · moderate · clear';
  if (ST.sortBy === 'distance') return 'nearest first';
  return 'lowest total time first';
}

function renderCards() {
  const top3El = document.getElementById('dash-top3');
  const listEl = document.getElementById('dash-hlist');

  if (!ST.hospitals.length) {
    if (top3El) top3El.innerHTML = '';
    const s = getState();
    const hasLocation = s.lat != null;

    listEl.innerHTML = `
      <div class="empty">
        <div class="ei">🏥</div>
        <div class="et">No hospitals in range</div>
        <div class="es">
          ${hasLocation
            ? `No hospitals found within ${ST.radiusMi} miles of your current location.<br>Try a larger radius or set a New York location.`
            : 'Set a location to see nearby hospitals.'}
        </div>
        <button class="empty-loc-btn" id="btn-no-results-loc">
          ${hasLocation ? '📍 Change location' : '📍 Set location'}
        </button>
      </div>`;

    document.getElementById('btn-no-results-loc')?.addEventListener('click', openLocPicker);
    return;
  }

  if (top3El) top3El.innerHTML = '';

  const staleCount = ST.hospitals.filter(h => !freshnessInfo(h).hasReports).length;
  const freshCount = ST.hospitals.length - staleCount;

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
    mapInstance = L.map('dash-map').setView([lat, lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 18,
    }).addTo(mapInstance);
  } else {
    // Always pass zoom — omitting it resets Leaflet to zoom 0 (world view)
    const currentZoom = mapInstance.getZoom();
    mapInstance.setView([lat, lng], currentZoom > 0 ? currentZoom : 11);
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
      fillOpacity: hasReports ? 0.9 : 0.45,
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

// ── Dashboard search ─────────────────────────────────────────────────────────
// Airbnb pattern: persistent pill at top, results replace nearby list,
// clear button resets to nearby mode. Search never pushed offscreen.

let _dashSearchTimer = null;

// Enter search mode: swap nearby content for search results
function _enterSearchMode() {
  const scr = document.getElementById('scr-dashboard');
  if (!scr) return;
  scr.classList.add('srch');
  document.getElementById('dash-search-results').style.display = 'block';
}

// Exit search mode: restore nearby content, clear results
function _exitSearchMode() {
  const scr = document.getElementById('scr-dashboard');
  if (!scr) return;
  scr.classList.remove('srch');
  const res = document.getElementById('dash-search-results');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
}

export function setupDashboardSearch() {
  const input    = document.getElementById('dash-search');
  const clearBtn = document.getElementById('dash-sb-clear');
  const results  = document.getElementById('dash-search-results');
  if (!input || !results) return;

  // ── Clear button — single tap resets everything ───────────────────────────
  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    _exitSearchMode();
    input.focus();
  });

  // ── Live search input ─────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(_dashSearchTimer);

    // Show/hide clear button
    if (clearBtn) clearBtn.style.display = q.length ? 'flex' : 'none';

    if (q.length < 2) {
      _exitSearchMode();
      return;
    }

    _enterSearchMode();
    results.innerHTML = `
      <div class="dash-srch-loading">
        <div class="hosp-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <span>Searching…</span>
      </div>`;

    _dashSearchTimer = setTimeout(async () => {
      try {
        const data = await apiGet('/hospitals/search', { q });

        if (!data.results?.length) {
          results.innerHTML = `
            <div class="dash-srch-empty">
              <div class="dash-se-icon" aria-hidden="true">🔍</div>
              <div class="dash-se-title">No hospitals found for "${q}"</div>
              <div class="dash-se-sub">Try a shorter name, borough (e.g. "Brooklyn"), or city (e.g. "Albany")</div>
            </div>`;
          return;
        }

        // Highest wall time first — most congested hospitals prominently visible
        const sorted = [...data.results].sort((a, b) => b.wall_time_minutes - a.wall_time_minutes);
        const count  = sorted.length;

        results.innerHTML = `
          <div class="dash-srch-header">
            <span class="dash-srch-count" aria-live="polite">
              ${count} hospital${count !== 1 ? 's' : ''} matching "<strong>${q}</strong>"
            </span>
            <button class="dash-srch-back" id="dash-srch-back-btn">
              ← Back to nearby
            </button>
          </div>
          ${sorted.map((h, i) => {
            const { cls, label } = sevInfo(h.severity);
            const hasReports = h.queue_count > 0;
            const caution = (h.has_caution && h.caution_flags?.length)
              ? `<div class="caution-banner">
                   <span class="caution-icon">⚠️</span>
                   <div class="caution-flags">
                     ${h.caution_flags.map(f => `<span class="caution-flag">${f}</span>`).join('')}
                   </div>
                 </div>`
              : '';
            const stale = !hasReports
              ? `<div class="stale-banner">
                   <span>🕐</span>
                   <span>No crew reports in last 30 min — estimated only</span>
                 </div>`
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
                  <div class="hst">
                    <div class="hnum ${cls}">${h.wall_time_minutes}</div>
                    <div class="hlbl">pred. wall min</div>
                  </div>
                  <div class="hst">
                    <div class="hnum N">${h.queue_count ?? '—'}</div>
                    <div class="hlbl">crews waiting</div>
                  </div>
                </div>
                ${caution}${stale}
              </div>`;
          }).join('')}`;

        // Wire the "← Back to nearby" button inside results
        document.getElementById('dash-srch-back-btn')?.addEventListener('click', () => {
          input.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          _exitSearchMode();
          input.blur();
        });

      } catch (err) {
        const isNetwork = err.message.toLowerCase().includes('fetch');
        results.innerHTML = `
          <div class="dash-srch-error">
            <div class="dash-se-icon" aria-hidden="true">${isNetwork ? '⚡' : '⚠️'}</div>
            <div class="dash-se-title">${isNetwork ? 'Server unreachable' : 'Search failed'}</div>
            <div class="dash-se-sub">${isNetwork ? 'Check that the backend is running on port 8000' : err.message}</div>
            <button class="dash-se-retry" id="dash-se-retry-btn">Try again</button>
          </div>`;
        document.getElementById('dash-se-retry-btn')?.addEventListener('click', () => {
          const currentQ = input.value.trim();
          if (currentQ.length >= 2) {
            input.dispatchEvent(new Event('input'));
          }
        });
      }
    }, 300);
  });

  // Close search mode if user presses Escape
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      _exitSearchMode();
      input.blur();
    }
  });
}
