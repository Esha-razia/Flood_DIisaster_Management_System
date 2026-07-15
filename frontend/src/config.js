// Central place for the backend's base URL.
//
// Locally (npm run dev), this now auto-detects the backend host from
// whatever hostname the browser used to load the page — so it works
// whether you open the site as http://127.0.0.1:5173, http://localhost:5173,
// or from another device on the same Wi-Fi via the machine's LAN IP (e.g.
// http://192.168.1.20:5173). Hardcoding 127.0.0.1 here used to break that
// last case: a phone or another laptop has its OWN 127.0.0.1, which isn't
// the computer actually running the Flask backend, so every API call
// (including login) would silently fail to connect from any other device.
//
// When deployed (e.g. on Vercel), it reads VITE_API_URL from the build
// environment instead. Vercel only hosts this frontend — it does NOT run
// the Python/Flask backend — so the backend must be deployed separately
// (e.g. Render, Railway, Fly.io) and its public URL set as VITE_API_URL
// in the frontend's hosting dashboard. Without that, every API call will
// fail because there's nothing at 127.0.0.1:5000 on a visitor's device.
const AUTO_DETECTED_BASE = typeof window !== "undefined"
  ? `http://${window.location.hostname}:5000`
  : "http://127.0.0.1:5000";

export const API_BASE = import.meta.env.VITE_API_URL || AUTO_DETECTED_BASE;
