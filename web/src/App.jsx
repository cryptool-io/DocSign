import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastProvider, Spinner } from './lib/ui.jsx';
import { useAuth } from './lib/store.js';
import RecoveryKeyModal from './components/RecoveryKeyModal.jsx';

import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Shell from './pages/Shell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Documents from './pages/Documents.jsx';
import Recipients from './pages/Recipients.jsx';
import Templates from './pages/Templates.jsx';
import TemplateEditor from './pages/TemplateEditor.jsx';
import LinkAnalytics from './pages/LinkAnalytics.jsx';
import Envelopes from './pages/Envelopes.jsx';
import EnvelopeDetail from './pages/EnvelopeDetail.jsx';
import SendEnvelope from './pages/SendEnvelope.jsx';
import Settings from './pages/Settings.jsx';
import DataRooms from './pages/DataRooms.jsx';
import Workspaces from './pages/Companies.jsx';
import Inbox from './pages/Inbox.jsx';
import PublicDataRoom from './pages/public/PublicDataRoom.jsx';

import PublicView from './pages/public/PublicView.jsx';
import PublicSign from './pages/public/PublicSign.jsx';

function Protected({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner center />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const { ready, bootstrap } = useAuth();
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <ToastProvider>
      <RecoveryKeyModal />
      <Routes>
        {/* Public recipient surface */}
        <Route path="/v/:token" element={<PublicView />} />
        <Route path="/sign/:token" element={<PublicSign />} />
        <Route path="/room/:token" element={<PublicDataRoom />} />

        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Sender app */}
        <Route
          path="/"
          element={
            <Protected>
              <Shell />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="documents" element={<Documents />} />
          <Route path="workspaces" element={<Workspaces />} />
          <Route path="projects" element={<Navigate to="/workspaces" replace />} />
          <Route path="recipients" element={<Recipients />} />
          <Route path="templates" element={<Templates />} />
          <Route path="templates/:id" element={<TemplateEditor />} />
          <Route path="templates/new" element={<TemplateEditor />} />
          <Route path="links/:id" element={<LinkAnalytics />} />
          <Route path="envelopes" element={<Envelopes />} />
          <Route path="envelopes/:id" element={<EnvelopeDetail />} />
          <Route path="send" element={<SendEnvelope />} />
          <Route path="data-rooms" element={<DataRooms />} />
          <Route path="companies" element={<Navigate to="/workspaces" replace />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!ready && null}
    </ToastProvider>
  );
}
