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
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post(`${API_BASE}/forgot-password`, { email });
      setSuccess(res.data.message || 'Verification code generated.');
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
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
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
              <form onSubmit={handleRequestCode} className="space-y-6">
                <div>
                  <label className="field-label">{t("emailAddress2")}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field-input"
                    placeholder={t("enterRegisteredEmail")}
                    required
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
                  {loading ? t('sending') : t('sendCode')}
                </button>
                <p className="text-xs text-muted text-center">
                  {t("smtpNote")}
                </p>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-6">
                <div>
                  <label className="field-label">{t("verificationCode")}</label>
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="field-input font-mono-data tracking-widest"
                    placeholder={t("checkBackendTerminal")}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">{t("newPassword")}</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="field-input"
                    placeholder={t("createNewPasswordPh")}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">{t("confirmNewPassword")}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="field-input"
                    placeholder={t("repeatNewPassword")}
                    required
                  />
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
