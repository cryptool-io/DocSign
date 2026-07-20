require('dotenv').config();

const nodemailer = require('nodemailer');

const FROM_NAME = process.env.MAIL_FROM_NAME || 'Cryptool DocSign';
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'info@cryptool.io';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:4400').replace(/\/+$/, '');

// If MAIL_HOST is unset we run in dry-run: log the message instead of sending.
// Mirrors AMT's "blank sender => dry-run" behavior so local dev never needs SMTP.
const DRY_RUN = !process.env.MAIL_HOST;

// The system mailbox (SES/SMTP) can legitimately send FROM addresses on its own
// verified domain — e.g. info@cryptool.io through cryptool.io's SES. An address
// on a different domain (a personal Gmail, say) can't go out this way and needs
// its own OAuth-connected mailbox. Used to decide "sends via system mail" vs
// "must connect your own mailbox".
const SYSTEM_DOMAIN = (FROM_EMAIL.split('@')[1] || '').toLowerCase();
const systemCanSendFrom = (addr) => {
  if (DRY_RUN) return false;
  if (!addr) return true; // no explicit from-address → the system default sends it
  return (String(addr).split('@')[1] || '').toLowerCase() === SYSTEM_DOMAIN;
};

let transporter = null;
const getTransporter = () => {
  if (DRY_RUN) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587', 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth:
        process.env.MAIL_USER || process.env.MAIL_PASSWORD
          ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD }
          : undefined,
      pool: true
    });
  }
  return transporter;
};

// Signer names/emails are user-supplied, so escape them before they go into
// any HTML body.
const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// "16 Jul 2026, 12:55 UTC". Always UTC so every party — wherever they open the
// mail — reads the same timestamp as the certificate of completion.
const fmtSignedAt = (d) => {
  const t = d ? new Date(d) : null;
  if (!t || Number.isNaN(t.getTime())) return '—';
  const s = t.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${s} UTC`;
};

// `brand` = { name, logoUrl } of the sending workspace. The header shows the
// workspace's logo if it has one, else its name; falls back to the global brand.
const layout = (heading, bodyHtml, cta, brand = {}) => {
  const brandName = brand.name || FROM_NAME;
  const header = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brandName}" style="max-height:44px;max-width:200px;display:block" />`
    : `<span style="font-weight:700;font-size:18px">${brandName}</span>`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <div style="padding:20px 0;border-bottom:1px solid #eee">${header}</div>
    <div style="padding:24px 0">
      <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
      ${bodyHtml}
      ${
        cta
          ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">${cta.label}</a></p>
             <p style="font-size:12px;color:#666">If the button doesn't work, paste this link into your browser:<br><span style="color:#2563eb">${cta.url}</span></p>`
          : ''
      }
    </div>
    <div style="padding:16px 0;border-top:1px solid #eee;font-size:12px;color:#888">
      Sent by ${brandName}.${
        brand.contactEmail
          ? ` If you weren't expecting this, or have any questions, contact <a href="mailto:${brand.contactEmail}" style="color:#2563eb">${brand.contactEmail}</a>.`
          : " If you weren't expecting this, you can ignore it."
      }
    </div>
  </div>`;
};

const sendEmail = async ({ to, subject, html, text, fromName, fromEmail, replyTo, attachments }) => {
  // Per-send identity (company send-as) overrides the global default.
  const senderName = fromName || FROM_NAME;
  const senderEmail = fromEmail || FROM_EMAIL;
  const message = {
    from: `${senderName} <${senderEmail}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments && attachments.length ? { attachments } : {})
  };

  if (DRY_RUN) {
    console.log('\n[docsign email:dry-run] ---------------------------------');
    console.log(`  to:      ${to}`);
    console.log(`  subject: ${subject}`);
    console.log(`  text:    ${message.text.slice(0, 300)}`);
    console.log('---------------------------------------------------------\n');
    return { dryRun: true };
  }

  return getTransporter().sendMail(message);
};

/* ---- Per-connection SMTP (a client's own mailbox) ----------------------- */

// Build a one-off transport for a user-connected SMTP mailbox (app password).
const smtpTransport = ({ host, port, secure, user, pass }) =>
  nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: secure === true || secure === 'true' || parseInt(port, 10) === 465,
    auth: { user, pass }
  });

// Validate SMTP credentials without sending anything (connect + auth check).
const verifySmtp = async (config) => {
  await smtpTransport(config).verify();
  return { ok: true };
};

// Send a message THROUGH a client's own SMTP mailbox.
const sendViaSmtp = async (config, { to, subject, html, text, replyTo, attachments }) => {
  const from = `${config.fromName || FROM_NAME} <${config.fromEmail || config.user}>`;
  return smtpTransport(config).sendMail({
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments && attachments.length ? { attachments } : {})
  });
};

/* ---- Concrete templates ------------------------------------------------- */

const verifyEmail = ({ to, name, token }) =>
  sendEmail({
    to,
    subject: 'Verify your DocSign email',
    html: layout(
      `Welcome, ${name}`,
      '<p>Confirm your email address to start sending documents.</p>',
      { label: 'Verify email', url: `${APP_BASE_URL}/verify-email?token=${encodeURIComponent(token)}` }
    )
  });

const resetPassword = ({ to, name, token }) =>
  sendEmail({
    to,
    subject: 'Reset your DocSign password',
    html: layout(
      `Password reset`,
      `<p>Hi ${name}, we received a request to reset your password. This link expires in 1 hour.</p>`,
      { label: 'Reset password', url: `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}` }
    )
  });

const linkViewedNotice = ({ to, docName, viewerEmail, when }) =>
  sendEmail({
    to,
    subject: `Someone viewed "${docName}"`,
    html: layout(
      'Your document was viewed',
      `<p><strong>${viewerEmail || 'A visitor'}</strong> opened <strong>${docName}</strong> at ${when}.</p>`
    )
  });

