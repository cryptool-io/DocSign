import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Document, Page } from '../../lib/pdf.js';
import { decryptToBlob } from '../../lib/keystore.js';
import { keyFromHash } from '../../lib/linkkey.js';
import { Spinner } from '../../lib/ui.jsx';

const pub = axios.create({ baseURL: '/api' });

export default function PublicSign() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState('loading'); // loading | otp | sign | done | declined
  const [otpSentTo, setOtpSentTo] = useState('');
  const [code, setCode] = useState('');
  const [signerToken, setSignerToken] = useState(null);
  const [fields, setFields] = useState([]);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [values, setValues] = useState({}); // fieldId -> value
  const [typedName, setTypedName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const auth = (extra = {}) => ({ headers: { Authorization: `Bearer ${signerToken}`, ...extra } });

  useEffect(() => {
    pub
      .get(`/sign/${token}/meta`)
      .then((r) => {
        const d = r.data.data;
        setMeta(d);
        setTypedName(d.signer.name || '');
        if (d.signer.status === 'signed') setStage('done');
        else if (['declined', 'voided'].includes(d.status)) setStage('declined');
        else if (d.requireVerification === false) startNoCode();
        else setStage('otp');
      })
      .catch((e) => setError(e.response?.data?.error || 'This signing link is unavailable.'));
  }, [token]);

  // No-code path (link mode with verification off): jump straight to signing.
  const startNoCode = async () => {
    try {
      const { data } = await pub.post(`/sign/${token}/start`);
      setSignerToken(data.data.signerToken);
    } catch (e) {
      // If the server actually requires a code, fall back to the OTP screen.
      setStage('otp');
      setError(e.response?.data?.error || null);
    }
  };

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await pub.post(`/sign/${token}/request-otp`);
      setOtpSentTo(data.email);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await pub.post(`/sign/${token}/verify-otp`, { code });
      setSignerToken(data.data.signerToken);
    } catch (err) {
      setError(err.response?.data?.error || 'Incorrect code.');
    } finally {
      setBusy(false);
    }
  };

  // Once verified, load fields + PDF (decrypting if the doc is encrypted).
  useEffect(() => {
    if (!signerToken) return;
    (async () => {
      const [f, file] = await Promise.all([
        pub.get(`/sign/${token}/fields`, auth()),
        pub.get(`/sign/${token}/file`, { ...auth(), responseType: 'arraybuffer' })
      ]);
      setFields(f.data.data);
      if (file.headers['x-docsign-encrypted'] === 'true') {
        const dekB64 = keyFromHash();
        if (!dekB64) return setError('This signing link is missing its decryption key.');
        setPdfUrl(URL.createObjectURL(await decryptToBlob(file.data, dekB64)));
      } else {
        setPdfUrl(URL.createObjectURL(new Blob([file.data], { type: 'application/pdf' })));
      }
      setStage('sign');
    })().catch(() => setError('Could not load the document.'));
  }, [signerToken]);

  const submit = async () => {
    if (!consent) return setError('Please agree to sign electronically.');
    setBusy(true);
    setError(null);
    try {
      const nonSigFields = fields.filter((f) => !['signature', 'initials', 'date'].includes(f.type));
      const payload = {
        consent: true,
        signatureType: 'typed',
        signatureData: typedName,
        // For an encrypted document, hand the server the key (from the link
        // fragment) once, over TLS, so it can decrypt-to-stamp. Never stored.
        documentKey: keyFromHash() || null,
        values: nonSigFields.map((f) => ({ fieldId: f.id, value: f.type === 'checkbox' ? (values[f.id] ? 'x' : '') : values[f.id] || '' }))
      };
      // If this browser is also logged into an app account, pass its token so the
      // completed doc is attributed to that user (even if the signing email differs).
      const appToken = localStorage.getItem('docsign_access');
      const headers = { ...auth().headers, ...(appToken ? { 'X-App-Authorization': `Bearer ${appToken}` } : {}) };
      const { data } = await pub.post(`/sign/${token}/submit`, payload, { headers });
      setStage('done');
      setMeta((m) => ({ ...m, status: data.data.status }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your signature.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!confirm('Decline to sign this document?')) return;
    await pub.post(`/sign/${token}/decline`, { reason: 'Declined by signer' }, auth());
    setStage('declined');
  };

  if (error && !meta) return <Shell><h1>Unavailable</h1><p className="muted">{error}</p></Shell>;
  if (!meta) return <Spinner center />;

  if (stage === 'done')
    return (
      <Shell>
        <h1>✓ All done</h1>
        <p className="muted">
          Thank you, {meta.signer.name}. Your signature has been recorded
          {meta.status === 'completed' ? ' and the document is now complete.' : '.'} You'll receive a copy by email.
        </p>
      </Shell>
    );

  if (stage === 'declined')
    return (
      <Shell>
        <h1>Declined</h1>
        <p className="muted">This document has been declined and can no longer be signed.</p>
      </Shell>
    );

  if (stage === 'otp')
    return (
      <Shell>
        <h1>{meta.subject}</h1>
        <p className="muted mb">
          {meta.documentName} · for {meta.signer.name}
        </p>
        {!meta.yourTurn ? (
          <p className="badge amber">It's not your turn to sign yet. You'll be emailed when it is.</p>
        ) : !otpSentTo ? (
          <>
            <p className="mb">To protect this document, we'll email you a one-time code to verify it's you.</p>
            <button className="btn primary block" disabled={busy} onClick={requestOtp}>
              {busy ? 'Sending…' : `Email my code`}
            </button>
          </>
        ) : (
          <form onSubmit={verifyOtp}>
            <p className="muted mb">We sent a 6-digit code to {otpSentTo}.</p>
            <div className="field">
              <input
                className="input"
                style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
              />
            </div>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <button className="btn primary block" disabled={busy || code.length !== 6}>
              Verify & open document
            </button>
            <button type="button" className="btn block mt" onClick={requestOtp}>
              Resend code
            </button>
          </form>
        )}
      </Shell>
    );

  // Signing stage.
  return (
    <div className="public-wrap">
      <div className="card mb flex between" style={{ position: 'sticky', top: 10, zIndex: 20 }}>
        <div>
          <strong>{meta.subject}</strong>
          <div className="muted">Complete the highlighted fields, then sign.</div>
        </div>
        <div className="wrap-actions">
          <button className="btn danger" onClick={decline}>
            Decline
          </button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Adopt & sign'}
          </button>
        </div>
      </div>

      <div className="card mb">
        <div className="row">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Type your full name to use as your signature</label>
            <input className="input" value={typedName} onChange={(e) => setTypedName(e.target.value)} style={{ fontFamily: 'cursive', fontSize: 20 }} />
          </div>
        </div>
        <label className="checkbox mt">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I agree to sign this document electronically and that my electronic signature is legally binding.
        </label>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {!pdfUrl ? (
        <Spinner center />
      ) : (
        <div style={{ textAlign: 'center' }}>
          <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="pdf-page-wrap pdf-stage">
                <Page pageNumber={i + 1} width={760} renderTextLayer={false} renderAnnotationLayer={false} />
                {fields
                  .filter((f) => f.pageNumber === i + 1)
                  .map((f) => {
                    const filled =
                      ['signature', 'initials'].includes(f.type)
                        ? !!typedName
                        : f.type === 'date'
                        ? true
                        : f.type === 'checkbox'
                        ? values[f.id]
                        : !!values[f.id];
                    return (
                      <div
                        key={f.id}
                        className={`sign-field ${filled ? 'done' : ''}`}
                        style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                      >
                        {f.type === 'signature' || f.type === 'initials' ? (
                          <span style={{ fontFamily: 'cursive', fontSize: 16 }}>{typedName || f.type}</span>
                        ) : f.type === 'date' ? (
                          new Date().toLocaleDateString()
                        ) : f.type === 'checkbox' ? (
                          <input type="checkbox" checked={!!values[f.id]} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked }))} />
                        ) : (
                          <input
                            className="input"
                            style={{ padding: 2, height: '100%', fontSize: 12 }}
                            value={values[f.id] || ''}
                            onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                            placeholder={f.label || 'text'}
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </Document>
        </div>
      )}
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="public-center">
      <div className="card center-narrow">
        <div className="brand" style={{ padding: '0 0 12px' }}>
          Cryptool <span>DocSign</span>
        </div>
        {children}
      </div>
    </div>
  );
}
