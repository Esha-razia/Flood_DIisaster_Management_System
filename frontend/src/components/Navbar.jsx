import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";
import { formatAlertDateTime, parseTimestampMs, formatAlertMessage } from "../utils/alertDateTime";

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
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [selectedAdvisoryModal, setSelectedAdvisoryModal] = useState(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  // Per-user read state persistence across sessions and polling
  const userKey = (localStorage.getItem('userEmail') || userRole || 'guest').toLowerCase();
  const readKey = `flood-notifications-read:${userKey}`;
  const [readMap, setReadMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(readKey) || '{}'); }
    catch { return {}; }
  });

  const dismissedKey = `flood-alerts-dismissed:${userKey}`;
  const [dismissedMap, setDismissedMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(dismissedKey) || '{}'); }
    catch { return {}; }
  });

  // Check if an item is read based on its uniqueId and updated timestamp
  const isItemRead = useCallback((item) => {
    const id = item.uniqueId;
    const itemTs = item.updated_at || item.created_at;
    if (!itemTs) return false;
    const itemTime = parseTimestampMs(itemTs);
    const readTime = readMap[id] ? parseTimestampMs(readMap[id]) : 0;
    return readTime >= itemTime;
  }, [readMap]);

  // Mark an item as read when user clicks it to open popup
  const markAsRead = useCallback((item) => {
    const id = item.uniqueId;
    const itemTs = item.updated_at || item.created_at || new Date().toISOString();
    setReadMap(prev => {
      const next = { ...prev, [id]: itemTs };
      try { localStorage.setItem(readKey, JSON.stringify(next)); } catch {}
      return next;
    });
    if (item.type === 'advisory' && item.advisory_id) {
      axios.post(`${API_BASE}/advisory-notifications/${item.advisory_id}/read`, {}, {
        headers: {
          'X-FMS-Actor-Role': 'citizen',
          'X-FMS-Actor-Email': localStorage.getItem('userEmail') || 'citizen@example.com'
        }
      }).catch(() => {});
    }
  }, [readKey]);

  // Check if an item is dismissed
  const isItemDismissed = useCallback((item) => {
    const id = item.uniqueId;
    const itemTs = item.updated_at || item.created_at;
    if (!itemTs) return false;
    const itemTime = parseTimestampMs(itemTs);
    const dismissedTime = dismissedMap[id] ? parseTimestampMs(dismissedMap[id]) : 0;
    return dismissedTime >= itemTime;
  }, [dismissedMap]);

  const dismissNotification = useCallback((item) => {
    const id = item.uniqueId;
    const itemTs = item.updated_at || item.created_at || new Date().toISOString();
    setDismissedMap(prev => {
      const next = { ...prev, [id]: itemTs };
      try { localStorage.setItem(dismissedKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [dismissedKey]);

  const dismissAllVisible = useCallback((items) => {
    setDismissedMap(prev => {
      const next = { ...prev };
      items.forEach(it => {
        const itemTs = it.updated_at || it.created_at || new Date().toISOString();
        next[it.uniqueId] = itemTs;
      });
      try { localStorage.setItem(dismissedKey, JSON.stringify(next)); } catch {}
      return next;
    });
    setShowAllAlerts(false);
  }, [dismissedKey]);

  // Merge and sort alerts and advisories chronologically (newest first)
  const allNotifications = useMemo(() => {
    const list = [];
    (recentAlerts || []).forEach(item => {
      // Fix 2: exclude Low-risk flood alerts from notification panel and unread badge
      if (item.status === 'Active' && item.risk_level !== 'Low') {
        const ts = item.updated_at || item.created_at;
        list.push({
          ...item,
          type: 'alert',
          uniqueId: `alert-${item.id}`,
          timestamp: ts,
          timestampMs: parseTimestampMs(ts)
        });
      }
    });
    (advisoryNotes || []).forEach(item => {
      const ts = item.updated_at || item.created_at;
      list.push({
        ...item,
        type: 'advisory',
        uniqueId: `advisory-${item.advisory_id || item.id}`,
        timestamp: ts,
        timestampMs: parseTimestampMs(ts)
      });
    });

    // Deduplicate
    const seen = new Set();
    const deduped = [];
    for (const item of list) {
      if (!seen.has(item.uniqueId)) {
        seen.add(item.uniqueId);
        deduped.push(item);
      }
    }

    // Sort newest first by actual timestamp (numeric ms)
    deduped.sort((a, b) => b.timestampMs - a.timestampMs);

    return deduped;
  }, [recentAlerts, advisoryNotes]);

  // Fix 3: always exclude dismissed notifications for all users
  const visibleNotifications = useMemo(() => {
    return allNotifications.filter(item => !isItemDismissed(item));
  }, [allNotifications, isItemDismissed]);

  // Fix 3: for citizens, displayedNotifications always excludes dismissed; for admin/official showAllAlerts overrides
  const displayedNotifications = (showAllAlerts && userRole !== 'citizen') ? allNotifications : visibleNotifications;

  // Bell dot: only appears when there is genuinely unread notification
  const hasUnread = visibleNotifications.some(item => !isItemRead(item));

  // Outside click & escape for notifications panel
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

  // Escape key for details modals
  useEffect(() => {
    if (!selectedAlert && !selectedAdvisoryModal) return;
    const esc = (e) => {
      if (e.key === 'Escape') {
        setSelectedAlert(null);
        setSelectedAdvisoryModal(null);
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [selectedAlert, selectedAdvisoryModal]);

  // Lock body scroll while alert/advisory popup modal is open
  useEffect(() => {
    if (selectedAlert || selectedAdvisoryModal) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = orig; };
    }
  }, [selectedAlert, selectedAdvisoryModal]);

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
        try {
          const notesRes = await axios.get(`${API_BASE}/advisory-notifications`, {
            headers: {
              'X-FMS-Actor-Role': 'citizen',
              'X-FMS-Actor-Email': localStorage.getItem('userEmail') || 'citizen@example.com'
            },
            timeout: 6000
          });
          const fetchedNotes = Array.isArray(notesRes.data) ? notesRes.data : [];
          if (fetchedNotes.length > 0) {
            setAdvisoryNotes(fetchedNotes);
          } else {
            const advRes = await axios.get(`${API_BASE}/advisories`, { timeout: 6000 });
            const list = (advRes.data || []).map((a) => ({
              advisory_id: a.id,
              title: a.title,
              message: a.message,
              region: a.region,
              issued_by: a.issued_by,
              created_at: a.created_at,
              read: false,
            }));
            setAdvisoryNotes(list);
          }
        } catch {
          try {
            const advRes = await axios.get(`${API_BASE}/advisories`, { timeout: 6000 });
            const list = (advRes.data || []).map((a) => ({
              advisory_id: a.id,
              title: a.title,
              message: a.message,
              region: a.region,
              issued_by: a.issued_by,
              created_at: a.created_at,
              read: false,
            }));
            setAdvisoryNotes(list);
          } catch {
            setAdvisoryNotes([]);
          }
        }
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
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    (recentAlerts || []).forEach(item => {
      const isUnread = !isItemRead({ uniqueId: `alert-${item.id}`, ...item });
      if (item.status === 'Active' && versions.current.get(item.id) !== item.updated_at && isUnread) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`${item.risk_level} flood risk — ${item.location}`, { body: formatAlertMessage(item.message) });
        }
      }
      versions.current.set(item.id, item.updated_at);
    });
  }, [recentAlerts, isItemRead]);

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
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-parchment">{lang === 'ur' ? 'اطلاعات' : 'Notifications'}</h3>
                        <p className="text-xs text-muted">{t('alertsAndAdvisories')}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2.5 text-xs">
                      <button className={`transition font-medium ${!showHistory && !showAllAlerts ? 'text-teal-300 font-semibold underline' : 'text-muted hover:text-parchment'}`} onClick={() => { setShowHistory(false); setShowAllAlerts(false); }}>{t('current')}</button>
                      <button className={`transition font-medium ${!showHistory && showAllAlerts ? 'text-teal-300 font-semibold underline' : 'text-muted hover:text-parchment'}`} onClick={() => { setShowHistory(false); setShowAllAlerts(true); }}>{t('viewAll')}</button>
                      {official && <button className={`transition font-medium ${showHistory ? 'text-teal-300 font-semibold underline' : 'text-muted hover:text-parchment'}`} onClick={() => setShowHistory(true)}>{t('alertHistory')}</button>}
                      {!showAllAlerts && userRole === 'citizen' && visibleNotifications.length > 0 && <button className="text-muted hover:text-parchment ml-auto" onClick={() => dismissAllVisible(visibleNotifications)}>{t('clearAll')}</button>}
                      {userRole === 'admin' && <button className="text-marigold-300 ml-auto font-medium" onClick={() => { setEditing('new'); setDraft({ message: '', location: '', risk_level: 'Medium' }); }}>{t('createAlertBtn')}</button>}
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
                          <p className="text-xs text-teal-300">Alert #{entry.alert_id} · {entry.action} · {entry.alert?.risk_level || ''}</p>
                          <p className="text-sm text-parchment">{formatAlertMessage(entry.alert?.message)}</p>
                          <p className="text-xs text-muted">{entry.alert?.location} · {entry.actor}</p>
                          <p className="text-xs text-muted">{formatAlertDateTime(entry.timestamp)}</p>
                        </div>
                      ))
                    ) : (
                      <>
                        {displayedNotifications.length === 0 ? (
                          <p className="text-xs text-muted px-4 py-4">{showAllAlerts ? t('noAlertsOrAdvisories') : t('nothingToShowCleared')}</p>
                        ) : (
                          displayedNotifications.map(item => {
                            const read = isItemRead(item);
                            if (item.type === 'advisory') {
                              return (
                                <div
                                  key={item.uniqueId}
                                  onClick={() => {
                                    setSelectedAdvisoryModal(item);
                                    markAsRead(item);
                                  }}
                                  className="px-4 py-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors text-left"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-mono-data uppercase tracking-wider px-2 py-0.5 rounded-full border border-marigold-500/40 text-marigold-300 font-semibold bg-marigold-500/10">
                                        {t('publicAdvisory')}
                                      </span>
                                      {!read ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-marigold-300">
                                          <span className="w-1.5 h-1.5 rounded-full bg-marigold-400"></span>
                                          {t('unread')}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-muted">{t('read')}</span>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-muted whitespace-nowrap">{formatAlertDateTime(item.timestamp)}</span>
                                  </div>

                                  <h4 className="text-sm font-medium text-parchment line-clamp-1">{item.title}</h4>
                                  <p className="text-xs text-muted line-clamp-1 mt-0.5">{item.message}</p>

                                  <div className="flex items-center justify-between mt-2 pt-1">
                                    <span className="text-[11px] text-marigold-300 font-medium hover:underline">
                                      {lang === 'ur' ? 'تفصیلات دیکھیں ←' : 'View details →'}
                                    </span>
                                    {userRole === 'citizen' && (
                                      <button
                                        type="button"
                                        className="text-xs text-muted hover:text-white px-2 py-0.5 border border-white/10 rounded-md hover:bg-white/10 transition"
                                        aria-label={`Dismiss advisory: ${item.title}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          dismissNotification(item);
                                        }}
                                      >
                                        {t('dismissAdvisory')}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            // Alert item
                            return (
                              <div
                                key={item.uniqueId}
                                onClick={() => {
                                  setSelectedAlert(item);
                                  markAsRead(item);
                                }}
                                className="px-4 py-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors text-left"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-mono-data uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${
                                      item.risk_level === 'High' ? 'bg-red-500/20 border-red-500/40 text-red-300' :
                                      item.risk_level === 'Medium' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
                                      'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                    }`}>
                                      {lang === 'ur' ? (item.risk_level === 'High' ? 'زیادہ خطرہ' : item.risk_level === 'Medium' ? 'درمیانہ خطرہ' : 'کم خطرہ') : `${item.risk_level} Risk`}
                                    </span>
                                    {!read ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-marigold-300">
                                        <span className="w-1.5 h-1.5 rounded-full bg-marigold-400"></span>
                                        {t('unread')}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-muted">{t('read')}</span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-muted whitespace-nowrap">{formatAlertDateTime(item.timestamp)}</span>
                                </div>

                                <h4 className="text-sm font-semibold text-parchment leading-snug">
                                  {item.title || (lang === 'ur' ? `${item.risk_level} سیلاب الرٹ` : `${item.risk_level} Flood Alert`)}
                                </h4>
                                <p className="text-xs text-teal-300/90 mt-0.5">
                                  📍 {item.location}
                                </p>

                                <div className="flex items-center justify-between mt-2 pt-1">
                                  <span className="text-[11px] text-teal-400 font-medium hover:underline">
                                    {lang === 'ur' ? 'تفصیلات دیکھیں ←' : 'View details →'}
                                  </span>
                                  {userRole === 'citizen' && (
                                    <button
                                      type="button"
                                      className="text-xs text-muted hover:text-white px-2 py-0.5 border border-white/10 rounded-md hover:bg-white/10 transition"
                                      aria-label={`Dismiss alert: ${item.location}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        dismissNotification(item);
                                      }}
                                    >
                                      {t('dismiss')}
                                    </button>
                                  )}
                                </div>

                                {userRole === 'admin' && (
                                  <div className="flex gap-3 mt-2 text-xs pt-1 border-t border-white/5" onClick={e => e.stopPropagation()}>
                                    <button className="text-teal-300" onClick={() => { setEditing(item.id); setDraft({ message: item.message, location: item.location, risk_level: item.risk_level }); }}>{t('update')}</button>
                                    <button className="text-red-300" onClick={() => cancelAlert(item.id)}>{t('cancelAlert')}</button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
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
          {/* Alert Details Popup Modal */}
      {selectedAlert && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[99999] w-screen h-screen min-h-screen bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto cursor-pointer"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedAlert(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-ink-soft p-6 sm:p-7 shadow-2xl max-h-[85vh] overflow-y-auto text-left cursor-default my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <span className={`text-[10px] font-mono-data uppercase tracking-widest px-2.5 py-1 rounded-full border font-bold ${
                selectedAlert.risk_level === 'High' ? 'bg-red-500/20 border-red-500/50 text-red-300' :
                selectedAlert.risk_level === 'Medium' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' :
                'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              }`}>
                {lang === 'ur' ? (selectedAlert.risk_level === 'High' ? 'زیادہ خطرہ' : selectedAlert.risk_level === 'Medium' ? 'درمیانہ خطرہ' : 'کم خطرہ') : `${selectedAlert.risk_level} Flood Risk`}
              </span>
              <button
                type="button"
                aria-label="Close dialog"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-white/20 bg-white/10 text-parchment hover:bg-white/20 hover:text-white transition font-bold text-lg leading-none shrink-0"
                onClick={() => setSelectedAlert(null)}
              >
                ✕
              </button>
            </div>

            <h3 className="font-display text-2xl text-parchment mb-2">
              {selectedAlert.title || (lang === 'ur' ? `${selectedAlert.risk_level} سیلاب انتباہ` : `${selectedAlert.risk_level} Flood Warning`)}
            </h3>
            <p className="text-sm font-semibold text-teal-300 mb-4 flex items-center gap-1.5">
              <span>📍</span> {selectedAlert.location}
            </p>

            <div className="rounded-xl bg-ink/70 border border-white/5 p-4 mb-5">
              <p className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5">{lang === 'ur' ? 'انتباہی پیغام' : 'Warning Message'}</p>
              <p className="text-sm text-parchment/95 leading-relaxed whitespace-pre-wrap">{formatAlertMessage(selectedAlert.message)}</p>
            </div>

            <dl className="text-xs text-muted space-y-2 border-t border-white/10 pt-4">
              <div>
                <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'متاثرہ مقام: ' : 'Affected location: '}</dt>
                <dd className="inline text-parchment">{selectedAlert.location}</dd>
              </div>
              <div>
                <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'جاری کردہ: ' : 'Issued date & time: '}</dt>
                <dd className="inline text-parchment">{formatAlertDateTime(selectedAlert.created_at)}</dd>
              </div>
              {selectedAlert.updated_at && selectedAlert.updated_at !== selectedAlert.created_at && (
                <div>
                  <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'آخری تجدید: ' : 'Updated date & time: '}</dt>
                  <dd className="inline text-parchment">{formatAlertDateTime(selectedAlert.updated_at)}</dd>
                </div>
              )}
              {selectedAlert.rainfall != null && selectedAlert.rainfall !== '' && (
                <div>
                  <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'بارش: ' : 'Rainfall: '}</dt>
                  <dd className="inline text-parchment">{selectedAlert.rainfall} mm</dd>
                </div>
              )}
              {(selectedAlert.issuer || selectedAlert.issued_by || (selectedAlert.source && selectedAlert.source !== 'manual')) && (
                <div>
                  <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'ذریعہ / جاری کنندہ: ' : 'Issuer / Source: '}</dt>
                  <dd className="inline text-parchment">{selectedAlert.issuer || selectedAlert.issued_by || (selectedAlert.source === 'automatic' ? (lang === 'ur' ? 'خودکار پیشگوئی الرٹ' : 'Automated Prediction Alert') : selectedAlert.source)}</dd>
                </div>
              )}
              {(selectedAlert.recommended_action || selectedAlert.action) && (
                <div>
                  <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'تجویز کردہ کارروائی: ' : 'Recommended action: '}</dt>
                  <dd className="inline text-parchment">{selectedAlert.recommended_action || selectedAlert.action}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>,
        document.body
      )}

      {/* Advisory Details Popup Modal */}
      {selectedAdvisoryModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[99999] w-screen h-screen min-h-screen bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto cursor-pointer"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedAdvisoryModal(null)}
        >
          <div
            className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-ink-soft p-6 sm:p-7 shadow-2xl max-h-[85vh] overflow-y-auto text-left cursor-default my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <span className="text-[10px] font-mono-data uppercase tracking-widest px-2.5 py-1 rounded-full border border-marigold-500/40 text-marigold-300 font-bold bg-marigold-500/10">
                {t('publicAdvisory')}
              </span>
              <button
                type="button"
                aria-label="Close dialog"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-white/20 bg-white/10 text-parchment hover:bg-white/20 hover:text-white transition font-bold text-lg leading-none shrink-0"
                onClick={() => setSelectedAdvisoryModal(null)}
              >
                ✕
              </button>
            </div>

            <h3 className="font-display text-2xl text-parchment mb-2">{selectedAdvisoryModal.title}</h3>
            <p className="text-sm font-semibold text-teal-300 mb-4 flex items-center gap-1.5">
              <span>📍</span> {selectedAdvisoryModal.region || (lang === 'ur' ? 'تمام علاقے' : 'All regions')}
            </p>

            <div className="rounded-xl bg-ink/70 border border-white/5 p-4 mb-5">
              <p className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5">{lang === 'ur' ? 'پیغام' : 'Message'}</p>
              <p className="text-sm text-parchment/95 leading-relaxed whitespace-pre-wrap">{selectedAdvisoryModal.message}</p>
            </div>

            <dl className="text-xs text-muted space-y-2 border-t border-white/10 pt-4">
              <div>
                <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'علاقہ: ' : 'Region: '}</dt>
                <dd className="inline text-parchment">{selectedAdvisoryModal.region || (lang === 'ur' ? 'تمام علاقے' : 'All regions')}</dd>
              </div>
              <div>
                <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'جاری کنندہ: ' : 'Issued by: '}</dt>
                <dd className="inline text-parchment">{selectedAdvisoryModal.issued_by || (lang === 'ur' ? 'سرکاری اہلکار' : 'Government Official')}</dd>
              </div>
              <div>
                <dt className="inline text-teal-300 font-medium">{lang === 'ur' ? 'تاریخ اشاعت: ' : 'Published: '}</dt>
                <dd className="inline text-parchment">{formatAlertDateTime(selectedAdvisoryModal.created_at)}</dd>
              </div>
            </dl>
          </div>
        </div>,
        document.body
      )}
    </nav>
  );
}
