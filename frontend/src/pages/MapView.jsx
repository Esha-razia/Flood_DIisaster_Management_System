import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import FloodMap from "../components/FloodMap";
import { useLanguage } from "../context/LanguageContext";

const EDIT_ROLES = ["admin", "government_official", "rescue_worker"];

export default function MapView() {
  const { t } = useLanguage();
  const userRole = localStorage.getItem("userRole");
  const canEdit = EDIT_ROLES.includes(userRole);
  const [searchParams] = useSearchParams();

  const focusLat = searchParams.get("lat");
  const focusLng = searchParams.get("lng");
  const focusName = searchParams.get("name");
  const focusTarget = focusLat && focusLng ? {
    lat: parseFloat(focusLat), lng: parseFloat(focusLng), name: focusName || "",
  } : null;

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-28 pb-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-8">
            <p className="eyebrow text-teal-400 mb-3">{t("mapTag")}</p>
            <h1 className="font-display text-4xl sm:text-5xl text-parchment mb-3">
              {focusTarget ? focusTarget.name || "Location" : t("mapTitle")}
            </h1>
            <p className="text-muted max-w-xl">
              {focusTarget
                ? "Zoomed to the location you selected."
                : <>{t("mapDesc")} {canEdit ? t("mapDescOfficial") : t("mapDescCitizen")}</>
              }
            </p>
          </div>
          <FloodMap height={560} canEdit={canEdit} focusTarget={focusTarget} />
        </div>
      </div>
      <Footer />
    </div>
  );
}
