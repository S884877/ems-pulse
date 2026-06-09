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
});
