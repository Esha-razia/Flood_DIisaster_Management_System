import { lookupLocation, getCurrentPosition, locationErrorMessage } from "../utils/mapLocation";
import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
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
const STATUS_FLOW = ["Submitted", "Under Review", "Action Taken", "Resolved"];
const STATUS_KEY_MAP = { "Submitted": "submitted", "Under Review": "underReview", "Action Taken": "actionTaken", "Resolved": "resolved" };


function formatTimeStamp(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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

export default function Community() {
  const { t } = useLanguage();
  const [reports, setReports] = useState([]);
  const [locationStatus, setLocationStatus] = useState("");
  const locationEdited = useRef(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [formState, setFormState] = useState({ location: "", type: "Flooding", description: "", severity: "High", contact: "", imageFile: null, imagePreview: "" });
  const [formFieldErrors, setFormFieldErrors] = useState({});
  const [activeReportId, setActiveReportId] = useState(() => Number(new URLSearchParams(window.location.search).get('report')) || null);
  const [toast, setToast] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [filters, setFilters] = useState({ severity: "All", status: "All", region: "All" });
  const [rescueWorkers, setRescueWorkers] = useState([]);
  const [assigningReportId, setAssigningReportId] = useState(null);
  const [assignWorkerChoice, setAssignWorkerChoice] = useState("");

  const userRole = localStorage.getItem("userRole");
  const userName = localStorage.getItem("userName");
  const userEmail = localStorage.getItem("userEmail");
  const isCitizen = userRole === "citizen";
  const isReviewer = ["government_official", "admin", "rescue_worker"].includes(userRole);
  const isLoggedIn = Boolean(userRole && userName && userEmail);

  const fetchReports = async () => {
    try {
      const res = await axios.get(`${API_BASE}/community-reports`, {
        params: isCitizen && userEmail ? { email: userEmail } : {},
      });
      const data = res.data || [];
      setReports(data);
      setActiveReportId((prev) => prev ?? data[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load community reports:", err);
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => {
    fetchReports();
    const interval = setInterval(fetchReports, 3000); // keep the review queue live
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!isReviewer) return;
    axios.get(`${API_BASE}/users`).then((res) => {
      setRescueWorkers((res.data || []).filter((u) => u.role === "rescue_worker"));
    }).catch(() => {});
  }, [isReviewer]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);

  useEffect(() => {
    let active = true;
    setLocationStatus('Finding your current location...');
    getCurrentPosition().then(async position => {
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      const location = await lookupLocation(latitude, longitude);
      if (active && !locationEdited.current) {
        setFormState(current => ({ ...current, location, latitude, longitude }));
        setLocationStatus(location.includes('(address unavailable)') ? 'Address lookup unavailable. Your coordinates are filled; you can enter the address manually.' : '');
      }
    }).catch(error => {
      if (active) setLocationStatus(locationErrorMessage(error));
    });
    return () => { active = false; };
  }, []);

  const filteredReports = useMemo(() => reports.filter((r) => (filters.severity === "All" || r.severity === filters.severity) && (filters.status === "All" || r.status === filters.status) && (filters.region === "All" || r.region === filters.region)), [filters, reports]);
  const visibleReports = useMemo(() => isCitizen ? reports.filter(r => (r.authorEmail || '').toLowerCase() === (userEmail || '').toLowerCase()) : filteredReports, [isCitizen, reports, userEmail, filteredReports]);
  const currentReport = useMemo(() => {
    const pool = isCitizen ? visibleReports : reports;
    return pool.find((r) => r.id === activeReportId) || pool[0] || null;
  }, [activeReportId, reports, isCitizen, visibleReports]);
  const handleFormChange = (field, value) => {
    if (field === 'location') { locationEdited.current = true; setLocationStatus(''); }
    if (formFieldErrors[field]) setFormFieldErrors(prev => ({ ...prev, [field]: '' }));
    setFormState(prev => ({ ...prev, [field]:value, ...(field === 'location' ? { latitude:null, longitude:null } : {}) }));
  };
  const handleFileSelect = (file) => {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setToast({ type:'error', message:'Upload a JPG, PNG, WebP or GIF image up to 5 MB.' }); return;
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
    const { location, description, contact, type, severity } = formState;

    const errors = {};
    if (!location.trim()) {
      errors.location = 'Please fill out this field';
    } else if (location.includes('(address unavailable)')) {
      errors.location = 'Address lookup failed. Enter the incident address.';
    } else if (location.trim().length < 3) {
      errors.location = t("locationTooShort");
    }

    if (!description.trim()) {
      errors.description = 'Please fill out this field';
    } else if (description.trim().length < 10) {
      errors.description = t("descriptionTooShort");
    }

    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (!contact.trim()) {
      errors.contact = 'Please fill out this field';
    } else if (!phoneRegex.test(contact.trim().replace(/[\s-]/g, ""))) {
      errors.contact = t("invalidPhoneFormat");
    }

    if (!formState.imagePreview) {
      errors.image = 'Please upload an incident photo';
    }

    if (Object.keys(errors).length > 0) {
      setFormFieldErrors(errors);
      setToast({ type: "error", message: t("fillRequiredFields"), time: new Date().toLocaleTimeString() });
      return;
    }
    setFormFieldErrors({});

    const region = location.includes("Sindh") ? "Sindh" : location.includes("Punjab") ? "Punjab" : location.includes("KPK") ? "KPK" : location.includes("Balochistan") ? "Balochistan" : location.includes("Gilgit") ? "Gilgit-Baltistan" : "Punjab";

    try {
      const res = await axios.post(`${API_BASE}/community-reports`, {
        location, region, type, severity, description, contact,
        latitude: formState.latitude ?? null, longitude: formState.longitude ?? null,
        authorName: userName || "Guest User",
        authorEmail: userEmail || "guest@example.com",
        imageUrl: formState.imagePreview || "",
      });
      const newReport = res.data;
      setReports((prev) => [newReport, ...prev]);
      setActiveReportId(newReport.id);
      setFormState(prev => ({ location:prev.location, latitude:prev.latitude, longitude:prev.longitude, type:"Flooding", description:"", severity:"High", contact:"", imageFile:null, imagePreview:"" }));
      // FR06-03: acknowledgment notification on submission
      setToast({ type: "success", message: t("incidentReportSubmitted"), trackingId: newReport.trackingId, time: formatTimeStamp(newReport.createdAt) });
    } catch (err) {
      console.error("Failed to submit report:", err);
      setToast({ type: "error", message: t("couldNotSubmitReport"), time: new Date().toLocaleTimeString() });
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
                    <p className="text-3xl font-bold text-white mt-2">{reports.filter((r) => r.status !== "Resolved").length}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-soft/90 p-4 border border-white/5">
                    <p className="text-sm text-muted">{t("monitoredRegions")}</p>
                    <p className="text-3xl font-bold text-white mt-2">{new Set(reports.filter((r) => r.status !== "Resolved").map((r) => r.region)).size}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-soft/90 p-4 border border-white/5">
                    <p className="text-sm text-muted">{t("statusLabel")}</p>
                    <p className="text-lg font-semibold text-emerald-400 mt-2 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>{t("live")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>


          {/* MAIN INCIDENT & TRACKING */}
          <section className="grid items-stretch gap-6 lg:grid-cols-2">
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

                {!isLoggedIn && (
                  <div className="rounded-[2rem] bg-amber-500/10 border border-amber-500/30 p-6 lg:p-8">
                    <p className="text-lg font-semibold text-white mb-3">{t("loginRequired")}</p>
                    <p className="text-muted mb-5">{t("loginRequiredDesc")}</p>
                    <Link to="/login" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-marigold-400 to-marigold-500 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl transition">{t("loginOrRegister")}</Link>
                  </div>
                )}

                {isCitizen ? (
                  <form onSubmit={handleSubmit} className="space-y-7" noValidate>
                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("locationAndType")}</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("location")} <span className="text-red-400">*</span>
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
                          {locationStatus && <span className="block text-xs text-muted mt-1">{locationStatus}</span>}
                        </label>
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("incidentType")} <span className="text-red-400">*</span>
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
                          {t("description")} <span className="text-red-400">*</span>
                        </span>
                        <textarea
                          value={formState.description}
                          onChange={(e) => handleFormChange("description", e.target.value)}
                          placeholder="What is happening? Describe water levels, damage, affected areas, and immediate dangers."
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
                            {t("severityLevel")} <span className="text-red-400">*</span>
                          </span>
                          <select value={formState.severity} onChange={(e) => handleFormChange("severity", e.target.value)} className="field-input mt-2 rounded-2xl">
                            {SEVERITY_OPTIONS.map((item) => <option key={item} value={item}>{t(SEVERITY_KEY_MAP[item])}</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-sm text-muted font-medium">
                            {t("contactInfo")} <span className="text-red-400">*</span>
                          </span>
                          <input
                            value={formState.contact}
                            onChange={(e) => handleFormChange("contact", e.target.value)}
                            placeholder="+92 XXX XXX XXXX"
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
                      <p className="text-sm font-semibold text-muted uppercase tracking-[0.3em]">{t("visualEvidence")} <span className="text-red-400">*</span></p>
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
                          <div><span className="font-semibold text-white">{t("dragDropImage")}</span><p className="text-sm text-slate-500">{t("orClickToBrowse")}</p></div>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0])} />
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

                    <button type="submit" className="btn-primary w-full py-4 text-base">{t("submitIncidentReport")}</button>
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
            <div className="flex min-w-0 flex-col gap-6 h-full">
              {/* MY REPORTS (citizens only) — lets them browse/switch between their own submitted reports */}
              {isCitizen && (
                <div className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6">
                  <h4 className="font-display text-xl text-parchment mb-1">{t("myReports")}</h4>
                  <p className="text-xs text-muted mb-4">{t("myReportsDesc")}</p>
                  {visibleReports.length === 0 ? (
                    <p className="text-sm text-muted">{t("noReportsSubmitted")}</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {visibleReports.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setActiveReportId(r.id)}
                          className={`w-full text-left rounded-xl px-4 py-3 border transition-colors ${
                            activeReportId === r.id ? "border-teal-500/50 bg-teal-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{r.trackingId} · {r.location}</p>
                              <p className="text-xs text-muted mt-0.5">{t("submittedOn")} {formatTimeStamp(r.createdAt)}</p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles(r.status)}`}>{t(STATUS_KEY_MAP[r.status] || r.status)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TIMELINE */}
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
                        {currentReport.imageUrl && (
                          <img src={currentReport.imageUrl} alt={t("visualEvidence")} className="mt-4 max-h-64 w-full rounded-xl border border-white/10 object-cover" />
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
                                <p className="text-xs text-slate-500 mt-1">{index === 0 ? t("stepSubmittedDesc") : index === 1 ? t("stepReviewDesc") : index === 2 ? t("stepActionDesc") : t("stepResolvedDesc")}</p>
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
          </section>

          {/* REVIEW PANEL */}
          {isReviewer && (
            <section className="rounded-[2rem] bg-gradient-to-br from-ink-soft/80 to-ink/80 border border-white/10 p-6 lg:p-8 shadow-xl">
              <div className="space-y-8">
                <div className="space-y-4 max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-purple-500/15 px-4 py-2 border border-purple-500/30 text-xs text-purple-300 uppercase tracking-[0.35em] font-semibold">
                    {t("reviewPanel")}
                  </div>
                  <h2 className="font-display text-3xl text-parchment">{t("officialReviewWorkspace")}</h2>
                  <p className="text-lg text-muted">{t("filterReportsDesc")}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <select value={filters.severity} onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))} className="rounded-2xl border border-white/10 bg-ink/90 px-4 py-3 text-white focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20">
                    <option value="All">{t("allSeverity")}</option>
                    <option value="Low">{t("lowSeverity")}</option>
                    <option value="Medium">{t("mediumSeverity")}</option>
                    <option value="High">{t("highSeverity")}</option>
                  </select>
                  <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-2xl border border-white/10 bg-ink/90 px-4 py-3 text-white focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20">
                    <option value="All">{t("allStatus")}</option>
                    {STATUS_FLOW.map((s) => <option key={s} value={s}>{t(STATUS_KEY_MAP[s] || s)}</option>)}
                  </select>
                  <select value={filters.region} onChange={(e) => setFilters((prev) => ({ ...prev, region: e.target.value }))} className="rounded-2xl border border-white/10 bg-ink/90 px-4 py-3 text-white focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20">
                    <option value="All">{t("allRegions")}</option>
                    {["Sindh", "Punjab", "KPK", "Balochistan", "Gilgit-Baltistan"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-auto border-separate border-spacing-0 text-left">
                    <thead className="bg-ink-soft/90 text-muted">
                      <tr>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colTrackingId")}</th>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colLocation")}</th>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colSeverity")}</th>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colStatus")}</th>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colSubmittedBy")}</th>
                        <th className="px-5 py-4 text-sm font-semibold">{t("colAction")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredReports.map((report) => (
                        <tr key={report.id} className="group hover:bg-ink-soft/70 transition-colors">
                          <td className="px-5 py-4 text-sm text-white">{report.trackingId}</td>
                          <td className="px-5 py-4 text-sm text-muted">{report.location}</td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${severityStyles(report.severity)}`}>{t(SEVERITY_KEY_MAP[report.severity] || report.severity)}</span>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusStyles(report.status)}`}>{t(STATUS_KEY_MAP[report.status] || report.status)}</span>
                            {report.linked_rescue_op_id && (
                              <p className="text-[10px] text-teal-300 mt-1">{t("rescueOpCreatedMsg")} #{report.linked_rescue_op_id}</p>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm text-muted">{report.authorName}</td>
                          <td className="px-5 py-4 space-y-2">
                            <button onClick={() => handleReviewAction(report.id, "Under Review")} className="w-full rounded-2xl bg-ink-soft/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink-soft">{t("reviewAction")}</button>
                            <button
                              onClick={() => toggleAssignPanel(report.id)}
                              disabled={report.status === "Action Taken" || report.status === "Resolved"}
                              className="w-full rounded-2xl bg-teal-500/15 px-3 py-2 text-xs font-semibold text-teal-300 transition hover:bg-teal-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {assigningReportId === report.id ? t("cancel") : t("actionAction")}
                            </button>
                            <button onClick={() => handleReviewAction(report.id, "Resolved")} className="w-full rounded-2xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25">{t("resolveAction")}</button>

                            {assigningReportId === report.id && (
                              <div className="mt-2 space-y-2 rounded-2xl border border-white/10 bg-ink/90 p-3">
                                {rescueWorkers.length === 0 ? (
                                  <p className="text-[11px] text-muted">{t("noRescueWorkersYet")}</p>
                                ) : (
                                  <select
                                    value={assignWorkerChoice}
                                    onChange={(e) => setAssignWorkerChoice(e.target.value)}
                                    className="field-input rounded-xl text-xs py-2"
                                  >
                                    <option value="">{t("selectRescueWorker")}</option>
                                    {rescueWorkers.map((w) => (
                                      <option key={w.id} value={w.name}>{w.name} ({w.email})</option>
                                    ))}
                                  </select>
                                )}
                                <button
                                  onClick={() => confirmAssignWorker(report.id)}
                                  className="btn-primary w-full text-xs py-2"
                                >
                                  {t("confirmAssignment")}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* TOAST */}
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
