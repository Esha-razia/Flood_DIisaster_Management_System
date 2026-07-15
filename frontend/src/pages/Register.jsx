import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function Register() {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'citizen'
  });
  const [formErrors, setFormErrors] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
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

  // Validation functions
  const validateEmail = (email) => {
    // Standard email format check — any valid email domain is accepted
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return emailRegex.test(email.trim());
  };

  const validatePassword = (password) => {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  };

  const validateName = (name) => {
    // Only letters and spaces, minimum 3 characters
    const nameRegex = /^[A-Za-z\s]{3,}$/;
    return nameRegex.test(name.trim());
  };

  const validateForm = () => {
    const errors = {
      name: '',
      email: '',
      password: '',
      confirmPassword: ''
    };
    let isValid = true;

    // Name validation
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
      isValid = false;
    } else if (!validateName(formData.name)) {
      errors.name = 'Name must be at least 3 characters and contain only letters';
      isValid = false;
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
      isValid = false;
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Enter a valid email address (e.g., user@gmail.com, user@yahoo.com)';
      isValid = false;
    }

    // Password validation
    if (!formData.password) {
      errors.password = 'Password is required';
      isValid = false;
    } else if (!validatePassword(formData.password)) {
      errors.password = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';
      isValid = false;
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
      isValid = false;
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
      isValid = false;
    }

    setFormErrors(errors);
    return isValid;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error for this field when user starts typing
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate form before submission
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await axios.post(`${API_BASE}/register`, {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        role: formData.role
      });

      // Check if backend returned an error
      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      setSuccess('Successfully signed up! Redirecting to login...');
      setEmailVerificationSent(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
        setError(err.response.data.message);
      } else {
        setError('Registration failed. Please make sure the backend server is running.');
      }
      console.error('Register error:', err);
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
                <h1 className="font-display text-3xl text-parchment mb-2">{t("createYourAccount")}</h1>
                <p className="text-muted">{t("joinPlatform")}</p>
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
                    {emailVerificationSent && (
                      <p className="text-green-400 text-xs mt-1">
                        ✓ Verification email sent (simulated)
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("fullName")}</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                      formErrors.name 
                        ? 'bg-red-950/20 border border-red-500/50' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("enterYourFullName")}
                  />
                  {formErrors.name && (
                    <p className="mt-1 text-xs text-red-400">{formErrors.name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("email")}</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                      formErrors.email 
                        ? 'bg-red-950/20 border border-red-500/50' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("enterYourEmail")}
                  />
                  {formErrors.email && (
                    <p className="mt-1 text-xs text-red-400">{formErrors.email}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("passwordLabel")}</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                      formErrors.password 
                        ? 'bg-red-950/20 border border-red-500/50' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("createPasswordPh")}
                  />
                  {formErrors.password && (
                    <p className="mt-1 text-xs text-red-400">{formErrors.password}</p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    Must be at least 8 characters with uppercase, lowercase, number, and special character
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("confirmPasswordLabel")}</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                      formErrors.confirmPassword 
                        ? 'bg-red-950/20 border border-red-500/50' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("confirmYourPassword")}
                  />
                  {formErrors.confirmPassword && (
                    <p className="mt-1 text-xs text-red-400">{formErrors.confirmPassword}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("whoAreYou")}</label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-ink-soft/90 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option className="bg-ink text-white" value="citizen">{t("citizenSingular")}</option>
                    <option className="bg-ink text-white" value="rescue_worker">{t("rescueWorkerSingular")}</option>
                    <option className="bg-ink text-white" value="government_official">{t("govOfficials")}</option>
                  </select>
                  <p className="mt-2 text-xs text-muted">
                    Select your role to access appropriate dashboard features
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={loading || Object.values(formErrors).some(error => error !== "")}
                  className="w-full py-3 px-4 bg-gradient-to-r from-marigold-400 to-marigold-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? t('analysing') : t('createAccount')}
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