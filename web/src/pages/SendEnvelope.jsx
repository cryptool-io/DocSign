import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany } from '../lib/company.js';
import { useAuth } from '../lib/store.js';
import * as keystore from '../lib/keystore.js';
import { appendKey } from '../lib/linkkey.js';
import { Spinner, useToast } from '../lib/ui.jsx';
import FieldPlacer, { FIELD_TYPES, SIGNER_COLORS } from '../components/FieldPlacer.jsx';

/**
 * The compose flow: pick a project + document + template, choose the people who
 * must sign (and their order), then send. This is the heart of the app.
 */
export default function SendEnvelope() {
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();

  const [docs, setDocs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const { companies, activeId } = useCompany();
  const user = useAuth((s) => s.user);
  const [documentId, setDocumentId] = useState(loc.state?.documentId || '');
  const [templateId, setTemplateId] = useState('');
  const [companyId, setCompanyId] = useState(activeId || '');
  const [fromEmail, setFromEmail] = useState('');
  const [deliveryMode, setDeliveryMode] = useState('email');
  const [requireVerification, setRequireVerification] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState('parallel');
  const [signers, setSigners] = useState([{ name: '', email: '', signerRole: '', signingOrder: 1 }]);
  const [resultLinks, setResultLinks] = useState(null);

  // Inline field placement (DocuSign-style). Each field carries a signerEmail so
  // the backend binds it to the right person; falls back to template fields if
  // none are placed here.
  const [fields, setFields] = useState([]);
  const [activeType, setActiveType] = useState(null);
  const [activeSignerEmail, setActiveSignerEmail] = useState('');

  useEffect(() => {
    (async () => {
      const [d, t, r, g] = await Promise.all([
        api.get('/documents'),
        api.get('/templates'),
        api.get('/recipients'),
        api.get('/recipient-groups')
      ]);
      setDocs(d.data.data);
      setTemplates(t.data.data);
      setRecipients(r.data.data);
      setGroups(g.data.data);
      setLoading(false);
    })();
  }, []);

  // Apply the chosen DOCUMENT's own signing setup: its default saved setup (or the
  // only one). Signing setups are configured on the Documents page, so there's no
  // separate picker here — pick a document and its fields/roles load automatically.
  useEffect(() => {
    if (!documentId) {
      setTemplateId('');
      return;
    }
    const forDoc = templates.filter((t) => t.SourceDocumentId === documentId);
    const setup = forDoc.find((t) => t.IsDefault) || forDoc[0] || null;
    setTemplateId(setup ? setup.id : '');
  }, [documentId, templates]);

  // When a setup is applied, prefill its signer roles as blank signer rows.
  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl?.SignerRoles?.length) {
      setSigners(
        tpl.SignerRoles.sort((a, b) => a.order - b.order).map((r, i) => ({
          name: '',
          email: '',
          roleKey: r.key, // immutable binding key (fields carry the same key)
          signerRole: r.label || r.key, // editable display label
          signingOrder: i + 1
        }))
      );
      // Two or more signers default to signing in steps (one after another).
      if (tpl.SignerRoles.length > 1) setOrder('sequential');
    }
    if (tpl?.SourceDocumentId && !documentId) setDocumentId(tpl.SourceDocumentId);
    // Prefill the saved subject/message, but never clobber something typed.
    if (tpl?.DefaultSubject && !subject) setSubject(tpl.DefaultSubject);
    if (tpl?.DefaultMessage && !message) setMessage(tpl.DefaultMessage);
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the template's placed fields so the sender SEES them on the page (and
  // can tweak). Template fields are bound to signer ROLES; we resolve each to a
  // signer email in the effect below as the signer rows get filled in.
  useEffect(() => {
    if (!templateId) return;
    let dead = false;
    api
      .get(`/templates/${templateId}`)
      .then(({ data }) => {
        if (dead) return;
        setFields(
          (data.data.fields || []).map((f) => ({
            _id: Math.random().toString(36).slice(2),
            type: f.type,
            // Keep the role KEY for binding (matches the signer rows' roleKey),
            // independent of any editable label text.
            signerRole: f.signerRole || null,
            signerEmail: null,
            pageNumber: f.pageNumber,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            required: f.required !== false,
            autoFill: f.autoFill === true,
            fontSize: f.fontSize || null,
            font: f.font || null,
            signatureMode: f.signatureMode || null,
            label: f.label || ''
          }))
        );
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [templateId]);

  // Re-bind template fields (which carry a role KEY) to signer emails as the
  // signer rows are filled in — matched on the immutable roleKey, so editing a
  // signer's name or role label never mis-routes fields. Manual fields (no
  // signerRole) are left alone.
  useEffect(() => {
    const roleToEmail = {};
    signers.forEach((s) => {
      if (s.roleKey && s.email) roleToEmail[s.roleKey] = s.email;
    });
    setFields((cur) => {
      let changed = false;
      const next = cur.map((f) => {
        if (!f.signerRole) return f;
        const email = roleToEmail[f.signerRole] || null;
        if (email === f.signerEmail) return f;
        changed = true;
        return { ...f, signerEmail: email };
      });
      return changed ? next : cur;
    });
  }, [signers]);

  // How many placed fields each signer will fill — so it's obvious if someone
  // (e.g. a 2nd signer) ended up with none.
  const fieldsByEmail = fields.reduce((m, f) => {
    if (f.signerEmail) m[f.signerEmail] = (m[f.signerEmail] || 0) + 1;
    return m;
  }, {});

  // Signers with a usable email drive the placement palette + color coding.
  const placeableSigners = signers.filter((s) => s.email);
  const colorByEmail = useMemo(() => {
    const m = {};
    placeableSigners.forEach((s, i) => {
      m[s.email] = SIGNER_COLORS[i % SIGNER_COLORS.length];
    });
    return m;
  }, [signers]);
  // Unassigned fields go RED once the user has tried to send, so it's obvious
  // which ones still need a signer.
  const [showErrors, setShowErrors] = useState(false);
  const colorFor = (field) => colorByEmail[field.signerEmail] || (showErrors ? '#dc2626' : '#697280');

  // Keep the active placement signer valid as the signer list changes.
  useEffect(() => {
    if (!placeableSigners.some((s) => s.email === activeSignerEmail)) {
      setActiveSignerEmail(placeableSigners[0]?.email || '');
    }
  }, [signers]); // eslint-disable-line react-hooks/exhaustive-deps

  // An encrypted document must use link delivery: the server can't put the
  // decryption key into an email (it never has the key).
  const selectedDocument = docs.find((d) => d.id === documentId) || null;
  const docEncrypted = Boolean(selectedDocument?.Encrypted);
  useEffect(() => {
    if (docEncrypted && deliveryMode === 'email') setDeliveryMode('link');
  }, [docEncrypted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected company drives the send-as address list. A workspace can send from
  // any of its addresses (or an alias) as long as it has ONE connected mailbox to
  // send through — so email delivery is gated on "has a connected mailbox", not
  // on the specific chosen address.
  const selectedCompany = companies.find((c) => c.id === companyId) || null;
  const workspaceEmails = selectedCompany?.emails || [];
  const hasConnectedMailbox = workspaceEmails.some((e) => e.canSend);
  const noSendableMailbox = deliveryMode === 'email' && Boolean(companyId) && !hasConnectedMailbox;
  useEffect(() => {
    if (!selectedCompany) {
      setFromEmail('');
      return;
    }
    const pool = workspaceEmails.filter((e) => e.canSend);
    const def = (pool.length ? pool : workspaceEmails).find((e) => e.isDefault) || (pool.length ? pool : workspaceEmails)[0];
    setFromEmail(def ? def.email : '');
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live list of everything blocking a send, recomputed as the form changes so
  // the red checklist near the buttons clears itself as each item is fixed.
  const validSigners = signers.filter((s) => s.name && s.email);
  const validEmailSet = new Set(validSigners.map((s) => s.email));
  const orphanFieldCount = fields.filter((f) => !f.signerEmail || !validEmailSet.has(f.signerEmail)).length;
  const problems = useMemo(() => {
    const p = [];
    if (!documentId) p.push('Choose a document (step 1).');
    if (!subject.trim()) p.push('Add a subject (step 4 · Message).');
    if (validSigners.length === 0) p.push('Add at least one signer with both a name and an email (step 2).');
    if (orphanFieldCount > 0) {
      p.push(
        `${orphanFieldCount} placed field${orphanFieldCount > 1 ? 's are' : ' is'} not assigned to a signer — ` +
          'shown in red in step 3. Click each one and pick its signer, or fill in that signer’s email.'
      );
    }
    if (noSendableMailbox) p.push('This workspace has no connected mailbox for email delivery — connect one under Workspaces, or switch delivery to a share link (step 5).');
    return p;
  }, [documentId, subject, signers, fields, orphanFieldCount, noSendableMailbox]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show documents belonging to the chosen workspace (or all when none chosen).
  const filteredDocs = companyId ? docs.filter((d) => d.DocCompanyId === companyId) : docs;
  // Saved signing setups for the chosen document (you can pick which to apply).
  const docSetups = documentId ? templates.filter((t) => t.SourceDocumentId === documentId) : [];
  // Editing name/email means this is now a manual entry (not the picked
  // recipient), so drop the recipient link → the dropdown shows "Manual…".
  const setSigner = (i, k, v) =>
    setSigners((s) =>
      s.map((row, idx) => (idx === i ? { ...row, [k]: v, ...(k === 'name' || k === 'email' ? { recipientId: null } : {}) } : row))
    );

  // Save a manually-entered signer to the address book so they can be reused.
  const saveContact = async (i) => {
    const s = signers[i];
    if (!s.name || !s.email) return toast('Add a name and email first.', 'err');
    try {
      const { data } = await api.post('/recipients', { name: s.name, email: s.email, title: s.signerRole || null, companyId: companyId || null });
      setRecipients((r) => [...r, data.data]);
      setSigner(i, 'recipientId', data.data.id);
      toast('Saved to recipients');
    } catch (err) {
      toast(apiError(err).includes('already') ? 'Already in your recipients.' : apiError(err), err.response?.status === 409 ? undefined : 'err');
    }
  };
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
    // A draft can be incomplete; a real send must clear everything. Either way we
    // surface the misses as a persistent red checklist rather than a toast.
    const blockers = send
      ? problems
      : [
          !documentId && 'Choose a document (step 1).',
          !subject.trim() && 'Add a subject (step 4 · Message).',
          validSigners.length === 0 && 'Add at least one signer with a name and email (step 2).'
        ].filter(Boolean);
    if (blockers.length) {
      setShowErrors(true);
      toast(send ? 'Please fix the highlighted items before sending.' : 'Add a document, subject and signer to save a draft.', 'err');
      return;
    }
    const valid = validSigners;

    setSending(true);
    try {
      // Only send fields that are actually assigned to a current signer.
      const placedFields = fields
        .filter((f) => f.signerEmail && validEmailSet.has(f.signerEmail))
        .map((f) => ({
        type: f.type,
        signerEmail: f.signerEmail,
        pageNumber: f.pageNumber,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required !== false,
        autoFill: f.type === 'date' ? f.autoFill === true : false,
        fontSize: f.fontSize || null,
        font: f.font || null,
        signatureMode: f.signatureMode || null,
        label: f.label || null
      }));

      const { data } = await api.post('/envelopes', {
        documentId,
        templateId: templateId || null,
        companyId: companyId || null,
        fromEmail: fromEmail || null,
        deliveryMode,
        requireVerification: deliveryMode === 'link' ? requireVerification : true,
        subject,
        message: message || null,
        signingOrder: order,
        // Explicit fields win; if none are placed, the backend copies the template's.
        ...(placedFields.length ? { fields: placedFields } : {}),
        signers: valid.map((s) => ({
          recipientId: s.recipientId || null,
          name: s.name,
          email: s.email,
          signerRole: s.signerRole || null,
          signingOrder: Number(s.signingOrder) || 1
        }))
      });
      const envelopeId = data.data.id;
      if (!send) {
        toast('Saved as draft');
        return nav(`/envelopes/${envelopeId}`);
      }
      const sendRes = await api.post(`/envelopes/${envelopeId}/send`);
      if (deliveryMode === 'link') {
        // For an encrypted document, append the decryption key to each link.
        let links = sendRes.data.links || [];
        const selectedDoc = docs.find((d) => d.id === documentId);
        if (selectedDoc?.Encrypted && selectedDoc.WrappedDek) {
          const dekB64 = await keystore.documentKeyB64(selectedDoc.WrappedDek);
          links = links.map((l) => ({ ...l, url: appendKey(l.url, dekB64) }));
        }
        setResultLinks({ envelopeId, links });
        toast('Signing links ready');
      } else {
        toast('Sent for signature');
        nav(`/envelopes/${envelopeId}`);
      }
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSending(false);
    }
  };

  // Save the current field layout + signer roles as a reusable template, so the
  // sender doesn't have to place fields again next time.
  const saveAsTemplate = async () => {
    if (!documentId) return toast('Choose a document first.', 'err');
    if (fields.length === 0 && !subject.trim() && !message.trim()) {
      return toast('Add fields or a message to save a setup.', 'err');
    }
    const name = window.prompt('Name this template:', subject || 'Untitled template');
    if (!name) return;
    const makeDefault = window.confirm('Make this the default template for this workspace? (auto-selected next time)');
    // Map each placed field (bound to a signer email) onto a signer ROLE.
    const roleByEmail = {};
    const signerRoles = placeableSigners.map((s, i) => {
      const key = (s.signerRole && s.signerRole.trim()) || `signer${i + 1}`;
      roleByEmail[s.email] = key;
      return { key, label: s.name || s.signerRole || `Signer ${i + 1}`, order: i + 1 };
    });
    const tplFields = fields
      .filter((f) => roleByEmail[f.signerEmail])
      .map((f) => ({
        type: f.type,
        signerRole: roleByEmail[f.signerEmail],
        pageNumber: f.pageNumber,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required !== false,
        autoFill: f.type === 'date' ? f.autoFill === true : false,
        fontSize: f.fontSize || null,
        font: f.font || null,
        signatureMode: f.signatureMode || null,
        label: f.label || null
      }));
    setSending(true);
    try {
      await api.post('/templates', {
        name,
        companyId: companyId || null,
        sourceDocumentId: documentId,
        requiresSignature: tplFields.some((f) => f.type === 'signature' || f.type === 'initials'),
        signerRoles,
        fields: tplFields,
        defaultSubject: subject || null,
        defaultMessage: message || null,
        isDefault: makeDefault
      });
      const t = await api.get('/templates');
      setTemplates(t.data.data); // refresh the dropdown (don't select it — keep current signers/fields)
      toast(makeDefault ? 'Template saved as default' : 'Template saved');
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSending(false);
    }
  };

  // Send the exact same request to yourself so you can see how it looks and
  // confirm delivery (and, for a connected mailbox, the From address). Every
  // placed field is remapped to you so the signing page renders them.
  const sendTest = async () => {
    if (!documentId) return toast('Choose a document first.', 'err');
    if (!user?.email) return toast('No account email found to test with.', 'err');
    const testMode = docEncrypted ? 'link' : 'email';
    setSending(true);
    try {
      const placedFields = fields.map((f) => ({
        type: f.type,
        signerEmail: user.email,
        pageNumber: f.pageNumber,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required !== false,
        autoFill: f.type === 'date' ? f.autoFill === true : false,
        fontSize: f.fontSize || null,
        font: f.font || null,
        signatureMode: f.signatureMode || null,
        label: f.label || null
      }));
      const { data } = await api.post('/envelopes', {
        documentId,
        templateId: templateId || null,
        companyId: companyId || null,
        fromEmail: fromEmail || null,
        deliveryMode: testMode,
        requireVerification: testMode !== 'link',
        subject: `[TEST] ${subject.trim() || 'Signature request'}`,
        message: message || null,
        signingOrder: 'parallel',
        ...(placedFields.length ? { fields: placedFields } : {}),
        signers: [{ name: user.name || 'Test signer', email: user.email, signerRole: 'test', signingOrder: 1 }]
      });
      const envelopeId = data.data.id;
      const sendRes = await api.post(`/envelopes/${envelopeId}/send`);
      if (testMode === 'link') {
        let links = sendRes.data.links || [];
        const selectedDoc = docs.find((d) => d.id === documentId);
        if (selectedDoc?.Encrypted && selectedDoc.WrappedDek) {
          const dekB64 = await keystore.documentKeyB64(selectedDoc.WrappedDek);
          links = links.map((l) => ({ ...l, url: appendKey(l.url, dekB64) }));
        }
        setResultLinks({ envelopeId, links });
        toast('Test link ready');
      } else {
        toast(`Test sent to ${user.email}`);
      }
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner center />;

  // After a link-mode send: show the copyable per-signer links.
  if (resultLinks) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Signing links ready</h1>
            <p className="muted">No emails were sent. Copy each link and share it however you like.</p>
          </div>
          <button className="btn primary" onClick={() => nav(`/envelopes/${resultLinks.envelopeId}`)}>
            View envelope
          </button>
        </div>
        <div className="card">
          {resultLinks.links.map((l) => (
            <div key={l.signerId} className="field">
              <label>
                {l.name} · {l.email}
                {!l.active && <span className="badge amber" style={{ marginLeft: 8 }}>waits their turn</span>}
              </label>
              <div className="flex">
                <input className="input" readOnly value={l.url} onFocus={(e) => e.target.select()} />
                <button
                  className="btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(l.url);
                    toast('Copied');
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Send for signature</h1>
          <p className="muted">Select a workspace, document, and template, then choose who needs to sign.</p>
        </div>
      </div>

      <div className="card mb">
        <h2>1 · Document</h2>
        <div className="row">
          <div className="field">
            <label>Workspace</label>
            <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">No workspace (personal)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <label>Signing setup</label>
            {!documentId ? (
              <div className="input" style={{ display: 'flex', alignItems: 'center', minHeight: 40, background: 'var(--panel, #fafafa)' }}>
                <span className="muted">Choose a document first</span>
              </div>
            ) : docSetups.length > 0 ? (
              <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">No setup — place fields manually</option>
                {docSetups.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.Name}{t.IsDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="input" style={{ display: 'flex', alignItems: 'center', minHeight: 40, background: 'var(--panel, #fafafa)' }}>
                <span className="muted">
                  None yet — place fields below, or set one up under{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); nav('/documents'); }}>Documents</a>.
                </span>
              </div>
            )}
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
                      {r.Favorite ? '★ ' : ''}{r.Name} · {r.Email}
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
              <div className="field" style={{ marginBottom: 0, flex: 0.45 }}>
                {i === 0 && <label>Fields</label>}
                <div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }} title="How many fields this person signs">
                  {s.email ? (
                    <span className={`badge ${(fieldsByEmail[s.email] || 0) > 0 ? 'green' : 'amber'}`}>
                      {fieldsByEmail[s.email] || 0} field{(fieldsByEmail[s.email] || 0) === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>
              {order === 'sequential' && (
                <div className="field" style={{ marginBottom: 0, flex: 0.4 }}>
                  {i === 0 && <label>Order</label>}
                  <input className="input" type="number" min={1} value={s.signingOrder} onChange={(e) => setSigner(i, 'signingOrder', e.target.value)} />
                </div>
              )}
              {!s.recipientId && s.name && s.email && (
                <button className="btn sm" style={{ marginBottom: 0, whiteSpace: 'nowrap' }} title="Save this person to your recipients" onClick={() => saveContact(i)}>
                  💾 Save
                </button>
              )}
              <button
                className="btn sm danger"
                style={{ marginBottom: 0, flex: '0 0 auto', width: 38, height: 38, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}
                onClick={() => removeSigner(i)}
                disabled={signers.length === 1}
                title="Remove this signer"
              >
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
        <div className="flex between mb">
          <div>
            <h2 style={{ margin: 0 }}>3 · Place fields</h2>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Pick a signer and a field type, then click on the page to drop it. Drag to reposition.
            </p>
          </div>
          <div className="flex" style={{ gap: 8 }}>
            {fields.length > 0 && (
              <button className="btn sm" onClick={saveAsTemplate} disabled={sending}>
                💾 Save as template
              </button>
            )}
            {fields.length > 0 && (
              <button className="btn sm" onClick={() => setFields([])}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {!documentId ? (
          <div className="empty">Choose a document above.</div>
        ) : (
          <>
            {placeableSigners.length === 0 ? (
              <p className="badge amber" style={{ display: 'inline-block', marginBottom: 12 }}>
                Add a signer with an email above to place or assign fields.
                {fields.length > 0 && ' The template’s fields are shown below — they’ll bind to signers once you fill in emails.'}
              </p>
            ) : (
              <>
                <div className="flex" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                  <span className="muted">Signer:</span>
                  {placeableSigners.map((s) => (
                    <button
                      key={s.email}
                      className={`btn sm ${activeSignerEmail === s.email ? 'primary' : ''}`}
                      onClick={() => setActiveSignerEmail(s.email)}
                      style={{ borderLeft: `4px solid ${colorByEmail[s.email]}` }}
                    >
                      {s.name || s.email}
                    </button>
                  ))}
                </div>
                <div className="flex" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  <span className="muted">Field:</span>
                  {FIELD_TYPES.map((ft) => (
                    <button
                      key={ft.type}
                      className={`btn sm ${activeType === ft.type ? 'primary' : ''}`}
                      onClick={() => setActiveType(activeType === ft.type ? null : ft.type)}
                    >
                      {ft.label}
                    </button>
                  ))}
                  {activeType && <span className="badge blue">Click the page to place</span>}
                  <span className="muted" style={{ marginLeft: 'auto' }}>
                    {fields.length} field{fields.length === 1 ? '' : 's'} placed
                  </span>
                </div>
              </>
            )}

            <FieldPlacer
              documentId={documentId}
              doc={docs.find((d) => d.id === documentId)}
              fields={fields}
              setFields={setFields}
              activeType={activeType}
              setActiveType={setActiveType}
              activeSignerEmail={activeSignerEmail}
              signers={placeableSigners}
              colorFor={colorFor}
            />
          </>
        )}
      </div>

      <div className="card mb">
        <div className="flex between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>4 · Message</h2>
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            {docSetups.length > 0 && (
              <select
                className="select"
                style={{ minWidth: 220 }}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                title="Load a saved setup for this document"
              >
                <option value="">Use a saved setup…</option>
                {docSetups.map((t) => (
                  <option key={t.id} value={t.id}>{t.Name}{t.IsDefault ? ' (default)' : ''}</option>
                ))}
              </select>
            )}
            <button className="btn sm" onClick={saveAsTemplate} disabled={sending || !documentId} title="Save the fields, signer roles, subject and message as a reusable setup on this document">
              💾 Save as template
            </button>
          </div>
        </div>
        <div className="field mt">
          <label>Subject</label>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Please sign: Mutual NDA"
            style={showErrors && !subject.trim() ? { borderColor: '#dc2626' } : undefined}
          />
        </div>
        <div className="field">
          <label>Message (optional)</label>
          <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
      </div>

      <div className="card mb">
        <h2>5 · Delivery</h2>
        <div className="row">
          <div className="field">
            <label>How to deliver</label>
            <select className="select" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value)} disabled={docEncrypted}>
              {!docEncrypted && <option value="email">Email the signer a link</option>}
              <option value="link">Just give me a link to share</option>
            </select>
            {docEncrypted && (
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                This document is end-to-end encrypted, so it's shared by link (the key stays out of email).
              </p>
            )}
          </div>
          {selectedCompany && deliveryMode === 'email' && (
            <div className="field">
              <label>Send from</label>
              <input
                className="input"
                list="ws-from-emails"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="e.g. hello@yourdomain.com"
              />
              <datalist id="ws-from-emails">
                {workspaceEmails.map((e) => (
                  <option key={e.id} value={e.email}>
                    {e.canSend ? 'connected mailbox' : 'sent via connected mailbox'}
                  </option>
                ))}
              </datalist>
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Pick a saved address or type another on the same mailbox (e.g. <code>micky@…</code> or an alias like <code>hello@…</code>). It's sent through the workspace's connected mailbox.
              </p>
            </div>
          )}
        </div>
        {noSendableMailbox && (
          <p className="badge amber" style={{ display: 'inline-block' }}>
            No connected mailbox for this workspace. Connect Gmail/Outlook under Workspaces, or use a share link instead.
          </p>
        )}
        {deliveryMode === 'link' ? (
          <label className="checkbox">
            <input type="checkbox" checked={requireVerification} onChange={(e) => setRequireVerification(e.target.checked)} />
            Require an emailed code before they can sign (leave off for one-click signing)
          </label>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            The signer gets an email with a secure link and a one-time code to verify their identity.
          </p>
        )}
      </div>

      {showErrors && problems.length > 0 && (
        <div className="card mb" style={{ border: '1px solid #dc2626', background: '#fef2f2' }}>
          <div style={{ color: '#b91c1c', fontWeight: 700, marginBottom: 6 }}>
            {problems.length} thing{problems.length > 1 ? 's' : ''} to fix before you can send:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#b91c1c', lineHeight: 1.7 }}>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wrap-actions">
        <button className="btn primary" disabled={sending || noSendableMailbox} onClick={() => submit(true)}>
          {sending ? 'Working…' : deliveryMode === 'link' ? 'Create signing link' : 'Send for signature'}
        </button>
        <button className="btn" disabled={sending} onClick={() => submit(false)}>
          Save as draft
        </button>
        <button
          className="btn"
          disabled={sending || !documentId}
          onClick={sendTest}
          title={user?.email ? `Send a test copy to ${user.email}` : 'Send a test copy to yourself'}
        >
          🧪 Send test to me
        </button>
      </div>
    </>
  );
}
