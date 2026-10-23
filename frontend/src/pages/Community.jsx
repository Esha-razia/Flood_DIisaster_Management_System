import { formatAlertDateTime } from '../utils/alertDateTime';
import { capitalizeDescription, validateReportFields, reportImageError, getReportImageSource } from '../utils/reportValidation';
import { lookupLocation, getCurrentPosition, locationErrorMessage } from "../utils/mapLocation";
import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";


const INCIDENT_TYPES = ["Flooding", "Landslide", "Road Blockage", "Water Contamination", "Infrastructure Damage", "Evacuation Required"];
const INCIDENT_TYPE_KEY_MAP = {
  "Flooding": "incidentFlooding", "Landslide": "incidentLandslide", "Road Blockage": "incidentRoadBlockage",
  "Water Contamination": "incidentWaterContamination", "Infrastructure Damage": "incidentInfraDamage",
  "Evacuation Required": "incidentEvacuation",
};
const SEVERITY_OPTIONS = ["Low", "Medium", "High"];
const SEVERITY_KEY_MAP = { "Low": "lowSeverity", "Medium": "mediumSeverity", "High": "highSeverity" };
const STATUS_FLOW = ["Submitted", "Action Taken", "Resolved"];
const STATUS_KEY_MAP = { "Submitted": "submitted", "Action Taken": "actionTaken", "Resolved": "resolved" };


function formatTimeStamp(value) {
  return formatAlertDateTime(value);
}

function severityStyles(value) {
  if (value === "High") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (value === "Medium") return "bg-amber-400/15 text-amber-400 border-amber-400/30";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
}

function statusStyles(value) {
  if (value === "Resolved") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (value === "Action Taken") return "bg-teal-500/15 text-teal-300 border-teal-500/30";
  if (value === "Under Review") return "bg-amber-400/15 text-amber-400 border-amber-400/30";
  return "bg-white/10 text-muted border-white/20";
}

