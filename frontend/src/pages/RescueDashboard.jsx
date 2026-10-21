import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import FloodMap from "../components/FloodMap";
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
  const currentUserName = (localStorage.getItem("userName") || "").trim();
  const currentUserEmail = (localStorage.getItem("userEmail") || "").trim();
  const [scopeFilter, setScopeFilter] = useState("my"); // "my" | "all"

  const isAssignedToMe = useCallback((op) => {
    if (!currentUserName && !currentUserEmail) return false;
    const nameLower = currentUserName.toLowerCase();
    const emailLower = currentUserEmail.toLowerCase();
    if (Array.isArray(op.worker_names) && op.worker_names.some((n) => String(n).trim().toLowerCase() === nameLower)) {
      return true;
    }
    if (Array.isArray(op.workers) && op.workers.some((w) => {
      const wName = String(w.name || "").trim().toLowerCase();
      const wEmail = String(w.email || "").trim().toLowerCase();
      return (nameLower && wName === nameLower) || (emailLower && wEmail === emailLower);
    })) {
      return true;
    }
    if (typeof op.assigned_team === "string") {
      const parts = op.assigned_team.split(",").map((s) => s.trim().toLowerCase());
      if (parts.includes(nameLower) || (nameLower && op.assigned_team.toLowerCase().includes(nameLower))) {
        return true;
      }
    }
    return false;
  }, [currentUserName, currentUserEmail]);

  // Navigation: Active Operations vs Past Operations Log
  const [activeTab, setActiveTab] = useState("active"); // "active" | "history"

  // Data states
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");

  // Real-time team notification for new operations
  const [newOpAlert, setNewOpAlert] = useState(null);
  const prevOpIdsRef = useRef(new Set());
  const initialFetchDone = useRef(false);
  const opsFetchSeq = useRef(0);



  // Status & notes update state
  const [noteInputs, setNoteInputs] = useState({});

  // Mark operation as completed state
  const [completionModal, setCompletionModal] = useState(null); // { opId, location }
  const [completionForm, setCompletionForm] = useState({
    people_rescued: "",
    resources_used: "",
    completion_notes: "",
  });

  // Prioritization filter state
  const [riskFilter, setRiskFilter] = useState("All"); // "All" | "High" | "Medium" | "Low"
  const [statusFilter, setStatusFilter] = useState("All"); // "All" | "Assigned" | "In Progress"

  // Past operations search & filter state
  const [historySearch, setHistorySearch] = useState("");
  const [historyRiskFilter, setHistoryRiskFilter] = useState("All");

  // Polling for real-time operations status (every 12 seconds)
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

      // Detect newly created operations to notify relevant rescue teams
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



  // Update status of an ongoing rescue operation
  const handleUpdateStatus = async (opId, newStatus) => {
    if (newStatus === "Completed") {
      const targetOp = operations.find((o) => o.id === opId);
      setCompletionForm({ people_rescued: "", resources_used: "", completion_notes: "" });
      setCompletionModal({ opId, location: targetOp?.location || "Operation" });
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: newStatus });
      setActionFeedback(lang === "ur" ? `آپریشن کی حیثیت "${newStatus}" کر دی گئی۔` : `Operation status updated to "${newStatus}".`);
      fetchOperations();
    } catch (err) {
      console.error("Failed to update status:", err);
      setActionFeedback(lang === "ur" ? "آپریشن کی حیثیت اپڈیٹ کرنے میں ناکامی۔" : "Failed to update operation status.");
    }
  };

  // Add progress/SITREP note to an ongoing operation
  const handleAddNote = async (opId) => {
    const note = (noteInputs[opId] || "").trim();
    if (!note) return;
    try {
      await axios.post(`${API_BASE}/rescue-operations/${opId}/note`, { note });
      setNoteInputs((prev) => ({ ...prev, [opId]: "" }));
      setActionFeedback(lang === "ur" ? "پیشرفت کامیابی سے درج کر لی گئی۔" : "Progress update logged successfully.");
      fetchOperations();
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  };

  const handleCompleteOperation = async (e) => {
    e.preventDefault();
    if (!completionModal) return;
    const rescued = parseInt(completionForm.people_rescued, 10);
    if (isNaN(rescued) || rescued < 0) {
      setActionFeedback(lang === "ur" ? "براہ کرم بچائے گئے افراد کی درست تعداد درج کریں۔" : "Please provide a valid non-negative number of people rescued.");
      return;
    }
    const notes = (completionForm.completion_notes || "").trim();
    if (!notes || notes.length < 5) {
      setActionFeedback(lang === "ur" ? "براہ کرم مختصر اختتامی نوٹ درج کریں (کم از کم 5 حروف)۔" : "Please enter a brief completion report note (minimum 5 characters).");
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${completionModal.opId}/status`, {
        status: "Completed",
        people_rescued: rescued,
        resources_used: (completionForm.resources_used || "").trim(),
        completion_notes: notes,
      });
      setActionFeedback(lang === "ur" ? `${completionModal.location} پر آپریشن کامیابی سے مکمل ہو گیا۔` : `Operation at ${completionModal.location} successfully marked as Completed.`);
      setCompletionModal(null);
      fetchOperations();
    } catch (err) {
      console.error("Failed to mark operation as completed:", err);
      setActionFeedback(lang === "ur" ? "ریسکیو آپریشن مکمل کرنے میں ناکامی۔" : "Failed to complete rescue operation.");
    }
  };

  // Prioritize rescue operations based on risk level
  const handleReprioritizeRisk = async (opId, newRiskLevel) => {
    try {
      const targetOp = operations.find((o) => o.id === opId);
      if (!targetOp) return;
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, {
        status: targetOp.status,
        risk_level: newRiskLevel,
      });
      setActionFeedback(lang === "ur" ? `آپریشن کی ترجیح ${newRiskLevel} خطرہ کر دی گئی۔` : `Operation priority updated to ${newRiskLevel} Risk.`);
      fetchOperations();
    } catch (err) {
      console.error("Failed to reprioritize operation:", err);
      setActionFeedback(lang === "ur" ? "ترجیح تبدیل کرنے میں ناکامی۔" : "Failed to update priority.");
    }
  };

  // Export past operations log to CSV for official reporting
  const exportPastOperationsCSV = () => {
    const completedOps = operations.filter((op) => op.status === "Completed");
    if (completedOps.length === 0) {
      alert(lang === "ur" ? "ایکسپورٹ کے لیے کوئی مکمل آپریشن موجود نہیں۔" : "No completed rescue operations found to export.");
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
    setActionFeedback(lang === "ur" ? "ماضی کا آپریشنز لاگ کامیابی سے CSV میں ایکسپورٹ ہو گیا۔" : "Official Past Operations Log exported to CSV successfully.");
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
          <p><strong>Status:</strong> ${op.status === "In Progress" ? (lang === "ur" ? "جاری ہے" : "In Progress") : op.status === "Assigned" ? (lang === "ur" ? "تفویض شدہ" : "Assigned") : op.status === "Completed" ? (lang === "ur" ? "مکمل" : "Completed") : op.status} &nbsp;|&nbsp; <strong>Created:</strong> ${new Date(op.created_at).toLocaleString()}${op.completed_at ? " &nbsp;|&nbsp; <strong>Completed:</strong> " + new Date(op.completed_at).toLocaleString() : ""}</p>
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

  // Prioritization logic (High > Medium > Low)
  const PRIORITY_SCORE = { High: 3, Medium: 2, Low: 1 };

  // Real-time active operations list (sorted by risk priority & scope)
  const activeOperations = useMemo(() => {
    let list = operations.filter((op) => op.status !== "Completed");
    if (scopeFilter === "my") {
      list = list.filter((op) => isAssignedToMe(op));
    }
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
  }, [operations, scopeFilter, riskFilter, statusFilter, isAssignedToMe]);

  // Past operations log list
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
  const myActiveCount = operations.filter((o) => o.status !== "Completed" && isAssignedToMe(o)).length;
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
                <span className="eyebrow text-teal-400 font-semibold tracking-wider">{lang === "ur" ? "ہنگامی ریسکیو کوآرڈینیشن" : "Emergency Rescue Coordination"}</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl text-parchment">{lang === "ur" ? "ریسکیو آپریشنز سینٹر" : "Rescue Operations Center"}</h1>
              <p className="text-muted text-sm mt-1">{lang === "ur" ? "ریئل ٹائم ریسکیو آپریشنز کوآرڈینیشن، اسٹیٹس ٹریکنگ، خطرے کی ترجیح اور مشن رپورٹنگ۔" : "Real-time rescue operation coordination, status tracking, risk prioritization, and mission reporting."}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleManualRefresh}
                disabled={refreshing}
                className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
                title="Force refresh data"
              >
                {refreshing ? (lang === "ur" ? "ہم آہنگ ہو رہا ہے..." : "Syncing...") : (lang === "ur" ? "🔄 تازہ کریں" : "🔄 Refresh")}
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

          {/* Real-Time Team Notification Banner */}
          {newOpAlert && (
            <div className="mb-6 bg-gradient-to-r from-red-500/20 via-amber-500/20 to-teal-500/20 border border-teal-500/60 rounded-2xl p-4 flex items-center justify-between gap-4 animate-pulse shadow-xl shadow-teal-500/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-bounce">🔔</span>
                <div>
                  <h4 className="font-bold text-white text-sm sm:text-base flex items-center gap-2">
                    {lang === "ur" ? `نیا ریسکیو آپریشن الرٹ: ${newOpAlert.location}` : `NEW RESCUE OPERATION ALERT: ${newOpAlert.location}`}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/30 text-red-200 border border-red-500/50">
                      {lang === "ur" ? (newOpAlert.risk_level === "High" ? "زیادہ خطرہ" : newOpAlert.risk_level === "Medium" ? "درمیانہ خطرہ" : "کم خطرہ") : `${newOpAlert.risk_level} Risk`}
                    </span>
                  </h4>
                  <p className="text-xs text-muted mt-0.5">
                    {lang === "ur" ? <>تفویض کردہ: <strong className="text-teal-300">{newOpAlert.assigned_team || "ریسکیو ٹیم الفا"}</strong> · ریئل ٹائم الرٹ۔</> : <>Assigned to: <strong className="text-teal-300">{newOpAlert.assigned_team || "Rescue Team Alpha"}</strong> · Real-time team notification broadcast.</>}
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
                >{lang === "ur" ? "آپریشن دیکھیں" : "View Operation"}</button>
                <button
                  onClick={() => setNewOpAlert(null)}
                  className="text-muted hover:text-white text-sm px-2 py-1"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Metrics summary banner */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
            <div className="dashboard-card p-4 text-center border-teal-500/50 bg-teal-950/25 shadow-md shadow-teal-950/30">
              <div className="font-display text-2xl text-teal-300 font-bold">{myActiveCount}</div>
              <div className="eyebrow text-teal-400 text-[11px] mt-1 font-bold">🎯 {lang === "ur" ? "میرے مشنز" : "My Missions"}</div>
            </div>
            <div className="dashboard-card p-4 text-center">
              <div className="font-display text-2xl text-parchment">{totalActive}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">{lang === "ur" ? "فعال آپریشنز" : "Active Operations"}</div>
            </div>
            <div className="dashboard-card p-4 text-center border-red-500/30">
              <div className="font-display text-2xl text-red-400">{highRiskActive}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">{lang === "ur" ? "زیادہ خطرہ ترجیح" : "High Risk Priority"}</div>
            </div>
            <div className="dashboard-card p-4 text-center border-teal-500/30">
              <div className="font-display text-2xl text-teal-400">{inProgressCount}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">{lang === "ur" ? "جاری آپریشنز" : "In Progress"}</div>
            </div>
            <div className="dashboard-card p-4 text-center border-emerald-500/30">
              <div className="font-display text-2xl text-emerald-400">{completedCount}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">{lang === "ur" ? "مکمل شدہ" : "Completed"}</div>
            </div>
            <div className="dashboard-card p-4 text-center border-marigold-500/30 col-span-2 md:col-span-1">
              <div className="font-display text-2xl text-marigold-400">{totalRescued}</div>
              <div className="eyebrow text-muted text-[11px] mt-1">{lang === "ur" ? "بچائے گئے شہری" : "Citizens Rescued"}</div>
            </div>
          </div>

          {/* Navigation: Active Operations vs Map vs Past Operations Log */}
          <div className="flex flex-wrap gap-2 mb-6 border-b border-white/10 pb-1">
            <button
              onClick={() => setActiveTab("active")}
              className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "active"
                  ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                  : "text-muted hover:text-parchment hover:bg-white/5"
              }`}
            >
              <span>⚡ {lang === "ur" ? "فعال آپریشنز" : "Active Operations"}</span>
              {totalActive > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-teal-500 text-white text-[10px] font-bold">
                  {totalActive}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("map")}
              className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "map"
                  ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                  : "text-muted hover:text-parchment hover:bg-white/5"
              }`}
            >
              <span>🗺️ {lang === "ur" ? "آپریشنز نقشہ اور سہولیات" : "Operations Map & Facilities"}</span>
            </button>

            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "history"
                  ? "bg-white/10 text-teal-300 border-b-2 border-teal-400"
                  : "text-muted hover:text-parchment hover:bg-white/5"
              }`}
            >
              <span>📜 {lang === "ur" ? "ماضی کے آپریشنز لاگ" : "Past Operations Log"}</span>
              {completedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                  {completedCount}
                </span>
              )}
            </button>
          </div>

          {/* ============================================================== */}
          {/* TAB 1: ACTIVE OPERATIONS                                       */}
          {/* ============================================================== */}
          {activeTab === "active" && (
            <div>
              {/* Risk-Based Prioritization & Filter Toolbar */}
              <div className="dashboard-card p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Scope Switcher */}
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-ink border border-white/15">
                    <button
                      type="button"
                      onClick={() => setScopeFilter("my")}
                      className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                        scopeFilter === "my"
                          ? "bg-teal-500 text-ink shadow-sm"
                          : "text-muted hover:text-white"
                      }`}
                    >
                      🎯 {lang === "ur" ? `میرے مشنز (${myActiveCount})` : `My Missions (${myActiveCount})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeFilter("all")}
                      className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all ${
                        scopeFilter === "all"
                          ? "bg-teal-500 text-ink shadow-sm"
                          : "text-muted hover:text-white"
                      }`}
                    >
                      🌐 {lang === "ur" ? `تمام آپریشنز (${totalActive})` : `All Operations (${totalActive})`}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted font-medium">{lang === "ur" ? "خطرے کی ترجیح:" : "Risk Priority:"}</span>
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
                        {level === "High" ? (lang === "ur" ? "🔴 زیادہ" : "🔴 High") : level === "Medium" ? (lang === "ur" ? "🟡 درمیانہ" : "🟡 Medium") : level === "Low" ? (lang === "ur" ? "🟢 کم" : "🟢 Low") : (lang === "ur" ? "تمام خطرات" : "All Risks")}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                    <span className="text-xs text-muted font-medium">{lang === "ur" ? "حیثیت:" : "Status:"}</span>
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
                        {st === "All" ? (lang === "ur" ? "سب" : "All") : st === "Assigned" ? (lang === "ur" ? "تفویض شدہ" : "Assigned") : (lang === "ur" ? "جاری ہے" : "In Progress")}</button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-teal-400"></span>
                  <span>{lang === "ur" ? "خطرے کی شدت کے مطابق ترتیب (زیادہ ترجیح پہلے)" : "Sorted by Risk Severity (High Priority First)"}</span>
                </div>
              </div>

              {/* Active Operations List */}
              {loading ? (
                <div className="text-center py-16 text-muted">
                  <span className="w-5 h-5 rounded-full border-2 border-teal-300 border-t-transparent animate-spin inline-block mr-2"></span>
                  {lang === "ur" ? "فعال ریسکیو آپریشنز لوڈ ہو رہے ہیں..." : "Loading active rescue operations..."}
                </div>
              ) : activeOperations.length === 0 ? (
                <div className="dashboard-card p-12 text-center text-muted">
                  <div className="text-4xl mb-3">{scopeFilter === "my" ? "🛡️" : "📋"}</div>
                  <p className="text-base font-semibold text-parchment mb-2">
                    {scopeFilter === "my"
                      ? (lang === "ur" ? `کوئی مشن تفویض نہیں ہے، ${currentUserName || "ریسکیو ورکر"}` : `No Missions Assigned to You, ${currentUserName || "Rescue Worker"}`)
                      : (lang === "ur" ? "موجودہ فلٹرز سے مطابقت رکھنے والا کوئی فعال ریسکیو آپریشن موجود نہیں۔" : "No active rescue operations matching current filters.")}
                  </p>
                  <p className="text-xs max-w-md mx-auto mb-4">
                    {scopeFilter === "my"
                      ? (lang === "ur" ? "جب سرکاری اہلکار کوئی آپریشن آپ کے نام پر تفویض کریں گے تو وہ یہاں ظاہر ہوگا۔ آپ نیچے دیے گئے بٹن سے تمام ٹیم آپریشنز دیکھ سکتے ہیں۔" : "When a Government Official or Admin assigns an operation to your name, it will appear here immediately. You can view all team operations below.")
                      : (lang === "ur" ? "ریسکیو آپریشنز سرکاری اہلکار یا ایڈمن اپنے ڈیش بورڈز سے بناتے اور تفویض کرتے ہیں۔" : "Rescue operations are created and assigned by the Government Official or Admin from their respective dashboards.")}
                  </p>
                  {scopeFilter === "my" && totalActive > 0 && (
                    <button
                      type="button"
                      onClick={() => setScopeFilter("all")}
                      className="btn-secondary text-xs py-2 px-4 inline-flex items-center gap-1.5"
                    >
                      🌐 {lang === "ur" ? `تمام ٹیم آپریشنز دیکھیں (${totalActive})` : `View All Team Operations (${totalActive})`}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4 max-h-[520px] overflow-y-auto pr-2 table-scrollbar">
                  {activeOperations.map((op) => {
                    const assignedToMe = isAssignedToMe(op);
                    return (
                    <div
                      key={op.id}
                      className={`dashboard-card p-5 border-l-4 transition-all duration-200 ${
                        assignedToMe
                          ? "ring-1 ring-emerald-500/50 bg-gradient-to-r from-emerald-950/20 via-ink-soft to-ink shadow-lg shadow-emerald-950/30"
                          : ""
                      } ${
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

                            {/* Personal Assignment Badge */}
                            {assignedToMe ? (
                              <span className="text-xs px-2.5 py-0.5 rounded-full border font-bold bg-emerald-500/25 border-emerald-400 text-emerald-300 flex items-center gap-1.5 shadow-sm shadow-emerald-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                ⭐ {lang === "ur" ? "آپ کو تفویض کردہ" : "Assigned to You"}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-muted bg-white/5">
                                👥 {lang === "ur" ? "ٹیم مشن" : "Team Mission"}
                              </span>
                            )}

                            {/* Status Badge */}
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${
                              op.status === "In Progress"
                                ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                : "bg-amber-500/20 border-amber-500/50 text-amber-300"
                            }`}>
                              {op.status === "In Progress" ? (lang === "ur" ? "جاری ہے" : "In Progress") : op.status === "Assigned" ? (lang === "ur" ? "تفویض شدہ" : "Assigned") : op.status === "Completed" ? (lang === "ur" ? "مکمل" : "Completed") : op.status}
                            </span>

                            {/* Risk Priority Badge */}
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${
                              op.risk_level === "High" ? "bg-red-500/20 text-red-300 border-red-500/50" :
                              op.risk_level === "Medium" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/50" :
                              "bg-green-500/20 text-green-300 border-green-500/50"
                            }`}>
                              {op.risk_level === "High" ? (lang === "ur" ? "🔴 زیادہ خطرہ ترجیح" : "🔴 High Risk Priority") : op.risk_level === "Medium" ? (lang === "ur" ? "🟡 درمیانہ خطرہ" : "🟡 Medium Risk") : (lang === "ur" ? "🟢 کم خطرہ" : "🟢 Low Risk")}
                            </span>

                            {/* Prioritize dropdown on card */}
                            <div className="flex items-center gap-1 ml-auto">
                              <span className="text-[10px] text-muted">{lang === "ur" ? "ترجیح:" : "Priority:"}</span>
                              <select
                                value={op.risk_level || "Medium"}
                                onChange={(e) => handleReprioritizeRisk(op.id, e.target.value)}
                                className="text-[11px] bg-white/5 border border-white/20 rounded px-2 py-0.5 text-muted hover:text-white focus:outline-none"
                                title="Reprioritize operation risk level"
                              >
                                <option value="High" className="bg-ink text-red-300">{lang === "ur" ? "🔴 زیادہ خطرہ" : "🔴 High Risk"}</option>
                                <option value="Medium" className="bg-ink text-yellow-300">{lang === "ur" ? "🟡 درمیانہ خطرہ" : "🟡 Medium Risk"}</option>
                                <option value="Low" className="bg-ink text-green-300">{lang === "ur" ? "🟢 کم خطرہ" : "🟢 Low Risk"}</option>
                              </select>
                            </div>
                          </div>

                          {/* Description & Team Assignment */}
                          {op.description && <p className="text-sm text-parchment/90 mb-2">{op.description}</p>}
                          <p className="text-xs text-muted">
                            {lang === "ur" ? <>تفویض کردہ ٹیم: <strong className="text-teal-300">{op.assigned_team || (lang === "ur" ? "غیر تفویض شدہ" : "Unassigned")}</strong> · روانہ کیا گیا: {new Date(op.created_at).toLocaleString("ur-PK")}</> : <>Assigned Team: <strong className="text-teal-300">{op.assigned_team || "Unassigned"}</strong> · Dispatched: {new Date(op.created_at).toLocaleString()}</>}
                          </p>

                          {/* Progress Update Log / SITREP */}
                          {op.update_log && (Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).length > 0 && (
                            <div className="mt-3 bg-white/[0.03] rounded-lg p-2.5 text-xs text-muted space-y-1 max-h-24 overflow-y-auto">
                              <span className="font-semibold text-white text-[11px] block mb-1">{lang === "ur" ? "پیشرفت لاگ:" : "Progress SITREP Log:"}</span>
                              {(Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]")).map((entry, idx) => (
                                <p key={idx}>
                                  <span className="opacity-60">{new Date(entry.timestamp).toLocaleTimeString()}:</span> {entry.note}
                                </p>
                              ))}
                            </div>
                          )}

                          {/* Add Note Input */}
                          <div className="flex items-center gap-2 mt-3">
                            <input
                              value={noteInputs[op.id] || ""}
                              onChange={(e) => setNoteInputs((prev) => ({ ...prev, [op.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(op.id); }}
                              placeholder={lang === "ur" ? "پیشرفت نوٹ درج کریں..." : "Add progress update / SITREP note..."}
                              className="field-input text-xs py-1.5 flex-1"
                            />
                            <button
                              onClick={() => handleAddNote(op.id)}
                              className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                            >{lang === "ur" ? "اپڈیٹ بھیجیں" : "Post Update"}</button>
                          </div>
                        </div>

                        {/* Status Action Buttons */}
                        <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/10">
                          {/* Mark Completed */}
                          <button
                            onClick={() => handleUpdateStatus(op.id, "Completed")}
                            className="bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg transition-colors shadow-sm flex items-center gap-1.5 w-full justify-center"
                          >{lang === "ur" ? "✅ مکمل نشان زد کریں" : "✅ Mark Completed"}</button>

                          <button
                            onClick={() => handlePrintOperation(op)}
                            className="text-xs text-muted hover:text-teal-300 transition-colors py-1"
                          >{lang === "ur" ? "🖨️ رپورٹ پرنٹ کریں" : "🖨️ Print Report"}</button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: INTERACTIVE OPERATIONS MAP & FACILITIES (FR-04)         */}
          {/* ============================================================== */}
          {activeTab === "map" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <span className="eyebrow text-teal-400 text-xs font-semibold">{lang === "ur" ? "جغرافیائی آپریشنز سینٹر" : "Geospatial Operations Center"}</span>
                    <h2 className="font-display text-2xl text-parchment">🗺️ {lang === "ur" ? "لائیو انٹرایکٹو آپریشنز نقشہ" : "Live Interactive Operations Map"}</h2>
                    <p className="text-xs text-muted mt-0.5">
                      {lang === "ur" ? "پاکستان بھر میں جاری ریسکیو آپریشنز، امدادی کیمپوں، ہسپتالوں اور بند سڑکوں کا لائیو نقشہ۔" : "Real-time interactive map showing ongoing rescue operations, emergency relief shelters, hospitals, and road blockages across Pakistan."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 font-medium">
                      ● {lang === "ur" ? "فعال مشنز" : "Active Missions"}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
                      ● {t("shelters")}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30 font-medium">
                      ● {t("hospitals")}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/30 font-medium">
                      ● {lang === "ur" ? "بند سڑکیں" : "Blocked Roads"}
                    </span>
                  </div>
                </div>

                <FloodMap height={540} canEdit={true} />
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: PAST OPERATIONS LOG & REPORTS                           */}
          {/* ============================================================== */}
          {activeTab === "history" && (
            <div className="dashboard-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <p className="eyebrow text-teal-400 mb-1">{lang === "ur" ? "سرکاری رجسٹر اور آڈٹ لاگ" : "Official Registry & Audit Log"}</p>
                  <h2 className="font-display text-2xl text-parchment">{lang === "ur" ? "ماضی کے ریسکیو آپریشنز لاگ" : "Past Rescue Operations Log"}</h2>
                  <p className="text-xs text-muted mt-0.5">{lang === "ur" ? "حکومتی رپورٹنگ کے لیے تمام مکمل شدہ ریسکیو مشنز کا جامع آڈٹ لاگ۔" : "Comprehensive audit log of all completed rescue missions for government reporting."}</p>
                </div>
                <button
                  onClick={exportPastOperationsCSV}
                  className="bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                >{lang === "ur" ? "📥 رپورٹنگ لاگ ایکسپورٹ کریں (CSV)" : "📥 Export Reporting Log (CSV)"}</button>
              </div>

              {/* Search & Risk Filter Toolbar */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-4 border-t border-white/10 mb-6">
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder={lang === "ur" ? "شہر، ٹیم، نوٹس یا وسائل سے تلاش کریں..." : "Search past operations by city, team, notes, resources..."}
                  className="field-input sm:max-w-md text-sm py-2"
                />
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted">{lang === "ur" ? "خطرے کا فلٹر:" : "Risk Filter:"}</span>
                  {["All", "High", "Medium", "Low"].map((level) => (
                    <button
                      key={level}
                      onClick={() => setHistoryRiskFilter(level)}
                      className={`text-xs px-3 py-1 rounded-full border font-semibold transition-colors ${
                        historyRiskFilter === level
                          ? "bg-teal-500/25 border-teal-500 text-teal-300"
                          : "bg-white/5 border-white/10 text-muted hover:border-white/20"
                      }`}
                    >{level === "All" ? (lang === "ur" ? "سب" : "All") : level === "High" ? (lang === "ur" ? "زیادہ" : "High") : level === "Medium" ? (lang === "ur" ? "درمیانہ" : "Medium") : (lang === "ur" ? "کم" : "Low")}</button>
                  ))}
                </div>
              </div>

              {/* Historical Operations Table */}
              {pastOperations.length === 0 ? (
                <div className="text-center py-12 text-muted bg-white/[0.02] rounded-xl border border-white/5">
                  <p className="text-base font-medium">{lang === "ur" ? "آپ کے فلٹر سے مطابقت رکھنے والا کوئی ماضی کا آپریشن نہیں ملا۔" : "No past rescue operations found matching your filter."}</p>
                  <p className="text-xs mt-1">{lang === "ur" ? "مکمل شدہ ریسکیو آپریشنز مکمل رپورٹنگ ریکارڈ کے ساتھ یہاں ظاہر ہوں گے۔" : "Completed rescue operations will automatically appear here with full reporting records."}</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-xl border border-white/10 p-2 table-scrollbar">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-[#071326] z-10 shadow-sm">
                      <tr className="border-b border-white/20 text-muted text-xs">
                        <th className="pb-3 font-semibold">{lang === "ur" ? "مشن آئی ڈی" : "Mission ID"}</th>
                        <th className="pb-3 font-semibold">{t("location")}</th>
                        <th className="pb-3 font-semibold">{lang === "ur" ? "خطرے کی ترجیح" : "Risk Priority"}</th>
                        <th className="pb-3 font-semibold">{lang === "ur" ? "تفویض کردہ ٹیم" : "Assigned Team"}</th>
                        <th className="pb-3 font-semibold">{lang === "ur" ? "بچائے گئے افراد" : "Rescued"}</th>
                        <th className="pb-3 font-semibold">{lang === "ur" ? "استعمال شدہ وسائل" : "Resources Used"}</th>
                        <th className="pb-3 font-semibold">{lang === "ur" ? "مکمل ہونے کی تاریخ" : "Completed Date"}</th>
                        <th className="pb-3 font-semibold text-right">{t("actions")}</th>
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
          {/* MODAL: MARK OPERATION AS COMPLETED                             */}
          {/* ============================================================== */}
          {completionModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
              <form onSubmit={handleCompleteOperation} className="dashboard-card p-6 max-w-lg w-full border border-emerald-500/40">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="eyebrow text-emerald-400 text-xs font-semibold">{lang === "ur" ? "سرکاری مشن اختتامی تصدیق" : "Official Mission Sign-Off"}</span>
                    <h2 className="font-display text-2xl text-parchment">{lang === "ur" ? "آپریشن مکمل نشان زد کریں" : "Mark Operation Completed"}</h2>
                    <p className="text-xs text-muted mt-0.5">Location: <strong className="text-white">{completionModal.location}</strong></p>
                  </div>
                  <button type="button" onClick={() => setCompletionModal(null)} className="text-muted hover:text-white text-lg">✕</button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="field-label text-xs">{lang === "ur" ? "بچائے گئے افراد کی تعداد" : "Number of People Rescued"}</label>
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
                    <label className="field-label text-xs">{lang === "ur" ? "تعینات / استعمال شدہ وسائل" : "Resources Deployed / Used"}</label>
                    <input
                      type="text"
                      placeholder={lang === "ur" ? "مثلاً 2 کشتیاں، 3 ایمبولینسز، 50 لائف جیکٹس" : "e.g. 2 Inflatable Boats, 3 Ambulances, 50 Lifejackets"}
                      value={completionForm.resources_used}
                      onChange={(e) => setCompletionForm((prev) => ({ ...prev, resources_used: e.target.value }))}
                      className="field-input text-sm py-2"
                    />
                  </div>

                  <div>
                    <label className="field-label text-xs">{lang === "ur" ? "حتمی رپورٹ اور نوٹس" : "Final Completion Report & Notes"}</label>
                    <textarea
                      rows={3}
                      placeholder={lang === "ur" ? "آپریشن کے نتائج، انخلا کیمپوں میں منتقلی وغیرہ کی تفصیل درج کریں..." : "Summarize operation outcomes, safe evacuation shelters transferred to, etc."}
                      value={completionForm.completion_notes}
                      onChange={(e) => setCompletionForm((prev) => ({ ...prev, completion_notes: e.target.value }))}
                      className="field-input text-sm py-2 resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button type="submit" className="bg-emerald-600/90 hover:bg-emerald-500 text-white font-semibold flex-1 py-2 text-sm rounded-lg transition-colors shadow-lg shadow-emerald-600/20">{lang === "ur" ? "تصدیق کریں اور مکمل نشان زد کریں" : "Sign Off & Mark Completed"}</button>
                  <button type="button" onClick={() => setCompletionModal(null)} className="btn-secondary py-2 text-sm">{t("cancel")}</button>
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
