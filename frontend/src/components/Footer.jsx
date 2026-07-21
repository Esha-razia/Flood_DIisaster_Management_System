import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

const EMERGENCY_CONTACTS = [
  { labelKey: "rescue1122", number: "1122" },
  { labelKey: "pdmaHelpline", number: "1129" },
];

export default function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-white/10 mt-20">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center border border-marigold-500/40 bg-gradient-to-br from-teal-600/30 to-marigold-600/20">
                <span className="font-display text-marigold-400 text-sm leading-none">F</span>
              </div>
              <span className="font-display text-lg text-parchment">
                {t("brandName")}
              </span>
            </div>
            <p className="text-sm text-muted leading-relaxed max-w-sm">
              {t("footerTaglineFull")}
            </p>
          </div>

          <div>
            <h4 className="eyebrow text-muted mb-4">{t("navigate")}</h4>
            <div className="flex flex-col gap-2.5">
              <Link to="/" className="text-sm text-muted hover:text-parchment transition-colors">{t("home")}</Link>
              <Link to="/community" className="text-sm text-muted hover:text-parchment transition-colors">{t("communityReportsLink")}</Link>
              <Link to="/map" className="text-sm text-muted hover:text-parchment transition-colors">{t("liveMapLink")}</Link>
              <Link to="/login" className="text-sm text-muted hover:text-parchment transition-colors">{t("signIn")}</Link>
              <Link to="/register" className="text-sm text-muted hover:text-parchment transition-colors">{t("createAccount")}</Link>
            </div>
          </div>

          <div>
            <h4 className="eyebrow text-muted mb-4">{t("emergencyContacts")}</h4>
            <div className="flex flex-col gap-2.5">
              {EMERGENCY_CONTACTS.map((c) => (
                <div key={c.labelKey} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted">{t(c.labelKey)}</span>
                  <span className="font-mono-data text-marigold-300 font-semibold">{c.number}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              <span className="text-xs font-mono-data uppercase tracking-widest text-teal-300">{t("systemLive")}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {t("footerDisclaimer")}
          </p>
          <p className="text-xs text-muted">
            &copy; {new Date().getFullYear()} {t("brandName")}
          </p>
        </div>
      </div>
    </footer>
  );
}
