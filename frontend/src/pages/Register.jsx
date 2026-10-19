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
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationStep, setVerificationStep] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      errors.name = 'Please fill out this field';
      isValid = false;
    } else if (!validateName(formData.name)) {
      errors.name = 'Name must be at least 3 characters and contain only letters';
      isValid = false;
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Please fill out this field';
      isValid = false;
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Enter a valid email address (e.g., user@gmail.com, user@yahoo.com)';
      isValid = false;
    }

    // Password validation
    if (!formData.password) {
      errors.password = 'Please fill out this field';
      isValid = false;
    } else if (!validatePassword(formData.password)) {
      errors.password = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';
      isValid = false;
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please fill out this field';
      isValid = false;
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
      isValid = false;
    }

    setFormErrors(errors);
    return isValid;
  };

  const handleBlur = (field) => {
    if (field === 'name') {
      if (!formData.name.trim()) {
        setFormErrors(prev => ({ ...prev, name: 'Please fill out this field' }));
      } else if (!validateName(formData.name)) {
        setFormErrors(prev => ({ ...prev, name: 'Name must be at least 3 characters and contain only letters' }));
      }
    } else if (field === 'email') {
      if (!formData.email.trim()) {
        setFormErrors(prev => ({ ...prev, email: 'Please fill out this field' }));
      } else if (!validateEmail(formData.email)) {
        setFormErrors(prev => ({ ...prev, email: 'Enter a valid email address (e.g., user@gmail.com, user@yahoo.com)' }));
      }
    } else if (field === 'password') {
      if (!formData.password) {
        setFormErrors(prev => ({ ...prev, password: 'Please fill out this field' }));
      } else if (!validatePassword(formData.password)) {
        setFormErrors(prev => ({ ...prev, password: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character' }));
      }
    } else if (field === 'confirmPassword') {
      if (!formData.confirmPassword) {
        setFormErrors(prev => ({ ...prev, confirmPassword: 'Please fill out this field' }));
      } else if (formData.password !== formData.confirmPassword) {
        setFormErrors(prev => ({ ...prev, confirmPassword: 'Passwords do not match' }));
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // A code was sent to the old address; changing the email must restart verification.
    if (name === 'email' && verificationStep && value.trim().toLowerCase() !== formData.email.trim().toLowerCase()) {
      setVerificationStep(false);
      setEmailVerificationSent(false);
      setVerificationCode('');
      setSuccess('');
      setError('');
    }
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

    if (verificationStep && (!verificationCode.trim() || verificationCode.trim().length < 6)) {
      setError('Please enter the complete 6-digit verification code');
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const endpoint = verificationStep ? '/register' : '/register/request-verification';
      const response = await axios.post(`${API_BASE}${endpoint}`, {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        role: formData.role,
        ...(verificationStep ? { verification_token: verificationCode.trim() } : {})
      });

      // Check if backend returned an error
      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      if (verificationStep) {
        setSuccess('Email verified and account created. Redirecting to login...');
        setTimeout(() => navigate('/login'), 1800);
      } else {
        setSuccess('A verification code has been sent to your email.');
        setEmailVerificationSent(true);
        setVerificationStep(true);
      }
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

  const handleResendVerification = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post(`${API_BASE}/register/request-verification`, {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        role: formData.role
      });
      setSuccess(response.data.message || 'A new verification code was sent to your email.');
      setVerificationCode('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend the verification code.');
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
              <form onSubmit={handleSubmit} className="space-y-6" noValidate>
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
                        ✓ Verification email sent
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">
                    {t("fullName")}
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    onBlur={() => handleBlur('name')}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors ${
                      formErrors.name 
                        ? 'bg-red-950/20 border-2 border-red-500 ring-1 ring-red-500' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("enterYourFullName")}
                  />
                  {formErrors.name && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {formErrors.name}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">
                    {t("email")}
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    onBlur={() => handleBlur('email')}
                    className={`w-full px-4 py-3 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors ${
                      formErrors.email 
                        ? 'bg-red-950/20 border-2 border-red-500 ring-1 ring-red-500' 
                        : 'bg-white/10 border border-white/20'
                    }`}
                    placeholder={t("enterYourEmail")}
                  />
                  {formErrors.email && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {formErrors.email}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">
                    {t("passwordLabel")}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('password')}
                      className={`w-full px-4 py-3 pr-12 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors ${
                        formErrors.password 
                          ? 'bg-red-950/20 border-2 border-red-500 ring-1 ring-red-500' 
                          : 'bg-white/10 border border-white/20'
                      }`}
                      placeholder={t("createPasswordPh")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1 rounded transition-colors focus:outline-none cursor-pointer"
                      title={showPassword ? "Hide password" : "Show password"}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {formErrors.password && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {formErrors.password}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    Must be at least 8 characters with uppercase, lowercase, number, and special character
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">
                    {t("confirmPasswordLabel")}
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('confirmPassword')}
                      className={`w-full px-4 py-3 pr-12 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors ${
                        formErrors.confirmPassword 
                          ? 'bg-red-950/20 border-2 border-red-500 ring-1 ring-red-500' 
                          : 'bg-white/10 border border-white/20'
                      }`}
                      placeholder={t("confirmYourPassword")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1 rounded transition-colors focus:outline-none cursor-pointer"
                      title={showConfirmPassword ? "Hide password" : "Show password"}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {formErrors.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {formErrors.confirmPassword}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">
                    {t("whoAreYou")}
                  </label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-ink-soft/90 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option className="bg-ink text-white" value="citizen">{t("citizenSingular")}</option>
                    <option className="bg-ink text-white" value="rescue_worker">{t("rescueWorkerSingular")}</option>
                  </select>
                  <p className="mt-2 text-xs text-muted">
                    Select your role to access appropriate dashboard features
                  </p>
                </div>
                {verificationStep && (
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">
                      Email verification code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-4 py-3 rounded-lg text-white placeholder-muted bg-white/10 border border-white/20 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="Enter the 6-digit code sent to your email"
                      required
                    />
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={loading}
                      className="mt-2 text-sm text-teal-400 hover:text-teal-300 disabled:opacity-50"
                    >
                      Resend verification code
                    </button>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading || Object.values(formErrors).some(error => error !== "")}
                  className="w-full py-3 px-4 bg-gradient-to-r from-marigold-400 to-marigold-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? (verificationStep ? 'Verifying email...' : 'Sending verification code...') : (verificationStep ? 'Verify email & create account' : t('createAccount'))}
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