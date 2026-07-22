import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import FloodMap from "../components/FloodMap";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

const OP_STATUS_KEY_MAP = { "Assigned": "statusAssigned", "In Progress": "statusInProgress", "Completed": "statusCompleted" };
const RISK_KEY_MAP = { "Low": "lowSeverity", "Medium": "mediumSeverity", "High": "highSeverity" };

// Same 53-city coverage used elsewhere in the app (Citizen Dashboard, Map) —
// needed here so a rescue worker can get directions to an operation site.
const OP_CITY_COORDINATES = {
  "Karachi": [24.8607, 67.0011], "Lahore": [31.5204, 74.3587], "Faisalabad": [31.4504, 73.135],
  "Rawalpindi": [33.5651, 73.0169], "Multan": [30.1575, 71.5249], "Hyderabad": [25.396, 68.3578],
  "Gujranwala": [32.1877, 74.1945], "Peshawar": [34.0151, 71.5249], "Quetta": [30.1798, 66.975],
  "Islamabad": [33.6844, 73.0479], "Sialkot": [32.4945, 74.5229], "Sargodha": [32.0836, 72.6711],
  "Bahawalpur": [29.3956, 71.6836], "Sukkur": [27.7052, 68.8574], "Larkana": [27.559, 68.2123],
  "Sheikhupura": [31.7167, 73.985], "Jhang": [31.2704, 72.3181], "Rahim Yar Khan": [28.4202, 70.2952],
  "Gujrat": [32.5731, 74.0789], "Mardan": [34.1989, 72.0404], "Kasur": [31.118, 74.4467],
  "Okara": [30.8081, 73.4453], "Sahiwal": [30.6682, 73.1114], "Nawabshah": [26.2442, 68.41],
  "Mingora": [34.7717, 72.3604], "Dera Ghazi Khan": [30.0561, 70.6345], "Mirpur Khas": [25.5268, 69.0107],
  "Chiniot": [31.72, 72.9781], "Kamoke": [32.0989, 74.2263], "Mandi Bahauddin": [32.5859, 73.4917],
  "Jacobabad": [28.2769, 68.4381], "Jhelum": [32.9425, 73.7257], "Kohat": [33.59, 71.44],
  "Shikarpur": [27.9556, 68.6382], "Khanewal": [30.3015, 71.931], "Muzaffargarh": [30.0725, 71.1932],
  "Abbottabad": [34.1463, 73.2116], "Muridke": [31.8025, 74.2645], "Bahawalnagar": [29.9989, 73.2578],
  "Khairpur": [27.5295, 68.7592], "Turbat": [26.0031, 63.0483], "Dadu": [26.7308, 67.7761],
  "Chaman": [30.921, 66.4597], "Charsadda": [34.15, 71.74], "Nowshera": [34.015, 71.975],
  "Swabi": [34.12, 72.47], "Bannu": [32.988, 70.603], "Dera Ismail Khan": [31.831, 70.901],
  "Muzaffarabad": [34.37, 73.47], "Mirpur": [33.1478, 73.7508], "Gilgit": [35.9208, 74.3144],
  "Skardu": [35.2971, 75.6333], "Gwadar": [25.1264, 62.3225],
};

function resolveCityCoordsForOp(location) {
  if (!location) return null;
  const loc = location.trim().toLowerCase();
  const match = Object.keys(OP_CITY_COORDINATES).find(
    (city) => city.toLowerCase() === loc || city.toLowerCase().includes(loc) || loc.includes(city.toLowerCase())
  );
  return match ? { lat: OP_CITY_COORDINATES[match][0], lon: OP_CITY_COORDINATES[match][1] } : null;
}

