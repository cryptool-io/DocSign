require('../config/env');
const { DocCompany, DocCompanyEmail, sequelize } = require('../models');
const oauth = require('../services/emailOAuth');
const { encryptSecret } = require('../services/secretStore');
const { asyncHandler, badRequest, notFound } = require('../utils/http');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:4400').replace(/\/+$/, '');

/** List which providers this server has OAuth apps configured for. */
exports.providers = asyncHandler(async (_req, res) => {
  res.json({
    data: Object.entries(oauth.PROVIDERS).map(([key, p]) => ({
      provider: key,
      label: p.label,
      configured: oauth.isConfigured(key)
    }))
  });
});

/** Begin connecting a mailbox: returns the provider authorize URL to redirect to. */
exports.authorize = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!oauth.isSupported(provider)) throw badRequest('Unknown provider.', 'bad_provider');
  if (!oauth.isConfigured(provider)) {
    throw badRequest(`${provider} sign-in isn't configured on this server yet.`, 'not_configured');
  }
  const company = await DocCompany.findOne({ where: { id: req.params.id, OwnerId: req.userId, ArchivedAt: null } });
  if (!company) throw notFound('Company not found');

  const url = oauth.getAuthorizeUrl(provider, { userId: req.userId, companyId: company.id, provider });
  res.json({ data: { url } });
});

/**
 * OAuth redirect target. Exchanges the code, stores the connected address +
 * encrypted refresh token, then bounces back to the app. State is a signed JWT,
 * so this public endpoint can't be driven with a forged company/user.
 */
exports.callback = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { code, state, error } = req.query;
  const back = (status) => res.redirect(`${APP_BASE_URL}/companies?connect=${status}`);

  if (error) return back(`error_${encodeURIComponent(String(error).slice(0, 40))}`);
  if (!code || !state || !oauth.isSupported(provider)) return back('error');

  let claims;
  try {
    claims = oauth.readState(state);
  } catch {
    return back('error_state');
  }
  if (claims.provider !== provider) return back('error_state');

  const company = await DocCompany.findOne({ where: { id: claims.companyId, OwnerId: claims.userId, ArchivedAt: null } });
  if (!company) return back('error_company');

  let tokens;
  try {
    tokens = await oauth.exchangeCode(provider, code);
  } catch {
    return back('error_exchange');
  }
  if (!tokens.email) return back('error_no_email');
  if (!tokens.refreshToken) return back('error_no_refresh'); // e.g. consent without offline access

  // Upsert the connected address for this company.
  await sequelize.transaction(async (t) => {
    const existing = await DocCompanyEmail.findOne({
      where: { DocCompanyId: company.id, Email: tokens.email },
      transaction: t
    });
    const hasDefault = await DocCompanyEmail.count({ where: { DocCompanyId: company.id, IsDefault: true }, transaction: t });
    const values = {
      Provider: provider,
      OAuthRefreshTokenEnc: encryptSecret(tokens.refreshToken),
      OAuthConnectedAt: new Date(),
      OAuthScope: tokens.scope,
      VerifiedAt: new Date()
    };
    if (existing) {
      await existing.update(values, { transaction: t });
    } else {
      await DocCompanyEmail.create(
        { DocCompanyId: company.id, Email: tokens.email, IsDefault: hasDefault === 0, ...values },
        { transaction: t }
      );
    }
  });

  return back('success');
});

/** Disconnect a mailbox (drops the token; the address stays but can't send). */
exports.disconnect = asyncHandler(async (req, res) => {
  const company = await DocCompany.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!company) throw notFound('Company not found');
  const email = await DocCompanyEmail.findOne({ where: { id: req.params.emailId, DocCompanyId: company.id } });
  if (!email) throw notFound('Email not found');
  await email.update({
    Provider: null,
    OAuthRefreshTokenEnc: null,
    OAuthConnectedAt: null,
    OAuthScope: null,
    VerifiedAt: null,
    SmtpHost: null,
    SmtpPort: null,
    SmtpSecure: null,
    SmtpUsername: null,
    SmtpPasswordEnc: null
  });
  res.json({ ok: true });
});
