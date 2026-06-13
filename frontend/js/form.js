import { apiGet, apiPost } from './api.js';
import { getState, requestLocation } from './location.js';

const ST = {
  screen: 'landing',
  navHistory: [],        // tracks screens visited so back goes to the right place
  hospital: null,
  matchConfirmed: false,
  isWaiting: true,
  waitMinutes: 15,
  walkInBucket: 10,
};

export function getST() { return ST; }

// ── Navigation ──────────────────────────────────────────────────────────────
// skipHistory: true when navigating back (avoids pushing back-nav into history)
export function navigate(screen, skipHistory = false) {
  // Push current screen to history before leaving (but not when going back,
  // and not when staying on the same screen)
  if (!skipHistory && screen !== ST.screen) {
    ST.navHistory.push(ST.screen);
  }

  ST.screen = screen;
  document.querySelectorAll('.scr').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`scr-${screen}`);
  if (target) target.classList.add('active');

  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.style.display = screen === 'landing' ? 'none' : '';

  if (screen === 'form') initForm();
  if (screen === 'dashboard') {
    import('./dashboard.js').then(m => m.loadDashboard());
  }
  if (screen !== 'dashboard') {
    import('./dashboard.js').then(m => m.stopDashboardPolling());
  }
  window.scrollTo(0, 0);
}

export function goBack() {
  const prev = ST.navHistory.pop();
  navigate(prev || 'landing', true);  // skipHistory=true so back doesn't re-push
}

// ── Form init ─────────────────────────────────────────────────────────────
async function initForm() {
  // Always reset submit button — user may have navigated away mid-submission
  // leaving the button disabled with "Submitting…" text permanently
  const btn = document.getElementById('btn-submit');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Submit report →';
  }

  // If a hospital is already selected, restore its confirmed state and stop.
  // Do NOT wipe the selection just because the user switched screens.
  if (ST.hospital && ST.matchConfirmed) {
    showConfirmed(ST.hospital, 'manual');
    return;
  }

  // No hospital selected yet — show trigger and attempt silent GPS auto-match
  showTrigger();
  try {
    await requestLocation();
    const s = getState();
    const match = await apiGet('/hospitals/match', {
      lat: s.lat, lng: s.lng, name: s.locationName || '',
    });
    if (match.matched && match.auto_selected && match.hospital) {
      ST.hospital = match.hospital;
      ST.matchConfirmed = true;
      showConfirmed(match.hospital, 'auto');
    } else if (match.matched && match.confidence >= 60 && match.hospital) {
      ST.hospital = match.hospital;
      ST.matchConfirmed = false;
      showConfirmed(match.hospital, 'partial', match.confidence);
    }
  } catch {
    // GPS denied or error — trigger stays visible, user opens picker manually
  }
}

// ── Hospital selection display ────────────────────────────────────────────
function showTrigger() {
  document.getElementById('hospital-selected').style.display = 'none';
  document.getElementById('hospital-trigger').style.display = 'flex';
}

/**
 * @param {object} hospital
 * @param {'auto'|'partial'|'manual'} mode
 * @param {number} [confidence]
 */
function showConfirmed(hospital, mode, confidence) {
  document.getElementById('hospital-trigger').style.display = 'none';
  const sel = document.getElementById('hospital-selected');
  sel.style.display = 'block';

  const metaText = {
    auto: '📍 Auto-detected from GPS',
    partial: `${confidence}% GPS name match`,
    manual: '✓ Selected',
  }[mode] || '✓ Selected';

  sel.innerHTML = `
    <button class="hosp-confirmed-card" onclick="openHospPicker()"
      aria-label="Change hospital — currently ${hospital.name}">
      <div class="hosp-confirmed-body">
        <div class="hosp-confirmed-name">${hospital.name}</div>
        <div class="hosp-confirmed-meta">${metaText} · tap to change</div>
      </div>
      <span class="hosp-confirmed-change" aria-hidden="true">Change</span>
    </button>`;
}

// ── Hospital Picker Overlay ───────────────────────────────────────────────
/**
 * PUBLIC — called by onclick in HTML and via window.openHospPicker
 */
