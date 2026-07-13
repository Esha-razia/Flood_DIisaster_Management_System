import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

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
  const [resourceGap, setResourceGap] = useState([]);
  const [compareCities, setCompareCities] = useState(["", ""]);
  const [reportCity, setReportCity] = useState("");

  useEffect(() => {
    fetchAdvisories();
    fetchResourceGap();
  }, []);

  const fetchAdvisories = async () => {
    try {
      const res = await axios.get(`${API_BASE}/advisories`);
      setAdvisories(res.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchResourceGap = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/resource-gap-analysis`);
      setResourceGap(res.data || []);
    } catch (err) { console.error(err); }
  };

  const handleCreateAdvisory = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/advisories`, { ...advisoryForm, issued_by: localStorage.getItem("userName") || "Government Official" });
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

  const cityComparisonData = useMemo(() => {
    return compareCities.filter(Boolean).map((city) => {
      const cityPreds = predictions.filter((p) => p.location === city);
      const latest = cityPreds[0];
      const highCount = cityPreds.filter((p) => p.risk === "High").length;
      return {
        city, totalPredictions: cityPreds.length,
        latestRisk: latest?.risk || "—", latestConfidence: latest?.confidence,
        highRiskCount: highCount,
      };
    });
  }, [compareCities, predictions]);

  useEffect(() => {
    fetchPredictions();
    fetchAlerts();
    const interval = setInterval(() => {
      fetchPredictions();
      fetchAlerts();
    }, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, []);

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

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/alerts`);
      setAlerts(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

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
    const csvContent = [
      ["Date", "Location", "Risk", "Confidence", "Rainfall", "River Level", "Temperature"],
      ...filteredPredictions.map(pred => [
        new Date(pred.created_at).toLocaleString(),
        pred.location,
        pred.risk,
        (pred.confidence * 100).toFixed(1) + "%",
        pred.input_data?.rainfall || "N/A",
        pred.input_data?.river_level || "N/A",
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

          {/* Filters */}
          <div className="dashboard-card p-6 mb-8">
            <h2 className="font-display text-xl text-parchment mb-4">{t("filters")}</h2>
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">{t("dateRange")}</label>
                <select 
                  value={dateFilter} 
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                  Export CSV
                </button>
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
              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4 text-center">
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
                <BarChart data={locationRiskData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" stroke="#9CA3AF" />
                  <YAxis dataKey="location" type="category" stroke="#9CA3AF" width={80} />
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
                Showing {filteredPredictions.length} of {predictions.length} predictions
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="pb-3 text-muted">{t("dateLabel")}</th>
                    <th className="pb-3 text-muted">{t("location2")}</th>
                    <th className="pb-3 text-muted">{t("riskLabel")}</th>
                    <th className="pb-3 text-muted">{t("confidence")}</th>
                    <th className="pb-3 text-muted">{t("rainfallLabel")}</th>
                    <th className="pb-3 text-muted">{t("riverLevelLabel")}</th>
                    <th className="pb-3 text-muted">{t("temperature")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPredictions.slice(0, 20).map((pred, index) => (
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
                      <td className="py-3 text-muted">{pred.input_data?.river_level || "N/A"} m</td>
                      <td className="py-3 text-muted">{pred.input_data?.temperature || "N/A"}°C</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPredictions.length > 20 && (
                <div className="text-center mt-4 text-muted">
                  Showing first 20 results. Use filters to see more data.
                </div>
              )}
            </div>
          </div>

          {/* Resource Gap Analysis */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-red-400 mb-2">{t("policyPlanning")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("resourceGapAnalysis")}</h2>
            <p className="text-sm text-muted mb-4">{t("resourceGapDesc")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/20 text-muted">
                    <th className="pb-2">{t("location2")}</th>
                    <th className="pb-2">{t("riskLabel")}</th>
                    <th className="pb-2">{t("shelters")}</th>
                    <th className="pb-2">{t("hospitals")}</th>
                    <th className="pb-2">{t("statusLabel")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {resourceGap.slice(0, 15).map((row) => (
                    <tr key={row.city} className={row.gap_flag ? "bg-red-500/5" : ""}>
                      <td className="py-2 text-white">{row.city}</td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${row.risk === "High" ? "text-red-300" : row.risk === "Medium" ? "text-marigold-300" : "text-teal-300"}`}>
                          {t(SEVERITY_KEY_MAP[row.risk] || row.risk)}
                        </span>
                      </td>
                      <td className="py-2 text-muted">{row.shelters}</td>
                      <td className="py-2 text-muted">{row.hospitals}</td>
                      <td className="py-2">
                        {row.gap_flag && <span className="text-xs text-red-400 font-semibold">⚠ {t("underResourced")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Multi-City Comparison */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-teal-400 mb-2">{t("comparativeAnalysis")}</p>
            <h2 className="font-display text-2xl text-parchment mb-4">{t("multiCityComparison")}</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {[0, 1].map((i) => (
                <select
                  key={i}
                  value={compareCities[i]}
                  onChange={(e) => setCompareCities((prev) => { const next = [...prev]; next[i] = e.target.value; return next; })}
                  className="field-input"
                >
                  <option value="">{t("selectCityToCompare")}</option>
                  {[...new Set(predictions.map((p) => p.location))].filter(Boolean).map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              ))}
            </div>
            {cityComparisonData.length > 0 && (
              <div className="grid md:grid-cols-2 gap-4">
                {cityComparisonData.map((c) => (
                  <div key={c.city} className="stat-tile">
                    <h4 className="font-display text-lg text-parchment mb-3">{c.city}</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted">{t("latestRisk")}</span><span className="text-white">{c.latestRisk}</span></div>
                      <div className="flex justify-between"><span className="text-muted">{t("totalPredictionsLabel")}</span><span className="text-white">{c.totalPredictions}</span></div>
                      <div className="flex justify-between"><span className="text-muted">{t("highRiskCount")}</span><span className="text-red-300">{c.highRiskCount}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* District Report PDF */}
          <div className="dashboard-card p-6 mb-8">
            <p className="eyebrow text-marigold-400 mb-2">{t("reporting")}</p>
            <h2 className="font-display text-2xl text-parchment mb-2">{t("districtReport")}</h2>
            <p className="text-sm text-muted mb-4">{t("districtReportDesc")}</p>
            <div className="flex flex-col sm:flex-row gap-3">
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
                <input placeholder={t("advisoryRegionPh")} value={advisoryForm.region}
                  onChange={(e) => setAdvisoryForm((p) => ({ ...p, region: e.target.value }))} className="field-input" />
                <button type="submit" className="btn-primary w-full">{t("issueAdvisory")}</button>
              </form>
            )}

            {advisories.length === 0 ? (
              <p className="text-sm text-muted">{t("noAdvisoriesYet")}</p>
            ) : (
              <div className="space-y-3">
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
        </div>
      </div>
      <Footer />
    </div>
  );
}
