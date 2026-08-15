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

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [rescueOps, setRescueOps] = useState([]);
  const [advisories, setAdvisories] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [handoverNotes, setHandoverNotes] = useState([]);
  const [volunteerSkillFilter, setVolunteerSkillFilter] = useState("");

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

  const toggleUserLock = async (user) => {
    const currentStatus = user.status ? user.status === "Active" : user.active !== false;
    const newStatus = currentStatus ? "Inactive" : "Active";
    try {
      await axios.put(`${API_BASE}/users/${user.id}/status`, { status: newStatus });
      fetchUsers();
    } catch (err) {
      alert("Failed to update user status.");
    }
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

  const toggleVerifyShelter = async (shelter) => {
    const newStatus = !shelter.verified;
    try {
      await axios.put(`${API_BASE}/shelters/${shelter.id}/verify`, { verified: newStatus });
      fetchShelters();
    } catch (err) {
      alert("Failed to update shelter verification.");
    }
  };

  const toggleVerifyHospital = async (hospital) => {
    const newStatus = !hospital.verified;
    try {
      await axios.put(`${API_BASE}/hospitals/${hospital.id}/verify`, { verified: newStatus });
      fetchHospitals();
    } catch (err) {
      alert("Failed to update hospital verification.");
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

  const [retrainFile, setRetrainFile] = useState(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainResult, setRetrainResult] = useState(null);

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
      if (err.response?.data?.error) {
        alert("Failed to delete user: " + err.response.data.error);
      } else {
        alert("Failed to delete user. Please try again.");
      }
    }
  };

  const handleToggleUserStatus = async (user) => {
    try {
      const isActive = user.status ? user.status === "Active" : user.active !== false;
      const endpoint = isActive ? "deactivate" : "activate";
      const response = await axios.put(`${API_BASE}/users/${user.id}/${endpoint}`);

      if (response.data.message) {
        alert(`User ${isActive ? "deactivated" : "activated"} successfully!`);
      }

      fetchUsers();
    } catch (err) {
      console.error("User status toggle error:", err);
      if (err.response?.data?.error) {
        alert("Failed to update user status: " + err.response.data.error);
      } else {
        alert("Failed to update user status. Please try again.");
      }
    }
  };

  const downloadReport = (type) => {
    try {
      let data, filename, headers;
      
      switch(type) {
        case 'users':
          data = JSON.stringify(users, null, 2);
          filename = 'users_report.json';
          headers = { 'Content-Type': 'application/json' };
          break;
        case 'alerts':
          data = JSON.stringify(alerts, null, 2);
          filename = 'alerts_report.json';
          headers = { 'Content-Type': 'application/json' };
          break;
        case 'predictions':
          data = JSON.stringify(predictions, null, 2);
          filename = 'predictions_report.json';
          headers = { 'Content-Type': 'application/json' };
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
      alert('Failed to download report. Please try again.');
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
      if (err.response?.data?.error) {
        alert("Failed to create user: " + err.response.data.error);
      } else {
        alert("Failed to create user. Please try again.");
      }
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
      if (err.response?.data?.error) {
        alert("Failed to create alert: " + err.response.data.error);
      } else {
        alert("Failed to create alert. Please try again.");
      }
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
    totalPredictions: predictions.length
  };

  // FR09-03: filter predictions by date range or risk level
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

  if (loading) {
    return (
      <div className="min-h-screen bg-ink text-parchment font-sans">
        <Navbar />
        <div className="pt-24 pb-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500 mx-auto"></div>
              <p className="mt-4 text-muted">{t("loadingAdminData")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink via-ink-soft to-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          {/* Header */}
          <div className="mb-10">
            <p className="eyebrow text-marigold-400 mb-3">{t("administration")}</p>
            <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">{t("controlPanel")}</h1>
            <p className="text-muted max-w-lg">{t("controlPanelDesc")}</p>
          </div>

          {/* Statistics Cards */}
          <div className="grid md:grid-cols-5 gap-4 mb-10">
            <div className="stat-tile">
              <div className="font-display text-3xl text-parchment mb-1">{statistics.totalUsers}</div>
              <div className="eyebrow text-muted">{t("totalUsers")}</div>
            </div>
            <div className="stat-tile">
              <div className="font-display text-3xl text-teal-400 mb-1">{statistics.citizens}</div>
              <div className="eyebrow text-muted">{t("citizens")}</div>
            </div>
            <div className="stat-tile">
              <div className="font-display text-3xl text-marigold-400 mb-1">{statistics.rescueWorkers}</div>
              <div className="eyebrow text-muted">{t("rescueWorkers")}</div>
            </div>
            <div className="stat-tile">
              <div className="font-display text-3xl text-teal-400 mb-1">{statistics.governmentOfficials}</div>
              <div className="eyebrow text-muted">{t("govOfficials")}</div>
            </div>
            <div className="stat-tile">
              <div className="font-display text-3xl text-marigold-400 mb-1">{statistics.admins}</div>
              <div className="eyebrow text-muted">{t("admins")}</div>
            </div>
          </div>

          {/* User Management */}
          <div className="dashboard-card p-6 mb-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl text-parchment">👥 {t("userManagement")}</h2>
              <p className="text-sm text-muted mt-1">{t("userManagementDesc")}</p>
            </div>

            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={t("searchByNameEmailRole")}
              className="field-input py-2.5 text-sm mb-4 max-w-sm"
            />

            <div className="max-h-72 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-ink-soft z-10 border-b border-white/20">
                  <tr>
                    <th className="py-3 px-4 text-muted">{t("name")}</th>
                    <th className="py-3 px-4 text-muted">{t("email")}</th>
                    <th className="py-3 px-4 text-muted">{t("role")}</th>
                    <th className="py-3 px-4 text-muted">{t("status")}</th>
                    <th className="py-3 px-4 text-muted">Joined</th>

                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredUsers.map((user, index) => (
                    <tr key={index} className="hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-teal-400 to-marigold-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {(user.name || "U").charAt(0).toUpperCase()}
                          </div>
                          <span className="text-white font-medium">{user.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted">{user.email}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleColor(user.role)}`}>
                          {getRoleDisplayName(user.role)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const isActive = user.status ? user.status === "Active" : user.active !== false;
                          return (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              isActive ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                            }`}>
                              {isActive ? t("active") : "Locked 🔒"}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4 text-muted text-xs">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Citizen Reports Moderation & Analytics Hub (Option B) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <h2 className="font-display text-2xl text-parchment">🗂️ Citizen Reports Moderation & Analytics</h2>
                <p className="text-sm text-muted mt-1">View, filter, analyze, and manage incident reports submitted by citizens across all stages.</p>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                {["All", "Submitted", "Reviewed", "Action Taken", "Completed"].map(f => (
                  <button key={f} onClick={() => setReportsFilter(f)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                      reportsFilter === f
                        ? "bg-teal-500 border-teal-400 text-white"
                        : "bg-white/5 border-white/20 text-muted hover:bg-white/10"
                    }`}>{f}</button>
                ))}
              </div>
            </div>

            {/* Reports Analytics Breakdown Hub (Option B) */}
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
                  <div className="text-center py-10 text-muted">
                    <div className="text-4xl mb-3">📋</div>
                    <p>No reports found for "{reportsFilter}".</p>
                  </div>
                );
              }

              return (
                <div className="max-h-64 overflow-y-auto pr-1 space-y-4 custom-scroll">
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
                          {/* Report Info */}
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
                            <p className="text-muted text-sm mb-2 line-clamp-2">{report.description}</p>
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

          {/* Government Emergency Advisories Control (From Gov Portal) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">📢 Emergency Advisories Broadcasts</h2>
                <p className="text-sm text-muted mt-1">Official government disaster warnings, evacuation notices, and regional advisories.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-marigold-500/10 text-marigold-400 border border-marigold-500/30">
                {advisories.length} Active Advisories
              </span>
            </div>

            {advisories.length === 0 ? (
              <p className="text-sm text-muted py-4">No active government advisories broadcasted.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 space-y-3 custom-scroll">
                <div className="grid sm:grid-cols-2 gap-3">
                  {advisories.map((adv) => (
                    <div key={adv.id} className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                            📍 {adv.region || "All Regions"}
                          </span>
                          <span className="text-xs text-muted font-mono">{adv.created_at ? new Date(adv.created_at).toLocaleDateString() : "Live"}</span>
                        </div>
                        <h4 className="font-semibold text-white text-base">{adv.title}</h4>
                        <p className="text-xs text-muted mt-1 bg-white/5 p-2 rounded line-clamp-3">{adv.message}</p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                        <span className="text-muted">Issued by: <strong className="text-white">{adv.issued_by || "Government Official"}</strong></span>
                        <button onClick={() => handleDeleteAdvisory(adv.id)} className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20">
                          Revoke Advisory
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* System Overview */}
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
              <h3 className="text-xl font-semibold text-white mb-4">{t("userDistribution")}</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-green-400">{t("citizens")}</span>
                  <span className="text-white">{statistics.citizens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-yellow-400">{t("rescueWorkers")}</span>
                  <span className="text-white">{statistics.rescueWorkers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-teal-400">{t("govOfficials")}</span>
                  <span className="text-white">{statistics.governmentOfficials}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">{t("admins")}</span>
                  <span className="text-white">{statistics.admins}</span>
                </div>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
              <h3 className="text-xl font-semibold text-white mb-4">{t("alertStatistics")}</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted">{t("totalAlerts")}</span>
                  <span className="text-white">{statistics.totalAlerts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t("highRiskAlerts")}</span>
                  <span className="text-white">{statistics.highRiskAlerts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t("totalPredictionsLabel")}</span>
                  <span className="text-white">{statistics.totalPredictions}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Reports Section */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-display text-2xl text-parchment">📊 {t("systemReports")}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadReport('users')}
                  className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {t('downloadUsersReport')}
                </button>
                <button
                  onClick={() => downloadReport('alerts')}
                  className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {t('downloadAlertsReport')}
                </button>
                <button
                  onClick={() => downloadReport('predictions')}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {t('downloadPredictionsReport')}
                </button>
              </div>
            </div>
            
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white/10 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-white mb-2">{t("totalUsersLabel")}</h4>
                <p className="text-3xl font-bold text-teal-400">{statistics.totalUsers}</p>
                <p className="text-sm text-muted">{t("registeredAccounts")}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-white mb-2">{t("totalAlerts")}</h4>
                <p className="text-3xl font-bold text-yellow-400">{statistics.totalAlerts}</p>
                <p className="text-sm text-muted">{t("systemAlertsGenerated")}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-white mb-2">{t("totalPredictionsLabel")}</h4>
                <p className="text-3xl font-bold text-green-400">{statistics.totalPredictions}</p>
                <p className="text-sm text-muted">{t("riskAssessmentsMade")}</p>
              </div>
            </div>
          </div>

          {/* Alerts Management */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-display text-2xl text-parchment">🚨 {t("alertsLog")}</h2>
              <div className="text-sm text-muted">
                {statistics.totalAlerts} total alerts ({statistics.highRiskAlerts} high risk)
              </div>
            </div>
            
            <div className="max-h-72 overflow-y-auto pr-1 space-y-3 custom-scroll">
              {alerts.length === 0 && <p className="text-muted text-sm">{t("noAlertsYet") || "No alerts active."}</p>}
              {alerts.map((alert, index) => (
                <div key={index} className="bg-white/10 rounded-lg p-4 border border-white/20">
                  <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-lg font-bold text-white">{alert.message}</h4>
                        {alert.status === "Cancelled" && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-muted border border-white/10">{t("cancelled")}</span>
                        )}
                      </div>
                      <p className="text-muted mb-2">{alert.location}</p>
                      <p className="text-sm text-muted">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getRiskColor(alert.risk)}`}>
                        {alert.risk}
                      </span>
                      {alert.status !== "Cancelled" && (
                        <button
                          onClick={async () => {
                            try {
                              await axios.put(`${API_BASE}/alerts/${alert.id}`, { status: 'Cancelled' });
                              fetchAlerts();
                            } catch (err) {
                              console.error('Cancel alert failed:', err);
                            }
                          }}
                          className="btn-secondary text-xs py-1.5 px-3"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this alert?')) return;
                          try {
                            await axios.delete(`${API_BASE}/alerts/${alert.id}`);
                            fetchAlerts();
                            alert('Alert deleted successfully!');
                          } catch (err) {
                            console.error('Delete alert failed:', err);
                            alert('Failed to delete alert.');
                          }
                        }}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Predictions View (FR-09) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
              <h2 className="font-display text-2xl text-parchment">🌧️ {t("floodPredictions")}</h2>
              <button onClick={() => downloadReport('predictions')} className="bg-white/10 hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                {t("export")} ({filteredPredictions.length})
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3 mb-5">
              <select value={predictionFilters.risk} onChange={(e) => setPredictionFilters(p => ({ ...p, risk: e.target.value }))}
                className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="All">{t("allRiskLevels")}</option>
                <option value="Low">Low</option>
                <option value="Medium">{t("mediumSeverity")}</option>
                <option value="High">{t("highSeverity")}</option>
              </select>
              <input type="date" value={predictionFilters.from} onChange={(e) => setPredictionFilters(p => ({ ...p, from: e.target.value }))}
                className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <input type="date" value={predictionFilters.to} onChange={(e) => setPredictionFilters(p => ({ ...p, to: e.target.value }))}
                className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div className="max-h-72 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
              <table className="min-w-full text-left">
                <thead className="sticky top-0 bg-slate-900 z-10 border-b border-white/20 text-muted text-sm">
                  <tr>
                    <th className="px-3 py-2.5">{t("location2")}</th>
                    <th className="px-3 py-2.5">{t("riskLabel")}</th>
                    <th className="px-3 py-2.5">{t("confidence")}</th>
                    <th className="px-3 py-2.5">{t("rainfallLabel")}</th>
                    <th className="px-3 py-2.5">{t("riverLevelLabel")}</th>
                    <th className="px-3 py-2.5">{t("timestamp")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredPredictions.map((p, i) => (
                    <tr key={i} className="text-parchment text-sm hover:bg-white/5 transition-colors">
                      <td className="px-3 py-3 font-medium">{p.location || "—"}</td>
                      <td className="px-3 py-3"><span className={`font-semibold ${getRiskColor(p.risk)}`}>{p.risk}</span></td>
                      <td className="px-3 py-3 font-mono">{p.confidence ? `${(p.confidence * 100).toFixed(1)}%` : "—"}</td>
                      <td className="px-3 py-3">{p.rainfall ? `${p.rainfall} mm` : "—"}</td>
                      <td className="px-3 py-3">{p.river_level ? `${p.river_level} m` : "—"}</td>
                      <td className="px-3 py-3 text-muted text-xs">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                  {filteredPredictions.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{t("noPredictionsMatch")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shelters Management (FR-07) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">🏢 {t("shelters")}</h2>
                <p className="text-sm text-muted mt-1">{filteredShelters.length} shelter{filteredShelters.length !== 1 ? "s" : ""} registered</p>
              </div>
              <button onClick={() => setShowShelterForm(v => !v)} className="btn-secondary text-sm py-2.5">
                {showShelterForm ? t("cancel") : t("addShelter")}
              </button>
            </div>
            {showShelterForm && (
              <form onSubmit={handleCreateShelter} className="grid gap-3 md:grid-cols-2 bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
                <input required placeholder={t("shelterName")} value={newShelter.name} onChange={(e) => setNewShelter(p => ({ ...p, name: e.target.value }))}
                  className="field-input py-2.5" />
                <input required placeholder={t("address")} value={newShelter.address} onChange={(e) => setNewShelter(p => ({ ...p, address: e.target.value }))}
                  className="field-input py-2.5" />
                <input type="number" placeholder={t("capacity")} value={newShelter.capacity} onChange={(e) => setNewShelter(p => ({ ...p, capacity: e.target.value }))}
                  className="field-input py-2.5" />
                <input placeholder={t("contact")} value={newShelter.contact} onChange={(e) => setNewShelter(p => ({ ...p, contact: e.target.value }))}
                  className="field-input py-2.5" />
                <button type="submit" className="md:col-span-2 btn-primary">{t("saveShelter")}</button>
              </form>
            )}
            <input
              type="text"
              value={shelterSearch}
              onChange={(e) => setShelterSearch(e.target.value)}
              placeholder={t("searchByNameAddress")}
              className="field-input py-2.5 text-sm mb-4 max-w-sm"
            />
            {filteredShelters.length === 0 && <p className="text-muted text-sm py-4">{t("noSheltersRegistered")}</p>}
            <div className="max-h-72 overflow-y-auto pr-1 space-y-0 custom-scroll">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredShelters.map((s) => (
                  <div key={s.id} className="bg-white/8 rounded-xl p-4 border border-white/10 hover:border-teal-500/40 transition-all flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-sm truncate">{lang === "ur" && s.name_ur ? s.name_ur : s.name}</h4>
                        <p className="text-xs text-muted truncate mt-0.5">{s.address}</p>
                      </div>
                      <button onClick={() => handleDeleteShelter(s.id)} className="shrink-0 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors">
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

          {/* Hospitals Management (FR-08) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">🏥 {t("hospitals") || "Hospitals"}</h2>
                <p className="text-sm text-muted mt-1">{filteredHospitals.length} hospital{filteredHospitals.length !== 1 ? "s" : ""} registered</p>
              </div>
              <button onClick={() => setShowHospitalForm(v => !v)} className="btn-secondary text-sm py-2.5">
                {showHospitalForm ? t("cancel") : (t("addHospital") || "Add Hospital")}
              </button>
            </div>
            {showHospitalForm && (
              <form onSubmit={handleCreateHospital} className="grid gap-3 md:grid-cols-2 bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
                <input required placeholder={t("hospitalName") || "Hospital Name"} value={newHospital.name} onChange={(e) => setNewHospital(p => ({ ...p, name: e.target.value }))}
                  className="field-input py-2.5" />
                <input required placeholder={t("address") || "Address"} value={newHospital.address} onChange={(e) => setNewHospital(p => ({ ...p, address: e.target.value }))}
                  className="field-input py-2.5" />
                <input placeholder={t("contact") || "Contact Phone"} value={newHospital.contact} onChange={(e) => setNewHospital(p => ({ ...p, contact: e.target.value }))}
                  className="field-input py-2.5" />
                <input placeholder={t("services") || "Services (Emergency, Trauma, ICU)"} value={newHospital.services} onChange={(e) => setNewHospital(p => ({ ...p, services: e.target.value }))}
                  className="field-input py-2.5" />
                <button type="submit" className="md:col-span-2 btn-primary">{t("saveHospital") || "Save Hospital"}</button>
              </form>
            )}
            <input
              type="text"
              value={hospitalSearch}
              onChange={(e) => setHospitalSearch(e.target.value)}
              placeholder={t("searchByNameAddress")}
              className="field-input py-2.5 text-sm mb-4 max-w-sm"
            />
            {filteredHospitals.length === 0 && <p className="text-muted text-sm py-4">No hospitals registered.</p>}
            <div className="max-h-72 overflow-y-auto pr-1 space-y-0 custom-scroll">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredHospitals.map((h) => (
                  <div key={h.id} className="bg-white/8 rounded-xl p-4 border border-white/10 hover:border-emerald-500/40 transition-all flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-sm truncate">{lang === "ur" && h.name_ur ? h.name_ur : h.name}</h4>
                        <p className="text-xs text-muted truncate mt-0.5">{h.address}</p>
                      </div>
                      <button onClick={() => handleDeleteHospital(h.id)} className="shrink-0 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors">
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





          {/* Interactive Map (FR-04) */}
          <div className="mb-8">
            <p className="eyebrow text-teal-400 mb-3">{t("liveMap")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">🗺️ {t("sheltersHospitalsBlockedRoads")}</h2>
            <FloodMap height={460} canEdit={true} />
          </div>

          {/* Model Retraining (FR10-02) */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-3">{t("mlBackend")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">🤖 {t("retrainModel")}</h2>
            <p className="text-sm text-muted mb-5 max-w-2xl">
              {t("retrainDescription")}
            </p>
            <form onSubmit={handleRetrainModel} className="flex flex-wrap items-center gap-4">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setRetrainFile(e.target.files[0])}
                className="text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-parchment hover:file:bg-white/20"
              />
              <button type="submit" disabled={!retrainFile || retraining} className="btn-primary text-sm py-2.5 disabled:opacity-50">
                {retraining ? "Retraining… this can take a minute" : "Retrain model"}
              </button>
            </form>
            {retrainResult && (
              <div className={`mt-4 rounded-lg p-3 text-sm ${retrainResult.ok ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-amber-500/10 border border-amber-500/20 text-amber-300"}`}>
                {retrainResult.message}
              </div>
            )}
          </div>

          {/* Model Accuracy Tracking */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("mlBackend")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">📈 {t("modelAccuracyOverTime")}</h2>
            {accuracyHistory.length === 0 ? (
              <p className="text-sm text-muted">{t("noRetrainEvents")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={accuracyHistory.map((a, i) => ({ ...a, index: i + 1, accuracyPct: a.accuracy * 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#233047" />
                  <XAxis dataKey="index" stroke="#93A0B4" tick={{ fontSize: 11 }} label={{ value: "Retrain #", position: "insideBottom", offset: -2, fill: "#93A0B4", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} stroke="#93A0B4" tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip contentStyle={{ backgroundColor: '#101826', border: '1px solid #233047', borderRadius: '10px' }} labelStyle={{ color: '#F3EDE1' }} formatter={(v) => [`${v.toFixed(1)}%`, "Accuracy"]} />
                  <Line type="monotone" dataKey="accuracyPct" stroke="#3FBDB6" strokeWidth={2} dot={{ fill: "#3FBDB6", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="font-display text-lg text-parchment mb-3">📉 {t("predictionConfidenceTrend")}</h3>
              {confidenceTrend.length === 0 ? (
                <p className="text-sm text-muted">{t("notEnoughHistory")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={confidenceTrend.map((c) => ({ ...c, confPct: c.avg_confidence * 100 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#233047" />
                    <XAxis dataKey="date" stroke="#93A0B4" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} stroke="#93A0B4" tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: '#101826', border: '1px solid #233047', borderRadius: '10px' }} labelStyle={{ color: '#F3EDE1' }} formatter={(v) => [`${v.toFixed(1)}%`, "Avg. confidence"]} />
                    <Line type="monotone" dataKey="confPct" stroke="#E8A33D" strokeWidth={2} dot={{ fill: "#E8A33D", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Volunteers */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-2">{t("safetyNetwork")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">👷 {t("registeredVolunteers")} ({volunteers.length})</h2>
            {volunteers.length === 0 ? (
              <p className="text-sm text-muted">{t("noVolunteersYet")}</p>
            ) : (
              <div className="max-h-64 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-ink-soft z-10 border-b border-white/20 text-muted">
                    <tr>
                      <th className="py-2.5 px-3">{t("name")}</th>
                      <th className="py-2.5 px-3">{t("phoneCol")}</th>
                      <th className="py-2.5 px-3">{t("cityCol")}</th>
                      <th className="py-2.5 px-3">{t("skillsCol")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {volunteers.map((v) => (
                      <tr key={v.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 px-3 text-white font-medium">{v.name}</td>
                        <td className="py-2.5 px-3 text-muted">{v.phone}</td>
                        <td className="py-2.5 px-3 text-muted">{v.city}</td>
                        <td className="py-2.5 px-3 text-muted">{v.skills}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Donations / Resource Pledges */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-2">{t("resourceCoordination")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">🎁 {t("donationPledges")} ({donations.length})</h2>
            {donations.length === 0 ? (
              <p className="text-sm text-muted">{t("noDonationsYet")}</p>
            ) : (
              <div className="max-h-64 overflow-y-auto pr-1 space-y-2 custom-scroll">
                {donations.map((d) => (
                  <div key={d.id} className="flex items-center justify-between bg-white/[0.04] border border-white/10 hover:border-white/20 rounded-xl px-4 py-3 text-sm transition-all">
                    <div>
                      <span className="text-white font-semibold">{d.item}</span>
                      <span className="text-muted"> × {d.quantity} — {d.donor_name}</span>
                    </div>
                    <span className="text-xs text-teal-300 bg-teal-500/10 border border-teal-500/30 rounded-full px-2.5 py-0.5 font-medium">{d.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Relief Equipment & Emergency Gear Overview (From Rescue Portal) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">🚤 Relief Equipment & Emergency Gear</h2>
                <p className="text-sm text-muted mt-1">Tracking lifeboats, dewatering pumps, life jackets, and regional emergency supplies.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                {equipment.length} Assets Registered
              </span>
            </div>

            {equipment.length === 0 ? (
              <p className="text-sm text-muted py-4">No relief equipment items registered.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto overflow-x-auto custom-scroll border border-white/10 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-ink-soft z-10 border-b border-white/20 text-muted">
                    <tr>
                      <th className="py-2.5 px-3">Equipment Name</th>
                      <th className="py-2.5 px-3">Quantity</th>
                      <th className="py-2.5 px-3">City / Location</th>
                      <th className="py-2.5 px-3">Notes & Operational Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {equipment.map((eq) => (
                      <tr key={eq.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 px-3 text-white font-medium">{eq.name}</td>
                        <td className="py-2.5 px-3 text-teal-400 font-bold">{eq.quantity || 1} units</td>
                        <td className="py-2.5 px-3 text-muted">📍 {eq.city || "Central Warehouse"}</td>
                        <td className="py-2.5 px-3 text-muted">{eq.notes || "Operational"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ground Team Shift Handover Notes Log (From Rescue Portal) */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">📝 Ground Operational Handover Notes</h2>
                <p className="text-sm text-muted mt-1">Field officer shift handovers, operational briefings, and critical ground updates.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                {handoverNotes.length} Handover Notes
              </span>
            </div>

            {handoverNotes.length === 0 ? (
              <p className="text-sm text-muted py-4">No shift handover notes logged by ground teams.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 space-y-3 custom-scroll">
                <div className="grid sm:grid-cols-2 gap-3">
                  {handoverNotes.map((hn) => {
                    const isUrgent = hn.priority === "Urgent" || hn.priority === "High";
                    return (
                      <div key={hn.id} className={`bg-white/5 rounded-xl p-4 border flex flex-col justify-between gap-2 ${
                        isUrgent ? "border-red-500/40 bg-red-500/5" : "border-white/10"
                      }`}>
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isUrgent ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-white/10 text-muted"
                            }`}>
                              {hn.priority || "Normal Priority"}
                            </span>
                            <span className="text-xs text-muted font-mono">{hn.created_at ? new Date(hn.created_at).toLocaleDateString() : "Shift Log"}</span>
                          </div>
                          <p className="text-xs text-parchment font-medium bg-white/5 p-2.5 rounded mt-1 line-clamp-3">"{hn.note}"</p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-muted">
                          <span>👤 {hn.author || "Rescue Officer"} — {hn.location || "Sector"}</span>
                          <span className={hn.resolved ? "text-emerald-400" : "text-amber-400 font-semibold"}>
                            {hn.resolved ? "Resolved ✓" : "● Active Shift Note"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Shelter Live Occupancy & Overflow Warning */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">🏢 Shelter Occupancy & Overflow Monitor</h2>
                <p className="text-sm text-muted mt-1">Real-time capacity tracking with overflow alerts for displaced citizens.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                {shelters.filter(s => ((s.current_occupancy || s.occupancy || 0) / (s.capacity || 100)) >= 0.9).length} At Capacity
              </span>
            </div>
            {shelters.length === 0 ? (
              <p className="text-sm text-muted py-4">No shelters registered.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 space-y-3 custom-scroll">
                <div className="grid sm:grid-cols-2 gap-3">
                  {shelters.map((shelter) => {
                    const current = shelter.current_occupancy || shelter.occupancy || 0;
                    const capacity = shelter.capacity || 100;
                    const pct = Math.min(Math.round((current / capacity) * 100), 100);
                    const isCritical = pct >= 90;
                    const isWarning = pct >= 70 && pct < 90;
                    const barColor = isCritical ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-teal-500";
                    return (
                      <div key={shelter.id} className={`bg-white/5 rounded-xl p-4 border ${
                        isCritical ? "border-red-500/50 bg-red-500/5" : isWarning ? "border-amber-500/30" : "border-white/10"
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="text-white font-semibold text-sm">{shelter.name}</h4>
                            <p className="text-xs text-muted">📍 {shelter.city || shelter.location}</p>
                          </div>
                          {isCritical && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500 text-white animate-pulse">OVERFLOW ⚠️</span>
                          )}
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-2 mb-1">
                          <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted">{current} / {capacity} people</span>
                          <span className={isCritical ? "text-red-400 font-bold" : isWarning ? "text-amber-400" : "text-teal-400"}>{pct}% Full</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Hospital Live Bed Occupancy & Capacity Monitor */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-display text-2xl text-parchment">🏥 Hospital Occupancy & Bed Capacity Monitor</h2>
                <p className="text-sm text-muted mt-1">Real-time medical bed capacity tracking and emergency hospital overload alerts.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {hospitals.filter(h => ((h.occupancy || 0) / (h.capacity || 50)) >= 0.9).length} At Capacity
              </span>
            </div>
            {hospitals.length === 0 ? (
              <p className="text-sm text-muted py-4">No hospitals registered.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 space-y-3 custom-scroll">
                <div className="grid sm:grid-cols-2 gap-3">
                  {hospitals.map((hospital) => {
                    const current = hospital.occupancy || 0;
                    const capacity = hospital.capacity || 50;
                    const pct = Math.min(Math.round((current / capacity) * 100), 100);
                    const isCritical = pct >= 90;
                    const isWarning = pct >= 70 && pct < 90;
                    const barColor = isCritical ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-emerald-500";
                    return (
                      <div key={hospital.id} className={`bg-white/5 rounded-xl p-4 border ${
                        isCritical ? "border-red-500/50 bg-red-500/5" : isWarning ? "border-amber-500/30" : "border-white/10"
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="text-white font-semibold text-sm">{hospital.name}</h4>
                            <p className="text-xs text-muted">📍 {hospital.address || hospital.city || "Location unavailable"}</p>
                          </div>
                          {isCritical && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500 text-white animate-pulse">OVERFLOW ⚠️</span>
                          )}
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-2 mb-1">
                          <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted">{current} / {capacity} beds occupied</span>
                          <span className={isCritical ? "text-red-400 font-bold" : isWarning ? "text-amber-400" : "text-emerald-400"}>{pct}% Full</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-ink-soft rounded-2xl p-8 max-w-md w-full">
            <h2 className="font-display text-2xl text-parchment mb-6">{t("createNewUserBtn")}</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("name")}</label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                  className="field-input"
                  placeholder={t("enterName")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("email")}</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  className="field-input"
                  placeholder={t("enterEmail")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("passwordLabel")}</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                  className="field-input"
                  placeholder={t("enterPassword")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("role")}</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="citizen">{t("citizenSingular")}</option>
                  <option value="rescue_worker">{t("rescueWorkerSingular")}</option>
                  <option value="government_official">{t("govOfficials")}</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-lg transition-colors"
                >
                  Create User
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="flex-1 bg-white/10 hover:bg-white/10 text-white py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Alert Modal */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-ink-soft rounded-2xl p-8 max-w-md w-full">
            <h2 className="font-display text-2xl text-parchment mb-6">{t("createAlertBtn")}</h2>
            <form onSubmit={handleCreateAlert} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("alertMessage")}</label>
                <textarea
                  value={newAlert.message}
                  onChange={(e) => setNewAlert({...newAlert, message: e.target.value})}
                  className="field-input"
                  placeholder={t("enterAlertMessage")}
                  rows="3"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("location2")}</label>
                <input
                  type="text"
                  value={newAlert.location}
                  onChange={(e) => setNewAlert({...newAlert, location: e.target.value})}
                  className="field-input"
                  placeholder={t("enterLocation")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("riskLevelLabel")}</label>
                <select
                  value={newAlert.risk}
                  onChange={(e) => setNewAlert({...newAlert, risk: e.target.value})}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">{t("mediumSeverity")}</option>
                  <option value="High">{t("highSeverity")}</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg transition-colors"
                >
                  {t("createAlertBtn")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAlertModal(false)}
                  className="flex-1 bg-white/10 hover:bg-white/10 text-white py-2 rounded-lg transition-colors"
                >
                  Cancel
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
