import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import Navbar from "../components/Navbar";
import { useLanguage } from "../context/LanguageContext";
import Footer from "../components/Footer";
import { API_BASE } from "../config";

// Coordinates for the cities the ML model was trained on — used to pull
// live weather automatically so citizens don't have to guess numbers.
const CITY_COORDINATES = {
  "Karachi": [24.8607, 67.0011],
  "Lahore": [31.5204, 74.3587],
  "Faisalabad": [31.4504, 73.135],
  "Rawalpindi": [33.5651, 73.0169],
  "Multan": [30.1575, 71.5249],
  "Hyderabad": [25.396, 68.3578],
  "Gujranwala": [32.1877, 74.1945],
  "Peshawar": [34.0151, 71.5249],
  "Quetta": [30.1798, 66.975],
  "Islamabad": [33.6844, 73.0479],
  "Sialkot": [32.4945, 74.5229],
  "Sargodha": [32.0836, 72.6711],
  "Bahawalpur": [29.3956, 71.6836],
  "Sukkur": [27.7052, 68.8574],
  "Larkana": [27.559, 68.2123],
  "Sheikhupura": [31.7167, 73.985],
  "Jhang": [31.2704, 72.3181],
  "Rahim Yar Khan": [28.4202, 70.2952],
  "Gujrat": [32.5731, 74.0789],
  "Mardan": [34.1989, 72.0404],
  "Kasur": [31.118, 74.4467],
  "Okara": [30.8081, 73.4453],
  "Sahiwal": [30.6682, 73.1114],
  "Nawabshah": [26.2442, 68.41],
  "Mingora": [34.7717, 72.3604],
  "Dera Ghazi Khan": [30.0561, 70.6345],
  "Mirpur Khas": [25.5268, 69.0107],
  "Chiniot": [31.72, 72.9781],
  "Kamoke": [32.0989, 74.2263],
  "Mandi Bahauddin": [32.5859, 73.4917],
  "Jacobabad": [28.2769, 68.4381],
  "Jhelum": [32.9425, 73.7257],
  "Kohat": [33.59, 71.44],
  "Shikarpur": [27.9556, 68.6382],
  "Khanewal": [30.3015, 71.931],
  "Muzaffargarh": [30.0725, 71.1932],
  "Abbottabad": [34.1463, 73.2116],
  "Muridke": [31.8025, 74.2645],
  "Bahawalnagar": [29.9989, 73.2578],
  "Khairpur": [27.5295, 68.7592],
  "Turbat": [26.0031, 63.0483],
  "Dadu": [26.7308, 67.7761],
  "Chaman": [30.921, 66.4597],
  "Charsadda": [34.15, 71.74],
  "Nowshera": [34.015, 71.975],
  "Swabi": [34.12, 72.47],
  "Bannu": [32.988, 70.603],
  "Dera Ismail Khan": [31.831, 70.901],
  "Muzaffarabad": [34.37, 73.47],
  "Mirpur": [33.1478, 73.7508],
  "Gilgit": [35.9208, 74.3144],
  "Skardu": [35.2971, 75.6333],
  "Gwadar": [25.1264, 62.3225],
};

// River level is described qualitatively (a citizen can't know the exact
// meter reading) and mapped to a representative value for record-keeping.
// A citizen can't know exact rainfall in mm — these qualitative buckets map
// to representative values that match the model's rain_intensity buckets
// (0 / 0-2.5 / 2.5-7.6 / 7.6-15 / >15mm).
const RAINFALL_OPTIONS = [
  { value: "0", labelKey: "rainfallNone", bucketMax: 0 },
  { value: "1", labelKey: "rainfallLight", bucketMax: 2.5 },
  { value: "5", labelKey: "rainfallModerate", bucketMax: 7.6 },
  { value: "11", labelKey: "rainfallHeavy", bucketMax: 15 },
  { value: "25", labelKey: "rainfallVeryHeavy", bucketMax: Infinity },
];

function nearestRainfallBucket(mm) {
  const value = parseFloat(mm);
  if (isNaN(value)) return "";
  const match = RAINFALL_OPTIONS.find((opt) => value <= opt.bucketMax);
  return (match || RAINFALL_OPTIONS[RAINFALL_OPTIONS.length - 1]).value;
}

function resolveCityCoords(location) {
  if (!location) return null;
  const loc = location.trim().toLowerCase();
  const match = Object.keys(CITY_COORDINATES).find(
    (city) => city.toLowerCase() === loc || city.toLowerCase().includes(loc) || loc.includes(city.toLowerCase())
  );
  return match ? { city: match, coords: CITY_COORDINATES[match] } : null;
}

