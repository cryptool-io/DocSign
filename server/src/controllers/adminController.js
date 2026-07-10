const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { asyncHandler } = require('../utils/http');

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