// Session storage caching for fast page navigation between Community and Map
const getCachedReports = (key) => {
  try {
    const val = sessionStorage.getItem(`fms-cache-reports:${key}`);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
};
const setCachedReports = (key, data) => {
  try {
    sessionStorage.setItem(`fms-cache-reports:${key}`, JSON.stringify(data));
  } catch {}
};
const getCachedStats = () => {
  try {
    const val = sessionStorage.getItem('fms-cache-community-stats');
    return val ? JSON.parse(val) : null;
  } catch { return null; }
};
const setCachedStats = (data) => {
  try {
    sessionStorage.setItem('fms-cache-community-stats', JSON.stringify(data));
  } catch {}
};

export default function Community() {
  const { t, lang } = useLanguage();
  const routerLocation = useLocation();
  const [advisories, setAdvisories] = useState([]);
  const [selectedAdvisory, setSelectedAdvisory] = useState(null);
  const advisoryIdParam = new URLSearchParams(routerLocation.search).get("advisory");
  const userRole = localStorage.getItem("userRole");
  const userName = localStorage.getItem("userName");
  const userEmail = localStorage.getItem("userEmail");
  const isCitizen = userRole === "citizen";
  const isGovernmentOfficial = userRole === "government_official";
  const isReviewer = ["admin", "rescue_worker", "government_official"].includes(userRole);

  const userCacheKey = (userEmail || userRole || 'guest').toLowerCase();
  const cachedInitialReports = getCachedReports(userCacheKey);
  const cachedInitialStats = getCachedStats();

  const [reports, setReports] = useState(() => cachedInitialReports || []);
  const [systemStats, setSystemStats] = useState(() => cachedInitialStats);
  const [loadingReports, setLoadingReports] = useState(() => !cachedInitialReports);
  const [reportsError, setReportsError] = useState(null);
  const [loadingStats, setLoadingStats] = useState(() => !cachedInitialStats);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const locationEdited = useRef(false);
  const [formState, setFormState] = useState({ location: "", type: "Flooding", description: "", severity: "", contact: "", imageFile: null, imagePreview: "" });
  const [formFieldErrors, setFormFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [activeReportId, setActiveReportId] = useState(() => Number(new URLSearchParams(window.location.search).get('report')) || null);
  const [toast, setToast] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [filters, setFilters] = useState({ severity: "All", status: "All", region: "All" });
  const [rescueWorkers, setRescueWorkers] = useState([]);
  const [assigningReportId, setAssigningReportId] = useState(null);
  const [assignWorkerChoice, setAssignWorkerChoice] = useState("");

  const isFetchingReports = useRef(false);
  const isFetchingStats = useRef(false);

  // Fetch reports independently so reports render as soon as they arrive
  const fetchReports = async () => {
    if (isFetchingReports.current) return;
    isFetchingReports.current = true;
    try {
      const res = await axios.get(`${API_BASE}/community-reports`, {
        params: isCitizen && userEmail ? { email: userEmail } : {},
      });
      const data = res.data || [];
      setReports(data);
      setCachedReports(userCacheKey, data);
      setReportsError(null);
      setActiveReportId((prev) => prev ?? data[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load community reports:", err);
      setReportsError(lang === 'ur' ? 'رپورٹس لوڈ کرنے میں ناکامی ہوئی' : 'Failed to load reports. Please try again.');
    } finally {
      setLoadingReports(false);
      isFetchingReports.current = false;
    }
  };

  // Fetch statistics concurrently & independently
  const fetchStats = async () => {
    if (isFetchingStats.current) return;
    isFetchingStats.current = true;
    try {
      const res = await axios.get(`${API_BASE}/community-stats`);
      if (res.data) {
        setSystemStats(res.data);
        setCachedStats(res.data);
      }
    } catch (err) {
      console.error("Failed to load community stats:", err);
    } finally {
      setLoadingStats(false);
      isFetchingStats.current = false;
    }
  };

  useEffect(() => {
    fetchReports();
    fetchStats();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchReports();
        fetchStats();
      }
    }, 15000); // keep the review queue live
    return () => clearInterval(interval);
  }, [userCacheKey]);
  useEffect(() => {
    if (!isReviewer) return;
    axios.get(`${API_BASE}/users`).then((res) => {
      setRescueWorkers((res.data || []).filter((u) => u.role === "rescue_worker"));
    }).catch(() => {});
  }, [isReviewer]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);

  useEffect(() => {
    let active = true;
    const loadAdvisories = async () => {
      const [live, notified] = await Promise.all([
        axios.get(`${API_BASE}/advisories`).then((r) => r.data || []).catch(() => []),
        axios.get(`${API_BASE}/advisory-notifications`).then((r) => r.data || []).catch(() => []),
      ]);
      if (!active) return;
      const liveIds = new Set(live.map((a) => String(a.id)));
      const withdrawn = notified
        .filter((n) => !liveIds.has(String(n.advisory_id)))
        .map((n) => ({ id: n.advisory_id, title: n.title, message: n.message, region: n.region, issued_by: n.issued_by, created_at: n.created_at, withdrawn: true }));
      const all = [...live.map((a) => ({ ...a, withdrawn: false })), ...withdrawn];
      all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setAdvisories(all);
    };
    loadAdvisories();
    const interval = setInterval(() => { if (document.visibilityState !== 'hidden') loadAdvisories(); }, 30000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const openAdvisory = (advisory) => {
    setSelectedAdvisory(advisory);
    axios.post(`${API_BASE}/advisory-notifications/${advisory.id}/read`).catch(() => {});
  };

  const handledAdvisoryParam = useRef(null);
  useEffect(() => {
    if (advisoryIdParam || routerLocation.hash !== "#public-advisories") return;
    const timer = setTimeout(() => document.getElementById("public-advisories")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(timer);
  }, [advisoryIdParam, routerLocation.hash, routerLocation.key]);
  useEffect(() => {
    if (!advisoryIdParam || handledAdvisoryParam.current === routerLocation.key) return;
    const match = advisories.find((a) => String(a.id) === advisoryIdParam);
    if (match) {
      handledAdvisoryParam.current = routerLocation.key;
      setSelectedAdvisory(match);
      axios.post(`${API_BASE}/advisory-notifications/${match.id}/read`).catch(() => {});
      document.getElementById("public-advisories")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [advisoryIdParam, advisories, routerLocation.key]);
  useEffect(() => {
    if (!trackingOpen) return;
    const close = event => { if (event.key === 'Escape') setTrackingOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [trackingOpen]);
  const locationBusy = useRef(false);
  const fillCurrentLocation = async () => {
    if (locationBusy.current) return;
    locationBusy.current = true;
    locationEdited.current = false;
    setLocationStatus('Finding your current location...');
    try {
      const position = await getCurrentPosition();
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      const location = await lookupLocation(latitude, longitude);
      if (!locationEdited.current) {
        setFormState(current => ({ ...current, location, latitude, longitude }));
        setFormFieldErrors(current => ({ ...current, location: '' }));
        setLocationStatus(`Device location accuracy: approximately ${Math.round(position.coords.accuracy)} metres.`);
      }
    } catch (error) { setLocationStatus(locationErrorMessage(error)); }
    finally { locationBusy.current = false; }
  };

  const filteredReports = useMemo(() => reports.filter((r) => (filters.severity === "All" || r.severity === filters.severity) && (filters.status === "All" || r.status === filters.status) && (filters.region === "All" || r.region === filters.region)), [filters, reports]);
  const visibleReports = useMemo(() => isCitizen ? reports.filter(r => (r.authorEmail || '').toLowerCase() === (userEmail || '').toLowerCase()) : filteredReports, [isCitizen, reports, userEmail, filteredReports]);
  const currentReport = useMemo(() => {
    const pool = isCitizen ? visibleReports : reports;
    return pool.find((r) => r.id === activeReportId) || pool[0] || null;
  }, [activeReportId, reports, isCitizen, visibleReports]);
  const handleFormChange = (field, value) => {
    if (field === 'description') value = capitalizeDescription(value);
    if (field === 'location') { locationEdited.current = true; setLocationStatus(''); }
    if (formFieldErrors[field]) setFormFieldErrors(prev => ({ ...prev, [field]: '' }));
    if (field === 'severity' && value) setFormFieldErrors(prev => ({ ...prev, severity: '' }));
    setFormState(prev => ({ ...prev, [field]: value, ...(field === 'location' ? { latitude: null, longitude: null } : {}) }));
  };
  const handleFileSelect = (file) => {
    if (!file) return;
    const imageError = reportImageError(file);
    if (imageError) {
      setFormFieldErrors(prev => ({ ...prev, image: imageError }));
      setFormState(prev => ({ ...prev, imageFile:null, imagePreview:'' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFormFieldErrors(prev => ({ ...prev, image: '' }));
      setFormState((prev) => ({ ...prev, imageFile: file, imagePreview: reader.result }));
    };
    reader.readAsDataURL(file);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validateReportFields(formState);
    if (Object.keys(errors).length > 0) {
      setFormFieldErrors(errors);
      setToast({ type: "error", message: t("fillRequiredFields"), time: new Date().toLocaleTimeString() });
      return;
    }
    setFormFieldErrors({});
    setSubmitting(true);

    const { location, type, severity, description, contact } = formState;
    const region = location.includes("Sindh") ? "Sindh" : location.includes("Punjab") ? "Punjab" : location.includes("KPK") ? "KPK" : location.includes("Balochistan") ? "Balochistan" : location.includes("Gilgit") ? "Gilgit-Baltistan" : "";

    try {
      const res = await axios.post(`${API_BASE}/community-reports`, {
        location, region, type, severity, description, contact,
        latitude: formState.latitude ?? null, longitude: formState.longitude ?? null,
        authorName: userName || "Guest User",
        authorEmail: userEmail || "guest@example.com",
        imageUrl: formState.imagePreview || "",
      });
      const newReport = res.data;
      setReports((prev) => {
        const next = [newReport, ...prev];
        setCachedReports(userCacheKey, next);
        return next;
      });
      setActiveReportId(newReport.id);
      fetchStats();
      setFormState(prev => ({ location: prev.location, latitude: prev.latitude, longitude: prev.longitude, type: "Flooding", description: "", severity: "", contact: "", imageFile: null, imagePreview: "" }));
      // FR06-03: acknowledgment notification on submission
      setToast({ type: "success", message: t("incidentReportSubmitted"), trackingId: newReport.trackingId, time: formatTimeStamp(newReport.createdAt) });
    } catch (err) {
      setFormFieldErrors(err.response?.data?.errors || {});
      console.error("Failed to submit report:", err);
      setToast({ type: "error", message: err.response?.data?.message || t("couldNotSubmitReport"), time: new Date().toLocaleTimeString() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReport = async (reportId) => {
    try {
      const res = await axios.post(`${API_BASE}/community-reports/${reportId}/confirm`, {
        email: userEmail || "guest@example.com",
      });
      setReports((prev) => prev.map((r) => r.id === reportId ? { ...r, confirmedBy: [...(r.confirmedBy || []), userEmail || "guest@example.com"] } : r));
      setToast({ type: "success", message: `Confirmed — ${res.data.confirmations} ${res.data.confirmations === 1 ? "person has" : "people have"} confirmed this report`, time: new Date().toLocaleTimeString() });
    } catch (err) {
      setToast({ type: "error", message: err.response?.data?.message || "Could not confirm this report.", time: new Date().toLocaleTimeString() });
    }
  };

  const handleReviewAction = async (reportId, nextStatus, assignedTeam) => {
    try {
      const payload = { status: nextStatus };
      if (nextStatus === "Action Taken") {
        payload.assigned_team = assignedTeam || "Unassigned";
      }
      const res = await axios.put(`${API_BASE}/community-reports/${reportId}/status`, payload);
      setReports((prev) => prev.map((r) => r.id === reportId ? res.data : r));
      const message = res.data.linked_rescue_op
        ? `${t("rescueOpCreatedMsg")} #${res.data.linked_rescue_op.id}`
        : `${t("reportSetTo")} ${t(STATUS_KEY_MAP[nextStatus] || nextStatus)}`;
      setToast({ type: "success", message, time: new Date().toLocaleTimeString() });
    } catch (err) {
      console.error("Failed to update report status:", err);
      setToast({ type: "error", message: "Could not update status. Please try again.", time: new Date().toLocaleTimeString() });
    }
  };

  // Opens/closes the inline rescue-worker dropdown for a given report row
  // (mirrors GovDashboard's alert-assignment pattern instead of a raw
  // window.prompt for the team name).
  const toggleAssignPanel = (reportId) => {
    setAssigningReportId((prev) => (prev === reportId ? null : reportId));
    setAssignWorkerChoice("");
  };

  const confirmAssignWorker = async (reportId) => {
    await handleReviewAction(reportId, "Action Taken", assignWorkerChoice || "Unassigned");
    setAssigningReportId(null);
    setAssignWorkerChoice("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-ink via-ink-soft to-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-24">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 space-y-20">
          {/* COMMUNITY HUB INTRO */}
          <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-ink-soft/90 to-ink/90 p-12 lg:p-16 shadow-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.15),_transparent_40%)]"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(139,92,246,0.1),_transparent_50%)]"></div>
            <div className="relative z-10 grid gap-12 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <div className="inline-flex items-center gap-3 rounded-full bg-teal-500/15 px-4 py-2 border border-teal-500/30 text-xs text-teal-300 uppercase tracking-[0.35em] font-semibold">
                  {t("communityTag")}
                </div>
                <div>
                  <h1 className="font-display text-5xl sm:text-6xl text-parchment leading-tight max-w-2xl">
                    {t("communityTitle1")} <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-300 via-teal-400 to-marigold-300">{t("communityTitle2")}</span>
                  </h1>
                  <p className="mt-6 text-xl text-muted max-w-2xl leading-relaxed">
                    {t("communityDesc")}
                  </p>
                </div>
              </div>
              <div className="rounded-[2rem] bg-ink/80 border border-white/10 p-6 lg:p-8 shadow-xl">
                <p className="text-xs uppercase tracking-[0.35em] text-muted font-semibold mb-6">{t("systemStatus")}</p>
                <div className="space-y-4">
                  <div className="rounded-2xl bg-ink-soft/90 p-4 border border-white/5">
                    <p className="text-sm text-muted">{t("activeIncidents")}</p>
                    <p className="text-3xl font-bold text-white mt-2">{systemStats?.active_incidents ?? (loadingStats ? t("loadingDots") : "—")}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-soft/90 p-4 border border-white/5">
                    <p className="text-sm text-muted">{t("monitoredRegions")}</p>
                    <p className="text-3xl font-bold text-white mt-2">{systemStats?.monitored_regions ?? (loadingStats ? t("loadingDots") : "—")}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-soft/90 p-4 border border-white/5">
                    <p className="text-sm text-muted">{t("statusLabel")}</p>
                    <p className="text-lg font-semibold text-emerald-400 mt-2 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>{systemStats ? t("live") : loadingStats ? t("loadingDots") : (lang === "ur" ? "دستیاب نہیں" : "Unavailable")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* PUBLIC ADVISORIES */}
          <section id="public-advisories" className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6 lg:p-8 shadow-xl scroll-mt-24">
            <p className="eyebrow text-teal-400 mb-3">{t("officialCommunication")}</p>
            <h2 className="font-display text-3xl text-parchment mb-6">{t("publicAdvisories")}</h2>
            {advisories.length === 0 ? (
              <p className="text-sm text-muted">{t("noAdvisoriesYet")}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {advisories.map((a) => (
                  <button key={a.id} type="button" onClick={() => openAdvisory(a)} className="text-left dashboard-card p-6 hover:border-teal-500/40 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className={`text-[10px] font-mono-data uppercase tracking-widest px-2 py-0.5 rounded-full border ${a.withdrawn ? "border-red-500/40 text-red-300" : "border-teal-500/40 text-teal-300"}`}>{a.withdrawn ? (lang === "ur" ? "واپس لیا گیا" : "Withdrawn") : (lang === "ur" ? "فعال" : "Active")}</span>
                      <span className="text-xs text-muted">{formatTimeStamp(a.created_at)}</span>
                    </div>
                    <h3 className="font-display text-lg text-parchment mb-2">{a.title}</h3>
                    <p className="text-sm text-muted leading-relaxed line-clamp-3">{a.message}</p>
                  </button>
                ))}
              </div>
            )}
          </section>
          {selectedAdvisory && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedAdvisory(null)}>
              <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-ink-soft p-7 shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className={`text-[10px] font-mono-data uppercase tracking-widest px-2 py-0.5 rounded-full border ${selectedAdvisory.withdrawn ? "border-red-500/40 text-red-300" : "border-teal-500/40 text-teal-300"}`}>{selectedAdvisory.withdrawn ? (lang === "ur" ? "واپس لیا گیا" : "Withdrawn") : (lang === "ur" ? "فعال" : "Active")}</span>
                  <button type="button" className="text-muted hover:text-parchment text-sm" onClick={() => setSelectedAdvisory(null)}>{t("close")}</button>
                </div>
                <h3 className="font-display text-2xl text-parchment mb-3">{selectedAdvisory.title}</h3>
                <p className="text-sm text-parchment/90 leading-relaxed whitespace-pre-wrap mb-5">{selectedAdvisory.message}</p>
                <dl className="text-xs text-muted space-y-1">
                  <div><dt className="inline text-teal-300">{lang === "ur" ? "علاقہ: " : "Region: "}</dt><dd className="inline">{selectedAdvisory.region || (lang === "ur" ? "تمام علاقے" : "All regions")}</dd></div>
                  <div><dt className="inline text-teal-300">{lang === "ur" ? "جاری کنندہ: " : "Issued by: "}</dt><dd className="inline">{selectedAdvisory.issued_by || (lang === "ur" ? "سرکاری اہلکار" : "Government Official")}</dd></div>
                  <div><dt className="inline text-teal-300">{lang === "ur" ? "تاریخ اشاعت: " : "Published: "}</dt><dd className="inline">{formatTimeStamp(selectedAdvisory.created_at)}</dd></div>
                </dl>
              </div>
            </div>
          )}


          <section className="grid items-start gap-6">
            {/* FORM */}
            <div className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6 lg:p-8 shadow-xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-2 border border-emerald-500/30 text-xs text-emerald-300 uppercase tracking-[0.35em] font-semibold">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span> {t("reportIncident")}
                  </div>
                  <h2 className="font-display text-3xl text-parchment">{t("submitFloodReport")}</h2>
                  <p className="text-lg text-muted max-w-2xl">{t("submitFloodReportDesc")}</p>
                </div>

                {isCitizen ? (
                  <form noValidate onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("locationAndType")}</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("location")} 
                          </span>
                          <input
                            value={formState.location}
                            
                            onChange={(e) => handleFormChange("location", e.target.value)}
                            placeholder={t("cityRegionNeighbourhood")}
                            className={`field-input mt-2 rounded-2xl transition-colors ${
                              formFieldErrors.location ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                            }`}
                            required
                          />
                          {formFieldErrors.location && (
                            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                              <span>⚠️</span> {formFieldErrors.location}
                            </p>
                          )}
                          <button type="button" onClick={fillCurrentLocation} className="text-xs text-teal-300 border border-teal-500/30 rounded-lg px-3 py-2 mt-2">{t("useMyLocation")}</button>
                          {locationStatus && <span className="block text-xs text-muted mt-1">{locationStatus}</span>}
                        </label>
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("incidentType")} 
                          </span>
                          <select value={formState.type} onChange={(e) => handleFormChange("type", e.target.value)} className="field-input mt-2 rounded-2xl">
                            {INCIDENT_TYPES.map((type) => <option key={type} value={type}>{t(INCIDENT_TYPE_KEY_MAP[type])}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("details")}</p>
                      <label className="block">
                        <span className="text-sm text-muted font-medium">
                          {t("description")} 
                        </span>
                        <textarea
                          value={formState.description}
                          onChange={(e) => handleFormChange("description", e.target.value)}
                          placeholder={lang === "ur" ? "کم از کم 10 حروف درج کریں۔" : "Minimum 10 characters. Start with a capital letter."} minLength={10}
                          rows={5}
                          className={`field-input mt-2 rounded-2xl transition-colors ${
                            formFieldErrors.description ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                          }`}
                          required
                        />
                        {formFieldErrors.description && (
                          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                            <span>⚠️</span> {formFieldErrors.description}
                          </p>
                        )}
                      </label>
                    </div>

                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("assessmentContact")}</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("severityLevel")} 
                          </span>
                          <select
                            value={formState.severity}
                            onChange={(e) => handleFormChange("severity", e.target.value)}
                            className={`field-input mt-2 rounded-2xl transition-colors ${
                              formFieldErrors.severity ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                            }`}
                            required
                          >
                            <option value="" disabled>{lang === 'ur' ? 'شدت منتخب کریں' : 'Select severity'}</option>
                            {SEVERITY_OPTIONS.map((item) => <option key={item} value={item}>{t(SEVERITY_KEY_MAP[item])}</option>)}
                          </select>
                          {formFieldErrors.severity && (
                            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                              <span>⚠️</span> {formFieldErrors.severity}
                            </p>
                          )}
                        </label>
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("contactInfo")} 
                          </span>
                          <input
                            value={formState.contact}
                            onChange={(e) => handleFormChange("contact", e.target.value)}
                            placeholder="03001234567" inputMode="numeric" maxLength={11}
                            className={`field-input mt-2 rounded-2xl transition-colors ${
                              formFieldErrors.contact ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                            }`}
                            required
                          />
                          {formFieldErrors.contact && (
                            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                              <span>⚠️</span> {formFieldErrors.contact}
                            </p>
                          )}
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("visualEvidence")} <span className="text-xs font-normal lowercase tracking-normal text-red-400">*{lang === "ur" ? " (ضروری)" : " required"}</span></p>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                        onDrop={handleDrop}
                        className={`rounded-2xl border-2 transition-all duration-200 p-8 text-center ${
                          formFieldErrors.image
                            ? "border-red-500 bg-red-950/20 ring-1 ring-red-500"
                            : dragActive
                            ? "border-teal-500 bg-teal-500/10"
                            : "border-dashed border-white/10 bg-ink/60"
                        }`}
                      >
                        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 text-muted">
                          <span className="text-4xl">📷</span>
                          <div><span className="font-semibold text-white">{t("dragDropImage")}</span><p className="text-sm text-slate-500">{t("orClickToBrowse")} · JPG, PNG, WebP, GIF · Maximum 50 MB · ({lang === "ur" ? "ضروری" : "Required"})</p></div>
                          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0])} />
                        </label>
                      </div>
                      {formFieldErrors.image && (
                        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                          <span>⚠️</span> {formFieldErrors.image}
                        </p>
                      )}
                      {formState.imagePreview && (
                        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-ink-soft/90">
                          <img src={formState.imagePreview} alt="Preview" className="w-full object-cover max-h-64" />
                          <button type="button" onClick={() => setFormState((prev) => ({ ...prev, imageFile: null, imagePreview: "" }))} className="absolute top-3 right-3 rounded-lg bg-ink/90 px-3 py-2 text-xs font-semibold text-muted hover:text-white transition">{t("removeLabel")}</button>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className={`btn-primary w-full py-4 text-base lg:col-span-2 ${
                        submitting ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    >
                      {submitting ? (lang === 'ur' ? 'جمع کر رہے ہیں...' : 'Submitting...') : t("submitIncidentReport")}
                    </button>
                  </form>
                ) : (
                  <div className="rounded-[2rem] bg-ink/80 border border-white/10 p-8 lg:p-10 text-muted">
                    <p className="text-lg font-semibold text-white mb-4">{t("citizenSingular")} {t("loginRequired")}</p>
                    <p className="text-muted mb-6 leading-relaxed">{t("loginRequiredFull")}</p>
                    <Link to="/login" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-marigold-400 to-marigold-500 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl transition">{t("loginToSubmit")}</Link>
                  </div>
                )}
              </div>
            </div>

            {/* REPORTS & TIMELINE */}
            {!isGovernmentOfficial && <div className="flex min-w-0 flex-col gap-6">
              {/* MY REPORTS (citizens only) — lets them browse/switch between their own submitted reports */}
              {isCitizen && (
                <div className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6 lg:p-8 flex-1">
                  <h4 className="font-display text-xl text-parchment mb-1">{t("myReports")}</h4>
                  <p className="text-xs text-muted mb-4">{t("myReportsDesc")}</p>
                  {reportsError && reports.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-sm text-red-400 mb-2">{reportsError}</p>
                      <button type="button" onClick={fetchReports} className="px-4 py-1.5 rounded-lg border border-teal-500/40 text-teal-300 text-xs hover:bg-teal-500/10 transition">{lang === 'ur' ? 'دوبارہ کوشش کریں' : 'Retry'}</button>
                    </div>
                  ) : loadingReports && reports.length === 0 ? (
                    <p className="text-sm text-muted">{t("loadingReports") || "Loading reports..."}</p>
                  ) : visibleReports.length === 0 ? (
                    <p className="text-sm text-muted">{t("noReportsSubmitted")}</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 items-start">
                      {visibleReports.map((r) => (
                        <div
                          key={r.id}
                          className={`w-full text-left rounded-xl px-4 py-3 border transition-colors ${
                            activeReportId === r.id ? "border-teal-500/50 bg-teal-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{r.trackingId} · {r.location}</p>
                              <p className="text-xs text-muted mt-0.5">{t("submittedOn")} {formatTimeStamp(r.createdAt)}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles(r.status)}`}>{t(STATUS_KEY_MAP[r.status] || r.status)}</span>
                              <button type="button" onClick={() => { setActiveReportId(r.id); setTrackingOpen(true); }} aria-label={`Track report ${r.trackingId}`} className="rounded-full px-3 py-1 text-xs font-semibold text-teal-300 border border-teal-500/40 hover:bg-teal-500/10">{t('trackBtn')}</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}



            </div>}
          </section>
        </div>
      </div>

      {/* TOAST */}
      {trackingOpen && currentReport && isCitizen && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setTrackingOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Report tracking" className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[2rem] bg-ink border border-white/10">
            <button autoFocus type="button" aria-label="Close report tracking" onClick={() => setTrackingOpen(false)} className="absolute top-4 right-5 z-10 text-sm text-parchment px-3 py-2 rounded-lg bg-ink-soft">{t('close')}</button>

              <div className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6 lg:p-8 shadow-xl flex-1">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/15 px-4 py-2 border border-teal-500/30 text-xs text-teal-300 uppercase tracking-[0.35em] font-semibold">
                      <span className="inline-block w-2 h-2 rounded-full bg-teal-400"></span> {t("realTimeTracking")}
                    </div>
                    <h3 className="font-display text-3xl text-parchment">{t("reportTimelineTitle")}</h3>
                  </div>

                  {currentReport ? (
                    <>
                      <div className="rounded-2xl bg-ink/80 border border-white/10 p-5 shadow-lg">
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <div><p className="text-xs text-muted uppercase tracking-[0.2em]">{t("trackingIdLabel")}</p><p className="text-xl font-bold text-white mt-1">{currentReport.trackingId}</p></div>
                          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${statusStyles(currentReport.status)}`}>{t(STATUS_KEY_MAP[currentReport.status] || currentReport.status)}</span>
                        </div>
                        <p className="text-sm text-muted">{currentReport.location} · {currentReport.type}</p>
                        {currentReport.notes && <p className="text-sm text-parchment mt-3 whitespace-pre-wrap">{currentReport.notes}</p>}
                        {getReportImageSource(currentReport.imageUrl) && (
                          <img src={getReportImageSource(currentReport.imageUrl)} alt={t("visualEvidence")} className="mt-4 max-h-64 w-full rounded-xl border border-white/10 object-cover" />
                        )}
                        {currentReport.linked_rescue_op_id && (
                          <p className="text-xs text-teal-300 mt-2">✓ {t("rescueOpCreatedMsg")} #{currentReport.linked_rescue_op_id}</p>
                        )}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
                          <p className="text-xs text-muted">
                            {(currentReport.confirmedBy || []).length} {(currentReport.confirmedBy || []).length === 1 ? t("personConfirmed") : t("peopleConfirmed")}
                          </p>
                          <button
                            onClick={() => handleConfirmReport(currentReport.id)}
                            disabled={(currentReport.confirmedBy || []).includes(userEmail)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-teal-500/30 text-teal-300 hover:bg-teal-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {(currentReport.confirmedBy || []).includes(userEmail) ? `✓ ${t("confirmed")}` : t("iSeeThisToo")}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {STATUS_FLOW.map((step, index) => {
                          const active = STATUS_FLOW.indexOf(currentReport.status) >= index;
                          const isCompleted = STATUS_FLOW.indexOf(currentReport.status) > index;
                          return (
                            <div key={step} className="flex gap-4">
                              <div className="flex flex-col items-center">
                                <div className={`h-4 w-4 rounded-full border-2 ${isCompleted ? "bg-emerald-400 border-emerald-400" : active ? "bg-teal-500 border-teal-500" : "bg-ink-soft border-white/10"} ring-4 ${isCompleted ? "ring-emerald-400/20" : active ? "ring-teal-500/20" : "ring-white/10"}`}></div>
                                {index < STATUS_FLOW.length - 1 && <div className={`w-0.5 h-12 mt-2 ${isCompleted ? "bg-emerald-400/40" : active ? "bg-teal-500/30" : "bg-white/10"}`}></div>}
                              </div>
                              <div className="pt-1.5">
                                <p className={`text-sm font-bold ${isCompleted || active ? "text-white" : "text-slate-500"}`}>{t(STATUS_KEY_MAP[step] || step)}</p>
                                <p className="text-xs text-slate-500 mt-1">{index === 0 ? t("stepSubmittedDesc") : index === 1 ? t("stepActionDesc") : t("stepResolvedDesc")}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl bg-ink/80 border border-white/10 p-8 text-center text-muted">
                      <p className="text-sm">{t("submitReportToTrack")}</p>
                    </div>
                  )}
                </div>
              </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed right-6 top-28 z-50 w-full max-w-sm rounded-3xl border border-white/10 bg-ink/95 p-5 shadow-2xl shadow-black/40">
          <div className="flex items-start gap-4">
            <div className={`mt-1 h-3 w-3 rounded-full ${toast.type === "success" ? "bg-emerald-400" : "bg-amber-400"}`}></div>
            <div>
              <p className="text-sm font-semibold text-white">{toast.message}</p>
              {toast.trackingId && <p className="text-xs text-muted mt-1">{t("trackingIdLabel")}: {toast.trackingId}</p>}
              <p className="text-xs text-slate-500 mt-1">{toast.time}</p>
            </div>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
