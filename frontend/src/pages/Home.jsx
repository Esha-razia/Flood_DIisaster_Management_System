import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useLanguage } from "../context/LanguageContext";
import { API_BASE } from "../config";

const SLIDE_KEYS = [
  { tagKey: "slide1Tag", titleKey: "slide1Title", descKey: "slide1Desc", accent: "teal" },
  { tagKey: "slide2Tag", titleKey: "slide2Title", descKey: "slide2Desc", accent: "marigold" },
  { tagKey: "slide3Tag", titleKey: "slide3Title", descKey: "slide3Desc", accent: "red" },
  { tagKey: "slide4Tag", titleKey: "slide4Title", descKey: "slide4Desc", accent: "teal" },
];

const RISK_LEVEL_KEYS = [
  { levelKey: "lowRisk", descKey: "lowRiskDesc", accent: "teal" },
  { levelKey: "mediumRisk", descKey: "mediumRiskDesc", accent: "marigold" },
  { levelKey: "highRisk", descKey: "highRiskDesc", accent: "red" },
];

const CAPABILITY_KEYS = [
  { num: "01", titleKey: "cap1Title", descKey: "cap1Desc" },
  { num: "02", titleKey: "cap2Title", descKey: "cap2Desc" },
  { num: "03", titleKey: "cap3Title", descKey: "cap3Desc" },
  { num: "04", titleKey: "cap4Title", descKey: "cap4Desc" },
  { num: "05", titleKey: "cap5Title", descKey: "cap5Desc" },
  { num: "06", titleKey: "cap6Title", descKey: "cap6Desc" },
];

const accentClasses = {
  teal: { text: "text-teal-300", border: "border-teal-500/30", dot: "bg-teal-400" },
  marigold: { text: "text-marigold-300", border: "border-marigold-500/30", dot: "bg-marigold-400" },
  red: { text: "text-red-300", border: "border-red-500/30", dot: "bg-red-400" },
};

