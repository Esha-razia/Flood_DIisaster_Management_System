import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { t } = useLanguage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const role = localStorage.getItem('userRole');
    const name = localStorage.getItem('userName');

    if (role && name) {
      setIsAuthenticated(true);
      setUserRole(role);
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="text-white text-xl">{t("loadingDots")}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    const redirectRoutes = {
      citizen: '/citizen-dashboard',
      rescue_worker: '/rescue-dashboard',
      government_official: '/gov-dashboard',
      admin: '/admin-dashboard'
    };

    return <Navigate to={redirectRoutes[userRole] || '/'} replace />;
  }

  return children;
};

export default ProtectedRoute;