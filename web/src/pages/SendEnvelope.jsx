import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { Spinner, useToast } from '../lib/ui.jsx';

/**
 * The compose flow: pick a project + document + template, choose the people who
 * must sign (and their order), then send. This is the heart of the app.
 */
export default function SendEnvelope() {
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();

  const [projects, setProjects] = useState([]);
  const [docs, setDocs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [projectId, setProjectId] = useState('');
  const [documentId, setDocumentId] = useState(loc.state?.documentId || '');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState('parallel');
  const [signers, setSigners] = useState([{ name: '', email: '', signerRole: '', signingOrder: 1 }]);

  useEffect(() => {
    (async () => {
      const [p, d, t, r, g] = await Promise.all([
        api.get('/projects'),
        api.get('/documents'),
        api.get('/templates'),
        api.get('/recipients'),
        api.get('/recipient-groups')
      ]);
      setProjects(p.data.data);
      setDocs(d.data.data);
      setTemplates(t.data.data);
      setRecipients(r.data.data);
      setGroups(g.data.data);
      setLoading(false);
    })();
  }, []);

  // When a template is chosen, prefill its signer roles as blank signer rows.
  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl?.SignerRoles?.length) {
      setSigners(
        tpl.SignerRoles.sort((a, b) => a.order - b.order).map((r, i) => ({
          name: '',
          email: '',
          signerRole: r.key,
          signingOrder: i + 1
        }))
      );
    }
    if (tpl?.SourceDocumentId && !documentId) setDocumentId(tpl.SourceDocumentId);
  }, [templateId]);

  const filteredDocs = projectId ? docs.filter((d) => d.DocProjectId === projectId) : docs;
  const setSigner = (i, k, v) => setSigners((s) => s.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const addSigner = () => setSigners((s) => [...s, { name: '', email: '', signerRole: '', signingOrder: s.length + 1 }]);
  const removeSigner = (i) => setSigners((s) => s.filter((_, idx) => idx !== i));

  const pickRecipient = (i, recipientId) => {
    const r = recipients.find((x) => x.id === recipientId);
    if (r) setSigners((s) => s.map((row, idx) => (idx === i ? { ...row, name: r.Name, email: r.Email, recipientId: r.id } : row)));
  };

  const applyGroup = (groupId) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    setSigners(
      g.members.map((m, i) => ({
        name: m.recipient?.name || '',
        email: m.recipient?.email || '',
        recipientId: m.recipientId,
        signerRole: m.signerRole || '',
        signingOrder: m.signingOrder || i + 1
      }))
    );
    if (g.members.some((m) => m.signingOrder > 1)) setOrder('sequential');
  };

  const submit = async (send) => {
    if (!documentId) return toast('Choose a document.', 'err');
    if (!subject.trim()) return toast('Add a subject.', 'err');
    const valid = signers.filter((s) => s.name && s.email);
    if (valid.length === 0) return toast('Add at least one signer with a name and email.', 'err');

    setSending(true);
    try {
      const { data } = await api.post('/envelopes', {
        documentId,
        templateId: templateId || null,
        projectId: projectId || null,
        subject,
        message: message || null,
        signingOrder: order,
        signers: valid.map((s) => ({
          recipientId: s.recipientId || null,
          name: s.name,
          email: s.email,
          signerRole: s.signerRole || null,
          signingOrder: Number(s.signingOrder) || 1
        }))
      });
      const envelopeId = data.data.id;
      if (send) {
        await api.post(`/envelopes/${envelopeId}/send`);
        toast('Sent for signature');
      } else {
        toast('Saved as draft');
      }
      nav(`/envelopes/${envelopeId}`);
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Send for signature</h1>
          <p className="muted">Select a document and template, then choose who needs to sign.</p>
        </div>
      </div>

      <div className="card mb">
        <h2>1 · Document</h2>
        <div className="row">
          <div className="field">
            <label>Project</label>
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.Name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Document</label>
            <select className="select" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">Choose a PDF…</option>
              {filteredDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.Name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Template (optional)</label>
            <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.Name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card mb">
        <div className="flex between">
          <h2 style={{ margin: 0 }}>2 · Signers</h2>
          {groups.length > 0 && (
            <select className="select" style={{ width: 220 }} defaultValue="" onChange={(e) => applyGroup(e.target.value)}>
              <option value="">Apply a saved group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.Name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mt">
          {signers.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
              <div className="field" style={{ marginBottom: 0, flex: 1.4 }}>
                {i === 0 && <label>From saved recipient</label>}
                <select className="select" value={s.recipientId || ''} onChange={(e) => pickRecipient(i, e.target.value)}>
                  <option value="">Manual…</option>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.Name} · {r.Email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                {i === 0 && <label>Name</label>}
                <input className="input" value={s.name} onChange={(e) => setSigner(i, 'name', e.target.value)} placeholder="Full name" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                {i === 0 && <label>Email</label>}
                <input className="input" type="email" value={s.email} onChange={(e) => setSigner(i, 'email', e.target.value)} placeholder="email@company.com" />
              </div>
              <div className="field" style={{ marginBottom: 0, flex: 0.7 }}>
                {i === 0 && <label>Role</label>}
                <input className="input" value={s.signerRole} onChange={(e) => setSigner(i, 'signerRole', e.target.value)} placeholder="e.g. investor" />
              </div>
              {order === 'sequential' && (
                <div className="field" style={{ marginBottom: 0, flex: 0.4 }}>
                  {i === 0 && <label>Order</label>}
                  <input className="input" type="number" min={1} value={s.signingOrder} onChange={(e) => setSigner(i, 'signingOrder', e.target.value)} />
                </div>
              )}
              <button className="btn sm danger" style={{ marginBottom: 0 }} onClick={() => removeSigner(i)} disabled={signers.length === 1}>
                ×
              </button>
            </div>
          ))}
          <div className="flex between mt">
            <button className="btn sm" onClick={addSigner}>
              + Add signer
            </button>
            <label className="checkbox" style={{ margin: 0 }}>
              <input type="checkbox" checked={order === 'sequential'} onChange={(e) => setOrder(e.target.checked ? 'sequential' : 'parallel')} />
              Sign in order (one after another)
            </label>
          </div>
        </div>
      </div>

      <div className="card mb">
        <h2>3 · Message</h2>
        <div className="field">
          <label>Subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Please sign: Mutual NDA" />
        </div>
        <div className="field">
          <label>Message (optional)</label>
          <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
      </div>

      <div className="wrap-actions">
        <button className="btn primary" disabled={sending} onClick={() => submit(true)}>
          {sending ? 'Sending…' : 'Send for signature'}
        </button>
        <button className="btn" disabled={sending} onClick={() => submit(false)}>
          Save as draft
        </button>
      </div>
    </>
  );
}
