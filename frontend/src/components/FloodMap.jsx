import { useEffect, useRef, useState, useMemo } from "react";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";


// Pakistan's actual geographic extent (tight fit, not neighboring countries)
const DEFAULT_CENTER = [30.3753, 69.3451];
const PAKISTAN_BOUNDS = [
  [23.5, 60.8], // south-west
  [37.2, 77.9], // north-east
];

const TYPE_META = {
  shelter: { label: "Shelters", color: "#3FBDB6" },        // teal
  hospital: { label: "Hospitals", color: "#E8A33D" },       // marigold
  rescue_operation: { label: "Rescue operations", color: "#8b5cf6" },  // violet
  community_report: { label: "Community reports", color: "#F3EDE1" }, // parchment (was near-invisible black-on-black before)
  blocked_road: { label: "Blocked roads", color: "#ef4444" },         // red
};

const STATUS_VALUE_MAP = {
  "Assigned": "statusAssigned", "In Progress": "statusInProgress", "Completed": "statusCompleted",
  "Blocked": "statusBlocked", "Cleared": "statusCleared",
};
const RISK_VALUE_MAP = { "Low": "lowSeverity", "Medium": "mediumSeverity", "High": "highSeverity" };

const TYPE_LABEL_KEYS = {
  shelter: "filterShelters",
  hospital: "filterHospitals",
  rescue_operation: "filterRescueOps",
  community_report: "filterCommunityReports",
  blocked_road: "filterBlockedRoads",
};

const COLOR_HEX = {
  teal: "#3FBDB6",
  marigold: "#E8A33D",
  violet: "#8b5cf6",
  sky: "#38bdf8",
  black: "#F3EDE1",
  red: "#ef4444",
};

// A plain, classic map-pin shape (solid color, small center dot, pointed
// base) — no emoji inside it. The earlier rotated-square-with-emoji design
// read as a generic "AI-generated" cliché rather than a real map marker.
function makeDivIcon(hexColor) {
  return L.divIcon({
    className: "fdm-marker-pin",
    html: `<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));">
      <path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0z" fill="${hexColor}" stroke="#0B1220" stroke-width="1.5"/>
      <circle cx="11" cy="11" r="4" fill="#0B1220"/>
    </svg>`,
    iconSize: [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -28],
  });
}