export function openHospPicker() {
  const overlay = document.getElementById('hosp-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  // Auto-focus search input (slight delay for overlay animation)
  setTimeout(() => {
    const inp = document.getElementById('hosp-search-input');
    inp?.focus();
    inp?.select();
  }, 120);
  // Populate GPS match section quietly
  _populateGpsMatch();
}

function _closeHospPicker() {
  const overlay = document.getElementById('hosp-overlay');
  if (overlay) overlay.style.display = 'none';
  // Clear search state for next open
  const inp = document.getElementById('hosp-search-input');
  if (inp) inp.value = '';
  const clearBtn = document.getElementById('hosp-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const results = document.getElementById('hosp-search-results');
  if (results) results.innerHTML = _idleState();
}

function _idleState() {
  return `
    <div class="hosp-idle">
      <div class="hosp-idle-icon" aria-hidden="true">🏥</div>
      <div class="hosp-idle-text">Type a hospital name, borough, or city to search across 160+ NY EDs</div>
    </div>`;
}

async function _populateGpsMatch() {
  const el = document.getElementById('hosp-gps-match');
  if (!el) return;
  const s = getState();
  if (!s.lat) { el.innerHTML = ''; return; }

  el.innerHTML = `<div class="hosp-gps-detecting">📍 Detecting nearest hospital…</div>`;

  try {
    const match = await apiGet('/hospitals/match', {
      lat: s.lat, lng: s.lng, name: s.locationName || '',
    });
    if (!match.matched || !match.hospital) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="hosp-section-label">Nearest to your location</div>
      <button class="hosp-result-btn hosp-gps-btn"
        data-id="${match.hospital.id}"
        data-name="${encodeURIComponent(match.hospital.name)}"
        aria-label="Select ${match.hospital.name}">
        <span class="hosp-result-icon" aria-hidden="true">📍</span>
        <div class="hosp-result-body">
          <div class="hosp-result-name">${match.hospital.name}</div>
          <div class="hosp-result-meta">${match.hospital.city || ''} · ${match.confidence}% GPS match</div>
        </div>
        <span class="hosp-result-select">Select</span>
      </button>
      <div class="hosp-section-div"></div>`;
    el.querySelectorAll('.hosp-result-btn').forEach(_wireResultBtn);
  } catch {
    el.innerHTML = '';
  }
}

/**
 * PUBLIC — wired in app.js DOMContentLoaded
 */
export function setupHospPicker() {
  // Close on backdrop tap
  document.getElementById('hosp-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'hosp-overlay') _closeHospPicker();
  });

  // Close button
  document.getElementById('hosp-picker-close')?.addEventListener('click', _closeHospPicker);

  // Clear button
  const clearBtn = document.getElementById('hosp-search-clear');
  clearBtn?.addEventListener('click', () => {
    const inp = document.getElementById('hosp-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
    clearBtn.style.display = 'none';
    document.getElementById('hosp-search-results').innerHTML = _idleState();
  });

  // Search input
  const input = document.getElementById('hosp-search-input');
  const resultsEl = document.getElementById('hosp-search-results');
  if (!input || !resultsEl) return;

  let _timer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(_timer);

    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

    if (q.length < 2) {
      resultsEl.innerHTML = _idleState();
      return;
    }

    resultsEl.innerHTML = _loadingState();
    _timer = setTimeout(() => _doSearch(q, resultsEl), 300);
  });
}

// ── Search execution with retry ───────────────────────────────────────────
async function _doSearch(q, resultsEl, attempt = 0) {
  try {
    const data = await apiGet('/hospitals/search', { q });
    const list = data.results || [];

    if (!list.length) {
      resultsEl.innerHTML = _emptyState(q);
      return;
    }

    const countLabel = `${list.length} hospital${list.length !== 1 ? 's' : ''} found`;
    resultsEl.innerHTML = `
      <div class="hosp-results-count" aria-live="polite">${countLabel}</div>
      ${list.map(h => `
        <button class="hosp-result-btn"
          data-id="${h.hospital_id}"
          data-name="${encodeURIComponent(h.name)}"
          aria-label="Select ${h.name}, ${h.city || 'NY'}, predicted wait ${h.wall_time_minutes} minutes">
          <span class="hosp-result-icon" aria-hidden="true">🏥</span>
          <div class="hosp-result-body">
            <div class="hosp-result-name">${h.name}</div>
            <div class="hosp-result-meta">
              ${h.city || 'New York State'}
              <span class="hosp-result-dot" aria-hidden="true">·</span>
              <span class="hosp-result-wait sev-${h.severity}">~${h.wall_time_minutes} min wait</span>
            </div>
          </div>
          <span class="hosp-result-select">Select</span>
        </button>`).join('')}`;

    resultsEl.querySelectorAll('.hosp-result-btn').forEach(_wireResultBtn);

  } catch (err) {
    // Retry once automatically before showing error UI
    if (attempt < 1) {
      setTimeout(() => _doSearch(q, resultsEl, attempt + 1), 700);
      return;
    }
    resultsEl.innerHTML = _errorState(err, q, resultsEl);
  }
}

function _wireResultBtn(btn) {
  btn.addEventListener('click', () => {
    const id   = btn.dataset.id;
    const name = decodeURIComponent(btn.dataset.name);
    _selectHospital(id, name);
  });
}

function _selectHospital(id, name) {
  ST.hospital = { id, name };
  ST.matchConfirmed = true;
  _closeHospPicker();
  showConfirmed({ id, name }, 'manual');
  toast(`✓ ${name}`);
}

// ── State templates ───────────────────────────────────────────────────────
function _loadingState() {
  return `
    <div class="hosp-loading" aria-live="polite" aria-label="Searching hospitals">
      <div class="hosp-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <span>Searching…</span>
    </div>`;
}

function _emptyState(q) {
  return `
    <div class="hosp-empty">
      <div class="hosp-empty-icon" aria-hidden="true">🔍</div>
      <div class="hosp-empty-title">No hospitals found for "${q}"</div>
      <div class="hosp-empty-sub">Try a shorter name, borough (e.g. "Brooklyn"), or city (e.g. "Albany")</div>
    </div>`;
}

function _errorState(err, q, resultsEl) {
  const isNetwork = err.message.toLowerCase().includes('fetch') ||
                    err.message.toLowerCase().includes('network');
  const title = isNetwork ? 'Cannot reach server' : 'Search failed';
  const sub   = isNetwork
    ? 'The backend server is not running. Start it with: <code>uvicorn main:app --reload</code>'
    : err.message;

  // Use a closure so the retry button can reference q + resultsEl
  setTimeout(() => {
    document.getElementById('hosp-err-retry')?.addEventListener('click', () => {
      resultsEl.innerHTML = _loadingState();
      _doSearch(q, resultsEl, 0);
    });
  }, 0);

  return `
    <div class="hosp-error">
      <div class="hosp-error-icon" aria-hidden="true">${isNetwork ? '⚡' : '⚠️'}</div>
      <div class="hosp-error-title">${title}</div>
      <div class="hosp-error-sub">${sub}</div>
      <button class="hosp-error-retry" id="hosp-err-retry">Try again</button>
    </div>`;
}

// ── Form controls ─────────────────────────────────────────────────────────
export function setupForm() {
  // Waiting toggle
  document.querySelectorAll('.bbt').forEach(b => {
    b.addEventListener('click', () => {
      ST.isWaiting = b.dataset.value === 'true';
      document.querySelectorAll('.bbt').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  // Wait minutes — number input + quick chips
  const waitInput = document.getElementById('wait-minutes-input');
  if (waitInput) {
    waitInput.addEventListener('input', () => {
      const val = parseInt(waitInput.value);
      if (!isNaN(val) && val >= 1 && val <= 240) {
        ST.waitMinutes = val;
        document.querySelectorAll('.wchip').forEach(c =>
          c.classList.toggle('on', parseInt(c.dataset.value) === val));
      }
    });
    waitInput.addEventListener('blur', () => {
      let val = parseInt(waitInput.value);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 240) val = 240;
      waitInput.value = val;
      ST.waitMinutes = val;
    });
  }
  document.querySelectorAll('.wchip').forEach(b => {
    b.addEventListener('click', () => {
      const val = parseInt(b.dataset.value);
      ST.waitMinutes = val;
      document.querySelectorAll('.wchip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      if (waitInput) waitInput.value = val;
    });
  });

  // Walk-in bucket
  document.querySelectorAll('.wbtn').forEach(b => {
    b.addEventListener('click', () => {
      ST.walkInBucket = parseInt(b.dataset.value);
      document.querySelectorAll('.wbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  // Submit
  document.getElementById('btn-submit')?.addEventListener('click', async () => {
    if (!ST.hospital || !ST.matchConfirmed) {
      toast('Please select a hospital first');
      openHospPicker();
      return;
    }
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    // 20-second abort guard — a hung network can never permanently freeze the button
    const controller = new AbortController();
    const _abort = setTimeout(() => controller.abort(), 20000);

    try {
      const s = getState();
      await apiPost('/reports', {
        hospital_id: ST.hospital.id,
        wait_minutes: ST.waitMinutes,
        walk_in_bucket: ST.walkInBucket,
        is_waiting: ST.isWaiting,
        latitude: s.lat || null,
        longitude: s.lng || null,
      }, controller.signal);
      clearTimeout(_abort);
      toast('✓ Report submitted — thank you!');
      // Reset form state only after successful submission
      ST.hospital = null;
      ST.matchConfirmed = false;
      ST.isWaiting = true;
      ST.waitMinutes = 15;
      ST.walkInBucket = 10;
      setTimeout(() => navigate('landing'), 2500);
    } catch (err) {
      clearTimeout(_abort);
      const msg = err.name === 'AbortError'
        ? 'Request timed out — check your connection'
        : err.message;
      toast(`Failed: ${msg}`);
      btn.disabled = false;
      btn.textContent = 'Submit report →';
    }
  });
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
