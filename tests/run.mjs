/* Test runner: boots the API (unless one is already running), runs every suite,
 * reports a combined pass/fail, and exits non-zero on any failure. */
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';
import { BASE, SERVER_DIR } from './_harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITES = ['crypto.test.mjs', 'oauth.test.mjs', 'journey.test.mjs', 'encryption.test.mjs', 'rooms-enc.test.mjs', 'sovereign.test.mjs', 'optional-fields.test.mjs'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isUp = async () => {
  try {
    return (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    return false;
  }
};

async function main() {
  let child = null;
  const logPath = path.join(here, '.server.out.log');
  process.env.DOCSIGN_TEST_LOG = logPath;

  if (!(await isUp())) {
    console.log('› booting server for tests…');
    const out = fs.openSync(logPath, 'w');
    child = spawn(process.execPath, ['src/app.js'], {
      cwd: SERVER_DIR,
      stdio: ['ignore', out, out],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' }
    });
    for (let i = 0; i < 40 && !(await isUp()); i += 1) await wait(500);
    if (!(await isUp())) {
      console.error('✗ server did not start. Log tail:\n' + fs.readFileSync(logPath, 'utf8').slice(-1500));
      if (child) child.kill();
      process.exit(1);
    }
  } else {
    console.log(`› using server already running at ${BASE}`);
  }

  let totalPass = 0;
  let totalFail = 0;
  const summary = [];
  for (const file of SUITES) {
    const mod = await import(pathToFileURL(path.join(here, file)).href);
    console.log(`\n■ ${mod.name}`);
    try {
      const { pass, fail } = await mod.run();
      totalPass += pass;
      totalFail += fail;
      summary.push(`${fail === 0 ? '✓' : '✗'} ${mod.name}: ${pass} passed${fail ? `, ${fail} failed` : ''}`);
    } catch (e) {
      totalFail += 1;
      summary.push(`✗ ${mod.name}: THREW ${e.message}`);
      console.error('  THREW', e);
    }
  }

  console.log('\n───────────── SUMMARY ─────────────');
  summary.forEach((s) => console.log('  ' + s));
  console.log(`\n  TOTAL: ${totalPass} passed, ${totalFail} failed`);

  if (child) child.kill();
  process.exit(totalFail ? 1 : 0);
}

main().catch((e) => {
  console.error('runner error', e);
  process.exit(1);
});