export default function CitizenDashboard() {
  const { t, lang } = useLanguage();
  const userEmail = localStorage.getItem("userEmail");
  const [formData, setFormData] = useState({
    location: "",
    rainfall: "",
    river_level: "",
    temperature: "",
    humidity: "",
    wind_speed: "",
    soil_moisture_top: "",
    soil_7day_avg: ""
  });

  const [weatherStatus, setWeatherStatus] = useState(null); // null | 'loading' | 'done' | 'unavailable'
  const [rawFetchedRainfall, setRawFetchedRainfall] = useState(null);
  const [autoFilledFields, setAutoFilledFields] = useState({});
  const [liveConditions, setLiveConditions] = useState(null);

  const [formErrors, setFormErrors] = useState({
    location: "",
    rainfall: "",
    river_level: "",
    temperature: ""
  });

  const [prediction, setPrediction] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toastAlerts, setToastAlerts] = useState([]);
  const [nearestPlaces, setNearestPlaces] = useState(null); // { shelter, hospital } | 'loading' | 'error'

  // Add useEffect to update prediction when predictions change
  useEffect(() => {
    if (predictions.length > 0) {
      setPrediction(predictions[0]);
    }
  }, [predictions]);

  useEffect(() => {
    fetchPredictions();
    fetchAlerts();
  }, []);

  // Auto-fetch live weather once the citizen picks a recognised city — this
  // Auto-fetch live weather for whatever city the citizen types — this is
  // what lets them avoid guessing exact rainfall/temperature numbers.
  // Tries the model's 10 known cities first (instant, no network round-trip
  // for geocoding), then falls back to Open-Meteo's free geocoding search
  // so it also works for any other Pakistani city/town.
  useEffect(() => {
    const location = formData.location.trim();
    if (location.length < 3) {
      setWeatherStatus(null);
      return;
    }

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setWeatherStatus("loading");
      try {
        let lat, lon;
        const knownMatch = resolveCityCoords(location);
        if (knownMatch) {
          [lat, lon] = knownMatch.coords;
        } else {
          // Fall back to geocoding so unlisted towns/cities work too
          const geo = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
            params: { name: location, count: 1, country: "PK", language: "en" },
          });
          const result = geo.data?.results?.[0];
          if (!result) {
            if (!cancelled) setWeatherStatus("unavailable");
            return;
          }
          lat = result.latitude;
          lon = result.longitude;
        }

        const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
          params: {
            latitude: lat,
            longitude: lon,
            current: "temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m",
            hourly: "soil_moisture_0_to_1cm",
            daily: "precipitation_sum",
            timezone: "auto",
            past_days: 7,       // needed so we can compute a real 7-day soil moisture average
            forecast_days: 1,
            wind_speed_unit: "ms",
          },
        });
        if (cancelled) return;
        const temp = res.data?.current?.temperature_2m;
        const rain = res.data?.daily?.precipitation_sum?.[7] ?? res.data?.current?.precipitation; // index 7 = "today" since past_days=7 prepends 7 days
        const humidity = res.data?.current?.relative_humidity_2m;
        const windSpeed = res.data?.current?.wind_speed_10m;

        // Soil moisture isn't in the "current" block — pull it from the
        // hourly series instead. The most recent hour = current surface
        // moisture; averaging the whole past-7-days series = the 7-day
        // average feature the model expects. Real measured data, not a
        // generic historical guess.
        let soilTop = null, soil7day = null;
        const hourlyTimes = res.data?.hourly?.time || [];
        const hourlySoil = res.data?.hourly?.soil_moisture_0_to_1cm || [];
        if (hourlySoil.length > 0) {
          const nowHour = new Date().toISOString().slice(0, 13);
          let idx = hourlyTimes.findIndex((t) => t.startsWith(nowHour));
          if (idx === -1) idx = hourlySoil.length - 1;
          soilTop = hourlySoil[idx];
          const validReadings = hourlySoil.filter((v) => v !== null && v !== undefined);
          soil7day = validReadings.length > 0 ? validReadings.reduce((a, b) => a + b, 0) / validReadings.length : null;
        }

        setRawFetchedRainfall(rain !== undefined ? rain : null);
        setLiveConditions({
          humidity: humidity !== undefined ? humidity : null,
          windSpeed: windSpeed !== undefined ? windSpeed : null,
          soilTop, soil7day,
        });
        setFormData((prev) => ({
          ...prev,
          temperature: temp !== undefined ? String(temp) : prev.temperature,
          rainfall: rain !== undefined ? nearestRainfallBucket(rain) : prev.rainfall,
          humidity: humidity !== undefined ? String(humidity) : prev.humidity,
          wind_speed: windSpeed !== undefined ? String(windSpeed) : prev.wind_speed,
          soil_moisture_top: soilTop !== null ? String(soilTop) : prev.soil_moisture_top,
          soil_7day_avg: soil7day !== null ? String(soil7day.toFixed(3)) : prev.soil_7day_avg,
        }));
        setAutoFilledFields({
          temperature: temp !== undefined, rainfall: rain !== undefined,
          humidity: humidity !== undefined, wind_speed: windSpeed !== undefined,
          soil_moisture_top: soilTop !== null, soil_7day_avg: soil7day !== null,
        });
        setWeatherStatus("done");
      } catch (err) {
        console.error("Live weather fetch failed:", err);
        if (!cancelled) setWeatherStatus("unavailable");
      }
    }, 600); // wait for the citizen to stop typing before calling the API

    return () => { cancelled = true; clearTimeout(debounce); };
  }, [formData.location]);

  const fetchPredictions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/predictions`);
      console.log("Fetched predictions:", res.data);
      setPredictions(res.data || []);
    } catch (err) {
      console.error("Error fetching predictions:", err);
      setPredictions([]);
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

  // List of valid Pakistani cities
  const validLocations = [
    "Karachi",
    "Lahore",
    "Faisalabad",
    "Rawalpindi",
    "Multan",
    "Hyderabad",
    "Gujranwala",
    "Peshawar",
    "Quetta",
    "Islamabad",
    "Sialkot",
    "Sargodha",
    "Bahawalpur",
    "Sukkur",
    "Larkana",
    "Sheikhupura",
    "Jhang",
    "Rahim Yar Khan",
    "Gujrat",
    "Mardan",
    "Kasur",
    "Okara",
    "Sahiwal",
    "Nawabshah",
    "Mingora",
    "Dera Ghazi Khan",
    "Mirpur Khas",
    "Chiniot",
    "Kamoke",
    "Mandi Bahauddin",
    "Jacobabad",
    "Jhelum",
    "Kohat",
    "Shikarpur",
    "Khanewal",
    "Muzaffargarh",
    "Abbottabad",
    "Muridke",
    "Bahawalnagar",
    "Khairpur",
    "Turbat",
    "Dadu",
    "Chaman",
    "Charsadda",
    "Nowshera",
    "Swabi",
    "Bannu",
    "Dera Ismail Khan",
    "Muzaffarabad",
    "Mirpur",
    "Gilgit",
    "Skardu",
    "Gwadar"
  ];

  const validateForm = () => {
    const errors = {
      location: "",
      rainfall: "",
      river_level: "",
      temperature: ""
    };
    let isValid = true;

    // Location validation — now a dropdown, so this only needs to catch "nothing selected"
    if (!formData.location) {
      errors.location = t("locationRequired");
      isValid = false;
    }

    // Rainfall validation
    const rainfall = parseFloat(formData.rainfall);
    if (formData.rainfall === "") {
      errors.rainfall = t("rainfallRequired");
      isValid = false;
    } else if (isNaN(rainfall) || rainfall < 0) {
      errors.rainfall = t("rainfallPositive");
      isValid = false;
    } else if (rainfall > 1000) {
      errors.rainfall = t("rainfallUnrealistic");
      isValid = false;
    }

    // River level — qualitative dropdown, optional (a citizen usually can't measure this themselves)
    // no validation needed; blank simply means "not sure"

    // Temperature validation
    const temperature = parseFloat(formData.temperature);
    if (!formData.temperature) {
      errors.temperature = t("temperatureRequired");
      isValid = false;
    } else if (isNaN(temperature)) {
      errors.temperature = t("temperatureMustBeNumber");
      isValid = false;
    } else if (temperature < -10 || temperature > 60) {
      errors.temperature = t("temperatureRange");
      isValid = false;
    }

    setFormErrors(errors);
    return isValid;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error for this field when user starts typing
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [familyContacts, setFamilyContacts] = useState([]);
  const [newContact, setNewContact] = useState({ name: "", phone: "", relation: "" });
  const [showFamilyForm, setShowFamilyForm] = useState(false);

  const fetchFamilyContacts = async () => {
    if (!userEmail) return;
    try {
      const res = await axios.get(`${API_BASE}/family-contacts?email=${encodeURIComponent(userEmail)}`);
      setFamilyContacts(res.data || []);
    } catch (err) {
      console.error("Failed to load family contacts:", err);
    }
  };

  useEffect(() => { fetchFamilyContacts(); }, []);

  const handleAddContact = async (e) => {
    e.preventDefault();
    if (!newContact.name || !newContact.phone) return;
    try {
      await axios.post(`${API_BASE}/family-contacts`, { owner_email: userEmail, ...newContact });
      setNewContact({ name: "", phone: "", relation: "" });
      setShowFamilyForm(false);
      fetchFamilyContacts();
    } catch (err) {
      console.error("Failed to add contact:", err);
    }
  };

  const handleDeleteContact = async (id) => {
    try {
      await axios.delete(`${API_BASE}/family-contacts/${id}`);
      fetchFamilyContacts();
    } catch (err) {
      console.error("Failed to delete contact:", err);
    }
  };

  const handleGetForecast = async () => {
    if (!formData.location) return;
    setForecastLoading(true);
    setForecast(null);
    try {
      const res = await axios.post(`${API_BASE}/predict/forecast`, { location: formData.location });
      setForecast(res.data);
    } catch (err) {
      console.error("Forecast failed:", err);
      setForecast("error");
    } finally {
      setForecastLoading(false);
    }
  };

  const [pdfError, setPdfError] = useState("");

  const handleDownloadPdf = async () => {
    if (!prediction) return;
    setPdfError("");
    try {
      const res = await axios.post(`${API_BASE}/predict/pdf`, prediction, { responseType: "blob" });

      // If the backend actually sent back a JSON error, it still arrives
      // here as a blob (since responseType is fixed for the whole request) —
      // detect that case so the user sees the real reason instead of nothing.
      if (res.data.type === "application/json") {
        const text = await res.data.text();
        const parsed = JSON.parse(text);
        setPdfError(parsed.message || "Could not generate PDF.");
        return;
      }

      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "flood_prediction_report.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      // Try to read the error blob's message too (axios error responses are also blobs here)
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          setPdfError(parsed.message || "Could not generate PDF. Make sure the backend has fpdf2 installed.");
          return;
        } catch { /* fall through to generic message */ }
      }
      setPdfError("Could not generate PDF. Make sure the backend server is running and has fpdf2 installed.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    setError("");

    try {
      const res = await axios.post(`${API_BASE}/predict`, formData);
      
      if (res.data.error) {
        setError(res.data.error);
        showToast(res.data.error, "error");
        return;
      }

      setPrediction(res.data);
      showToast(t("floodRiskAnalysisCompleted"), "success");
      
      // Fetch updated data
      fetchPredictions();
      fetchAlerts();
    } catch (err) {
      const backendMessage = err.response?.data?.message;
      const displayMessage = backendMessage || t("predictionFailedGeneric");
      setError(displayMessage);
      showToast(displayMessage, "error");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, type = "info") => {
    const id = Date.now();
    setToastAlerts(prev => [...prev, { id, message, type }]);
    
    setTimeout(() => {
      setToastAlerts(prev => prev.filter(alert => alert.id !== id));
    }, 5000);
  };

  // Straight-line distance in km between two lat/lng points
  const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const findNearestPlaces = async () => {
    setNearestPlaces("loading");

    // Prefer the city typed into the form — that's what the citizen actually
    // means by "nearest to me" here, not wherever the browser/device thinks
    // it physically is (which can be wildly wrong on a VM, VPN, or IP-based
    // geolocation fallback).
    const typedMatch = resolveCityCoords(formData.location);

    const runSearch = async (lat, lon) => {
      try {
        const [sheltersRes, hospitalsRes] = await Promise.all([
          axios.get(`${API_BASE}/shelters`),
          axios.get(`${API_BASE}/hospitals`),
        ]);
        const withDistance = (list) =>
          list
            .filter((p) => p.latitude && p.longitude)
            .map((p) => ({ ...p, distanceKm: haversineKm(lat, lon, p.latitude, p.longitude) }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 5);

        setNearestPlaces({
          shelters: withDistance(sheltersRes.data),
          hospitals: withDistance(hospitalsRes.data),
          userLat: lat,
          userLon: lon,
          source: typedMatch ? "typed" : "geolocation",
        });
      } catch (err) {
        console.error("Failed to find nearest places:", err);
        setNearestPlaces("error");
      }
    };

    if (typedMatch) {
      const [lat, lon] = typedMatch.coords;
      runSearch(lat, lon);
      return;
    }

    // No recognised city typed — fall back to the browser's actual location
    if (!navigator.geolocation) {
      setNearestPlaces("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => runSearch(pos.coords.latitude, pos.coords.longitude),
      () => setNearestPlaces("error"),
      { timeout: 10000 }
    );
  };

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

  const getRiskBadgeColor = (risk) => {
    switch (risk?.toLowerCase()) {
      case "low": return "bg-green-500/30 text-green-300 border-green-500/50";
      case "medium": return "bg-yellow-500/30 text-yellow-300 border-yellow-500/50";
      case "high": return "bg-red-500/30 text-red-300 border-red-500/50";
      default: return "bg-gray-500/30 text-gray-300 border-gray-500/50";
    }
  };

  // Get safety tips based on risk level
  const FEATURE_KEY_MAP = {
    temperature: "featTemperature", humidity: "featHumidity", wind_speed: "featWindSpeed",
    soil_moisture_top: "featSoilMoistureTop", soil_7day_avg: "featSoil7dayAvg",
    month: "featMonth", year: "featYear", is_monsoon: "featIsMonsoon", season: "featSeason",
    rain_intensity: "featRainIntensity",
  };

  const translateFeatureName = (feature) => {
    if (feature.startsWith("city_")) {
      const cityName = feature.replace("city_", "");
      return `${t("featCityPrefix")}: ${cityName}`;
    }
    return FEATURE_KEY_MAP[feature] ? t(FEATURE_KEY_MAP[feature]) : feature.replace(/_/g, " ");
  };

  const riskWordKey = (risk) => (risk === "High" ? "highSeverity" : risk === "Medium" ? "mediumSeverity" : "lowSeverity");

  const buildExplanation = (pred) => {
    if (!pred) return "";
    const riskSummaryKey = pred.risk === "High" ? "riskSummaryHigh" : pred.risk === "Medium" ? "riskSummaryMedium" : "riskSummaryLow";
    return [
      `${t("floodRiskAnalysisFor")} ${pred.location} (${t("matchedCityLabel")}: ${pred.resolved_city})`,
      "",
      `${t("inputParameters")}:`,
      `- ${t("rainfall")}: ${t(RAINFALL_OPTIONS.find((o) => o.value === formData.rainfall)?.labelKey) || formData.rainfall + " mm"}`,
      `- ${t("temperature")}: ${parseFloat(formData.temperature || 0).toFixed(1)} °C`,
      "",
      `${t("mlModelPrediction")}: ${t(riskWordKey(pred.risk))} ${t("floodRiskWord")}`,
      `${t("modelConfidenceLabel")}: ${(pred.confidence * 100).toFixed(1)}%`,
      `${t("modelUsed")}: ${pred.model_used}`,
      "",
      `${t("riskAssessmentLabel")}: ${t(riskSummaryKey)}`,
      "",
      `${t("generatedUsingModel")} ${pred.model_used} ${t("modelTrainedOnData")}`,
    ].join("\n");
  };

  const getSafetyTips = (risk) => {
    switch (risk?.toLowerCase()) {
      case "high":
        return [
          t("tipEvacuate"), t("tipFollowAuthorities"), t("tipEmergencyKit"), t("tipOfficialChannels"),
        ];
      case "medium":
        return [
          t("tipMonitorWeather"), t("tipPrepareSupplies"), t("tipKnowRoutes"), t("tipStayAlert"),
        ];
      case "low":
        return [
          t("tipNormalActivities"), t("tipBasicSupplies"), t("tipWeatherConditions"), t("tipFamilyComm"),
        ];
      default:
        return [t("tipStayInformed")];
    }
  };

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-28 pb-20">
        <div className="max-w-6xl mx-auto px-6">
          {/* Header */}
          <div className="mb-12">
            <p className="eyebrow text-teal-400 mb-3">{t("citizenPortal")}</p>
            <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">{t("checkAreaRisk")}</h1>
            <p className="text-muted max-w-lg">{t("checkAreaRiskDesc")}</p>
          </div>

          {/* Prediction Form */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="dashboard-hero p-8 sm:p-10">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 relative">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="relative space-y-6">
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    <label className="field-label">{t("location")}</label>
                    <select
                      name="location"
                      value={formData.location}
                      onChange={handleInputChange}
                      className={`field-input ${formErrors.location ? '!border-red-500/50' : ''}`}
                    >
                      <option value="">{t("selectYourCity")}</option>
                      {validLocations.map((city) => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                    {formErrors.location && (
                      <p className="mt-1 text-xs text-red-400">{formErrors.location}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">{t("cityCoverageNote")}</p>
                    {weatherStatus === "loading" && (
                      <p className="mt-1 text-xs text-teal-400">{t("fetchingWeather")}</p>
                    )}
                    {weatherStatus === "done" && (
                      <p className="mt-1 text-xs text-teal-400">✓ {t("weatherAutoFilled")}</p>
                    )}
                    {weatherStatus === "unavailable" && (
                      <p className="mt-1 text-xs text-muted">{t("weatherFetchFailed")}</p>
                    )}
                  </div>

                  <div>
                    <label className="field-label">
                      {t('rainfall')} {autoFilledFields.rainfall && <span className="text-teal-400 normal-case">· {t("autoFilledEditable")}</span>}
                    </label>
                    <select
                      name="rainfall"
                      value={formData.rainfall}
                      onChange={(e) => { setAutoFilledFields((p) => ({ ...p, rainfall: false })); setRawFetchedRainfall(null); handleInputChange(e); }}
                      className={`field-input ${formErrors.rainfall ? '!border-red-500/50' : ''}`}
                    >
                      <option value="">{t("selectRainfallLevel")}</option>
                      {RAINFALL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                      ))}
                    </select>
                    {formErrors.rainfall && (
                      <p className="mt-1 text-xs text-red-400">{formErrors.rainfall}</p>
                    )}
                    {autoFilledFields.rainfall && rawFetchedRainfall !== null && (
                      <p className="mt-1 text-xs text-muted">{t("actualDetected")}: {rawFetchedRainfall} mm</p>
                    )}
                    {!autoFilledFields.rainfall && <p className="mt-1 text-xs text-muted">{t("rainfallHint")}</p>}
                  </div>

                  <div>
                    <label className="field-label">
                      {t('temperature')} {autoFilledFields.temperature && <span className="text-teal-400 normal-case">· {t("autoFilledEditable")}</span>}
                    </label>
                    <input
                      type="number"
                      name="temperature"
                      value={formData.temperature}
                      onChange={(e) => { setAutoFilledFields((p) => ({ ...p, temperature: false })); handleInputChange(e); }}
                      className={`field-input ${formErrors.temperature ? '!border-red-500/50' : ''}`}
                      placeholder={t("enterCityToAutofill")}
                      step="0.1"
                    />
                    {formErrors.temperature && (
                      <p className="mt-1 text-xs text-red-400">{formErrors.temperature}</p>
                    )}
                  </div>
                </div>

                {liveConditions && (
                  <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
                    <p className="text-xs font-mono-data uppercase tracking-wider text-teal-400 mb-3">
                      {t("liveConditionsDetected")}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-muted uppercase">{t("humidityPct")}</p>
                        <p className="text-parchment font-mono-data">{liveConditions.humidity !== null ? `${liveConditions.humidity}%` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted uppercase">{t("windSpeedMs")}</p>
                        <p className="text-parchment font-mono-data">{liveConditions.windSpeed !== null ? `${liveConditions.windSpeed} m/s` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted uppercase">{t("surfaceSoilMoisture")}</p>
                        <p className="text-parchment font-mono-data">{liveConditions.soilTop !== null ? liveConditions.soilTop.toFixed(2) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted uppercase">{t("soil7dayAvgLabel")}</p>
                        <p className="text-parchment font-mono-data">{liveConditions.soil7day !== null ? liveConditions.soil7day.toFixed(2) : "—"}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted mt-3">{t("liveConditionsNote")}</p>
                  </div>
                )}
                {!liveConditions && (
                  <p className="text-xs text-muted">{t("modelAttributesNote")}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || Object.values(formErrors).some(error => error !== "")}
                  className="btn-primary w-full py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t("analysing") : t("checkFloodRisk")}
                </button>
              </form>
            </div>
          </div>

          {/* Prediction Result */}
          {prediction && (
            <div className="max-w-4xl mx-auto mb-12">
              <div className="dashboard-hero p-8 sm:p-10">
                <div className="relative text-center mb-8">
                  <p className="eyebrow text-muted mb-3">{t("assessmentResult")}</p>
                  <div className={`inline-block px-6 py-2.5 rounded-full text-sm font-mono-data uppercase tracking-widest ${getRiskBadgeColor(prediction.risk)}`}>
                    {prediction.risk?.toUpperCase()} risk
                  </div>
                </div>

                <div className="relative grid md:grid-cols-3 gap-4 mb-8">
                  <div className="stat-tile text-center">
                    <div className="font-display text-3xl text-teal-400 mb-1">{(prediction.confidence * 100).toFixed(1)}%</div>
                    <div className="eyebrow text-muted">{t("confidence")}</div>
                  </div>
                  <div className="stat-tile text-center">
                    <div className="font-display text-3xl text-parchment mb-1">{prediction.location}</div>
                    <div className="eyebrow text-muted">{t("location")}</div>
                    {prediction?.resolved_city && (
                      <p className="mt-1 text-xs text-muted">{t("matchedTo")} <span className="text-teal-300 font-semibold">{prediction.resolved_city}</span></p>
                    )}
                  </div>
                  <div className="stat-tile text-center">
                    <div className={`font-display text-3xl mb-1 ${getRiskColor(prediction.risk)}`}>
                      {prediction.risk}
                    </div>
                    <div className="eyebrow text-muted">{t("riskLevel")}</div>
                  </div>
                </div>

                {prediction?.model_used && (
                  <div className="relative text-center mb-6">
                    <div className="flex items-center justify-center gap-4">
                      <p className="text-xs text-muted">
                        {t("modelUsed")}: <span className="text-parchment font-semibold">{prediction.model_used}</span>
                      </p>
                      <button onClick={handleDownloadPdf} className="text-xs px-3 py-1.5 rounded-full border border-white/15 text-teal-300 hover:bg-white/5 transition-colors">
                        📄 {t("downloadPdfBtn")}
                      </button>
                    </div>
                    {pdfError && <p className="text-xs text-red-400 mt-2">{pdfError}</p>}
                  </div>
                )}

                {prediction?.model_comparison && (
                  <div className="relative dashboard-card p-6 mb-5">
                    <h3 className="font-display text-lg text-parchment mb-1">{t("modelComparisonTitle")}</h3>
                    <p className="text-xs text-muted mb-4">
                      {prediction.model_comparison.agree
                        ? t("modelsAgree")
                        : t("modelsDisagree")}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="stat-tile text-center">
                        <div className="eyebrow text-muted mb-1">{prediction.model_comparison.primary.model}</div>
                        <div className={`font-display text-2xl ${getRiskColor(prediction.model_comparison.primary.risk)}`}>{prediction.model_comparison.primary.risk}</div>
                        <div className="text-xs text-muted mt-1">{(prediction.model_comparison.primary.confidence * 100).toFixed(1)}% confidence</div>
                      </div>
                      <div className="stat-tile text-center">
                        <div className="eyebrow text-muted mb-1">{prediction.model_comparison.secondary.model}</div>
                        <div className={`font-display text-2xl ${getRiskColor(prediction.model_comparison.secondary.risk)}`}>{prediction.model_comparison.secondary.risk}</div>
                        <div className="text-xs text-muted mt-1">{prediction.model_comparison.secondary.confidence ? `${(prediction.model_comparison.secondary.confidence * 100).toFixed(1)}% confidence` : ""}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3-Day Forecast Outlook */}
                <div className="relative dashboard-card p-6 mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-lg text-parchment">{t("forecastTitle")}</h3>
                    <button onClick={handleGetForecast} disabled={forecastLoading} className="btn-secondary text-xs py-2 disabled:opacity-50">
                      {forecastLoading ? t("loadingEllipsis") : t("getForecast")}
                    </button>
                  </div>
                  {forecast === "error" && <p className="text-xs text-muted">{t("forecastError")}</p>}
                  {forecast && forecast !== "error" && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {forecast.outlook.map((day) => (
                        <div key={day.date} className="stat-tile text-center">
                          <div className="text-xs text-muted mb-1">{new Date(day.date).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
                          <div className={`font-display text-xl ${getRiskColor(day.risk)}`}>{day.risk}</div>
                          <div className="text-xs text-muted mt-1">{day.temperature}°C · {day.rainfall}mm</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!forecast && <p className="text-xs text-muted">{t("forecastHint")} {formData.location || t("yourCity")}.</p>}
                </div>

                <div className="relative dashboard-card p-6 mb-5">
                  <h3 className="font-display text-xl text-parchment mb-3">{t("riskAnalysis")}</h3>
                  <p className="text-muted leading-relaxed text-sm whitespace-pre-line">{buildExplanation(prediction)}</p>
                </div>

                {prediction?.shap_contributions && prediction.shap_contributions.length > 0 && (
                  <div className="relative dashboard-card p-6 mb-5">
                    <h3 className="font-display text-xl text-parchment mb-1">{t("whyThisPrediction")}</h3>
                    <p className="text-xs text-muted mb-4">{t("shapBreakdownNote")}</p>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={[...prediction.shap_contributions].reverse().map(c => ({
                          name: translateFeatureName(c.feature),
                          impact: c.impact,
                        }))}
                        layout="vertical"
                        margin={{ left: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#233047" />
                        <XAxis type="number" stroke="#93A0B4" />
                        <YAxis type="category" dataKey="name" stroke="#93A0B4" width={130} />
                        <Tooltip contentStyle={{ backgroundColor: '#101826', border: '1px solid #233047', borderRadius: '10px' }} labelStyle={{ color: '#F3EDE1' }} />
                        <Bar dataKey="impact">
                          {prediction.shap_contributions.slice().reverse().map((c, i) => (
                            <Cell key={i} fill={c.impact > 0 ? "#E8A33D" : "#3FBDB6"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {prediction?.model_features && (
                  <div className="relative dashboard-card p-6 mb-5">
                    <h3 className="font-display text-xl text-parchment mb-1">{t("modelInputsUsed")}</h3>
                    <p className="text-xs text-muted mb-4">
                      {t("modelInputsNote")}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Object.entries(prediction.model_features).map(([key, val]) => (
                        <div key={key} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                          <p className="text-[10px] font-mono-data uppercase tracking-wider text-muted">{FEATURE_KEY_MAP[key] ? t(FEATURE_KEY_MAP[key]) : key.replace(/_/g, " ")}</p>
                          <p className="font-mono-data text-sm text-parchment">{typeof val === "number" ? val.toFixed(2) : val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="relative dashboard-card p-6">
                  <h3 className="font-display text-xl text-parchment mb-3">{t("safetyRecommendations")}</h3>
                  <ul className="space-y-2">
                    {getSafetyTips(prediction.risk).map((tip, index) => (
                      <li key={index} className="flex items-start text-sm">
                        <span className="text-teal-400 mr-2">—</span>
                        <span className="text-muted">{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Family Emergency Contacts */}
          <div className="max-w-4xl mx-auto mb-8">
            <div className="dashboard-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="eyebrow text-marigold-400 mb-1">{t("safetyNetwork")}</p>
                  <h3 className="font-display text-lg text-parchment">{t("familyContactsTitle")}</h3>
                </div>
                <button onClick={() => setShowFamilyForm((v) => !v)} className="btn-secondary text-xs py-2">
                  {showFamilyForm ? t("cancel") : t("addContact")}
                </button>
              </div>
              <p className="text-xs text-muted mb-4">
                {t("familyContactsDesc")}
              </p>
              {showFamilyForm && (
                <form onSubmit={handleAddContact} className="grid md:grid-cols-3 gap-3 mb-4 bg-white/5 rounded-xl p-4 border border-white/10">
                  <input required placeholder={t("namePh")} value={newContact.name} onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))} className="field-input py-2 text-sm" />
                  <input required placeholder={t("phonePh")} value={newContact.phone} onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))} className="field-input py-2 text-sm" />
                  <input placeholder={t("relationPh")} value={newContact.relation} onChange={(e) => setNewContact((p) => ({ ...p, relation: e.target.value }))} className="field-input py-2 text-sm" />
                  <button type="submit" className="md:col-span-3 btn-primary py-2 text-sm">{t("saveContact")}</button>
                </form>
              )}
              {familyContacts.length === 0 ? (
                <p className="text-xs text-muted">{t("noContactsYet")}</p>
              ) : (
                <div className="space-y-2">
                  {familyContacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm bg-white/[0.03] rounded-lg px-3 py-2">
                      <div>
                        <span className="text-parchment font-medium">{c.name}</span>
                        <span className="text-xs text-muted ml-2">{c.relation} · {c.phone}</span>
                      </div>
                      <button onClick={() => handleDeleteContact(c.id)} className="text-xs text-red-400 hover:text-red-300">{t("removeContact")}</button>
                    </div>
                  ))}
                  <button
                    onClick={async () => {
                      await axios.post(`${API_BASE}/family-contacts/notify`, {
                        owner_email: userEmail,
                        message: `Flood risk update for ${formData.location || "your area"}: please check the latest prediction.`,
                      });
                      alert("Contacts notified (simulated — check backend console).");
                    }}
                    className="btn-secondary text-xs py-2 mt-2 w-full"
                  >
                    {t("notifyAllContacts")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Prediction Trend + Nearest Help */}
          <div className="max-w-4xl mx-auto mb-8 grid md:grid-cols-2 gap-6">
            {predictions.length > 1 && (
                <div className="dashboard-card p-6">
                  <p className="eyebrow text-teal-400 mb-2">{t("yourHistory")}</p>
                  <h3 className="font-display text-lg text-parchment mb-4">{t("riskTrend")}</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={[...predictions].slice(0, 10).reverse().map((p, i) => ({
                      index: i + 1,
                      riskScore: p.risk === "High" ? 2 : p.risk === "Medium" ? 1 : 0,
                      risk: p.risk,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#233047" />
                      <XAxis dataKey="index" stroke="#93A0B4" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 2]} ticks={[0, 1, 2]} tickFormatter={(v) => [t("lowChart"), t("medChart"), t("highChart")][v]} stroke="#93A0B4" tick={{ fontSize: 11 }} width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#101826', border: '1px solid #233047', borderRadius: '10px' }}
                        labelStyle={{ color: '#F3EDE1' }}
                        formatter={(_, __, item) => [item.payload.risk, "Risk"]}
                      />
                      <Line type="monotone" dataKey="riskScore" stroke="#E8A33D" strokeWidth={2} dot={{ fill: "#E8A33D", r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="dashboard-card p-6">
                <p className="eyebrow text-marigold-400 mb-2">{t("inEmergency")}</p>
                <h3 className="font-display text-lg text-parchment mb-4">{t("findNearestHelp")}</h3>
                {!nearestPlaces && (
                  <button onClick={findNearestPlaces} className="btn-secondary text-sm py-2.5 w-full">
                    {resolveCityCoords(formData.location) ? `${t('findHelpNear')} ${formData.location.trim()}` : t('useMyLocation')}
                  </button>
                )}
                {nearestPlaces === "loading" && <p className="text-sm text-muted">{t("findingNearby")}</p>}
                {nearestPlaces === "error" && (
                  <p className="text-sm text-muted">{t("couldntGetLocation")}</p>
                )}
                {nearestPlaces && typeof nearestPlaces === "object" && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted">
                      {nearestPlaces.source === "typed"
                        ? `${t('basedOnTypedCity')} (${formData.location.trim()})`
                        : t('basedOnDeviceLocation')}
                    </p>

                    <div>
                      <p className="eyebrow text-teal-400 mb-2">{t("shelters")}</p>
                      {nearestPlaces.shelters.length === 0 && <p className="text-xs text-muted">{t("noRegisteredShelters")}</p>}
                      <div className="space-y-2">
                        {nearestPlaces.shelters.map((s) => (
                          <div key={s.id} className="flex items-center justify-between text-sm border-b border-white/10 pb-2">
                            <div>
                              <p className="text-parchment font-medium">{lang === "ur" && s.name_ur ? s.name_ur : s.name}</p>
                              <p className="text-xs text-muted">{s.distanceKm.toFixed(1)} {t("kmAway")}{s.capacity ? ` · ${t("capacityLabel")} ${s.capacity}` : ""}</p>
                            </div>
                            <Link to={`/map?lat=${s.latitude}&lng=${s.longitude}&name=${encodeURIComponent(s.name)}`} className="text-xs text-teal-400 hover:text-teal-300 shrink-0 ml-2">{t("viewOnMap")}</Link>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="eyebrow text-marigold-400 mb-2">{t("hospitals")}</p>
                      {nearestPlaces.hospitals.length === 0 && <p className="text-xs text-muted">{t("noRegisteredHospitals")}</p>}
                      <div className="space-y-2">
                        {nearestPlaces.hospitals.map((h) => (
                          <div key={h.id} className="flex items-center justify-between text-sm border-b border-white/10 pb-2 last:border-0">
                            <div>
                              <p className="text-parchment font-medium">{lang === "ur" && h.name_ur ? h.name_ur : h.name}</p>
                              <p className="text-xs text-muted">{h.distanceKm.toFixed(1)} {t("kmAway")}{h.services ? ` · ${h.services}` : ""}</p>
                            </div>
                            <Link to={`/map?lat=${h.latitude}&lng=${h.longitude}&name=${encodeURIComponent(h.name)}`} className="text-xs text-teal-400 hover:text-teal-300 shrink-0 ml-2">{t("viewOnMap")}</Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

          {/* Recent Alerts */}
          {alerts.length > 0 && (
            <div className="max-w-4xl mx-auto">
              <div className="dashboard-card p-8">
                <p className="eyebrow text-marigold-400 mb-2">{t("nearby")}</p>
                <h3 className="font-display text-2xl text-parchment mb-6">{t("recentAlerts")}</h3>
                <div className="space-y-3">
                  {alerts.slice(0, 5).map((alert, index) => (
                    <div key={index} className={`p-4 rounded-xl border ${getRiskBgColor(alert.risk)}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className={`font-semibold text-sm ${getRiskColor(alert.risk)}`}>{alert.message}</h4>
                          <p className="text-sm text-muted mt-1">{alert.location}</p>
                        </div>
                        <span className="text-xs text-muted font-mono-data">{new Date(alert.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast Alerts */}
      <div className="fixed top-24 right-6 z-50 space-y-2">
        {toastAlerts.map((alert) => (
          <div
            key={alert.id}
            className={`p-4 rounded-xl shadow-lg border backdrop-blur-xl ${
              alert.type === "error" ? "bg-red-500/20 border-red-500/50 text-red-300" :
              alert.type === "success" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" :
              "bg-teal-500/20 border-teal-500/50 text-teal-300"
            }`}
          >
            {alert.message}
          </div>
        ))}
      </div>
      <Footer />
    </div>
  );
}
