import { useState } from 'react';
import { useAuth } from '../lib/store.js';
import { useToast } from '../lib/ui.jsx';

/**
 * Shown once, right after encryption is set up. The recovery key is the ONLY way
 * back into encrypted documents if the password is lost — the server can't help.
 */
export default function RecoveryKeyModal() {
  const { pendingRecoveryKey, clearRecoveryKey } = useAuth();
  const toast = useToast();
  const [ack, setAck] = useState(false);

  if (!pendingRecoveryKey) return null;

  return (
    <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200 }}>
      <div className="card center-narrow" style={{ maxWidth: 480 }}>
        <h1>Save your recovery key</h1>
        <p className="muted mb">
          Your documents are end-to-end encrypted. If you ever forget your password, this key is the{' '}
          <strong>only</strong> way to recover them — we can't reset it for you. Store it somewhere safe.
        </p>
        <div
          style={{
            background: '#0b1220',
            color: '#e2e8f0',
            padding: '14px 16px',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 13,
            wordBreak: 'break-all',
            marginBottom: 14
          }}
        >
          {pendingRecoveryKey}
        </div>
        <div className="wrap-actions mb">
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(pendingRecoveryKey);
              toast('Recovery key copied');
            }}
          >
            Copy
          </button>
          <button
            className="btn"
            onClick={() => {
              const blob = new Blob([`Cryptool DocSign recovery key:\n\n${pendingRecoveryKey}\n\nKeep this safe. It is the only way to recover your encrypted documents if you lose your password.`], {
                type: 'text/plain'
              });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'docsign-recovery-key.txt';
              a.click();
            }}
          >
            Download
          </button>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I've saved my recovery key somewhere safe.
        </label>
        <button className="btn primary block mt" disabled={!ack} onClick={clearRecoveryKey}>
          Continue
        </button>
      </div>
    </div>
  );
}
