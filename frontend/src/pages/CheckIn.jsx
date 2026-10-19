import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

export default function CheckIn() {
  const { t, lang } = useLanguage();
  const { shelterId } = useParams();
  const [name, setName] = useState(localStorage.getItem("userName") || "");
  const [shelterInfo, setShelterInfo] = useState(null);
  const [status, setStatus] = useState(null); // null | 'loading' | 'done' | 'error'

  useEffect(() => {
    if (!shelterId) return;
    axios
      .get(`${API_BASE}/shelters`)
      .then((res) => {
        const list = res.data || [];
        const found = list.find((s) => String(s.id) === String(shelterId));
        if (found) setShelterInfo(found);
      })
      .catch((err) => console.error("Failed to load shelter info:", err));
  }, [shelterId]);

  const handleCheckIn = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 3) {
      setStatus("error-name");
      return;
    }
    setStatus("loading");
    try {
      await axios.post(`${API_BASE}/shelters/${shelterId}/checkin`, { name: trimmedName });
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans flex flex-col justify-between">
      <Navbar />
      <div className="pt-32 pb-20">
        <div className="max-w-lg mx-auto px-6">
          <div className="dashboard-card p-8 text-center border border-teal-500/20 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-3xl mx-auto mb-4">
              🏠
            </div>
            
            <p className="eyebrow text-teal-400 mb-2">{t("shelterCheckin") || "Emergency Shelter Check-In"}</p>
            <h1 className="font-display text-3xl text-parchment mb-2">
              {shelterInfo ? (lang === "ur" && shelterInfo.name_ur ? shelterInfo.name_ur : shelterInfo.name) : (t("youveArrived") || "You've Arrived!")}
            </h1>
            
            {shelterInfo && (
              <div className="bg-white/5 rounded-xl p-4 mb-6 text-left border border-white/10 text-xs space-y-1.5">
                <p className="text-muted">📍 <strong>{t("location")}:</strong> {shelterInfo.address || shelterInfo.city || "Emergency Shelter Site"}</p>
                <p className="text-muted">👥 <strong>{lang === "ur" ? "موجودہ تعداد:" : "Current Occupancy:"}</strong> <span className="text-teal-300 font-bold">{shelterInfo.current_occupancy || shelterInfo.occupancy || 0} / {shelterInfo.capacity || 100} {lang === 'ur' ? 'افراد' : 'people'}</span></p>
                {shelterInfo.contact && <p className="text-muted">📞 <strong>{lang === "ur" ? "رابطہ:" : "Contact:"}</strong> {shelterInfo.contact}</p>}
              </div>
            )}

            {status === "done" ? (
              <div className="py-6 space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6">
                  <div className="text-4xl mb-2">🎉</div>
                  <h3 className="text-lg font-bold text-emerald-300 mb-1">{lang === "ur" ? "چیک ان مکمل ہو گیا!" : "Check-In Completed!"}</h3>
                  <p className="text-xs text-muted">{lang === "ur" ? "آپ اس امدادی کیمپ میں رجسٹرڈ ہو چکے ہیں۔ مرکزی کمانڈ کو مطلع کر دیا گیا ہے۔" : "You have been registered at this emergency shelter. Central command has been notified."}</p>
                </div>
                <Link to="/citizen-dashboard" className="btn-primary inline-block w-full text-sm">
                  {lang === "ur" ? "شہری ڈیش بورڈ پر واپس جائیں ←" : "Return to Citizen Dashboard ➔"}
                </Link>
              </div>
            ) : (
              <form onSubmit={handleCheckIn} className="space-y-4 text-left" noValidate>
                <div>
                  <label className="block text-xs font-medium text-muted mb-2">
                    {t("tellUsName") || "Enter Your Full Name"} 
                  </label>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (status === "error-name") setStatus(null);
                    }}
                    placeholder={t("yourNamePh") || "e.g. Ali Ahmed"}
                    className={`field-input text-left transition-colors ${
                      status === "error-name" ? "border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500" : ""
                    }`}
                    required
                  />
                  {status === "error-name" && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {lang === "ur" ? "براہ کرم یہ فیلڈ پُر کریں (پورا نام، کم از کم 3 حروف)" : "Please fill out this field (enter full name, at least 3 characters)"}
                    </p>
                  )}
                </div>
                <button type="submit" disabled={status === "loading"} className="btn-primary w-full py-3 disabled:opacity-50 font-semibold">
                  {status === "loading" ? (lang === "ur" ? "آمد کا اندراج ہو رہا ہے..." : "Registering Arrival...") : (t("checkInBtn") || "Confirm Check-In 📍")}
                </button>
                {status === "error" && (
                  <p className="text-xs text-red-400 text-center bg-red-500/10 p-2 rounded border border-red-500/20">
                    {lang === "ur" ? "چیک ان کرنے میں ناکامی۔ براہ کرم دوبارہ کوشش کریں۔" : "Failed to check in. Please try again."}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
