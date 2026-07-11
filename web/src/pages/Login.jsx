import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/store.js';
import { useToast } from '../lib/ui.jsx';
import { apiError } from '../lib/api.js';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-center">
      <form className="card center-narrow" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 16px' }}>
          <span>DocSign</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted mb">Secure document sharing and signatures.</p>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted mt" style={{ textAlign: 'center' }}>
          No account? <Link to="/register">Create one</Link>
        </p>
      </form>
    </div>
  );
}
