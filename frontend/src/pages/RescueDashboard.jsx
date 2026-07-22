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
  // A rescue almost never works with one person, so a new operation is built
  // with a roster (team_members: array of worker names) instead of a single
  // assignee — this gets joined into the assigned_team text field on submit.
  const [opForm, setOpForm] = useState({ location: "", description: "", risk_level: "High", team_members: [] });
  const [rescueWorkers, setRescueWorkers] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [stats, setStats] = useState(null);

  // Equipment & Resources (FR-05b)
  const [equipment, setEquipment] = useState([]);
  const [equipCategory, setEquipCategory] = useState("all");
  const [allocateForm, setAllocateForm] = useState({ item_id: "", op_id: "", quantity: 1 });
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [newEquipForm, setNewEquipForm] = useState({ name: "", category: "Supplies", unit: "units", total_quantity: "" });

  // Shift handover / continuity notes (FR-05c)
  const [handoverNotes, setHandoverNotes] = useState([]);
  const [handoverForm, setHandoverForm] = useState({ note: "", priority: "normal", location: "" });

  // Per-operation "manage team" popover — lets a coordinator add/remove a
  // responder from an already-created operation's roster.
  const [manageTeamOpId, setManageTeamOpId] = useState(null);
  const [manageTeamPick, setManageTeamPick] = useState("");

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

  const fetchEquipment = async () => {
    try {
      const res = await axios.get(`${API_BASE}/equipment-resources`);
      setEquipment(res.data || []);
    } catch (err) {
      console.error("Failed to load equipment resources:", err);
    }
  };

  const fetchHandoverNotes = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shift-handover`);
      setHandoverNotes(res.data || []);
    } catch (err) {
      console.error("Failed to load shift handover notes:", err);
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
        ? `${op.assigned_team}, ${volunteerName}`
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
    fetchEquipment();
    fetchHandoverNotes();
    const interval = setInterval(() => {
      fetchAlerts();
      fetchPredictions();
      fetchOperations();
      fetchEquipment();
      fetchHandoverNotes();
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

  const toggleOpFormMember = (name) => {
    setOpForm((p) => ({
      ...p,
      team_members: p.team_members.includes(name)
        ? p.team_members.filter((n) => n !== name)
        : [...p.team_members, name],
    }));
  };

  const handleCreateOperation = async (e) => {
    e.preventDefault();
    if (!opForm.location.trim()) return;
    try {
      const assigned_team = opForm.team_members.length > 0 ? opForm.team_members.join(", ") : "Unassigned";
      await axios.post(`${API_BASE}/rescue-operations`, {
        location: opForm.location, description: opForm.description, risk_level: opForm.risk_level, assigned_team,
      });
      setOpForm({ location: "", description: "", risk_level: "High", team_members: [] });
      setShowOpForm(false);
      setActionFeedback("Rescue operation created and team notified.");
      fetchOperations();
    } catch (err) {
      console.error("Failed to create rescue operation:", err);
      setActionFeedback("Could not create rescue operation.");
    }
  };

  // Add or remove a single responder from an operation's roster after it's
  // already been created — the roster lives in assigned_team as a comma
  // separated list, same field the create-form writes to.
  const opTeamMembers = (op) => {
    if (!op.assigned_team || op.assigned_team === "Unassigned") return [];
    return op.assigned_team.split(",").map((n) => n.trim()).filter(Boolean);
  };

  const handleAddTeamMember = async (opId, name) => {
    if (!name) return;
    try {
      const op = operations.find((o) => o.id === opId);
      const current = opTeamMembers(op);
      if (current.includes(name)) return;
      const newTeam = [...current, name].join(", ");
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: op.status, assigned_team: newTeam });
      setManageTeamPick("");
      fetchOperations();
    } catch (err) {
      console.error("Failed to add team member:", err);
    }
  };

  const handleRemoveTeamMember = async (opId, name) => {
    try {
      const op = operations.find((o) => o.id === opId);
      const remaining = opTeamMembers(op).filter((n) => n !== name);
      const newTeam = remaining.length > 0 ? remaining.join(", ") : "Unassigned";
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: op.status, assigned_team: newTeam });
      fetchOperations();
    } catch (err) {
      console.error("Failed to remove team member:", err);
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

  // ---------------- Equipment & Resources ----------------
  const handleAllocateEquipment = async (e) => {
    e.preventDefault();
    const { item_id, op_id, quantity } = allocateForm;
    const qty = parseInt(quantity, 10) || 0;
    if (!item_id || !op_id || qty <= 0) return;
    try {
      await axios.put(`${API_BASE}/equipment-resources/${item_id}/adjust`, { delta: -qty });
      const item = equipment.find((eq) => String(eq.id) === String(item_id));
      const op = operations.find((o) => String(o.id) === String(op_id));
      if (op) {
        const tag = `${qty} ${item?.unit || "units"} ${item?.name || ""}`.trim();
        const newResources = op.resources_used ? `${op.resources_used}, ${tag}` : tag;
        await axios.put(`${API_BASE}/rescue-operations/${op_id}/status`, { status: op.status, resources_used: newResources });
      }
      setActionFeedback(t("equipAllocatedMsg"));
      setAllocateForm({ item_id: "", op_id: "", quantity: 1 });
      fetchEquipment();
      fetchOperations();
    } catch (err) {
      console.error("Failed to allocate equipment:", err);
      setActionFeedback(t("equipNotEnoughMsg"));
    }
  };

  const handleReturnEquipment = async (itemId, quantity = 1) => {
    try {
      await axios.put(`${API_BASE}/equipment-resources/${itemId}/adjust`, { delta: quantity });
      setActionFeedback(t("equipReturnedMsg"));
      fetchEquipment();
    } catch (err) {
      console.error("Failed to return equipment:", err);
    }
  };

  const handleAddEquipment = async (e) => {
    e.preventDefault();
    if (!newEquipForm.name.trim()) return;
    try {
      await axios.post(`${API_BASE}/equipment-resources`, {
        ...newEquipForm,
        total_quantity: parseInt(newEquipForm.total_quantity, 10) || 0,
      });
      setNewEquipForm({ name: "", category: "Supplies", unit: "units", total_quantity: "" });
      setShowAddEquipment(false);
      fetchEquipment();
    } catch (err) {
      console.error("Failed to add equipment:", err);
    }
  };

  const equipmentCategories = ["all", ...Array.from(new Set(equipment.map((e) => e.category).filter(Boolean)))];
  const visibleEquipment = equipCategory === "all" ? equipment : equipment.filter((e) => e.category === equipCategory);

  // ---------------- Shift handover / continuity notes ----------------
  const handlePostHandoverNote = async (e) => {
    e.preventDefault();
    if (!handoverForm.note.trim()) return;
    try {
      const author_name = localStorage.getItem("userName") || "Rescue coordinator";
      await axios.post(`${API_BASE}/shift-handover`, { ...handoverForm, author_name });
      setHandoverForm({ note: "", priority: "normal", location: "" });
      setActionFeedback(t("handoverPostedMsg"));
      fetchHandoverNotes();
    } catch (err) {
      console.error("Failed to post handover note:", err);
    }
  };

  const handleAcknowledgeNote = async (noteId) => {
    try {
      const acknowledged_by = localStorage.getItem("userName") || "Next shift";
      await axios.put(`${API_BASE}/shift-handover/${noteId}/acknowledge`, { acknowledged_by });
      fetchHandoverNotes();
    } catch (err) {
      console.error("Failed to acknowledge handover note:", err);
    }
  };

  const handoverPriorityStyle = (priority) => {
    if (priority === "urgent") return "bg-red-500/20 border-red-500/50 text-red-300";
    if (priority === "watch") return "bg-amber-500/20 border-amber-500/50 text-amber-300";
    return "bg-white/5 border-white/10 text-muted";
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

          {/* Operations Overview — placed above Emergency Status so coordinators
              see the big-picture numbers before the live threat level. */}
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
                <label className="block md:col-span-2">
                  <span className="text-sm text-muted">{t("assignTeamMembers")}</span>
                  <p className="text-xs text-muted mt-0.5 mb-2">{t("teamMembersHelp")}</p>
                  {rescueWorkers.length === 0 ? (
                    <p className="text-xs text-muted">No registered rescue workers yet — they show up here once they register with the "Rescue Worker" role.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {rescueWorkers.map((w) => {
                        const picked = opForm.team_members.includes(w.name);
                        return (
                          <button
                            type="button" key={w.id}
                            onClick={() => toggleOpFormMember(w.name)}
                            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${picked
                              ? "bg-teal-600/80 border-teal-500 text-white"
                              : "bg-white/5 border-white/10 text-muted hover:border-white/30"}`}
                          >
                            {picked ? "✓ " : "+ "}{w.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {opForm.team_members.length > 0 && (
                    <p className="text-xs text-teal-300 mt-2">{t("teamOf")} {opForm.team_members.length} {opForm.team_members.length === 1 ? t("member") : t("members")}: {opForm.team_members.join(", ")}</p>
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
                        <p className="text-xs text-slate-500 mb-1.5">{t("updatedLabel")} {new Date(op.updated_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}</p>

                        {/* Team roster — a rescue op almost always needs more
                            than one responder, so this shows everyone
                            assigned as removable chips, not a single name. */}
                        <div className="mb-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted">{t("teamRosterLabel")}:</span>
                            {opTeamMembers(op).length === 0 ? (
                              <span className="text-xs text-muted italic">{t("unassigned")}</span>
                            ) : (
                              opTeamMembers(op).map((name) => (
                                <span key={name} className="text-xs bg-teal-500/15 border border-teal-500/30 text-teal-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                                  {name}
                                  {op.status !== "Completed" && (
                                    <button type="button" onClick={() => handleRemoveTeamMember(op.id, name)}
                                      title={t("removeMember")} className="text-teal-300/70 hover:text-red-300">×</button>
                                  )}
                                </span>
                              ))
                            )}
                            {opTeamMembers(op).length > 0 && (
                              <span className="text-xs text-muted">
                                ({opTeamMembers(op).length} {opTeamMembers(op).length === 1 ? t("member") : t("members")})
                              </span>
                            )}
                            {op.status !== "Completed" && (
                              <button type="button"
                                onClick={() => setManageTeamOpId(manageTeamOpId === op.id ? null : op.id)}
                                className="text-xs text-marigold-300 hover:text-marigold-200 underline underline-offset-2">
                                {t("manageTeam")}
                              </button>
                            )}
                          </div>
                          {manageTeamOpId === op.id && (
                            <div className="mt-2 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-2">
                              <select value={manageTeamPick} onChange={(e) => setManageTeamPick(e.target.value)}
                                className="field-input py-1.5 text-xs flex-1">
                                <option value="">{t("assignTeamMembers")}…</option>
                                {rescueWorkers.filter((w) => !opTeamMembers(op).includes(w.name)).map((w) => (
                                  <option key={w.id} value={w.name}>{w.name}</option>
                                ))}
                              </select>
                              <button type="button"
                                onClick={() => handleAddTeamMember(op.id, manageTeamPick)}
                                disabled={!manageTeamPick}
                                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">
                                {t("addMember")}
                              </button>
                            </div>
                          )}
                        </div>

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

          {/* Equipment & Resources (FR-05b) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
              <div>
                <h2 className="font-display text-2xl text-parchment">{t("equipmentResourcesLabel")}</h2>
                <p className="text-sm text-muted">{t("equipmentResourcesDesc")}</p>
              </div>
              <button onClick={() => setShowAddEquipment((v) => !v)} className="btn-secondary text-sm py-2.5">
                {showAddEquipment ? t("cancel") : t("equipAddNew")}
              </button>
            </div>

            {showAddEquipment && (
              <form onSubmit={handleAddEquipment} className="grid gap-3 md:grid-cols-4 bg-ink-soft/60 rounded-xl p-4 my-4 border border-white/10">
                <input value={newEquipForm.name} onChange={(e) => setNewEquipForm((p) => ({ ...p, name: e.target.value }))}
                  required placeholder={t("equipNamePh")} className="field-input py-2 text-sm md:col-span-2" />
                <input value={newEquipForm.category} onChange={(e) => setNewEquipForm((p) => ({ ...p, category: e.target.value }))}
                  placeholder={t("equipCategoryAll")} className="field-input py-2 text-sm" />
                <input value={newEquipForm.unit} onChange={(e) => setNewEquipForm((p) => ({ ...p, unit: e.target.value }))}
                  placeholder={t("equipUnitPh")} className="field-input py-2 text-sm" />
                <input type="number" min="0" value={newEquipForm.total_quantity}
                  onChange={(e) => setNewEquipForm((p) => ({ ...p, total_quantity: e.target.value }))}
                  placeholder={t("equipTotalQty")} className="field-input py-2 text-sm" />
                <div className="md:col-span-3 flex justify-end">
                  <button type="submit" className="btn-primary text-sm py-2">{t("equipAddBtn")}</button>
                </div>
              </form>
            )}

            {/* Category filter */}
            {equipment.length > 0 && (
              <div className="flex flex-wrap gap-2 my-4">
                {equipmentCategories.map((cat) => (
                  <button key={cat} onClick={() => setEquipCategory(cat)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${equipCategory === cat
                      ? "bg-teal-600/80 border-teal-500 text-white"
                      : "bg-white/5 border-white/10 text-muted hover:border-white/30"}`}>
                    {cat === "all" ? t("equipCategoryAll") : cat}
                  </button>
                ))}
              </div>
            )}

            {/* Inventory grid */}
            {visibleEquipment.length === 0 ? (
              <p className="text-muted text-center py-6">—</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-6">
                {visibleEquipment.map((item) => {
                  const ratio = item.total_quantity > 0 ? item.available_quantity / item.total_quantity : 0;
                  const badge = item.status === "Out of stock" ? "bg-red-500/20 border-red-500/50 text-red-300"
                    : item.status === "Low" ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "bg-emerald-500/20 border-emerald-500/50 text-emerald-300";
                  const badgeText = item.status === "Out of stock" ? t("equipOut") : item.status === "Low" ? t("equipLow") : t("equipAvailable");
                  return (
                    <div key={item.id} className="bg-ink-soft/60 rounded-lg p-4 border border-white/10">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-white text-sm">{item.name}</h4>
                          <p className="text-xs text-muted">{item.category}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${badge}`}>{badgeText}</span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="font-display text-xl text-parchment">{item.available_quantity}</span>
                        <span className="text-xs text-muted">{t("ofTotal")} {item.total_quantity} {item.unit}</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
                      </div>
                      {item.available_quantity < item.total_quantity && (
                        <button onClick={() => handleReturnEquipment(item.id, 1)}
                          className="text-xs text-teal-300 hover:text-teal-200 mt-2 underline underline-offset-2">
                          {t("equipReturnBtn")} 1 {item.unit}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Allocate to an operation */}
            {equipment.length > 0 && (
              <form onSubmit={handleAllocateEquipment} className="grid gap-3 md:grid-cols-4 items-end bg-ink-soft/60 rounded-xl p-4 border border-white/10">
                <label className="block md:col-span-2">
                  <span className="text-xs text-muted">{t("equipAllocateTo")}</span>
                  <select value={allocateForm.op_id} onChange={(e) => setAllocateForm((p) => ({ ...p, op_id: e.target.value }))}
                    className="field-input mt-1 py-2 text-sm">
                    <option value="">{t("equipSelectOp")}</option>
                    {operations.filter((o) => o.status !== "Completed").map((o) => (
                      <option key={o.id} value={o.id}>{o.location} ({t(RISK_KEY_MAP[o.risk_level] || o.risk_level)})</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">{t("equipSelectItem")}</span>
                  <select value={allocateForm.item_id} onChange={(e) => setAllocateForm((p) => ({ ...p, item_id: e.target.value }))}
                    className="field-input mt-1 py-2 text-sm">
                    <option value="">{t("equipSelectItem")}</option>
                    {equipment.map((item) => (
                      <option key={item.id} value={item.id} disabled={item.available_quantity <= 0}>
                        {item.name} ({item.available_quantity} {t("equipAvailable").toLowerCase()})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">{t("equipQuantity")}</span>
                  <input type="number" min="1" value={allocateForm.quantity}
                    onChange={(e) => setAllocateForm((p) => ({ ...p, quantity: e.target.value }))}
                    className="field-input mt-1 py-2 text-sm" />
                </label>
                <div className="md:col-span-4 flex justify-end">
                  <button type="submit" className="btn-primary text-sm py-2">{t("equipAllocateBtn")}</button>
                </div>
              </form>
            )}
          </div>

          {/* Shift Handover / Continuity Notes (FR-05c) */}
          <div className="dashboard-card p-6 mb-8">
            <h2 className="font-display text-2xl text-parchment">{t("shiftHandoverLabel")}</h2>
            <p className="text-sm text-muted mb-4">{t("shiftHandoverDesc")}</p>

            <form onSubmit={handlePostHandoverNote} className="bg-ink-soft/60 rounded-xl p-4 border border-white/10 mb-5">
              <textarea rows={3} value={handoverForm.note} required
                onChange={(e) => setHandoverForm((p) => ({ ...p, note: e.target.value }))}
                placeholder={t("handoverNotePh")} className="field-input resize-none text-sm" />
              <div className="grid gap-3 md:grid-cols-3 mt-3">
                <label className="block">
                  <span className="text-xs text-muted">{t("handoverPriority")}</span>
                  <select value={handoverForm.priority} onChange={(e) => setHandoverForm((p) => ({ ...p, priority: e.target.value }))}
                    className="field-input mt-1 py-2 text-sm">
                    <option value="normal">{t("handoverNormal")}</option>
                    <option value="watch">{t("handoverWatch")}</option>
                    <option value="urgent">{t("handoverUrgent")}</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs text-muted">{t("location2")}</span>
                  <input value={handoverForm.location} onChange={(e) => setHandoverForm((p) => ({ ...p, location: e.target.value }))}
                    placeholder={t("handoverLocationPh")} className="field-input mt-1 py-2 text-sm" />
                </label>
              </div>
              <div className="flex justify-end mt-3">
                <button type="submit" className="btn-primary text-sm py-2">{t("postHandoverNote")}</button>
              </div>
            </form>

            {handoverNotes.length === 0 ? (
              <p className="text-muted text-center py-6">{t("noHandoverNotes")}</p>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {handoverNotes.map((n) => (
                  <div key={n.id} className={`rounded-lg p-3 border ${handoverPriorityStyle(n.priority)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm flex-1">{n.note}</p>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 opacity-80">
                        {n.priority === "urgent" ? t("handoverUrgent") : n.priority === "watch" ? t("handoverWatch") : t("handoverNormal")}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                      <p className="text-xs text-muted">
                        {t("postedBy")} <span className="text-white/80">{n.author_name}</span>
                        {n.location && <> · {n.location}</>} · {new Date(n.created_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}
                      </p>
                      {n.acknowledged_by ? (
                        <span className="text-xs text-emerald-300">✓ {t("acknowledgedBy")} {n.acknowledged_by}</span>
                      ) : (
                        <button onClick={() => handleAcknowledgeNote(n.id)} className="text-xs text-marigold-300 hover:text-marigold-200 underline underline-offset-2">
                          {t("acknowledgeNote")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
