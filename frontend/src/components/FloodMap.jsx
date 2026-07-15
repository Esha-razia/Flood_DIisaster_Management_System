import { useEffect, useRef, useState } from "react";
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
// Slightly wider "soft" bounds so panning near the border doesn't feel stuck
const PAN_BOUNDS = [
  [21.5, 58.5],
  [38.5, 80.0],
];

const TYPE_META = {
  shelter: { label: "Shelters", color: "#3FBDB6" },        // teal
  hospital: { label: "Hospitals", color: "#E8A33D" },       // marigold
  rescue_operation: { label: "Rescue operations", color: "#8b5cf6" },  // violet
  community_report: { label: "Community reports", color: "#1a1a1a" }, // black
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
  black: "#1a1a1a",
  red: "#ef4444",
};

function makeDivIcon(hexColor) {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;width:16px;height:16px;border-radius:50%;
      background:${hexColor};border:2px solid #0B1220;
      box-shadow:0 0 0 2px ${hexColor}55;"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}

/**
 * FR-04: Interactive Map.
 * canEdit=true (admin / government_official / rescue_worker) allows adding
 * a blocked-road marker by clicking the map, and clearing existing ones.
 */
export default function FloodMap({ height = 480, canEdit = false, typeFilter = null, focusTarget = null }) {
  const { t, lang } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const [markers, setMarkers] = useState([]);
  const [riskZones, setRiskZones] = useState([]);
  const [activeTypes, setActiveTypes] = useState(
    typeFilter ? [typeFilter] : Object.keys(TYPE_META)
  );
  const [search, setSearch] = useState("");
  const [addingRoad, setAddingRoad] = useState(false);
  const [loading, setLoading] = useState(true);
  const [routing, setRouting] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null); // { destination, distanceKm, durationMin } | 'error'
  const [allPredictions, setAllPredictions] = useState([]);

  const fetchMarkers = () => {
    axios
      .get(`${API_BASE}/map-markers`)
      .then((res) => {
        setMarkers(res.data.markers || []);
        setRiskZones(res.data.risk_zones || []);
      })
      .catch((err) => console.error("Failed to load map markers:", err))
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

  // Initialise the map once
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 5,
      minZoom: 5,
      maxBounds: PAN_BOUNDS,
      maxBoundsViscosity: 0.9,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (focusTarget) {
      map.setView([focusTarget.lat, focusTarget.lng], 15);
      L.marker([focusTarget.lat, focusTarget.lng], { icon: makeDivIcon("#E8A33D") })
        .addTo(map)
        .bindPopup(`<strong>${focusTarget.name || "Selected location"}</strong>`)
        .openPopup();
    } else {
      map.fitBounds(PAKISTAN_BOUNDS, { padding: [8, 8] });
    }

    // Leaflet miscalculates its viewport if the container isn't fully
    // sized/laid-out yet at init time (common with flex/animated layouts),
    // which is what shifted the visible area to Central Asia. Forcing a
    // size recalculation + fitBounds(Pakistan) fixes it — fitBounds picks
    // the exact zoom that shows Pakistan only, regardless of the
    // container's aspect ratio (a fixed zoom level doesn't do that
    // reliably). A ResizeObserver keeps it correct on later resizes.
    const fixView = () => {
      map.invalidateSize();
      if (focusTarget) {
        map.setView([focusTarget.lat, focusTarget.lng], 15);
      } else {
        map.fitBounds(PAKISTAN_BOUNDS, { padding: [8, 8] });
      }
    };
    const t1 = setTimeout(fixView, 100);
    const t2 = setTimeout(fixView, 500);

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
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

  // Re-render markers whenever data or filters change
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const q = search.trim().toLowerCase();

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
        `<div style="font-family:Public Sans,sans-serif;font-size:13px;min-width:160px">
           <strong>${z.location}</strong><div style="opacity:.7;margin-bottom:6px">Current: ${z.risk} risk</div>
           <div style="border-top:1px solid #ddd;padding-top:6px">${historyHtml}</div>
         </div>`
      );
    });

    const visibleMarkers = markers
      .filter((m) => activeTypes.includes(m.type))
      .filter((m) => !q || (m.name || "").toLowerCase().includes(q) || (m.location || "").toLowerCase().includes(q));

    visibleMarkers.forEach((m) => {
        const hex = COLOR_HEX[m.category_color] || "#93A0B4";
        const marker = L.marker([m.latitude, m.longitude], { icon: makeDivIcon(hex) });
        const details = [
          `<strong>${(lang === "ur" && m.name_ur) ? m.name_ur : (m.name || "")}</strong>`,
          m.location ? `<div>${m.location}</div>` : "",
          m.status ? `<div style="opacity:.7">${t("statusPrefix")}: ${STATUS_VALUE_MAP[m.status] ? t(STATUS_VALUE_MAP[m.status]) : m.status}</div>` : "",
          m.risk_level ? `<div style="opacity:.7">${t("riskPrefix")}: ${RISK_VALUE_MAP[m.risk_level] ? t(RISK_VALUE_MAP[m.risk_level]) : m.risk_level}</div>` : "",
          m.severity ? `<div style="opacity:.7">${t("severityPrefix")}: ${RISK_VALUE_MAP[m.severity] ? t(RISK_VALUE_MAP[m.severity]) : m.severity}</div>` : "",
          m.reason ? `<div style="opacity:.7">${m.reason}</div>` : "",
        ]
          .filter(Boolean)
          .join("");
        marker.bindPopup(`<div style="font-family:Public Sans,sans-serif;font-size:13px;min-width:140px">${details}</div>`);

        if (canEdit && m.type === "blocked_road") {
          marker.on("popupopen", () => {
            const btn = document.createElement("button");
            btn.textContent = t("markAsCleared");
            btn.style.cssText = "margin-top:6px;font-size:11px;padding:4px 8px;border-radius:6px;background:#3FBDB6;color:#0B1220;border:none;cursor:pointer;font-weight:600";
            btn.onclick = async () => {
              const roadId = m.id.replace("road-", "");
              await axios.put(`${API_BASE}/blocked-roads/${roadId}`, { status: "Cleared" });
              fetchMarkers();
            };
            marker.getPopup().getElement().querySelector("div").appendChild(btn);
          });
        }

        marker.addTo(layer);
    });

    // Searching zooms the map to the matching result(s) instead of leaving
    // the view unchanged — one match zooms in and opens its popup, several
    // matches fit them all in view.
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
  }, [markers, riskZones, activeTypes, search, canEdit, allPredictions]);

  const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const findRouteToNearestShelter = () => {
    if (!navigator.geolocation) {
      setRouteInfo("error");
      return;
    }
    setRouting(true);
    setRouteInfo(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const shelters = markers.filter((m) => m.type === "shelter");
        if (shelters.length === 0) {
          setRouteInfo("error");
          setRouting(false);
          return;
        }
        const nearest = shelters
          .map((s) => ({ ...s, distanceKm: haversineKm(latitude, longitude, s.latitude, s.longitude) }))
          .sort((a, b) => a.distanceKm - b.distanceKm)[0];

        try {
          // OSRM's free public demo routing server — no API key needed
          const res = await axios.get(
            `https://router.project-osrm.org/route/v1/driving/${longitude},${latitude};${nearest.longitude},${nearest.latitude}`,
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
              destination: nearest.name,
              distanceKm: route.distance / 1000,
              durationMin: route.duration / 60,
            });
          } else {
            // Fall back to a straight line if the routing service has no road route
            L.polyline([[latitude, longitude], [nearest.latitude, nearest.longitude]], {
              color: "#E8A33D", weight: 3, opacity: 0.7, dashArray: "6 8",
            }).addTo(routeLayerRef.current);
            map.fitBounds([[latitude, longitude], [nearest.latitude, nearest.longitude]], { padding: [40, 40] });
            setRouteInfo({ destination: nearest.name, distanceKm: nearest.distanceKm, durationMin: null });
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

  const toggleType = (type) => {
    setActiveTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="p-4 border-b border-white/10 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="field-input flex-1 min-w-[200px] py-2 text-sm"
        />
        {!typeFilter && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(TYPE_META).map(([type, meta]) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  activeTypes.includes(type) ? "border-white/25 text-parchment bg-white/10" : "border-white/10 text-muted"
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />
                {t(TYPE_LABEL_KEYS[type])}
              </button>
            ))}
          </div>
        )}
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
        <button onClick={findRouteToNearestShelter} disabled={routing} className="text-xs px-3 py-2 rounded-full font-semibold btn-secondary disabled:opacity-50">
          {routing ? t("findingRoute") : t("routeToNearest")}
        </button>
      </div>
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
      <div ref={mapContainerRef} style={{ height, width: "100%", background: "#101826" }} />
      {loading && <p className="text-xs text-muted p-3">{t("loadingMapData")}</p>}
    </div>
  );
}
