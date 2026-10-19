import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";
import { formatAlertDateTime } from "../utils/alertDateTime";

export default function Navbar() {
  const { lang, t, toggleLang } = useLanguage();
  const [userRole, setUserRole] = useState(() => localStorage.getItem('userRole'));
  const [userName, setUserName] = useState(() => localStorage.getItem('userName'));
  const isAuthenticated = Boolean(userRole && userName);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [advisoryNotes, setAdvisoryNotes] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ message: '', location: '', risk_level: 'Medium' });
  const versions = useRef(new Map());
  const alertsContainer = useRef(null);
  const seenKey = `flood-alerts-seen:${localStorage.getItem('userEmail') || userRole || 'guest'}`;
  const [seenVersions, setSeenVersions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(seenKey) || '{}'); }
    catch { return {}; }
  });
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const dismissedKey = `flood-alerts-dismissed:${localStorage.getItem('userEmail') || userRole || 'guest'}`;
  const [dismissedVersions, setDismissedVersions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(dismissedKey) || '{}'); }
    catch { return {}; }
  });
  const alertVersion = item => JSON.stringify([item.updated_at, item.created_at, item.status, item.message, item.risk_level, item.location]);
  const noteVersion = item => JSON.stringify([item.created_at, item.title, item.message]);
  const visibleAlerts = recentAlerts.filter(item => item.status === 'Active' &&
    (userRole !== 'citizen' || dismissedVersions[`alert-${item.id}`] !== alertVersion(item)));
  const visibleNotes = advisoryNotes.filter(item =>
    userRole !== 'citizen' || dismissedVersions[`advisory-${item.advisory_id}`] !== noteVersion(item));
  const displayedAlerts = showAllAlerts ? recentAlerts.filter(item => item.status === 'Active') : visibleAlerts;
  const displayedNotes = showAllAlerts ? advisoryNotes : visibleNotes;
  const dismissNotifications = (items, notes = []) => {
    setDismissedVersions(previous => {
      const next = { ...previous };
      items.forEach(item => { next[`alert-${item.id}`] = alertVersion(item); });
      notes.forEach(item => { next[`advisory-${item.advisory_id}`] = noteVersion(item); });
      localStorage.setItem(dismissedKey, JSON.stringify(next));
      return next;
    });
    setShowAllAlerts(false);
  };
  const hasUnread = visibleAlerts.some(item => seenVersions[`alert-${item.id}`] !== alertVersion(item))
    || visibleNotes.some(item => !item.read && seenVersions[`advisory-${item.advisory_id}`] !== noteVersion(item));

  useEffect(() => {
    if (!showAlertsPanel) return;
    setSeenVersions(previous => {
      const next = { ...previous };
      recentAlerts.forEach(item => { next[`alert-${item.id}`] = alertVersion(item); });
      advisoryNotes.forEach(item => { next[`advisory-${item.advisory_id}`] = noteVersion(item); });
      localStorage.setItem(seenKey, JSON.stringify(next));
      return next;
    });
  }, [showAlertsPanel, recentAlerts, advisoryNotes, seenKey]);

  useEffect(() => {
    if (!showAlertsPanel) return;
    const outside = event => {
      if (!alertsContainer.current?.contains(event.target)) setShowAlertsPanel(false);
    };
    const escape = event => { if (event.key === 'Escape') setShowAlertsPanel(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [showAlertsPanel]);

  const navigate = useNavigate();
  const official = ['admin', 'government_official'].includes(userRole);

  const refresh = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE}/alerts`);
      setRecentAlerts(response.data);
      if (official) {
        const result = await axios.get(`${API_BASE}/alerts/history`);
        setHistory(result.data);
      }
      setError('');
      if (userRole === 'citizen') {
        const notes = await axios.get(`${API_BASE}/advisory-notifications`).catch(() => ({ data: [] }));
        setAdvisoryNotes(notes.data || []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load alerts.');
    }
  }, [official, userRole]);

  useEffect(() => {
    if (!isAuthenticated) return;
    // Discard legacy saved notification/reminder entries, without touching accounts.
    Object.keys(localStorage).filter(key => key.startsWith('flood-reminders:')).forEach(key => localStorage.removeItem(key));
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    recentAlerts.forEach(item => {
      if (item.status === 'Active' && versions.current.get(item.id) !== item.updated_at && seenVersions[`alert-${item.id}`] !== alertVersion(item)) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`${item.risk_level} flood risk — ${item.location}`, { body: item.message });
        }
      }
      versions.current.set(item.id, item.updated_at);
    });
  }, [recentAlerts]);

  const saveAlert = async (event) => {
    event.preventDefault();
    try {
      if (editing === 'new') await axios.post(`${API_BASE}/alerts`, draft);
      else await axios.put(`${API_BASE}/alerts/${editing}`, draft);
      setEditing(null);
      await refresh();
    } catch (err) { setError(err.response?.data?.message || 'Could not save alert.'); }
  };
  const cancelAlert = async (id) => {
    try {
      await axios.put(`${API_BASE}/alerts/${id}`, { status: 'Cancelled' });
      if (editing === id) setEditing(null);
      await refresh();
    } catch (err) { setError(err.response?.data?.message || 'Could not cancel alert.'); }
  };
  const handleLogout = () => {
    ['userRole', 'userName', 'userEmail', 'userId', 'notificationToken'].forEach(key => localStorage.removeItem(key));
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

  const getDashboardLabel = () => {
    switch (userRole) {
      case 'admin':
        return t('adminPanel');
      case 'rescue_worker':
        return lang === 'ur' ? 'ریسکیو سینٹر' : 'Rescue Center';
      case 'citizen':
        return lang === 'ur' ? 'سٹیزن پورٹل' : 'Citizen Portal';
      case 'government_official':
        return lang === 'ur' ? 'گورنمنٹ پورٹل' : 'Gov Portal';
      default:
        return t('dashboard');
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-ink/95 backdrop-blur-xl border-b border-teal-500/10">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center border border-marigold-500/40 bg-gradient-to-br from-teal-600/30 to-marigold-600/20">
            <span className="font-display text-marigold-400 text-lg leading-none">F</span>
          </div>
          <span className="font-display text-parchment text-sm sm:text-lg tracking-tight whitespace-nowrap">
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
            <Link
              to={dashboardPath}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-muted hover:text-parchment hover:bg-white/5"
            >
              {getDashboardLabel()}
            </Link>
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
        </div>

        {isAuthenticated && userName && (
          <div className="flex items-center gap-3 ml-auto md:ml-4 md:pl-4 md:border-l md:border-white/10">
            <div className="relative" ref={alertsContainer}>
              <button aria-expanded={showAlertsPanel} onClick={() => setShowAlertsPanel(v => !v)} className="relative w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-parchment hover:bg-white/5" title="Notifications" aria-label="Notifications">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {(!showAlertsPanel && hasUnread) && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-marigold-400"/>}
              </button>
              {showAlertsPanel && (
                <div className="fixed right-2 top-16 w-[min(24rem,calc(100vw-1rem))] md:absolute md:right-0 md:top-full md:mt-2 rounded-2xl border border-white/10 bg-ink-soft shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm font-semibold text-parchment">{t('alertsAndAdvisories')}</p>
                    <div className="flex gap-2 mt-2 text-xs">
                      <button className="text-teal-300" onClick={() => { setShowHistory(false); setShowAllAlerts(false); }}>{t('current')}</button>
                      <button className="text-teal-300" onClick={() => { setShowHistory(false); setShowAllAlerts(true); }}>{t('viewAll')}</button>
                      {official && <button className="text-teal-300" onClick={() => setShowHistory(true)}>{t('alertHistory')}</button>}
                      {!showAllAlerts && userRole === 'citizen' && (visibleAlerts.length > 0 || visibleNotes.length > 0) && <button className="text-muted ml-auto" onClick={() => dismissNotifications(visibleAlerts, visibleNotes)}>{t('clearAll')}</button>}
                      {userRole === 'admin' && <button className="text-marigold-300" onClick={() => { setEditing('new'); setDraft({ message: '', location: '', risk_level: 'Medium' }); }}>{t('createAlertBtn')}</button>}
                    </div>
                    {'Notification' in window && Notification.permission === 'default' && <button className="text-xs text-muted mt-2" onClick={() => Notification.requestPermission()}>{t('enableBrowserNotifications')}</button>}
                    {error && <p className="text-xs text-red-300 mt-2" role="alert">{error}</p>}
                    {editing !== null && userRole === 'admin' && (
                      <form onSubmit={saveAlert} className="space-y-2 mt-3">
                        <input required aria-label={t('alertMessage')} placeholder={t('alertMessage')} className="field-input text-xs" value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })}/>
                        <input required aria-label={t('affectedLocation')} placeholder={t('affectedLocation')} className="field-input text-xs" value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })}/>
                        <select aria-label={t('riskLevel')} className="field-input text-xs" value={draft.risk_level} onChange={e => setDraft({ ...draft, risk_level: e.target.value })}>{['Low','Medium','High'].map(r => <option key={r} value={r}>{r === 'High' ? (lang === 'ur' ? 'زیادہ خطرہ (High)' : 'High') : r === 'Medium' ? (lang === 'ur' ? 'درمیانہ خطرہ (Medium)' : 'Medium') : (lang === 'ur' ? 'کم خطرہ (Low)' : 'Low')}</option>)}</select>
                        <button className="text-xs text-teal-300" type="submit">{t('saveAlert')}</button>
                        <button className="text-xs text-muted ml-3" type="button" onClick={() => setEditing(null)}>{t('close')}</button>
                      </form>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto" aria-live="polite">
                    {showHistory && official ? (
                      history.length === 0 ? <p className="text-xs text-muted px-4 py-4">{t('noAlertHistory')}</p> : history.map(entry => (
                        <div key={entry.id} className="px-4 py-3 border-b border-white/5">
                          <p className="text-xs text-teal-300">Alert #{entry.alert_id} · {entry.action} · {entry.alert.risk_level}</p>
                          <p className="text-sm text-parchment">{entry.alert.message}</p>
                          <p className="text-xs text-muted">{entry.alert.location} · {entry.actor}</p>
                          <p className="text-xs text-muted">{formatAlertDateTime(entry.timestamp)}</p>
                        </div>
                      ))
                    ) : (
                      <>
                        {displayedNotes.map(n => (
                          <div key={`adv-${n.advisory_id}`}><Link to={`/community?advisory=${n.advisory_id}&n=${Date.now()}`} onClick={() => { setShowAlertsPanel(false); setAdvisoryNotes(list => list.map(x => x.advisory_id === n.advisory_id ? { ...x, read: true } : x)); }} className="block px-4 py-3 border-b border-white/5 hover:bg-white/5">
                            <p className="text-xs text-marigold-300">{t('publicAdvisory')} · {n.read ? t('read') : t('unread')}{!n.read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-marigold-400 ml-1.5 align-middle"/>}</p>
                            <p className="text-sm text-parchment font-medium mt-1">{n.title}</p>
                            <p className="text-xs text-muted mt-1 line-clamp-2">{n.message}</p>
                            <p className="text-xs text-muted mt-1">{formatAlertDateTime(n.created_at)}</p>
                          </Link>
                          {userRole === 'citizen' && (dismissedVersions[`advisory-${n.advisory_id}`] === noteVersion(n) ? <p className="text-xs text-muted px-4 pb-2">{t('dismissed')}</p> : <button type="button" className="text-xs text-muted px-4 pb-2" onClick={() => dismissNotifications([], [n])}>{t('dismissAdvisory')}</button>)}
                          </div>
                        ))}
                        {displayedAlerts.length === 0 && displayedNotes.length === 0 && <p className="text-xs text-muted px-4 py-4">{showAllAlerts ? t('noAlertsOrAdvisories') : t('nothingToShowCleared')}</p>}
                        {displayedAlerts.map(item => (
                          <div key={item.id} className="px-4 py-3 border-b border-white/5">
                            <p className="text-xs text-teal-300">{lang === 'ur' ? (item.risk_level === 'High' ? 'زیادہ خطرہ' : item.risk_level === 'Medium' ? 'درمیانہ خطرہ' : 'کم خطرہ') : `${item.risk_level} risk`} · {item.location}</p>
                            <p className="text-sm text-parchment font-medium mt-1">{item.message}</p>
                            {userRole === 'citizen' && (dismissedVersions[`alert-${item.id}`] === alertVersion(item) ? <p className="text-xs text-muted mt-2">{t('dismissed')}</p> : <button type="button" className="text-xs text-muted mt-2 px-2 py-1 border border-white/15 rounded-md" aria-label={`Dismiss alert: ${item.location}`} onClick={() => dismissNotifications([item])}>{t('dismiss')}</button>)}
                            <p className="text-xs text-muted mt-1">{t('created')}: {formatAlertDateTime(item.created_at)}</p>
                            {userRole === 'admin' && <div className="flex gap-3 mt-2 text-xs"><button className="text-teal-300" onClick={() => { setEditing(item.id); setDraft({ message: item.message, location: item.location, risk_level: item.risk_level }); }}>{t('update')}</button><button className="text-red-300" onClick={() => cancelAlert(item.id)}>{t('cancelAlert')}</button></div>}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <Link to="/profile" className="hidden md:block text-right hover:opacity-80 transition-opacity" title="View Profile">
              <div className="text-sm text-parchment font-medium">{userName}</div>
              <div className="text-xs text-muted font-mono-data uppercase tracking-wide">
                {userRole?.replace('_', ' ')}
              </div>
            </Link>
            <Link
              to="/profile"
              className="hidden md:flex w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-marigold-500 items-center justify-center text-ink text-sm font-bold hover:scale-105 transition-transform"
              title="View Profile"
            >
              {userName.charAt(0).toUpperCase()}
            </Link>
            <button
              onClick={handleLogout}
              className="hidden md:flex w-8 h-8 rounded-full items-center justify-center text-muted/70 hover:text-red-400 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer group"
              title={t('logout')}
              aria-label="Logout"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="group-hover:translate-x-0.5 transition-transform"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
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
              <Link
                to={dashboardPath}
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-muted hover:text-parchment text-sm font-medium py-1"
              >
                {getDashboardLabel()}
              </Link>
              {userName && (
                <Link to="/profile" onClick={() => setIsMobileMenuOpen(false)} className="text-muted hover:text-parchment text-sm font-medium py-1">
                  {t('profile')} ({userName})
                </Link>
              )}
              <button
                onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                className="flex items-center gap-2 text-left text-red-400 hover:text-red-300 text-sm font-medium py-1.5 border-t border-white/10 pt-2 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
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
        </div>
      )}
    </nav>
  );
}
