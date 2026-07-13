import { useState, useEffect } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import FloodMap from "../components/FloodMap";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

const OP_STATUS_KEY_MAP = { "Assigned": "statusAssigned", "In Progress": "statusInProgress", "Completed": "statusCompleted" };
const RISK_KEY_MAP = { "Low": "lowSeverity", "Medium": "mediumSeverity", "High": "highSeverity" };

export default function RescueDashboard() {
  const { t, lang } = useLanguage();
  const [alerts, setAlerts] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [emergencyStatus, setEmergencyStatus] = useState("normal");
  const [actionFeedback, setActionFeedback] = useState("");

  const [operations, setOperations] = useState([]);
  const [opForm, setOpForm] = useState({ location: "", description: "", risk_level: "High", assigned_team: "" });
  const [rescueWorkers, setRescueWorkers] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [stats, setStats] = useState(null);

  const fetchRescueWorkers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users`);
      setRescueWorkers((res.data || []).filter((u) => u.role === "rescue_worker" && u.status === "Active"));
    } catch (err) {
      console.error("Failed to load rescue workers:", err);
    }
  };

  const fetchVolunteers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/volunteers`);
      setVolunteers(res.data || []);
    } catch (err) {
      console.error("Failed to load volunteers:", err);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations/stats`);
      setStats(res.data);
    } catch (err) {
      console.error("Failed to load rescue stats:", err);
    }
  };

  const [nearbyFacilities, setNearbyFacilities] = useState({}); // opId -> {shelter, hospital}

  const fetchNearbyForOp = async (op) => {
    try {
      const res = await axios.get(`${API_BASE}/nearest-facilities`, { params: { location: op.location } });
      setNearbyFacilities((prev) => ({ ...prev, [op.id]: res.data }));
    } catch (err) {
      console.error("Failed to load nearby facilities:", err);
    }
  };

  const handleAssignVolunteer = async (opId, volunteerName) => {
    try {
      // Operations don't have a dedicated volunteer field on the backend yet,
      // so this is tracked by folding it into the assigned_team text — keeps
      // the existing data model simple while still being genuinely useful.
      const op = operations.find((o) => o.id === opId);
      const newTeam = op?.assigned_team && op.assigned_team !== "Unassigned"
        ? `${op.assigned_team} + ${volunteerName}`
        : volunteerName;
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: op.status, assigned_team: newTeam });
      fetchOperations();
    } catch (err) {
      console.error("Failed to assign volunteer:", err);
    }
  };

  const formatDuration = (start, end) => {
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return `${hours}h ${rem}m`;
  };
  const [showOpForm, setShowOpForm] = useState(false);

  useEffect(() => {
    fetchAlerts();
    fetchPredictions();
    fetchOperations();
    fetchRescueWorkers();
    fetchVolunteers();
    fetchStats();
    const interval = setInterval(() => {
      fetchAlerts();
      fetchPredictions();
      fetchOperations();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchOperations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations`);
      setOperations(res.data || []);
      (res.data || []).forEach((op) => fetchNearbyForOp(op));
    } catch (err) {
      console.error("Error fetching rescue operations:", err);
    }
  };

  const handleCreateOperation = async (e) => {
    e.preventDefault();
    if (!opForm.location.trim()) return;
    try {
      await axios.post(`${API_BASE}/rescue-operations`, opForm);
      setOpForm({ location: "", description: "", risk_level: "High", assigned_team: "" });
      setShowOpForm(false);
      setActionFeedback("Rescue operation created and team notified.");
      fetchOperations();
    } catch (err) {
      console.error("Failed to create rescue operation:", err);
      setActionFeedback("Could not create rescue operation.");
    }
  };

  const [completionModal, setCompletionModal] = useState(null); // { opId } | null
  const [completionForm, setCompletionForm] = useState({ people_rescued: "", resources_used: "", completion_notes: "" });

  const handleUpdateOpStatus = async (opId, status) => {
    if (status === "Completed") {
      setCompletionForm({ people_rescued: "", resources_used: "", completion_notes: "" });
      setCompletionModal({ opId });
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status });
      setActionFeedback(`${t("operationMarkedAs")} ${t(OP_STATUS_KEY_MAP[status] || status)}.`);
      fetchOperations();
      fetchStats();
    } catch (err) {
      console.error("Failed to update operation status:", err);
      setActionFeedback(t("couldNotUpdateOp"));
    }
  };

  const handleSubmitCompletion = async (e) => {
    e.preventDefault();
    if (!completionModal) return;
    try {
      await axios.put(`${API_BASE}/rescue-operations/${completionModal.opId}/status`, {
        status: "Completed",
        people_rescued: completionForm.people_rescued ? parseInt(completionForm.people_rescued, 10) || 0 : 0,
        resources_used: completionForm.resources_used,
        completion_notes: completionForm.completion_notes,
      });
      setActionFeedback(`${t("operationMarkedAs")} ${t("statusCompleted")}.`);
      setCompletionModal(null);
      fetchOperations();
      fetchStats();
    } catch (err) {
      console.error("Failed to complete operation:", err);
      setActionFeedback(t("couldNotUpdateOp"));
    }
  };

  const opStatusStyles = (status) => {
    if (status === "Completed") return "bg-emerald-500/20 border-emerald-500/50 text-emerald-300";
    if (status === "In Progress") return "bg-teal-500/20 border-teal-500/50 text-teal-300";
    return "bg-amber-500/20 border-amber-500/50 text-amber-300"; // Assigned
  };

  const opRiskStyles = (risk) => {
    if (risk === "High") return "border-l-4 border-l-red-500";
    if (risk === "Medium") return "border-l-4 border-l-yellow-500";
    return "border-l-4 border-l-green-500";
  };

  const fetchAlerts = async () => {
    try {
      console.log("Fetching alerts from Rescue Dashboard...");
      const res = await axios.get(`${API_BASE}/alerts`);
      console.log("Alerts response:", res.data);
      setAlerts(res.data || []);
      
      // Update emergency status based on high-risk alerts
      const highRiskAlerts = (res.data || []).filter(alert => alert.risk === "High");
      if (highRiskAlerts.length > 0) {
        setEmergencyStatus("critical");
      } else {
        const mediumRiskAlerts = (res.data || []).filter(alert => alert.risk === "Medium");
        setEmergencyStatus(mediumRiskAlerts.length > 0 ? "elevated" : "normal");
      }
    } catch (err) {
      console.error("Error fetching alerts:", err);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPredictions = async () => {
    try {
      console.log("Fetching predictions from Rescue Dashboard...");
      const res = await axios.get(`${API_BASE}/predictions`);
      console.log("Predictions response:", res.data);
      setPredictions(res.data || []);
    } catch (err) {
      console.error("Error fetching predictions:", err);
      setPredictions([]);
    }
  };

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  const getRiskColor = (risk) => {
    switch (risk?.toLowerCase()) {
      case "low": return "text-green-400";
      case "medium": return "text-yellow-400";
      case "high": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const getRiskBgColor = (risk) => {
    switch (risk?.toLowerCase()) {
      case "low": return "bg-green-500/20 border-green-500/50";
      case "medium": return "bg-yellow-500/20 border-yellow-500/50";
      case "high": return "bg-red-500/20 border-red-500/50";
      default: return "bg-gray-500/20 border-gray-500/50";
    }
  };

  const getEmergencyStatusColor = () => {
    switch (emergencyStatus) {
      case "critical": return "bg-red-500/20 border-red-500/50 text-red-400";
      case "elevated": return "bg-yellow-500/20 border-yellow-500/50 text-yellow-400";
      default: return "bg-green-500/20 border-green-500/50 text-green-400";
    }
  };

  const getEmergencyStatusText = () => {
    switch (emergencyStatus) {
      case "critical": return t("criticalMultiple");
      case "elevated": return t("elevatedDetected");
      default: return t("normalNoThreats");
    }
  };

  const highRiskPredictions = predictions.filter(pred => pred.risk === "High").slice(0, 10);
  const mediumRiskPredictions = predictions.filter(pred => pred.risk === "Medium").slice(0, 10);
  const highRiskAlerts = alerts.filter(alert => alert.risk === "High").slice(0, 10);

  const exportRescueReport = () => {
    const rows = [
      ['Type', 'Location', 'Risk', 'Confidence', 'Timestamp']
    ];

    highRiskPredictions.forEach(pred => {
      rows.push(['Prediction', pred.location || 'Unknown', pred.risk, `${(pred.confidence*100).toFixed(1)}%`, new Date(pred.created_at).toLocaleString()]);
    });

    highRiskAlerts.forEach(alert => {
      rows.push(['Alert', alert.location || 'Unknown', alert.risk, '-', new Date(alert.created_at).toLocaleString()]);
    });

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rescue_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    setActionFeedback('Rescue report downloaded successfully.');
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-ink via-ink-soft to-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          {/* Header */}
          <div className="mb-10">
            <p className="eyebrow text-teal-400 mb-3">{t("rescueCoordination")}</p>
            <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">{t("operationsCenter")}</h1>
            <p className="text-muted max-w-lg">{t("operationsCenterDesc")}</p>
          </div>

          {/* Emergency Status Panel */}
          <div className={`dashboard-card p-6 ${getEmergencyStatusColor()}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl mb-2">{t("emergencyStatus")}</h2>
                <p className="text-lg">{getEmergencyStatusText()}</p>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl">{highRiskAlerts.length}</div>
                <div className="eyebrow opacity-80">{t('highRiskAreas')}</div>
              </div>
            </div>
          </div>

          {/* Export */}
          <div className="mb-8 flex items-center justify-end gap-4">
            {actionFeedback && (
              <span className="text-sm text-emerald-400 font-medium">{actionFeedback}</span>
            )}
            <button onClick={exportRescueReport} className="btn-secondary">
              {t("exportCsv")}
            </button>
          </div>


          {/* High Risk Alerts */}
          {highRiskAlerts.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display text-2xl text-red-400 mb-4">{t("criticalAlertsHeading")}</h2>
              <div className="grid gap-4">
                {highRiskAlerts.map((alert, index) => (
                  <div key={index} className="dashboard-card border-red-500/50 p-6">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-display text-xl text-red-400 mb-2">{alert.message}</h3>
                        <p className="text-muted mb-2">{alert.location}</p>
                        <p className="text-sm text-muted">
                          {new Date(alert.created_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button 
                          onClick={() => setSelectedAlert(alert)}
                          className="btn-secondary text-sm py-2"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Affected Areas */}
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            {/* High Risk Areas */}
            <div className="dashboard-card p-6">
              <h2 className="font-display text-xl text-red-400 mb-4">{t("highRiskAreas")}</h2>
              {highRiskPredictions.length > 0 ? (
                <div className="space-y-3">
                  {highRiskPredictions.map((pred, index) => (
                    <div key={index} className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <h4 className="font-semibold text-red-400">{pred.location}</h4>
                          <p className="text-sm text-muted">
                            Confidence: {(pred.confidence * 100).toFixed(1)}%
                          </p>
                        </div>
                        <span className="bg-red-500/30 text-red-300 px-3 py-1 rounded-full text-sm font-semibold">
                          HIGH
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">{t('noHighRiskAreas')}</p>
              )}
            </div>

            {/* Medium Risk Areas */}
            <div className="dashboard-card p-6">
              <h2 className="text-xl font-bold text-yellow-400 mb-4">{t("mediumRiskAreas")}</h2>
              {mediumRiskPredictions.length > 0 ? (
                <div className="space-y-3">
                  {mediumRiskPredictions.map((pred, index) => (
                    <div key={index} className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <h4 className="font-semibold text-yellow-400">{pred.location}</h4>
                          <p className="text-sm text-muted">
                            Confidence: {(pred.confidence * 100).toFixed(1)}%
                          </p>
                        </div>
                        <span className="bg-yellow-500/30 text-yellow-300 px-3 py-1 rounded-full text-sm font-semibold">
                          MEDIUM
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">{t('noMediumRiskAreas')}</p>
              )}
            </div>
          </div>

          {/* Rescue Operations (FR-05) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-display text-2xl text-parchment">{t("rescueOperations")}</h2>
                <p className="text-sm text-muted">{t("rescueOpsSubtitle")}</p>
              </div>
              <button
                onClick={() => setShowOpForm((v) => !v)}
                className="btn-secondary text-sm py-2.5"
              >
                {showOpForm ? t("cancel") : t("newOperation")}
              </button>
            </div>

            {showOpForm && (
              <form onSubmit={handleCreateOperation} className="grid gap-4 md:grid-cols-2 bg-ink-soft/60 rounded-xl p-5 mb-6 border border-white/10">
                <label className="block">
                  <span className="text-sm text-muted">{t("location2")} *</span>
                  <input value={opForm.location} onChange={(e) => setOpForm((p) => ({ ...p, location: e.target.value }))} required
                    className="field-input mt-1 py-2.5" placeholder={t("egSukkur")} />
                </label>
                <label className="block">
                  <span className="text-sm text-muted">{t("riskLevel2")}</span>
                  <select value={opForm.risk_level} onChange={(e) => setOpForm((p) => ({ ...p, risk_level: e.target.value }))}
                    className="field-input mt-1 py-2.5">
                    <option value="High">{t("highSeverity")}</option><option value="Medium">{t("mediumSeverity")}</option><option value="Low">{t("lowSeverity")}</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm text-muted">{t("description")}</span>
                  <input value={opForm.description} onChange={(e) => setOpForm((p) => ({ ...p, description: e.target.value }))}
                    className="field-input mt-1 py-2.5" placeholder={t("whatNeedsToHappen")} />
                </label>
                <label className="block">
                  <span className="text-sm text-muted">{t("assignWorker")}</span>
                  <select value={opForm.assigned_team} onChange={(e) => setOpForm((p) => ({ ...p, assigned_team: e.target.value }))}
                    className="field-input mt-1 py-2.5">
                    <option value="">{t("unassigned")}</option>
                    {rescueWorkers.map((w) => (
                      <option key={w.id} value={w.name}>{w.name} ({w.email})</option>
                    ))}
                  </select>
                  {rescueWorkers.length === 0 && (
                    <p className="text-xs text-muted mt-1">No registered rescue workers yet — they show up here once they register with the "Rescue Worker" role.</p>
                  )}
                </label>
                <div className="md:col-span-2 flex justify-end">
                  <button type="submit" className="btn-primary">
                    {t("createNotify")}
                  </button>
                </div>
              </form>
            )}

            {operations.length === 0 ? (
              <p className="text-muted text-center py-6">{t('noOperationsFound')}</p>
            ) : (
              <div className="space-y-3">
                {operations.map((op) => (
                  <div key={op.id} className={`bg-ink-soft/60 rounded-lg p-4 ${opRiskStyles(op.risk_level)}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-white">{op.location}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${opStatusStyles(op.status)}`}>{t(OP_STATUS_KEY_MAP[op.status] || op.status)}</span>
                          <span className="text-xs text-muted">{t(RISK_KEY_MAP[op.risk_level] || op.risk_level)} {t("riskLabel").toLowerCase()}</span>
                        </div>
                        {op.description && <p className="text-sm text-muted mb-1">{op.description}</p>}
                        <p className="text-xs text-slate-500">{t("teamLabel")}: {op.assigned_team || t("unassigned")} · {t("updatedLabel")} {new Date(op.updated_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}</p>

                        {op.status === "Completed" && op.completed_at && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-emerald-400">
                              {t("completedIn")} {formatDuration(new Date(op.created_at), new Date(op.completed_at))}
                            </p>
                            {(op.people_rescued > 0 || op.resources_used || op.completion_notes) && (
                              <div className="text-xs text-muted bg-white/[0.03] rounded-lg p-2 mt-1 space-y-0.5">
                                {op.people_rescued > 0 && <p>👥 {t("peopleRescuedLabel")}: <span className="text-white">{op.people_rescued}</span></p>}
                                {op.resources_used && <p>🧰 {t("resourcesUsedLabel")}: {op.resources_used}</p>}
                                {op.completion_notes && <p>📝 {op.completion_notes}</p>}
                              </div>
                            )}
                          </div>
                        )}

                        {nearbyFacilities[op.id] && (nearbyFacilities[op.id].shelter || nearbyFacilities[op.id].hospital) && (
                          <div className="flex flex-wrap gap-3 mt-2 text-xs">
                            {nearbyFacilities[op.id].shelter && (
                              <span className="text-teal-300">🏠 {t("nearestShelter")}: {lang === "ur" && nearbyFacilities[op.id].shelter.name_ur ? nearbyFacilities[op.id].shelter.name_ur : nearbyFacilities[op.id].shelter.name}</span>
                            )}
                            {nearbyFacilities[op.id].hospital && (
                              <span className="text-marigold-300">🏥 {t("nearestHospital")}: {lang === "ur" && nearbyFacilities[op.id].hospital.name_ur ? nearbyFacilities[op.id].hospital.name_ur : nearbyFacilities[op.id].hospital.name}</span>
                            )}
                          </div>
                        )}

                        {op.status !== "Completed" && volunteers.length > 0 && (
                          <select
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) { handleAssignVolunteer(op.id, e.target.value); e.target.value = ""; } }}
                            className="mt-2 text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-muted"
                          >
                            <option value="">{t("assignVolunteerLabel")}</option>
                            {volunteers.map((v) => <option key={v.id} value={v.name}>{v.name} ({v.city})</option>)}
                          </select>
                        )}
                      </div>
                      {op.status !== "Completed" && (
                        <div className="flex gap-2 shrink-0">
                          {op.status === "Assigned" && (
                            <button onClick={() => handleUpdateOpStatus(op.id, "In Progress")}
                              className="bg-teal-600/80 hover:bg-teal-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">{t("start")}</button>
                          )}
                          <button onClick={() => handleUpdateOpStatus(op.id, "Completed")}
                            className="bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">{t("markComplete")}</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rescue Stats */}
          {stats && (
            <div className="dashboard-card p-6 mb-8">
              <p className="eyebrow text-marigold-400 mb-2">{t("rescueStatsLabel")}</p>
              <h2 className="font-display text-2xl text-parchment mb-4">{t("operationsOverviewLabel")}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="stat-tile text-center">
                  <div className="font-display text-2xl text-parchment">{stats.total_operations}</div>
                  <div className="eyebrow text-muted">{t("totalOperationsLabel")}</div>
                </div>
                <div className="stat-tile text-center">
                  <div className="font-display text-2xl text-emerald-400">{stats.completed_operations}</div>
                  <div className="eyebrow text-muted">{t("completedLabel")}</div>
                </div>
                <div className="stat-tile text-center">
                  <div className="font-display text-2xl text-teal-400">{stats.total_people_rescued}</div>
                  <div className="eyebrow text-muted">{t("peopleRescuedLabel")}</div>
                </div>
                <div className="stat-tile text-center">
                  <div className="font-display text-2xl text-marigold-400">{stats.avg_completion_minutes ?? "—"}</div>
                  <div className="eyebrow text-muted">{t("avgMinutesLabel")}</div>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Map (FR-04) */}
          <div className="mb-8">
            <p className="eyebrow text-teal-400 mb-3">{t("liveMap")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">{t("activeOpsBlockedRoads")}</h2>
            <FloodMap height={460} canEdit={true} />
          </div>

          {/* Completion Report Modal (replaces window.prompt for a proper, on-brand UI) */}
          {completionModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <form onSubmit={handleSubmitCompletion} className="dashboard-card p-8 max-w-lg w-full">
                <p className="eyebrow text-emerald-400 mb-2">{t("markComplete")}</p>
                <h2 className="font-display text-2xl text-parchment mb-1">{t("completionReportTitle")}</h2>
                <p className="text-sm text-muted mb-6">{t("completionReportDesc")}</p>

                <div className="space-y-4">
                  <div>
                    <label className="field-label">{t("peopleRescuedLabel")}</label>
                    <input
                      type="number" min="0" placeholder="0"
                      value={completionForm.people_rescued}
                      onChange={(e) => setCompletionForm((p) => ({ ...p, people_rescued: e.target.value }))}
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label">{t("resourcesUsedLabel")}</label>
                    <input
                      type="text" placeholder={t("resourcesUsedPlaceholder")}
                      value={completionForm.resources_used}
                      onChange={(e) => setCompletionForm((p) => ({ ...p, resources_used: e.target.value }))}
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label">{t("completionNotesLabel")}</label>
                    <textarea
                      rows={3} placeholder={t("completionNotesPlaceholder")}
                      value={completionForm.completion_notes}
                      onChange={(e) => setCompletionForm((p) => ({ ...p, completion_notes: e.target.value }))}
                      className="field-input resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button type="submit" className="btn-primary flex-1">{t("submitAndComplete")}</button>
                  <button type="button" onClick={() => setCompletionModal(null)} className="btn-secondary">{t("close")}</button>
                </div>
              </form>
            </div>
          )}

          {/* Alert Details Modal */}
          {selectedAlert && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-ink-soft rounded-2xl p-8 max-w-2xl w-full">
                <h2 className="font-display text-2xl text-parchment mb-4">{t("alertDetails")}</h2>
                <div className={`p-4 rounded-lg mb-4 ${getRiskBgColor(selectedAlert.risk)}`}>
                  <h3 className={`text-xl font-bold ${getRiskColor(selectedAlert.risk)} mb-2`}>
                    {selectedAlert.message}
                  </h3>
                  <p className="text-muted">{selectedAlert.location}</p>
                  <p className="text-sm text-muted mt-2">
                    {new Date(selectedAlert.created_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setSelectedAlert(null)}
                    className="bg-white/10 hover:bg-white/10 text-white px-6 py-2 rounded-lg transition-colors"
                  >
                    {t("close")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
