import { navigate, goBack, setupForm } from './form.js';
import { loadDashboard, setupDashboardSearch, setupDashboardControls } from './dashboard.js';

window.navigate = navigate;
window.goBack = goBack;
window.dashboardRefresh = () => loadDashboard();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-report').addEventListener('click', () => navigate('form'));
  document.getElementById('btn-dashboard').addEventListener('click', () => navigate('dashboard'));
  document.getElementById('brand-home').addEventListener('click', () => navigate('landing'));

  setupForm();
  setupDashboardSearch();
  setupDashboardControls();
});
