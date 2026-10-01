import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

// Retry helper for free-tier cold starts
const fetchWithRetry = async (requestFn, { retries = 4, delayMs = 3000 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestFn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
};

export default function RescueDashboard() {
  const { t, lang } = useLanguage();
  const currentUserName = localStorage.getItem("userName") || "Rescue Official";

  // Navigation: Active Operations vs Past Operations Log (FR05-06)
  const [activeTab, setActiveTab] = useState("active"); // "active" | "history"

  // Data states
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");

  // FR05-03: Real-time team notification for new operations
  const [newOpAlert, setNewOpAlert] = useState(null);
  const prevOpIdsRef = useRef(new Set());
  const initialFetchDone = useRef(false);
  const opsFetchSeq = useRef(0);

  // FR05-01: Create & assign operation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    location: "",
    description: "",
    risk_level: "High",
    assigned_team: "Rescue Team Alpha",
  });

  // FR05-02: Status & notes update state
  const [noteInputs, setNoteInputs] = useState({});

  // FR05-05: Mark operation as completed state
  const [completionModal, setCompletionModal] = useState(null); // { opId, location }
  const [completionForm, setCompletionForm] = useState({
    people_rescued: "",
    resources_used: "",
    completion_notes: "",
  });

  // FR05-07: Prioritization filter state
  const [riskFilter, setRiskFilter] = useState("All"); // "All" | "High" | "Medium" | "Low"
  const [statusFilter, setStatusFilter] = useState("All"); // "All" | "Assigned" | "In Progress"

  // FR05-06: Past operations search & filter state
  const [historySearch, setHistorySearch] = useState("");
  const [historyRiskFilter, setHistoryRiskFilter] = useState("All");

  // FR05-04: Polling for real-time operations status (every 12 seconds)
  useEffect(() => {
    fetchOperations();
    const interval = setInterval(() => {
      fetchOperations();
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  // Fetch all rescue operations from backend
  const fetchOperations = async () => {
    const mySeq = ++opsFetchSeq.current;
    try {
      const res = await fetchWithRetry(() => axios.get(`${API_BASE}/rescue-operations`));
      if (mySeq !== opsFetchSeq.current) return;
      const data = res.data || [];

      // FR05-03: Detect newly created operations to notify relevant rescue teams
      if (initialFetchDone.current && prevOpIdsRef.current.size > 0) {
        const brandNewOps = data.filter((op) => !prevOpIdsRef.current.has(op.id) && op.status !== "Completed");
        if (brandNewOps.length > 0) {
          setNewOpAlert(brandNewOps[0]);
        }
      }
      prevOpIdsRef.current = new Set(data.map((o) => o.id));
      initialFetchDone.current = true;

      setOperations(data);
    } catch (err) {
      console.error("Error fetching rescue operations:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchOperations();
    setRefreshing(false);
  };

  // FR05-01: The system shall allow rescue officials to create and assign rescue operations
  const handleCreateOperation = async (e) => {
    e.preventDefault();
    if (!createForm.location.trim()) return;
    try {
      const res = await axios.post(`${API_BASE}/rescue-operations`, createForm);
      setCreateForm({
        location: "",
        description: "",
        risk_level: "High",
        assigned_team: "Rescue Team Alpha",
      });
      setShowCreateModal(false);
      setActionFeedback(`Rescue operation at ${res.data.location} created and assigned to ${res.data.assigned_team}.`);
      fetchOperations();
    } catch (err) {
      console.error("Failed to create rescue operation:", err);
      setActionFeedback("Could not create rescue operation. Please try again.");
    }
  };

  // FR05-02: The system shall allow rescue workers to update the status of an ongoing rescue operation
  const handleUpdateStatus = async (opId, newStatus) => {
    if (newStatus === "Completed") {
      const targetOp = operations.find((o) => o.id === opId);
      setCompletionForm({ people_rescued: "", resources_used: "", completion_notes: "" });
      setCompletionModal({ opId, location: targetOp?.location || "Operation" });
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: newStatus });
      setActionFeedback(`Operation status updated to "${newStatus}".`);
      fetchOperations();
    } catch (err) {
      console.error("Failed to update status:", err);
      setActionFeedback("Failed to update operation status.");
    }
  };

  // FR05-02: Add progress/SITREP note to an ongoing operation
  const handleAddNote = async (opId) => {
    const note = (noteInputs[opId] || "").trim();
    if (!note) return;
    try {
      await axios.post(`${API_BASE}/rescue-operations/${opId}/note`, { note });
      setNoteInputs((prev) => ({ ...prev, [opId]: "" }));
      setActionFeedback("Progress update logged successfully.");
      fetchOperations();
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  };

  // FR05-05: The system shall allow officials to mark a rescue operation as completed
  const handleCompleteOperation = async (e) => {
    e.preventDefault();
    if (!completionModal) return;
    try {
      await axios.put(`${API_BASE}/rescue-operations/${completionModal.opId}/status`, {
        status: "Completed",
        people_rescued: completionForm.people_rescued ? parseInt(completionForm.people_rescued, 10) || 0 : 0,
        resources_used: completionForm.resources_used,
        completion_notes: completionForm.completion_notes,
      });
      setActionFeedback(`Operation at ${completionModal.location} successfully marked as Completed.`);
      setCompletionModal(null);
      fetchOperations();
    } catch (err) {
      console.error("Failed to mark operation as completed:", err);
      setActionFeedback("Failed to complete rescue operation.");
    }
  };

  // FR05-07: The system shall allow officials to prioritize rescue operations based on risk level
  const handleReprioritizeRisk = async (opId, newRiskLevel) => {
    try {
      const targetOp = operations.find((o) => o.id === opId);
      if (!targetOp) return;
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, {
        status: targetOp.status,
        risk_level: newRiskLevel,
      });
      setActionFeedback(`Operation priority updated to ${newRiskLevel} Risk.`);
      fetchOperations();
    } catch (err) {
      console.error("Failed to reprioritize operation:", err);
      setActionFeedback("Failed to update priority.");
    }
  };

  // FR05-06: Export past operations log to CSV for official reporting
  const exportPastOperationsCSV = () => {
    const completedOps = operations.filter((op) => op.status === "Completed");
    if (completedOps.length === 0) {
      alert("No completed rescue operations found to export.");
      return;
    }
    const headers = [
      "Operation ID",
      "Location",
      "Risk Level",
      "Assigned Team",
      "Status",
      "Created At",
      "Completed At",
      "Duration (Minutes)",
      "People Rescued",
      "Resources Used",
      "Completion Notes",
    ];

    const rows = completedOps.map((op) => {
      const dur = op.completed_at && op.created_at
        ? Math.max(0, Math.round((new Date(op.completed_at) - new Date(op.created_at)) / 60000))
        : "";
      return [
        op.id,
        `"${(op.location || "").replace(/"/g, '""')}"`,
        op.risk_level || "Medium",
        `"${(op.assigned_team || "").replace(/"/g, '""')}"`,
        op.status,
        op.created_at ? new Date(op.created_at).toISOString() : "",
        op.completed_at ? new Date(op.completed_at).toISOString() : "",
        dur,
        op.people_rescued || 0,
        `"${(op.resources_used || "").replace(/"/g, '""')}"`,
        `"${(op.completion_notes || "").replace(/"/g, '""')}"`,
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `past_rescue_operations_report_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    setActionFeedback("Official Past Operations Log exported to CSV successfully.");
  };

  // Print individual operation official report
  const handlePrintOperation = (op) => {
    const updateLog = Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${op.location} — Official Rescue Operation Report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #111; max-width: 720px; margin: 0 auto; line-height: 1.5; }
        h1 { border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e3a8a; }
        .meta { color: #4b5563; font-size: 14px; margin-bottom: 20px; background: #f3f4f6; padding: 12px; border-radius: 8px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .badge-high { background: #fee2e2; color: #991b1b; }
        .badge-med { background: #fef3c7; color: #92400e; }
        .badge-low { background: #d1fae5; color: #065f46; }
        .section { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
        h3 { color: #1f2937; margin-bottom: 6px; }
        ul { margin: 6px 0; padding-left: 20px; }
      </style></head><body>
        <h1>Flood Rescue Operation Report</h1>
        <div class="meta">
          <p><strong>Operation ID:</strong> #${op.id} &nbsp;|&nbsp; <strong>Location:</strong> ${op.location}</p>
          <p><strong>Risk Level:</strong> <span class="badge ${op.risk_level === 'High' ? 'badge-high' : op.risk_level === 'Medium' ? 'badge-med' : 'badge-low'}">${op.risk_level} Priority</span> &nbsp;|&nbsp; <strong>Assigned Team:</strong> ${op.assigned_team || "Unassigned"}</p>
          <p><strong>Status:</strong> ${op.status} &nbsp;|&nbsp; <strong>Created:</strong> ${new Date(op.created_at).toLocaleString()}${op.completed_at ? " &nbsp;|&nbsp; <strong>Completed:</strong> " + new Date(op.completed_at).toLocaleString() : ""}</p>
        </div>
        ${op.description ? `<div class="section"><h3>Operation Mission Description</h3><p>${op.description}</p></div>` : ""}
        ${op.status === "Completed" ? `
          <div class="section">
            <h3>Completion Summary</h3>
            <p><strong>Civilians Rescued:</strong> ${op.people_rescued || 0} individuals</p>
            ${op.resources_used ? `<p><strong>Resources Deployed:</strong> ${op.resources_used}</p>` : ""}
            ${op.completion_notes ? `<p><strong>Final SITREP / Notes:</strong> ${op.completion_notes}</p>` : ""}
          </div>
        ` : ""}
        ${updateLog.length ? `
          <div class="section">
            <h3>Progress & SITREP Log</h3>
            <ul>${updateLog.map((u) => `<li><strong>${new Date(u.timestamp).toLocaleTimeString()}:</strong> ${u.note}</li>`).join("")}</ul>
          </div>
        ` : ""}
      </body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  // FR05-07: Prioritization logic (High > Medium > Low)
  const PRIORITY_SCORE = { High: 3, Medium: 2, Low: 1 };

  // FR05-04: Real-time active operations list (sorted by risk priority)
  const activeOperations = useMemo(() => {
    let list = operations.filter((op) => op.status !== "Completed");
    if (riskFilter !== "All") {
      list = list.filter((op) => op.risk_level === riskFilter);
    }
    if (statusFilter !== "All") {
      list = list.filter((op) => op.status === statusFilter);
    }
    return list.sort((a, b) => {
      const scoreA = PRIORITY_SCORE[a.risk_level] || 0;
      const scoreB = PRIORITY_SCORE[b.risk_level] || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  }, [operations, riskFilter, statusFilter]);

  // FR05-06: Past operations log list
  const pastOperations = useMemo(() => {
    let list = operations.filter((op) => op.status === "Completed");
    if (historyRiskFilter !== "All") {
      list = list.filter((op) => op.risk_level === historyRiskFilter);
    }
    const query = historySearch.trim().toLowerCase();
    if (query) {
      list = list.filter((op) =>
        (op.location || "").toLowerCase().includes(query) ||
        (op.assigned_team || "").toLowerCase().includes(query) ||
        (op.completion_notes || "").toLowerCase().includes(query) ||
        (op.resources_used || "").toLowerCase().includes(query)
      );
    }
    return list.sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at));
  }, [operations, historySearch, historyRiskFilter]);

  // Quick metrics
  const totalActive = operations.filter((o) => o.status !== "Completed").length;
  const highRiskActive = operations.filter((o) => o.status !== "Completed" && o.risk_level === "High").length;
  const inProgressCount = operations.filter((o) => o.status === "In Progress").length;
  const completedCount = operations.filter((o) => o.status === "Completed").length;
  const totalRescued = operations
    .filter((o) => o.status === "Completed")
    .reduce((sum, op) => sum + (op.people_rescued || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink via-ink-soft to-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">

          {/* Header */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse"></span>
                <span className="eyebrow text-teal-400 font-semibold tracking-wider">Emergency Rescue System (FR-05)</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl text-parchment">Rescue Operations Center</h1>
              <p className="text-muted text-sm mt-1">Real-time rescue operation coordination, status tracking, risk prioritization, and mission reporting.</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleManualRefresh}
                disabled={refreshing}
                className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
                title="Force refresh data"
              >
                {refreshing ? "Syncing..." : "🔄 Refresh"}
              </button>
              {/* FR05-01: Create Operation Button */}
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary text-xs sm:text-sm py-2 px-4 shadow-lg shadow-teal-500/20 flex items-center gap-1.5"
              >
                + Create & Assign Operation
              </button>
            </div>
          </div>

          {/* Feedback banner */}
          {actionFeedback && (
            <div className="mb-6 bg-teal-500/15 border border-teal-500/40 rounded-xl px-4 py-2.5 text-sm text-teal-300 flex items-center justify-between animate-fadeIn">
              <span>✓ {actionFeedback}</span>
              <button onClick={() => setActionFeedback("")} className="text-teal-400 hover:text-white text-xs">✕</button>
            </div>
          )}

          {/* FR05-03: Real-Time Team Notification Banner */}
          {newOpAlert && (
            <div className="mb-6 bg-gradient-to-r from-red-500/20 via-amber-500/20 to-teal-500/20 border border-teal-500/60 rounded-2xl p-4 flex items-center justify-between gap-4 animate-pulse shadow-xl shadow-teal-500/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-bounce">🔔</span>
                <div>
                  <h4 className="font-bold text-white text-sm sm:text-base flex items-center gap-2">
                    NEW RESCUE OPERATION ALERT: {newOpAlert.location}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/30 text-red-200 border border-red-500/50">
                      {newOpAlert.risk_level} Risk
                    </span>
                  </h4>
                  <p className="text-xs text-muted mt-0.5">
                    Assigned to: <strong className="text-teal-300">{newOpAlert.assigned_team || "Rescue Team Alpha"}</strong> · Real-time team dispatch notice (FR05-03).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setActiveTab("active");
                    setNewOpAlert(null);
                  }}
                  className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                >
                  View Operation
                </button>
                <button
                  onClick={() => setNewOpAlert(null)}
                  className="text-muted hover:text-white text-sm px-2 py-1"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Metrics summary banner (FR05-04, FR05-06, FR05-07) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <div className="dashboard-card p-4 text-center">
              <div className="font-display text-2xl text-parchment">{totalActive}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">Total Active Ops (FR05-04)</div>
            </div>
            <div className="dashboard-card p-4 text-center border-red-500/30">
              <div className="font-display text-2xl text-red-400">{highRiskActive}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">High Risk Priority (FR05-07)</div>
            </div>
            <div className="dashboard-card p-4 text-center border-teal-500/30">
              <div className="font-display text-2xl text-teal-400">{inProgressCount}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">In Progress (FR05-02)</div>
            </div>
            <div className="dashboard-card p-4 text-center border-emerald-500/30">
              <div className="font-display text-2xl text-emerald-400">{completedCount}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">Completed Log (FR05-06)</div>
            </div>
            <div className="dashboard-card p-4 text-center border-marigold-500/30 col-span-2 md:col-span-1">
              <div className="font-display text-2xl text-marigold-400">{totalRescued}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">Citizens Rescued (FR05-05)</div>
            </div>
          </div>

          {/* Navigation: Active Operations vs Past Operations Log */}
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-1">
            <button
              onClick={() => setActiveTab("active")}
              className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "active"
                  ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                  : "text-muted hover:text-parchment hover:bg-white/5"
              }`}
            >
              <span>⚡ Active Rescue Operations (FR05-04)</span>
              {totalActive > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-teal-500 text-white text-[10px] font-bold">
                  {totalActive}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "history"
                  ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                  : "text-muted hover:text-parchment hover:bg-white/5"
              }`}
            >
              <span>📜 Past Operations Log & Reports (FR05-06)</span>
              {completedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                  {completedCount}
                </span>
              )}
            </button>
          </div>

          {/* ============================================================== */}
          {/* TAB 1: ACTIVE OPERATIONS (FR05-01, FR05-02, FR05-04, FR05-07) */}
          {/* ============================================================== */}
          {activeTab === "active" && (
            <div>
              {/* FR05-07: Risk-Based Prioritization & Filter Toolbar */}
              <div className="dashboard-card p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted font-medium">Risk Priority (FR05-07):</span>
                    {["All", "High", "Medium", "Low"].map((level) => (
                      <button
                        key={level}
                        onClick={() => setRiskFilter(level)}
                        className={`text-xs px-3 py-1 rounded-full border font-semibold transition-colors ${
                          riskFilter === level
                            ? "bg-teal-500/25 border-teal-500 text-teal-300"
                            : "bg-white/5 border-white/10 text-muted hover:border-white/20"
                        }`}
                      >
                        {level === "High" ? "🔴 High" : level === "Medium" ? "🟡 Medium" : level === "Low" ? "🟢 Low" : "All Risks"}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                    <span className="text-xs text-muted font-medium">Status:</span>
                    {["All", "Assigned", "In Progress"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                          statusFilter === st
                            ? "bg-white/15 border-white/40 text-white"
                            : "bg-white/5 border-white/10 text-muted hover:border-white/20"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-teal-400"></span>
                  <span>Sorted by Risk Severity (High Priority First)</span>
                </div>
              </div>

              {/* Active Operations List */}
              {loading ? (
                <div className="text-center py-16 text-muted">
                  <span className="w-5 h-5 rounded-full border-2 border-teal-300 border-t-transparent animate-spin inline-block mr-2"></span>
                  Loading active rescue operations...
                </div>
              ) : activeOperations.length === 0 ? (
                <div className="dashboard-card p-12 text-center text-muted">
                  <p className="text-base text-parchment mb-2">No active rescue operations matching current filters.</p>
                  <p className="text-xs max-w-md mx-auto mb-4">Click below to create a new operation and assign a rescue team to the affected area.</p>
                  <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs py-2 px-4">
                    + Create & Assign Operation (FR05-01)
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeOperations.map((op) => (
                    <div
                      key={op.id}
                      className={`dashboard-card p-5 border-l-4 ${
                        op.risk_level === "High" ? "border-l-red-500" :
                        op.risk_level === "Medium" ? "border-l-yellow-500" :
                        "border-l-green-500"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="flex-1">
                          {/* Card Header: Location, Status, Risk */}
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-xs text-muted font-mono">#{op.id}</span>
                            <h3 className="font-semibold text-white text-lg">{op.location}</h3>

                            {/* Status Badge */}
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${
                              op.status === "In Progress"
                                ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                : "bg-amber-500/20 border-amber-500/50 text-amber-300"
                            }`}>
                              {op.status}
                            </span>

                            {/* Risk Priority Badge */}
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${
                              op.risk_level === "High" ? "bg-red-500/20 text-red-300 border-red-500/50" :
                              op.risk_level === "Medium" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/50" :
                              "bg-green-500/20 text-green-300 border-green-500/50"
                            }`}>
                              {op.risk_level === "High" ? "🔴 High Risk Priority" : op.risk_level === "Medium" ? "🟡 Medium Risk" : "🟢 Low Risk"}
                            </span>

                            {/* FR05-07: Prioritize dropdown on card */}
                            <div className="flex items-center gap-1 ml-auto">
                              <span className="text-[10px] text-muted">Prioritize (FR05-07):</span>
                              <select
                                value={op.risk_level || "Medium"}
                                onChange={(e) => handleReprioritizeRisk(op.id, e.target.value)}
                                className="text-[11px] bg-white/5 border border-white/20 rounded px-2 py-0.5 text-muted hover:text-white focus:outline-none"
                                title="Reprioritize operation risk level"
                              >
                                <option value="High" className="bg-ink text-red-300">🔴 High Risk</option>
                                <option value="Medium" className="bg-ink text-yellow-300">🟡 Medium Risk</option>
                                <option value="Low" className="bg-ink text-green-300">🟢 Low Risk</option>
                              </select>
                            </div>
                          </div>

                          {/* Description & Team Assignment (FR05-01) */}
                          {op.description && <p className="text-sm text-parchment/90 mb-2">{op.description}</p>}
                          <p className="text-xs text-muted">
                            Assigned Team: <strong className="text-teal-300">{op.assigned_team || "Unassigned"}</strong> · Dispatched: {new Date(op.created_at).toLocaleString()}
                          </p>

                          {/* Progress Update Log / SITREP (FR05-02) */}
                          {op.update_log && (Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).length > 0 && (
                            <div className="mt-3 bg-white/[0.03] rounded-lg p-2.5 text-xs text-muted space-y-1 max-h-24 overflow-y-auto">
                              <span className="font-semibold text-white text-[11px] block mb-1">Progress SITREP Log:</span>
                              {(Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).map((entry, idx) => (
                                <p key={idx}>
                                  <span className="opacity-60">{new Date(entry.timestamp).toLocaleTimeString()}:</span> {entry.note}
                                </p>
                              ))}
                            </div>
                          )}

                          {/* Add Note Input (FR05-02) */}
                          <div className="flex items-center gap-2 mt-3">
                            <input
                              value={noteInputs[op.id] || ""}
                              onChange={(e) => setNoteInputs((prev) => ({ ...prev, [op.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(op.id); }}
                              placeholder="Add progress update / SITREP note (FR05-02)..."
                              className="field-input text-xs py-1.5 flex-1"
                            />
                            <button
                              onClick={() => handleAddNote(op.id)}
                              className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                            >
                              Post Update
                            </button>
                          </div>
                        </div>

                        {/* Status Action Buttons (FR05-02 & FR05-05) */}
                        <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/10">
                          {op.status === "Assigned" ? (
                            <button
                              onClick={() => handleUpdateStatus(op.id, "In Progress")}
                              className="bg-teal-600/90 hover:bg-teal-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg transition-colors shadow-sm flex items-center gap-1.5 w-full justify-center"
                            >
                              ▶️ Start Operation (FR05-02)
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpdateStatus(op.id, "Assigned")}
                              className="bg-amber-600/70 hover:bg-amber-500 text-white font-medium text-xs px-3 py-1.5 rounded-lg transition-colors w-full justify-center text-center"
                            >
                              ⏸️ Put on Hold
                            </button>
                          )}

                          {/* FR05-05: Mark Completed */}
                          <button
                            onClick={() => handleUpdateStatus(op.id, "Completed")}
                            className="bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg transition-colors shadow-sm flex items-center gap-1.5 w-full justify-center"
                          >
                            ✅ Mark Completed (FR05-05)
                          </button>

                          <button
                            onClick={() => handlePrintOperation(op)}
                            className="text-xs text-muted hover:text-teal-300 transition-colors py-1"
                          >
                            🖨️ Print Report
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: PAST OPERATIONS LOG & REPORTS (FR05-06)                 */}
          {/* ============================================================== */}
          {activeTab === "history" && (
            <div className="dashboard-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <p className="eyebrow text-teal-400 mb-1">Official Registry & Audit Log (FR05-06)</p>
                  <h2 className="font-display text-2xl text-parchment">Past Rescue Operations Log</h2>
                  <p className="text-xs text-muted mt-0.5">Comprehensive audit log of all completed rescue missions for government reporting.</p>
                </div>
                <button
                  onClick={exportPastOperationsCSV}
                  className="bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                >
                  📥 Export Reporting Log (CSV)
                </button>
              </div>

              {/* Search & Risk Filter Toolbar */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-4 border-t border-white/10 mb-6">
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search past operations by city, team, notes, resources..."
                  className="field-input sm:max-w-md text-sm py-2"
                />
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted">Risk Filter:</span>
                  {["All", "High", "Medium", "Low"].map((level) => (
                    <button
                      key={level}
                      onClick={() => setHistoryRiskFilter(level)}
                      className={`text-xs px-3 py-1 rounded-full border font-semibold transition-colors ${
                        historyRiskFilter === level
                          ? "bg-teal-500/25 border-teal-500 text-teal-300"
                          : "bg-white/5 border-white/10 text-muted hover:border-white/20"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Historical Operations Table */}
              {pastOperations.length === 0 ? (
                <div className="text-center py-12 text-muted bg-white/[0.02] rounded-xl border border-white/5">
                  <p className="text-base font-medium">No past rescue operations found matching your filter.</p>
                  <p className="text-xs mt-1">Completed rescue operations will automatically appear here with full reporting records.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/20 text-muted text-xs">
                        <th className="pb-3 font-semibold">Mission ID</th>
                        <th className="pb-3 font-semibold">Location</th>
                        <th className="pb-3 font-semibold">Risk Priority</th>
                        <th className="pb-3 font-semibold">Assigned Team</th>
                        <th className="pb-3 font-semibold">Rescued</th>
                        <th className="pb-3 font-semibold">Resources Used</th>
                        <th className="pb-3 font-semibold">Completed Date</th>
                        <th className="pb-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {pastOperations.map((op) => (
                        <tr key={op.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 text-muted text-xs font-mono">#{op.id}</td>
                          <td className="py-3">
                            <span className="font-semibold text-white">{op.location}</span>
                            {op.description && <p className="text-xs text-muted truncate max-w-xs">{op.description}</p>}
                          </td>
                          <td className="py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                              op.risk_level === "High" ? "bg-red-500/20 text-red-300 border-red-500/40" :
                              op.risk_level === "Medium" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" :
                              "bg-green-500/20 text-green-300 border-green-500/40"
                            }`}>
                              {op.risk_level || "Medium"}
                            </span>
                          </td>
                          <td className="py-3 text-muted text-xs">{op.assigned_team || "Unassigned"}</td>
                          <td className="py-3">
                            <span className="font-semibold text-emerald-400">{op.people_rescued || 0}</span>
                          </td>
                          <td className="py-3 text-xs text-muted max-w-xs truncate">
                            {op.resources_used || "—"}
                          </td>
                          <td className="py-3 text-xs text-muted">
                            {op.completed_at ? new Date(op.completed_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => handlePrintOperation(op)}
                              className="text-xs px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-teal-300 border border-white/10 transition-colors"
                            >
                              🖨️ Print Report
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* MODAL: FR05-01 CREATE & ASSIGN RESCUE OPERATION                */}
          {/* ============================================================== */}
          {showCreateModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
              <form onSubmit={handleCreateOperation} className="dashboard-card p-6 max-w-lg w-full border border-teal-500/40">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="eyebrow text-teal-400 text-xs font-semibold">New Mission (FR05-01)</span>
                    <h2 className="font-display text-2xl text-parchment">Create & Assign Operation</h2>
                  </div>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="text-muted hover:text-white text-lg">✕</button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="field-label text-xs">Affected Area / City Location *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sukkur, Nowshera, Larkana, Karachi..."
                      value={createForm.location}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, location: e.target.value }))}
                      className="field-input text-sm py-2"
                    />
                  </div>

                  <div>
                    <label className="field-label text-xs">Risk Level of Affected Area (FR05-07) *</label>
                    <select
                      value={createForm.risk_level}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, risk_level: e.target.value }))}
                      className="field-input text-sm py-2"
                    >
                      <option value="High" className="bg-ink text-red-300">🔴 High Risk (Immediate Danger / Urgent)</option>
                      <option value="Medium" className="bg-ink text-yellow-300">🟡 Medium Risk (Elevated Threat / Watch)</option>
                      <option value="Low" className="bg-ink text-green-300">🟢 Low Risk (Precautionary / Monitoring)</option>
                    </select>
                  </div>

                  <div>
                    <label className="field-label text-xs">Assign Rescue Team / Worker (FR05-01) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rescue Team Alpha, Team Bravo, Quick Response Unit..."
                      value={createForm.assigned_team}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, assigned_team: e.target.value }))}
                      className="field-input text-sm py-2"
                    />
                  </div>

                  <div>
                    <label className="field-label text-xs">Incident & Operation Description</label>
                    <textarea
                      rows={3}
                      placeholder="Detail situation on ground: water depth, trapped citizens, required equipment..."
                      value={createForm.description}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                      className="field-input text-sm py-2 resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button type="submit" className="btn-primary flex-1 py-2 text-sm font-semibold">
                    Create & Notify Team (FR05-01)
                  </button>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* MODAL: FR05-05 MARK OPERATION AS COMPLETED                     */}
          {/* ============================================================== */}
          {completionModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
              <form onSubmit={handleCompleteOperation} className="dashboard-card p-6 max-w-lg w-full border border-emerald-500/40">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="eyebrow text-emerald-400 text-xs font-semibold">Official Sign-Off (FR05-05)</span>
                    <h2 className="font-display text-2xl text-parchment">Mark Operation Completed</h2>
                    <p className="text-xs text-muted mt-0.5">Location: <strong className="text-white">{completionModal.location}</strong></p>
                  </div>
                  <button type="button" onClick={() => setCompletionModal(null)} className="text-muted hover:text-white text-lg">✕</button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="field-label text-xs">Number of People Rescued *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      placeholder="e.g. 45"
                      value={completionForm.people_rescued}
                      onChange={(e) => setCompletionForm((prev) => ({ ...prev, people_rescued: e.target.value }))}
                      className="field-input text-sm py-2"
                    />
                  </div>

                  <div>
                    <label className="field-label text-xs">Resources Deployed / Used</label>
                    <input
                      type="text"
                      placeholder="e.g. 2 Inflatable Boats, 3 Ambulances, 50 Lifejackets"
                      value={completionForm.resources_used}
                      onChange={(e) => setCompletionForm((prev) => ({ ...prev, resources_used: e.target.value }))}
                      className="field-input text-sm py-2"
                    />
                  </div>

                  <div>
                    <label className="field-label text-xs">Final Completion Report & Notes</label>
                    <textarea
                      rows={3}
                      placeholder="Summarize operation outcomes, safe evacuation shelters transferred to, etc."
                      value={completionForm.completion_notes}
                      onChange={(e) => setCompletionForm((prev) => ({ ...prev, completion_notes: e.target.value }))}
                      className="field-input text-sm py-2 resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button type="submit" className="bg-emerald-600/90 hover:bg-emerald-500 text-white font-semibold flex-1 py-2 text-sm rounded-lg transition-colors shadow-lg shadow-emerald-600/20">
                    Sign Off & Log as Completed (FR05-05)
                  </button>
                  <button type="button" onClick={() => setCompletionModal(null)} className="btn-secondary py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>
      <Footer />
    </div>
  );
}
