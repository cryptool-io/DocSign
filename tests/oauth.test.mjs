/* OAuth email-connection mechanics + token vault. No server needed. */
import { makeOk, serverSrc } from './_harness.mjs';

export const name = 'oauth email mechanics';
export async function run() {
  const { ok, state } = makeOk();
  // Configure a fake Google app so isConfigured() is true.
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4400';

  const oauth = serverSrc('services/emailOAuth.js');
  const { encryptSecret, decryptSecret } = serverSrc('services/secretStore.js');

  const url = new URL(oauth.getAuthorizeUrl('google', { userId: 'u1', companyId: 'c1', provider: 'google' }));
  ok(url.origin + url.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', 'google authorize endpoint');
  ok(url.searchParams.get('redirect_uri') === 'http://localhost:4400/api/oauth/google/callback', 'redirect_uri correct');
  ok(url.searchParams.get('scope').includes('gmail.send'), 'gmail.send scope requested');
  ok(url.searchParams.get('access_type') === 'offline', 'offline access (refresh token)');
  const claims = oauth.readState(url.searchParams.get('state'));
  ok(claims.companyId === 'c1' && claims.userId === 'u1', 'signed state round-trips');
  let tampered = false;
  try { oauth.readState(url.searchParams.get('state') + 'x'); } catch { tampered = true; }
  ok(tampered, 'tampered state rejected');

  const raw = oauth.buildRawMime({ fromName: 'Acme', fromEmail: 'deals@acme.io', to: 'x@y.io', subject: 'Sign', html: '<p>hi</p>' });
  const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  ok(mime.includes('From: Acme <deals@acme.io>') && mime.includes('<p>hi</p>'), 'MIME From/body built');

  let captured = null;
  await oauth.sendViaConnection(
    { provider: 'google', refreshToken: 'RT', fromEmail: 'deals@acme.io', fromName: 'Acme' },
    { to: 's@x.io', subject: 'Please sign', html: '<p>go</p>' },
    { refreshAccessToken: async () => 'AT', sendViaGoogle: async (t, m) => { captured = { t, m }; } }
  );
  ok(captured && captured.t === 'AT' && captured.m.to === 's@x.io' && captured.m.fromEmail === 'deals@acme.io', 'send routes through provider with fresh token');

  const secret = encryptSecret('REFRESH-TOKEN');
  ok(secret !== 'REFRESH-TOKEN' && decryptSecret(secret) === 'REFRESH-TOKEN', 'token vault encrypts at rest + decrypts');

  return state;
}
