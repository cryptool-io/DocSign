const { DocProject, DocDocument, DocEnvelope, DocLink, sequelize } = require('../models');
const { asyncHandler, notFound, conflict } = require('../utils/http');
const { slugify, paginate, meta } = require('../utils/misc');
const { resolveCompanyId, companyFilter } = require('../utils/companyScope');

const ownScope = (req) => ({ OwnerId: req.userId });

exports.list = asyncHandler(async (req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const { rows, count } = await DocProject.findAndCountAll({
    where: { ...ownScope(req), ...companyFilter(req.query), ArchivedAt: null },
    order: [['updatedAt', 'DESC']],
    limit,
    offset
  });

  // Attach lightweight counts per project without N+1 round-trips.
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await DocDocument.findAll({
        attributes: ['DocProjectId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
        where: { DocProjectId: ids, ArchivedAt: null },
        group: ['DocProjectId'],
        raw: true
      })
    : [];
  const docCount = Object.fromEntries(counts.map((c) => [c.DocProjectId, Number(c.n)]));

  res.json({
    data: rows.map((p) => ({ ...p.toJSON(), documentCount: docCount[p.id] || 0 })),
    meta: meta(count, { page, pageSize })
  });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, description, logoUrl } = req.body;
  let slug = slugify(name);
  // Ensure per-owner uniqueness of the slug base.
  const clash = await DocProject.findOne({ where: { Slug: slug } });
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const project = await DocProject.create({
    Name: name,
    Slug: slug,
    Description: description || null,
    LogoUrl: logoUrl || null,
    OwnerId: req.userId,
    DocCompanyId: await resolveCompanyId(req.userId, req.body.companyId)
  });
  res.status(201).json({ data: project });
});

const findOwned = async (req) => {
  const project = await DocProject.findOne({ where: { id: req.params.id, ...ownScope(req) } });
  if (!project) throw notFound('Project not found');
  return project;
};

exports.get = asyncHandler(async (req, res) => {
  const project = await findOwned(req);
  const [documents, envelopes, links] = await Promise.all([
    DocDocument.count({ where: { DocProjectId: project.id, ArchivedAt: null } }),
    DocEnvelope.count({ where: { DocProjectId: project.id } }),
    DocLink.count({ where: { DocProjectId: project.id } })
  ]);
  res.json({ data: { ...project.toJSON(), stats: { documents, envelopes, links } } });
});

exports.update = asyncHandler(async (req, res) => {
  const project = await findOwned(req);
  const { name, description, logoUrl } = req.body;
  await project.update({
    Name: name ?? project.Name,
    Description: description === undefined ? project.Description : description,
    LogoUrl: logoUrl === undefined ? project.LogoUrl : logoUrl
  });
  res.json({ data: project });
});

exports.archive = asyncHandler(async (req, res) => {
  const project = await findOwned(req);
  await project.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});
