const { DocRecipient } = require('../models');
const { asyncHandler, notFound, conflict } = require('../utils/http');
const { paginate, meta } = require('../utils/misc');
const { resolveCompanyId } = require('../utils/companyScope');
const { listScope } = require('../utils/access');

exports.list = asyncHandler(async (req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const where = { ...(await listScope(req.userId, req.query)), ArchivedAt: null };
  if (req.query.projectId) where.DocProjectId = req.query.projectId;

  const { rows, count } = await DocRecipient.findAndCountAll({
    where,
    // Favorites float to the top, then most-recently-used (updatedAt), then name.
    order: [
      ['Favorite', 'DESC'],
      ['updatedAt', 'DESC'],
      ['Name', 'ASC']
    ],
    limit,
    offset
  });
  res.json({ data: rows, meta: meta(count, { page, pageSize }) });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, email, company, title, projectId } = req.body;
  const existing = await DocRecipient.findOne({
    where: { OwnerId: req.userId, Email: email, ArchivedAt: null }
  });
  if (existing) throw conflict('You already have a recipient with that email.', 'recipient_exists');

  const recipient = await DocRecipient.create({
    OwnerId: req.userId,
    DocProjectId: projectId || null,
    DocCompanyId: await resolveCompanyId(req.userId, req.body.companyId),
    Name: name,
    Email: email,
    Company: company || null,
    Title: title || null
  });
  res.status(201).json({ data: recipient });
});

const findOwned = async (req) => {
  const r = await DocRecipient.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!r) throw notFound('Recipient not found');
  return r;
};

exports.update = asyncHandler(async (req, res) => {
  const recipient = await findOwned(req);
  const { name, email, company, title, projectId, favorite } = req.body;
  await recipient.update({
    Name: name ?? recipient.Name,
    Email: email ?? recipient.Email,
    Company: company === undefined ? recipient.Company : company,
    Title: title === undefined ? recipient.Title : title,
    DocProjectId: projectId === undefined ? recipient.DocProjectId : projectId,
    Favorite: favorite === undefined ? recipient.Favorite : favorite
  });
  res.json({ data: recipient });
});

exports.remove = asyncHandler(async (req, res) => {
  const recipient = await findOwned(req);
  await recipient.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});
