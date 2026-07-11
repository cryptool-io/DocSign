require('../config/env');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { asyncHandler } = require('../utils/http');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const BRANCH = process.env.DEPLOY_BRANCH || 'master';

// Verify the GitHub HMAC signature so ONLY GitHub (holding the shared secret)
// can trigger a deploy. Constant-time compare.
const validSignature = (req) => {
  if (!SECRET || !req.rawBody) return false;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = `sha256=${crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * GitHub push webhook → self-deploy. Acknowledges fast (webhooks time out), then
 * runs scripts/deploy.sh in a fully detached process so it survives the PM2
 * restart at the end of the script.
 */
exports.github = asyncHandler(async (req, res) => {
  if (!SECRET) return res.status(503).json({ error: 'Deploy webhook not configured (GITHUB_WEBHOOK_SECRET unset).' });
  if (!validSignature(req)) return res.status(401).json({ error: 'Invalid signature' });

  const event = req.headers['x-github-event'];
  if (event === 'ping') return res.json({ ok: true, pong: true });
  if (event !== 'push') return res.json({ ok: true, ignored: event });
  if (req.body?.ref !== `refs/heads/${BRANCH}`) return res.json({ ok: true, ignoredRef: req.body?.ref });

  const commit = String(req.body?.after || '').slice(0, 7);
  res.status(202).json({ ok: true, deploying: true, commit });

  const logDir = path.join(REPO_ROOT, 'server', 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const out = fs.openSync(path.join(logDir, 'deploy.log'), 'a');
  const child = spawn('bash', [path.join(REPO_ROOT, 'scripts', 'deploy.sh')], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env
  });
  child.unref();
  console.log(`[docsign] deploy triggered by push ${commit}`);
});
