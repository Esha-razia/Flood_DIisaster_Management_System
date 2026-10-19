import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function ForgotPassword() {
  const { t } = useLanguage();
  const [step, setStep] = useState(1); // 1 = request code, 2 = enter code + new password
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!email.trim()) {
      setFieldErrors({ email: 'Please fill out this field' });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setFieldErrors({ email: 'Please enter a valid email address' });
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/forgot-password`, { email });
      setSuccess(res.data.message || 'A verification code was sent to your email.');
      setStep(2);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Email not found in our system. Please check and try again.');
      } else {
        setError(err.response?.data?.message || 'Server error. Please make sure the backend is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const errors = {};
    if (!token.trim()) errors.token = 'Please fill out this field';
    if (!newPassword) errors.newPassword = 'Please fill out this field';
    if (!confirmPassword) errors.confirmPassword = 'Please fill out this field';
    else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/reset-password`, {
        email, token: token.trim(), new_password: newPassword,
      });
      setSuccess(res.data.message || 'Password reset successfully.');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post(`${API_BASE}/forgot-password`, { email });
      setSuccess(res.data.message || 'A new verification code was sent to your email.');
      setToken('');
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
        <div className="max-w-md mx-auto px-6">
          <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
            <div className="text-center mb-8">
              <h1 className="font-display text-3xl text-parchment mb-2">{t("resetPassword")}</h1>
              <p className="text-muted">
                {step === 1
                  ? t("enterEmailForCode")
                  : t("enterCodeAndPassword")}
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-6">
                <p className="text-green-400 text-sm">{success}</p>
              </div>
            )}

            {step === 1 ? (
              <form onSubmit={handleRequestCode} className="space-y-6" noValidate>
                <div>
                  <label className="field-label">
                    {t("emailAddress2")} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: '' }));
                    }}
                    className={`field-input transition-colors ${
                      fieldErrors.email ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                    }`}
                    placeholder={t("enterRegisteredEmail")}
                    required
                  />
                  {fieldErrors.email && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {fieldErrors.email}
                    </p>
                  )}
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
                  {loading ? t('sending') : t('sendCode')}
                </button>
                <p className="text-xs text-muted text-center">
                  {t("smtpNote")}
                </p>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-6" noValidate>
                <div>
                  <label className="field-label">
                    {t("verificationCode")} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      if (fieldErrors.token) setFieldErrors(prev => ({ ...prev, token: '' }));
                    }}
                    className={`field-input font-mono-data tracking-widest transition-colors ${
                      fieldErrors.token ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                    }`}
                    placeholder="Enter the code sent to your email"
                    required
                  />
                  {fieldErrors.token && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {fieldErrors.token}
                    </p>
                  )}
                </div>
                <button type="button" onClick={handleResendCode} disabled={loading} className="w-full text-sm text-teal-400 hover:text-teal-300 disabled:opacity-50">
                  Resend verification code
                </button>
                <div>
                  <label className="field-label">
                    {t("newPassword")} <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (fieldErrors.newPassword) setFieldErrors(prev => ({ ...prev, newPassword: '' }));
                      }}
                      className={`field-input pr-12 transition-colors ${
                        fieldErrors.newPassword ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                      }`}
                      placeholder={t("createNewPasswordPh")}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1 rounded transition-colors focus:outline-none"
                      title={showNewPassword ? "Hide password" : "Show password"}
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                    >
                      {showNewPassword ? (
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
                  {fieldErrors.newPassword && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {fieldErrors.newPassword}
                    </p>
                  )}
                </div>
                <div>
                  <label className="field-label">
                    {t("confirmNewPassword")} <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (fieldErrors.confirmPassword) setFieldErrors(prev => ({ ...prev, confirmPassword: '' }));
                      }}
                      className={`field-input pr-12 transition-colors ${
                        fieldErrors.confirmPassword ? 'border-2 border-red-500 bg-red-950/20 ring-1 ring-red-500' : ''
                      }`}
                      placeholder={t("repeatNewPassword")}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1 rounded transition-colors focus:outline-none"
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
                  {fieldErrors.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1 font-medium">
                      <span>⚠️</span> {fieldErrors.confirmPassword}
                    </p>
                  )}
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
                  {loading ? t('resettingPassword') : t('resetPassword')}
                </button>
                <button type="button" onClick={() => setStep(1)} className="w-full text-xs text-muted hover:text-parchment transition-colors">
                  {t('useAnotherEmail')}
                </button>
              </form>
            )}

            <div className="mt-8 text-center">
              <Link to="/login" className="text-teal-400 hover:text-teal-300 transition-colors text-sm">
                {t('backToLogin')}
              </Link>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
