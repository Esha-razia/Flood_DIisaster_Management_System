import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { API_BASE } from "./config";

// Any leftover hardcoded "http://127.0.0.1:5000" call sites get rewritten
// to the real configured backend URL here too, as a safety net.
axios.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith("http://127.0.0.1:5000")) {
    config.url = config.url.replace("http://127.0.0.1:5000", API_BASE);
  }
  return config;
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
