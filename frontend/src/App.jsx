import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import CitizenDashboard from './pages/CitizenDashboard';
import RescueDashboard from './pages/RescueDashboard';
import GovDashboard from './pages/GovDashboard';
import AdminDashboard from './pages/AdminDashboard';
import Profile from './pages/Profile';
import Community from './pages/Community';
import MapView from './pages/MapView';
import CheckIn from './pages/CheckIn';
import ForgotPassword from './pages/ForgotPassword';
import ProtectedRoute from './components/ProtectedRoute';
import { LanguageProvider } from './context/LanguageContext';

function DashboardRedirect() {
  const role = localStorage.getItem('userRole');

  if (!role) {
    return <Navigate to="/login" replace />;
  }

  switch (role) {
    case 'citizen':
      return <Navigate to="/citizen-dashboard" replace />;
    case 'rescue_worker':
      return <Navigate to="/rescue-dashboard" replace />;
    case 'government_official':
      return <Navigate to="/gov-dashboard" replace />;
    case 'admin':
      return <Navigate to="/admin-dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

function App() {
  return (
    <LanguageProvider>
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <DashboardRedirect />
          </ProtectedRoute>
        } />
        <Route path="/citizen-dashboard" element={
          <ProtectedRoute allowedRoles={['citizen']}>
            <CitizenDashboard />
          </ProtectedRoute>
        } />
        <Route path="/rescue-dashboard" element={
          <ProtectedRoute allowedRoles={['rescue_worker']}>
            <RescueDashboard />
          </ProtectedRoute>
        } />
        <Route path="/gov-dashboard" element={
          <ProtectedRoute allowedRoles={['government_official']}>
            <GovDashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin-dashboard" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/community" element={<Community />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/checkin/:shelterId" element={<CheckIn />} />
        <Route path="/profile" element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
    </LanguageProvider>
  );
}

export default App;