function makeUserDivIcon() {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;width:14px;height:14px;border-radius:50%;
      background:#38bdf8;border:3px solid #0B1220;
      box-shadow:0 0 0 4px #38bdf855, 0 0 10px 2px #38bdf8aa;"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * FR-04: Interactive Map.
 * canEdit=true (admin / government_official / rescue_worker) allows adding
 * a blocked-road marker by clicking the map, and clearing existing ones.
 *
 * Beyond the raw map, this also gives it a proper "operations view" feel:
 * a live status bar (how many of each thing exist right now), a searchable
 * directory list beside the map (so you're not hunting for a dot among
 * many), distance-from-you when location is available, and popups styled
 * to match the app instead of Leaflet's plain white default.
 */
export default function FloodMap({ height = 480, canEdit = false, typeFilter = null, focusTarget = null }) {
  const { t, lang } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [markers, setMarkers] = useState([]);
  const [riskZones, setRiskZones] = useState([]);
  const [activeTypes, setActiveTypes] = useState(() => {
    if (typeFilter) return [typeFilter];
    try {
      const saved = localStorage.getItem("fdm_active_types");
      if (saved) return JSON.parse(saved);
    } catch {}
    return Object.keys(TYPE_META);
  });
  const [search, setSearch] = useState("");
  const [addingRoad, setAddingRoad] = useState(false);
  const [loading, setLoading] = useState(true);
  const [routing, setRouting] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null); // { destination, distanceKm, durationMin } | 'error'
  const [allPredictions, setAllPredictions] = useState([]);
  const [userLocation, setUserLocation] = useState(null); // { lat, lng } | null
  const [selectedId, setSelectedId] = useState(null);
  const [mapZoom, setMapZoom] = useState(5);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [kbIndex, setKbIndex] = useState(-1); // keyboard-focused row in the directory list
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now()); // re-renders the "updated Xs ago" label every second
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("fdm_favorites") || "[]")); } catch { return new Set(); }
  });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]); // up to 2 [lat,lng] points
  const [tripStops, setTripStops] = useState([]); // marker ids selected for multi-stop routing
  const [reportMode, setReportMode] = useState(false);
  const [reportDraft, setReportDraft] = useState(null); // { lat, lng, location, description, severity, contact }
  const [weatherPoints, setWeatherPoints] = useState([]);
  const [showWeather, setShowWeather] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showHelplines, setShowHelplines] = useState(false);
  const heatmapLayerRef = useRef(null);
  const measureLayerRef = useRef(null);
  const weatherLayerRef = useRef(null);
  const containerRef = useRef(null);
  const sidebarItemRefs = useRef({});

  const [isOffline, setIsOffline] = useState(false);

  const fetchMarkers = () => {
    axios
      .get(`${API_BASE}/map-markers`)
      .then((res) => {
        setMarkers(res.data.markers || []);
        setRiskZones(res.data.risk_zones || []);
        setLastUpdated(Date.now());
        setIsOffline(false);
        try {
          localStorage.setItem("fdm_last_markers", JSON.stringify({ markers: res.data.markers || [], risk_zones: res.data.risk_zones || [], savedAt: Date.now() }));
        } catch {}
      })
      .catch((err) => {
        console.error("Failed to load map markers:", err);
        // Flood conditions are exactly when the connection is most likely to
        // drop — showing a blank map at that moment is the worst possible
        // outcome. Falling back to the last successfully loaded data (even
        // if it's a bit stale) is far more useful than nothing at all.
        try {
          const cached = JSON.parse(localStorage.getItem("fdm_last_markers") || "null");
          if (cached) {
            setMarkers(cached.markers || []);
            setRiskZones(cached.risk_zones || []);
            setLastUpdated(cached.savedAt || null);
            setIsOffline(true);
          }
        } catch {}
      })
      .finally(() => setLoading(false));

    axios
      .get(`${API_BASE}/predictions`)
      .then((res) => setAllPredictions(res.data || []))
      .catch((err) => console.error("Failed to load prediction history:", err));
  };

  useEffect(() => {
    fetchMarkers();
    const interval = setInterval(fetchMarkers, 20000); // FR04-05: reflect changes promptly
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const secondsAgo = lastUpdated ? Math.max(0, Math.round((nowTick - lastUpdated) / 1000)) : null;

  // Best-effort, silent location request (no error shown if denied) so the
  // directory list can sort by distance and the map can show a "you are
  // here" dot — purely additive, nothing else depends on this succeeding.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000 }
    );
  }, []);

  // Initialise the map once
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 5,
      maxBounds: PAKISTAN_BOUNDS,
      maxBoundsViscosity: 1.0,
      scrollWheelZoom: true,
    });
    // A dark, muted basemap (CARTO's free "Dark Matter" tiles) instead of
    // the default bright/cartoonish OSM tiles — those clashed hard with
    // everything else in this dark, serif-typeface interface. No API key
    // needed, same OSM data underneath, just restyled.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 18,
      subdomains: "abcd",
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    map.on("zoomend", () => setMapZoom(map.getZoom()));
    routeLayerRef.current = L.layerGroup().addTo(map);
    measureLayerRef.current = L.layerGroup().addTo(map);
    weatherLayerRef.current = L.layerGroup().addTo(map);
    heatmapLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (focusTarget) {
      map.setView([focusTarget.lat, focusTarget.lng], 15);
      L.marker([focusTarget.lat, focusTarget.lng], { icon: makeDivIcon("#E8A33D") })
        .addTo(map)
        .bindPopup(`<strong>${focusTarget.name || "Selected location"}</strong>`)
        .openPopup();
    } else {
      map.setMinZoom(map.getBoundsZoom(PAKISTAN_BOUNDS, false));
      map.fitBounds(PAKISTAN_BOUNDS, { padding: [8, 8] });
    }

    // Leaflet miscalculates its viewport if the container isn't fully
    // sized/laid-out yet at init time (common with flex/animated layouts),
    // which is what shifted the visible area to Central Asia. Forcing a
    // size recalculation + fitBounds(Pakistan) fixes it.
    //
    // No masking overlay here — instead, minZoom is set dynamically to
    // exactly the zoom level at which Pakistan's bounding box fills the
    // container (map.getBoundsZoom). That makes it geometrically
    // impossible to zoom out any further and reveal neighboring countries,
    // rather than covering them with a dark box. A ResizeObserver keeps
    // this correct if the container's size changes later (e.g. sidebar
    // toggling, window resize).
    const fixView = () => {
      map.invalidateSize();
      if (focusTarget) {
        map.setView([focusTarget.lat, focusTarget.lng], 15);
        return;
      }
      const fitZoom = map.getBoundsZoom(PAKISTAN_BOUNDS, false);
      map.setMinZoom(fitZoom);
      map.fitBounds(PAKISTAN_BOUNDS, { padding: [8, 8] });
    };
    const t1 = setTimeout(fixView, 100);
    const t2 = setTimeout(fixView, 500);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (!focusTarget) map.setMinZoom(map.getBoundsZoom(PAKISTAN_BOUNDS, false));
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Click-to-add a blocked road (officials only)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = async (e) => {
      if (!addingRoad) return;
      const name = window.prompt("Road / area name for this blocked-road marker:");
      if (!name) return;
      const reason = window.prompt("Reason (optional):") || "";
      try {
        await axios.post(`${API_BASE}/blocked-roads`, {
          name,
          location: name,
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
          reason,
        });
        fetchMarkers();
      } catch (err) {
        console.error("Failed to add blocked road:", err);
      }
      setAddingRoad(false);
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [addingRoad]);

  // Click two points to measure the straight-line distance between them —
  // useful for quick rescue-planning estimates without needing a full route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e) => {
      if (!measuring) return;
      setMeasurePoints((prev) => (prev.length >= 2 ? [[e.latlng.lat, e.latlng.lng]] : [...prev, [e.latlng.lat, e.latlng.lng]]));
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [measuring]);

  useEffect(() => {
    const layer = measureLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    measurePoints.forEach((p) => {
      L.circleMarker(p, { radius: 5, color: "#E8A33D", fillColor: "#E8A33D", fillOpacity: 1 }).addTo(layer);
    });
    if (measurePoints.length === 2) {
      L.polyline(measurePoints, { color: "#E8A33D", weight: 3, dashArray: "6 6" }).addTo(layer);
    }
  }, [measurePoints]);

  const measureDistanceKm = measurePoints.length === 2
    ? haversineKm(measurePoints[0][0], measurePoints[0][1], measurePoints[1][0], measurePoints[1][1])
    : null;

  // Click anywhere to start a quick incident report at that exact spot —
  // the location field is pre-filled with whichever known shelter/hospital
  // is nearest, since community reports are keyed by city/area name rather
  // than raw coordinates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e) => {
      if (!reportMode) return;
      const known = markers.filter((m) => m.type === "shelter" || m.type === "hospital");
      let nearestName = "";
      if (known.length > 0) {
        const nearest = known
          .map((m) => ({ ...m, d: haversineKm(e.latlng.lat, e.latlng.lng, m.latitude, m.longitude) }))
          .sort((a, b) => a.d - b.d)[0];
        nearestName = nearest.location || nearest.name || "";
      }
      setReportDraft({ lat: e.latlng.lat, lng: e.latlng.lng, location: nearestName, description: "", severity: "", contact: "" });
      setReportMode(false);
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [reportMode, markers]);

  const submitQuickReport = async () => {
    if (!reportDraft || !reportDraft.location.trim() || !reportDraft.description.trim() || !reportDraft.contact.trim() || !reportDraft.severity) return;
    try {
      await axios.post(`${API_BASE}/community-reports`, {
        location: reportDraft.location.trim(),
        description: reportDraft.description.trim(),
        severity: reportDraft.severity,
        contact: reportDraft.contact.trim(),
        type: "Flooding",
      });
      setReportDraft(null);
      fetchMarkers();
    } catch (err) {
      console.error("Failed to submit report:", err);
    }
  };

  // Weather overlay (Open-Meteo — free, no API key) showing current rain
  // intensity for major cities, since "where is it raining right now" is
  // directly relevant to a flood-response map.
  const MAJOR_CITIES = useMemo(() => [
    { name: "Karachi", lat: 24.8607, lng: 67.0011 }, { name: "Lahore", lat: 31.5497, lng: 74.3436 },
    { name: "Islamabad", lat: 33.6844, lng: 73.0479 }, { name: "Rawalpindi", lat: 33.6007, lng: 73.0679 },
    { name: "Faisalabad", lat: 31.4187, lng: 73.0791 }, { name: "Multan", lat: 30.1575, lng: 71.5249 },
    { name: "Peshawar", lat: 34.0151, lng: 71.5249 }, { name: "Quetta", lat: 30.1798, lng: 66.9750 },
    { name: "Hyderabad", lat: 25.3960, lng: 68.3578 }, { name: "Sialkot", lat: 32.4945, lng: 74.5229 },
    { name: "Gujranwala", lat: 32.1877, lng: 74.1945 }, { name: "Sargodha", lat: 32.0836, lng: 72.6711 },
    { name: "Bahawalpur", lat: 29.4000, lng: 71.6833 }, { name: "Sukkur", lat: 27.7052, lng: 68.8574 },
    // Extra coverage — including places currently under active monsoon
    // watch (Murree, Muzaffarabad, Gilgit) so the overlay is more likely to
    // actually catch rain wherever it's falling right now, not just in the
    // original 14 biggest cities.
    { name: "Murree", lat: 33.9070, lng: 73.3943 }, { name: "Muzaffarabad", lat: 34.3700, lng: 73.4711 },
    { name: "Gilgit", lat: 35.9208, lng: 74.3144 }, { name: "Skardu", lat: 35.2971, lng: 75.6333 },
    { name: "Abbottabad", lat: 34.1463, lng: 73.2117 }, { name: "Mardan", lat: 34.1986, lng: 72.0404 },
    { name: "D.I. Khan", lat: 31.8313, lng: 70.9016 }, { name: "Mirpur (AJK)", lat: 33.1478, lng: 73.7508 },
    { name: "Sheikhupura", lat: 31.7130, lng: 73.9852 }, { name: "Gujrat", lat: 32.5731, lng: 74.0789 },
    { name: "Jhelum", lat: 32.9425, lng: 73.7257 }, { name: "Sahiwal", lat: 30.6682, lng: 73.1114 },
    { name: "Larkana", lat: 27.5590, lng: 68.2123 }, { name: "Nawabshah", lat: 26.2442, lng: 68.4100 },
    { name: "Mirpur Khas", lat: 25.5266, lng: 69.0113 }, { name: "Khanpur", lat: 28.6453, lng: 70.6567 },
    { name: "Zhob", lat: 31.3411, lng: 69.4481 }, { name: "Turbat", lat: 26.0031, lng: 63.0481 },
  ], []);

  useEffect(() => {
    if (!showWeather) return;
    const lats = MAJOR_CITIES.map((c) => c.lat).join(",");
    const lngs = MAJOR_CITIES.map((c) => c.lng).join(",");
    axios
      .get(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=precipitation`)
      .then((res) => {
        const results = Array.isArray(res.data) ? res.data : [res.data];
        setWeatherPoints(MAJOR_CITIES.map((c, i) => ({ ...c, precipitation: results[i]?.current?.precipitation ?? 0 })));
      })
      .catch((err) => console.error("Failed to load weather data:", err));
  }, [showWeather, MAJOR_CITIES]);

  useEffect(() => {
    const layer = weatherLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showWeather) return;
    weatherPoints.forEach((c) => {
      const mm = c.precipitation || 0;
      const color = mm >= 5 ? "#ef4444" : mm >= 1 ? "#E8A33D" : "#3FBDB6";
      const radius = 14000 + Math.min(mm, 20) * 3000;
      L.circle([c.lat, c.lng], { radius, color, fillColor: color, fillOpacity: 0.18, weight: 1, opacity: 0.5 })
        .bindPopup(`<strong>${c.name}</strong><div style="opacity:.75;margin-top:2px">${t("currentRainLabel")}: ${mm.toFixed(1)} mm/h</div>`, { className: "fdm-popup" })
        .addTo(layer);
    });
  }, [weatherPoints, showWeather]);

  // Community-report density "heatmap" — where are reports clustering
  // geographically, at a glance, instead of counting individual dots.
  useEffect(() => {
    const layer = heatmapLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showHeatmap) return;

    const reports = markers.filter((m) => m.type === "community_report");
    const cellDeg = 0.5; // roughly a city-sized area
    const cells = {};
    reports.forEach((r) => {
      const key = `${Math.round(r.latitude / cellDeg)}_${Math.round(r.longitude / cellDeg)}`;
      if (!cells[key]) cells[key] = { lat: 0, lng: 0, count: 0 };
      cells[key].lat += r.latitude;
      cells[key].lng += r.longitude;
      cells[key].count += 1;
    });
    Object.values(cells).forEach((cell) => {
      const avgLat = cell.lat / cell.count;
      const avgLng = cell.lng / cell.count;
      const color = cell.count >= 5 ? "#ef4444" : cell.count >= 2 ? "#E8A33D" : "#F3EDE1";
      const radius = 8000 + Math.min(cell.count, 10) * 4000;
      L.circle([avgLat, avgLng], { radius, color, fillColor: color, fillOpacity: 0.25, weight: 1, opacity: 0.5 })
        .bindPopup(`<strong>${cell.count}</strong> ${t("reportsInAreaLabel")}`, { className: "fdm-popup" })
        .addTo(layer);
    });
  }, [markers, showHeatmap]);

  // The same filtered+searched list feeds both the map markers AND the
  // sidebar directory, so they never disagree with each other. Sorted by
  // distance from the user when their location is known, closest first —
  // otherwise alphabetically, so the list isn't just insertion order.
  const visibleMarkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = markers
      .filter((m) => activeTypes.includes(m.type))
      .filter((m) => !favoritesOnly || favorites.has(m.id))
      .filter((m) => !q || (m.name || "").toLowerCase().includes(q) || (m.location || "").toLowerCase().includes(q));

    if (userLocation) {
      return list
        .map((m) => ({ ...m, _distanceKm: haversineKm(userLocation.lat, userLocation.lng, m.latitude, m.longitude) }))
        .sort((a, b) => a._distanceKm - b._distanceKm);
    }
    return list.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [markers, activeTypes, search, userLocation, favoritesOnly, favorites]);

  // Re-render markers whenever data or filters change
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    // Risk-level overlays (FR04-08) — soft colored circles per city
    riskZones.forEach((z) => {
      const color = z.risk === "High" ? "#ef4444" : z.risk === "Medium" ? "#E8A33D" : "#3FBDB6";
      const circle = L.circle([z.latitude, z.longitude], {
        radius: 18000,
        color,
        fillColor: color,
        fillOpacity: 0.12,
        weight: 1,
        opacity: 0.4,
      }).addTo(layer);

      const history = allPredictions
        .filter((p) => (p.location || "").toLowerCase().includes(z.location.toLowerCase()))
        .slice(0, 5);
      const historyHtml = history.length
        ? history.map((p) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;">
             <span style="opacity:.7">${new Date(p.created_at).toLocaleDateString()}</span>
             <span style="font-weight:600;color:${p.risk === 'High' ? '#ef4444' : p.risk === 'Medium' ? '#E8A33D' : '#3FBDB6'}">${p.risk}</span>
           </div>`).join("")
        : `<span style="opacity:.6">${t("noRecordedHistory")}</span>`;
      circle.bindPopup(
        `<div style="min-width:160px">
           <strong>${z.location}</strong><div style="opacity:.7;margin-bottom:6px">Current: ${z.risk} risk</div>
           <div style="border-top:1px solid rgba(255,255,255,.12);padding-top:6px">${historyHtml}</div>
         </div>`,
        { className: "fdm-popup" }
      );
    });

    // "You are here" marker
    if (userLocation) {
      L.marker([userLocation.lat, userLocation.lng], { icon: makeUserDivIcon(), zIndexOffset: 1000 })
        .bindPopup(`<strong>${t("yourLocationLabel")}</strong>`, { className: "fdm-popup" })
        .addTo(layer);
    }

    // Zoomed out (viewing most/all of Pakistan), many markers land close
    // enough together to visually stack into an unreadable pile of dots —
    // grouping them into one numbered cluster (like Google/Uber-style maps
    // do) keeps the view legible; zooming in naturally splits them back out
    // into individual pins once there's room to tell them apart.
    const cellSizeDeg = mapZoom <= 5 ? 2.5 : mapZoom <= 6 ? 1.2 : mapZoom <= 7 ? 0.6 : mapZoom <= 8 ? 0.25 : 0;

    if (cellSizeDeg > 0) {
      const cells = {};
      visibleMarkers.forEach((m) => {
        const key = `${Math.round(m.latitude / cellSizeDeg)}_${Math.round(m.longitude / cellSizeDeg)}`;
        (cells[key] = cells[key] || []).push(m);
      });

      Object.values(cells).forEach((members) => {
        if (members.length === 1) {
          drawSingleMarker(members[0], layer);
        } else {
          const avgLat = members.reduce((s, m) => s + m.latitude, 0) / members.length;
          const avgLng = members.reduce((s, m) => s + m.longitude, 0) / members.length;
          const dominant = members[0].category_color;
          const hex = COLOR_HEX[dominant] || "#93A0B4";
          const clusterIcon = L.divIcon({
            className: "",
            html: `<span style="
              display:flex;align-items:center;justify-content:center;
              width:34px;height:34px;border-radius:50%;
              background:${hex};border:3px solid #0B1220;color:#0B1220;
              font-weight:700;font-size:13px;font-family:'Public Sans',sans-serif;
              box-shadow:0 2px 8px rgba(0,0,0,.5);">${members.length}</span>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          const clusterMarker = L.marker([avgLat, avgLng], { icon: clusterIcon });
          clusterMarker.on("click", () => {
            const bounds = members.map((mm) => [mm.latitude, mm.longitude]);
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11, animate: true });
          });
          clusterMarker.addTo(layer);
        }
      });
    } else {
      visibleMarkers.forEach((m) => drawSingleMarker(m, layer));
    }

    // Searching zooms the map to the matching result(s) instead of leaving
    // the view unchanged — one match zooms in and opens its popup, several
    // matches fit them all in view.
    const q = search.trim().toLowerCase();
    if (q && visibleMarkers.length > 0) {
      if (visibleMarkers.length === 1) {
        const m = visibleMarkers[0];
        map.setView([m.latitude, m.longitude], 14, { animate: true });
        setTimeout(() => {
          layer.eachLayer((l) => {
            if (l.getLatLng && l.getLatLng().lat === m.latitude && l.getLatLng().lng === m.longitude) {
              l.openPopup();
            }
          });
        }, 300);
      } else {
        const bounds = visibleMarkers.map((m) => [m.latitude, m.longitude]);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12, animate: true });
      }
    }
  }, [markers, riskZones, activeTypes, search, canEdit, allPredictions, userLocation, visibleMarkers, mapZoom]);

  // Renders one normal (non-clustered) pin with its popup — pulled out so
  // both the clustered and unclustered code paths above share it exactly.
  function drawSingleMarker(m, layer) {
        const map = mapRef.current;
        const hex = COLOR_HEX[m.category_color] || "#93A0B4";
        const marker = L.marker([m.latitude, m.longitude], { icon: makeDivIcon(hex) });
        const isShelterOrHospital = m.type === "shelter" || m.type === "hospital";
        const verifiedBadge = isShelterOrHospital
          ? (m.verified
              ? `<span style="display:inline-block;margin-top:2px;font-size:11px;color:#3FBDB6;">✓ ${t("verifiedLabel")}</span>`
              : `<span style="display:inline-block;margin-top:2px;font-size:11px;color:#93A0B4;">${t("unverifiedLabel")}</span>`)
          : "";
        const details = [
          `<strong>${(lang === "ur" && m.name_ur) ? m.name_ur : (m.name || "")}</strong>`,
          verifiedBadge,
          m.location ? `<div>${m.location}</div>` : "",
          (m.type === "shelter") ? `<div style="opacity:.7">${t("capacityPrefix")}: ${
            m.capacity
              ? `${m.capacity}${m.occupancy != null ? ` (${t("occupancyPrefix")}: ${m.occupancy}/${m.capacity})` : ""}`
              : (m.occupancy != null ? `${t("notRecordedLabel")} (${t("occupancyPrefix")}: ${m.occupancy})` : t("notRecordedLabel"))
          }</div>` : "",
          m.status ? `<div style="opacity:.7">${t("statusPrefix")}: ${STATUS_VALUE_MAP[m.status] ? t(STATUS_VALUE_MAP[m.status]) : m.status}</div>` : "",
          m.risk_level ? `<div style="opacity:.7">${t("riskPrefix")}: ${RISK_VALUE_MAP[m.risk_level] ? t(RISK_VALUE_MAP[m.risk_level]) : m.risk_level}</div>` : "",
          m.severity ? `<div style="opacity:.7">${t("severityPrefix")}: ${RISK_VALUE_MAP[m.severity] ? t(RISK_VALUE_MAP[m.severity]) : m.severity}</div>` : "",
          m.reason ? `<div style="opacity:.7">${m.reason}</div>` : "",
          (userLocation && m._distanceKm != null) ? `<div style="opacity:.6;margin-top:4px">${m._distanceKm.toFixed(1)} km ${t("awayLabel")}</div>` : "",
        ]
          .filter(Boolean)
          .join("");
        const actionButtons = [
          m.contact ? `<a href="tel:${m.contact}" class="fdm-popup-btn" style="text-decoration:none;display:inline-block;">${t("callNowBtn")}</a>` : "",
          `<button class="fdm-popup-btn fdm-share-btn" data-lat="${m.latitude}" data-lng="${m.longitude}" data-name="${(m.name || "").replace(/"/g, "&quot;")}">${t("shareLocationBtn")}</button>`,
          (canEdit && isShelterOrHospital) ? `<button class="fdm-popup-btn fdm-verify-btn" style="background:${m.verified ? '#93A0B4' : '#3FBDB6'};">${m.verified ? t("unverifyBtn") : t("verifyBtn")}</button>` : "",
        ].filter(Boolean).join(" ");
        const occupancyControl = (canEdit && m.type === "shelter")
          ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center;">
               <input type="number" min="0" ${m.capacity ? `max="${m.capacity}"` : ""} value="${m.occupancy || 0}" class="fdm-occupancy-input"
                 style="width:60px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 6px;color:#F3EDE1;font-size:12px;" />
               <button class="fdm-popup-btn fdm-occupancy-btn">${t("updateOccupancyBtn")}</button>
             </div>`
          : "";
        marker.bindPopup(`<div style="min-width:150px">${details}<div style="margin-top:6px">${actionButtons}</div>${occupancyControl}</div>`, { className: "fdm-popup" });
        marker.on("popupopen", (e) => {
          setSelectedId(m.id);
          const el = e.popup.getElement();
          const shareBtn = el?.querySelector(".fdm-share-btn");
          if (shareBtn) {
            shareBtn.onclick = () => {
              const mapsUrl = `https://www.google.com/maps?q=${m.latitude},${m.longitude}`;
              const text = `${m.name}: ${mapsUrl}`;
              if (navigator.share) {
                navigator.share({ title: m.name, text, url: mapsUrl }).catch(() => {});
              } else {
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
              }
            };
          }
          const verifyBtn = el?.querySelector(".fdm-verify-btn");
          if (verifyBtn) {
            verifyBtn.onclick = async () => {
              const rawId = m.id.replace(/^(shelter|hospital)-/, "");
              const endpoint = m.type === "shelter" ? "shelters" : "hospitals";
              try {
                await axios.put(`${API_BASE}/${endpoint}/${rawId}/verify`, { verified: !m.verified });
                fetchMarkers();
                map.closePopup();
              } catch (err) {
                console.error("Failed to update verification:", err);
              }
            };
          }
          const occBtn = el?.querySelector(".fdm-occupancy-btn");
          if (occBtn) {
            occBtn.onclick = async () => {
              const input = el.querySelector(".fdm-occupancy-input");
              const rawId = m.id.replace(/^shelter-/, "");
              try {
                await axios.put(`${API_BASE}/shelters/${rawId}/occupancy`, { occupancy: parseInt(input.value, 10) || 0 });
                fetchMarkers();
              } catch (err) {
                console.error("Failed to update occupancy:", err);
              }
            };
          }
        });

        if (canEdit && m.type === "blocked_road") {
          marker.on("popupopen", () => {
            const btn = document.createElement("button");
            btn.textContent = t("markAsCleared");
            btn.className = "fdm-popup-btn";
            btn.onclick = async () => {
              const roadId = m.id.replace("road-", "");
              await axios.put(`${API_BASE}/blocked-roads/${roadId}`, { status: "Cleared" });
              fetchMarkers();
            };
            marker.getPopup().getElement().querySelector("div").appendChild(btn);
          });
        }

        marker.addTo(layer);
  }

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        mapRef.current?.setView([loc.lat, loc.lng], 14, { animate: true });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 }
    );
  };

  const toggleFullscreen = () => {
    setIsFullscreen((v) => !v);
    // The container resizes on the next tick (CSS class change), so give
    // Leaflet a moment before telling it to recompute its viewport —
    // calling invalidateSize() too early measures the old (pre-toggle) size.
    setTimeout(() => mapRef.current?.invalidateSize(), 50);
  };

  // Whichever marker becomes selected — whether the person clicked it on
  // the map or in the sidebar list — the sidebar scrolls to keep it
  // visible, so the two views never fall out of sync with each other.
  useEffect(() => {
    if (selectedId == null) return;
    const el = sidebarItemRefs.current[selectedId];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  // Reset keyboard focus whenever the list itself changes shape (new
  // search, filter toggle) so it doesn't point at a row that's no longer there.
  useEffect(() => { setKbIndex(-1); }, [visibleMarkers.length, search, activeTypes.join(",")]);

  useEffect(() => {
    if (kbIndex < 0) return;
    const m = visibleMarkers[kbIndex];
    if (!m) return;
    const el = sidebarItemRefs.current[m.id];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [kbIndex]);

  const handleSidebarKeyDown = (e) => {
    if (visibleMarkers.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setKbIndex((i) => Math.min(i + 1, visibleMarkers.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setKbIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && kbIndex >= 0) {
      e.preventDefault();
      flyToMarker(visibleMarkers[kbIndex]);
    }
  };

  useEffect(() => {
    const handler = () => setTimeout(() => mapRef.current?.invalidateSize(), 100);
    window.addEventListener("beforeprint", handler);
    return () => window.removeEventListener("beforeprint", handler);
  }, []);

  const flyToMarker = (m) => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;
    map.setView([m.latitude, m.longitude], 15, { animate: true });
    setSelectedId(m.id);
    setTimeout(() => {
      layer.eachLayer((l) => {
        if (l.getLatLng && l.getLatLng().lat === m.latitude && l.getLatLng().lng === m.longitude) {
          l.openPopup();
        }
      });
    }, 350);
  };

  // Draws a route from the person's current location to any destination —
  // used both by "Route to nearest shelter" and the per-item "Route" button
  // in the directory, so routing isn't locked to shelters only.
  const routeToDestination = (destination) => {
    if (!navigator.geolocation) {
      setRouteInfo("error");
      return;
    }
    setRouting(true);
    setRouteInfo(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          // OSRM's free public demo routing server — no API key needed
          const res = await axios.get(
            `https://router.project-osrm.org/route/v1/driving/${longitude},${latitude};${destination.longitude},${destination.latitude}`,
            { params: { overview: "full", geometries: "geojson" } }
          );
          const route = res.data?.routes?.[0];
          const map = mapRef.current;
          routeLayerRef.current.clearLayers();

          if (route) {
            const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            L.polyline(latlngs, { color: "#E8A33D", weight: 4, opacity: 0.85 }).addTo(routeLayerRef.current);
            map.fitBounds(latlngs, { padding: [40, 40] });
            setRouteInfo({
              destination: destination.name,
              distanceKm: route.distance / 1000,
              durationMin: route.duration / 60,
            });
          } else {
            // Fall back to a straight line if the routing service has no road route
            const fallbackKm = haversineKm(latitude, longitude, destination.latitude, destination.longitude);
            L.polyline([[latitude, longitude], [destination.latitude, destination.longitude]], {
              color: "#E8A33D", weight: 3, opacity: 0.7, dashArray: "6 8",
            }).addTo(routeLayerRef.current);
            map.fitBounds([[latitude, longitude], [destination.latitude, destination.longitude]], { padding: [40, 40] });
            setRouteInfo({ destination: destination.name, distanceKm: fallbackKm, durationMin: null });
          }
        } catch (err) {
          console.error("Routing failed:", err);
          setRouteInfo("error");
        } finally {
          setRouting(false);
        }
      },
      () => { setRouteInfo("error"); setRouting(false); },
      { timeout: 10000 }
    );
  };

  const findRouteToNearestShelter = () => {
    const shelters = markers.filter((m) => m.type === "shelter");
    if (shelters.length === 0) {
      setRouteInfo("error");
      return;
    }
    if (userLocation) {
      const nearest = shelters
        .map((s) => ({ ...s, distanceKm: haversineKm(userLocation.lat, userLocation.lng, s.latitude, s.longitude) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];
      routeToDestination(nearest);
      return;
    }
    if (!navigator.geolocation) {
      setRouteInfo("error");
      return;
    }
    setRouting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = shelters
          .map((s) => ({ ...s, distanceKm: haversineKm(latitude, longitude, s.latitude, s.longitude) }))
          .sort((a, b) => a.distanceKm - b.distanceKm)[0];
        setRouting(false);
        routeToDestination(nearest);
      },
      () => { setRouteInfo("error"); setRouting(false); },
      { timeout: 10000 }
    );
  };

  // Plans one continuous route visiting every selected stop in the order
  // they were added — for a rescue worker who needs to hit several shelters/
  // hospitals in one trip instead of routing to them one at a time.
  const planTrip = () => {
    const stops = tripStops.map((id) => markers.find((m) => m.id === id)).filter(Boolean);
    if (stops.length === 0) return;
    if (!navigator.geolocation) { setRouteInfo("error"); return; }
    setRouting(true);
    setRouteInfo(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const coordString = [`${longitude},${latitude}`, ...stops.map((s) => `${s.longitude},${s.latitude}`)].join(";");
        try {
          const res = await axios.get(`https://router.project-osrm.org/route/v1/driving/${coordString}`, {
            params: { overview: "full", geometries: "geojson" },
          });
          const route = res.data?.routes?.[0];
          const map = mapRef.current;
          routeLayerRef.current.clearLayers();
          if (route) {
            const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            L.polyline(latlngs, { color: "#E8A33D", weight: 4, opacity: 0.85 }).addTo(routeLayerRef.current);
            map.fitBounds(latlngs, { padding: [40, 40] });
            setRouteInfo({
              destination: stops.map((s) => s.name).join(" → "),
              distanceKm: route.distance / 1000,
              durationMin: route.duration / 60,
            });
          } else {
            setRouteInfo("error");
          }
        } catch (err) {
          console.error("Trip routing failed:", err);
          setRouteInfo("error");
        } finally {
          setRouting(false);
        }
      },
      () => { setRouteInfo("error"); setRouting(false); },
      { timeout: 10000 }
    );
  };

  const toggleType = (type) => {
    setActiveTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type];
      try { localStorage.setItem("fdm_active_types", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const toggleFavorite = (id) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("fdm_favorites", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const toggleTripStop = (id) => {
    setTripStops((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const exportDirectoryCsv = () => {
    const rows = [["Name", "Type", "Location", "Latitude", "Longitude", "Capacity/Services", "Contact"]];
    visibleMarkers.forEach((m) => {
      rows.push([
        m.name || "", TYPE_META[m.type]?.label || m.type, m.location || "",
        m.latitude, m.longitude, m.capacity || m.services || "", m.contact || "",
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map_directory_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const typeCounts = useMemo(() => {
    const counts = {};
    Object.keys(TYPE_META).forEach((k) => { counts[k] = 0; });
    markers.forEach((m) => { if (counts[m.type] !== undefined) counts[m.type] += 1; });
    return counts;
  }, [markers]);

  return (
    <div ref={containerRef} className={isFullscreen ? "fixed inset-0 z-50 bg-ink overflow-y-auto" : "dashboard-card overflow-hidden"}>
      {/* Dark-themed Leaflet popups + a couple of small UI polish rules —
          Leaflet's default popup is plain white, which looked jarring
          dropped into an otherwise all-dark interface. */}
      <style>{`
        .fdm-popup .leaflet-popup-content-wrapper {
          background: #141D2E; color: #F3EDE1; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.08);
        }
        .fdm-popup .leaflet-popup-content { font-family: 'Public Sans', sans-serif; font-size: 13px; margin: 10px 12px; }
        .fdm-popup .leaflet-popup-tip { background: #141D2E; box-shadow: none; border: 1px solid rgba(255,255,255,.08); }
        .fdm-popup a.leaflet-popup-close-button { color: #93A0B4; }
        .fdm-popup a.leaflet-popup-close-button:hover { color: #F3EDE1; }
        .fdm-popup-btn {
          margin-top: 8px; font-size: 11px; padding: 5px 10px; border-radius: 6px;
          background: #3FBDB6; color: #0B1220; border: none; cursor: pointer; font-weight: 600;
        }
        .fdm-sidebar-item.is-selected { background: rgba(63,189,182,0.12); border-color: rgba(63,189,182,0.4); }
        .fdm-sidebar-item.is-kb-focused { outline: 2px solid rgba(63,189,182,0.6); outline-offset: -2px; }
        .leaflet-control-scale-line { background: rgba(20,29,46,0.85) !important; color: #F3EDE1 !important; border-color: rgba(255,255,255,.3) !important; }
        @media print {
          .fdm-no-print { display: none !important; }
          .fdm-print-only-map { height: 90vh !important; }
        }
        @keyframes fdmDrop { from { opacity: 0; transform: translateY(-10px) scale(0.7); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .fdm-marker-pin { animation: fdmDrop 0.28s ease-out; }
        .fdm-locate-btn:disabled { opacity: 0.5; cursor: default; }
      `}</style>

      {!isFullscreen && (
        <>
          {/* Live status bar — quick counts so the numbers behind the dots are
              visible without having to count markers by eye. */}
          <div className="fdm-no-print grid grid-cols-3 sm:grid-cols-5 border-b border-white/10 bg-white/[0.02]">
            {Object.entries(TYPE_META).map(([type, meta]) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`flex flex-col items-center justify-center gap-0.5 py-3 border-r border-white/5 last:border-r-0 transition-colors ${
                  activeTypes.includes(type) ? "opacity-100" : "opacity-40 hover:opacity-70"
                }`}
                title={t(TYPE_LABEL_KEYS[type])}
              >
                <span className="text-lg font-display" style={{ color: meta.color === "#F3EDE1" ? "#F3EDE1" : meta.color }}>
                  {typeCounts[type]}
                </span>
                <span className="text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
                  {t(TYPE_LABEL_KEYS[type])}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="fdm-no-print p-4 border-b border-white/10 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={t("searchPlaceholder")}
            className="field-input w-full py-2 text-sm"
          />
          {showSuggestions && search.trim() && visibleMarkers.length > 0 && (
            <div className="absolute z-[1000] top-full left-0 right-0 mt-1 bg-ink-soft border border-white/15 rounded-xl shadow-xl overflow-hidden">
              {visibleMarkers.slice(0, 5).map((m) => (
                <button
                  key={m.id}
                  onMouseDown={() => { flyToMarker(m); setShowSuggestions(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-parchment hover:bg-white/10 transition-colors flex items-center gap-2 border-b border-white/5 last:border-b-0"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_META[m.type]?.color }} />
                  <span className="truncate">{m.name}</span>
                  {m.location && <span className="text-xs text-muted shrink-0 ml-auto">{m.location}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setAddingRoad((v) => !v)}
            className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${
              addingRoad ? "bg-red-500 text-white" : "btn-secondary"
            }`}
          >
            {addingRoad ? t("clickMapToPlace") : t("markBlockedRoad")}
          </button>
        )}
        <button
          onClick={() => { setReportMode((v) => !v); setMeasuring(false); }}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${reportMode ? "bg-marigold-500 text-ink" : "btn-secondary"}`}
        >
          {reportMode ? t("clickMapToReport") : t("reportHereBtn")}
        </button>
        <button
          onClick={() => { setMeasuring((v) => !v); setMeasurePoints([]); setReportMode(false); }}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${measuring ? "bg-teal-500 text-ink" : "btn-secondary"}`}
        >
          {measuring ? t("clickTwoPoints") : t("measureBtn")}
        </button>
        <button
          onClick={() => setShowWeather((v) => !v)}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${showWeather ? "bg-sky-500 text-ink" : "btn-secondary"}`}
        >
          {t("weatherBtn")}
        </button>
        <button
          onClick={() => setShowHeatmap((v) => !v)}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${showHeatmap ? "bg-red-500 text-white" : "btn-secondary"}`}
        >
          {t("heatmapBtn")}
        </button>
        <button
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${favoritesOnly ? "bg-marigold-500 text-ink" : "btn-secondary"}`}
        >
          ★ {t("favoritesOnlyBtn")}
        </button>
        <button
          onClick={() => setShowHelplines((v) => !v)}
          className={`text-xs px-3 py-2 rounded-full font-semibold transition-colors ${showHelplines ? "bg-red-600 text-white" : "btn-secondary"}`}
        >
          {t("helplinesBtn")}
        </button>
        <button onClick={findRouteToNearestShelter} disabled={routing} className="text-xs px-3 py-2 rounded-full font-semibold btn-secondary disabled:opacity-50">
          {routing ? t("findingRoute") : t("routeToNearest")}
        </button>
        {tripStops.length > 0 && (
          <button onClick={planTrip} disabled={routing} className="text-xs px-3 py-2 rounded-full font-semibold bg-teal-600 text-white disabled:opacity-50">
            {t("planTripBtn")} ({tripStops.length})
          </button>
        )}
        <button onClick={handleLocateMe} disabled={locating} className="fdm-locate-btn text-xs px-3 py-2 rounded-full font-semibold btn-secondary">
          {locating ? "…" : t("locateMeBtn")}
        </button>
        <button onClick={toggleFullscreen} className="text-xs px-3 py-2 rounded-full font-semibold btn-secondary">
          {isFullscreen ? t("exitFullscreenBtn") : t("fullscreenBtn")}
        </button>
        <button onClick={() => window.print()} className="text-xs px-3 py-2 rounded-full font-semibold btn-secondary">
          {t("printMapBtn")}
        </button>
        {isOffline && (
          <span className="text-[11px] px-2 py-1 rounded-full bg-red-500/15 border border-red-500/40 text-red-300 font-semibold whitespace-nowrap">
            {t("offlineBadge")}
          </span>
        )}
        {secondsAgo !== null && (
          <span className="text-[11px] text-muted ml-auto whitespace-nowrap">{t("updatedLabel")} {secondsAgo}s {t("agoLabel")}</span>
        )}
      </div>
      {showHelplines && (
        <div className="fdm-no-print px-4 py-3 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-200 font-semibold mb-2">{t("helplinesTitle")}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: t("helplineRescue"), number: "1122" },
              { label: t("helplinePolice"), number: "15" },
              { label: t("helplineEdhi"), number: "115" },
              { label: t("helplineFireBrigade"), number: "16" },
            ].map((h) => (
              <a key={h.number} href={`tel:${h.number}`}
                className="flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-xs text-parchment transition-colors">
                <span>{h.label}</span>
                <span className="font-display text-red-300">{h.number}</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {measureDistanceKm !== null && (
        <div className="fdm-no-print px-4 py-2.5 bg-teal-500/10 border-b border-teal-500/20 text-xs text-teal-200 flex items-center justify-between">
          <span>{t("straightLineDistanceLabel")}: {measureDistanceKm.toFixed(2)} km</span>
          <button onClick={() => setMeasurePoints([])} className="text-teal-300 hover:text-teal-100">✕</button>
        </div>
      )}
      {reportDraft && (
        <div className="fdm-no-print px-4 py-3 bg-marigold-500/10 border-b border-marigold-500/20 space-y-2">
          <p className="text-xs text-marigold-200 font-semibold">{t("quickReportTitle")}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={reportDraft.location} onChange={(e) => setReportDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder={t("locationLabel")} className="field-input py-2 text-sm" />
            <select value={reportDraft.severity} onChange={(e) => setReportDraft((d) => ({ ...d, severity: e.target.value }))}
              className="field-input py-2 text-sm">
              <option value="">{t("selectSeverityPh")}</option>
              <option value="Low">{t("lowSeverity")}</option>
              <option value="Medium">{t("mediumSeverity")}</option>
              <option value="High">{t("highSeverity")}</option>
            </select>
          </div>
          <textarea value={reportDraft.description} onChange={(e) => setReportDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder={t("descriptionLabel")} rows={2} className="field-input py-2 text-sm w-full" />
          <input value={reportDraft.contact} onChange={(e) => setReportDraft((d) => ({ ...d, contact: e.target.value }))}
            placeholder={t("contactLabel")} className="field-input py-2 text-sm w-full" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setReportDraft(null)} className="text-xs px-3 py-2 rounded-full btn-secondary">{t("cancel")}</button>
            <button onClick={submitQuickReport} className="text-xs px-3 py-2 rounded-full bg-marigold-500 text-ink font-semibold">{t("submitReportBtn")}</button>
          </div>
        </div>
      )}
      {routeInfo && routeInfo !== "error" && (
        <div className="px-4 py-2.5 bg-marigold-500/10 border-b border-marigold-500/20 text-xs text-marigold-200 flex items-center justify-between">
          <span>To <strong>{routeInfo.destination}</strong> — {routeInfo.distanceKm.toFixed(1)} km{routeInfo.durationMin ? `, ~${Math.round(routeInfo.durationMin)} min by road` : " (straight-line estimate)"}</span>
          <button onClick={() => { setRouteInfo(null); routeLayerRef.current?.clearLayers(); }} className="text-marigold-300 hover:text-marigold-100">✕</button>
        </div>
      )}
      {routeInfo === "error" && (
        <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300">
          Couldn't find a route — check location permission and that at least one shelter is registered.
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        <div className="relative flex-1 lg:flex-[1.7]">
          <div ref={mapContainerRef} className="fdm-print-only-map" style={{ height: isFullscreen ? "calc(100vh - 64px)" : height, width: "100%", background: "#101826" }} />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <span className="w-8 h-8 rounded-full border-2 border-teal-400 border-t-transparent animate-spin"></span>
                <p className="text-xs text-muted">{t("loadingMapData")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Directory — the same filtered/searched markers as a scrollable
            list, so finding "which shelter is nearest" doesn't mean
            squinting at overlapping dots. Click an entry to fly to it. */}
        <div className="fdm-no-print lg:w-[320px] border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col" style={{ maxHeight: isFullscreen ? "calc(100vh - 64px)" : height }}>
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between shrink-0 gap-2">
            <span className="text-xs uppercase tracking-wide text-muted font-semibold">{t("directoryLabel")}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{visibleMarkers.length}</span>
              <button onClick={exportDirectoryCsv} className="text-[10px] px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-muted hover:text-teal-300 transition-colors">
                {t("exportListBtn")}
              </button>
            </div>
          </div>
          <div
            className="overflow-y-auto flex-1 outline-none"
            tabIndex={0}
            onKeyDown={handleSidebarKeyDown}
            aria-label={t("directoryLabel")}
          >
            {visibleMarkers.length === 0 ? (
              <p className="text-xs text-muted p-4 text-center">{t("noDirectoryResults")}</p>
            ) : (
              visibleMarkers.map((m, idx) => (
                <div
                  key={m.id}
                  ref={(el) => { sidebarItemRefs.current[m.id] = el; }}
                  onClick={() => flyToMarker(m)}
                  className={`fdm-sidebar-item cursor-pointer px-4 py-3 border-b border-white/5 hover:bg-white/[0.04] transition-colors border-l-2 border-l-transparent ${selectedId === m.id ? "is-selected" : ""} ${kbIndex === idx ? "is-kb-focused" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full" style={{ background: TYPE_META[m.type]?.color === "#F3EDE1" ? "#F3EDE1" : TYPE_META[m.type]?.color }} />
                      <div className="min-w-0">
                        <p className="text-sm text-parchment font-medium truncate flex items-center gap-1.5">
                          {(lang === "ur" && m.name_ur) ? m.name_ur : (m.name || "")}
                          {(m.type === "shelter" || m.type === "hospital") && (
                            m.verified
                              ? <span className="text-[10px] text-teal-300 shrink-0">✓</span>
                              : <span className="text-[10px] text-muted/60 shrink-0" title={t("unverifiedLabel")}>○</span>
                          )}
                        </p>
                        {m.location && <p className="text-xs text-muted truncate">{m.location}</p>}
                        {(m.status || m.risk_level || m.severity) && (
                          <p className="text-[11px] text-muted/80 mt-0.5">
                            {m.status && (STATUS_VALUE_MAP[m.status] ? t(STATUS_VALUE_MAP[m.status]) : m.status)}
                            {m.risk_level && ` · ${RISK_VALUE_MAP[m.risk_level] ? t(RISK_VALUE_MAP[m.risk_level]) : m.risk_level}`}
                            {m.severity && ` · ${RISK_VALUE_MAP[m.severity] ? t(RISK_VALUE_MAP[m.severity]) : m.severity}`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {m._distanceKm != null && (
                        <span className="text-[11px] text-teal-300 whitespace-nowrap">{m._distanceKm.toFixed(1)} km</span>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(m.id); }}
                          title={t("favoriteToggleLabel")}
                          className={`text-sm leading-none transition-colors ${favorites.has(m.id) ? "text-marigold-400" : "text-muted/50 hover:text-marigold-300"}`}
                        >
                          ★
                        </button>
                        {(m.type === "shelter" || m.type === "hospital") && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleTripStop(m.id); }}
                            title={t("addToTripLabel")}
                            className={`text-[10px] px-2 py-1 rounded-full border transition-colors whitespace-nowrap ${
                              tripStops.includes(m.id)
                                ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                : "bg-white/5 hover:bg-white/10 border-white/10 text-muted"
                            }`}
                          >
                            {tripStops.includes(m.id) ? `✓ ${t("tripLabel")}` : `+ ${t("tripLabel")}`}
                          </button>
                        )}
                      </div>
                      {(m.type === "shelter" || m.type === "hospital") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); routeToDestination(m); }}
                          className="text-[10px] px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-muted hover:text-marigold-300 transition-colors whitespace-nowrap"
                        >
                          {t("routeBtn")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
