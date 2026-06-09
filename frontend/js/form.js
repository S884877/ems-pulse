import { apiGet, apiPost } from './api.js';
import { getState, requestLocation } from './location.js';

const ST = {
  screen: 'landing',
  hospital: null,
  matchConfirmed: false,
  isWaiting: true,
  waitMinutes: 15,
  walkInBucket: 10,
};

export function getST() { return ST; }

// ── Navigation ──────────────────────────────────────────────────────────────
export function navigate(screen) {
  ST.screen = screen;
  document.querySelectorAll('.scr').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`scr-${screen}`);
  if (target) target.classList.add('active');

  // Show/hide back button
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
  navigate('landing');
}

// ── Form initialisation ──────────────────────────────────────────────────────
async function initForm() {
  // Reset hospital selection
  ST.hospital = null;
  ST.matchConfirmed = false;
  showManualSearchAlways();

  // Try to auto-match from GPS in the background
  try {
    await requestLocation();
    const s = getState();
    const match = await apiGet('/hospitals/match', {
      lat: s.lat,
      lng: s.lng,
      name: s.locationName || '',
    });
    if (match.matched && match.auto_selected && match.hospital) {
      ST.hospital = match.hospital;
      ST.matchConfirmed = true;
      showHospitalConfirmed(match.hospital, true);
    } else if (match.matched && match.confidence >= 60 && match.hospital) {
      ST.hospital = match.hospital;
      ST.matchConfirmed = false;
      showHospitalConfirmed(match.hospital, false, match.confidence);
    }
    // If not matched, manual search stays visible
  } catch {
    // Location denied or error — manual search is already showing, no problem
  }
}

function showManualSearchAlways() {
  document.getElementById('hospital-selected').style.display = 'none';
  document.getElementById('hospital-manual').style.display = 'block';
  document.getElementById('manual-search').value = '';
  document.getElementById('manual-list').innerHTML =
    '<p style="font-size:13px;color:var(--i3);padding:4px 0">Start typing to search NY hospitals…</p>';
}

function showHospitalConfirmed(hospital, auto, confidence) {
  document.getElementById('hospital-manual').style.display = 'none';
  const sel = document.getElementById('hospital-selected');
  sel.style.display = 'block';
  sel.innerHTML = `
    <div class="hpbtn on" style="cursor:default">
      <span>${hospital.name}</span>
      <span class="pw">${auto ? '✓ Auto-matched' : `${confidence}% match`}</span>
    </div>
    <p style="font-size:12px;color:var(--i3);margin-top:6px">
      Wrong hospital?
      <button onclick="window._changeHospital()" style="background:none;border:none;color:#1C4F8A;font-weight:600;cursor:pointer;font-size:12px">Change</button>
    </p>
  `;
}

window._changeHospital = function () {
  ST.hospital = null;
  ST.matchConfirmed = false;
  showManualSearchAlways();
};

// ── Manual hospital search (live, no debounce issues) ─────────────────────
let _searchTimer = null;
export function setupManualSearch() {
  const input = document.getElementById('manual-search');
  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(_searchTimer);

    if (q.length < 2) {
      document.getElementById('manual-list').innerHTML =
        '<p style="font-size:13px;color:var(--i3);padding:4px 0">Start typing to search NY hospitals…</p>';
      return;
    }

    document.getElementById('manual-list').innerHTML =
      '<p style="font-size:13px;color:var(--i3);padding:4px 0">Searching…</p>';

    _searchTimer = setTimeout(async () => {
      try {
        const data = await apiGet('/hospitals/search', { q });
        const list = document.getElementById('manual-list');
        if (!data.results || !data.results.length) {
          list.innerHTML = '<p style="font-size:13px;color:var(--i3);padding:4px 0">No hospitals found. Try a different name.</p>';
          return;
        }
        list.innerHTML = data.results.slice(0, 12).map(h => `
          <button class="hpbtn" data-id="${h.hospital_id}" data-name="${encodeURIComponent(h.name)}">
            <span>${h.name}</span>
            <span class="pw">${h.city || ''}</span>
          </button>
        `).join('');

        // Attach click handlers
        list.querySelectorAll('.hpbtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const name = decodeURIComponent(btn.dataset.name);
            selectHospital(id, name);
          });
        });
      } catch (err) {
        document.getElementById('manual-list').innerHTML =
          `<p style="font-size:13px;color:#B02020;padding:4px 0">Search error — is the server running? (${err.message})</p>`;
      }
    }, 300);
  });
}

function selectHospital(id, name) {
  ST.hospital = { id, name };
  ST.matchConfirmed = true;
  showHospitalConfirmed({ name }, true);
  // Override the auto-matched label to say "Selected"
  const sel = document.getElementById('hospital-selected');
  if (sel) {
    const pw = sel.querySelector('.pw');
    if (pw) pw.textContent = '✓ Selected';
  }
  toast(`Selected: ${name}`);
}

// ── Form setup (buttons) ─────────────────────────────────────────────────────
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
        // highlight matching chip if exact match, clear all otherwise
        document.querySelectorAll('.wchip').forEach(c => {
          c.classList.toggle('on', parseInt(c.dataset.value) === val);
        });
      }
    });
    waitInput.addEventListener('blur', () => {
      // clamp on blur
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
  document.getElementById('btn-submit').addEventListener('click', async () => {
    if (!ST.hospital || !ST.matchConfirmed) {
      toast('Please select a hospital first');
      document.getElementById('manual-search').focus();
      return;
    }
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const s = getState();
      await apiPost('/reports', {
        hospital_id: ST.hospital.id,
        wait_minutes: ST.waitMinutes,
        walk_in_bucket: ST.walkInBucket,
        is_waiting: ST.isWaiting,
        latitude: s.lat || null,
        longitude: s.lng || null,
      });
      toast('✓ Report submitted — thank you!');
      setTimeout(() => navigate('landing'), 2500);
    } catch (err) {
      toast(`Failed: ${err.message}`);
      btn.disabled = false;
      btn.textContent = 'Submit report →';
    }
  });

  // Manual search
  setupManualSearch();
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
