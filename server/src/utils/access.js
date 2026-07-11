const { Op } = require('sequelize');
const { DocCompany, DocCompanyMember } = require('../models');

// Workspace ids where the user is a MEMBER (not the owner).
const memberCompanyIds = async (userId) => {
  const rows = await DocCompanyMember.findAll({ where: { UserId: userId }, attributes: ['DocCompanyId'] });
  return rows.map((r) => r.DocCompanyId);
};

const isCompanyMember = async (userId, companyId) => {
  if (!companyId) return false;
  const n = await DocCompanyMember.count({ where: { UserId: userId, DocCompanyId: companyId } });
  return n > 0;
};

// True if the user owns OR is a member of the workspace (and it isn't archived).
const canAccessCompany = async (userId, companyId) => {
  if (!companyId) return false;
  const owned = await DocCompany.count({ where: { id: companyId, OwnerId: userId, ArchivedAt: null } });
  if (owned) return true;
  return isCompanyMember(userId, companyId);
};

/**
 * WHERE fragment for a LIST endpoint that respects both ownership and workspace
 * membership. Behavior:
 *  - ?companyId=<id>  → everything IN that workspace, if the user owns or is a
 *                       member of it (shared view); 403-ish empty otherwise.
 *  - ?companyId=none  → the user's personal (no-workspace) records only.
 *  - (absent)         → records the user owns, PLUS everything in workspaces they
 *                       are a member of.
 * Falls back to plain ownership when the user belongs to no shared workspaces, so
 * the single-user path is byte-identical to before.
 */
const listScope = async (userId, query = {}, ownerField = 'OwnerId') => {
  const companyId = query.companyId;
  if (companyId && companyId !== 'none') {
    if (await canAccessCompany(userId, companyId)) return { DocCompanyId: companyId };
    return { id: null }; // no access → match nothing
  }
  if (companyId === 'none') return { [ownerField]: userId, DocCompanyId: null };
  const memberIds = await memberCompanyIds(userId);
  if (memberIds.length === 0) return { [ownerField]: userId };
  return { [Op.or]: [{ [ownerField]: userId }, { DocCompanyId: { [Op.in]: memberIds } }] };
};

// Can this user read/act on a single record they've loaded? Owner always; else a
// member of the record's workspace.
const canAccessRecord = async (userId, record, ownerField = 'OwnerId') => {
  if (!record) return false;
  if (record[ownerField] === userId) return true;
  return isCompanyMember(userId, record.DocCompanyId);
};

module.exports = { memberCompanyIds, isCompanyMember, canAccessCompany, listScope, canAccessRecord };
