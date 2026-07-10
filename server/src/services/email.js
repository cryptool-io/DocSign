require('dotenv').config();

const nodemailer = require('nodemailer');

const FROM_NAME = process.env.MAIL_FROM_NAME || 'Cryptool DocSign';
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'info@cryptool.io';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:4400').replace(/\/+$/, '');

// If MAIL_HOST is unset we run in dry-run: log the message instead of sending.
// Mirrors AMT's "blank sender => dry-run" behavior so local dev never needs SMTP.
const DRY_RUN = !process.env.MAIL_HOST;

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

const layout = (heading, bodyHtml, cta) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <div style="padding:20px 0;border-bottom:1px solid #eee;font-weight:700;font-size:18px">${FROM_NAME}</div>
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
      Sent by ${FROM_NAME}. If you weren't expecting this, you can ignore it.
    </div>
  </div>`;

const sendEmail = async ({ to, subject, html, text, fromName, fromEmail, replyTo }) => {
  // Per-send identity (company send-as) overrides the global default.
  const senderName = fromName || FROM_NAME;
  const senderEmail = fromEmail || FROM_EMAIL;
  const message = {
    from: `${senderName} <${senderEmail}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...(replyTo ? { replyTo } : {})
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

const signatureRequest = ({ to, signerName, senderName, fromEmail, replyTo, subject, message, signUrl }) =>
  sendEmail({
    to,
    fromName: senderName,
    fromEmail,
    replyTo,
    subject: subject || `${senderName} requested your signature`,
    html: layout(
      `${senderName} requested your signature`,
      `<p>Hi ${signerName},</p>${message ? `<p>${message}</p>` : ''}<p>Please review and sign the document.</p>`,
      { label: 'Review & sign', url: signUrl }
    )
  });

const signerOtp = ({ to, code }) =>
  sendEmail({
    to,
    subject: `Your signing verification code: ${code}`,
    html: layout(
      'Your verification code',
      `<p>Use this code to verify your identity and open the document:</p>
       <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
       <p style="font-size:13px;color:#666">This code expires in 10 minutes.</p>`
    )
  });

const envelopeCompleted = ({ to, subject, downloadUrl }) =>
  sendEmail({
    to,
    subject: subject || 'Document completed',
    html: layout(
      'All parties have signed',
      '<p>The document is fully executed. A copy with the certificate of completion is available below.</p>',
      downloadUrl ? { label: 'Download signed copy', url: downloadUrl } : null
    )
  });

module.exports = {
  DRY_RUN,
  APP_BASE_URL,
  sendEmail,
  verifyEmail,
  resetPassword,
  linkViewedNotice,
  signatureRequest,
  signerOtp,
  envelopeCompleted
};
