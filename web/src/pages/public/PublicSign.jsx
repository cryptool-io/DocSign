import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Document, Page } from '../../lib/pdf.js';
import { decryptToBlob } from '../../lib/keystore.js';
import { keyFromHash } from '../../lib/linkkey.js';
import { Spinner } from '../../lib/ui.jsx';

const pub = axios.create({ baseURL: '/api' });

// The template (sender) sets the font per field; the signer just types into it.
const fontFamilyFor = (font) =>
  font === 'Times' ? 'Georgia, "Times New Roman", serif' : font === 'Courier' ? '"Courier New", monospace' : 'inherit';

export default function PublicSign() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [stage, setStage] = useState('loading'); // loading | otp | sign | done | declined
  const [otpSentTo, setOtpSentTo] = useState('');
  const [code, setCode] = useState('');
  const [signerToken, setSignerToken] = useState(null);
  const [fields, setFields] = useState([]);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [values, setValues] = useState({}); // fieldId -> value
  const [typedName, setTypedName] = useState('');
  const [sigMode, setSigMode] = useState('type'); // 'type' | 'draw'
  const [drawn, setDrawn] = useState(null); // PNG data URL of the hand-drawn signature
  const [initMode, setInitMode] = useState('type'); // 'type' | 'draw'
  const [typedInitials, setTypedInitials] = useState('');
  const [drawnInitials, setDrawnInitials] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Is the signature ready? Typed needs a name; drawn needs ink on the canvas.
  const sigReady = sigMode === 'draw' ? !!drawn : !!typedName.trim();
  const initialsReady = initMode === 'draw' ? !!drawnInitials : !!typedInitials.trim();
  // Only the CURRENT signer's fields (`mine`) drive the adopt controls; other
  // signers' fields are shown read-only for context.
  const hasSignatureFields = fields.some((f) => f.type === 'signature' && f.mine);
  const hasInitialsFields = fields.some((f) => f.type === 'initials' && f.mine);

  // Your required fields that are still empty (signature/initials handled by the
  // adopt controls). Recomputed live, so the red clears as you fill them.
  const missingIds = new Set(
    fields
      .filter((f) => {
        if (!f.mine || f.required === false) return false;
        if (['signature', 'initials'].includes(f.type)) return false;
        if (f.type === 'checkbox') return !values[f.id];
        return !(values[f.id] && String(values[f.id]).trim());
      })
      .map((f) => f.id)
  );

  // Required signature style set by the sender: 'draw' (must hand-draw), 'type'
  // (typed name only), or 'any'. Draw wins if fields disagree.
  const sigConstraint = fields
    .filter((f) => f.type === 'signature' && f.mine)
    .reduce((acc, f) => {
      const m = f.signatureMode || 'any';
      if (m === 'draw') return 'draw';
      if (m === 'type' && acc !== 'draw') return 'type';
      return acc;
    }, 'any');
  useEffect(() => {
    if (sigConstraint === 'draw' && sigMode !== 'draw') setSigMode('draw');
    if (sigConstraint === 'type' && sigMode !== 'type') setSigMode('type');
  }, [sigConstraint]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guided signing: the next of YOUR fields that still needs input, in reading
  // order — used by the "Next field" button to jump straight to it.
  const nextField =
    fields
      .filter((f) => f.mine)
      .filter((f) => {
        if (f.type === 'signature') return !sigReady;
        if (f.type === 'initials') return !initialsReady;
        if (f.type === 'checkbox') return f.required !== false && !values[f.id];
        return !(values[f.id] && String(values[f.id]).trim());
      })
      .sort((a, b) => a.pageNumber - b.pageNumber || a.y - b.y || a.x - b.x)[0] || null;

  const goToNext = () => {
    if (!nextField) return;
    const el = document.getElementById(`sf-${nextField.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = el.querySelector('input, textarea');
    if (input) setTimeout(() => input.focus(), 320);
  };

  const auth = (extra = {}) => ({ headers: { Authorization: `Bearer ${signerToken}`, ...extra } });

  useEffect(() => {
    pub
      .get(`/sign/${token}/meta`)
      .then((r) => {
        const d = r.data.data;
        setMeta(d);
        setTypedName(d.signer.name || '');
        // Suggest initials from the signer's name (e.g. "Ron Maria Zabel" -> "RMZ").
        setTypedInitials(
          String(d.signer.name || '')
            .split(/\s+/)
            .map((p) => p[0])
            .filter(Boolean)
            .join('')
            .toUpperCase()
            .slice(0, 6)
        );
        if (d.signer.status === 'signed') setStage('done');
        else if (['declined', 'voided'].includes(d.status)) setStage('declined');
        else if (d.requireVerification === false) startNoCode();
        // Logged into DocSign? Try to skip the code (server allows it if the
        // account email matches this signer); otherwise fall back to the code.
        else if (localStorage.getItem('docsign_access')) startNoCode();
        else setStage('otp');
      })
      .catch((e) => setError(e.response?.data?.error || 'This signing link is unavailable.'));
  }, [token]);

  // No-code path (link mode with verification off): jump straight to signing.
  const startNoCode = async () => {
    try {
      // Pass the app token so a logged-in matching signer can skip the code.
      const appToken = localStorage.getItem('docsign_access');
      const headers = appToken ? { 'X-App-Authorization': `Bearer ${appToken}` } : {};
      const { data } = await pub.post(`/sign/${token}/start`, {}, { headers });
      setSignerToken(data.data.signerToken);
    } catch {
      // Server still needs a code (not logged in / different email) → show OTP.
      setStage('otp');
      setError(null);
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
      // Prefill date fields with today's date; the signer can still edit them.
      const today = new Date().toLocaleDateString();
      setValues((v) => {
        const next = { ...v };
        f.data.data.forEach((fld) => {
          if (fld.mine && fld.type === 'date' && !next[fld.id]) next[fld.id] = today;
        });
        return next;
      });
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
    if (hasSignatureFields && sigMode === 'draw' && !drawn) return setError('Please draw your signature, or switch to Type.');
    if (hasSignatureFields && sigMode === 'type' && !typedName.trim()) return setError('Please type your full name to use as your signature.');
    if (hasInitialsFields && initMode === 'draw' && !drawnInitials) return setError('Please draw your initials, or switch to Type.');
    if (hasInitialsFields && initMode === 'type' && !typedInitials.trim()) return setError('Please enter your initials.');
    if (missingIds.size > 0) {
      setShowErrors(true);
      return setError(`Please complete the ${missingIds.size} required field${missingIds.size > 1 ? 's' : ''} highlighted in red.`);
    }
    setBusy(true);
    setError(null);
    try {
      // Signature + initials come from the adopt controls; everything else
      // (date, text, checkbox) is sent as an explicit per-field value.
      const valueFields = fields.filter((f) => f.mine && !['signature', 'initials'].includes(f.type));
      const payload = {
        consent: true,
        signatureType: sigMode === 'draw' ? 'drawn' : 'typed',
        signatureData: sigMode === 'draw' ? drawn : typedName,
        initialsType: initMode === 'draw' ? 'drawn' : 'typed',
        initialsData: initMode === 'draw' ? drawnInitials : typedInitials,
        // For an encrypted document, hand the server the key (from the link
        // fragment) once, over TLS, so it can decrypt-to-stamp. Never stored.
        documentKey: keyFromHash() || null,
        values: valueFields.map((f) => ({ fieldId: f.id, value: f.type === 'checkbox' ? (values[f.id] ? 'x' : '') : values[f.id] || '' }))
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
        <div style={{ marginTop: 16 }}>
          <a className="btn primary" href="/inbox">Back to DocSign</a>
        </div>
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

      <div className="card mb" style={{ textAlign: 'left' }}>
        {hasSignatureFields && (
        <>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Add your signature</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>Choose how to sign, then review the document below and complete the highlighted fields.</p>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          {sigConstraint !== 'draw' && (
            <button
              type="button"
              className={`btn ${sigMode === 'type' ? 'primary' : ''}`}
              onClick={() => setSigMode('type')}
            >
              Type signature
            </button>
          )}
          {sigConstraint !== 'type' && (
            <button
              type="button"
              className={`btn ${sigMode === 'draw' ? 'primary' : ''}`}
              onClick={() => setSigMode('draw')}
            >
              Draw signature
            </button>
          )}
        </div>
        {sigConstraint === 'draw' && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>This document requires a hand-drawn signature.</p>
        )}
        {sigConstraint === 'type' && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>This document requires your typed name as the signature.</p>
        )}

        {sigMode === 'type' ? (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Type your full name to use as your signature</label>
            <input className="input" value={typedName} onChange={(e) => setTypedName(e.target.value)} style={{ fontFamily: 'cursive', fontSize: 20 }} />
          </div>
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Draw your signature below (use your mouse, trackpad, or finger)</label>
            <SignaturePad onChange={setDrawn} />
          </div>
        )}
        </>
        )}

        {hasInitialsFields && (
          <div className="mt" style={{ borderTop: '1px solid var(--border, #eee)', paddingTop: 12 }}>
            <div className="flex" style={{ gap: 8, marginBottom: 10 }}>
              <button type="button" className={`btn sm ${initMode === 'type' ? 'primary' : ''}`} onClick={() => setInitMode('type')}>
                Type initials
              </button>
              <button type="button" className={`btn sm ${initMode === 'draw' ? 'primary' : ''}`} onClick={() => setInitMode('draw')}>
                Draw initials
              </button>
            </div>
            {initMode === 'type' ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Your initials</label>
                <input
                  className="input"
                  value={typedInitials}
                  onChange={(e) => setTypedInitials(e.target.value.slice(0, 6))}
                  style={{ fontFamily: 'cursive', fontSize: 18, maxWidth: 140 }}
                />
              </div>
            ) : (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Draw your initials</label>
                <SignaturePad onChange={setDrawnInitials} height={100} />
              </div>
            )}
          </div>
        )}

        <label className="checkbox mt">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I agree to sign this document electronically and that my electronic signature is legally binding.
        </label>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {nextField && (
        <button
          className="btn primary"
          onClick={goToNext}
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60, boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.25))' }}
        >
          Next field to sign →
        </button>
      )}

      {!pdfUrl ? (
        <Spinner center />
      ) : (
        <div style={{ textAlign: 'center' }}>
          {fields.some((f) => !f.mine) && (
            <div className="flex" style={{ gap: 16, justifyContent: 'flex-start', marginBottom: 10, fontSize: 12 }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px dashed var(--warn)', background: 'rgba(217,119,6,.08)', verticalAlign: 'middle', marginRight: 4 }} /> Your fields to fill</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #cbd5e1', background: 'rgba(100,116,139,.08)', verticalAlign: 'middle', marginRight: 4 }} /> Other signer’s fields</span>
            </div>
          )}
          <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="pdf-page-wrap pdf-stage">
                <Page pageNumber={i + 1} width={760} renderTextLayer={false} renderAnnotationLayer={false} />
                {fields
                  .filter((f) => f.pageNumber === i + 1)
                  .map((f) => {
                    const filled = !f.mine
                      ? !!f.value
                      : f.type === 'signature'
                      ? sigReady
                      : f.type === 'initials'
                      ? initialsReady
                      : f.type === 'checkbox'
                      ? values[f.id]
                      : !!values[f.id];
                    const isMissing = f.mine && showErrors && missingIds.has(f.id);
                    return (
                      <div
                        key={f.id}
                        id={`sf-${f.id}`}
                        className={`sign-field ${filled ? 'done' : ''} ${!f.mine ? 'readonly' : ''} ${isMissing ? 'missing' : ''}`}
                        style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, ...(f.mine ? {} : { cursor: 'default' }) }}
                        title={f.mine ? undefined : f.byName ? `Filled by ${f.byName}` : 'Filled by another signer'}
                      >
                        {!f.mine ? (
                          f.valueImage ? (
                            <img src={f.valueImage} alt="signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontSize: 12, fontFamily: f.type === 'signature' || f.type === 'initials' ? 'cursive' : 'inherit', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {f.type === 'checkbox' ? (f.value ? '☑' : '') : f.value || ''}
                            </span>
                          )
                        ) : f.type === 'signature' ? (
                          sigMode === 'draw' && drawn ? (
                            <img src={drawn} alt="signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontFamily: 'cursive', fontSize: 16 }}>{typedName || 'signature'}</span>
                          )
                        ) : f.type === 'initials' ? (
                          initMode === 'draw' && drawnInitials ? (
                            <img src={drawnInitials} alt="initials" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontFamily: 'cursive', fontSize: 14 }}>{typedInitials || 'initials'}</span>
                          )
                        ) : f.type === 'date' ? (
                          f.autoFill ? (
                            <span style={{ fontSize: 12 }} title="Auto-filled with the date you sign">{new Date().toLocaleDateString()}</span>
                          ) : (
                            <input
                              className="input"
                              style={{ padding: 2, height: '100%', fontSize: f.fontSize || 12, fontFamily: fontFamilyFor(f.font), textAlign: 'center', background: 'transparent', border: 'none' }}
                              value={values[f.id] || ''}
                              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                              title="Signing date — you can edit it"
                            />
                          )
                        ) : f.type === 'checkbox' ? (
                          <input type="checkbox" checked={!!values[f.id]} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked }))} />
                        ) : (
                          <input
                            className="input"
                            style={{
                              padding: 2,
                              height: '100%',
                              fontSize: f.fontSize || 12,
                              fontFamily: fontFamilyFor(f.font),
                              background: 'transparent',
                              border: 'none',
                              ...(isMissing ? { color: '#dc2626' } : {})
                            }}
                            value={values[f.id] || ''}
                            onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                            placeholder={isMissing ? `${f.label || 'text'} — required` : f.label || 'text'}
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

// A simple signature pad: draw with mouse/trackpad/finger, emit a transparent
// PNG data URL (dark strokes) on every change, or null when cleared.
function SignaturePad({ onChange, height = 160 }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    inked.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current) onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, border: '1px dashed var(--border, #bbb)', borderRadius: 8, touchAction: 'none', background: '#fff', cursor: 'crosshair' }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="mt">
        <button type="button" className="btn" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="public-center">
      <div className="card center-narrow">
        <div className="brand" style={{ padding: '0 0 12px' }}>
          <span>DocSign</span>
        </div>
        {children}
      </div>
    </div>
  );
}
