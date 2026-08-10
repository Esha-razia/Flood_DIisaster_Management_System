import { useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

export default function CheckIn() {
  const { t } = useLanguage();
  const { shelterId } = useParams();
  const [name, setName] = useState("");
  const [status, setStatus] = useState(null); // null | 'loading' | 'done' | 'error'

  const handleCheckIn = async (e) => {
    e.preventDefault();
    setStatus("loading");
    try {
      await axios.post(`${API_BASE}/shelters/${shelterId}/checkin`, { name: name || "Anonymous" });
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-32 pb-20">
        <div className="max-w-md mx-auto px-6">
          <div className="dashboard-card p-8 text-center">
            <p className="eyebrow text-teal-400 mb-3">{t("shelterCheckin")}</p>
            <h1 className="font-display text-3xl text-parchment mb-4">{t("youveArrived")}</h1>

            {status === "done" ? (
              <div className="text-emerald-300 text-sm py-6">
                ✓ {t("checkedInSuccess")}
              </div>
            ) : (
              <form onSubmit={handleCheckIn} className="space-y-4">
                <p className="text-sm text-muted">{t("tellUsName")}</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("yourNamePh")}
                  className="field-input text-center"
                />
                <button type="submit" disabled={status === "loading"} className="btn-primary w-full disabled:opacity-50">
                  {status === "loading" ? t("checkingIn") : t("checkInBtn")}
                </button>
                {status === "error" && <p className="text-xs text-red-400">{t("checkInError")}</p>}
              </form>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