export default function RescueDashboard() {
  const { t, lang } = useLanguage();
  const currentUserName = localStorage.getItem("userName") || "";
  const currentUserId = localStorage.getItem("userId");
  const [activeTab, setActiveTab] = useState("myOps");
  const [onDuty, setOnDuty] = useState(true);
  const [noteInputs, setNoteInputs] = useState({}); // opId -> draft note text
  const [routeInfo, setRouteInfo] = useState(null); // { opId, distanceKm, durationMin } | null
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
  const [equipment, setEquipment] = useState([]);
  const [handoverNotes, setHandoverNotes] = useState([]);
  const [handoverInput, setHandoverInput] = useState("");
  const [handoverPriority, setHandoverPriority] = useState("Normal");
  const [historySearch, setHistorySearch] = useState("");

  // Rescue Teams — named groups of workers so an operation can be assigned
  // to a full 3-4 person team instead of only ever one person.
  const [teams, setTeams] = useState([]);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", member_ids: [] });
  const [assignMode, setAssignMode] = useState("team"); // "team" | "individual"

  // Equipment additions + per-item operation assignment
  const [newEquipment, setNewEquipment] = useState({ name: "", quantity: "1" });
  const [showEquipForm, setShowEquipForm] = useState(false);

  // "My Operations" — operations where assigned_team matches this worker's
  // own name. assigned_team is a free-text field (it can hold a volunteer
  // name too, appended with "+"), so this does a loose contains-check
  // rather than requiring an exact match.
  const myOperations = useMemo(() => {
    if (!currentUserName) return [];
    return operations.filter((op) =>
      (op.assigned_team || "").toLowerCase().includes(currentUserName.toLowerCase())
    );
  }, [operations, currentUserName]);

  const myStats = useMemo(() => {
    const completed = myOperations.filter((op) => op.status === "Completed");
    const totalRescued = completed.reduce((sum, op) => sum + (op.people_rescued || 0), 0);
    const durations = completed
      .filter((op) => op.completed_at)
      .map((op) => Math.max(0, (new Date(op.completed_at) - new Date(op.created_at)) / 60000));
    const avgMinutes = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return {
      total: myOperations.length,
      completed: completed.length,
      active: myOperations.length - completed.length,
      peopleRescued: totalRescued,
      avgMinutes,
    };
  }, [myOperations]);

  // Priority/triage sort — backup requests and High risk operations surface
  // to the top so a worker glancing at the list sees what's most urgent
  // first, instead of just whatever order they were created in.
  const PRIORITY_SCORE = { High: 3, Medium: 2, Low: 1 };
  const sortedOperations = useMemo(() => {
    return [...operations].sort((a, b) => {
      if (!!b.needs_backup !== !!a.needs_backup) return (b.needs_backup ? 1 : 0) - (a.needs_backup ? 1 : 0);
      const scoreA = PRIORITY_SCORE[a.risk_level] || 0;
      const scoreB = PRIORITY_SCORE[b.risk_level] || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  }, [operations]);

  const onDutyWorkers = useMemo(() => rescueWorkers.filter((w) => w.on_duty !== false), [rescueWorkers]);

  const historicalResults = useMemo(() => {
    const completed = operations.filter((op) => op.status === "Completed");
    const query = historySearch.trim().toLowerCase();
    if (!query) return completed;
    return completed.filter((op) =>
      (op.location || "").toLowerCase().includes(query) ||
      (op.assigned_team || "").toLowerCase().includes(query) ||
      (op.completion_notes || "").toLowerCase().includes(query)
    );
  }, [operations, historySearch]);

  const fetchRescueWorkers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users`);
      const workers = (res.data || []).filter((u) => u.role === "rescue_worker" && u.status === "Active");
      setRescueWorkers(workers);
      const me = workers.find((w) => w.id === Number(currentUserId) || w.email === localStorage.getItem("userEmail"));
      if (me && typeof me.on_duty === "boolean") setOnDuty(me.on_duty);
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
      const res = await axios.get(`${API_BASE}/equipment`);
      setEquipment(res.data || []);
    } catch (err) {
      console.error("Failed to load equipment:", err);
    }
  };

  const fetchHandoverNotes = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shift-handover`);
      setHandoverNotes(res.data || []);
    } catch (err) {
      console.error("Failed to load handover notes:", err);
    }
  };

  const handleAddEquipment = async (e) => {
    e.preventDefault();
    const name = newEquipment.name.trim();
    if (!name) return;
    try {
      await axios.post(`${API_BASE}/equipment`, { name, quantity: parseInt(newEquipment.quantity, 10) || 1 });
      setNewEquipment({ name: "", quantity: "1" });
      setShowEquipForm(false);
      fetchEquipment();
    } catch (err) {
      console.error("Failed to add equipment:", err);
    }
  };

  // Deploy N units of an item to a specific operation (only that many count
  // as "in use" — the rest of the quantity stays available for elsewhere).
  const [deployPicks, setDeployPicks] = useState({}); // { [equipmentId]: { opId, qty } }

  const handleDeployEquipment = async (item) => {
    const pick = deployPicks[item.id];
    if (!pick || !pick.opId || !pick.qty) return;
    try {
      await axios.post(`${API_BASE}/equipment/${item.id}/assign`, { op_id: Number(pick.opId), qty: Number(pick.qty) });
      setDeployPicks((p) => ({ ...p, [item.id]: { opId: "", qty: "" } }));
      fetchEquipment();
    } catch (err) {
      setActionFeedback(err?.response?.data?.message || t("couldNotUpdateOp"));
      console.error("Failed to deploy equipment:", err);
    }
  };

  const handleFreeEquipment = async (item, opId) => {
    try {
      await axios.delete(`${API_BASE}/equipment/${item.id}/assign/${opId}`);
      fetchEquipment();
    } catch (err) {
      console.error("Failed to free equipment:", err);
    }
  };

  const handlePostHandoverNote = async () => {
    const note = handoverInput.trim();
    if (!note) return;
    try {
      await axios.post(`${API_BASE}/shift-handover`, { note, author: currentUserName || "Unknown", priority: handoverPriority });
      setHandoverInput("");
      setHandoverPriority("Normal");
      fetchHandoverNotes();
    } catch (err) {
      console.error("Failed to post handover note:", err);
    }
  };

  const handleToggleResolveNote = async (n) => {
    try {
      await axios.put(`${API_BASE}/shift-handover/${n.id}`, { resolved: !n.resolved });
      fetchHandoverNotes();
    } catch (err) {
      console.error("Failed to update handover note:", err);
    }
  };

  const fetchTeams = async () => {
    try {
      const res = await axios.get(`${API_BASE}/teams`);
      setTeams(res.data || []);
    } catch (err) {
      console.error("Failed to load rescue teams:", err);
    }
  };

  const handleToggleTeamMember = (workerId) => {
    setTeamForm((prev) => {
      const has = prev.member_ids.includes(workerId);
      return { ...prev, member_ids: has ? prev.member_ids.filter((id) => id !== workerId) : [...prev.member_ids, workerId] };
    });
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!teamForm.name.trim() || teamForm.member_ids.length < 2) return;
    try {
      await axios.post(`${API_BASE}/teams`, teamForm);
      setTeamForm({ name: "", member_ids: [] });
      setShowTeamForm(false);
      fetchTeams();
    } catch (err) {
      console.error("Failed to create rescue team:", err);
    }
  };

  const handleDeleteTeam = async (teamId) => {
    try {
      await axios.delete(`${API_BASE}/teams/${teamId}`);
      fetchTeams();
    } catch (err) {
      console.error("Failed to delete rescue team:", err);
    }
  };

  const teamMemberNames = (team) =>
    team.member_ids
      .map((id) => rescueWorkers.find((w) => w.id === id)?.name)
      .filter(Boolean);

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

  const handleToggleDuty = async () => {
    const newValue = !onDuty;
    setOnDuty(newValue); // optimistic
    try {
      if (currentUserId) {
        await axios.put(`${API_BASE}/users/${currentUserId}/duty-status`, { on_duty: newValue });
      }
    } catch (err) {
      console.error("Failed to update duty status:", err);
      setOnDuty(!newValue); // revert on failure
    }
  };

  const handleAddNote = async (opId) => {
    const note = (noteInputs[opId] || "").trim();
    if (!note) return;
    try {
      await axios.post(`${API_BASE}/rescue-operations/${opId}/note`, { note });
      setNoteInputs((prev) => ({ ...prev, [opId]: "" }));
      fetchOperations();
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  };

  const handleRequestBackup = async (op) => {
    try {
      await axios.put(`${API_BASE}/rescue-operations/${op.id}/status`, { status: op.status, needs_backup: true });
      setActionFeedback(t("backupRequestedMsg"));
      fetchOperations();
    } catch (err) {
      console.error("Failed to request backup:", err);
    }
  };

  const handleGetRoute = (op) => {
    const dest = resolveCityCoordsForOp(op.location);
    if (!dest) {
      setActionFeedback(t("locationNotResolvable"));
      return;
    }
    if (!navigator.geolocation) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}`, "_blank");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        window.open(`https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}&destination=${dest.lat},${dest.lon}`, "_blank");
      },
      () => {
        // Location permission denied — still open a route, just without a fixed origin (Google Maps will ask/use its own location)
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}`, "_blank");
      }
    );
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
    fetchTeams();
    fetchCommunityReports();
    const interval = setInterval(() => {
      fetchAlerts();
      fetchPredictions();
      fetchOperations();
      fetchCommunityReports();
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

  const handleDeleteOperation = async (opId) => {
    if (!window.confirm(t("confirmDeleteOperation"))) return;
    try {
      await axios.delete(`${API_BASE}/rescue-operations/${opId}`);
      setActionFeedback(t("operationDeletedMsg"));
      fetchOperations();
      fetchStats();
    } catch (err) {
      console.error("Failed to delete rescue operation:", err);
      setActionFeedback(t("couldNotUpdateOp"));
    }
  };

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
      // Don't wipe the alerts list on a transient failure (e.g. the free-tier
      // backend cold-starting after being idle) — keep showing the last known
      // good data instead of flashing everything to zero every ~30s.
      console.error("Error fetching alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  // Community-submitted reports — a citizen filing "water rising near me" is
  // useless if no rescue worker ever sees it. Surfacing it here, with a
  // one-click dispatch, is what actually connects the report to a response.
  const [communityReports, setCommunityReports] = useState([]);
  const fetchCommunityReports = async () => {
    try {
      const res = await axios.get(`${API_BASE}/community-reports`);
      setCommunityReports((res.data || []).filter((r) => r.status !== "Resolved"));
    } catch (err) {
      console.error("Failed to load community reports:", err);
    }
  };

  const handleUpdateReportStatus = async (reportId, status) => {
    try {
      await axios.put(`${API_BASE}/community-reports/${reportId}/status`, { status });
      setActionFeedback(status === "Action Taken" ? t("reportDispatchedMsg") : `${t("operationMarkedAs")} ${status}.`);
      fetchCommunityReports();
      if (status === "Action Taken") { fetchOperations(); fetchStats(); }
    } catch (err) {
      console.error("Failed to update report status:", err);
    }
  };

  const fetchPredictions = async () => {
    try {
      console.log("Fetching predictions from Rescue Dashboard...");
      const res = await axios.get(`${API_BASE}/predictions`);
      console.log("Predictions response:", res.data);
      setPredictions(res.data || []);
    } catch (err) {
      // Same fix as alerts — keep the last good predictions instead of
      // blanking the High/Medium risk area lists on a transient hiccup.
      console.error("Error fetching predictions:", err);
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


  const renderOperationCard = (op) => (
    <div key={op.id} className={`bg-ink-soft/60 rounded-lg p-4 ${opRiskStyles(op.risk_level)}`}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className="font-semibold text-white">{op.location}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${opStatusStyles(op.status)}`}>{t(OP_STATUS_KEY_MAP[op.status] || op.status)}</span>
            <span className="text-xs text-muted">{t(RISK_KEY_MAP[op.risk_level] || op.risk_level)} {t("riskLabel").toLowerCase()}</span>
            {op.needs_backup && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/50 text-red-300 font-semibold">🆘 {t("backupNeeded")}</span>
            )}
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

          {/* In-progress update log */}
          {op.update_log && (Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).length > 0 && (
            <div className="mt-2 bg-white/[0.03] rounded-lg p-2 space-y-1 text-xs text-muted max-h-24 overflow-y-auto">
              {(Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).map((entry, i) => (
                <p key={i}><span className="opacity-60">{new Date(entry.timestamp).toLocaleTimeString(lang === "ur" ? "ur-PK" : undefined)}</span> — {entry.note}</p>
              ))}
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

          {op.status !== "Completed" && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {volunteers.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { handleAssignVolunteer(op.id, e.target.value); e.target.value = ""; } }}
                  className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-muted"
                >
                  <option value="">{t("assignVolunteerLabel")}</option>
                  {volunteers.map((v) => <option key={v.id} value={v.name}>{v.name} ({v.city})</option>)}
                </select>
              )}
              <button onClick={() => handleGetRoute(op)}
                className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2 py-1.5 text-teal-300">
                🧭 {t("getRoute")}
              </button>
              {!op.needs_backup && (
                <button onClick={() => handleRequestBackup(op)}
                  className="text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg px-2 py-1.5 text-red-300">
                  🆘 {t("requestBackup")}
                </button>
              )}
            </div>
          )}

          {op.status !== "Completed" && (
            <div className="flex items-center gap-2 mt-2">
              <input
                value={noteInputs[op.id] || ""}
                onChange={(e) => setNoteInputs((prev) => ({ ...prev, [op.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(op.id); }}
                placeholder={t("addUpdateNotePh")}
                className="field-input text-xs py-2 flex-1"
              />
              <button onClick={() => handleAddNote(op.id)} className="btn-secondary text-xs py-2 px-3 shrink-0">
                {t("post")}
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {op.status !== "Completed" && op.status === "Assigned" && (
            <button onClick={() => handleUpdateOpStatus(op.id, "In Progress")}
              className="bg-teal-600/80 hover:bg-teal-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">{t("start")}</button>
          )}
          {op.status !== "Completed" && (
            <button onClick={() => handleUpdateOpStatus(op.id, "Completed")}
              className="bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">{t("markComplete")}</button>
          )}
          <button onClick={() => handleDeleteOperation(op.id)}
            className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-red-300 text-xs px-3 py-2 rounded-lg transition-colors">{t("deleteOperationBtn")}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink via-ink-soft to-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          {/* Header */}
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow text-teal-400 mb-3">{t("rescueCoordination")}</p>
              <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">{t("operationsCenter")}</h1>
              <p className="text-muted max-w-lg">{t("operationsCenterDesc")}</p>
            </div>
            <button
              onClick={handleToggleDuty}
              className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border transition-colors ${
                onDuty
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-white/5 border-white/15 text-muted"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${onDuty ? "bg-emerald-400" : "bg-slate-500"}`}></span>
              {onDuty ? t("onDuty") : t("offDuty")}
            </button>
          </div>

          {/* Tab Navigation — separates "my own work" from full team
              oversight and the map, instead of one long scrolling page. */}
          <div className="flex flex-wrap gap-2 mb-8 border-b border-white/10 pb-1">
            {[
              { id: "myOps", label: t("tabMyOperations") },
              { id: "team", label: t("tabTeamOverview") },
              { id: "map", label: t("tabMapNavigation") },
              { id: "team_resources", label: t("tabTeamResources") },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                    : "text-muted hover:text-parchment hover:bg-white/5"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ============ TAB: MY OPERATIONS ============ */}
          {activeTab === "myOps" && (<>
          {/* My Performance Stats */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("myPerformance")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">{t("myStatsTitle")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="stat-tile text-center">
                <div className="font-display text-2xl text-parchment">{myStats.total}</div>
                <div className="eyebrow text-muted">{t("totalOperationsLabel")}</div>
              </div>
              <div className="stat-tile text-center">
                <div className="font-display text-2xl text-teal-400">{myStats.active}</div>
                <div className="eyebrow text-muted">{t("activeLabel")}</div>
              </div>
              <div className="stat-tile text-center">
                <div className="font-display text-2xl text-emerald-400">{myStats.completed}</div>
                <div className="eyebrow text-muted">{t("completedLabel")}</div>
              </div>
              <div className="stat-tile text-center">
                <div className="font-display text-2xl text-marigold-400">{myStats.peopleRescued}</div>
                <div className="eyebrow text-muted">{t("peopleRescuedLabel")}</div>
              </div>
              <div className="stat-tile text-center">
                <div className="font-display text-2xl text-parchment">{myStats.avgMinutes ?? "—"}</div>
                <div className="eyebrow text-muted">{t("avgMinutesLabel")}</div>
              </div>
            </div>
          </div>

          {/* My Operations List */}
          <div className="dashboard-card p-6 mb-8">
            <h2 className="font-display text-2xl text-parchment mb-1">{t("myAssignedOperations")}</h2>
            <p className="text-sm text-muted mb-6">{t("myAssignedOperationsDesc")}</p>
            {myOperations.length === 0 ? (
              <p className="text-muted text-center py-6">{t("noOperationsAssignedToMe")}</p>
            ) : (
              <div className="space-y-3">
                {myOperations.map((op) => renderOperationCard(op))}
              </div>
            )}
          </div>
          </>)}
          {/* ============ END TAB: MY OPERATIONS ============ */}

          {/* ============ TAB: TEAM OVERVIEW ============ */}
          {activeTab === "team" && (<>
          {/* Rescue Stats / Operations Overview — surfaced first so a worker
              sees the overall response picture before the raw alert count. */}
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

          {/* Community Reports — what a citizen submits on the Community page,
              made visible here so a rescue worker can actually act on it. */}
          {communityReports.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display text-2xl text-marigold-400 mb-4">{t("communityReportsHeading")}</h2>
              <div className="grid gap-4">
                {communityReports.map((r) => (
                  <div key={r.id} className="dashboard-card border-marigold-500/40 p-6">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-display text-lg text-white">{r.location}</h3>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-muted font-semibold">{r.trackingId}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            r.status === "Action Taken" ? "bg-teal-500/15 border-teal-500/40 text-teal-300" :
                            r.status === "Under Review" ? "bg-marigold-500/15 border-marigold-500/40 text-marigold-300" :
                            "bg-red-500/15 border-red-500/40 text-red-300"
                          }`}>{r.status}</span>
                        </div>
                        <p className="text-muted mb-1">{r.description}</p>
                        <p className="text-xs text-muted">{t("reportedByLabel")}: {r.authorName} · {r.contact} · {new Date(r.createdAt).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}</p>
                        {r.linked_rescue_op_id && (
                          <p className="text-xs text-teal-300 mt-1">{t("linkedOperationLabel")} #{r.linked_rescue_op_id}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {r.status === "Submitted" && (
                          <button onClick={() => handleUpdateReportStatus(r.id, "Under Review")} className="btn-secondary text-xs py-2 px-3">
                            {t("markUnderReview")}
                          </button>
                        )}
                        {r.status !== "Action Taken" && (
                          <button onClick={() => handleUpdateReportStatus(r.id, "Action Taken")}
                            className="bg-teal-600/80 hover:bg-teal-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            {t("dispatchTeamBtn")}
                          </button>
                        )}
                        <button onClick={() => handleUpdateReportStatus(r.id, "Resolved")} className="btn-secondary text-xs py-2 px-3">
                          {t("markResolved")}
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
                <div className="block">
                  <span className="text-sm text-muted">{t("assignWorker")}</span>
                  {/* A flooded area needs a full team, not one person — default
                      to picking a saved team; individual is still available
                      for a lightweight/solo check like inspecting one street. */}
                  <div className="flex gap-2 mt-1 mb-2">
                    <button type="button" onClick={() => setAssignMode("team")}
                      className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${assignMode === "team" ? "bg-teal-500/20 border-teal-500/50 text-teal-300" : "bg-white/5 border-white/15 text-muted"}`}>
                      {t("assignModeTeam")}
                    </button>
                    <button type="button" onClick={() => setAssignMode("individual")}
                      className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${assignMode === "individual" ? "bg-teal-500/20 border-teal-500/50 text-teal-300" : "bg-white/5 border-white/15 text-muted"}`}>
                      {t("assignModeIndividual")}
                    </button>
                  </div>
                  {assignMode === "team" ? (
                    <>
                      <select value={opForm.assigned_team} onChange={(e) => setOpForm((p) => ({ ...p, assigned_team: e.target.value }))}
                        className="field-input py-2.5">
                        <option value="">{t("unassigned")}</option>
                        {teams.map((team) => (
                          <option key={team.id} value={`${team.name}: ${teamMemberNames(team).join(", ")}`}>
                            {team.name} ({teamMemberNames(team).length} {t("membersLabel")})
                          </option>
                        ))}
                      </select>
                      {teams.length === 0 && (
                        <p className="text-xs text-muted mt-1">{t("noTeamsYetHint")}</p>
                      )}
                    </>
                  ) : (
                    <select value={opForm.assigned_team} onChange={(e) => setOpForm((p) => ({ ...p, assigned_team: e.target.value }))}
                      className="field-input py-2.5">
                      <option value="">{t("unassigned")}</option>
                      {rescueWorkers.map((w) => (
                        <option key={w.id} value={w.name}>{w.name} ({w.email})</option>
                      ))}
                    </select>
                  )}
                  {rescueWorkers.length === 0 && (
                    <p className="text-xs text-muted mt-1">No registered rescue workers yet — they show up here once they register with the "Rescue Worker" role.</p>
                  )}
                </div>
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
                {sortedOperations.map((op) => renderOperationCard(op))}
              </div>
            )}
          </div>

          </>)}
          {/* ============ END TAB: TEAM OVERVIEW ============ */}

          {/* ============ TAB: MAP & NAVIGATION ============ */}
          {activeTab === "map" && (<>
          {/* Interactive Map (FR-04) */}
          <div className="mb-8">
            <p className="eyebrow text-teal-400 mb-3">{t("liveMap")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">{t("activeOpsBlockedRoads")}</h2>
            <FloodMap height={460} canEdit={true} />
          </div>
          </>)}
          {/* ============ END TAB: MAP & NAVIGATION ============ */}

          {/* ============ TAB: TEAM & RESOURCES ============ */}
          {activeTab === "team_resources" && (<>
          {/* On-Duty Workers */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-emerald-400 mb-2">{t("coordination")}</p>
            <h2 className="font-display text-2xl text-parchment mb-1">{t("onDutyWorkersTitle")}</h2>
            <p className="text-sm text-muted mb-4">{t("onDutyWorkersDesc")}</p>
            {onDutyWorkers.length === 0 ? (
              <p className="text-sm text-muted">{t("noOneOnDuty")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {onDutyWorkers.map((w) => (
                  <span key={w.id} className="inline-flex items-center gap-1.5 text-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-full px-3 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    {w.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Rescue Teams — real multi-member teams (3-4 people) that get
              sent out as a unit, instead of an operation only ever showing
              one name. */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="eyebrow text-teal-400 mb-2">{t("workforceOversight")}</p>
                <h2 className="font-display text-2xl text-parchment">{t("rescueTeamsTitle")}</h2>
              </div>
              <button onClick={() => setShowTeamForm((v) => !v)} className="btn-secondary text-sm py-2.5 shrink-0">
                {showTeamForm ? t("cancel") : t("newTeamBtn")}
              </button>
            </div>
            <p className="text-sm text-muted mb-4">{t("rescueTeamsDesc")}</p>

            {showTeamForm && (
              <form onSubmit={handleCreateTeam} className="bg-ink-soft/60 rounded-xl p-5 mb-6 border border-white/10 space-y-4">
                <label className="block">
                  <span className="text-sm text-muted">{t("teamNameLabel")}</span>
                  <input value={teamForm.name} onChange={(e) => setTeamForm((p) => ({ ...p, name: e.target.value }))}
                    required className="field-input mt-1 py-2.5" placeholder={t("teamNamePh")} />
                </label>
                <div>
                  <span className="text-sm text-muted">{t("teamMembersLabel")}</span>
                  {rescueWorkers.length === 0 ? (
                    <p className="text-xs text-muted mt-1">{t("noRescueWorkersYet")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {rescueWorkers.map((w) => {
                        const selected = teamForm.member_ids.includes(w.id);
                        return (
                          <button type="button" key={w.id} onClick={() => handleToggleTeamMember(w.id)}
                            className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                              selected ? "bg-teal-500/20 border-teal-500/50 text-teal-300" : "bg-white/5 border-white/15 text-muted"
                            }`}>
                            {w.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {teamForm.member_ids.length > 0 && teamForm.member_ids.length < 2 && (
                    <p className="text-xs text-marigold-400 mt-2">{t("teamNeedsTwoHint")}</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button type="submit" disabled={teamForm.member_ids.length < 2} className="btn-primary disabled:opacity-40">
                    {t("createTeamBtn")}
                  </button>
                </div>
              </form>
            )}

            {teams.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">{t("noTeamsYet")}</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3 mb-2">
                {teams.map((team) => (
                  <div key={team.id} className="bg-white/[0.03] rounded-lg px-4 py-3 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-white">{team.name}</h3>
                      <button onClick={() => handleDeleteTeam(team.id)} className="text-xs text-red-400 hover:text-red-300">
                        {t("deleteTeam")}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {teamMemberNames(team).map((name, i) => (
                        <span key={i} className="text-xs bg-teal-500/10 border border-teal-500/30 text-teal-300 rounded-full px-2.5 py-1">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team Roster / Contact Directory */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("workforceOversight")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">{t("teamRosterTitle")}</h2>
            {rescueWorkers.length === 0 ? (
              <p className="text-sm text-muted">{t("noRescueWorkersYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/20 text-muted">
                      <th className="pb-2">{t("name")}</th>
                      <th className="pb-2">{t("email")}</th>
                      <th className="pb-2">{t("statusLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {rescueWorkers.map((w) => (
                      <tr key={w.id}>
                        <td className="py-2 text-white">{w.name}</td>
                        <td className="py-2 text-muted">{w.email}</td>
                        <td className="py-2">
                          <span className={w.on_duty !== false ? "text-emerald-300" : "text-muted"}>
                            {w.on_duty !== false ? t("onDuty") : t("offDuty")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Volunteers — people who registered via the Community page's
              "Get Involved" form. Previously that registration went nowhere
              a rescue worker could see; this makes it an actual roster they
              can browse and dispatch to a nearby operation. */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("workforceOversight")}</p>
            <h2 className="font-display text-2xl text-parchment mb-1">{t("volunteersTitle")}</h2>
            <p className="text-sm text-muted mb-4">{t("volunteersDesc")}</p>
            {volunteers.length === 0 ? (
              <p className="text-sm text-muted">{t("noVolunteersYet")}</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {volunteers.map((v) => {
                  const activeOps = operations.filter((o) => o.status !== "Completed");
                  return (
                    <div key={v.id} className="bg-white/[0.03] rounded-lg px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-white">{v.name}</h3>
                        <span className="text-xs text-muted">{v.city}</span>
                      </div>
                      <p className="text-xs text-muted mb-1">{v.phone}</p>
                      {v.skills && <p className="text-xs text-teal-300 mb-2">{v.skills}</p>}
                      {activeOps.length > 0 && (
                        <select defaultValue=""
                          onChange={(e) => { if (e.target.value) { handleAssignVolunteer(Number(e.target.value), v.name); e.target.value = ""; } }}
                          className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-muted w-full">
                          <option value="">{t("assignToOperationDropdown")}</option>
                          {activeOps.map((op) => (
                            <option key={op.id} value={op.id}>{op.location} — {op.assigned_team || t("unassigned")}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Equipment / Resource Tracker */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="eyebrow text-marigold-400 mb-2">{t("resourceCoordination")}</p>
                <h2 className="font-display text-2xl text-parchment">{t("equipmentTrackerTitle")}</h2>
              </div>
              <button onClick={() => setShowEquipForm((v) => !v)} className="btn-secondary text-sm py-2.5 shrink-0">
                {showEquipForm ? t("cancel") : t("addEquipmentBtn")}
              </button>
            </div>
            <p className="text-sm text-muted mb-4">{t("equipmentTrackerDesc")}</p>

            {showEquipForm && (
              <form onSubmit={handleAddEquipment} className="grid gap-3 md:grid-cols-[1fr_120px_auto] bg-ink-soft/60 rounded-xl p-4 mb-4 border border-white/10">
                <input value={newEquipment.name} onChange={(e) => setNewEquipment((p) => ({ ...p, name: e.target.value }))}
                  required className="field-input py-2.5" placeholder={t("equipmentNamePh")} />
                <input type="number" min="1" value={newEquipment.quantity}
                  onChange={(e) => setNewEquipment((p) => ({ ...p, quantity: e.target.value }))}
                  className="field-input py-2.5" placeholder={t("quantityLabel")} />
                <button type="submit" className="btn-primary">{t("addEquipmentBtn")}</button>
              </form>
            )}

            <div className="space-y-3">
              {equipment.map((item) => {
                const activeOps = operations.filter((o) => o.status !== "Completed");
                const availableQty = item.available_qty ?? item.quantity;
                const pick = deployPicks[item.id] || { opId: "", qty: "" };
                return (
                  <div key={item.id} className="bg-white/[0.03] rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-white">{item.name}</span>
                      <span className={`text-xs px-3 py-1 rounded-full border font-semibold shrink-0 ${
                        availableQty > 0
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                          : "bg-marigold-500/15 border-marigold-500/40 text-marigold-300"
                      }`}>
                        {availableQty}/{item.quantity} {t("availableOfTotal")}
                      </span>
                    </div>

                    {/* Where the deployed units currently are */}
                    {item.assignments && item.assignments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.assignments.map((a) => (
                          <span key={a.op_id} className="text-xs bg-marigold-500/10 border border-marigold-500/30 text-marigold-300 rounded-full pl-2.5 pr-1 py-1 flex items-center gap-1.5">
                            {a.qty} → {a.location}
                            <button onClick={() => handleFreeEquipment(item, a.op_id)} className="hover:text-white" title={t("freeUpBtn")}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Deploy more units to an operation.
                        Grid (not flex) so the row can never grow past the
                        card's edge no matter how long an operation's name
                        is — the select column shrinks and truncates with an
                        ellipsis instead of pushing the Deploy button out. */}
                    {availableQty > 0 && activeOps.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_64px_auto] gap-2 mt-2">
                        <select value={pick.opId}
                          onChange={(e) => setDeployPicks((p) => ({ ...p, [item.id]: { ...pick, opId: e.target.value } }))}
                          className="field-input py-1.5 text-xs min-w-0 w-full truncate">
                          <option value="">{t("selectOperationPh")}</option>
                          {activeOps.map((op) => (
                            <option key={op.id} value={op.id}>{op.location} — {op.assigned_team || t("unassigned")}</option>
                          ))}
                        </select>
                        <input type="number" min="1" max={availableQty} value={pick.qty} placeholder={t("qtyShort")}
                          onChange={(e) => setDeployPicks((p) => ({ ...p, [item.id]: { ...pick, qty: e.target.value } }))}
                          className="field-input py-1.5 text-xs w-full min-w-0" />
                        <button onClick={() => handleDeployEquipment(item)} className="btn-secondary text-xs py-1.5 px-3 w-full sm:w-auto">
                          {t("deployBtn")}
                        </button>
                      </div>
                    )}
                    {activeOps.length === 0 && (
                      <p className="text-xs text-muted mt-2">{t("noActiveOpsHint")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shift Handover Notes */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-red-400 mb-2">{t("continuity")}</p>
            <h2 className="font-display text-2xl text-parchment mb-1">{t("shiftHandoverTitle")}</h2>
            <p className="text-sm text-muted mb-4">{t("shiftHandoverDesc")}</p>
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 mb-4">
              <input
                value={handoverInput}
                onChange={(e) => setHandoverInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handlePostHandoverNote(); }}
                placeholder={t("handoverNotePh")}
                className="field-input flex-1"
              />
              <select value={handoverPriority} onChange={(e) => setHandoverPriority(e.target.value)}
                className="field-input md:w-40 shrink-0">
                <option value="Normal">{t("priorityNormal")}</option>
                <option value="Watch">{t("priorityWatch")}</option>
                <option value="Urgent">{t("priorityUrgent")}</option>
              </select>
              <button onClick={handlePostHandoverNote} className="btn-primary shrink-0">{t("post")}</button>
            </div>
            {handoverNotes.length === 0 ? (
              <p className="text-sm text-muted">{t("noHandoverNotesYet")}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {handoverNotes.map((n) => {
                  const priorityStyles = n.priority === "Urgent"
                    ? "bg-red-500/15 border-red-500/40 text-red-300"
                    : n.priority === "Watch"
                    ? "bg-marigold-500/15 border-marigold-500/40 text-marigold-300"
                    : "bg-white/10 border-white/20 text-muted";
                  return (
                    <div key={n.id} className={`rounded-lg px-4 py-2.5 text-sm ${n.resolved ? "bg-white/[0.02] opacity-60" : "bg-white/[0.03]"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-white flex-1">{n.note}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${priorityStyles}`}>
                          {n.priority === "Urgent" ? t("priorityUrgent") : n.priority === "Watch" ? t("priorityWatch") : t("priorityNormal")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-muted">{n.author} · {new Date(n.created_at).toLocaleString(lang === "ur" ? "ur-PK" : undefined)}</p>
                        <button onClick={() => handleToggleResolveNote(n)} className="text-xs text-teal-300 hover:text-teal-200 shrink-0">
                          {n.resolved ? t("reopenNote") : t("markNoteResolved")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historical Operations Search */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("recordKeeping")}</p>
            <h2 className="font-display text-2xl text-parchment mb-1">{t("historicalSearchTitle")}</h2>
            <p className="text-sm text-muted mb-4">{t("historicalSearchDesc")}</p>
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder={t("historicalSearchPh")}
              className="field-input mb-4"
            />
            {historicalResults.length === 0 ? (
              <p className="text-sm text-muted">{t("noHistoricalResults")}</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {historicalResults.map((op) => (
                  <div key={op.id} className="bg-white/[0.03] rounded-lg px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">{op.location}</span>
                      <span className="text-xs text-muted">{new Date(op.completed_at).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined)}</span>
                    </div>
                    <p className="text-xs text-muted mt-1">{t("teamLabel")}: {op.assigned_team || t("unassigned")} {op.people_rescued > 0 && `· ${t("peopleRescuedLabel")}: ${op.people_rescued}`}</p>
                    {op.completion_notes && <p className="text-xs text-muted mt-1">📝 {op.completion_notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
          </>)}
          {/* ============ END TAB: TEAM & RESOURCES ============ */}

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
