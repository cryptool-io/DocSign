import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useAuth } from '../lib/store.js';
import { Spinner, useToast } from '../lib/ui.jsx';

export default function Settings() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [version, setVersion] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [steps, setSteps] = useState(null);
  const [delPassword, setDelPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user?.role === 'admin';

  const exportData = async () => {
    try {
      const r = await api.get('/auth/account/export', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'docsign-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('Your data export downloaded');
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  const deleteAccount = async () => {
    if (!delPassword) return toast('Enter your password to confirm.', 'err');
    if (!window.confirm(
      'Permanently delete your account? This erases your personal data, saved recipients, and unsent drafts, and signs you out. ' +
      'Completed signed agreements and their audit trail are kept for the legal retention period, as required by law. This cannot be undone.'
    )) return;
    setDeleting(true);
    try {
      const { data } = await api.delete('/auth/account', { data: { password: delPassword } });
      const kept = data.retainedAgreements
        ? ` ${data.retainedAgreements} completed agreement(s) retained for legal compliance.`
        : '';
      toast(`Account erased.${kept}`);
      await logout();
      nav('/login', { replace: true });
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setDeleting(false);
    }
  };

  const loadVersion = () => api.get('/admin/version').then((r) => setVersion(r.data.data)).catch(() => setVersion({}));
  useEffect(() => {
    loadVersion();
  }, []);

  const runUpdate = async () => {
    if (!confirm('Pull the latest code from GitHub and restart the server?')) return;
    setUpdating(true);
    setSteps(null);
    try {
      const { data } = await api.post('/admin/update');
      setSteps(data.steps);
      toast(data.ok ? 'Update complete' : 'Update finished with errors', data.ok ? 'ok' : 'err');
    } catch (err) {
      // If the process restarts mid-request, the connection may drop — that's expected.
      const msg = apiError(err);
      setSteps(err.response?.data?.steps || null);
      toast(msg.includes('Network') ? 'Server restarting…' : msg, 'err');
    } finally {
      setUpdating(false);
      setTimeout(loadVersion, 2000);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Account and deployment.</p>
        </div>
      </div>

      <div className="card mb">
        <h2>Account</h2>
        <table>
          <tbody>
            <tr>
              <td className="muted">Name</td>
              <td>{user?.name}</td>
            </tr>
            <tr>
              <td className="muted">Email</td>
              <td>{user?.email}</td>
            </tr>
            <tr>
              <td className="muted">Role</td>
              <td>{user?.role}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Deployment</h2>
        {!version ? (
          <Spinner />
        ) : (
          <table className="mb">
            <tbody>
              <tr>
                <td className="muted">Commit</td>
                <td>{version.commit || 'unknown'}</td>
              </tr>
              <tr>
                <td className="muted">Node</td>
                <td>{version.node}</td>
              </tr>
              <tr>
                <td className="muted">Uptime</td>
                <td>{version.uptimeSeconds != null ? `${Math.floor(version.uptimeSeconds / 60)}m` : '—'}</td>
              </tr>
            </tbody>
          </table>
        )}

        {isAdmin ? (
          <>
            <p className="muted mb">
              Pulls the latest <code>main</code> from GitHub, reinstalls, rebuilds the app, runs a syntax
              precheck, and restarts via PM2. Safe to run — a failed fetch or bad build aborts before restart.
            </p>
            <button className="btn primary" disabled={updating} onClick={runUpdate}>
              {updating ? 'Updating…' : 'Update from GitHub & restart'}
            </button>
          </>
        ) : (
          <p className="muted">Only an admin can trigger a redeploy. Ask an admin, or run <code>npm run deploy:pm2</code> on the server.</p>
        )}

        {steps && (
          <div className="mt">
            <h2>Update log</h2>
            <table>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={i}>
                    <td style={{ width: 24 }}>{s.ok ? '✓' : '✗'}</td>
                    <td>{s.label}</td>
                    <td className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.output?.slice(-120)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt">
        <h2>Your data</h2>
        <p className="muted mb">
          Download a copy of your personal data — profile, workspaces, document details, envelopes you’ve
          sent, and saved recipients — as a portable JSON file (GDPR data portability).
        </p>
        <button className="btn" onClick={exportData}>Download my data</button>
      </div>

      <div className="card mt" style={{ borderColor: '#e6b8b8' }}>
        <h2 style={{ color: '#b42318' }}>Delete account</h2>
        <p className="muted mb">
          Erases your personal data — profile, saved recipients, and unsent drafts — and signs you out
          permanently. Completed signed agreements and their audit trail are <strong>kept for the legal
          retention period</strong>, as we're required to. This can't be undone.
        </p>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Confirm your password</label>
          <input
            className="input"
            type="password"
            value={delPassword}
            onChange={(e) => setDelPassword(e.target.value)}
            placeholder="Your current password"
            autoComplete="current-password"
          />
        </div>
        <button className="btn danger" disabled={deleting} onClick={deleteAccount}>
          {deleting ? 'Erasing…' : 'Delete my account'}
        </button>
      </div>
    </>
  );
}
