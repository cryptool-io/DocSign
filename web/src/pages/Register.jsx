import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../lib/store.js';
import { useToast } from '../lib/ui.jsx';
import { apiError } from '../lib/api.js';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', company: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await register(form);
      if (res.accessToken) nav('/', { replace: true });
      else {
        toast(res.message || 'Check your email to verify your account.');
        nav('/login');
      }
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
          Cryptool <span>DocSign</span>
        </div>
        <h1>Create your account</h1>
        <p className="muted mb">Start sending documents in minutes.</p>
        <div className="field">
          <label>Full name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div className="field">
          <label>Work email</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label>Company (optional)</label>
          <input className="input" value={form.company} onChange={set('company')} />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} />
        </div>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted mt" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
