const bcrypt = require('bcryptjs');
const { DocLink, DocDocument, DocViewSession, DocPageView, sequelize } = require('../models');
const storage = require('../services/docroom/storage');
const pdf = require('../services/docroom/pdf');
const { issueViewerToken, verifyViewerToken } = require('../services/docroom/tokens');
const { appendAuditEvent } = require('../services/docroom/hashChain');
const email = require('../services/email');
const { asyncHandler, notFound, forbidden, badRequest, unauthorized, clientIp } = require('../utils/http');

const loadUsableLink = async (token) => {
  const link = await DocLink.scope('withSecrets').findOne({ where: { Token: token } });
  if (!link) throw notFound('This link does not exist.');
  if (link.isRevoked()) throw forbidden('This link has been revoked.', 'revoked');
  if (link.isExpired()) throw forbidden('This link has expired.', 'expired');
  if (link.isExhausted()) throw forbidden('This link has reached its view limit.', 'exhausted');
  return link;
};

/** Public metadata so the viewer can render its gate (email / password prompts). */
exports.meta = asyncHandler(async (req, res) => {
  const link = await loadUsableLink(req.params.token);
  const doc = await DocDocument.findByPk(link.DocDocumentId);
  res.json({
    data: {
      name: link.Name || doc?.Name || 'Document',
      documentName: doc?.Name,
      pageCount: doc?.PageCount || 0,
      requireEmail: link.RequireEmail,
      requirePassword: Boolean(link.PasswordHash),
      allowDownload: link.AllowDownload
    }
  });
});

/**
 * Unlock the link: enforce the gate, open a view session, and issue a scoped
 * viewer token. Returns the token the SPA uses for the PDF + heartbeat calls.
 */
exports.open = asyncHandler(async (req, res) => {
  const link = await loadUsableLink(req.params.token);
  const { email: viewerEmail, password } = req.body;

  if (link.RequireEmail && !viewerEmail) throw badRequest('Email is required to view.', 'email_required');
  if (viewerEmail && !link.allowsEmail(viewerEmail)) {
    throw forbidden('This email is not on the allow list for this document.', 'email_not_allowed');
  }
  if (link.PasswordHash) {
    const ok = password && (await bcrypt.compare(password, link.PasswordHash));
    if (!ok) throw unauthorized('Incorrect password.', 'bad_password');
  }

  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || null;

  const session = await sequelize.transaction(async (t) => {
    const s = await DocViewSession.create(
      {
        DocLinkId: link.id,
        ViewerEmail: viewerEmail || null,
        IpAddress: ip,
        UserAgent: ua,
        Referrer: req.headers.referer || null
      },
      { transaction: t }
    );
    await link.increment('ViewCount', { transaction: t });
    await appendAuditEvent(
      {
        linkId: link.id,
        documentId: link.DocDocumentId,
        actorType: 'viewer',
        actorEmail: viewerEmail || null,
        eventType: 'link.viewed',
        metadata: { sessionId: s.id },
        ipAddress: ip,
        userAgent: ua
      },
      { transaction: t }
    );
    return s;
  });

  // Fire-and-forget owner notification.
  if (link.NotifyOnView) {
    DocDocument.findByPk(link.DocDocumentId)
      .then((doc) =>
        doc?.OwnerId
          ? sequelize.models.User.findByPk(doc.OwnerId).then((owner) =>
              owner
                ? email.linkViewedNotice({
                    to: owner.Email,
                    docName: doc.Name,
                    viewerEmail: viewerEmail || 'A visitor',
                    when: new Date().toUTCString()
                  })
                : null
            )
          : null
      )
      .catch((e) => console.error('[docsign] view-notify failed:', e.message));
  }

  const viewerToken = issueViewerToken({ linkId: link.id, sessionId: session.id, email: viewerEmail });
  res.json({ data: { viewerToken, sessionId: session.id, allowDownload: link.AllowDownload } });
});

// Pull the viewer token out of the Authorization header and validate it belongs
// to this link. Returns { link, payload }.
const authorizeViewer = async (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing viewer token.', 'no_viewer_token');
  let payload;
  try {
    payload = verifyViewerToken(token);
  } catch {
    throw unauthorized('Viewer session expired. Reload the page.', 'viewer_expired');
  }
  if (payload.linkId !== req.params.linkId) throw forbidden('Token/link mismatch.');
  const link = await loadUsableLink((await DocLink.findByPk(payload.linkId)).Token);
  return { link, payload };
};

/** Stream the PDF to an authorized viewer, watermarking on the fly if enabled. */
exports.file = asyncHandler(async (req, res) => {
  const { link, payload } = await authorizeViewer(req);
  const doc = await DocDocument.findByPk(link.DocDocumentId);
  if (!doc) throw notFound('Document not found.');
  let buffer = await storage.getObject(doc.FileKey);

  if (doc.Encrypted) {
    // Zero-knowledge: the server can't read the PDF, so it streams ciphertext and
    // the viewer decrypts + watermarks client-side using the key from the link.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Docsign-Encrypted', 'true');
    return res.send(buffer);
  }

  if (link.Watermark) {
    const mark = payload.email || `Confidential • ${new Date().toISOString().slice(0, 10)}`;
    buffer = await pdf.applyWatermark(buffer, mark);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.send(buffer);
});

/** Record a batch of per-page dwell times from the viewer heartbeat. */
exports.heartbeat = asyncHandler(async (req, res) => {
  const { payload } = await authorizeViewer(req);
  const { sessionId, pages } = req.body;
  if (sessionId !== payload.sessionId) throw forbidden('Session mismatch.');

  const session = await DocViewSession.findByPk(sessionId);
  if (!session || session.DocLinkId !== payload.linkId) throw notFound('Session not found.');

  await sequelize.transaction(async (t) => {
    for (const { page, seconds } of pages) {
      const [pv, created] = await DocPageView.findOrCreate({
        where: { DocViewSessionId: sessionId, PageNumber: page },
        defaults: { Seconds: seconds },
        transaction: t
      });
      // Heartbeats send cumulative seconds; keep the max so refreshes don't reset.
      if (!created && seconds > pv.Seconds) await pv.update({ Seconds: seconds }, { transaction: t });
    }
    const agg = await DocPageView.findAll({
      where: { DocViewSessionId: sessionId },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'pages'],
        [sequelize.fn('SUM', sequelize.col('Seconds')), 'total']
      ],
      raw: true,
      transaction: t
    });
    await session.update(
      {
        PagesViewed: Number(agg[0]?.pages || 0),
        TotalSeconds: Number(agg[0]?.total || 0),
        LastSeenAt: new Date()
      },
      { transaction: t }
    );
  });

  res.json({ ok: true });
});

exports.markDownloaded = asyncHandler(async (req, res) => {
  const { link, payload } = await authorizeViewer(req);
  if (!link.AllowDownload) throw forbidden('Download is disabled for this link.', 'download_disabled');
  const session = await DocViewSession.findByPk(payload.sessionId);
  if (session) await session.update({ Downloaded: true });
  await appendAuditEvent({
    linkId: link.id,
    documentId: link.DocDocumentId,
    actorType: 'viewer',
    actorEmail: payload.email || null,
    eventType: 'link.downloaded',
    metadata: { sessionId: payload.sessionId },
    ipAddress: clientIp(req),
    userAgent: req.headers['user-agent'] || null
  });
  res.json({ ok: true });
});
