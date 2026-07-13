import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function Navbar() {
  const { lang, t, toggleLang } = useLanguage();
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const seenAlertIds = useRef(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    const role = localStorage.getItem('userRole');
    const name = localStorage.getItem('userName');
    if (role && name) {
      setUserRole(role);
      setUserName(name);
      setIsAuthenticated(true);
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } else {
      setIsAuthenticated(false);
      setUserRole(null);
      setUserName(null);
    }
  }, []);

  // Real-time alert notifications — polls for new Medium/High alerts and
  // surfaces them as a native browser notification, wherever the user is.
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkAlerts = async () => {
      try {
        const res = await axios.get(`${API_BASE}/alerts`);
        const alerts = res.data || [];
        const fresh = alerts.filter((a) => !seenAlertIds.current.has(a.id) && a.status !== 'Cancelled');

        if (seenAlertIds.current.size > 0) {
          // Only notify for alerts that appeared *after* the first load
          fresh.forEach((a) => {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`${a.risk} flood risk — ${a.location}`, {
                body: a.message,
                icon: undefined,
              });
            }
          });
        }
        alerts.forEach((a) => seenAlertIds.current.add(a.id));
        setRecentAlerts(alerts.slice(0, 8));
      } catch (err) {
        // silent — backend may just not be running yet
      }
    };

    checkAlerts();
    const interval = setInterval(checkAlerts, 20000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleLogout = () => {
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userId');
    setIsAuthenticated(false);
    setUserRole(null);
    setUserName(null);
    navigate('/');
  };

  const dashboardPath = {
    citizen: '/citizen-dashboard',
    rescue_worker: '/rescue-dashboard',
    government_official: '/gov-dashboard',
    admin: '/admin-dashboard',
  }[userRole] || '/login';

  
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-ink/95 backdrop-blur-xl border-b border-teal-500/10">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center border border-marigold-500/40 bg-gradient-to-br from-teal-600/30 to-marigold-600/20">
            <span className="font-display text-marigold-400 text-lg leading-none">F</span>
          </div>
          <span className="font-display text-parchment text-lg tracking-tight">
            {t("brandName")}
          </span>
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[10px] font-mono-data uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border border-teal-500/30 text-teal-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span> Live
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          <Link to="/" className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted hover:text-parchment hover:bg-white/5">
            {t('home')}
          </Link>
          <Link to="/community" className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted hover:text-parchment hover:bg-white/5">
            {t('community')}
          </Link>
          <Link to="/map" className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted hover:text-parchment hover:bg-white/5">
            {t('map')}
          </Link>

          {isAuthenticated ? (
            <>
              <Link to={dashboardPath} className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted hover:text-parchment hover:bg-white/5">
                {userRole === 'admin' ? t('adminPanel') : t('dashboard')}
              </Link>
              <button onClick={handleLogout} className="px-4 py-2 text-sm font-medium text-muted hover:text-parchment transition-colors rounded-lg hover:bg-white/5">
                {t('logout')}
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-4 py-2 text-sm font-medium text-muted hover:text-parchment transition-colors rounded-lg hover:bg-white/5">
                {t('login')}
              </Link>
              <Link to="/register" className="px-4 py-2 text-sm font-semibold text-ink rounded-full transition-all hover:brightness-110 bg-gradient-to-r from-marigold-400 to-marigold-500 shadow-lg shadow-marigold-900/30">
                {t('register')}
              </Link>
            </>
          )}

          <button
            onClick={toggleLang}
            className="ml-1 px-2.5 py-1.5 text-xs font-mono-data font-semibold rounded-full border border-white/15 text-muted hover:text-parchment hover:bg-white/5 transition-colors"
            title="Switch language"
          >
            {lang === 'en' ? 'اردو' : 'EN'}
          </button>
        </div>

        {isAuthenticated && userName && (
          <div className="hidden md:flex items-center gap-3 ml-4 pl-4 border-l border-white/10">
            <div className="relative">
              <button
                onClick={() => setShowAlertsPanel((v) => !v)}
                className="relative w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-parchment hover:bg-white/5 transition-colors"
                title="Recent alerts"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {recentAlerts.some((a) => a.status !== 'Cancelled') && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-marigold-400" />
                )}
              </button>
              {showAlertsPanel && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-white/10 bg-ink-soft shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm font-semibold text-parchment">{t("recentAlertsTitle")}</p>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {recentAlerts.length === 0 && (
                      <p className="text-xs text-muted px-4 py-4">{t("noAlertsYet")}</p>
                    )}
                    {recentAlerts.map((a, i) => (
                      <div key={i} className="px-4 py-3 border-b border-white/5 last:border-0">
                        <p className="text-sm text-parchment font-medium">{a.message}</p>
                        <p className="text-xs text-muted mt-1">{a.location} · {new Date(a.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Link to="/profile" className="text-right hover:opacity-80 transition-opacity" title="View Profile">
              <div className="text-sm text-parchment font-medium">{userName}</div>
              <div className="text-xs text-muted font-mono-data uppercase tracking-wide">
                {userRole?.replace('_', ' ')}
              </div>
            </Link>
            <Link
              to="/profile"
              className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-marigold-500 flex items-center justify-center text-ink text-sm font-bold hover:scale-105 transition-transform"
              title="View Profile"
            >
              {userName.charAt(0).toUpperCase()}
            </Link>
          </div>
        )}

        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 text-muted hover:text-parchment hover:bg-white/5 rounded-lg transition-colors"
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {isMobileMenuOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu Panel */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-ink/98 border-t border-teal-500/10 px-6 py-4 flex flex-col gap-4">
          <Link to="/" onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
            {t('home')}
          </Link>
          <Link to="/community" onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
            {t('community')}
          </Link>
          <Link to="/map" onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
            {t('map')}
          </Link>

          {isAuthenticated ? (
            <>
              <Link to={dashboardPath} onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
                {userRole === 'admin' ? t('adminPanel') : t('dashboard')}
              </Link>
              {userName && (
                <Link to="/profile" onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
                  Profile ({userName})
                </Link>
              )}
              <button
                onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                className="text-left text-muted hover:text-parchment text-sm font-medium py-1"
              >
                {t('logout')}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-2 pt-2">
              <Link to="/login" onClick={() => setIsMobileMenuOpen(false)} className="text-center px-4 py-2 text-sm font-medium text-muted hover:text-parchment border border-white/10 rounded-lg hover:bg-white/5 transition-colors">
                {t('login')}
              </Link>
              <Link to="/register" onClick={() => setIsMobileMenuOpen(false)} className="text-center px-4 py-2 text-sm font-semibold text-ink rounded-full bg-gradient-to-r from-marigold-400 to-marigold-500">
                {t('register')}
              </Link>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/10 pt-4 mt-2">
            <span className="text-xs text-muted">Language</span>
            <button
              onClick={() => { toggleLang(); setIsMobileMenuOpen(false); }}
              className="px-3 py-1.5 text-xs font-mono-data font-semibold rounded-full border border-white/15 text-muted hover:text-parchment hover:bg-white/5 transition-colors"
            >
              {lang === 'en' ? 'اردو' : 'EN'}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
