import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast">
        {toasts.map((t) => (
          <div key={t.id} className={`t ${t.kind === 'err' ? 'err' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx) || (() => {});

export function Spinner({ center }) {
  const s = <div className="spinner" />;
  return center ? <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>{s}</div> : s;
}

export function Badge({ status }) {
  const map = {
    draft: 'gray',
    sent: 'blue',
    partially_signed: 'amber',
    completed: 'green',
    declined: 'red',
    voided: 'red',
    expired: 'gray',
    pending: 'gray',
    viewed: 'blue',
    signed: 'green'
  };
  const label = String(status || '').replace(/_/g, ' ');
  return <span className={`badge ${map[status] || 'gray'}`}>{label}</span>;
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');
export const fmtDuration = (secs) => {
  const s = Math.round(secs || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};