function SlideIllustration({ accent }) {
  const stroke = accent === "teal" ? "#3FBDB6" : accent === "marigold" ? "#E8A33D" : "#ef4444";
  return (
    <svg viewBox="0 0 420 420" className="w-full h-auto">
      <circle cx="210" cy="210" r="170" fill="none" stroke="#233047" strokeWidth="1" />
      <circle cx="210" cy="210" r="120" fill="none" stroke="#233047" strokeWidth="1" />
      <circle cx="210" cy="210" r="70" fill="none" stroke="#233047" strokeWidth="1" />
      <path d="M40,260 Q125,225 210,255 T380,240" fill="none" stroke={stroke} strokeWidth="2.5" opacity="0.85">
        <animate attributeName="d" dur="7s" repeatCount="indefinite"
          values="M40,260 Q125,225 210,255 T380,240;M40,245 Q125,260 210,235 T380,255;M40,260 Q125,225 210,255 T380,240" />
      </path>
      <circle cx="210" cy="210" r="5" fill="#F3EDE1" />
      <circle cx="210" cy="210" r="14" fill="none" stroke="#F3EDE1" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function HeroSlider({ slides, t }) {
  const [active, setActive] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    setActive(0); // reset if the slide list changes (e.g. a live alert slide appears)
  }, [slides.length]);

  useEffect(() => {
    timer.current = setInterval(() => setActive((i) => (i + 1) % slides.length), 5500);
    return () => clearInterval(timer.current);
  }, [slides.length]);

  const goTo = (i) => {
    setActive(i);
    clearInterval(timer.current);
    timer.current = setInterval(() => setActive((k) => (k + 1) % slides.length), 5500);
  };

  const raw = slides[active];
  const slide = raw.isLive ? raw : { tag: t(raw.tagKey), title: t(raw.titleKey), desc: t(raw.descKey), accent: raw.accent };
  const accent = accentClasses[slide.accent];

  return (
    <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-16 items-center">
      <div>
        <div className={`inline-flex items-center gap-2 text-[11px] font-mono-data uppercase tracking-[0.25em] px-3 py-1.5 rounded-full border ${accent.border} ${accent.text} mb-8 transition-colors`}>
          <span className={`w-1.5 h-1.5 rounded-full ${accent.dot} animate-pulse`} />
          {slide.tag}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.08] text-parchment mb-6 min-h-[2.2em]">
          {slide.title}
        </h1>
        <p className="text-lg text-muted max-w-xl leading-relaxed mb-8 min-h-[3.5em]">
          {slide.desc}
        </p>

        <div className="flex items-center gap-2 mb-10">
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Show slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === active ? "w-8 bg-teal-400" : "w-1.5 bg-white/20 hover:bg-white/40"}`}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-4">
          <Link to="/register" className="btn-primary">{t("createAccount")}</Link>
          <Link to="/login" className="btn-secondary">{t("signIn")}</Link>
        </div>
      </div>

      <div className="relative hidden lg:block">
        <SlideIllustration accent={slide.accent} />
      </div>
    </div>
  );
}

export default function Home() {
  const { t, lang } = useLanguage();
  const [networkStats, setNetworkStats] = useState(null);
  const [liveSlide, setLiveSlide] = useState(null);
  const [advisories, setAdvisories] = useState([]);

  useEffect(() => {
    axios.get(`${API_BASE}/advisories`).then((res) => setAdvisories((res.data || []).slice(0, 3))).catch(() => {});
    Promise.all([
      axios.get(`${API_BASE}/shelters`).catch(() => ({ data: [] })),
      axios.get(`${API_BASE}/hospitals`).catch(() => ({ data: [] })),
    ]).then(([shelters, hospitals]) => {
      setNetworkStats({
        shelters: shelters.data.length,
        hospitals: hospitals.data.length,
      });
    });

    // Turn the most recent active High/Medium alert into a real, live first slide
    axios.get(`${API_BASE}/alerts`).then((res) => {
      const active = (res.data || []).find((a) => a.status !== "Cancelled" && (a.risk === "High" || a.risk === "Medium"));
      if (active) {
        setLiveSlide({
          isLive: true,
          tag: `Live alert · ${active.location}`,
          title: active.message,
          desc: `A ${active.risk.toLowerCase()} flood risk alert is currently active for ${active.location}. Sign in to see the full prediction and safety guidance.`,
          accent: active.risk === "High" ? "red" : "marigold",
        });
      }
    }).catch(() => {});
  }, []);

  const slides = liveSlide ? [liveSlide, ...SLIDE_KEYS] : SLIDE_KEYS;

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />

      {/* ── HERO SLIDER ── */}
      <section className="relative pt-32 pb-20 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{
          backgroundImage: "radial-gradient(circle at 15% 20%, rgba(63,189,182,0.15), transparent 45%), radial-gradient(circle at 85% 10%, rgba(232,163,61,0.12), transparent 40%)"
        }} />
        <div className="relative max-w-6xl mx-auto px-6">
          <HeroSlider slides={slides} t={t} />
        </div>
      </section>

      {/* ── LIVE NETWORK (real data, fetched from the backend) ── */}
      {networkStats && (networkStats.shelters > 0 || networkStats.hospitals > 0) && (
        <section className="py-10 border-b border-white/5 bg-white/[0.02]">
          <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center gap-x-10 gap-y-3">
            <p className="eyebrow text-muted">{t("liveFromDeployment")}</p>
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl text-teal-400">{networkStats.shelters}</span>
              <span className="text-sm text-muted">{t("sheltersRegistered")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl text-marigold-400">{networkStats.hospitals}</span>
              <span className="text-sm text-muted">{t("hospitalsRegistered")}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── RISK LEVELS ── */}
      <section className="py-20 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <p className="eyebrow text-teal-400 mb-3">{t("howRiskClassified")}</p>
          <h2 className="font-display text-3xl text-parchment mb-12">{t("threeLevels")}</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {RISK_LEVEL_KEYS.map((r) => (
              <div key={r.levelKey} className="dashboard-card p-7">
                <span className={`inline-block text-xs font-mono-data uppercase tracking-widest px-2.5 py-1 rounded-full mb-5 border ${accentClasses[r.accent].border} ${accentClasses[r.accent].text}`}>
                  {t(r.levelKey)}
                </span>
                <p className="text-sm text-muted leading-relaxed">{t(r.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PUBLIC ADVISORIES ── */}
      {advisories.length > 0 && (
        <section className="py-16 border-b border-white/5">
          <div className="max-w-6xl mx-auto px-6">
            <p className="eyebrow text-teal-400 mb-3">{t("officialCommunication")}</p>
            <h2 className="font-display text-3xl text-parchment mb-8">{t("publicAdvisories")}</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {advisories.map((a) => (
                <div key={a.id} className="dashboard-card p-6">
                  <h3 className="font-display text-lg text-parchment mb-2">{a.title}</h3>
                  <p className="text-sm text-muted leading-relaxed mb-3">{a.message}</p>
                  <p className="text-xs text-muted">{a.region} · {new Date(a.created_at).toLocaleDateString(lang === "ur" ? "ur-PK" : undefined)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── HISTORICAL CONTEXT ── */}
      <section className="py-20 border-b border-white/5 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6">
          <p className="eyebrow text-red-400 mb-3">{t("whyMatters")}</p>
          <h2 className="font-display text-3xl text-parchment mb-12">{t("recentFloodsTitle")}</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { year: "2010", titleKey: "flood2010Title", descKey: "flood2010Desc" },
              { year: "2011", titleKey: "flood2011Title", descKey: "flood2011Desc" },
              { year: "2022", titleKey: "flood2022Title", descKey: "flood2022Desc" },
            ].map((f) => (
              <div key={f.year} className="dashboard-card p-7">
                <span className="font-mono-data text-xs text-red-300 uppercase tracking-widest">{f.year}</span>
                <h3 className="font-display text-lg text-parchment mt-3 mb-2">{t(f.titleKey)}</h3>
                <p className="text-sm text-muted leading-relaxed">{t(f.descKey)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-6">
            {t("floodsFootnote")}
          </p>
        </div>
      </section>

      {/* ── CAPABILITIES ── */}
      <section className="py-20 border-b border-white/5 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6">
          <p className="eyebrow text-marigold-400 mb-3">{t("whatSystemDoes")}</p>
          <h2 className="font-display text-3xl text-parchment mb-12">{t("builtForResponse")}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/10">
            {CAPABILITY_KEYS.map((c) => (
              <div key={c.num} className="bg-ink p-7 hover:bg-white/[0.03] transition-colors">
                <span className="font-mono-data text-xs text-muted">{c.num}</span>
                <h3 className="font-display text-lg text-parchment mt-3 mb-2">{t(c.titleKey)}</h3>
                <p className="text-sm text-muted leading-relaxed">{t(c.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-3xl border border-teal-500/20 bg-gradient-to-br from-teal-900/20 to-marigold-900/10 p-10 sm:p-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            <div>
              <h2 className="font-display text-3xl text-parchment mb-3">{t("checkCityRisk")}</h2>
              <p className="text-muted max-w-md">{t("checkCityRiskDesc")}</p>
            </div>
            <Link to="/login" className="btn-primary shrink-0">{t("goToDashboard")}</Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
