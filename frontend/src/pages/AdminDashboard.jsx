import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import FloodMap from '../components/FloodMap';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

const AdminDashboard = () => {
  const { t, lang } = useLanguage();
  
  // Navigation Section State
  const [activeSection, setActiveSection] = useState('overview'); // overview, users, reports, facilities, alerts, ground, aimodel, events_logs
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data States
  const [users, setUsers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "citizen" });
  const [newAlert, setNewAlert] = useState({ message: "", location: "", risk: "Medium" });
  const [shelters, setShelters] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [showShelterForm, setShowShelterForm] = useState(false);
  const [showHospitalForm, setShowHospitalForm] = useState(false);
  const [newShelter, setNewShelter] = useState({ name: "", address: "", capacity: "", contact: "" });
  const [newHospital, setNewHospital] = useState({ name: "", address: "", contact: "", services: "" });

  const [predictionFilters, setPredictionFilters] = useState({ risk: "All", from: "", to: "" });

  const [userSearch, setUserSearch] = useState("");
  const [shelterSearch, setShelterSearch] = useState("");
  const [hospitalSearch, setHospitalSearch] = useState("");
  const [logs, setLogs] = useState([]);
  const [accuracyHistory, setAccuracyHistory] = useState([]);
  const [confidenceTrend, setConfidenceTrend] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [donations, setDonations] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [communityReports, setCommunityReports] = useState([]);
  const [reportsFilter, setReportsFilter] = useState("All");
  const [selectedReport, setSelectedReport] = useState(null);
  const [convertModal, setConvertModal] = useState({ open: false, report: null, type: "" });
  const [events, setEvents] = useState([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: "", location: "", event_date: "", event_type: "Emergency Drill", notes: "" });
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  const [rescueOps, setRescueOps] = useState([]);
  const [advisories, setAdvisories] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [handoverNotes, setHandoverNotes] = useState([]);
  const [volunteerSkillFilter, setVolunteerSkillFilter] = useState("");

  const [retrainFile, setRetrainFile] = useState(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainResult, setRetrainResult] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchAlerts();
    fetchPredictions();
    fetchShelters();
    fetchHospitals();
    fetchAccuracyHistory();
    fetchConfidenceTrend();
    fetchVolunteers();
    fetchDonations();
    fetchCommunityReports();
    fetchRescueOps();
    fetchAdvisories();
    fetchEquipment();
    fetchHandoverNotes();
    fetchEvents();

    // 5s real-time live sync for Hospitals, Shelters, and Community Reports
    const syncInterval = setInterval(() => {
      fetchShelters();
      fetchHospitals();
      fetchCommunityReports();
    }, 5000);

    return () => clearInterval(syncInterval);
  }, []);

  const fetchCommunityReports = async () => {
    try {
      const res = await axios.get(`${API_BASE}/community-reports`);
      setCommunityReports(res.data || []);
    } catch (err) { console.error(err); }
  };

  const handleReportStatus = async (reportId, status) => {
    try {
      await axios.put(`${API_BASE}/community-reports/${reportId}/status`, { status });
      fetchCommunityReports();
    } catch (err) {
      alert("Failed to update report status.");
    }
  };

  const handleConvertToAlert = async (report) => {
    try {
      await axios.post(`${API_BASE}/alerts`, {
        message: `[Community Report] ${report.type || "Incident"} at ${report.location}: ${report.description}`,
        location: report.location,
        risk: report.severity || "High",
        status: "Active"
      });
      await handleReportStatus(report.id, "Converted to Alert");
      setConvertModal({ open: false, report: null, type: "" });
      fetchAlerts();
      alert("Emergency Alert created successfully!");
    } catch (err) {
      alert("Failed to create alert.");
    }
  };

  const handleConvertToRescueOp = async (report) => {
    try {
      await axios.put(`${API_BASE}/community-reports/${report.id}/status`, {
        status: "Action Taken",
        assigned_team: "Unassigned"
      });
      setConvertModal({ open: false, report: null, type: "" });
      fetchCommunityReports();
      alert("Rescue Operation launched successfully!");
    } catch (err) {
      alert("Failed to launch rescue operation.");
    }
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

  const fetchVolunteers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/volunteers`);
      setVolunteers(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchDonations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/donations`);
      setDonations(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchShelters = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shelters`);
      setShelters(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchHospitals = async () => {
    try {
      const res = await axios.get(`${API_BASE}/hospitals`);
      setHospitals(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRescueOps = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations`);
      setRescueOps(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchAdvisories = async () => {
    try {
      const res = await axios.get(`${API_BASE}/advisories`);
      setAdvisories(res.data || []);
    } catch (err) { console.error(err); }
  };

  const handleDeleteAdvisory = async (id) => {
    if (!confirm("Revoke / Delete this advisory broadcast?")) return;
    try {
      await axios.delete(`${API_BASE}/advisories/${id}`);
      fetchAdvisories();
    } catch (err) {
      alert("Failed to delete advisory.");
    }
  };

  const fetchEquipment = async () => {
    try {
      const res = await axios.get(`${API_BASE}/equipment`);
      setEquipment(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchHandoverNotes = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shift-handover`);
      setHandoverNotes(res.data || []);
    } catch (err) { console.error(err); }
  };

  const toggleVolunteerDeploy = async (vol) => {
    const newStatus = vol.availability === "Deployed" ? "Available" : "Deployed";
    try {
      await axios.put(`${API_BASE}/volunteers/${vol.id}/status`, { availability: newStatus });
      fetchVolunteers();
    } catch (err) {
      alert("Failed to update volunteer status.");
    }
  };

  const fetchEvents = async () => {
    try {
      const res = await axios.get(`${API_BASE}/events`);
      setEvents(res.data || []);
    } catch (err) { console.error(err); }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title.trim()) return alert("Event title is required.");
    try {
      await axios.post(`${API_BASE}/events`, newEvent);
      setNewEvent({ title: "", location: "", event_date: "", event_type: "Emergency Drill", notes: "" });
      setShowEventForm(false);
      fetchEvents();
      alert("Event created successfully!");
    } catch (err) {
      alert("Failed to create emergency event.");
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!confirm("Delete this emergency drill/event?")) return;
    try {
      await axios.delete(`${API_BASE}/events/${id}`);
      fetchEvents();
    } catch (err) {
      alert("Failed to delete event.");
    }
  };

  const handleBulkDeleteUsers = async () => {
    if (selectedUserIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedUserIds.length} selected users?`)) return;
    try {
      for (const id of selectedUserIds) {
        await axios.delete(`${API_BASE}/users/${id}`);
      }
      setSelectedUserIds([]);
      fetchUsers();
      alert("Selected users deleted successfully!");
    } catch (err) {
      alert("Failed during bulk deletion.");
    }
  };

  const handleBulkDeleteReports = async () => {
    if (selectedReportIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedReportIds.length} selected reports?`)) return;
    try {
      for (const id of selectedReportIds) {
        await axios.delete(`${API_BASE}/community-reports/${id}`);
      }
      setSelectedReportIds([]);
      fetchCommunityReports();
      alert("Selected reports deleted successfully!");
    } catch (err) {
      alert("Failed during bulk deletion.");
    }
  };

  const downloadCSV = (data, filename) => {
    if (!data || !data.length) {
      alert("No data available to export.");
      return;
    }
    const keys = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push(keys.join(","));
    data.forEach(row => {
      const values = keys.map(k => {
        const val = row[k] === null || row[k] === undefined ? "" : String(row[k]).replace(/"/g, '""');
        return `"${val}"`;
      });
      csvRows.push(values.join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    a.click();
  };

  const handleCreateShelter = async (e) => {
    e.preventDefault();
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (newShelter.contact && !phoneRegex.test(newShelter.contact.trim().replace(/[\s-]/g, ""))) {
      alert(t("invalidPhoneFormat"));
      return;
    }
    if (newShelter.capacity && (isNaN(newShelter.capacity) || parseInt(newShelter.capacity, 10) <= 0)) {
      alert(t("capacityMustBePositive"));
      return;
    }
    try {
      await axios.post(`${API_BASE}/shelters`, newShelter);
      setShowShelterForm(false);
      setNewShelter({ name: "", address: "", capacity: "", contact: "" });
      fetchShelters();
      alert("Shelter created successfully!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create shelter.");
    }
  };

  const handleDeleteShelter = async (id) => {
    if (!confirm("Delete this shelter?")) return;
    try {
      await axios.delete(`${API_BASE}/shelters/${id}`);
      fetchShelters();
    } catch (err) {
      alert("Failed to delete shelter.");
    }
  };

  const handleRetrainModel = async (e) => {
    e.preventDefault();
    if (!retrainFile) return;
    setRetraining(true);
    setRetrainResult(null);
    const form = new FormData();
    form.append("file", retrainFile);
    try {
      const res = await axios.post(`${API_BASE}/admin/retrain-model`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setRetrainResult({ ok: res.data.deployed, message: res.data.message });
      if (res.data.deployed) fetchAccuracyHistory();
    } catch (err) {
      setRetrainResult({ ok: false, message: err.response?.data?.message || "Retraining failed." });
    } finally {
      setRetraining(false);
    }
  };

  const handleCreateHospital = async (e) => {
    e.preventDefault();
    const phoneRegex = /^(\+92|0)[0-9]{9,10}$/;
    if (newHospital.contact && !phoneRegex.test(newHospital.contact.trim().replace(/[\s-]/g, ""))) {
      alert(t("invalidPhoneFormat"));
      return;
    }
    try {
      await axios.post(`${API_BASE}/hospitals`, newHospital);
      setShowHospitalForm(false);
      setNewHospital({ name: "", address: "", contact: "", services: "" });
      fetchHospitals();
      alert("Hospital registered successfully!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create hospital.");
    }
  };

  const handleDeleteHospital = async (id) => {
    if (!confirm("Delete this hospital?")) return;
    try {
      await axios.delete(`${API_BASE}/hospitals/${id}`);
      fetchHospitals();
    } catch (err) {
      alert("Failed to delete hospital.");
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users`);
      setUsers(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/alerts`);
      setAlerts(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPredictions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/predictions`);
      setPredictions(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      const response = await axios.delete(`${API_BASE}/users/${userId}`);
      if (response.data.message) {
        alert("User deleted successfully!");
      }
      fetchUsers();
    } catch (err) {
      console.error("User deletion error:", err);
      alert("Failed to delete user.");
    }
  };

  const downloadReport = (type) => {
    try {
      let data, filename;
      switch(type) {
        case 'users':
          data = JSON.stringify(users, null, 2);
          filename = 'users_report.json';
          break;
        case 'alerts':
          data = JSON.stringify(alerts, null, 2);
          filename = 'alerts_report.json';
          break;
        case 'predictions':
          data = JSON.stringify(predictions, null, 2);
          filename = 'predictions_report.json';
          break;
        default:
          return;
      }
      const blob = new Blob([data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} report downloaded successfully!`);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download report.');
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(newUser.email.trim())) {
      alert(t("invalidEmailFormat"));
      return;
    }
    if (newUser.password.length < 6) {
      alert(t("passwordTooShort"));
      return;
    }
    try {
      const response = await axios.post(`${API_BASE}/users`, {
        ...newUser,
        status: "Active"
      });
      if (response.data.message) {
        alert("User created successfully!");
      }
      setShowCreateUser(false);
      setNewUser({ name: "", email: "", password: "", role: "citizen" });
      fetchUsers();
    } catch (err) {
      console.error("User creation error:", err);
      alert(err.response?.data?.error || "Failed to create user.");
    }
  };

  const handleCreateAlert = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_BASE}/alerts`, newAlert);
      if (response.data.message) {
        alert("Alert created successfully!");
      }
      setShowAlertModal(false);
      setNewAlert({ message: "", location: "", risk: "Medium" });
      fetchAlerts();
    } catch (err) {
      console.error("Alert creation error:", err);
      alert(err.response?.data?.error || "Failed to create alert.");
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case "citizen": return "bg-green-500/20 text-green-400 border-green-500/50";
      case "rescue_worker": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
      case "government_official": return "bg-teal-500/20 text-teal-400 border-teal-500/50";
      case "admin": return "bg-red-500/20 text-red-400 border-red-500/50";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  const getRiskColor = (risk) => {
    switch (risk?.toLowerCase()) {
      case "low": return "text-green-400";
      case "medium": return "text-yellow-400";
      case "high": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const getRoleDisplayName = (role) => {
    switch (role) {
      case "citizen": return t("citizenSingular");
      case "rescue_worker": return t("rescueWorkerSingular");
      case "government_official": return t("govOfficials");
      case "admin": return t("adminPanel");
      default: return role;
    }
  };

  const statistics = {
    totalUsers: users.length,
    citizens: users.filter(u => u.role === "citizen").length,
    rescueWorkers: users.filter(u => u.role === "rescue_worker").length,
    governmentOfficials: users.filter(u => u.role === "government_official").length,
    admins: users.filter(u => u.role === "admin").length,
    totalAlerts: alerts.length,
    highRiskAlerts: alerts.filter(a => a.risk === "High").length,
    totalPredictions: predictions.length,
    overflowShelters: shelters.filter(s => ((s.current_occupancy || s.occupancy || 0) / (s.capacity || 100)) >= 0.9).length,
    overflowHospitals: hospitals.filter(h => ((h.occupancy || 0) / (h.capacity || 50)) >= 0.9).length,
    pendingReports: communityReports.filter(r => r.status === "Submitted").length,
    activeRescueOps: rescueOps.filter(o => o.status !== "Completed").length,
    activeVolunteers: volunteers.filter(v => v.availability !== "Deployed").length,
  };

  const filteredPredictions = predictions.filter(p => {
    if (predictionFilters.risk !== "All" && p.risk !== predictionFilters.risk) return false;
    if (predictionFilters.from && new Date(p.created_at) < new Date(predictionFilters.from)) return false;
    if (predictionFilters.to && new Date(p.created_at) > new Date(predictionFilters.to + "T23:59:59")) return false;
    return true;
  });

  const filteredUsers = users.filter(u => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.role || "").toLowerCase().includes(q);
  });

  const filteredShelters = shelters.filter(s => {
    const q = shelterSearch.trim().toLowerCase();
    if (!q) return true;
    return (s.name || "").toLowerCase().includes(q) || (s.address || "").toLowerCase().includes(q);
  });

  const filteredHospitals = hospitals.filter(h => {
    const q = hospitalSearch.trim().toLowerCase();
    if (!q) return true;
    return (h.name || "").toLowerCase().includes(q) || (h.address || "").toLowerCase().includes(q);
  });

  const fetchLogs = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/logs`);
      setLogs(res.data || []);
    } catch (err) {
      console.error("Failed to load logs:", err);
    }
  };

  const navigationSections = [
    { id: 'overview', label: 'Command Center', icon: '📊', badge: null, desc: 'High-level metrics, real-time map, & department access' },
    { id: 'users', label: 'User Accounts', icon: '👥', badge: users.length, desc: 'Manage system credentials, roles, & registrations' },
    { id: 'reports', label: 'Citizen Reports', icon: '🗂️', badge: communityReports.filter(r => r.status === 'Submitted').length, desc: 'Incident moderation, status transitions, & analytics' },
    { id: 'facilities', label: 'Shelters & Hospitals', icon: '🏢', badge: shelters.length + hospitals.length, desc: 'Disaster relief camps, hospital beds, & overflow tracking' },
    { id: 'alerts', label: 'Alerts & Advisories', icon: '🚨', badge: alerts.length, desc: 'Emergency warnings, predictions forecast, & advisories' },
    { id: 'ground', label: 'Ground Ops & Logistics', icon: '🦺', badge: volunteers.length, desc: 'Volunteers roster, donation pledges, & field gear' },
    { id: 'aimodel', label: 'AI Model & Analytics', icon: '🤖', badge: null, desc: 'Machine learning retraining, accuracy logs, & confidence trends' },
    { id: 'events_logs', label: 'System Logs & Reports', icon: '📋', badge: null, desc: 'System activity audit logs & JSON data exports' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-ink text-parchment font-sans">
        <Navbar />
        <div className="pt-24 pb-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-400 mx-auto"></div>
              <p className="mt-4 text-muted">Loading Admin Command Center...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f18] via-[#0d1522] to-[#0a0f18] text-parchment font-sans flex flex-col justify-between">
      <Navbar />

      <div className="pt-20 pb-16 flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">

          {/* Top Administrative Bar */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-4 sm:p-5 border border-white/10 shadow-2xl mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400">Admin Command Console</span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl text-parchment leading-tight mt-0.5">
                {navigationSections.find(s => s.id === activeSection)?.icon} {navigationSections.find(s => s.id === activeSection)?.label}
              </h1>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1.5">
                <span>🛡️</span>
                <span>Administrator</span>
              </div>
            </div>
          </div>

          {/* Navigation Dropdown Menu */}
          <div className="relative mb-6">
            <button
              onClick={() => setNavOpen(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 bg-white/[0.05] border border-white/15 rounded-2xl text-sm font-semibold text-parchment hover:bg-white/10 transition-all cursor-pointer shadow-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{navigationSections.find(s => s.id === activeSection)?.icon}</span>
                <span>{navigationSections.find(s => s.id === activeSection)?.label}</span>
              </div>
              <span className="text-muted text-xs">{navOpen ? '▲' : '▼'}</span>
            </button>

            {navOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 z-40 bg-[#0c131f] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-2">
                  {navigationSections.map((sec) => {
                    const isActive = activeSection === sec.id;
                    return (
                      <button
                        key={sec.id}
                        onClick={() => { setActiveSection(sec.id); setNavOpen(false); }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left ${
                          isActive
                            ? 'bg-amber-500 text-ink font-bold shadow-md shadow-amber-500/20'
                            : 'text-muted hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <span className="text-base shrink-0">{sec.icon}</span>
                        <span className="truncate">{sec.label}</span>
                        {sec.badge !== null && (
                          <span className={`ml-auto text-[10px] px-1.5 rounded-full font-mono shrink-0 ${
                            isActive ? 'bg-black text-amber-300' : 'bg-white/15 text-white'
                          }`}>
                            {sec.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* SECTION 1: COMMAND CENTER OVERVIEW & INTERACTIVE CARDS                    */}
          {/* ========================================================================= */}
          {activeSection === 'overview' && (
            <div className="space-y-8 animate-fadeIn">
              {/* Quick Stat Tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Total Users</div>
                  <div className="text-2xl font-display text-parchment mt-1">{statistics.totalUsers}</div>
                  <div className="text-[10px] text-teal-400 mt-0.5">{statistics.citizens} Citizens</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Rescue Team</div>
                  <div className="text-2xl font-display text-amber-400 mt-1">{statistics.rescueWorkers}</div>
                  <div className="text-[10px] text-muted mt-0.5">{statistics.activeRescueOps} active ops</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Gov Staff</div>
                  <div className="text-2xl font-display text-teal-300 mt-1">{statistics.governmentOfficials}</div>
                  <div className="text-[10px] text-muted mt-0.5">{advisories.length} advisories</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Shelters</div>
                  <div className="text-2xl font-display text-emerald-400 mt-1">{shelters.length}</div>
                  <div className="text-[10px] text-red-400 mt-0.5">{statistics.overflowShelters} at capacity</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Hospitals</div>
                  <div className="text-2xl font-display text-emerald-300 mt-1">{hospitals.length}</div>
                  <div className="text-[10px] text-red-400 mt-0.5">{statistics.overflowHospitals} at capacity</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Alerts Active</div>
                  <div className="text-2xl font-display text-red-400 mt-1">{statistics.totalAlerts}</div>
                  <div className="text-[10px] text-red-300 mt-0.5">{statistics.highRiskAlerts} high-risk</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Citizen Reports</div>
                  <div className="text-2xl font-display text-marigold-400 mt-1">{communityReports.length}</div>
                  <div className="text-[10px] text-amber-300 mt-0.5">{statistics.pendingReports} pending</div>
                </div>
                <div className="bg-white/[0.04] p-4 rounded-xl border border-white/10">
                  <div className="text-xs text-muted">Volunteers</div>
                  <div className="text-2xl font-display text-indigo-400 mt-1">{volunteers.length}</div>
                  <div className="text-[10px] text-emerald-300 mt-0.5">{statistics.activeVolunteers} ready</div>
                </div>
              </div>

              {/* Department Navigation Cards Grid */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">🧭 Administrative Departments & Control Panels</h2>
                    <p className="text-sm text-muted">Select any department card below or use the burger menu above to access dedicated controls.</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Users */}
                  <div
                    onClick={() => setActiveSection('users')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-teal-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          👥
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-teal-500/20 text-teal-300">
                          {users.length} Users
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">User Management</h3>
                      <p className="text-xs text-muted mb-4">Manage accounts, create users, assign roles (citizens, rescue, government), and manage credentials.</p>
                    </div>
                    <div className="text-xs text-teal-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Open User Controls</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 2: Reports */}
                  <div
                    onClick={() => setActiveSection('reports')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-amber-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🗂️
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300">
                          {communityReports.length} Reports
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">Citizen Incident Reports</h3>
                      <p className="text-xs text-muted mb-4">Moderate citizen submissions, review severity, convert to alerts or dispatch rescue ops.</p>
                    </div>
                    <div className="text-xs text-amber-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Moderate Reports</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 3: Facilities */}
                  <div
                    onClick={() => setActiveSection('facilities')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-emerald-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🏢
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300">
                          {shelters.length + hospitals.length} Facilities
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">Shelters & Hospitals Hub</h3>
                      <p className="text-xs text-muted mb-4">Manage relief shelter camps, emergency hospitals, live bed occupancy, & overload monitors.</p>
                    </div>
                    <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Manage Facilities</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 4: Alerts */}
                  <div
                    onClick={() => setActiveSection('alerts')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-red-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🚨
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-red-500/20 text-red-300">
                          {alerts.length} Alerts
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">Alerts, Forecasts & Advisories</h3>
                      <p className="text-xs text-muted mb-4">Broadcast emergency alerts, view AI predictions history, & manage public advisories.</p>
                    </div>
                    <div className="text-xs text-red-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Manage Warnings</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 5: Ground Ops */}
                  <div
                    onClick={() => setActiveSection('ground')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-indigo-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🦺
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300">
                          {volunteers.length} Volunteers
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">Ground Ops & Logistics</h3>
                      <p className="text-xs text-muted mb-4">Registered volunteers roster, donation pledges, emergency relief equipment, & handover notes.</p>
                    </div>
                    <div className="text-xs text-indigo-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Review Ground Ops</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 6: AI Model */}
                  <div
                    onClick={() => setActiveSection('aimodel')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-purple-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🤖
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-purple-500/20 text-purple-300">
                          AI Engine
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">AI Model & Analytics</h3>
                      <p className="text-xs text-muted mb-4">Retrain Random Forest flood prediction model from CSV, view accuracy history & confidence charts.</p>
                    </div>
                    <div className="text-xs text-purple-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Model Analytics</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 7: Logs & Reports */}
                  <div
                    onClick={() => setActiveSection('events_logs')}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-blue-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          📋
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-500/20 text-blue-300">
                          Audit
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">System Audit Logs & Reports</h3>
                      <p className="text-xs text-muted mb-4">View real-time system audit logs, security streams, & download JSON summary reports.</p>
                    </div>
                    <div className="text-xs text-blue-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>View Logs & Reports</span>
                      <span>→</span>
                    </div>
                  </div>

                  {/* Card 8: Live Map */}
                  <div
                    onClick={() => {
                      const el = document.getElementById('command-center-map');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-cyan-500/40 rounded-2xl p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-lg hover:scale-[1.02]"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          🗺️
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300">
                          GIS Live
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-lg mb-1">Interactive Map & GIS</h3>
                      <p className="text-xs text-muted mb-4">View spatial distribution of flood zones, shelters, hospitals, & reported road blocks.</p>
                    </div>
                    <div className="text-xs text-cyan-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Inspect Live Map</span>
                      <span>↓</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Live Map Section */}
              <div id="command-center-map" className="dashboard-card p-6 border border-white/10 rounded-2xl">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">🗺️ National Flood & Facilities Situation Map</h2>
                    <p className="text-sm text-muted">Geographical distribution of emergency shelters, hospitals, & blocked transit roads.</p>
                  </div>
                  <button
                    onClick={() => setActiveSection('facilities')}
                    className="btn-secondary text-xs py-2 px-3"
                  >
                    Manage Facility Locations →
                  </button>
                </div>
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <FloodMap height={420} canEdit={true} />
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 2: USER MANAGEMENT                                                */}
          {/* ========================================================================= */}
          {activeSection === 'users' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
              </div>

              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">👥 Registered User Accounts</h2>
                    <p className="text-sm text-muted mt-0.5">Manage citizens, rescue staff, government officials, and system admins.</p>
                  </div>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name, email, or role..."
                    className="field-input py-2 px-4 text-xs w-full sm:w-72"
                  />
                </div>

                <div className="max-h-[500px] overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-ink-soft z-10 border-b border-white/20 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4 text-muted">User Name</th>
                        <th className="py-3 px-4 text-muted">Email / ID</th>
                        <th className="py-3 px-4 text-muted">System Role</th>
                        <th className="py-3 px-4 text-muted">Status</th>
                        <th className="py-3 px-4 text-muted">Joined Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-muted">No users matched your search.</td>
                        </tr>
                      ) : (
                        filteredUsers.map((user, index) => (
                          <tr key={index} className="hover:bg-white/5 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-teal-400 to-marigold-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                  {(user.name || "U").charAt(0).toUpperCase()}
                                </div>
                                <span className="text-white font-medium">{user.name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-muted text-xs font-mono">{user.email}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleColor(user.role)}`}>
                                {getRoleDisplayName(user.role)}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                {user.status || 'Active'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-muted text-xs">
                              {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
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
          {/* SECTION 3: CITIZEN REPORTS MODERATION & ANALYTICS                         */}
          {/* ========================================================================= */}
          {activeSection === 'reports' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
                {selectedReportIds.length > 0 && (
                  <button
                    onClick={handleBulkDeleteReports}
                    className="px-3 py-2 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30"
                  >
                    Delete Selected Reports ({selectedReportIds.length})
                  </button>
                )}
              </div>

              <div className="dashboard-card p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">🗂️ Citizen Reports Moderation & Analytics Hub</h2>
                    <p className="text-sm text-muted mt-1">Review emergency submissions, verify severity, and dispatch relief ops.</p>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    {["All", "Submitted", "Reviewed", "Action Taken", "Completed"].map(f => (
                      <button
                        key={f}
                        onClick={() => setReportsFilter(f)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors border cursor-pointer ${
                          reportsFilter === f
                            ? "bg-teal-500 border-teal-400 text-white shadow-md shadow-teal-500/20"
                            : "bg-white/5 border-white/20 text-muted hover:bg-white/10"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reports Analytics Breakdown Hub */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
                  <div>
                    <div className="text-xs text-muted font-medium mb-1">Total Received Reports</div>
                    <div className="text-2xl font-display text-parchment">{communityReports.length}</div>
                    <div className="text-xs text-teal-400 mt-1">
                      Completed: {communityReports.filter(r => r.status === "Completed" || r.status === "Resolved").length} ({communityReports.length ? Math.round((communityReports.filter(r => r.status === "Completed" || r.status === "Resolved").length / communityReports.length) * 100) : 0}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-medium mb-1.5">Severity Distribution</div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between text-red-400">
                        <span>Critical / High</span>
                        <span>{communityReports.filter(r => r.severity === "Critical" || r.severity === "High").length}</span>
                      </div>
                      <div className="flex justify-between text-amber-400">
                        <span>Medium</span>
                        <span>{communityReports.filter(r => r.severity === "Medium").length}</span>
                      </div>
                      <div className="flex justify-between text-green-400">
                        <span>Low</span>
                        <span>{communityReports.filter(r => r.severity === "Low" || !r.severity).length}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-medium mb-1.5">Resolution Progress</div>
                    <div className="w-full bg-white/10 rounded-full h-3.5 overflow-hidden flex">
                      <div style={{ width: `${communityReports.length ? (communityReports.filter(r => r.status === "Completed" || r.status === "Resolved").length / communityReports.length) * 100 : 0}%` }} className="bg-emerald-400 h-full" title="Completed"></div>
                      <div style={{ width: `${communityReports.length ? (communityReports.filter(r => r.status === "Action Taken" || r.status === "In Progress").length / communityReports.length) * 100 : 0}%` }} className="bg-teal-400 h-full" title="Action Taken"></div>
                      <div style={{ width: `${communityReports.length ? (communityReports.filter(r => r.status === "Submitted").length / communityReports.length) * 100 : 0}%` }} className="bg-amber-400 h-full" title="Submitted"></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted mt-1.5">
                      <span className="text-emerald-400">● Done</span>
                      <span className="text-teal-400">● In Ops</span>
                      <span className="text-amber-400">● Pending</span>
                    </div>
                  </div>
                </div>

                {/* Reports List */}
                {(() => {
                  const isReportInFilter = (r, filter) => {
                    if (filter === "All") return true;
                    if (filter === "Submitted") return r.status === "Submitted";
                    if (filter === "Reviewed") return r.status === "Reviewed" || r.status === "Under Review" || r.status === "Approved";
                    if (filter === "Action Taken") return r.status === "Action Taken" || r.status === "In Progress" || r.status === "Converted to Alert" || r.status === "Converted to Rescue Op";
                    if (filter === "Completed") return r.status === "Completed" || r.status === "Resolved";
                    return r.status === filter;
                  };
                  const filteredList = communityReports.filter(r => isReportInFilter(r, reportsFilter));

                  if (filteredList.length === 0) {
                    return (
                      <div className="text-center py-12 text-muted bg-white/[0.02] rounded-xl border border-white/5">
                        <div className="text-4xl mb-2">📋</div>
                        <p>No reports found in category "{reportsFilter}".</p>
                      </div>
                    );
                  }

                  return (
                    <div className="max-h-[500px] overflow-y-auto pr-1 space-y-3 custom-scroll">
                      {filteredList.map((report, i) => {
                        const severityColor = report.severity === "High" || report.severity === "Critical"
                          ? "text-red-400 bg-red-500/10 border-red-500/30"
                          : report.severity === "Medium"
                          ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                          : "text-green-400 bg-green-500/10 border-green-500/30";

                        const statusColor = report.status === "Completed" || report.status === "Resolved" ? "text-emerald-400"
                          : report.status === "Reviewed" || report.status === "Approved" ? "text-blue-400"
                          : report.status === "Action Taken" || report.status === "In Progress" || report.status === "Converted to Alert" || report.status === "Converted to Rescue Op" ? "text-teal-400"
                          : "text-amber-400";

                        return (
                          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all">
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className="text-xs text-muted font-mono">{report.trackingId || report.tracking_id || `#${report.id}`}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${severityColor}`}>
                                    {report.severity || "—"}
                                  </span>
                                  <span className={`text-xs font-semibold ${statusColor}`}>
                                    ● {report.status}
                                  </span>
                                </div>
                                <h4 className="text-white font-semibold text-lg mb-1">
                                  {report.type || report.incident_type || "Incident"} — {report.location}
                                </h4>
                                <p className="text-muted text-sm mb-2">{report.description}</p>
                                <div className="flex flex-wrap gap-4 text-xs text-muted">
                                  <span>👤 {report.authorName || report.author_name || "Anonymous"}</span>
                                  <span>📧 {report.authorEmail || report.author_email || "—"}</span>
                                  <span>📍 {report.region || "—"}</span>
                                  <span>🕐 {report.createdAt || report.created_at ? new Date(report.createdAt || report.created_at).toLocaleString() : "—"}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 4: GROUND FACILITIES (SHELTERS & HOSPITALS)                       */}
          {/* ========================================================================= */}
          {activeSection === 'facilities' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowShelterForm(v => !v)}
                    className="btn-secondary text-xs py-2 px-3 cursor-pointer"
                  >
                    {showShelterForm ? 'Cancel Shelter' : '+ Add Shelter'}
                  </button>
                  <button
                    onClick={() => setShowHospitalForm(v => !v)}
                    className="btn-primary text-xs py-2 px-3 cursor-pointer"
                  >
                    {showHospitalForm ? 'Cancel Hospital' : '+ Add Hospital'}
                  </button>
                </div>
              </div>

              {/* Add Shelter Form (collapsible) */}
              {showShelterForm && (
                <div className="dashboard-card p-6 bg-teal-500/[0.03] border-teal-500/30">
                  <h3 className="font-display text-xl text-teal-300 mb-3">Add Emergency Shelter</h3>
                  <form onSubmit={handleCreateShelter} className="grid gap-3 md:grid-cols-2">
                    <input required placeholder="Shelter Name" value={newShelter.name} onChange={(e) => setNewShelter(p => ({ ...p, name: e.target.value }))} className="field-input py-2.5" />
                    <input required placeholder="Address / Location" value={newShelter.address} onChange={(e) => setNewShelter(p => ({ ...p, address: e.target.value }))} className="field-input py-2.5" />
                    <input type="number" placeholder="Max Capacity (e.g. 200)" value={newShelter.capacity} onChange={(e) => setNewShelter(p => ({ ...p, capacity: e.target.value }))} className="field-input py-2.5" />
                    <input placeholder="Contact Phone (+92...)" value={newShelter.contact} onChange={(e) => setNewShelter(p => ({ ...p, contact: e.target.value }))} className="field-input py-2.5" />
                    <button type="submit" className="md:col-span-2 btn-primary py-2.5">Save Shelter</button>
                  </form>
                </div>
              )}

              {/* Add Hospital Form (collapsible) */}
              {showHospitalForm && (
                <div className="dashboard-card p-6 bg-emerald-500/[0.03] border-emerald-500/30">
                  <h3 className="font-display text-xl text-emerald-300 mb-3">Add Emergency Hospital / Trauma Center</h3>
                  <form onSubmit={handleCreateHospital} className="grid gap-3 md:grid-cols-2">
                    <input required placeholder="Hospital Name" value={newHospital.name} onChange={(e) => setNewHospital(p => ({ ...p, name: e.target.value }))} className="field-input py-2.5" />
                    <input required placeholder="Address / City" value={newHospital.address} onChange={(e) => setNewHospital(p => ({ ...p, address: e.target.value }))} className="field-input py-2.5" />
                    <input placeholder="Emergency Contact Phone" value={newHospital.contact} onChange={(e) => setNewHospital(p => ({ ...p, contact: e.target.value }))} className="field-input py-2.5" />
                    <input placeholder="Services (e.g. Emergency, ICU, Trauma)" value={newHospital.services} onChange={(e) => setNewHospital(p => ({ ...p, services: e.target.value }))} className="field-input py-2.5" />
                    <button type="submit" className="md:col-span-2 btn-primary py-2.5">Save Hospital</button>
                  </form>
                </div>
              )}

              {/* Live Capacity & Overflow Monitors */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Shelter Monitor */}
                <div className="dashboard-card p-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-display text-xl text-parchment">🏢 Shelter Occupancy Monitor</h3>
                      <p className="text-xs text-muted mt-0.5">Live headcount vs shelter capacity</p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      {statistics.overflowShelters} Overloaded
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-3 pr-1 custom-scroll">
                    {shelters.map((s) => {
                      const current = s.current_occupancy || s.occupancy || 0;
                      const capacity = s.capacity || 100;
                      const pct = Math.min(Math.round((current / capacity) * 100), 100);
                      const isCritical = pct >= 90;
                      return (
                        <div key={s.id} className="bg-white/5 p-3 rounded-xl border border-white/10">
                          <div className="flex justify-between text-xs mb-1.5 font-medium">
                            <span className="text-white truncate max-w-[200px]">{s.name}</span>
                            <span className={isCritical ? "text-red-400 font-bold" : "text-teal-400"}>{current}/{capacity} ({pct}%)</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-2">
                            <div style={{ width: `${pct}%` }} className={`h-2 rounded-full ${isCritical ? 'bg-red-500' : 'bg-teal-500'}`}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Hospital Monitor */}
                <div className="dashboard-card p-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-display text-xl text-parchment">🏥 Hospital Bed Capacity Monitor</h3>
                      <p className="text-xs text-muted mt-0.5">Live patient bed occupancy</p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      {statistics.overflowHospitals} Overloaded
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-3 pr-1 custom-scroll">
                    {hospitals.map((h) => {
                      const current = h.occupancy || 0;
                      const capacity = h.capacity || 50;
                      const pct = Math.min(Math.round((current / capacity) * 100), 100);
                      const isCritical = pct >= 90;
                      return (
                        <div key={h.id} className="bg-white/5 p-3 rounded-xl border border-white/10">
                          <div className="flex justify-between text-xs mb-1.5 font-medium">
                            <span className="text-white truncate max-w-[200px]">{h.name}</span>
                            <span className={isCritical ? "text-red-400 font-bold" : "text-emerald-400"}>{current}/{capacity} ({pct}%)</span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-2">
                            <div style={{ width: `${pct}%` }} className={`h-2 rounded-full ${isCritical ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Registered Shelters Directory */}
              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-display text-2xl text-parchment">🏢 Registered Emergency Shelters</h3>
                    <p className="text-xs text-muted mt-0.5">{filteredShelters.length} shelters registered</p>
                  </div>
                  <input
                    type="text"
                    value={shelterSearch}
                    onChange={(e) => setShelterSearch(e.target.value)}
                    placeholder="Search shelters by name or city..."
                    className="field-input py-2 px-3 text-xs w-full sm:w-64"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto pr-1 space-y-0 custom-scroll">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredShelters.map((s) => (
                      <div key={s.id} className="bg-white/8 rounded-xl p-4 border border-white/10 hover:border-teal-500/40 transition-all flex flex-col justify-between gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-white text-sm truncate">{lang === "ur" && s.name_ur ? s.name_ur : s.name}</h4>
                            <p className="text-xs text-muted truncate mt-0.5">📍 {s.address}</p>
                          </div>
                          <button onClick={() => handleDeleteShelter(s.id)} className="shrink-0 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20">
                            ✕
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {s.capacity && <span className="px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400">Cap: {s.capacity}</span>}
                          {s.contact && <span className="px-2 py-0.5 rounded-full bg-white/10 text-muted">{s.contact}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Registered Hospitals Directory */}
              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-display text-2xl text-parchment">🏥 Registered Hospitals & Medical Centers</h3>
                    <p className="text-xs text-muted mt-0.5">{filteredHospitals.length} hospitals registered</p>
                  </div>
                  <input
                    type="text"
                    value={hospitalSearch}
                    onChange={(e) => setHospitalSearch(e.target.value)}
                    placeholder="Search hospitals by name or city..."
                    className="field-input py-2 px-3 text-xs w-full sm:w-64"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto pr-1 space-y-0 custom-scroll">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredHospitals.map((h) => (
                      <div key={h.id} className="bg-white/8 rounded-xl p-4 border border-white/10 hover:border-emerald-500/40 transition-all flex flex-col justify-between gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-white text-sm truncate">{lang === "ur" && h.name_ur ? h.name_ur : h.name}</h4>
                            <p className="text-xs text-muted truncate mt-0.5">📍 {h.address}</p>
                          </div>
                          <button onClick={() => handleDeleteHospital(h.id)} className="shrink-0 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20">
                            ✕
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {h.services && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium truncate max-w-full">🏥 {h.services}</span>}
                          {h.contact && <span className="px-2 py-0.5 rounded-full bg-white/10 text-muted">{h.contact}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 5: ALERTS, FORECASTS & ADVISORIES                                 */}
          {/* ========================================================================= */}
          {activeSection === 'alerts' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
                <button
                  onClick={() => setShowAlertModal(true)}
                  className="btn-primary text-xs py-2 px-4 cursor-pointer"
                >
                  + Create Emergency Alert
                </button>
              </div>

              {/* Active Alerts */}
              <div className="dashboard-card p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-display text-2xl text-parchment">🚨 Active Emergency Alerts</h2>
                  <span className="text-xs text-muted">{alerts.length} active alerts</span>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-3 pr-1 custom-scroll">
                  {alerts.length === 0 ? (
                    <p className="text-muted text-sm py-4">No active emergency alerts recorded.</p>
                  ) : (
                    alerts.map((alert, index) => (
                      <div key={index} className="bg-white/10 rounded-xl p-4 border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getRiskColor(alert.risk)} bg-white/10`}>
                              {alert.risk} Risk
                            </span>
                            <span className="text-white font-semibold text-base">{alert.message}</span>
                          </div>
                          <p className="text-xs text-muted">📍 {alert.location} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : "Live"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {alert.status !== "Cancelled" && (
                            <button
                              onClick={async () => {
                                try {
                                  await axios.put(`${API_BASE}/alerts/${alert.id}`, { status: 'Cancelled' });
                                  fetchAlerts();
                                } catch (err) { console.error(err); }
                              }}
                              className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-muted"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              if (!confirm('Delete alert?')) return;
                              try {
                                await axios.delete(`${API_BASE}/alerts/${alert.id}`);
                                fetchAlerts();
                              } catch (err) { console.error(err); }
                            }}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Predictions View */}
              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">🌧️ AI Flood Risk Forecasts History</h2>
                    <p className="text-xs text-muted">Filtered results: {filteredPredictions.length} predictions</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={predictionFilters.risk}
                      onChange={(e) => setPredictionFilters(p => ({ ...p, risk: e.target.value }))}
                      className="field-input py-1.5 px-3 text-xs"
                    >
                      <option value="All">All Risk Levels</option>
                      <option value="High">High Risk Only</option>
                      <option value="Medium">Medium Risk Only</option>
                      <option value="Low">Low Risk Only</option>
                    </select>
                    <button
                      onClick={() => downloadCSV(filteredPredictions, "flood_predictions_export.csv")}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      Export CSV 📥
                    </button>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-ink-soft border-b border-white/15 text-muted">
                      <tr>
                        <th className="py-2.5 px-3">Location</th>
                        <th className="py-2.5 px-3">Risk</th>
                        <th className="py-2.5 px-3">Confidence</th>
                        <th className="py-2.5 px-3">Rainfall</th>
                        <th className="py-2.5 px-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredPredictions.map((p, i) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="py-2 px-3 text-white font-medium">📍 {p.location}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold ${getRiskColor(p.risk)} bg-white/5`}>{p.risk}</span>
                          </td>
                          <td className="py-2 px-3 text-muted">{p.confidence ? `${Math.round(p.confidence * 100)}%` : "—"}</td>
                          <td className="py-2 px-3 text-muted">{p.rainfall || "—"}</td>
                          <td className="py-2 px-3 text-muted">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Public Advisories Broadcasts */}
              <div className="dashboard-card p-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">📢 Government Public Advisories</h2>
                    <p className="text-xs text-muted">Official emergency notifications issued to citizens</p>
                  </div>
                  <span className="text-xs text-amber-400">{advisories.length} active</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-3 pr-1 custom-scroll">
                  {advisories.map((adv) => (
                    <div key={adv.id} className="bg-white/5 rounded-xl p-4 border border-white/10 flex justify-between items-start gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold bg-red-500/20 text-red-300 px-2 py-0.5 rounded">📍 {adv.region || "National"}</span>
                          <span className="text-white font-semibold text-sm">{adv.title}</span>
                        </div>
                        <p className="text-xs text-muted">{adv.message}</p>
                      </div>
                      <button onClick={() => handleDeleteAdvisory(adv.id)} className="text-xs text-red-400 hover:text-red-300 p-1.5 rounded bg-red-500/10 shrink-0">
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 6: GROUND OPERATIONS, VOLUNTEERS & RESOURCES                       */}
          {/* ========================================================================= */}
          {activeSection === 'ground' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
              </div>

              {/* Registered Volunteers */}
              <div className="dashboard-card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">👷 Registered Volunteers Roster</h2>
                    <p className="text-xs text-muted">{volunteers.length} registered relief volunteers</p>
                  </div>
                  <input
                    type="text"
                    value={volunteerSkillFilter}
                    onChange={(e) => setVolunteerSkillFilter(e.target.value)}
                    placeholder="Filter by skill or city..."
                    className="field-input py-1.5 px-3 text-xs w-full sm:w-60"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-ink-soft border-b border-white/15 text-muted">
                      <tr>
                        <th className="py-2.5 px-3">Volunteer Name</th>
                        <th className="py-2.5 px-3">Contact</th>
                        <th className="py-2.5 px-3">City</th>
                        <th className="py-2.5 px-3">Skills</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {volunteers.map((vol) => (
                        <tr key={vol.id} className="hover:bg-white/5">
                          <td className="py-2 px-3 text-white font-medium">{vol.name}</td>
                          <td className="py-2 px-3 text-muted">{vol.phone}</td>
                          <td className="py-2 px-3 text-muted">📍 {vol.city || "—"}</td>
                          <td className="py-2 px-3 text-teal-300">{vol.skills || "General Relief"}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              vol.availability === 'Deployed' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                            }`}>
                              {vol.availability || 'Available'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Donations & Equipment Grid */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Donations */}
                <div className="dashboard-card p-6">
                  <h3 className="font-display text-xl text-parchment mb-2">🎁 Relief Donations & Supplies Pledges</h3>
                  <p className="text-xs text-muted mb-4">{donations.length} incoming supplies recorded</p>
                  <div className="max-h-52 overflow-y-auto space-y-2 pr-1 custom-scroll">
                    {donations.map((d) => (
                      <div key={d.id} className="bg-white/5 p-3 rounded-xl border border-white/10 flex justify-between items-center text-xs">
                        <div>
                          <span className="text-white font-semibold">{d.quantity}x {d.item}</span>
                          <p className="text-muted text-[11px]">Donor: {d.donor_name || "Anonymous"} · {d.contact || "—"}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-semibold">{d.status || 'Pledged'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Equipment */}
                <div className="dashboard-card p-6">
                  <h3 className="font-display text-xl text-parchment mb-2">🚤 Emergency Rescue Equipment</h3>
                  <p className="text-xs text-muted mb-4">{equipment.length} assets registered in field</p>
                  <div className="max-h-52 overflow-y-auto space-y-2 pr-1 custom-scroll">
                    {equipment.map((eq) => (
                      <div key={eq.id} className="bg-white/5 p-3 rounded-xl border border-white/10 flex justify-between items-center text-xs">
                        <div>
                          <span className="text-white font-semibold">{eq.name} (Qty: {eq.quantity})</span>
                          <p className="text-muted text-[11px]">Location: 📍 {eq.city || "Field Base"}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold">Active</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Handover Notes */}
              <div className="dashboard-card p-6">
                <h3 className="font-display text-xl text-parchment mb-2">📝 Operational Shift Handover Notes</h3>
                <p className="text-xs text-muted mb-4">{handoverNotes.length} shift logs submitted by rescue teams</p>
                <div className="max-h-52 overflow-y-auto space-y-2 pr-1 custom-scroll">
                  {handoverNotes.map((hn) => (
                    <div key={hn.id} className="bg-white/5 p-3 rounded-xl border border-white/10 flex justify-between items-start text-xs">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${hn.priority === 'Urgent' ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-muted'}`}>{hn.priority || 'Normal'}</span>
                          <span className="text-white font-medium">{hn.note}</span>
                        </div>
                        <p className="text-[10px] text-muted">By: {hn.author || "Rescue Team"} · {hn.created_at ? new Date(hn.created_at).toLocaleString() : "Live"}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${hn.resolved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                        {hn.resolved ? 'Resolved' : 'Active'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 7: AI MODEL & ACCURACY ANALYTICS                                   */}
          {/* ========================================================================= */}
          {activeSection === 'aimodel' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
              </div>

              {/* Retrain Model */}
              <div className="dashboard-card p-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-semibold uppercase text-purple-400">ML Backend Engine</span>
                </div>
                <h2 className="font-display text-2xl text-parchment mb-2">🤖 Retrain Machine Learning Model</h2>
                <p className="text-sm text-muted mb-4 max-w-2xl">
                  Upload newly collected flood meteorological training data (.csv format) to retrain the Random Forest Classifier.
                </p>
                <form onSubmit={handleRetrainModel} className="flex flex-wrap items-center gap-4">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setRetrainFile(e.target.files[0])}
                    className="text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-parchment hover:file:bg-white/20 cursor-pointer"
                  />
                  <button
                    type="submit"
                    disabled={!retrainFile || retraining}
                    className="btn-primary text-xs py-2.5 px-4 disabled:opacity-50 cursor-pointer"
                  >
                    {retraining ? "Retraining Model..." : "Deploy Retrain Job"}
                  </button>
                </form>
                {retrainResult && (
                  <div className={`mt-4 rounded-xl p-3.5 text-sm ${
                    retrainResult.ok ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300" : "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                  }`}>
                    {retrainResult.message}
                  </div>
                )}
              </div>

              {/* Accuracy Charts */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Accuracy Chart */}
                <div className="dashboard-card p-6">
                  <h3 className="font-display text-xl text-parchment mb-1">📈 Model Accuracy History</h3>
                  <p className="text-xs text-muted mb-4">Accuracy % progression across retrain events</p>
                  <div className="h-64 w-full">
                    {accuracyHistory.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-muted">Retrain model to populate accuracy trend.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={accuracyHistory.map(d => ({ ...d, accuracy_pct: d.accuracy <= 1 ? parseFloat((d.accuracy * 100).toFixed(1)) : parseFloat(d.accuracy.toFixed(1)), label: d.timestamp ? d.timestamp.slice(0,10) : '' }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="label" stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} />
                          <YAxis domain={[0, 100]} stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px" }} formatter={(value) => [`${value}%`, "Model Accuracy"]} />
                          <Line type="monotone" dataKey="accuracy_pct" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981" }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Confidence Trend */}
                <div className="dashboard-card p-6">
                  <h3 className="font-display text-xl text-parchment mb-1">📊 Prediction Confidence Trend</h3>
                  <p className="text-xs text-muted mb-4">Average prediction certainty per day (%)</p>
                  <div className="h-64 w-full">
                    {confidenceTrend.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-muted">No historical confidence logs available yet.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={confidenceTrend.map(d => ({ ...d, conf_pct: d.avg_confidence <= 1 ? parseFloat((d.avg_confidence * 100).toFixed(1)) : parseFloat(d.avg_confidence.toFixed(1)) }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="date" stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} />
                          <YAxis domain={[0, 100]} stroke="#64748b" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px" }} formatter={(value) => [`${value}%`, "Avg Confidence"]} />
                          <Line type="monotone" dataKey="conf_pct" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b" }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 8: EMERGENCY DRILLS, SYSTEM LOGS & JSON EXPORTS                   */}
          {/* ========================================================================= */}
          {activeSection === 'events_logs' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <button
                  onClick={() => setActiveSection('overview')}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  ← Back to Command Center
                </button>
              </div>

              {/* System Audit Logs */}
              <div className="dashboard-card p-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="font-display text-2xl text-parchment">🔍 System Activity Audit Logs</h2>
                    <p className="text-xs text-muted">Live audit events & security activity</p>
                  </div>
                  <button
                    onClick={() => {
                      fetchLogs();
                      setShowLogs(v => !v);
                    }}
                    className="btn-secondary text-xs py-2 px-3"
                  >
                    {showLogs ? 'Hide Audit Stream' : 'Load Audit Stream'}
                  </button>
                </div>
                {showLogs && (
                  <div className="max-h-60 overflow-y-auto font-mono text-xs space-y-2 bg-black/40 p-4 rounded-xl border border-white/10 custom-scroll">
                    {logs.length === 0 ? (
                      <p className="text-muted">No audit logs recorded yet.</p>
                    ) : (
                      logs.map((lg, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-muted">[{new Date(lg.created_at || Date.now()).toLocaleTimeString()}]</span>
                          <span className={lg.level === 'error' ? 'text-red-400 font-bold' : lg.level === 'warning' ? 'text-amber-400' : 'text-teal-400'}>
                            [{lg.level?.toUpperCase()}]
                          </span>
                          <span className="text-parchment">{lg.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* System JSON Reports */}
              <div className="dashboard-card p-6">
                <h2 className="font-display text-2xl text-parchment mb-2">📥 Data Exports & System Reports</h2>
                <p className="text-sm text-muted mb-4">Download comprehensive administrative data in JSON format for offline archival.</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => downloadReport('users')}
                    className="bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Download Users Report (JSON) 👥
                  </button>
                  <button
                    onClick={() => downloadReport('alerts')}
                    className="bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/40 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Download Alerts Report (JSON) 🚨
                  </button>
                  <button
                    onClick={() => downloadReport('predictions')}
                    className="bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/40 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Download Predictions Report (JSON) 🌧️
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>



      {showAlertModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-ink-soft rounded-2xl p-8 max-w-md w-full border border-white/15 shadow-2xl">
            <h2 className="font-display text-2xl text-parchment mb-4">Broadcast Emergency Alert</h2>
            <form onSubmit={handleCreateAlert} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Alert Message</label>
                <input
                  type="text"
                  required
                  value={newAlert.message}
                  onChange={(e) => setNewAlert(p => ({ ...p, message: e.target.value }))}
                  className="field-input py-2.5 text-sm"
                  placeholder="e.g. Flash Flood Warning for Taunsa River Basin"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Affected Location / City</label>
                <input
                  type="text"
                  required
                  value={newAlert.location}
                  onChange={(e) => setNewAlert(p => ({ ...p, location: e.target.value }))}
                  className="field-input py-2.5 text-sm"
                  placeholder="e.g. Dera Ghazi Khan"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Risk Severity</label>
                <select
                  value={newAlert.risk}
                  onChange={(e) => setNewAlert(p => ({ ...p, risk: e.target.value }))}
                  className="field-input py-2.5 text-sm"
                >
                  <option value="High">High (Immediate Danger)</option>
                  <option value="Medium">Medium (Elevated Threat)</option>
                  <option value="Low">Low (Advisory Notice)</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button type="button" onClick={() => setShowAlertModal(false)} className="btn-secondary text-xs flex-1 py-2.5">
                  Cancel
                </button>
                <button type="submit" className="btn-primary text-xs flex-1 py-2.5 bg-red-600 hover:bg-red-500">
                  Broadcast Alert 🚨
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
};

export default AdminDashboard;
