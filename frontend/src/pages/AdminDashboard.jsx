import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import FloodMap from '../components/FloodMap';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";
import { formatAlertDateTime } from "../utils/alertDateTime";

const PRIORITY_SCORE = { High: 3, Medium: 2, Low: 1 };

export default function AdminDashboard() {
  const { t, lang } = useLanguage();

  // Active navigation tab
  const [activeSection, setActiveSection] = useState('overview');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Logged-in admin credentials from localStorage
  const currentLoggedInEmail = (localStorage.getItem("userEmail") || "").toLowerCase().trim();
  const currentLoggedInId = localStorage.getItem("userId");
  const currentUserName = localStorage.getItem("userName") || "System Administrator";

  // Core Data States
  const [users, setUsers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [communityReports, setCommunityReports] = useState([]);
  const [rescueOps, setRescueOps] = useState([]);
  const [accuracyHistory, setAccuracyHistory] = useState([]);
  const [confidenceTrend, setConfidenceTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter States
  const [userSearch, setUserSearch] = useState("");
  const [shelterSearch, setShelterSearch] = useState("");
  const [hospitalSearch, setHospitalSearch] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportStatusFilter, setReportStatusFilter] = useState("All");
  const [reportSeverityFilter, setReportSeverityFilter] = useState("All");
  const [predictionFilters, setPredictionFilters] = useState({ risk: "All", from: "", to: "" });

  // Rescue filters & tabs
  const [rescueRiskFilter, setRescueRiskFilter] = useState("All");
  const [rescueStatusFilter, setRescueStatusFilter] = useState("All");
  const [rescueHistorySearch, setRescueHistorySearch] = useState("");
  const [rescueHistoryRiskFilter, setRescueHistoryRiskFilter] = useState("All");
  const [rescueActiveTab, setRescueActiveTab] = useState("active"); // "active" | "history"

  // Alerts sub-tab: "active" | "history"
  const [alertTab, setAlertTab] = useState("active");

  // Modals & Form States
  // 1. User Management
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "citizen" });

  // 2. Emergency Alerts
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState(null);
  const [savingAlert, setSavingAlert] = useState(false);
  const [newAlert, setNewAlert] = useState({ message: "", location: "", risk: "High" });

  // 3. Rescue Operations
  const [showCreateRescueModal, setShowCreateRescueModal] = useState(false);
  const [createRescueForm, setCreateRescueForm] = useState({
    location: "",
    description: "",
    risk_level: "High",
    assigned_team: "",
  });
  const [rescueNoteInputs, setRescueNoteInputs] = useState({});
  const [completionModal, setCompletionModal] = useState(null); // { opId, location }
  const [completionForm, setCompletionForm] = useState({
    people_rescued: "",
    resources_used: "",
    completion_notes: "",
  });

  // 4. Citizen Reports Moderation
  const [assigningReportId, setAssigningReportId] = useState(null);
  const [assignReportWorkerChoice, setAssignReportWorkerChoice] = useState("");

  // 5. Manage Shelters
  const [showShelterForm, setShowShelterForm] = useState(false);
  const [newShelter, setNewShelter] = useState({ name: "", address: "", capacity: "", contact: "" });
  const [editingShelter, setEditingShelter] = useState(null);

  // 6. Manage Hospitals
  const [showHospitalForm, setShowHospitalForm] = useState(false);
  const [newHospital, setNewHospital] = useState({ name: "", address: "", contact: "", services: "" });
  const [editingHospital, setEditingHospital] = useState(null);

  // 7. XAI Explanation Inspector Modal
  const [selectedPredictionXAI, setSelectedPredictionXAI] = useState(null);

  // 8. AI Model Retrain
  const [retrainFile, setRetrainFile] = useState(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainResult, setRetrainResult] = useState(null);

  // 9. Run Prediction Form (Admin)
  const [predForm, setPredForm] = useState({
    location: '', rainfall: '', river_level: '', temperature: '',
    humidity: '', wind_speed: '', soil_moisture_top: '', soil_7day_avg: ''
  });
  const [predRunning, setPredRunning] = useState(false);
  const [predResult, setPredResult] = useState(null); // latest result to show inline

  // Feedback Notification Banner
  const [adminFeedback, setAdminFeedback] = useState("");

  const showNotification = (msg) => {
    setAdminFeedback(msg);
    setTimeout(() => setAdminFeedback(""), 4500);
  };

  // Initial Load & Auto-Refresh
  useEffect(() => {
    fetchAllData();
    const interval = setInterval(() => {
      fetchAlerts();
      fetchCommunityReports();
      fetchRescueOps();
      fetchShelters();
      fetchHospitals();
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchUsers(),
      fetchAlerts(),
      fetchPredictions(),
      fetchShelters(),
      fetchHospitals(),
      fetchCommunityReports(),
      fetchRescueOps(),
      fetchAccuracyHistory(),
      fetchConfidenceTrend(),
    ]);
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users`);
      setUsers(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/alerts`);
      setAlerts(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchPredictions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/predictions`);
      setPredictions(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchShelters = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shelters`);
      setShelters(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchHospitals = async () => {
    try {
      const res = await axios.get(`${API_BASE}/hospitals`);
      setHospitals(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchCommunityReports = async () => {
    try {
      const res = await axios.get(`${API_BASE}/community-reports`);
      setCommunityReports(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchRescueOps = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations`);
      setRescueOps(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchAccuracyHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/accuracy-history`);
      setAccuracyHistory(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchConfidenceTrend = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/confidence-trend`);
      setConfidenceTrend(res.data || []);
    } catch (err) { console.error(err); }
  };

  // =========================================================================
  // 1. USER MANAGEMENT
  // (Admin account and current logged-in user are strictly excluded from list)
  // =========================================================================
  const handleCreateUser = async (e) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(newUser.email.trim())) {
      alert("Please provide a valid email address.");
      return;
    }
    if (newUser.password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    try {
      await axios.post(`${API_BASE}/users`, {
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      });
      setShowCreateUser(false);
      setNewUser({ name: "", email: "", password: "", role: "citizen" });
      fetchUsers();
      showNotification("User account created successfully!");
    } catch (err) {
      alert(err.response?.data?.message || err.response?.data?.error || "Failed to create user.");
    }
  };

  const handleToggleUserStatus = async (user) => {
    const isCurrentlyActive = user.status === "Active" || user.active !== false;
    const nextStatus = isCurrentlyActive ? "Inactive" : "Active";
    try {
      await axios.put(`${API_BASE}/users/${user.id}/status`, { status: nextStatus, active: !isCurrentlyActive });
      fetchUsers();
      showNotification(`User "${user.name}" marked as ${nextStatus}.`);
    } catch (err) {
      alert("Failed to update user status.");
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm("Are you sure you want to permanently delete this user account?")) return;
    try {
      await axios.delete(`${API_BASE}/users/${id}`);
      fetchUsers();
      showNotification("User account deleted.");
    } catch (err) {
      alert("Failed to delete user.");
    }
  };

  // Filtered Users: Strictly excludes admin accounts and currently logged-in account
  const filteredUsers = useMemo(() => {
    const nonAdminUsers = users.filter((u) => {
      if (u.role === "admin") return false;
      if (currentLoggedInEmail && (u.email || "").toLowerCase().trim() === currentLoggedInEmail) return false;
      if (currentLoggedInId && String(u.id) === String(currentLoggedInId)) return false;
      // Keep only the single designated government official account (govofficial@gmail.com)
      if (u.role === "government_official" && (u.email || "").toLowerCase().trim() !== "govofficial@gmail.com") return false;
      return true;
    });
    const q = userSearch.trim().toLowerCase();
    if (!q) return nonAdminUsers;
    return nonAdminUsers.filter((u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q)
    );
  }, [users, userSearch, currentLoggedInEmail, currentLoggedInId]);

  // =========================================================================
  // 2. ALERT AND NOTIFICATION SYSTEM
  // =========================================================================
  const handleCreateAlert = async (e) => {
    e.preventDefault();
    if (savingAlert) return;
    setSavingAlert(true);
    try {
      if (editingAlertId !== null) {
        await axios.put(`${API_BASE}/alerts/${editingAlertId}`, {
          message: newAlert.message.trim(),
          location: newAlert.location.trim(),
          risk_level: newAlert.risk,
        });
        showNotification("Active Alert updated successfully!");
      } else {
        await axios.post(`${API_BASE}/alerts`, {
          message: newAlert.message.trim(),
          location: newAlert.location.trim(),
          risk: newAlert.risk,
          risk_level: newAlert.risk,
          status: "Active"
        });
        showNotification("Emergency Alert manually triggered & broadcast!");
      }
      setShowAlertModal(false);
      setEditingAlertId(null);
      setNewAlert({ message: "", location: "", risk: "High" });
      fetchAlerts();
    } catch (err) {
      alert(err.response?.data?.message || err.response?.data?.error || "Failed to save alert.");
    } finally {
      setSavingAlert(false);
    }
  };

  const handleEditAlert = (alertItem) => {
    setEditingAlertId(alertItem.id);
    setNewAlert({
      message: alertItem.message || "",
      location: alertItem.location || "",
      risk: alertItem.risk_level || alertItem.risk || "High",
    });
    setShowAlertModal(true);
  };

  const handleCancelAlert = async (id) => {
    if (!confirm("Are you sure you want to cancel this active alert?")) return;
    try {
      await axios.put(`${API_BASE}/alerts/${id}`, { status: "Cancelled" });
      showNotification("Active alert marked as Cancelled.");
      fetchAlerts();
    } catch (err) {
      alert("Failed to cancel alert.");
    }
  };

  const handleDeleteAlert = async (id) => {
    if (!confirm("Are you sure you want to remove this alert record?")) return;
    try {
      await axios.delete(`${API_BASE}/alerts/${id}`);
      showNotification("Alert record removed.");
      fetchAlerts();
    } catch (err) {
      alert("Failed to delete alert.");
    }
  };

  // Active Alerts vs Alert History
  const activeAlertsList = useMemo(() => {
    return alerts.filter(a => a.status !== "Cancelled" && a.status !== "Resolved");
  }, [alerts]);

  const alertHistoryList = useMemo(() => {
    return [...alerts].sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp));
  }, [alerts]);

  // =========================================================================
  // 3. RESCUE OPERATIONS COORDINATION
  // =========================================================================
  const handleCreateRescueOperation = async (e) => {
    e.preventDefault();
    if (!createRescueForm.location.trim()) return;
    try {
      const res = await axios.post(`${API_BASE}/rescue-operations`, {
        location: createRescueForm.location.trim(),
        description: createRescueForm.description.trim(),
        risk_level: createRescueForm.risk_level,
        assigned_team: createRescueForm.assigned_team || "Rescue Team Alpha",
      });
      setCreateRescueForm({ location: "", description: "", risk_level: "High", assigned_team: "" });
      setShowCreateRescueModal(false);
      showNotification(`Rescue operation created and dispatched to ${res.data.assigned_team}!`);
      fetchRescueOps();
    } catch (err) {
      alert("Failed to create rescue operation.");
    }
  };

  const handleUpdateRescueStatus = async (opId, newStatus) => {
    if (newStatus === "Completed") {
      const targetOp = rescueOps.find((o) => o.id === opId);
      setCompletionForm({ people_rescued: "", resources_used: "", completion_notes: "" });
      setCompletionModal({ opId, location: targetOp?.location || "Operation" });
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, { status: newStatus });
      showNotification(`Operation status updated to "${newStatus}".`);
      fetchRescueOps();
    } catch (err) {
      alert("Failed to update operation status.");
    }
  };

  const handleReprioritizeRescueRisk = async (opId, newRiskLevel) => {
    try {
      const targetOp = rescueOps.find((o) => o.id === opId);
      if (!targetOp) return;
      await axios.put(`${API_BASE}/rescue-operations/${opId}/status`, {
        status: targetOp.status,
        risk_level: newRiskLevel,
      });
      showNotification(`Operation priority updated to ${newRiskLevel} Risk.`);
      fetchRescueOps();
    } catch (err) {
      alert("Failed to update operation priority.");
    }
  };

  const handleAddRescueNote = async (opId) => {
    const note = (rescueNoteInputs[opId] || "").trim();
    if (!note) return;
    try {
      await axios.post(`${API_BASE}/rescue-operations/${opId}/note`, { note });
      setRescueNoteInputs((prev) => ({ ...prev, [opId]: "" }));
      showNotification(`SITREP note logged for Operation #${opId}.`);
      fetchRescueOps();
    } catch (err) {
      alert("Failed to post progress note.");
    }
  };

  const handleCompleteRescueOperation = async (e) => {
    e.preventDefault();
    if (!completionModal) return;
    try {
      await axios.put(`${API_BASE}/rescue-operations/${completionModal.opId}/status`, {
        status: "Completed",
        people_rescued: completionForm.people_rescued ? parseInt(completionForm.people_rescued, 10) || 0 : 0,
        resources_used: completionForm.resources_used,
        completion_notes: completionForm.completion_notes,
      });
      showNotification(`Operation at ${completionModal.location} officially marked as Completed!`);
      setCompletionModal(null);
      fetchRescueOps();
    } catch (err) {
      alert("Failed to complete rescue operation.");
    }
  };

  const handleDeleteRescueOp = async (opId) => {
    if (!confirm("Are you sure you want to delete this rescue mission record?")) return;
    try {
      await axios.delete(`${API_BASE}/rescue-operations/${opId}`);
      showNotification("Rescue operation record deleted.");
      fetchRescueOps();
    } catch (err) {
      alert("Failed to delete rescue operation.");
    }
  };

  const handlePrintRescueOperation = (op) => {
    const updateLog = Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${op.location} — Rescue Mission Report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #111; max-width: 720px; margin: 0 auto; line-height: 1.5; }
        h1 { border-bottom: 2px solid #0d9488; padding-bottom: 8px; color: #0f766e; }
        .meta { color: #4b5563; font-size: 14px; margin-bottom: 20px; background: #f3f4f6; padding: 12px; border-radius: 8px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .badge-high { background: #fee2e2; color: #991b1b; }
        .badge-med { background: #fef3c7; color: #92400e; }
        .badge-low { background: #d1fae5; color: #065f46; }
        .section { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
        h3 { color: #1f2937; margin-bottom: 6px; }
        ul { margin: 6px 0; padding-left: 20px; }
      </style></head><body>
        <h1>Flood Rescue Mission Incident Report</h1>
        <div class="meta">
          <p><strong>Operation ID:</strong> #${op.id} &nbsp;|&nbsp; <strong>Location:</strong> ${op.location}</p>
          <p><strong>Risk Level:</strong> <span class="badge ${op.risk_level === 'High' ? 'badge-high' : op.risk_level === 'Medium' ? 'badge-med' : 'badge-low'}">${op.risk_level} Priority</span> &nbsp;|&nbsp; <strong>Assigned Team:</strong> ${op.assigned_team || "Unassigned"}</p>
          <p><strong>Status:</strong> ${op.status} &nbsp;|&nbsp; <strong>Created:</strong> ${new Date(op.created_at).toLocaleString()}${op.completed_at ? " &nbsp;|&nbsp; <strong>Completed:</strong> " + new Date(op.completed_at).toLocaleString() : ""}</p>
        </div>
        ${op.description ? `<div class="section"><h3>Mission Description</h3><p>${op.description}</p></div>` : ""}
        ${op.status === "Completed" ? `
          <div class="section">
            <h3>Completion Sign-Off Results</h3>
            <p><strong>Civilians Rescued:</strong> ${op.people_rescued || 0} individuals</p>
            ${op.resources_used ? `<p><strong>Resources Deployed:</strong> ${op.resources_used}</p>` : ""}
            ${op.completion_notes ? `<p><strong>Final SITREP Notes:</strong> ${op.completion_notes}</p>` : ""}
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

  const exportPastOperationsCSV = () => {
    const completedOps = rescueOps.filter((op) => op.status === "Completed");
    if (completedOps.length === 0) {
      alert("No completed rescue operations found to export.");
      return;
    }
    const headers = [
      "Operation ID", "Location", "Risk Level", "Assigned Team", "Status",
      "Created At", "Completed At", "Duration (Minutes)", "People Rescued", "Resources Used", "Completion Notes"
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
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rescue_operations_log_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    showNotification("Past rescue operations log exported to CSV!");
  };

  // Active Rescue Operations
  const activeRescueOps = useMemo(() => {
    let list = rescueOps.filter((op) => op.status !== "Completed");
    if (rescueRiskFilter !== "All") list = list.filter((op) => op.risk_level === rescueRiskFilter);
    if (rescueStatusFilter !== "All") list = list.filter((op) => op.status === rescueStatusFilter);
    return list.sort((a, b) => {
      const scoreA = PRIORITY_SCORE[a.risk_level] || 0;
      const scoreB = PRIORITY_SCORE[b.risk_level] || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  }, [rescueOps, rescueRiskFilter, rescueStatusFilter]);

  // Past Rescue Operations
  const pastRescueOps = useMemo(() => {
    let list = rescueOps.filter((op) => op.status === "Completed");
    if (rescueHistoryRiskFilter !== "All") list = list.filter((op) => op.risk_level === rescueHistoryRiskFilter);
    const query = rescueHistorySearch.trim().toLowerCase();
    if (query) {
      list = list.filter((op) =>
        (op.location || "").toLowerCase().includes(query) ||
        (op.assigned_team || "").toLowerCase().includes(query) ||
        (op.completion_notes || "").toLowerCase().includes(query) ||
        (op.resources_used || "").toLowerCase().includes(query)
      );
    }
    return list.sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at));
  }, [rescueOps, rescueHistorySearch, rescueHistoryRiskFilter]);

  // =========================================================================
  // 4. COMMUNITY INCIDENT REPORTS
  // =========================================================================
  const handleReportStatus = async (reportId, nextStatus, assignedTeam) => {
    try {
      const payload = { status: nextStatus };
      if (nextStatus === "Action Taken") {
        payload.assigned_team = assignedTeam || "Unassigned";
      }
      const res = await axios.put(`${API_BASE}/community-reports/${reportId}/status`, payload);
      showNotification(
        nextStatus === "Action Taken"
          ? `Action Taken: Rescue operation dispatched to ${res.data?.location || "area"}!`
          : nextStatus === "Resolved"
          ? `Report marked as Resolved successfully!`
          : `Report status updated to "${nextStatus}".`
      );
      fetchCommunityReports();
      fetchRescueOps();
    } catch (err) {
      alert("Failed to update report status.");
    }
  };

  const handleConvertToAlert = async (report) => {
    try {
      await axios.post(`${API_BASE}/alerts`, {
        message: `[Community Report] ${report.type || report.incident_type || "Incident"} at ${report.location}: ${report.description}`,
        location: report.location,
        risk: report.severity || "High",
        risk_level: report.severity || "High",
        status: "Active"
      });
      await handleReportStatus(report.id, "Under Review");
      fetchAlerts();
      showNotification("Emergency Alert created from Citizen Report!");
    } catch (err) {
      alert("Failed to create alert from report.");
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!confirm("Are you sure you want to delete this citizen report?")) return;
    try {
      await axios.delete(`${API_BASE}/community-reports/${reportId}`);
      showNotification("Citizen report deleted.");
      fetchCommunityReports();
    } catch (err) {
      alert("Failed to delete report.");
    }
  };

  const filteredCommunityReports = useMemo(() => {
    return communityReports.filter(r => {
      if (reportStatusFilter !== "All" && r.status !== reportStatusFilter) return false;
      if (reportSeverityFilter !== "All" && r.severity !== reportSeverityFilter) return false;
      if (reportSearch.trim()) {
        const q = reportSearch.toLowerCase();
        const matches = (r.location || "").toLowerCase().includes(q) ||
          (r.authorName || r.author_name || "").toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [communityReports, reportStatusFilter, reportSeverityFilter, reportSearch]);

  // =========================================================================
  // 5. MANAGE SHELTERS
  // =========================================================================
  const handleCreateShelter = async (e) => {
    e.preventDefault();
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (newShelter.contact && !phoneRegex.test(newShelter.contact.trim().replace(/[\s-]/g, ""))) {
      alert("Please provide a valid Pakistani contact phone number.");
      return;
    }
    // Validate duplicate name and address
    const isDup = shelters.some(
      s => (s.name || "").trim().toLowerCase() === newShelter.name.trim().toLowerCase() &&
           (s.address || "").trim().toLowerCase() === newShelter.address.trim().toLowerCase()
    );
    if (isDup) {
      alert("Validation Error: A shelter with this name and address already exists.");
      return;
    }
    try {
      await axios.post(`${API_BASE}/shelters`, newShelter);
      setShowShelterForm(false);
      setNewShelter({ name: "", address: "", capacity: "", contact: "" });
      fetchShelters();
      showNotification("Emergency Shelter registered!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create shelter.");
    }
  };

  const handleUpdateShelter = async (e) => {
    e.preventDefault();
    if (!editingShelter) return;
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (editingShelter.contact && !phoneRegex.test(editingShelter.contact.trim().replace(/[\s-]/g, ""))) {
      alert("Please provide a valid Pakistani contact phone number.");
      return;
    }
    const isDup = shelters.some(
      s => s.id !== editingShelter.id &&
           (s.name || "").trim().toLowerCase() === editingShelter.name.trim().toLowerCase() &&
           (s.address || "").trim().toLowerCase() === editingShelter.address.trim().toLowerCase()
    );
    if (isDup) {
      alert("Validation Error: Another shelter with this name and address already exists.");
      return;
    }
    try {
      await axios.put(`${API_BASE}/shelters/${editingShelter.id}`, editingShelter);
      setEditingShelter(null);
      fetchShelters();
      showNotification("Shelter updated successfully!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update shelter.");
    }
  };

  const handleDeleteShelter = async (id) => {
    if (!confirm("Delete this shelter record?")) return;
    try {
      await axios.delete(`${API_BASE}/shelters/${id}`);
      fetchShelters();
      showNotification("Shelter deleted.");
    } catch (err) {
      alert("Failed to delete shelter.");
    }
  };

  const filteredShelters = useMemo(() => {
    const q = shelterSearch.trim().toLowerCase();
    if (!q) return shelters;
    return shelters.filter(s =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.address || "").toLowerCase().includes(q)
    );
  }, [shelters, shelterSearch]);

  // =========================================================================
  // 6. MANAGE HOSPITALS
  // =========================================================================
  const handleCreateHospital = async (e) => {
    e.preventDefault();
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (newHospital.contact && !phoneRegex.test(newHospital.contact.trim().replace(/[\s-]/g, ""))) {
      alert("Please provide a valid Pakistani contact phone number.");
      return;
    }
    const isDup = hospitals.some(
      h => (h.name || "").trim().toLowerCase() === newHospital.name.trim().toLowerCase() &&
           (h.address || "").trim().toLowerCase() === newHospital.address.trim().toLowerCase()
    );
    if (isDup) {
      alert("Validation Error: A hospital with this name and address already exists.");
      return;
    }
    try {
      await axios.post(`${API_BASE}/hospitals`, newHospital);
      setShowHospitalForm(false);
      setNewHospital({ name: "", address: "", contact: "", services: "" });
      fetchHospitals();
      showNotification("Emergency Hospital registered!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create hospital.");
    }
  };

  const handleUpdateHospital = async (e) => {
    e.preventDefault();
    if (!editingHospital) return;
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (editingHospital.contact && !phoneRegex.test(editingHospital.contact.trim().replace(/[\s-]/g, ""))) {
      alert("Please provide a valid Pakistani contact phone number.");
      return;
    }
    const isDup = hospitals.some(
      h => h.id !== editingHospital.id &&
           (h.name || "").trim().toLowerCase() === editingHospital.name.trim().toLowerCase() &&
           (h.address || "").trim().toLowerCase() === editingHospital.address.trim().toLowerCase()
    );
    if (isDup) {
      alert("Validation Error: Another hospital with this name and address already exists.");
      return;
    }
    try {
      await axios.put(`${API_BASE}/hospitals/${editingHospital.id}`, editingHospital);
      setEditingHospital(null);
      fetchHospitals();
      showNotification("Hospital updated successfully!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update hospital.");
    }
  };

  const handleDeleteHospital = async (id) => {
    if (!confirm("Delete this hospital record?")) return;
    try {
      await axios.delete(`${API_BASE}/hospitals/${id}`);
      fetchHospitals();
      showNotification("Hospital deleted.");
    } catch (err) {
      alert("Failed to delete hospital.");
    }
  };

  const filteredHospitals = useMemo(() => {
    const q = hospitalSearch.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter(h =>
      (h.name || "").toLowerCase().includes(q) ||
      (h.address || "").toLowerCase().includes(q) ||
      (h.services || "").toLowerCase().includes(q)
    );
  }, [hospitals, hospitalSearch]);

  // =========================================================================
  // 7. ML MODEL RETRAINING
  // =========================================================================
  const handleRetrainModel = async (e) => {
    e.preventDefault();
    if (!retrainFile) return;
    setRetraining(true);
    setRetrainResult(null);
    const formData = new FormData();
    formData.append("file", retrainFile);
    try {
      const res = await axios.post(`${API_BASE}/retrain-model`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const acc = res.data.accuracy || 0.85;
      setRetrainResult({
        ok: true,
        message: `Model retrained successfully! Test Classification Accuracy: ${(acc * 100).toFixed(1)}% (Threshold >= 80% achieved)`
      });
      fetchAccuracyHistory();
      fetchConfidenceTrend();
      showNotification("Machine Learning model successfully retrained!");
    } catch (err) {
      setRetrainResult({ ok: false, message: err.response?.data?.message || "Failed to retrain model." });
    } finally {
      setRetraining(false);
    }
  };

  // Run a prediction from admin panel
  const handleRunPrediction = async (e) => {
    e.preventDefault();
    setPredRunning(true);
    setPredResult(null);
    try {
      const payload = { location: predForm.location || 'Unknown' };
      if (predForm.rainfall !== '')      payload.rainfall       = parseFloat(predForm.rainfall);
      if (predForm.river_level !== '')   payload.river_level    = parseFloat(predForm.river_level);
      if (predForm.temperature !== '')   payload.temperature    = parseFloat(predForm.temperature);
      if (predForm.humidity !== '')      payload.humidity       = parseFloat(predForm.humidity);
      if (predForm.wind_speed !== '')    payload.wind_speed     = parseFloat(predForm.wind_speed);
      if (predForm.soil_moisture_top !== '') payload.soil_moisture_top = parseFloat(predForm.soil_moisture_top);
      if (predForm.soil_7day_avg !== '') payload.soil_7day_avg  = parseFloat(predForm.soil_7day_avg);
      const res = await axios.post(`${API_BASE}/predict`, payload);
      setPredResult(res.data);
      fetchPredictions();
      showNotification(`Prediction complete: ${res.data.risk} risk for ${predForm.location || 'Unknown'}`);
    } catch (err) {
      setPredResult({ error: err.response?.data?.message || 'Prediction failed. Check input values.' });
    } finally {
      setPredRunning(false);
    }
  };

  // CSV Export for Predictions
  const downloadPredictionsCSV = () => {
    if (filteredPredictions.length === 0) {
      alert("No prediction records found to export.");
      return;
    }
    const headers = ["Location", "Risk Level", "Confidence", "Rainfall (mm)", "Temperature (C)", "Timestamp"];
    const rows = filteredPredictions.map(p => [
      `"${(p.location || "").replace(/"/g, '""')}"`,
      p.risk,
      p.confidence ? `${Math.round(p.confidence * 100)}%` : "",
      p.rainfall || "",
      p.temperature || "",
      p.created_at ? new Date(p.created_at).toISOString() : ""
    ]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flood_risk_predictions_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    showNotification("Prediction records exported to CSV!");
  };

  const filteredPredictions = useMemo(() => {
    return predictions.filter(p => {
      if (predictionFilters.risk !== "All" && p.risk !== predictionFilters.risk) return false;
      if (predictionFilters.from && new Date(p.created_at) < new Date(predictionFilters.from)) return false;
      if (predictionFilters.to && new Date(p.created_at) > new Date(predictionFilters.to + "T23:59:59")) return false;
      return true;
    });
  }, [predictions, predictionFilters]);

  const rescueWorkersList = useMemo(() => {
    return users.filter(u => u.role === "rescue_worker");
  }, [users]);

  // Visual Risk Distribution for charts
  const riskDistributionData = useMemo(() => {
    const riskCounts = predictions.reduce((acc, pred) => {
      acc[pred.risk] = (acc[pred.risk] || 0) + 1;
      return acc;
    }, {});
    const total = predictions.length || 1;
    return [
      { risk: "Low", count: riskCounts.Low || 0, percentage: (((riskCounts.Low || 0) / total) * 100).toFixed(1) },
      { risk: "Medium", count: riskCounts.Medium || 0, percentage: (((riskCounts.Medium || 0) / total) * 100).toFixed(1) },
      { risk: "High", count: riskCounts.High || 0, percentage: (((riskCounts.High || 0) / total) * 100).toFixed(1) }
    ];
  }, [predictions]);

  const activeAlertsCount = activeAlertsList.length;
  const activeOpsCount = rescueOps.filter(o => o.status !== "Completed").length;
  const pendingReportsCount = communityReports.filter(r => r.status === "Submitted" || r.status === "Under Review").length;

  const getRiskColor = (risk) => {
    if (risk === "High") return "text-red-400";
    if (risk === "Medium") return "text-amber-400";
    return "text-teal-400";
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case "government_official": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "rescue_worker": return "bg-teal-500/20 text-teal-300 border-teal-500/40";
      default: return "bg-blue-500/20 text-blue-300 border-blue-500/40";
    }
  };

  // All navigation tabs in one combined list (shown in expanded grid)
  const allNavTabs = [
    { id: 'overview',     label: 'Command Center',       icon: '🛡️',  badge: null },
    { id: 'users',        label: 'User Accounts',        icon: '👥',  badge: filteredUsers.length },
    { id: 'reports',      label: 'Citizen Reports',      icon: '📢',  badge: pendingReportsCount },
    { id: 'shelters',     label: 'Relief Shelters',      icon: '🏢',  badge: shelters.length },
    { id: 'hospitals',    label: 'Emergency Hospitals',  icon: '🏥',  badge: hospitals.length },
    { id: 'alerts',       label: 'Alerts & Advisories',  icon: '🚨',  badge: activeAlertsCount },
    { id: 'rescue',       label: 'Ground Operations',    icon: '⚡',  badge: activeOpsCount },
    { id: 'predictions',  label: 'AI Model & Analytics', icon: '🌧️',  badge: predictions.length || null },
    { id: 'aimodel',      label: 'System & Retrain',     icon: '🤖',  badge: null },
  ];

  // For backward compat keep these (used elsewhere in component)
  const primaryNavTabs = allNavTabs;
  const dropdownNavTabs = [];

  // Label shown in collapsed bar header
  const activeSectionLabel = allNavTabs.find(t => t.id === activeSection)?.label || 'Command Center';
  const activeSectionIcon  = allNavTabs.find(t => t.id === activeSection)?.icon  || '🛡️';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070b12] text-parchment font-sans">
        <Navbar />
        <div className="pt-28 pb-16 flex items-center justify-center min-h-[65vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto"></div>
            <p className="mt-4 text-slate-400 text-sm">Loading Disaster Management Console...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 font-sans flex flex-col justify-between overflow-x-hidden selection:bg-teal-500 selection:text-white">
      <Navbar />

      <main className="pt-24 pb-16 flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6">

        {/* ── COLLAPSIBLE NAV PANEL (Matches user's exact screenshot) ── */}
        <div className="mb-6 rounded-2xl border border-slate-800/80 bg-[#0d131f] shadow-2xl overflow-hidden transition-all duration-300">

          {/* ── Collapsed Header Bar (always visible) ── */}
          <div
            onClick={() => setDropdownOpen(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">📊</span>
              <span className="text-white font-bold text-base tracking-wide">
                {activeSectionLabel}
              </span>
            </div>
            {/* Caret arrow: ▲ when open, ▼ when closed (matches screenshot 1 and 2) */}
            <div className="text-slate-400 hover:text-white transition-transform text-xs">
              {dropdownOpen ? "▲" : "▼"}
            </div>
          </div>

          {/* ── Expanded Grid (slides open smoothly) ── */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: dropdownOpen ? '300px' : '0px' }}
          >
            <div className="px-5 pb-5 pt-1 border-t border-slate-800/80">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {allNavTabs.map((tab) => {
                  const isActive = activeSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveSection(tab.id); setDropdownOpen(false); }}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[#f59e0b] text-slate-950 shadow-lg shadow-amber-500/20'
                          : 'bg-[#131b2a] text-slate-300 hover:text-white hover:bg-[#1a2538] border border-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className="text-base shrink-0">{tab.icon}</span>
                        <span className="truncate">{tab.label}</span>
                      </div>
                      {tab.badge != null && tab.badge > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ml-2 ${
                          isActive
                            ? 'bg-slate-950/20 text-slate-950'
                            : 'bg-slate-800/90 text-slate-300 border border-slate-700/50'
                        }`}>
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Notification Toast */}
        {adminFeedback && (
          <div className="mb-5 bg-teal-500/10 border border-teal-500/30 rounded-xl px-4 py-3 text-sm text-teal-200 flex items-center justify-between shadow-lg">
            <span className="flex items-center gap-2"><span className="text-emerald-400 text-base">✓</span>{adminFeedback}</span>
            <button onClick={() => setAdminFeedback("")} className="text-teal-400 hover:text-white ml-4 shrink-0">✕</button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 1. OVERVIEW & MAP                                                         */}
        {/* ========================================================================= */}
        {activeSection === 'overview' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div onClick={() => setActiveSection('users')} className="bg-slate-900/80 border border-slate-800 hover:border-teal-500/40 p-5 rounded-2xl cursor-pointer transition-all shadow-lg hover:shadow-teal-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Active Users</span>
                  <span className="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center text-base">👥</span>
                </div>
                <div className="text-3xl font-extrabold text-white mt-2">{filteredUsers.length}</div>
                <div className="text-xs text-slate-400 mt-1">Managed accounts</div>
              </div>

              <div onClick={() => setActiveSection('alerts')} className="bg-slate-900/80 border border-slate-800 hover:border-red-500/40 p-5 rounded-2xl cursor-pointer transition-all shadow-lg hover:shadow-red-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Live Alerts</span>
                  <span className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center text-base">🚨</span>
                </div>
                <div className="text-3xl font-extrabold text-red-400 mt-2">{activeAlertsCount}</div>
                <div className="text-xs text-slate-400 mt-1">Active broadcasts</div>
              </div>

              <div onClick={() => setActiveSection('rescue')} className="bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 p-5 rounded-2xl cursor-pointer transition-all shadow-lg hover:shadow-amber-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Rescue Missions</span>
                  <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center text-base">⚡</span>
                </div>
                <div className="text-3xl font-extrabold text-amber-400 mt-2">{activeOpsCount}</div>
                <div className="text-xs text-slate-400 mt-1">Teams on ground</div>
              </div>

              <div onClick={() => setActiveSection('reports')} className="bg-slate-900/80 border border-slate-800 hover:border-blue-500/40 p-5 rounded-2xl cursor-pointer transition-all shadow-lg hover:shadow-blue-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Citizen Reports</span>
                  <span className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center text-base">📢</span>
                </div>
                <div className="text-3xl font-extrabold text-blue-400 mt-2">{pendingReportsCount}</div>
                <div className="text-xs text-slate-400 mt-1">Pending review</div>
              </div>
            </div>

            {/* Interactive Operations Map */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Disaster Operations & GIS Map</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time map showing relief shelters, trauma hospitals, road blockages, active rescue teams, and flood risk zones.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">● Shelters</span>
                  <span className="px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/30">● Hospitals</span>
                  <span className="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/30">● Rescue Ops</span>
                  <span className="px-2.5 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/30">● Blocked Roads</span>
                </div>
              </div>
              <FloodMap height={480} canEdit={true} />
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. USER MANAGEMENT                                                        */}
        {/* ========================================================================= */}
        {activeSection === 'users' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Managed User Accounts ({filteredUsers.length})</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Create users, assign roles (Citizen, Rescue Worker, Government Official), toggle active status, or delete accounts.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 sm:w-48"
                  />
                  <button
                    onClick={() => setShowCreateUser(true)}
                    className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                  >
                    + Create User
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800 custom-scroll">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          {userSearch ? "No users matching your search." : "No accounts registered yet."}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user, idx) => {
                        const isActive = user.status === "Active" || user.active !== false;
                        return (
                          <tr key={`user-${user.id}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 text-white font-medium flex items-center gap-2">
                              <span className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs">👤</span>
                              {user.name}
                            </td>
                            <td className="py-3 px-4 text-slate-400 font-mono">{user.email}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${getRoleBadge(user.role)}`}>
                                {user.role}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-red-500/20 text-red-300 border-red-500/40"
                              }`}>
                                {isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {user.role === 'government_official' && (user.email || '').toLowerCase().trim() === 'govofficial@gmail.com' ? (
                                  <span className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                                    🔒 System Official
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleToggleUserStatus(user)}
                                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-300 transition-colors"
                                    >
                                      {isActive ? "Deactivate" : "Activate"}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUser(user.id)}
                                      className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. ALERTS & NOTIFICATIONS                                                 */}
        {/* ========================================================================= */}
        {activeSection === 'alerts' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Emergency Flood Alerts</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Trigger emergency broadcasts, update active notices, or review complete timestamped alert history.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingAlertId(null);
                    setNewAlert({ message: "", location: "", risk: "High" });
                    setShowAlertModal(true);
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow-lg shadow-red-600/20 bg-red-600 hover:bg-red-500"
                >
                  + Trigger Emergency Alert 🚨
                </button>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-2 border-b border-slate-800 pb-1 mb-4">
                <button
                  onClick={() => setAlertTab("active")}
                  className={`px-3.5 py-2 rounded-t-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    alertTab === "active" ? "bg-slate-800 text-teal-300 border-b-2 border-teal-400" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <span>⚡ Active Alerts</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-700 text-teal-200 text-[10px]">{activeAlertsList.length}</span>
                </button>
                <button
                  onClick={() => setAlertTab("history")}
                  className={`px-3.5 py-2 rounded-t-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    alertTab === "history" ? "bg-slate-800 text-teal-300 border-b-2 border-teal-400" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <span>📜 Alert History Log</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-300 text-[10px]">{alertHistoryList.length}</span>
                </button>
              </div>

              {/* Active Alerts */}
              {alertTab === "active" && (
                <div>
                  {activeAlertsList.length === 0 ? (
                    <div className="py-10 text-center text-slate-500 text-xs border border-slate-800 rounded-xl">
                      No emergency alerts currently active. Click "+ Trigger Emergency Alert" to broadcast.
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {activeAlertsList.map((a, idx) => (
                        <div key={`act-alert-${a.id}-${idx}`} className="bg-red-950/20 border border-red-500/30 rounded-xl p-4 flex flex-col justify-between gap-3">
                          <div>
                            <div className="flex justify-between items-start gap-2">
                              <h3 className="font-semibold text-white text-sm">📍 {a.location}</h3>
                              <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${getRiskColor(a.risk_level || a.risk)} bg-slate-900 border border-slate-800`}>
                                {a.risk_level || a.risk || "High"} Risk
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 mt-2 bg-slate-900/60 p-2.5 rounded-lg">{a.message}</p>
                            <div className="text-[10px] text-slate-400 font-mono mt-2">
                              Triggered: {formatAlertDateTime(a.created_at || a.timestamp)}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                            <button
                              onClick={() => handleEditAlert(a)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-medium transition-colors"
                            >
                              ✏️ Update Alert
                            </button>
                            <button
                              onClick={() => handleCancelAlert(a.id)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
                            >
                              🚫 Cancel Alert
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Alert History */}
              {alertTab === "history" && (
                <div className="overflow-x-auto rounded-xl border border-slate-800 custom-scroll">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Location</th>
                        <th className="py-2.5 px-3">Severity</th>
                        <th className="py-2.5 px-3">Message</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Logged Timestamp</th>
                        <th className="py-2.5 px-3 text-right">Delete</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {alertHistoryList.length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-slate-500">No alert logs recorded.</td></tr>
                      ) : (
                        alertHistoryList.map((a, idx) => (
                          <tr key={`hist-alert-${a.id}-${idx}`} className="hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 text-white font-medium">📍 {a.location}</td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded-full font-bold ${getRiskColor(a.risk_level || a.risk)} bg-slate-900 border border-slate-800`}>
                                {a.risk_level || a.risk || "Medium"}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">{a.message}</td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                a.status === "Cancelled" ? "bg-red-500/20 text-red-300 border-red-500/40" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              }`}>
                                {a.status || "Active"}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 font-mono">{formatAlertDateTime(a.created_at || a.timestamp)}</td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => handleDeleteAlert(a.id)}
                                className="text-xs px-2 py-0.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. RESCUE OPERATIONS                                                      */}
        {/* ========================================================================= */}
        {activeSection === 'rescue' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Rescue Coordination Center</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Create & assign rescue missions, monitor live statuses, log SITREPs, and export reporting logs.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCreateRescueModal(true)}
                    className="btn-primary text-xs py-1.5 px-3"
                  >
                    + Create & Assign Operation
                  </button>
                  <button
                    onClick={exportPastOperationsCSV}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    Export CSV Log 📥
                  </button>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-2 border-b border-slate-800 pb-1 mb-4">
                <button
                  onClick={() => setRescueActiveTab("active")}
                  className={`px-3.5 py-2 rounded-t-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    rescueActiveTab === "active" ? "bg-slate-800 text-teal-300 border-b-2 border-teal-400" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <span>⚡ Active Missions</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-700 text-teal-200 text-[10px]">{activeRescueOps.length}</span>
                </button>
                <button
                  onClick={() => setRescueActiveTab("history")}
                  className={`px-3.5 py-2 rounded-t-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    rescueActiveTab === "history" ? "bg-slate-800 text-teal-300 border-b-2 border-teal-400" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <span>📜 Past Missions Log</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-300 text-[10px]">{pastRescueOps.length}</span>
                </button>
              </div>

              {/* Active Tab */}
              {rescueActiveTab === "active" && (
                <div className="space-y-4">
                  {/* Filter Toolbar */}
                  <div className="p-3 bg-slate-800/60 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Risk Priority:</span>
                      {["All", "High", "Medium", "Low"].map((level) => (
                        <button
                          key={level}
                          onClick={() => setRescueRiskFilter(level)}
                          className={`px-2.5 py-0.5 rounded-full border text-[11px] ${
                            rescueRiskFilter === level ? "bg-teal-500/25 border-teal-500 text-teal-300" : "border-slate-700 text-slate-400"
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Status:</span>
                      {["All", "Assigned", "In Progress"].map((st) => (
                        <button
                          key={st}
                          onClick={() => setRescueStatusFilter(st)}
                          className={`px-2.5 py-0.5 rounded-full border text-[11px] ${
                            rescueStatusFilter === st ? "bg-teal-500/25 border-teal-500 text-teal-300" : "border-slate-700 text-slate-400"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Cards */}
                  {activeRescueOps.length === 0 ? (
                    <div className="py-10 text-center text-slate-500 text-xs border border-slate-800 rounded-xl">
                      No active rescue operations matching current filters.
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {activeRescueOps.map((op, idx) => {
                        const updateLog = Array.isArray(op.update_log) ? op.update_log : JSON.parse(op.update_log || "[]");
                        return (
                          <div key={`act-op-${op.id}-${idx}`} className="bg-slate-800/40 p-4 rounded-xl border-l-4 border-l-teal-500 border border-slate-800 flex flex-col justify-between gap-3 shadow-md">
                            <div>
                              <div className="flex justify-between items-start gap-2">
                                <div>
                                  <h3 className="font-semibold text-white text-sm">📍 {op.location}</h3>
                                  <p className="text-xs text-slate-400 mt-0.5">Assigned to: <strong className="text-teal-300">{op.assigned_team}</strong></p>
                                </div>
                                <select
                                  value={op.risk_level || "Medium"}
                                  onChange={(e) => handleReprioritizeRescueRisk(op.id, e.target.value)}
                                  className="bg-slate-900 border border-slate-700 text-[11px] rounded px-2 py-0.5 text-white"
                                >
                                  <option value="High">🔴 High</option>
                                  <option value="Medium">🟡 Medium</option>
                                  <option value="Low">🟢 Low</option>
                                </select>
                              </div>

                              {op.description && (
                                <p className="text-xs text-slate-300 mt-2 bg-slate-900/60 p-2.5 rounded-lg">{op.description}</p>
                              )}

                              {updateLog.length > 0 && (
                                <div className="mt-2 text-[11px] text-slate-400 truncate">
                                  <span className="font-semibold text-white">Latest SITREP:</span> "{updateLog[updateLog.length - 1].note}"
                                </div>
                              )}
                            </div>

                            <div className="pt-2 border-t border-slate-800 space-y-2">
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Log SITREP note..."
                                  value={rescueNoteInputs[op.id] || ""}
                                  onChange={(e) => setRescueNoteInputs(p => ({ ...p, [op.id]: e.target.value }))}
                                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white flex-1 focus:outline-none focus:border-teal-500"
                                />
                                <button
                                  onClick={() => handleAddRescueNote(op.id)}
                                  className="btn-secondary text-xs py-1 px-2.5"
                                >
                                  Post
                                </button>
                              </div>

                              <div className="flex items-center justify-between gap-2 pt-1">
                                <div className="flex gap-1.5">
                                  {op.status !== "In Progress" && (
                                    <button
                                      onClick={() => handleUpdateRescueStatus(op.id, "In Progress")}
                                      className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 font-medium"
                                    >
                                      In Progress
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleUpdateRescueStatus(op.id, "Completed")}
                                    className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 font-medium"
                                  >
                                    Mark Completed ✅
                                  </button>
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handlePrintRescueOperation(op)}
                                    className="text-xs text-slate-400 hover:text-white p-1"
                                    title="Print SITREP"
                                  >
                                    🖨️
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRescueOp(op.id)}
                                    className="text-xs text-red-400 hover:text-red-300 p-1"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* History Tab */}
              {rescueActiveTab === "history" && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
                    <input
                      value={rescueHistorySearch}
                      onChange={(e) => setRescueHistorySearch(e.target.value)}
                      placeholder="Search past missions..."
                      className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white sm:w-64 focus:outline-none focus:border-teal-500"
                    />
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-slate-400">Risk:</span>
                      {["All", "High", "Medium", "Low"].map((level) => (
                        <button
                          key={level}
                          onClick={() => setRescueHistoryRiskFilter(level)}
                          className={`px-2 py-0.5 rounded-full border text-[11px] ${
                            rescueHistoryRiskFilter === level ? "bg-teal-500/25 border-teal-500 text-teal-300" : "border-slate-700 text-slate-400"
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-800 custom-scroll">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Location</th>
                          <th className="py-2.5 px-3">Priority</th>
                          <th className="py-2.5 px-3">Team</th>
                          <th className="py-2.5 px-3">Rescued</th>
                          <th className="py-2.5 px-3">Resources Used</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3 text-right">Report</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {pastRescueOps.length === 0 ? (
                          <tr><td colSpan={7} className="py-8 text-center text-slate-500">No completed missions recorded.</td></tr>
                        ) : (
                          pastRescueOps.map((op, idx) => (
                            <tr key={`past-op-${op.id}-${idx}`} className="hover:bg-slate-800/40">
                              <td className="py-2.5 px-3 text-white font-medium">📍 {op.location}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded-full font-bold ${getRiskColor(op.risk_level)} bg-slate-900 border border-slate-800`}>
                                  {op.risk_level}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-teal-300">{op.assigned_team}</td>
                              <td className="py-2.5 px-3 text-emerald-400 font-bold">{op.people_rescued || 0}</td>
                              <td className="py-2.5 px-3 text-slate-400">{op.resources_used || "—"}</td>
                              <td className="py-2.5 px-3 text-slate-400 font-mono">{op.completed_at ? new Date(op.completed_at).toLocaleDateString() : "—"}</td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={() => handlePrintRescueOperation(op)}
                                  className="text-xs px-2.5 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                                >
                                  🖨️ Print
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. COMMUNITY INCIDENT REPORTS                                             */}
        {/* ========================================================================= */}
        {activeSection === 'reports' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Citizen Incident Reports ({filteredCommunityReports.length})</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Review public incident submissions with photos, assign teams, update status, or convert to alerts.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search reports..."
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 sm:w-44 focus:outline-none focus:border-teal-500"
                  />
                  <select
                    value={reportStatusFilter}
                    onChange={(e) => setReportStatusFilter(e.target.value)}
                    className="bg-slate-800/80 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Action Taken">Action Taken</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
              </div>

              {filteredCommunityReports.length === 0 ? (
                <div className="py-10 text-center text-slate-500 text-xs border border-slate-800 rounded-xl">
                  No citizen reports found.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredCommunityReports.map((report, idx) => (
                    <div key={`comm-rep-${report.id}-${idx}`} className="bg-slate-800/40 p-4 rounded-xl border border-slate-800 hover:border-teal-500/30 transition-all flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h3 className="font-semibold text-white text-sm">📍 {report.location}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">Submitted by: <span className="text-slate-200">{report.authorName || report.author_name || "Citizen"}</span></p>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            report.status === "Resolved" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" :
                            report.status === "Action Taken" ? "bg-blue-500/20 text-blue-300 border-blue-500/40" :
                            report.status === "Under Review" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                            "bg-purple-500/20 text-purple-300 border-purple-500/40"
                          }`}>
                            {report.status || "Submitted"}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 mt-2 bg-slate-900/60 p-2.5 rounded-lg whitespace-pre-wrap">{report.description}</p>

                        {/* Image Preview */}
                        {report.photo_url && (
                          <div className="mt-2.5">
                            <img
                              src={report.photo_url.startsWith("http") ? report.photo_url : `${API_BASE}${report.photo_url}`}
                              alt="Incident Evidence"
                              className="w-full h-36 object-cover rounded-lg border border-slate-800"
                            />
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {report.status === "Submitted" && (
                            <button
                              onClick={() => handleReportStatus(report.id, "Under Review")}
                              className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                            >
                              Under Review
                            </button>
                          )}

                          {report.status !== "Action Taken" && report.status !== "Resolved" && (
                            <button
                              onClick={() => setAssigningReportId(assigningReportId === report.id ? null : report.id)}
                              className="text-[11px] px-2 py-0.5 rounded-lg bg-teal-500/20 text-teal-300 hover:bg-teal-500/30"
                            >
                              Dispatch Team
                            </button>
                          )}

                          {report.status !== "Resolved" && (
                            <button
                              onClick={() => handleReportStatus(report.id, "Resolved")}
                              className="text-[11px] px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                            >
                              Mark Resolved ✅
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleConvertToAlert(report)}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30"
                            title="Convert to Emergency Alert"
                          >
                            Convert to Alert 🚨
                          </button>
                          <button
                            onClick={() => handleDeleteReport(report.id)}
                            className="text-[11px] px-1.5 py-0.5 rounded-lg bg-slate-800 text-red-400 hover:bg-red-500/20"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Team Dispatch Dropdown */}
                      {assigningReportId === report.id && (
                        <div className="mt-2 p-2.5 bg-slate-900 rounded-lg border border-teal-500/30 flex items-center gap-2 animate-fadeIn">
                          <select
                            value={assignReportWorkerChoice}
                            onChange={(e) => setAssignReportWorkerChoice(e.target.value)}
                            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white flex-1 focus:outline-none"
                          >
                            <option value="">Select Rescue Worker / Team</option>
                            {rescueWorkersList.map(w => (
                              <option key={w.id} value={w.name}>{w.name} ({w.email})</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              handleReportStatus(report.id, "Action Taken", assignReportWorkerChoice);
                              setAssigningReportId(null);
                            }}
                            className="btn-primary text-xs py-1 px-2.5"
                          >
                            Confirm Dispatch
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. MANAGE SHELTERS                                                        */}
        {/* ========================================================================= */}
        {activeSection === 'shelters' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Emergency Relief Shelters ({filteredShelters.length})</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Add, update, or remove disaster relief shelters with automatic duplicate verification.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search shelters..."
                    value={shelterSearch}
                    onChange={(e) => setShelterSearch(e.target.value)}
                    className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white sm:w-48 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={() => setShowShelterForm(v => !v)}
                    className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                  >
                    {showShelterForm ? "Cancel" : "+ Add Shelter"}
                  </button>
                </div>
              </div>

              {/* Form */}
              {showShelterForm && (
                <form onSubmit={handleCreateShelter} className="mb-4 p-4 bg-teal-950/20 border border-teal-500/30 rounded-xl grid md:grid-cols-2 gap-2.5 animate-fadeIn">
                  <input
                    required
                    placeholder="Shelter Name *"
                    value={newShelter.name}
                    onChange={(e) => setNewShelter(p => ({ ...p, name: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    required
                    placeholder="Address / Location *"
                    value={newShelter.address}
                    onChange={(e) => setNewShelter(p => ({ ...p, address: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    type="number"
                    placeholder="Max Capacity (e.g. 250)"
                    value={newShelter.capacity}
                    onChange={(e) => setNewShelter(p => ({ ...p, capacity: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    placeholder="Contact Phone (+92...)"
                    value={newShelter.contact}
                    onChange={(e) => setNewShelter(p => ({ ...p, contact: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <button type="submit" className="md:col-span-2 btn-primary py-2 text-xs font-semibold">
                    Save Shelter Record
                  </button>
                </form>
              )}

              {/* Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredShelters.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-slate-500 text-xs">No registered shelters found.</div>
                ) : (
                  filteredShelters.map((s, idx) => (
                    <div key={`shelt-${s.id}-${idx}`} className="bg-slate-800/40 rounded-xl p-3.5 border border-slate-800 hover:border-teal-500/40 transition-all flex flex-col justify-between gap-2 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white text-sm truncate">{s.name}</h4>
                          <p className="text-xs text-slate-400 truncate mt-0.5">📍 {s.address}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditingShelter({ ...s })}
                            className="text-xs text-amber-300 hover:text-white px-2 py-0.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20"
                            title="Edit Shelter"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteShelter(s.id)}
                            className="text-red-400 hover:text-red-300 text-xs px-2 py-0.5 rounded-lg bg-red-500/10 hover:bg-red-500/20"
                            title="Delete Shelter"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs mt-1">
                        {s.capacity && <span className="px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-medium">Capacity: {s.capacity}</span>}
                        {s.contact && <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">{s.contact}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 7. MANAGE HOSPITALS                                                       */}
        {/* ========================================================================= */}
        {activeSection === 'hospitals' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Registered Emergency Hospitals ({filteredHospitals.length})</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Add, update, or remove emergency medical centers with duplicate verification.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search hospitals..."
                    value={hospitalSearch}
                    onChange={(e) => setHospitalSearch(e.target.value)}
                    className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white sm:w-48 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={() => setShowHospitalForm(v => !v)}
                    className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                  >
                    {showHospitalForm ? "Cancel" : "+ Add Hospital"}
                  </button>
                </div>
              </div>

              {/* Form */}
              {showHospitalForm && (
                <form onSubmit={handleCreateHospital} className="mb-4 p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-xl grid md:grid-cols-2 gap-2.5 animate-fadeIn">
                  <input
                    required
                    placeholder="Hospital Name *"
                    value={newHospital.name}
                    onChange={(e) => setNewHospital(p => ({ ...p, name: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    required
                    placeholder="Address / City *"
                    value={newHospital.address}
                    onChange={(e) => setNewHospital(p => ({ ...p, address: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    placeholder="Emergency Contact Phone"
                    value={newHospital.contact}
                    onChange={(e) => setNewHospital(p => ({ ...p, contact: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <input
                    placeholder="Available Services (e.g. Emergency, ICU, Trauma)"
                    value={newHospital.services}
                    onChange={(e) => setNewHospital(p => ({ ...p, services: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                  <button type="submit" className="md:col-span-2 btn-primary py-2 text-xs font-semibold">
                    Save Hospital Record
                  </button>
                </form>
              )}

              {/* Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredHospitals.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-slate-500 text-xs">No registered hospitals found.</div>
                ) : (
                  filteredHospitals.map((h, idx) => (
                    <div key={`hosp-${h.id}-${idx}`} className="bg-slate-800/40 rounded-xl p-3.5 border border-slate-800 hover:border-emerald-500/40 transition-all flex flex-col justify-between gap-2 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white text-sm truncate">{h.name}</h4>
                          <p className="text-xs text-slate-400 truncate mt-0.5">📍 {h.address}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditingHospital({ ...h })}
                            className="text-xs text-amber-300 hover:text-white px-2 py-0.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20"
                            title="Edit Hospital"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteHospital(h.id)}
                            className="text-red-400 hover:text-red-300 text-xs px-2 py-0.5 rounded-lg bg-red-500/10 hover:bg-red-500/20"
                            title="Delete Hospital"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs mt-1">
                        {h.services && <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-medium truncate max-w-full">🏥 {h.services}</span>}
                        {h.contact && <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">{h.contact}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 8. PREDICTIONS & XAI EXPLANATIONS                                         */}
        {/* ========================================================================= */}
        {activeSection === 'predictions' && (
          <div className="space-y-6 animate-fadeIn">

            {/* Visual Charts */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
                <h3 className="text-sm font-bold text-white mb-2">📊 Flood Risk Distribution</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={riskDistributionData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="risk" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.15)", borderRadius: "8px" }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {riskDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.risk === 'High' ? '#EF4444' : entry.risk === 'Medium' ? '#F59E0B' : '#10B981'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
                <h3 className="text-sm font-bold text-white mb-2">📈 Prediction Confidence Trends</h3>
                <div className="h-48">
                  {confidenceTrend.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">No confidence trend data recorded yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={confidenceTrend.map(d => ({ ...d, conf_pct: d.avg_confidence <= 1 ? parseFloat((d.avg_confidence * 100).toFixed(1)) : parseFloat(d.avg_confidence.toFixed(1)) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis domain={[0, 100]} stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.15)", borderRadius: "8px" }} formatter={(v) => [`${v}%`, "Avg Confidence"]} />
                        <Line type="monotone" dataKey="conf_pct" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Table with Date Filters & CSV Export */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Historical Flood Predictions ({filteredPredictions.length})</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter predictions by date range or risk level, inspect SHAP feature attributions, and export CSV reports.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                    <span className="text-slate-400">From:</span>
                    <input
                      type="date"
                      value={predictionFilters.from}
                      onChange={(e) => setPredictionFilters(p => ({ ...p, from: e.target.value }))}
                      className="bg-transparent text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                    <span className="text-slate-400">To:</span>
                    <input
                      type="date"
                      value={predictionFilters.to}
                      onChange={(e) => setPredictionFilters(p => ({ ...p, to: e.target.value }))}
                      className="bg-transparent text-white focus:outline-none"
                    />
                  </div>
                  <select
                    value={predictionFilters.risk}
                    onChange={(e) => setPredictionFilters(p => ({ ...p, risk: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg py-1 px-2 text-xs text-white focus:outline-none"
                  >
                    <option value="All">All Risk</option>
                    <option value="High">🔴 High</option>
                    <option value="Medium">🟡 Medium</option>
                    <option value="Low">🟢 Low</option>
                  </select>
                  {(predictionFilters.from || predictionFilters.to || predictionFilters.risk !== "All") && (
                    <button
                      onClick={() => setPredictionFilters({ risk: "All", from: "", to: "" })}
                      className="text-slate-400 hover:text-white px-1.5 py-0.5"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={downloadPredictionsCSV}
                    className="btn-secondary text-xs py-1 px-2.5"
                  >
                    Export CSV 📥
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800 custom-scroll">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3">Risk Level</th>
                      <th className="py-2.5 px-3">Confidence</th>
                      <th className="py-2.5 px-3">Rainfall</th>
                      <th className="py-2.5 px-3">Temperature</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3 text-right">XAI Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredPredictions.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-slate-500">No prediction records found.</td></tr>
                    ) : (
                      filteredPredictions.map((p, i) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-white font-medium">📍 {p.location}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold ${getRiskColor(p.risk)} bg-slate-900 border border-slate-800`}>
                              {p.risk} Risk
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{p.confidence ? `${Math.round(p.confidence * 100)}%` : "—"}</td>
                          <td className="py-2.5 px-3 text-slate-400">{p.rainfall ? `${p.rainfall} mm` : "—"}</td>
                          <td className="py-2.5 px-3 text-slate-400">{p.temperature ? `${p.temperature}°C` : "—"}</td>
                          <td className="py-2.5 px-3 text-slate-400 font-mono">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => setSelectedPredictionXAI(p)}
                              className="text-xs px-2 py-0.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 font-medium transition-colors"
                              title="Inspect SHAP feature attributions"
                            >
                              🔍 XAI (SHAP)
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 9. AI MODEL RETRAINING                                                    */}
        {/* ========================================================================= */}
        {activeSection === 'aimodel' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-1">Retrain Prediction Model</h2>
              <p className="text-xs text-slate-400 mb-4 max-w-2xl">
                Upload newly collected historical flood datasets in CSV format to retrain the machine learning model.
                The model automatically verifies a minimum classification accuracy threshold &gt;= 80%.
              </p>

              <form onSubmit={handleRetrainModel} className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setRetrainFile(e.target.files[0])}
                  className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                />
                <button
                  type="submit"
                  disabled={!retrainFile || retraining}
                  className="btn-primary text-xs py-2 px-3.5 disabled:opacity-50 cursor-pointer"
                >
                  {retraining ? "Retraining Model..." : "Deploy Retrain Job"}
                </button>
              </form>

              {retrainResult && (
                <div className={`mt-3 rounded-xl p-3 text-xs ${
                  retrainResult.ok ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300" : "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                }`}>
                  {retrainResult.message}
                </div>
              )}
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h3 className="text-sm font-bold text-white mb-1">📈 Model Accuracy Milestones</h3>
              <p className="text-xs text-slate-400 mb-3">Verification progression against minimum classification accuracy threshold</p>
              <div className="h-56 w-full">
                {accuracyHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">Retrain model with historical dataset to log accuracy milestones.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={accuracyHistory.map(d => ({ ...d, accuracy_pct: d.accuracy <= 1 ? parseFloat((d.accuracy * 100).toFixed(1)) : parseFloat(d.accuracy.toFixed(1)), label: d.timestamp ? d.timestamp.slice(0, 10) : '' }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="label" stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis domain={[0, 100]} stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px" }} formatter={(value) => [`${value}%`, "Accuracy"]} />
                      <Line type="monotone" dataKey="accuracy_pct" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981" }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ========================================================================= */}
      {/* MODAL 1: TRIGGER / UPDATE EMERGENCY ALERT                                 */}
      {/* ========================================================================= */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-slate-800 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">
              {editingAlertId !== null ? "Update Active Alert" : "Trigger Emergency Alert"}
            </h2>
            <form onSubmit={handleCreateAlert} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Alert Message *</label>
                <input
                  type="text"
                  required
                  value={newAlert.message}
                  onChange={(e) => setNewAlert(p => ({ ...p, message: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. Flash Flood Warning for Taunsa River Basin"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Affected Location / City *</label>
                <input
                  type="text"
                  required
                  value={newAlert.location}
                  onChange={(e) => setNewAlert(p => ({ ...p, location: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. Dera Ghazi Khan"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Risk Severity *</label>
                <select
                  value={newAlert.risk}
                  onChange={(e) => setNewAlert(p => ({ ...p, risk: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="High">🔴 High (Immediate Danger)</option>
                  <option value="Medium">🟡 Medium (Elevated Threat)</option>
                  <option value="Low">🟢 Low (Advisory)</option>
                </select>
              </div>
              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => { setShowAlertModal(false); setEditingAlertId(null); }}
                  className="btn-secondary text-xs flex-1 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAlert}
                  className="btn-primary text-xs flex-1 py-2 bg-red-600 hover:bg-red-500"
                >
                  {savingAlert ? "Saving..." : editingAlertId !== null ? "Save Changes" : "Broadcast Alert 🚨"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CREATE & ASSIGN RESCUE OPERATION                                 */}
      {/* ========================================================================= */}
      {showCreateRescueModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <form onSubmit={handleCreateRescueOperation} className="bg-slate-900 rounded-2xl p-6 max-w-lg w-full border border-teal-500/40 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Create & Assign Rescue Mission</h2>
                <p className="text-xs text-slate-400 mt-0.5">Deploy ground teams and dispatch resources to flooded areas</p>
              </div>
              <button type="button" onClick={() => setShowCreateRescueModal(false)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Affected Area Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sukkur, Nowshera, Larkana, Karachi..."
                  value={createRescueForm.location}
                  onChange={(e) => setCreateRescueForm(p => ({ ...p, location: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Risk Level of Affected Area *</label>
                <select
                  value={createRescueForm.risk_level}
                  onChange={(e) => setCreateRescueForm(p => ({ ...p, risk_level: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="High" className="bg-slate-900 text-red-300">🔴 High Risk (Immediate Danger)</option>
                  <option value="Medium" className="bg-slate-900 text-yellow-300">🟡 Medium Risk (Elevated Threat)</option>
                  <option value="Low" className="bg-slate-900 text-green-300">🟢 Low Risk (Precautionary)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Assign Rescue Worker / Team *</label>
                <select
                  value={createRescueForm.assigned_team}
                  onChange={(e) => setCreateRescueForm(p => ({ ...p, assigned_team: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="">Select registered rescue worker / team</option>
                  {rescueWorkersList.map(w => (
                    <option key={w.id} value={w.name}>{w.name} ({w.email})</option>
                  ))}
                  <option value="Rescue Team Alpha">Rescue Team Alpha (Quick Response)</option>
                  <option value="Rescue Team Bravo">Rescue Team Bravo (Boat Unit)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Incident & Operation Description</label>
                <textarea
                  rows={3}
                  placeholder="Detail situation on ground: water depth, trapped citizens, required equipment..."
                  value={createRescueForm.description}
                  onChange={(e) => setCreateRescueForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="submit" className="btn-primary flex-1 py-2 text-sm font-semibold">
                Launch Mission & Dispatch
              </button>
              <button type="button" onClick={() => setShowCreateRescueModal(false)} className="btn-secondary py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: MARK RESCUE OPERATION COMPLETED                                  */}
      {/* ========================================================================= */}
      {completionModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <form onSubmit={handleCompleteRescueOperation} className="bg-slate-900 rounded-2xl p-6 max-w-lg w-full border border-emerald-500/40 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Mission Sign-Off & Results</h2>
                <p className="text-xs text-slate-400 mt-0.5">Location: <strong className="text-white">{completionModal.location}</strong></p>
              </div>
              <button type="button" onClick={() => setCompletionModal(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Number of People Rescued *</label>
                <input
                  type="number"
                  min="0"
                  required
                  placeholder="e.g. 45"
                  value={completionForm.people_rescued}
                  onChange={(e) => setCompletionForm(p => ({ ...p, people_rescued: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Resources Deployed / Used</label>
                <input
                  type="text"
                  placeholder="e.g. 2 Rescue Boats, 3 Ambulances, 40 Lifejackets"
                  value={completionForm.resources_used}
                  onChange={(e) => setCompletionForm(p => ({ ...p, resources_used: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Final Completion Report & Notes</label>
                <textarea
                  rows={3}
                  placeholder="Summarize mission outcomes, relief shelter transfers, medical triage..."
                  value={completionForm.completion_notes}
                  onChange={(e) => setCompletionForm(p => ({ ...p, completion_notes: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex-1 py-2 text-sm rounded-lg transition-colors shadow-lg shadow-emerald-600/20">
                Sign Off & Mark Completed ✅
              </button>
              <button type="button" onClick={() => setCompletionModal(null)} className="btn-secondary py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: CREATE USER ACCOUNT                                              */}
      {/* ========================================================================= */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <form onSubmit={handleCreateUser} className="bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-slate-800 shadow-2xl space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-bold text-white">Create New User Account</h2>
              <button type="button" onClick={() => setShowCreateUser(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label>
              <input
                required
                value={newUser.name}
                onChange={(e) => setNewUser(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                placeholder="e.g. Tariq Khan"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Email Address *</label>
              <input
                type="email"
                required
                value={newUser.email}
                onChange={(e) => setNewUser(p => ({ ...p, email: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                placeholder="e.g. tariq@rescue1122.gov.pk"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Password *</label>
              <input
                type="password"
                required
                value={newUser.password}
                onChange={(e) => setNewUser(p => ({ ...p, password: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                placeholder="Minimum 6 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">System Role *</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser(p => ({ ...p, role: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
              >
                <option value="citizen">Citizen (General Public)</option>
                <option value="rescue_worker">Rescue Worker (Operations Dispatch)</option>
              </select>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowCreateUser(false)} className="btn-secondary text-xs flex-1 py-2.5">
                Cancel
              </button>
              <button type="submit" className="btn-primary text-xs flex-1 py-2.5">
                Create User
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: EDIT SHELTER INFORMATION                                         */}
      {/* ========================================================================= */}
      {editingShelter && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-lg w-full border border-teal-500/40 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Edit Shelter Information</h2>
                <p className="text-xs text-slate-400 mt-0.5">Update shelter capacity, location, and emergency contact</p>
              </div>
              <button type="button" onClick={() => setEditingShelter(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>
            <form onSubmit={handleUpdateShelter} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Shelter Name *</label>
                <input
                  required
                  value={editingShelter.name || ""}
                  onChange={(e) => setEditingShelter(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. Government Degree College Flood Shelter"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Address / Location *</label>
                <input
                  required
                  value={editingShelter.address || ""}
                  onChange={(e) => setEditingShelter(p => ({ ...p, address: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. GT Road, Nowshera"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Max Capacity</label>
                  <input
                    type="number"
                    min="1"
                    value={editingShelter.capacity || ""}
                    onChange={(e) => setEditingShelter(p => ({ ...p, capacity: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                    placeholder="e.g. 300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Contact Phone</label>
                  <input
                    value={editingShelter.contact || ""}
                    onChange={(e) => setEditingShelter(p => ({ ...p, contact: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                    placeholder="e.g. +92-300-1234567"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => setEditingShelter(null)} className="btn-secondary py-2 text-sm flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary py-2 text-sm flex-1">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: EDIT HOSPITAL INFORMATION                                        */}
      {/* ========================================================================= */}
      {editingHospital && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-lg w-full border border-emerald-500/40 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Edit Hospital Information</h2>
                <p className="text-xs text-slate-400 mt-0.5">Update trauma center details, address, and medical services</p>
              </div>
              <button type="button" onClick={() => setEditingHospital(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>
            <form onSubmit={handleUpdateHospital} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Hospital Name *</label>
                <input
                  required
                  value={editingHospital.name || ""}
                  onChange={(e) => setEditingHospital(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. District Headquarters Hospital"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Address / City *</label>
                <input
                  required
                  value={editingHospital.address || ""}
                  onChange={(e) => setEditingHospital(p => ({ ...p, address: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. Hospital Road, Sukkur"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Contact Phone</label>
                <input
                  value={editingHospital.contact || ""}
                  onChange={(e) => setEditingHospital(p => ({ ...p, contact: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. +92-71-9310000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Available Services</label>
                <input
                  value={editingHospital.services || ""}
                  onChange={(e) => setEditingHospital(p => ({ ...p, services: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                  placeholder="e.g. Emergency, ICU, Trauma Care, Blood Bank"
                />
              </div>
              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => setEditingHospital(null)} className="btn-secondary py-2 text-sm flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary py-2 text-sm flex-1">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 7: XAI SHAP EXPLANATION INSPECTOR                                   */}
      {/* ========================================================================= */}
      {selectedPredictionXAI && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-2xl w-full border border-purple-500/40 shadow-2xl max-h-[90vh] overflow-y-auto custom-scroll">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-xl font-bold text-white">SHAP Feature Attribution & Explanation</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Location: <strong className="text-white">📍 {selectedPredictionXAI.location}</strong> · Assessed: {selectedPredictionXAI.created_at ? new Date(selectedPredictionXAI.created_at).toLocaleString() : "Recent"}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedPredictionXAI(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            {/* Overview Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block uppercase">Risk Classification</span>
                <span className={`text-sm font-bold ${getRiskColor(selectedPredictionXAI.risk)}`}>
                  {selectedPredictionXAI.risk} Risk
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block uppercase">Confidence Score</span>
                <span className="text-sm font-bold text-teal-300">
                  {selectedPredictionXAI.confidence ? `${Math.round(selectedPredictionXAI.confidence * 100)}%` : "—"}
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block uppercase">Rainfall</span>
                <span className="text-sm font-bold text-slate-200">
                  {selectedPredictionXAI.rainfall ? `${selectedPredictionXAI.rainfall} mm` : "—"}
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block uppercase">Temperature</span>
                <span className="text-sm font-bold text-slate-200">
                  {selectedPredictionXAI.temperature ? `${selectedPredictionXAI.temperature}°C` : "—"}
                </span>
              </div>
            </div>

            {/* Visual SHAP Bar Chart */}
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-800 mb-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-white">📊 SHAP Feature Contributions Chart</h3>
                <span className="text-[11px] text-slate-400">Impact on High Risk Probability</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Positive values (<span className="text-amber-400 font-semibold">Amber</span>) increase flood risk probability, while negative values (<span className="text-teal-400 font-semibold">Teal</span>) reduce risk.
              </p>
              {selectedPredictionXAI.shap_contributions && selectedPredictionXAI.shap_contributions.length > 0 ? (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...selectedPredictionXAI.shap_contributions].reverse().map(c => ({
                        name: (c.feature || "").replace(/_/g, " "),
                        impact: Number(c.impact !== undefined ? c.impact : c.importance || 0),
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 70, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.15)", borderRadius: "8px" }}
                        formatter={(val) => [Number(val).toFixed(4), "SHAP Value"]}
                      />
                      <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                        {[...selectedPredictionXAI.shap_contributions].reverse().map((c, idx) => (
                          <Cell
                            key={idx}
                            fill={(c.impact !== undefined ? c.impact : c.importance) > 0 ? "#E8A33D" : "#3FBDB6"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500">
                  SHAP feature explanations not generated for this legacy record. New predictions compute real-time SHAP attributions automatically.
                </div>
              )}
            </div>

            {/* Feature Attribution Breakdown */}
            {selectedPredictionXAI.shap_contributions && selectedPredictionXAI.shap_contributions.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Feature Attribution Breakdown</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-800/80 text-slate-400">
                      <tr>
                        <th className="p-2.5">Feature Factor</th>
                        <th className="p-2.5">Recorded Value</th>
                        <th className="p-2.5">SHAP Impact</th>
                        <th className="p-2.5">Risk Effect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {selectedPredictionXAI.shap_contributions.map((c, i) => {
                        const impactVal = Number(c.impact !== undefined ? c.impact : c.importance || 0);
                        const isElevating = impactVal > 0;
                        return (
                          <tr key={i} className="hover:bg-slate-800/40">
                            <td className="p-2.5 font-medium text-white capitalize">{(c.feature || "").replace(/_/g, " ")}</td>
                            <td className="p-2.5 text-slate-400">{c.value !== undefined ? c.value : "—"}</td>
                            <td className="p-2.5 font-mono text-slate-400">{impactVal.toFixed(4)}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${isElevating ? "bg-amber-500/20 text-amber-300" : "bg-teal-500/20 text-teal-300"}`}>
                                {isElevating ? "▲ Increases Flood Risk" : "▼ Reduces Flood Risk"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Narrative Explanation */}
            {selectedPredictionXAI.explanation && (
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-purple-300 uppercase block font-semibold mb-1">Generated XAI Narrative Summary</span>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{selectedPredictionXAI.explanation}</p>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedPredictionXAI(null)}
                className="btn-secondary py-2 px-4 text-xs"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
