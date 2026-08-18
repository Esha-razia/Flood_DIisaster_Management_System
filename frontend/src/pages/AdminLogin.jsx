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
        response = await axios.post(`${API_BASE}/login`, payload);
      } catch (postErr) {
        if (postErr.response?.status === 404) {
          response = await axios.post(`${API_BASE}/admin/login`, payload);
        } else {
          throw postErr;
        }
      }

      if (response.data.role !== 'admin') {
        setError('Access Denied: This portal is strictly restricted to System Administrators.');
        setLoading(false);
        return;
      }

      // Save admin credentials
      localStorage.setItem('userRole', 'admin');
      localStorage.setItem('userName', response.data.name || 'System Admin');
      localStorage.setItem('userEmail', response.data.email || 'admin@example.com');
      if (response.data.id) localStorage.setItem('userId', response.data.id);

      setSuccess('Administrator login successful! Redirecting...');

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
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-md mx-auto">
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
              <div className="text-center mb-8">
                <h1 className="font-display text-3xl text-parchment mb-2">Admin Portal</h1>
                <p className="text-muted">Sign in with your administrator credentials</p>
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
                  <label className="block text-sm font-medium text-muted mb-2">Admin Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder="Enter admin username (e.g. admin)"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder="Enter admin password"
                    required
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center">
                    <input type="checkbox" className="mr-2" />
                    <span className="text-sm text-muted">Remember me</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-marigold-400 to-marigold-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
                >
                  {loading ? 'Authenticating...' : 'Sign In as Admin'}
                </button>

                <div className="pt-4 mt-2 border-t border-white/10 text-center">
                  <Link
                    to="/login"
                    className="text-sm text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    ← Return to Citizen & Staff Sign In
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
