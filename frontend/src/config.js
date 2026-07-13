// Central place for the backend's base URL.
//
// Locally (npm run dev), this defaults to http://127.0.0.1:5000 — the Flask
// backend running on your own machine.
//
// When deployed (e.g. on Vercel), it reads VITE_API_URL from the build
// environment instead. Vercel only hosts this frontend — it does NOT run
// the Python/Flask backend — so the backend must be deployed separately
// (e.g. Render, Railway, Fly.io) and its public URL set as VITE_API_URL
// in the frontend's hosting dashboard. Without that, every API call will
// fail because there's nothing at 127.0.0.1:5000 on a visitor's device.
export const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";
