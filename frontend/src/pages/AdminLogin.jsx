import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function AdminLogin() {
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const role = localStorage.getItem('userRole');
    if (role === 'admin') {
      navigate('/admin-dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanUser = username.trim();
    if (!cleanUser) {
      setError('Please enter your Admin Username');
      return;
    }
    if (!password) {
      setError('Please enter your Password');
      return;
    }

    setLoading(true);

    try {
      // Map username 'admin' to default admin email if not an email format, ensuring compatibility with all backend versions
      const emailPayload = cleanUser.includes('@') 
        ? cleanUser.toLowerCase() 
        : (cleanUser.toLowerCase() === 'admin' ? 'admin@example.com' : cleanUser.toLowerCase());

      const payload = {
        username: cleanUser,
        email: emailPayload,
        password: password.trim()
      };

      let response;
      try {
        // Try standard /login endpoint first as it exists in all backend deployments
        response = await axios.post(`${API_BASE}/login`, payload);
      } catch (postErr) {
        if (postErr.response?.status === 404) {
          // Fallback to /admin/login if /login is not found
          response = await axios.post(`${API_BASE}/admin/login`, payload);
        } else {
          throw postErr;
        }
      }

      if (response.data.role !== 'admin') {
        setError('Access Denied: This portal is strictly restricted to Authorized System Administrators.');
        setLoading(false);
        return;
      }

      // Save admin credentials
      localStorage.setItem('userRole', 'admin');
      localStorage.setItem('userName', response.data.name || 'System Admin');
      localStorage.setItem('userEmail', response.data.email || 'admin@example.com');
      if (response.data.id) localStorage.setItem('userId', response.data.id);

      setSuccess('Administrator authentication successful! Redirecting to Command Center...');

      setTimeout(() => {
        navigate('/admin-dashboard');
      }, 1000);
    } catch (err) {
      const serverMessage = err.response?.data?.message || err.response?.data?.error;
      setError(serverMessage || err.message || 'Invalid administrator credentials.');
      console.error('Admin login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f18] via-[#0d1522] to-[#0a0f18] text-parchment font-sans flex flex-col justify-between">
      <Navbar />
      <div className="pt-28 pb-16 px-4 flex-1 flex items-center justify-center">
        <div className="max-w-md w-full mx-auto">
          {/* Security Badge */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold uppercase tracking-wider mb-3">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-ping"></span>
              Restricted Area · Authorized Personnel Only
            </div>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-red-500/20 border border-amber-500/30 mx-auto flex items-center justify-center text-3xl shadow-lg shadow-amber-500/10 mb-3">
              🛡️
            </div>
            <h1 className="font-display text-3xl text-parchment tracking-tight">Admin Command Portal</h1>
            <p className="text-sm text-muted mt-1">Flood Disaster Management System Administration</p>
          </div>

          {/* Login Card */}
          <div className="bg-white/[0.04] backdrop-blur-2xl rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
            <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-teal-500/10 rounded-full blur-2xl pointer-events-none"></div>

            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              {error && (
                <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3.5 flex items-start gap-3 text-red-300 text-sm">
                  <span className="text-base shrink-0">⚠️</span>
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-xl p-3.5 flex items-start gap-3 text-emerald-300 text-sm">
                  <span className="text-base shrink-0">✅</span>
                  <span>{success}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Admin Username / ID
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-black/40 border border-white/15 rounded-xl text-white placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all text-sm"
                  placeholder="Enter admin username (e.g. admin)"
                  autoComplete="username"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Master Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-black/40 border border-white/15 rounded-xl text-white placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all text-sm"
                  placeholder="Enter security password"
                  autoComplete="current-password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink font-bold rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-ink border-t-transparent rounded-full animate-spin"></span>
                    Authenticating Administrator...
                  </>
                ) : (
                  <>
                    <span>Unlock Admin Console</span>
                    <span>→</span>
                  </>
                )}
              </button>

              <div className="pt-4 border-t border-white/10 text-center">
                <Link
                  to="/login"
                  className="text-xs text-muted hover:text-teal-300 transition-colors inline-flex items-center gap-1"
                >
                  ← Return to Public Citizen Login
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
