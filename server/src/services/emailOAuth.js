require('../config/env');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * OAuth email connections for Google (Gmail API) and Microsoft (Graph sendMail).
 *
 * Connecting a mailbox proves the user owns that address and gives us a refresh
 * token we exchange for short-lived access tokens to send "Please sign …" emails
 * FROM their address, through their own mailbox. Requires OAuth apps registered
 * by the operator (see DEPLOY / env vars) — this module is provider-agnostic and
 * inert until those client credentials are present.
 */

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:4400').replace(/\/+$/, '');
const STATE_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';

const PROVIDERS = {
  google: {
    label: 'Google',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // gmail.send to send; openid+email to learn which address was connected.
    scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    authExtra: { access_type: 'offline', prompt: 'consent' }
  },
  microsoft: {
    label: 'Microsoft',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email offline_access https://graph.microsoft.com/Mail.Send',
    authExtra: { prompt: 'consent' }
  }
};

const isSupported = (provider) => Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
const isConfigured = (provider) =>
  isSupported(provider) && Boolean(PROVIDERS[provider].clientId() && PROVIDERS[provider].clientSecret());

const redirectUri = (provider) => `${APP_BASE_URL}/api/oauth/${provider}/callback`;

/** Signed, short-lived state binding the flow to a user + company. */
const makeState = (payload) => jwt.sign(payload, STATE_SECRET, { expiresIn: '15m' });
const readState = (state) => jwt.verify(state, STATE_SECRET);

const getAuthorizeUrl = (provider, statePayload) => {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: p.scope,
    state: makeState(statePayload),
    ...p.authExtra
  });
  return `${p.authUrl}?${params.toString()}`;
};

const postForm = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OAuth token error: ${json.error_description || json.error || res.status}`);
  return json;
};

// Pull the account email out of the returned id_token (no extra userinfo call).
const emailFromIdToken = (idToken) => {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    return (payload.email || payload.preferred_username || payload.upn || '').toLowerCase() || null;
  } catch {
    return null;
  }
};

/** Exchange an authorization code for tokens + the connected account email. */
const exchangeCode = async (provider, code) => {
  const p = PROVIDERS[provider];
  const tokens = await postForm(p.tokenUrl, {
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider)
  });
  return {
    refreshToken: tokens.refresh_token || null,
    accessToken: tokens.access_token,
    scope: tokens.scope || p.scope,
    email: tokens.id_token ? emailFromIdToken(tokens.id_token) : null
  };
};

/** Trade a stored refresh token for a fresh access token. */
const refreshAccessToken = async (provider, refreshToken) => {
  const p = PROVIDERS[provider];
  const tokens = await postForm(p.tokenUrl, {
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  return tokens.access_token;
};

// Build an RFC-822 message and base64url-encode it (Gmail API wants raw MIME).
const buildRawMime = ({ fromName, fromEmail, to, subject, html, replyTo }) => {
  const boundary = `b_${crypto.randomBytes(8).toString('hex')}`;
  const headers = [
    `From: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: text/html; charset="UTF-8"`
  ]
    .filter(Boolean)
    .join('\r\n');
  const mime = `${headers}\r\n\r\n${html}`;
  return Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sendViaGoogle = async (accessToken, message) => {
  const raw = buildRawMime(message);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

const sendViaMicrosoft = async (accessToken, message) => {
  const body = {
    message: {
      subject: message.subject,
      body: { contentType: 'HTML', content: message.html },
      toRecipients: [{ emailAddress: { address: message.to } }],
      ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {})
    },
    saveToSentItems: true
  };
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok && res.status !== 202) throw new Error(`Graph send failed: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
};

/**
 * Send a message through a connected mailbox. `connection` = { provider,
 * refreshToken, fromEmail, fromName }. Refreshes the access token, then sends via
 * the provider API. Injected `deps` lets tests stub the provider calls.
 */
const sendViaConnection = async (connection, message, deps = {}) => {
  const provider = connection.provider;
  if (!isConfigured(provider)) throw new Error(`${provider} email is not configured on this server.`);
  const refresh = deps.refreshAccessToken || refreshAccessToken;
  const accessToken = await refresh(provider, connection.refreshToken);
  const full = { ...message, fromEmail: connection.fromEmail, fromName: connection.fromName };
  if (provider === 'google') return (deps.sendViaGoogle || sendViaGoogle)(accessToken, full);
  if (provider === 'microsoft') return (deps.sendViaMicrosoft || sendViaMicrosoft)(accessToken, full);
  throw new Error(`Unsupported provider ${provider}`);
};

module.exports = {
  PROVIDERS,
  isSupported,
  isConfigured,
  redirectUri,
  getAuthorizeUrl,
  makeState,
  readState,
  exchangeCode,
  refreshAccessToken,
  buildRawMime,
  sendViaGoogle,
  sendViaMicrosoft,
  sendViaConnection
};
