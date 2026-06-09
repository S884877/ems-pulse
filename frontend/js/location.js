// Location state — persists across screen navigations within the session
const STATE = {
  lat: null,
  lng: null,
  locationName: '',
  address: '',
  granted: false,
  lastFetched: null,
  isManual: false,  // true when set via manual picker, not GPS
};

export function getState() { return STATE; }

// Returns cached location if <5 mins old — avoids re-prompting on every screen
export function requestLocation() {
  return new Promise((resolve, reject) => {
    // Already have a fresh fix — use it immediately
    if (STATE.granted && STATE.lat && STATE.lastFetched &&
        (Date.now() - STATE.lastFetched) < 5 * 60 * 1000) {
      resolve(STATE);
      return;
    }

    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        STATE.lat = pos.coords.latitude;
        STATE.lng = pos.coords.longitude;
        STATE.granted = true;
        STATE.isManual = false;
        STATE.lastFetched = Date.now();
        try {
          const geo = await reverseGeocode(STATE.lat, STATE.lng);
          STATE.locationName = geo.name || 'Location found';
          STATE.address = geo.display_name || '';
        } catch {
          STATE.locationName = 'Location found';
        }
        resolve(STATE);
      },
      (err) => { reject(err); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

// Force a fresh GPS request on next call (clears the 5-min cache)
export function clearLocationCache() {
  STATE.lastFetched = null;
  STATE.isManual = false;
}

// Programmatically set location (manual override)
export function setManualLocation(lat, lng, name) {
  STATE.lat = lat;
  STATE.lng = lng;
  STATE.locationName = name;
  STATE.address = name;
  STATE.granted = true;
  STATE.isManual = true;
  STATE.lastFetched = Date.now();
}

// Search a location by free-text using Nominatim
// Returns array of { lat, lng, name, display }
export async function geocodeLocation(query) {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PULSE-EMS/1.0 (ems-routing-app)' },
  });
  if (!res.ok) throw new Error('Location search failed');
  const data = await res.json();
  return data.map(r => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    name: r.display_name.split(',')[0].trim(),
    display: r.display_name,
  }));
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'User-Agent': 'PULSE-EMS/1.0' } }
    );
    const data = await res.json();
    return {
      name: data.address?.hospital || data.address?.amenity || data.address?.name || '',
      display_name: data.display_name || '',
    };
  } catch {
    return { name: '', display_name: '' };
  }
}
