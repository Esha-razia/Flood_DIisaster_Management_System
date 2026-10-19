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
    const notificationToken = localStorage.getItem('notificationToken');
    if (notificationToken) config.headers.set('Authorization', `Bearer ${notificationToken}`);
    const actorName = localStorage.getItem('userName');
    const actorRole = localStorage.getItem('userRole');
    const actorEmail = localStorage.getItem('userEmail');
    if (actorEmail) config.headers.set('X-FMS-Actor-Email', actorEmail);
    if (actorName) config.headers.set('X-FMS-Actor-Name', actorName);
    if (actorRole) config.headers.set('X-FMS-Actor-Role', actorRole);
  }
  return config;
});

axios.interceptors.response.use((response) => {
  if (response.data?.notification_token) localStorage.setItem('notificationToken', response.data.notification_token);
  return response;
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
