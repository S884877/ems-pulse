import { navigate, goBack, setupForm, openHospPicker, setupHospPicker } from './form.js';
import { loadDashboard, setupDashboardSearch, setupDashboardControls, openLocPicker, setupLocPicker } from './dashboard.js';

// Expose functions that HTML onclick attributes reference
window.navigate        = navigate;
window.goBack          = goBack;
window.dashboardRefresh = () => loadDashboard();
window.openLocPicker   = openLocPicker;
window.openHospPicker  = openHospPicker;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-report')   ?.addEventListener('click', () => navigate('form'));
  document.getElementById('btn-dashboard')?.addEventListener('click', () => navigate('dashboard'));
  document.getElementById('brand-home')   ?.addEventListener('click', () => navigate('landing'));

  setupForm();
  setupDashboardSearch();
  setupDashboardControls();
  setupLocPicker();
  setupHospPicker();
  setupDisclaimer();
});

function setupDisclaimer() {
  const KEY = 'pulse_disclaimer_acknowledged';
  if (sessionStorage.getItem(KEY)) return;   // already seen this session

  const modal    = document.getElementById('disc-modal');
  const confirm  = document.getElementById('disc-confirm');
  const readMore = document.getElementById('disc-read-more');
  const expand   = document.getElementById('disc-expand');
  if (!modal) return;

  modal.style.display = 'flex';

  // Toggle Read More / Read Less
  let expanded = false;
  readMore.addEventListener('click', () => {
    expanded = !expanded;
    expand.style.display = expanded ? 'block' : 'none';
    readMore.textContent = expanded ? 'Read Less ▴' : 'Read More ▾';
  });

  // Dismiss
  confirm.addEventListener('click', () => {
    sessionStorage.setItem(KEY, '1');
    modal.style.display = 'none';
  });
}
