import { Fragment, useState, useEffect, useMemo } from "react";
import axios from "axios";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";
import { getReportImageSource } from "../utils/reportValidation";
import { formatAlertMessage } from "../utils/alertDateTime";

const SEVERITY_KEY_MAP = { "Low": "lowSeverity", "Medium": "mediumSeverity", "High": "highSeverity" };
export default function GovDashboard() {
  const { t, lang } = useLanguage();
  const [predictions, setPredictions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [advisories, setAdvisories] = useState([]);
  const [advisoryForm, setAdvisoryForm] = useState({ title: "", message: "", region: "All regions" });
  const [showAdvisoryForm, setShowAdvisoryForm] = useState(false);
  const [reportCity, setReportCity] = useState("");
  const [rescueWorkers, setRescueWorkers] = useState([]);
  const [allRescueOps, setAllRescueOps] = useState([]);
  const [assigningAlertId, setAssigningAlertId] = useState(null);
  const [assignmentSubmittingId, setAssignmentSubmittingId] = useState(null);
  const [assignForm, setAssignForm] = useState({ worker: "", description: "" });
  const [showOperationForm, setShowOperationForm] = useState(false);
  const [selectedOperationId, setSelectedOperationId] = useState(null);
  const [operationFeedback, setOperationFeedback] = useState(null);
  const [operationStatusErrors, setOperationStatusErrors] = useState({});
  const [operationForm, setOperationForm] = useState({
    location: "", description: "", risk_level: "Medium", assigned_team: "Unassigned", worker_names: [], alert_id: ""
  });
  const [multiWorkerEnabled, setMultiWorkerEnabled] = useState(false);
  const [manageWorkerPick, setManageWorkerPick] = useState([]);
  const [seasonalTrend, setSeasonalTrend] = useState([]);
  const [communityReports, setCommunityReports] = useState([]);
  const [reportStatusFilter, setReportStatusFilter] = useState("All");
  const [reportSeverityFilter, setReportSeverityFilter] = useState("All");
  const [expandedReportId, setExpandedReportId] = useState(null);
  const [operationStatusFilter, setOperationStatusFilter] = useState("Active");
  const [activeTab, setActiveTab] = useState("analytics");

  const fetchAllRescueOps = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations`);
      setAllRescueOps(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchCommunityReports = async () => {
    try {
      const res = await axios.get(`${API_BASE}/community-reports`, {
        headers: {
          "X-FMS-Actor-Role": "government_official",
          "X-FMS-Actor-Email": localStorage.getItem("userEmail") || "",
        },
      });
      setCommunityReports(res.data || []);
    } catch (err) { console.error(err); }
  };

  const updateCommunityReport = async (reportId, status) => {
    try {
      const res = await axios.put(`${API_BASE}/community-reports/${reportId}/status`, { status });
      setCommunityReports((reports) => reports.map((report) => report.id === reportId ? res.data : report));
    } catch (err) {
      console.error("Failed to update citizen report:", err);
    }
  };

  const fetchSeasonalTrend = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/seasonal-trend`);
      setSeasonalTrend(res.data || []);
    } catch (err) { console.error(err); }
  };


  const fetchRescueWorkers = async () => {
    let found = [];
    try {
      const res = await axios.get(`${API_BASE}/users`);
      found = (res.data || [])
        .filter((u) => u.role === "rescue_worker")
        .map((u) => ({ ...u, status: u.status || "Active" }));
    } catch (err) { console.error(err); }
    try {
      const res = await axios.get(`${API_BASE}/rescue-operations/workers`);
      setMultiWorkerEnabled(Boolean(res.data?.multi_worker_enabled !== false));
      if (res.data?.workers && res.data.workers.length > 0) {
        if (found.length === 0) {
          found = res.data.workers.map((w) => ({
            id: w.id || w.name,
            name: w.name,
            email: w.email || "",
            role: "rescue_worker",
            status: "Active"
          }));
        }
      }
    } catch (err) { setMultiWorkerEnabled(true); }
    setRescueWorkers(found);
  };

  const refreshRescueData = async () => {
    await Promise.all([fetchRescueWorkers(), fetchAllRescueOps(), fetchAlerts()]);
  };

  const showOperationFeedback = (message, type = "error") => {
    setOperationFeedback({ message, type });
    setTimeout(() => setOperationFeedback(null), 4000);
  };

  const handleCreateOperation = async (e) => {
    e.preventDefault();
    const loc = operationForm.location.trim();
    const desc = operationForm.description.trim();
    if (!loc || loc.length < 3) {
      showOperationFeedback(lang === "ur" ? "براہ کرم درست متاثرہ مقام درج کریں (کم از کم 3 حروف)۔" : "Please provide a valid affected location (at least 3 characters).");
      return;
    }
    if (!desc || desc.length < 5) {
      showOperationFeedback(lang === "ur" ? "براہ کرم آپریشن کی تفصیل درج کریں (کم از کم 5 حروف)۔" : "Please provide an operation description (at least 5 characters).");
      return;
    }
    if (!operationForm.worker_names.length) {
      showOperationFeedback(lang === "ur" ? "براہ کرم کم از کم ایک دستیاب ریسکیو ورکر منتخب کریں۔" : "Please select at least one available rescue worker.");
      return;
    }
    if (operationForm.worker_names.length > 1 && !multiWorkerEnabled) {
      showOperationFeedback("Multi-worker assignment is pending database migration approval. Select one worker for now.");
      return;
    }
    const selectedAlert = operationForm.alert_id
      ? pendingAlerts.find((alert) => String(alert.id) === String(operationForm.alert_id))
      : null;
    const existingLinkedOperation = selectedAlert?.linked_rescue_op_id !== undefined &&
      selectedAlert?.linked_rescue_op_id !== null
      ? allRescueOps.find((operation) => String(operation.id) === String(selectedAlert.linked_rescue_op_id))
      : null;
    if (selectedAlert && existingLinkedOperation) {
      showOperationFeedback(`Alert #${selectedAlert.id} is already linked to operation #${existingLinkedOperation.id}. Manage or reassign that operation below.`);
      return;
    }
    let operationCreated = false;
    try {
      const operationRes = await axios.post(`${API_BASE}/rescue-operations`, {
        location: operationForm.location.trim(),
        description: operationForm.description.trim(),
        risk_level: operationForm.risk_level,
        assigned_team: operationForm.worker_names[0],
        worker_names: operationForm.worker_names,
        ...(selectedAlert ? { alert_id: selectedAlert.id } : {}),
      });
      operationCreated = operationRes.status === 201;
      setOperationForm({ location: "", description: "", risk_level: "Medium", assigned_team: "Unassigned", worker_names: [], alert_id: "" });
      setShowOperationForm(false);
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not create the rescue operation.");
      return;
    }

    if (operationCreated) {
      try {
        await refreshRescueData();
        showOperationFeedback(lang === "ur" ? "ریسکیو آپریشن کامیابی سے بن گیا۔" : "Rescue operation created successfully.", "success");
      } catch (refreshError) {
        console.error("Rescue operation was saved, but dashboard refresh failed:", refreshError);
        showOperationFeedback("Rescue operation created successfully. Refresh the page to see the latest data.", "success");
      }
    }
  };

  const handleAssignRescueWorker = async (alertItem) => {
    if (assignmentSubmittingId === alertItem.id || !assignForm.worker) return;
    setAssignmentSubmittingId(alertItem.id);
    try {
      const linkedOperation = getAlertOperation(alertItem);
      if (linkedOperation) {
        if (multiWorkerEnabled) {
          await axios.post(`${API_BASE}/rescue-operations/${linkedOperation.id}/workers`, {
            worker_names: [assignForm.worker],
          });
        } else {
          const hasTeam = linkedOperation.assigned_team && linkedOperation.assigned_team !== "Unassigned";
          if (hasTeam) {
            showOperationFeedback("Adding more workers is pending database migration approval.");
            return;
          }
          await axios.put(`${API_BASE}/rescue-operations/${linkedOperation.id}/status`, {
            assigned_team: assignForm.worker,
          });
        }
      } else {
        await axios.post(`${API_BASE}/rescue-operations`, {
          location: alertItem.location,
          description: assignForm.description.trim() || `Response to alert: ${alertItem.message}`,
          risk_level: alertItem.risk_level || alertItem.risk || "Medium",
          assigned_team: assignForm.worker,
          alert_id: alertItem.id,
        });
      }
      if (linkedOperation) {
        setOperationStatusErrors((prev) => {
          if (!prev[linkedOperation.id]) return prev;
          const next = { ...prev };
          delete next[linkedOperation.id];
          return next;
        });
      }
      setAssigningAlertId(null);
      setAssignForm({ worker: "", description: "" });
      await refreshRescueData();
      showOperationFeedback(lang === "ur" ? "ریسکیو ورکر کامیابی سے تفویض کر دیا گیا۔" : "Rescue worker assigned successfully.", "success");
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not assign the rescue worker.");
    } finally {
      setAssignmentSubmittingId(null);
    }
  };

  const handleAddWorkers = async (operation, workerNames) => {
    if (!workerNames.length) return;
    if (!multiWorkerEnabled) {
      showOperationFeedback("Multi-worker assignment is pending database migration approval.");
      return;
    }
    try {
      await axios.post(`${API_BASE}/rescue-operations/${operation.id}/workers`, { worker_names: workerNames });
      setManageWorkerPick([]);
      await refreshRescueData();
      setOperationStatusErrors((prev) => {
        if (!prev[operation.id]) return prev;
        const next = { ...prev };
        delete next[operation.id];
        return next;
      });
      showOperationFeedback(`${workerNames.join(", ")} added to the operation.`, "success");
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not add the rescue workers.");
    }
  };

  const handleRemoveWorker = async (operation, workerName) => {
    try {
      await axios.delete(`${API_BASE}/rescue-operations/${operation.id}/workers`, { params: { name: workerName } });
      await refreshRescueData();
      showOperationFeedback(`${workerName} removed and is now available.`, "success");
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not remove the rescue worker.");
    }
  };

  const isOperationAssigned = (operation) => {
    if (!operation) return false;
    if (Array.isArray(operation.worker_names) && operation.worker_names.length > 0) return true;
    if (Array.isArray(operation.workers) && operation.workers.length > 0) return true;
    const team = (operation.assigned_team || "").trim();
    return Boolean(team && team.toLowerCase() !== "unassigned");
  };

  const handleOperationStatusChange = (operation, newStatus) => {
    if (operation.status === "Completed") {
      showOperationFeedback(lang === "ur" ? "مکمل شدہ آپریشنز میں ترمیم نہیں کی جا سکتی۔" : "Completed operations are read-only.", "error");
      return;
    }

    if (newStatus === "Completed") {
      if (!isOperationAssigned(operation)) {
        const errorMsg = lang === "ur"
          ? "اس آپریشن کو مکمل کرنے سے پہلے کم از کم ایک ریسکیو ورکر تفویض کریں۔"
          : "Assign at least one rescue worker before completing this operation.";
        setOperationStatusErrors((prev) => ({ ...prev, [operation.id]: errorMsg }));
        return;
      }
    }

    setOperationStatusErrors((prev) => {
      if (!prev[operation.id]) return prev;
      const next = { ...prev };
      delete next[operation.id];
      return next;
    });

    handleUpdateOperation(operation, { status: newStatus });
  };

  const handleUpdateOperation = async (operation, changes) => {
    if (operation.status === "Completed") {
      showOperationFeedback(lang === "ur" ? "مکمل شدہ آپریشنز میں ترمیم نہیں کی جا سکتی۔" : "Completed operations are read-only.", "error");
      return;
    }

    if (changes.status === "Completed" && !isOperationAssigned(operation)) {
      const errorMsg = lang === "ur"
        ? "اس آپریشن کو مکمل کرنے سے پہلے کم از کم ایک ریسکیو ورکر تفویض کریں۔"
        : "Assign at least one rescue worker before completing this operation.";
      setOperationStatusErrors((prev) => ({ ...prev, [operation.id]: errorMsg }));
      return;
    }

    try {
      await axios.put(`${API_BASE}/rescue-operations/${operation.id}/status`, changes);
      await refreshRescueData();
      setOperationStatusErrors((prev) => {
        if (!prev[operation.id]) return prev;
        const next = { ...prev };
        delete next[operation.id];
        return next;
      });
      showOperationFeedback(lang === "ur" ? "ریسکیو آپریشن کامیابی سے اپڈیٹ ہو گیا۔" : "Rescue operation updated successfully.", "success");
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not update the rescue operation.", "error");
    }
  };

  const handleChecklistUpdate = async (operation, itemIndex, done) => {
    if (operation.status === "Completed") {
      showOperationFeedback(lang === "ur" ? "مکمل شدہ آپریشنز میں ترمیم نہیں کی جا سکتی۔" : "Completed operations are read-only.");
      return;
    }
    try {
      await axios.put(`${API_BASE}/rescue-operations/${operation.id}/checklist`, {
        item_index: itemIndex,
        done,
      });
      await fetchAllRescueOps();
    } catch (err) {
      showOperationFeedback(err.response?.data?.message || "Could not update operation progress.");
    }
  };


  useEffect(() => {
    fetchAdvisories();
    fetchRescueWorkers();
    fetchAllRescueOps();
    fetchSeasonalTrend();
  }, []);

  const fetchAdvisories = async () => {
    try {
      const res = await axios.get(`${API_BASE}/advisories`);
      setAdvisories(res.data || []);
    } catch (err) { console.error(err); }
  };

  const handleCreateAdvisory = async (e) => {
    e.preventDefault();
    const title = (advisoryForm.title || "").trim();
    const message = (advisoryForm.message || "").trim();
    if (!title || !message) {
      alert("Please fill in both the advisory title and message before submitting.");
      return;
    }
    if (title.length < 3) {
      alert("Advisory title must be at least 3 characters.");
      return;
    }
    if (message.length < 10) {
      alert("Advisory message must be at least 10 characters.");
      return;
    }
    try {
      await axios.post(`${API_BASE}/advisories`, { ...advisoryForm, title, message, issued_by: localStorage.getItem("userName") || "Government Official" });
      setAdvisoryForm({ title: "", message: "", region: "All regions" });
      setShowAdvisoryForm(false);
      fetchAdvisories();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to issue advisory.");
    }
  };

  const handleWithdrawAdvisory = async (id) => {
    if (!confirm(t("confirmWithdrawAdvisory"))) return;
    try {
      await axios.delete(`${API_BASE}/advisories/${id}`);
      fetchAdvisories();
    } catch (err) { console.error(err); }
  };

  const handleDownloadDistrictReport = async () => {
    if (!reportCity) return;
    try {
      const res = await axios.get(`${API_BASE}/admin/district-report/${encodeURIComponent(reportCity)}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `district_report_${reportCity}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(t("reportGenerationFailed"));
    }
  };

  useEffect(() => {
    fetchPredictions();
    fetchAlerts();
    fetchCommunityReports();
    // Safety fallback: ensure dashboard never stays stuck on loading spinner
    const timer = setTimeout(() => setLoading(false), 1200);
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchPredictions();
        fetchAlerts();
        fetchCommunityReports();
      }
    }, 60000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const fetchPredictions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/predictions`, { timeout: 8000 });
      const data = res.data || [];
      setPredictions((prev) => {
        // Guard against a transient/empty response (e.g. the backend
        // momentarily reconnecting to its database) silently wiping out
        // real data that was already on screen — only accept an empty
        // result if we didn't have anything loaded yet.
        if (data.length === 0 && prev.length > 0) {
          console.warn("Ignored an empty /predictions response — keeping previously loaded data.");
          return prev;
        }
        return data;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/alerts`, { timeout: 8000 });
      const data = res.data || [];
      setAlerts((prev) => {
        if (data.length === 0 && prev.length > 0) {
          console.warn("Ignored an empty /alerts response — keeping previously loaded data.");
          return prev;
        }
        return data;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const uniqueAlerts = useMemo(() => {
    const seenIds = new Set();
    return alerts.filter((alert) => {
      const alertId = alert.id;
      if (alertId === undefined || alertId === null) return true;
      const normalizedId = String(alertId);
      if (seenIds.has(normalizedId)) return false;
      seenIds.add(normalizedId);
      return true;
    });
  }, [alerts]);

  const getAlertOperation = (alert) => allRescueOps.find((operation) =>
      alert.linked_rescue_op_id !== undefined &&
      alert.linked_rescue_op_id !== null &&
      String(operation.id) === String(alert.linked_rescue_op_id)
  );

  const activeWorkerNames = useMemo(() => new Set(
    allRescueOps
      .filter((operation) => operation.status === "Assigned" || operation.status === "In Progress")
      .flatMap((operation) => operation.worker_names || [operation.assigned_team])
      .filter((worker) => worker && worker !== "Unassigned")
      .map((worker) => worker.toLowerCase())
  ), [allRescueOps]);

  const pendingAlerts = useMemo(() => uniqueAlerts.filter((alert) =>
    alert.status !== "Cancelled" && !getAlertOperation(alert)
  ), [uniqueAlerts, allRescueOps]);

  // Filter predictions based on selected filters
  const filteredPredictions = useMemo(() => {
    let filtered = [...predictions];
    
    if (dateFilter !== "all") {
      const now = new Date();
      const filterDate = new Date();
      
      switch (dateFilter) {
        case "today":
          filterDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          filterDate.setDate(now.getDate() - 7);
          break;
        case "month":
          filterDate.setMonth(now.getMonth() - 1);
          break;
        default:
          break;
      }
      
      if (dateFilter !== "all") {
        filtered = filtered.filter(pred => new Date(pred.created_at) >= filterDate);
      }
    }
    
    if (locationFilter !== "all") {
      filtered = filtered.filter(pred => pred.location === locationFilter);
    }
    
    if (riskFilter !== "all") {
      filtered = filtered.filter(pred => pred.risk === riskFilter);
    }
    
    return filtered;
  }, [predictions, dateFilter, locationFilter, riskFilter]);

  // Get unique locations for filter
  const uniqueLocations = useMemo(() => {
    const locations = [...new Set(predictions.map(pred => pred.location))];
    return locations.sort();
  }, [predictions]);

  const filteredCommunityReports = useMemo(() => communityReports.filter((report) =>
    (reportStatusFilter === "All" || report.status === reportStatusFilter) &&
    (reportSeverityFilter === "All" || report.severity === reportSeverityFilter)
  ), [communityReports, reportSeverityFilter, reportStatusFilter]);

  const displayedOperations = useMemo(() => allRescueOps.filter((operation) =>
    operationStatusFilter === "All" ||
    (operationStatusFilter === "Active" && operation.status !== "Completed") ||
    (operationStatusFilter === "Completed" && operation.status === "Completed")
  ), [allRescueOps, operationStatusFilter]);

  // Chart data
  const riskDistributionData = useMemo(() => {
    const riskCounts = filteredPredictions.reduce((acc, pred) => {
      acc[pred.risk] = (acc[pred.risk] || 0) + 1;
      return acc;
    }, {});

    return [
      { risk: "Low", count: riskCounts.Low || 0, percentage: ((riskCounts.Low || 0) / filteredPredictions.length * 100).toFixed(1) },
      { risk: "Medium", count: riskCounts.Medium || 0, percentage: ((riskCounts.Medium || 0) / filteredPredictions.length * 100).toFixed(1) },
      { risk: "High", count: riskCounts.High || 0, percentage: ((riskCounts.High || 0) / filteredPredictions.length * 100).toFixed(1) }
    ];
  }, [filteredPredictions]);

  const confidenceTrendData = useMemo(() => {
    return filteredPredictions.slice(-20).map((pred, index) => ({
      index: index + 1,
      confidence: pred.confidence * 100,
      risk: pred.risk
    }));
  }, [filteredPredictions]);

  const locationRiskData = useMemo(() => {
    const locationRisks = {};
    filteredPredictions.forEach(pred => {
      if (!locationRisks[pred.location]) {
        locationRisks[pred.location] = { Low: 0, Medium: 0, High: 0 };
      }
      locationRisks[pred.location][pred.risk]++;
    });
    
    return Object.entries(locationRisks).map(([location, risks]) => ({
      location,
      ...risks,
      total: risks.Low + risks.Medium + risks.High
    })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filteredPredictions]);

  const pieData = useMemo(() => {
    const colors = ['#10B981', '#F59E0B', '#EF4444'];
    return riskDistributionData.map((item, index) => ({
      ...item,
      color: colors[index]
    }));
  }, [riskDistributionData]);

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

  // Statistics
  const statistics = useMemo(() => {
    const total = filteredPredictions.length;
    const highRisk = filteredPredictions.filter(pred => pred.risk === "High").length;
    const mediumRisk = filteredPredictions.filter(pred => pred.risk === "Medium").length;
    const lowRisk = filteredPredictions.filter(pred => pred.risk === "Low").length;
    const avgConfidence = filteredPredictions.reduce((sum, pred) => sum + pred.confidence, 0) / total || 0;
    
    return {
      total,
      highRisk,
      mediumRisk,
      lowRisk,
      avgConfidence: (avgConfidence * 100).toFixed(1),
      highRiskPercentage: total > 0 ? ((highRisk / total) * 100).toFixed(1) : 0
    };
  }, [filteredPredictions]);

  const exportData = () => {
    if (filteredPredictions.length === 0) {
      alert("Please select data to export.");
      return;
    }

    const csvContent = [
      ["Date", "Location", "Risk", "Confidence", "Rainfall", "Temperature"],
      ...filteredPredictions.map(pred => [
        new Date(pred.created_at).toLocaleString(),
        pred.location,
        pred.risk,
        (pred.confidence * 100).toFixed(1) + "%",
        pred.input_data?.rainfall || "N/A",
        pred.input_data?.temperature || "N/A"
      ])
    ].map(row => row.join(",")).join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flood_predictions_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-ink text-parchment font-sans">
        <Navbar />
        <div className="pt-24 pb-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500 mx-auto"></div>
              <p className="mt-4 text-muted">{t("loadingAnalytics")}</p>
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
            <p className="eyebrow text-teal-400 mb-3">{t("govOversight")}</p>
            <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">{t("analyticsDashboard")}</h1>
            <p className="text-muted max-w-lg">{t("analyticsDashboardDesc")}</p>
          </div>

          {/* Statistics Cards */}
          <div className="grid md:grid-cols-5 gap-4 mb-8">
            <div className="stat-tile">
              <div className="font-display text-3xl text-parchment mb-1">{statistics.total}</div>
              <div className="eyebrow text-muted">{t("floodPredictions")}</div>
            </div>
            <div className="bg-red-500/20 backdrop-blur-xl rounded-xl p-6 border border-red-500/50">
              <div className="font-display text-3xl text-red-400 mb-1">{statistics.highRisk}</div>
              <div className="eyebrow text-muted">{t("highRisk")}</div>
            </div>
            <div className="bg-yellow-500/20 backdrop-blur-xl rounded-xl p-6 border border-yellow-500/50">
              <div className="font-display text-3xl text-yellow-400 mb-1">{statistics.mediumRisk}</div>
              <div className="eyebrow text-muted">{t("mediumRisk")}</div>
            </div>
            <div className="bg-green-500/20 backdrop-blur-xl rounded-xl p-6 border border-green-500/50">
              <div className="font-display text-3xl text-green-400 mb-1">{statistics.lowRisk}</div>
              <div className="eyebrow text-muted">{t("lowRisk")}</div>
            </div>
            <div className="bg-teal-500/20 backdrop-blur-xl rounded-xl p-6 border border-teal-500/50">
              <div className="font-display text-3xl text-teal-400 mb-1">{statistics.avgConfidence}%</div>
              <div className="eyebrow text-muted">{t("confidence")}</div>
            </div>
          </div>

          {/* Tab Navigation — groups the 16 sections below into 4 focused
              views instead of one long scroll, per feedback that the page
              had too much scrolling. All the same functionality is kept,
              just organized. */}
          <div className="flex flex-wrap gap-2 mb-8 border-b border-white/10 pb-1">
            {[
              { id: "analytics", label: t("tabAnalytics") },
              { id: "emergency", label: t("tabEmergencyResponse") },
              { id: "policy", label: t("tabReportsTrends") },
              { id: "communication", label: t("tabCommunication") },
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

          {/* ============ TAB: ANALYTICS ============ */}
          {activeTab === "analytics" && (
          <div>
          {/* Filters */}
          <div className="dashboard-card p-6 mb-8">
            <h2 className="font-display text-xl text-parchment mb-4">{t("filters")}</h2>
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("dateRange")}</label>
                <select 
                  value={dateFilter} 
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="field-input"
                >
                  <option value="all">{t("allTime")}</option>
                  <option value="today">{t("todayLabel")}</option>
                  <option value="week">{t("lastWeek")}</option>
                  <option value="month">{t("lastMonth")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("location2")}</label>
                <select 
                  value={locationFilter} 
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="field-input"
                >
                  <option value="all">{t("allLocations")}</option>
                  {uniqueLocations.map(location => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("riskLevelLabel")}</label>
                <select 
                  value={riskFilter} 
                  onChange={(e) => setRiskFilter(e.target.value)}
                  className="field-input"
                >
                  <option value="all">{t("allRiskLevels")}</option>
                  <option value="Low">Low</option>
                  <option value="Medium">{t("mediumSeverity")}</option>
                  <option value="High">{t("highSeverity")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("actions")}</label>
                <button 
                  onClick={exportData}
                  className="w-full px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition-colors"
                >
                  {lang === "ur" ? "ایکسپورٹ CSV" : "Export CSV"}</button>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            {/* Risk Distribution */}
            <div className="dashboard-card p-6">
              <h3 className="font-display text-xl text-parchment mb-6">{t("riskDistribution")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={riskDistributionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="risk" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Bar dataKey="count" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                {riskDistributionData.map((item) => (
                  <div key={item.risk} className="text-sm">
                    <div className={`font-semibold ${getRiskColor(item.risk)}`}>{item.risk}</div>
                    <div className="text-muted">{item.percentage}%</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confidence Trend */}
            <div className="dashboard-card p-6">
              <h3 className="font-display text-xl text-parchment mb-6">{t("confidenceTrend")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={confidenceTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="index" stroke="#9CA3AF" label={{ value: "Recent Predictions", position: "insideBottom", offset: -5, fill: "#9CA3AF" }} />
                  <YAxis stroke="#9CA3AF" label={{ value: "Confidence (%)", angle: -90, position: "insideLeft", fill: "#9CA3AF" }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Line type="monotone" dataKey="confidence" stroke="#10B981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Location Risk Analysis */}
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <div className="dashboard-card p-6">
              <h3 className="font-display text-xl text-parchment mb-6">{t("topRiskLocations")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={locationRiskData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" stroke="#9CA3AF" />
                  <YAxis dataKey="location" type="category" stroke="#9CA3AF" width={110} tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Bar dataKey="High" stackId="a" fill="#EF4444" />
                  <Bar dataKey="Medium" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="Low" stackId="a" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Risk Pie Chart */}
            <div className="dashboard-card p-6">
              <h3 className="font-display text-xl text-parchment mb-6">{t("riskOverview")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ risk, percentage }) => `${t(SEVERITY_KEY_MAP[risk] || risk)}: ${percentage}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Predictions Table */}
          <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-display text-xl text-parchment">{t("predictionHistory")}</h3>
              <div className="text-sm text-muted">
                {t("showingXofYPredictions").replace("{x}", filteredPredictions.length).replace("{y}", predictions.length)}
              </div>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-xl border border-white/10 p-2 table-scrollbar">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-[#071326] z-10 shadow-sm">
                  <tr className="border-b border-white/20">
                    <th className="pb-3 text-muted">{t("dateLabel")}</th>
                    <th className="pb-3 text-muted">{t("location2")}</th>
                    <th className="pb-3 text-muted">{t("riskLabel")}</th>
                    <th className="pb-3 text-muted">{t("confidence")}</th>
                    <th className="pb-3 text-muted">{t("rainfallLabel")}</th>
                                        <th className="pb-3 text-muted">{t("temperature")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPredictions.map((pred, index) => (
                    <tr key={index} className="border-b border-white/10">
                      <td className="py-3 text-muted">{new Date(pred.created_at).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined)}</td>
                      <td className="py-3 text-muted">{pred.location}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getRiskBgColor(pred.risk)}`}>
                          {pred.risk}
                        </span>
                      </td>
                      <td className="py-3 text-muted">{(pred.confidence * 100).toFixed(1)}%</td>
                      <td className="py-3 text-muted">{pred.input_data?.rainfall || "N/A"} mm</td>
                                            <td className="py-3 text-muted">{pred.input_data?.temperature || "N/A"}°C</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </div>
          )}
          {/* ============ END TAB: ANALYTICS ============ */}

          {/* ============ TAB: REPORTS & TRENDS ============ */}
          {activeTab === "policy" && (<>
          {/* Citizen reports are reviewed here, instead of on the public
              Community page for government officials. */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <p className="eyebrow text-purple-300 mb-2">{lang === "ur" ? "کمیونٹی انٹیلی جنس" : "Community intelligence"}</p>
                <h2 className="font-display text-2xl text-parchment">{lang === "ur" ? "شہری رپورٹس" : "Citizen reports"}</h2>
                <p className="text-sm text-muted mt-1">{lang === "ur" ? "شہریوں کی جمع کرائی گئی رپورٹس کا جائزہ لیں اور ان کی حیثیت ٹریک کریں۔" : "Review incidents submitted by citizens and track their response status."}</p>
              </div>
              <div className="flex gap-3">
                <select value={reportStatusFilter} onChange={(e) => setReportStatusFilter(e.target.value)} className="field-input text-sm">
                  <option value="All">{lang === "ur" ? "تمام حیثیتیں" : "All statuses"}</option>
                  {["Submitted", "Action Taken", "Resolved"].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={reportSeverityFilter} onChange={(e) => setReportSeverityFilter(e.target.value)} className="field-input text-sm">
                  <option value="All">{lang === "ur" ? "تمام شدتیں" : "All severities"}</option>
                  {["Low", "Medium", "High"].map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                </select>
              </div>
            </div>
            {filteredCommunityReports.length === 0 ? (
              <p className="text-sm text-muted">{lang === "ur" ? "کوئی شہری رپورٹ منتخب کردہ فلٹرز سے مطابقت نہیں رکھتی۔" : "No citizen reports match the selected filters."}</p>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-xl border border-white/10 p-2 table-scrollbar">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#071326] z-10">
                    <tr className="border-b border-white/20 text-muted">
                      <th className="pb-3 pr-4 font-semibold">{lang === "ur" ? "ٹریکنگ آئی ڈی" : "Tracking ID"}</th>
                      <th className="pb-3 pr-4 font-semibold">{lang === "ur" ? "مقام" : "Location"}</th>
                      <th className="pb-3 pr-4 font-semibold">{lang === "ur" ? "شدت" : "Severity"}</th>
                      <th className="pb-3 pr-4 font-semibold">{lang === "ur" ? "حیثیت" : "Status"}</th>
                      <th className="pb-3 pr-4 font-semibold">{lang === "ur" ? "ارسال کنندہ" : "Submitted by"}</th>
                      <th className="pb-3 font-semibold text-right">{lang === "ur" ? "اقدامات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredCommunityReports.map((report) => (
                      <Fragment key={report.id}>
                        <tr className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 pr-4 text-white font-mono text-xs whitespace-nowrap">{report.trackingId}</td>
                          <td className="py-3 pr-4 text-muted max-w-[220px] break-words">{report.location}</td>
                          <td className="py-3 pr-4 text-muted whitespace-nowrap">
                            <span className={`rounded-full border px-2.5 py-1 text-xs ${
                              report.severity === "High"
                                ? "border-red-400/40 bg-red-400/10 text-red-300"
                                : report.severity === "Medium"
                                  ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-300"
                                  : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            }`}>
                              {report.severity}
                            </span>
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <span className={`rounded-full border px-2.5 py-1 text-xs ${
                              report.status === "Resolved"
                                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                : report.status === "Action Taken"
                                  ? "border-blue-400/30 bg-blue-400/10 text-blue-300"
                                  : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                            }`}>{report.status}</span>
                          </td>
                          <td className="py-3 pr-4 text-muted whitespace-nowrap">{report.authorName || report.authorEmail || "Citizen"}</td>
                          <td className="py-3 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setExpandedReportId((current) => current === report.id ? null : report.id)}
                                className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap"
                              >
                                {lang === "ur" ? (expandedReportId === report.id ? "تفصیلات چھپائیں" : "تفصیلات دیکھیں") : (expandedReportId === report.id ? "Hide details" : "View details")}
                              </button>
                              {report.status !== "Resolved" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => updateCommunityReport(report.id, "Action Taken")}
                                    className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap"
                                  >
                                    {lang === "ur" ? "کارروائی کی گئی" : "Action taken"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateCommunityReport(report.id, "Resolved")}
                                    className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                                  >
                                    {lang === "ur" ? "حل کریں" : "Resolve"}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedReportId === report.id && (
                          <tr key={`${report.id}-details`}>
                            <td colSpan="6" className="border-b border-white/10 bg-white/[0.03] p-4">
                              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                                <div className="space-y-2 text-sm">
                                  <p className="text-white"><span className="text-muted">{lang === "ur" ? "واقعے کی قسم:" : "Incident type:"}</span> {report.type || "Flooding"}</p>
                                  <p className="text-white"><span className="text-muted">{lang === "ur" ? "تفصیل:" : "Description:"}</span> {report.description || "No description provided."}</p>
                                  <p className="text-white"><span className="text-muted">{lang === "ur" ? "رابطہ:" : "Contact:"}</span> {report.contact || "Not provided"}</p>
                                  {report.notes && <p className="text-teal-300"><span className="text-muted">{lang === "ur" ? "تازہ ترین اپڈیٹ:" : "Latest update:"}</span> {report.notes}</p>}
                                </div>
                                {getReportImageSource(report.imageUrl) ? (
                                  <img src={getReportImageSource(report.imageUrl)} alt={`Evidence for ${report.trackingId}`} className="h-36 w-full rounded-xl border border-white/10 object-cover" />
                                ) : (
                                  <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-muted">{lang === "ur" ? "کوئی تصویر منسلک نہیں" : "No photo attached"}</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* District Report PDF */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-2">{t("reporting")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("districtReport")}</h2>
            <p className="text-sm text-muted mb-4">{t("districtReportDesc")}</p>
            <div className="flex gap-3">
              <select value={reportCity} onChange={(e) => setReportCity(e.target.value)} className="field-input flex-1">
                <option value="">{t("selectYourCity")}</option>
                {[...new Set(predictions.map((p) => p.location))].filter(Boolean).map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
              <button onClick={handleDownloadDistrictReport} disabled={!reportCity} className="btn-primary shrink-0 disabled:opacity-50">
                📄 {t("downloadReport")}
              </button>
            </div>
          </div>
          </>)}
          {/* ============ END TAB: REPORTS & TRENDS (part 1) ============ */}

          {/* ============ TAB: EMERGENCY RESPONSE ============ */}
          {activeTab === "emergency" && (<>
          {/* High-Risk Alerts — assign a rescue worker directly */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-red-400 mb-2">{t("emergencyResponse")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("highRiskAlerts")}</h2>
            <p className="text-sm text-muted mb-4">{t("highRiskAlertsDesc")}</p>
            {uniqueAlerts.filter((a) => a.status !== "Cancelled" && ((a.risk_level || a.risk) === "High" || (a.risk_level || a.risk) === "Medium")).length === 0 ? (
              <p className="text-sm text-muted">{t("noActiveAlerts")}</p>
            ) : (
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-2 table-scrollbar">
                {uniqueAlerts
                  .filter((a) => a.status !== "Cancelled" && ((a.risk_level || a.risk) === "High" || (a.risk_level || a.risk) === "Medium"))
                  .slice(0, 10)
                  .map((a) => {
                    const linkedOperation = getAlertOperation(a);
                    const assignedWorker = linkedOperation?.assigned_team && linkedOperation.assigned_team !== "Unassigned"
                      ? linkedOperation.assigned_team
                      : null;
                    const alertStatus = linkedOperation?.status === "Completed"
                      ? "Completed"
                      : linkedOperation?.status === "In Progress"
                        ? "In Progress"
                        : assignedWorker
                          ? `Assigned to ${assignedWorker}`
                          : "Pending";
                    const isAssigned = Boolean(assignedWorker);
                    return (
                    <div key={a.id} className="bg-white/[0.03] rounded-xl p-4 border border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${(a.risk_level || a.risk) === "High" ? "text-red-300 border border-red-500/30" : "text-marigold-300 border border-marigold-500/30"}`}>
                              {t(SEVERITY_KEY_MAP[a.risk_level || a.risk] || a.risk_level || a.risk)}
                            </span>
                            <span className="text-sm text-white font-medium">{a.location}</span>
                          </div>
                          <p className="text-sm text-muted">{formatAlertMessage(a.message)}</p>
                        </div>
                        {isAssigned ? (
                          <span className="text-xs text-white bg-[#0b1f3a] border border-white/20 rounded-full px-3 py-2 shrink-0">
                            {linkedOperation?.status === "Assigned" ? `✓ ${t("assignedTo")} ${assignedWorker}` : alertStatus}
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setAssigningAlertId(assigningAlertId === a.id ? null : a.id);
                              setAssignForm({ worker: "", description: "" });
                            }}
                            disabled={assignmentSubmittingId === a.id}
                            className="btn-secondary text-xs py-2 px-3 shrink-0 disabled:opacity-50"
                          >
                            {assignmentSubmittingId === a.id ? "Saving..." : assigningAlertId === a.id ? t("cancel") : t("assignRescueWorker")}
                          </button>
                        )}
                      </div>
                      {!isAssigned && assigningAlertId === a.id && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                          <select
                            value={assignForm.worker}
                            onChange={(e) => setAssignForm((form) => ({ ...form, worker: e.target.value }))}
                            className="field-input text-sm"
                          >
                            <option value="">{t("selectRescueWorker")}</option>
                            {rescueWorkers.filter((worker) => (!worker.status || worker.status.toLowerCase() === "active") && !activeWorkerNames.has(worker.name.toLowerCase())).map((worker) => (
                              <option key={worker.id} value={worker.name}>{worker.name} ({worker.email})</option>
                            ))}
                          </select>
                          <input
                            placeholder={t("operationNotesPh")}
                            value={assignForm.description}
                            onChange={(e) => setAssignForm((form) => ({ ...form, description: e.target.value }))}
                            className="field-input text-sm"
                          />
                          <button
                            onClick={() => handleAssignRescueWorker(a)}
                            disabled={!assignForm.worker || assignmentSubmittingId === a.id}
                            className="btn-primary text-sm w-full disabled:opacity-50"
                          >
                            {t("confirmAssignment")}
                          </button>
                        </div>
                      )}
                    </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Rescue Worker Directory: availability is useful for dispatch,
              while account activation remains an admin responsibility. */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("workforceOversight")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("rescueWorkerDirectory")}</h2>
            <p className="text-sm text-muted mb-4">{t("rescueWorkerDirectoryDesc")}</p>
            {rescueWorkers.length === 0 ? (
              <p className="text-sm text-muted">{t("noRescueWorkersYet")}</p>
            ) : (
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto rounded-xl border border-white/10 p-2 table-scrollbar">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#071326] z-10 shadow-sm">
                    <tr className="border-b border-white/20 text-muted">
                      <th className="pb-2">{t("name")}</th>
                      <th className="pb-2">{t("email")}</th>
                      <th className="pb-2">{t("status")}</th>
                      <th className="pb-2">{lang === "ur" ? "دستیابی" : "Availability"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {rescueWorkers.map((worker) => (
                      <tr key={worker.id}>
                        <td className="py-2 text-white">{worker.name}</td>
                        <td className="py-2 text-muted">{worker.email}</td>
                        <td className="py-2 text-teal-300">{worker.status === "Active" ? t("active") : t("inactive")}</td>
                        <td className="py-2">
                          <span className={activeWorkerNames.has(worker.name.toLowerCase()) ? "text-amber-300" : "text-emerald-300"}>
                            {activeWorkerNames.has(worker.name.toLowerCase()) ? (lang === "ur" ? "مصروف" : "Busy") : (lang === "ur" ? "دستیاب" : "Available")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Rescue Operations Management */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-2">{t("operationsMonitoring")}</p>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
              <div>
                <h2 className="font-display text-2xl text-parchment">{t("rescueOperationsOverview")}</h2>
                <p className="text-sm text-muted mt-2">{t("rescueOperationsOverviewDesc")}</p>
              </div>
              <button onClick={() => setShowOperationForm((value) => !value)} className="btn-secondary text-sm py-2.5">
                {showOperationForm ? t("cancel") : (lang === "ur" ? "+ نیا آپریشن" : "+ New Operation")}
              </button>
            </div>
            {operationFeedback && (operationFeedback.type === "success"
              ? <p className="text-sm text-emerald-400 mb-4">✓ {operationFeedback.message}</p>
              : <p className="text-sm text-red-400 mb-4">⚠ {operationFeedback.message}</p>)}
            {showOperationForm && (
              <form onSubmit={handleCreateOperation} className="space-y-3 mb-6 bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="grid md:grid-cols-2 gap-3">
                  <input
                    required
                    placeholder={lang === "ur" ? "متاثرہ مقام" : "Affected location"}
                    value={operationForm.location}
                    onChange={(e) => setOperationForm((form) => ({ ...form, location: e.target.value }))}
                    className="field-input"
                  />
                  <select
                    value={operationForm.risk_level}
                    onChange={(e) => setOperationForm((form) => ({ ...form, risk_level: e.target.value }))}
                    className="field-input"
                  >
                    <option value="High">{lang === "ur" ? "زیادہ ترجیح" : "High priority"}</option>
                    <option value="Medium">{lang === "ur" ? "درمیانہ ترجیح" : "Medium priority"}</option>
                    <option value="Low">{lang === "ur" ? "کم ترجیح" : "Low priority"}</option>
                  </select>
                </div>
                <textarea
                  required
                  rows={3}
                  placeholder={lang === "ur" ? "آپریشن کی تفصیل" : "Operation description"}
                  value={operationForm.description}
                  onChange={(e) => setOperationForm((form) => ({ ...form, description: e.target.value }))}
                  className="field-input resize-none"
                />
                <div className="field-input space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs text-muted">
                    {lang === "ur" ? "ریسکیو ورکرز منتخب کریں" : "Select rescue workers"}{!multiWorkerEnabled && (lang === "ur" ? " (ایک ورکر منتخب کریں)" : " (choose one)")}
                  </p>
                  {rescueWorkers.filter((worker) => (!worker.status || worker.status.toLowerCase() === "active")).map((worker) => {
                    const busy = activeWorkerNames.has(worker.name.toLowerCase());
                    const checked = operationForm.worker_names.includes(worker.name);
                    return (
                      <label key={worker.id} className={`flex items-center gap-2 text-sm ${busy ? "opacity-50" : ""}`}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={checked}
                          onChange={(e) => setOperationForm((form) => ({
                            ...form,
                            worker_names: e.target.checked
                              ? [...form.worker_names, worker.name]
                              : form.worker_names.filter((name) => name !== worker.name),
                          }))}
                        />
                        {worker.name} {busy ? "(Busy)" : "(Available)"}
                      </label>
                    );
                  })}
                </div>
                <select
                  value={operationForm.alert_id}
                  onChange={(e) => setOperationForm((form) => ({ ...form, alert_id: e.target.value }))}
                  className="field-input"
                >
                  <option value="">{lang === "ur" ? "سیلاب سے متعلق کوئی الرٹ نہیں (علیحدہ آپریشن)" : "No related flood alert (standalone operation)"}</option>
                  {pendingAlerts.map((alert) => (
                    <option key={alert.id} value={alert.id}>
                        #{alert.id} — {alert.location} ({alert.risk_level || alert.risk})
                      </option>
                    ))}
                </select>
                <button type="submit" className="btn-primary w-full">{lang === "ur" ? "آپریشن بنائیں اور روانہ کریں" : "Create & dispatch operation"}</button>
              </form>
            )}
            {allRescueOps.length === 0 ? (
              <p className="text-sm text-muted">{t("noOperationsFound")}</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex justify-end mb-4">
                  <select value={operationStatusFilter} onChange={(e) => setOperationStatusFilter(e.target.value)} className="field-input text-sm max-w-xs">
                    <option value="Active">{lang === "ur" ? "فعال آپریشنز" : "Active operations"}</option>
                    <option value="Completed">{lang === "ur" ? "مکمل شدہ آپریشنز" : "Completed operations"}</option>
                    <option value="All">{lang === "ur" ? "تمام آپریشنز" : "All operations"}</option>
                  </select>
                </div>
                {displayedOperations.length === 0 ? (
                  <p className="text-sm text-muted">{lang === "ur" ? "اس ویو میں کوئی آپریشن موجود نہیں ہے۔" : "No operations in this view."}</p>
                ) : (
                  <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-xl border border-white/10 p-2 table-scrollbar">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-[#071326] z-10 shadow-sm">
                        <tr className="border-b border-white/20 text-muted">
                      <th className="pb-2">{t("location2")}</th>
                      <th className="pb-2">{t("statusLabel")}</th>
                      <th className="pb-2">{t("riskLabel")}</th>
                      <th className="pb-2">{t("teamLabel")}</th>
                      <th className="pb-2">{t("updatedLabel")}</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {displayedOperations.map((op) => (
                      <tr key={op.id} className={`align-top ${op.status === "Completed" ? "bg-white/[0.02]" : ""}`}>
                        <td className="py-2 text-white">{op.location}</td>
                        <td className="py-2">
                          <select
                            value={op.status}
                            onChange={(e) => handleOperationStatusChange(op, e.target.value)}
                            disabled={op.status === "Completed"}
                            className={`bg-[#0b1f3a] border rounded px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70 ${
                              operationStatusErrors[op.id] && !isOperationAssigned(op) ? "border-red-500 ring-1 ring-red-500" : "border-white/20"
                            }`}
                          >
                            <option className="bg-[#0b1f3a] text-white" value="Assigned">{lang === "ur" ? "شروع ہوا" : "Started"}</option>
                            <option className="bg-[#0b1f3a] text-white" value="In Progress">{lang === "ur" ? "جاری ہے" : "In Progress"}</option>
                            <option className="bg-[#0b1f3a] text-white" value="Completed">{lang === "ur" ? "مکمل" : "Completed"}</option>
                          </select>
                          {operationStatusErrors[op.id] && !isOperationAssigned(op) && (
                            <p role="alert" className="text-[11px] text-red-400 font-medium mt-1 max-w-[160px] leading-tight">
                              ⚠ {operationStatusErrors[op.id]}
                            </p>
                          )}
                        </td>
                        <td className="py-2">
                          <select
                            value={op.risk_level || "Medium"}
                            onChange={(e) => handleUpdateOperation(op, { risk_level: e.target.value })}
                            disabled={op.status === "Completed"}
                            className="bg-[#0b1f3a] border border-white/20 rounded px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <option className="bg-[#0b1f3a] text-white" value="High">High</option>
                            <option className="bg-[#0b1f3a] text-white" value="Medium">Medium</option>
                            <option className="bg-[#0b1f3a] text-white" value="Low">Low</option>
                          </select>
                        </td>
                        <td className="py-2">
                          {(() => {
                            const isActive = op.status !== "Completed";
                            const chips = op.workers || (op.assigned_team && op.assigned_team !== "Unassigned"
                              ? op.assigned_team.split(", ").map((name) => ({ name, status: isActive ? "Busy" : "Available" }))
                              : []);
                            return (
                              <div className="flex flex-wrap gap-1 max-w-56">
                                {chips.map((worker) => (
                                  <span key={worker.name} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">
                                    {worker.name}
                                  </span>
                                ))}
                                {chips.length === 0 && <span className="text-xs text-muted">{lang === "ur" ? "کوئی ٹیم منتخب نہیں" : "No team selected"}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-2 text-muted">{new Date(op.updated_at).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined)}</td>
                        <td className="py-2">
                          <button
                            onClick={() => setSelectedOperationId(selectedOperationId === op.id ? null : op.id)}
                            className="text-xs text-teal-300 hover:text-teal-200"
                          >
                            {selectedOperationId === op.id ? "Hide details" : "View details"}
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
            {selectedOperationId && (() => {
              const operation = allRescueOps.find((item) => item.id === selectedOperationId);
              if (!operation) return null;
              return (
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="font-display text-xl text-parchment mb-2">{lang === "ur" ? `آپریشن #${operation.id} کی تفصیلات` : `Operation #${operation.id} details`}</h3>
                  <p className="text-sm text-muted mb-4">{operation.description || "No description provided."}</p>
                  {(() => {
                    const isActive = operation.status !== "Completed";
                    const team = operation.workers || (operation.assigned_team && operation.assigned_team !== "Unassigned"
                      ? operation.assigned_team.split(", ").map((name) => ({ name }))
                      : []);
                    const available = rescueWorkers.filter((worker) =>
                      (!worker.status || worker.status.toLowerCase() === "active") && !activeWorkerNames.has(String(worker.name).toLowerCase()));
                    return (
                      <div className="mb-5 rounded-lg border border-white/10 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted mb-2">{lang === "ur" ? "ٹیم منظم کریں" : "Manage Team"}</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {team.length === 0 && <span className="text-sm text-muted">{lang === "ur" ? "کوئی ٹیم منتخب نہیں" : "No team selected"}</span>}
                          {team.map((worker) => (
                            <span key={worker.name} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
                              {worker.name}
                              {isActive && multiWorkerEnabled && (
                                <button type="button" title="Remove worker" onClick={() => handleRemoveWorker(operation, worker.name)} className="text-red-300 hover:text-red-200">Remove</button>
                              )}
                            </span>
                          ))}
                        </div>
                        {isActive && !multiWorkerEnabled && (
                          <p className="text-xs text-amber-300">Adding or removing workers is pending database migration approval.</p>
                        )}
                        {isActive && multiWorkerEnabled && (
                          <div>
                            <p className="text-xs text-muted mb-1">Add Workers (available only)</p>
                            {available.length === 0 ? (
                              <p className="text-xs text-muted">No available workers.</p>
                            ) : (
                              <div className="flex flex-wrap gap-3 mb-2">
                                {available.map((worker) => (
                                  <label key={worker.id} className="flex items-center gap-1 text-xs text-white">
                                    <input
                                      type="checkbox"
                                      checked={manageWorkerPick.includes(worker.name)}
                                      onChange={(e) => setManageWorkerPick((prev) =>
                                        e.target.checked ? [...prev, worker.name] : prev.filter((n) => n !== worker.name))}
                                    />
                                    {worker.name}
                                  </label>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={manageWorkerPick.length === 0}
                              onClick={() => handleAddWorkers(operation, manageWorkerPick)}
                              className="btn-secondary text-xs py-1 px-3 disabled:opacity-50"
                            >
                              Add selected workers
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="grid md:grid-cols-2 gap-5">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted mb-2">{lang === "ur" ? "پیشرفت چیک لسٹ" : "Progress checklist"}</p>
                      <div className="space-y-2">
                        {(operation.checklist || []).map((item, index) => (
                          <label key={`${operation.id}-${index}`} className="flex items-center gap-2 text-sm text-white">
                            <input
                              type="checkbox"
                              checked={!!item.done}
                              onChange={(e) => handleChecklistUpdate(operation, index, e.target.checked)}
                              disabled={operation.status === "Completed"}
                            />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted mb-2">{lang === "ur" ? "ورکرز اپڈیٹس" : "Worker updates"}</p>
                      {(operation.update_log || []).length === 0 ? (
                        <p className="text-sm text-muted">{lang === "ur" ? "ورکر کی طرف سے ابھی کوئی اپڈیٹ نہیں ہے۔" : "No worker updates yet."}</p>
                      ) : (
                        <div className="space-y-2">
                          {operation.update_log.map((entry, index) => (
                            <div key={`${operation.id}-update-${index}`} className="text-sm text-muted border-l-2 border-teal-400/50 pl-3">
                              <p className="text-white">{entry.note}</p>
                              <p className="text-xs mt-1">{new Date(entry.timestamp).toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
          </>)}
          {/* ============ END TAB: EMERGENCY RESPONSE ============ */}

          {/* ============ TAB: COMMUNICATION (part 1) ============ */}
          {activeTab === "communication" && (<>
          </>)}
          {/* ============ END TAB: COMMUNICATION (part 1) ============ */}

          {/* ============ TAB: REPORTS & TRENDS (part 2) ============ */}
          {activeTab === "policy" && (<>
          {/* Seasonal / Historical Trend */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-red-400 mb-2">{t("historicalContext")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("seasonalTrend")}</h2>
            <p className="text-sm text-muted mb-4">{t("seasonalTrendDesc")}</p>
            {seasonalTrend.length === 0 ? (
              <p className="text-sm text-muted">{t("notEnoughHistory")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={seasonalTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#233047" />
                  <XAxis dataKey="month" stroke="#93A0B4" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#93A0B4" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#101826', border: '1px solid #233047', borderRadius: '10px' }} labelStyle={{ color: '#F3EDE1' }} />
                  <Bar dataKey="Low" stackId="a" fill="#3FBDB6" />
                  <Bar dataKey="Medium" stackId="a" fill="#E8A33D" />
                  <Bar dataKey="High" stackId="a" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          </>)}
          {/* ============ END TAB: REPORTS & TRENDS (part 2) ============ */}

          {/* ============ TAB: COMMUNICATION (part 2) ============ */}
          {activeTab === "communication" && (<>
          {/* Public Advisories */}
          <div className="dashboard-card p-6 mb-8">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="eyebrow text-teal-400 mb-2">{t("officialCommunication")}</p>
                <h2 className="font-display text-2xl text-parchment">{t("publicAdvisories")}</h2>
              </div>
              <button onClick={() => setShowAdvisoryForm((v) => !v)} className="btn-secondary text-sm py-2.5">
                {showAdvisoryForm ? t("cancel") : t("issueAdvisory")}
              </button>
            </div>
            <p className="text-sm text-muted mb-4">{t("advisoriesDesc")}</p>

            {showAdvisoryForm && (
              <form onSubmit={handleCreateAdvisory} className="space-y-3 mb-6 bg-white/5 rounded-xl p-4 border border-white/10">
                <input required placeholder={t("advisoryTitlePh")} value={advisoryForm.title}
                  onChange={(e) => setAdvisoryForm((p) => ({ ...p, title: e.target.value }))} className="field-input" />
                <textarea required rows={3} placeholder={t("advisoryMessagePh")} value={advisoryForm.message}
                  onChange={(e) => setAdvisoryForm((p) => ({ ...p, message: e.target.value }))} className="field-input resize-none" />
                <select required value={advisoryForm.region}
                  onChange={(e) => setAdvisoryForm((p) => ({ ...p, region: e.target.value }))} className="field-input">
                  <option value="All regions">{lang === "ur" ? "تمام علاقے" : "All regions"}</option>
                  {uniqueLocations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
                <button type="submit" className="btn-primary w-full">{t("issueAdvisory")}</button>
              </form>
            )}

            {advisories.length === 0 ? (
              <p className="text-sm text-muted">{t("noAdvisoriesYet")}</p>
            ) : (
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-2 table-scrollbar">
                {advisories.map((a) => (
                  <div key={a.id} className="bg-white/[0.03] rounded-xl p-4 border border-white/10">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-white">{a.title}</h4>
                        <p className="text-sm text-muted mt-1">{a.message}</p>
                        <p className="text-xs text-muted mt-2">{a.region} · {new Date(a.created_at).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined)}</p>
                      </div>
                      <button onClick={() => handleWithdrawAdvisory(a.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0">{t("withdraw")}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>)}
          {/* ============ END TAB: COMMUNICATION (part 2) ============ */}
        </div>
      </div>
      <Footer />
    </div>
  );
}