// Shared HTML so the request can go via the global mailbox OR a connected one.
// `logoUrl` brands the email with the sending workspace's logo.
const signatureRequestHtml = ({ signerName, senderName, message, signUrl, logoUrl, contactEmail }) => {
  // Use the sender's custom note when provided; otherwise a single, professional
  // default. Never show both (that read as the same sentence twice).
  const body = message
    ? `<p>${message}</p>`
    : `<p><strong>${senderName}</strong> has sent you a document to review and sign.</p>`;
  return layout(
    `${senderName} requested your signature`,
    `<p>Hi ${signerName},</p>${body}<p>Use the secure button below to open, review, and sign the document. It only takes a moment.</p>`,
    { label: 'Review & sign', url: signUrl },
    { name: senderName, logoUrl, contactEmail }
  );
};

const signatureRequest = ({ to, signerName, senderName, fromEmail, replyTo, subject, message, signUrl, logoUrl }) =>
  sendEmail({
    to,
    fromName: senderName,
    fromEmail,
    replyTo,
    subject: subject || `${senderName} requested your signature`,
    html: signatureRequestHtml({ signerName, senderName, message, signUrl, logoUrl, contactEmail: replyTo })
  });

// Shared HTML so the code can go via the system mailbox OR a connected one, with
// the sending workspace's brand (logo + name).
const signerOtpHtml = (code, brand) =>
  layout(
    'Your verification code',
    `<p>Use this code to verify your identity and open the document:</p>
       <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
       <p style="font-size:13px;color:#666">This code expires in 10 minutes.</p>`,
    null,
    brand
  );

const signerOtp = ({ to, code, fromName, fromEmail, replyTo, logoUrl }) =>
  sendEmail({
    to,
    fromName,
    fromEmail,
    replyTo,
    subject: `Your signing verification code: ${code}`,
    html: signerOtpHtml(code, fromName || logoUrl ? { name: fromName, logoUrl, contactEmail: replyTo } : undefined)
  });

// Who signed, and when — in signing order. Mirrors the certificate of completion
// so the mail body alone identifies the parties without opening the PDF.
// `signers` = [{ name, email, signedAt }].
const signerListHtml = (signers = []) => {
  const list = (signers || []).filter((s) => s && (s.name || s.email));
  if (!list.length) return '';
  const rows = list
    .map(
      (s) => `
      <tr>
        <td style="padding:10px 16px 10px 0;border-top:1px solid #eee;vertical-align:top">
          <strong>${esc(s.name || s.email)}</strong>${
            s.name && s.email ? `<br><span style="color:#666;font-size:13px">${esc(s.email)}</span>` : ''
          }
        </td>
        <td style="padding:10px 0;border-top:1px solid #eee;vertical-align:top;color:#444;white-space:nowrap">${fmtSignedAt(
          s.signedAt
        )}</td>
      </tr>`
    )
    .join('');
  return `
    <p style="margin:24px 0 0;font-weight:600">Signed by</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:4px">${rows}</table>`;
};

const envelopeCompletedHtml = (hasAttachment, downloadUrl, brand, signers = []) =>
  layout(
    'All parties have signed',
    `<p>The document is fully executed${hasAttachment ? ', with the certificate of completion' : ''}. ${
      hasAttachment ? 'The signed PDF is attached to this email.' : 'A copy with the certificate of completion is available below.'
    }</p>${signerListHtml(signers)}`,
    downloadUrl ? { label: 'Download signed copy', url: downloadUrl } : null,
    brand
  );

const envelopeCompleted = ({ to, subject, downloadUrl, attachments, signers, fromName, fromEmail, replyTo, logoUrl }) =>
  sendEmail({
    to,
    fromName,
    fromEmail,
    replyTo,
    subject: subject || 'Document completed',
    html: envelopeCompletedHtml(
      Boolean(attachments && attachments.length),
      downloadUrl,
      fromName || logoUrl ? { name: fromName, logoUrl, contactEmail: replyTo } : undefined,
      signers
    ),
    attachments
  });

// Owner notification: a connected sending mailbox stopped working. Goes via the
// system mailbox (the workspace mailbox is exactly what's broken).
const mailboxDisconnected = ({ to, name, mailbox, workspace, reason }) =>
  sendEmail({
    to,
    subject: `Action needed: ${workspace ? `“${workspace}” — ` : ''}reconnect ${mailbox}`,
    html: layout(
      'A workspace mailbox stopped working',
      `<p>Hi ${name || 'there'},</p>
       <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
         <tr><td style="padding:4px 12px 4px 0;color:#666">Workspace</td><td><strong>${workspace || '—'}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Mailbox</td><td><strong>${mailbox}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Reason</td><td>${reason || 'the mailbox authorization is no longer valid'}</td></tr>
       </table>
       <p><strong>Emails from this workspace are paused until you reconnect it.</strong> We will never send them from another workspace's address, so nothing goes out under the wrong brand.</p>
       <p>Reconnect the mailbox to resume sending.</p>`,
      { label: 'Open Workspaces', url: `${APP_BASE_URL}/workspaces` }
    )
  });

module.exports = {
  DRY_RUN,
  SYSTEM_DOMAIN,
  systemCanSendFrom,
  verifySmtp,
  sendViaSmtp,
  APP_BASE_URL,
  sendEmail,
  verifyEmail,
  resetPassword,
  linkViewedNotice,
  signatureRequest,
  signatureRequestHtml,
  signerOtp,
  signerOtpHtml,
  envelopeCompleted,
  envelopeCompletedHtml,
  mailboxDisconnected
};
