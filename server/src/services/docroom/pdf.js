const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const MAGIC_PDF = Buffer.from('%PDF-');

/** Cheap structural check before we hand a buffer to pdf-lib. */
const looksLikePdf = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length > 5 && buffer.subarray(0, 5).equals(MAGIC_PDF);

const load = (buffer) => PDFDocument.load(buffer, { updateMetadata: false });

const getPageCount = async (buffer) => {
  const pdf = await load(buffer);
  return pdf.getPageCount();
};

/**
 * Return the intrinsic size of every page. The field editor and stamper both
 * work in 0..1 fractional coordinates, and these dimensions convert them back
 * to absolute points.
 */
const getPageSizes = async (buffer) => {
  const pdf = await load(buffer);
  return pdf.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
};

/**
 * Draw a faint diagonal watermark across every page. Used when a share link has
 * Watermark enabled — typically the viewer's email, to discourage re-sharing.
 */
const applyWatermark = async (buffer, text) => {
  if (!text) return buffer;
  const pdf = await load(buffer);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const label = String(text).slice(0, 60);

  pdf.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const size = Math.max(14, Math.min(width, height) / 22);
    page.drawText(label, {
      x: width * 0.12,
      y: height * 0.45,
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      rotate: degrees(35),
      opacity: 0.18
    });
  });

  return Buffer.from(await pdf.save());
};

const FIELD_FONT = {};

/**
 * Burn each signer's completed fields into the PDF at their fractional
 * positions. `fields` items: { PageNumber, X, Y, Width, Height, Type, Value,
 * signatureImage? (PNG Buffer) }. Y is measured from the TOP of the page (screen
 * convention); pdf-lib measures from the bottom, so we flip it here.
 */
const stampFields = async (buffer, fields, { signatureImages = {} } = {}) => {
  const pdf = await load(buffer);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const field of fields) {
    const page = pages[field.PageNumber - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();

    const x = field.X * pw;
    const w = field.Width * pw;
    const h = field.Height * ph;
    // flip Y: fractional Y is distance from top of page.
    const yTop = field.Y * ph;
    const y = ph - yTop - h;

    if ((field.Type === 'signature' || field.Type === 'initials') && signatureImages[field.id]) {
      const png = await pdf.embedPng(signatureImages[field.id]);
      const scale = Math.min(w / png.width, h / png.height);
      const dw = png.width * scale;
      const dh = png.height * scale;
      page.drawImage(png, { x, y: y + (h - dh) / 2, width: dw, height: dh });
    } else {
      const value = String(field.Value ?? '');
      if (!value) continue;
      const fontSize = Math.max(8, Math.min(h * 0.7, 14));
      page.drawText(value, {
        x: x + 2,
        y: y + Math.max(2, (h - fontSize) / 2),
        size: fontSize,
        font: helv,
        color: rgb(0.05, 0.05, 0.2)
      });
    }
  }

  return Buffer.from(await pdf.save());
};

const line = (page, font, text, x, y, size, color = rgb(0.1, 0.1, 0.1)) => {
  page.drawText(String(text ?? ''), { x, y, size, font, color });
};

/**
 * Append a "Certificate of Completion" page: document hash, and each signer's
 * name, email, verified timestamp, IP, and the audit-chain head hash. This is
 * the human-readable face of the tamper-evident trail.
 */
const appendCertificate = async (buffer, cert) => {
  const pdf = await load(buffer);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595, 842]); // A4 portrait, points
  const left = 48;
  let y = 780;

  line(page, bold, 'Certificate of Completion', left, y, 20);
  y -= 12;
  page.drawLine({ start: { x: left, y }, end: { x: 547, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 28;

  line(page, bold, 'Document', left, y, 12);
  y -= 18;
  line(page, font, `Title:  ${cert.documentName || ''}`, left, y, 11);
  y -= 16;
  line(page, font, `Envelope ID:  ${cert.envelopeId}`, left, y, 11);
  y -= 16;
  line(page, font, `Original SHA-256:  ${cert.documentSha256}`, left, y, 9);
  y -= 16;
  if (cert.completedAt) {
    line(page, font, `Completed:  ${new Date(cert.completedAt).toISOString()}`, left, y, 11);
    y -= 16;
  }
  line(page, font, `Audit chain head:  ${cert.auditHeadHash || ''}`, left, y, 9);
  y -= 28;

  line(page, bold, 'Signers', left, y, 12);
  y -= 20;

  (cert.signers || []).forEach((s, i) => {
    if (y < 90) {
      y = 780;
      pdf.addPage([595, 842]);
    }
    line(page, bold, `${i + 1}. ${s.name}  <${s.email}>`, left, y, 11);
    y -= 15;
    line(page, font, `Status: ${s.status}${s.signedAt ? `  •  Signed: ${new Date(s.signedAt).toISOString()}` : ''}`, left + 12, y, 10, rgb(0.3, 0.3, 0.3));
    y -= 14;
    line(page, font, `Email verified: ${s.emailVerifiedAt ? new Date(s.emailVerifiedAt).toISOString() : 'no'}  •  IP: ${s.ipAddress || 'n/a'}`, left + 12, y, 10, rgb(0.3, 0.3, 0.3));
    y -= 22;
  });

  line(page, font, 'This certificate and its audit trail are cryptographically hash-chained; any', left, 70, 9, rgb(0.4, 0.4, 0.4));
  line(page, font, 'alteration to a recorded event invalidates every subsequent hash.', left, 58, 9, rgb(0.4, 0.4, 0.4));

  return Buffer.from(await pdf.save());
};

module.exports = {
  looksLikePdf,
  getPageCount,
  getPageSizes,
  applyWatermark,
  stampFields,
  appendCertificate
};
