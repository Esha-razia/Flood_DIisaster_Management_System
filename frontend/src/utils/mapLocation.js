import axios from 'axios';
import { API_BASE } from '../config';

const addressCache = new Map();
const pending = new Map();
export async function lookupLocation(lat, lng) {
  const key = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  if (addressCache.has(key)) return addressCache.get(key);
  if (pending.has(key)) return pending.get(key);
  const lookup = (async () => {
    try {
      const response = await axios.get(`${API_BASE}/reverse-geocode`, {params:{lat,lng},timeout:12000});
      if (response.data.location) { addressCache.set(key,response.data.location); return response.data.location; }
    } catch { /* A browser lookup can still work if the backend provider is blocked. */ }
    try {
      const response = await axios.get('https://photon.komoot.io/reverse', {params:{lat,lon:lng,lang:'en',limit:1,radius:0.2},timeout:8000});
      const p = response.data.features?.[0]?.properties;
      const name = p && [...new Set(['name','housenumber','street','district','city','county','state','country'].map(k=>p[k]).filter(Boolean))].join(', ');
      if (name) {addressCache.set(key,name);return name;}
    } catch { /* Keep the measured point; never invent a nearby address. */ }
    return `Coordinates: ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)} (address unavailable)`;
  })();
  pending.set(key,lookup);
  try {return await lookup;} finally {pending.delete(key);}
}

export async function getCurrentPosition() {
  if (!navigator.geolocation) throw new Error('Location is not supported by this browser.');
  const locate = options => new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,options));
  try {return await locate({enableHighAccuracy:true,timeout:20000,maximumAge:0});}
  catch(error) {
    if (error.code === 1) throw error;
    // Desktop computers may provide network location without a GPS receiver.
    return locate({enableHighAccuracy:false,timeout:15000,maximumAge:60000});
  }
}
export function locationErrorMessage(error) {
  if (error?.code === 1) return 'Location permission was denied. Allow location for this site and enable Windows Location services.';
  if (error?.code === 3) return 'Location request timed out. Try again or enter the incident address manually.';
  if (error?.code === 2) return 'Your device could not determine its location. Check Windows Location services and internet access.';
  return error?.message || 'Your current location could not be determined.';
}
export function escapeMapText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
