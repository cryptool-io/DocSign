const { DocCompany } = require('../models');
const { badRequest } = require('./http');

/**
 * Validate that a companyId (if given) belongs to the current owner, and return
 * a normalized value to store on a record. Null/absent means "no company"
 * (personal/default workspace) — every scoped entity keeps DocCompanyId nullable
 * so records created before companies existed still work.
 */
const resolveCompanyId = async (ownerId, companyId) => {
  if (!companyId) return null;
  const company = await DocCompany.findOne({ where: { id: companyId, OwnerId: ownerId, ArchivedAt: null } });
  if (company) return company.id;
  // A member of a shared workspace may also create/act within it.
  const { isCompanyMember } = require('./access');
  if (await isCompanyMember(ownerId, companyId)) return companyId;
  throw badRequest('Company not found.', 'bad_company');
};

/**
 * Build a WHERE fragment for list endpoints from ?companyId. Passing the literal
 * "none" filters to records with no company; a real id filters to that company;
 * absent means no company filter (show everything the owner has).
 */
const companyFilter = (query) => {
  const companyId = query.companyId;
  if (!companyId) return {};
  if (companyId === 'none') return { DocCompanyId: null };
  return { DocCompanyId: companyId };
};

module.exports = { resolveCompanyId, companyFilter };
