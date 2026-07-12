const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { asyncHandler } = require('../utils/http');
const { User, DocDocument, DocEnvelope, sequelize } = require('../models');

const run = promisify(exec);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const sh = (cmd) => run(cmd, { cwd: REPO_ROOT, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });

/**
 * "Update from GitHub & restart" — the AMT-style self-deploy. Fetches, and only
 * hard-resets if the fetch succeeded (never resets to stale code), reinstalls,
 * rebuilds the web SPA, then asks PM2 to restart. A syntax precheck gates the
 * restart so a broken push can't take the process down.
 */
exports.selfUpdate = asyncHandler(async (req, res) => {
  const steps = [];
  const record = async (label, cmd) => {
    try {
      const { stdout } = await sh(cmd);
      steps.push({ label, ok: true, output: (stdout || '').trim().slice(-800) });
      return true;
    } catch (err) {
      steps.push({ label, ok: false, output: (err.stderr || err.message || '').slice(-800) });
      return false;
    }
  };

  const branch = process.env.DEPLOY_BRANCH || 'main';

  if (!(await record('git fetch', `git fetch origin ${branch}`))) {
    return res.status(500).json({ ok: false, steps, error: 'fetch failed — not touching working tree' });
  }
  await record('git reset', `git reset --hard origin/${branch}`);
  await record('npm install (server)', 'npm --prefix server install --omit=dev');
  await record('npm install (web)', 'npm --prefix web install');
  await record('build web', 'npm --prefix web run build');

  // Syntax precheck before we hand control to PM2 to restart.
  if (!(await record('syntax check', 'node --check server/src/app.js'))) {
    return res.status(500).json({ ok: false, steps, error: 'syntax check failed — restart aborted' });
  }

  // Restart is best-effort; if PM2 isn't managing us, this simply no-ops with an error step.
  await record('pm2 restart', 'pm2 restart docsign-server');

  res.json({ ok: true, steps });
});

/**
 * Platform-wide user list with per-user usage stats (admin only). Uses a few
 * grouped aggregate queries keyed by user id rather than counting per row, so
 * this stays O(1) queries regardless of user count.
 */
exports.listUsers = asyncHandler(async (_req, res) => {
  const users = await User.findAll({ order: [['createdAt', 'ASC']] });

  // Owned, non-archived documents grouped by owner.
  const docRows = await DocDocument.findAll({
    attributes: ['OwnerId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { ArchivedAt: null },
    group: ['OwnerId'],
    raw: true
  });

  // Envelopes sent (total) and completed, grouped by creator, in one pass.
  const envRows = await DocEnvelope.findAll({
    attributes: [
      'CreatedBy',
      [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
      [
        sequelize.fn(
          'SUM',
          sequelize.literal(`CASE WHEN "Status" = 'completed' THEN 1 ELSE 0 END`)
        ),
        'completed'
      ],
      [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastEnvelopeAt']
    ],
    group: ['CreatedBy'],
    raw: true
  });

  const docsByUser = new Map(docRows.map((r) => [r.OwnerId, Number(r.n)]));
  const envByUser = new Map(
    envRows.map((r) => [
      r.CreatedBy,
      { total: Number(r.total), completed: Number(r.completed || 0), lastEnvelopeAt: r.lastEnvelopeAt }
    ])
  );

  const data = users.map((u) => {
    const env = envByUser.get(u.id) || { total: 0, completed: 0, lastEnvelopeAt: null };
    const lastEnv = env.lastEnvelopeAt ? new Date(env.lastEnvelopeAt) : null;
    const updated = u.updatedAt ? new Date(u.updatedAt) : null;
    const lastActivity =
      lastEnv && updated ? new Date(Math.max(lastEnv.getTime(), updated.getTime())) : lastEnv || updated;
    return {
      id: u.id,
      name: u.Name,
      email: u.Email,
      role: u.Role,
      createdAt: u.createdAt,
      documents: docsByUser.get(u.id) || 0,
      envelopesSent: env.total,
      envelopesCompleted: env.completed,
      lastActivity: lastActivity ? lastActivity.toISOString() : null
    };
  });

  const totals = data.reduce(
    (acc, u) => {
      acc.documents += u.documents;
      acc.envelopesSent += u.envelopesSent;
      acc.envelopesCompleted += u.envelopesCompleted;
      return acc;
    },
    { users: data.length, documents: 0, envelopesSent: 0, envelopesCompleted: 0 }
  );

  res.json({ data, totals });
});

exports.version = asyncHandler(async (_req, res) => {
  let commit = null;
  try {
    const { stdout } = await sh('git rev-parse --short HEAD');
    commit = stdout.trim();
  } catch {
    /* not a git checkout */
  }
  res.json({ data: { commit, node: process.version, uptimeSeconds: Math.round(process.uptime()) } });
});
