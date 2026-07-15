import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { API_BASE } from "./config";

// Dynamic API URL rewriting for deployment
axios.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith(`${API_BASE}`)) {
    config.url = config.url.replace(`${API_BASE}`, API_BASE);
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
