import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useToast } from '../lib/ui.jsx';

/**
 * Two modes in one page:
 *  - no ?token  → request a reset link (enter email → POST /auth/forgot-password)
 *  - ?token=…   → set a new password (POST /auth/reset-password)
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const nav = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const requestLink = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast('Password updated — please sign in.');
      nav('/login', { replace: true });
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-center">
      <div className="card center-narrow">
        <div className="brand" style={{ padding: '0 0 16px' }}>
          <span>DocSign</span>
        </div>

        {token ? (
          <form onSubmit={doReset}>
            <h1>Set a new password</h1>
            <p className="muted mb">Choose a new password for your account.</p>
            <div className="field">
              <label>New password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
            </div>
            <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
          </form>
        ) : sent ? (
          <>
            <h1>Check your email</h1>
            <p className="muted">If an account exists for that email, we've sent a link to reset your password. It expires in 1 hour.</p>
            <p className="mt">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={requestLink}>
            <h1>Reset your password</h1>
            <p className="muted mb">Enter your email and we'll send you a reset link.</p>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <p className="muted mt" style={{ textAlign: 'center' }}>
              Remembered it? <Link to="/login">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
