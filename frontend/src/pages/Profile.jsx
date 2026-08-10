import { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE } from "../config";

export default function Profile() {
  const { t } = useLanguage();
  const [user, setUser] = useState({
    name: '',
    email: '',
    role: ''
  });
  const [editMode, setEditMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const userName = localStorage.getItem('userName');
    const userEmail = localStorage.getItem('userEmail');
    const userRole = localStorage.getItem('userRole');
    
    if (userName && userEmail && userRole) {
      setUser({
        name: userName,
        email: userEmail,
        role: userRole
      });
      setFormData({
        name: userName,
        email: userEmail
      });
      setIsAdmin(userRole === 'admin');
    }
  }, []);
  const [formData, setFormData] = useState({
    name: '',
    email: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleEdit = () => {
    setEditMode(true);
    setError('');
    setSuccess('');
  };

  const handleCancel = () => {
    setEditMode(false);
    setFormData({
      name: user.name,
      email: user.email
    });
    setError('');
    setSuccess('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    const userId = localStorage.getItem('userId');

    try {
      if (!userId) {
        throw new Error('Missing user id — please log out and log back in.');
      }
      await axios.put(`${API_BASE}/users/${userId}/profile`, {
        name: formData.name,
        email: formData.email,
      });

      // Update localStorage and user state
      localStorage.setItem('userName', formData.name);
      localStorage.setItem('userEmail', formData.email);
      setUser({
        ...user,
        name: formData.name,
        email: formData.email
      });

      setSuccess('Profile updated successfully!');
      setEditMode(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const getRoleDisplayName = (role) => {
    switch (role) {
      case 'citizen': return 'Citizen';
      case 'rescue_worker': return 'Rescue Worker';
      case 'government_official': return 'Government Official';
      case 'admin': return 'Administrator';
      default: return role;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'citizen': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'rescue_worker': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'government_official': return 'bg-teal-500/20 text-teal-400 border-teal-500/50';
      case 'admin': return 'bg-red-500/20 text-red-400 border-red-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  return (
    <div className="min-h-screen bg-ink text-parchment font-sans">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl text-parchment mb-4">{t("profileManagement")}</h1>
            <p className="text-xl text-muted">{t("viewEditAccount")}</p>
          </div>

          <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
            {/* Profile Header */}
            <div className="flex items-center gap-6 mb-8">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-marigold-400 to-marigold-500 flex items-center justify-center text-white text-3xl font-bold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="font-display text-2xl text-parchment">{user.name}</h2>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getRoleColor(user.role)}`}>
                    {getRoleDisplayName(user.role)}
                  </span>
                  <span className="text-muted text-sm">{t("memberSince")} {new Date().toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            {/* Success/Error Messages */}
            {success && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 mb-6">
                <p className="text-green-400">{success}</p>
              </div>
            )}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
                <p className="text-red-400">{error}</p>
              </div>
            )}

            {/* Profile Form */}
            {!editMode ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("fullName2")}</label>
                  <div className="bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white">
                    {user.name}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("emailAddress2")}</label>
                  <div className="bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white">
                    {user.email}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("role")}</label>
                  <div className={`bg-white/10 border border-white/20 rounded-lg px-4 py-3 ${getRoleColor(user.role)}`}>
                    {getRoleDisplayName(user.role)}
                  </div>
                </div>
                <button
                  onClick={handleEdit}
                  className="btn-secondary"
                >
                  {t("editProfile")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("fullName2")}</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder={t("enterFullNamePh")}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("emailAddress2")}</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder={t("enterEmailAddressPh")}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">{t("role")}</label>
                  <div className={`bg-white/10 border border-white/20 rounded-lg px-4 py-3 ${getRoleColor(user.role)}`}>
                    {getRoleDisplayName(user.role)}
                  </div>
                  <p className="text-xs text-muted mt-1">{t("roleCannotChange")}</p>
                </div>
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? t("saving") : t("saveChanges")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="bg-white/10 hover:bg-white/10 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )}

            {/* Account Info */}
            <div className="mt-8 pt-8 border-t border-white/20">
              <h3 className="font-display text-lg text-parchment mb-4">{t("accountInfo")}</h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="eyebrow text-muted mb-2">{t("accountStatus")}</h4>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-green-400">{t("active")}</span>
                  </div>
                </div>
                <div>
                  <h4 className="eyebrow text-muted mb-2">{t("dashboardAccess")}</h4>
                  <p className="text-muted capitalize">
                    {user.role === 'citizen' && t('citizenDashboardLabel')}
                    {user.role === 'rescue_worker' && t('rescueDashboardLabel')}
                    {user.role === 'government_official' && t('govDashboardLabel')}
                    {user.role === 'admin' && t('adminDashboardLabel')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
