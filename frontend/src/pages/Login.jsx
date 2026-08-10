import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function Login() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const role = localStorage.getItem('userRole');
    if (role) {
      const routeMap = {
        citizen: '/citizen-dashboard',
        rescue_worker: '/rescue-dashboard',
        government_official: '/gov-dashboard',
        admin: '/admin-dashboard'
      };
      navigate(routeMap[role] || '/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!email.trim()) {
      setError(t('enterEmail'));
      return;
    }
    if (!emailRegex.test(email.trim())) {
      setError(t('invalidEmailFormat'));
      return;
    }
    if (!password) {
      setError(t('enterPassword'));
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/login`, {
        email: email.trim().toLowerCase(),
        password: password.trim()
      });

      // Save user role in localStorage
      localStorage.setItem('userRole', response.data.role);
      localStorage.setItem('userName', response.data.name);
      localStorage.setItem('userEmail', response.data.email);
      if (response.data.id) localStorage.setItem('userId', response.data.id);
      
      // Show success message
      setSuccess(t('loginSuccessRedirect'));
      
      // Role-based redirection
      setTimeout(() => {
        const userRole = response.data.role;
        switch(userRole) {
          case 'citizen':
            navigate('/citizen-dashboard');
            break;
          case 'rescue_worker':
            navigate('/rescue-dashboard');
            break;
          case 'government_official':
            navigate('/gov-dashboard');
            break;
          case 'admin':
            navigate('/admin-dashboard');
            break;
          default:
            navigate('/citizen-dashboard');
        }
      }, 1500);
    } catch (err) {
      const serverMessage = err.response?.data?.message || err.response?.data?.error;
      setError(serverMessage || err.message || 'Invalid credentials. Please ensure the backend server is running.');
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  
  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-md mx-auto">
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
              <div className="text-center mb-8">
                <h1 className="font-display text-3xl text-parchment mb-2">{t("welcomeBack")}</h1>
                <p className="text-muted">{t("signIn")}</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}
                {success && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                    <p className="text-green-400 text-sm">{success}</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("emailAddress")}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder={t("enterYourEmail")}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("password")}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder={t("enterYourPassword")}
                    required
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center">
                    <input type="checkbox" className="mr-2" />
                    <span className="text-sm text-muted">{t("rememberMe")}</span>
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-marigold-400 to-marigold-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? t('analysing') : t('signIn')}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}