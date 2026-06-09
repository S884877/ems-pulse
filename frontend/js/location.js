// Location state — persists across screen navigations
const STATE = {
  lat: null,
  lng: null,
  locationName: '',
  address: '',
  granted: false,     // true once user has allowed location
  lastFetched: null,  // timestamp of last successful GPS fix
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
