const {
  DocRecipientGroup,
  DocRecipientGroupMember,
  DocRecipient,
  sequelize
} = require('../models');
const { asyncHandler, notFound, badRequest } = require('../utils/http');

// Confirm every recipientId in a member list belongs to this owner.
const assertOwnedRecipients = async (ownerId, memberList) => {
  const ids = [...new Set((memberList || []).map((m) => m.recipientId))];
  if (ids.length === 0) return;
  const found = await DocRecipient.count({ where: { id: ids, OwnerId: ownerId } });
  if (found !== ids.length) throw badRequest('One or more recipients do not exist.', 'bad_recipient');
};

const serialize = (group) => ({
  ...group.toJSON(),
  members: (group.Members || [])
    .sort((a, b) => a.SigningOrder - b.SigningOrder)
    .map((m) => ({
      recipientId: m.DocRecipientId,
      signerRole: m.SignerRole,
      signingOrder: m.SigningOrder,
      recipient: m.Recipient ? { id: m.Recipient.id, name: m.Recipient.Name, email: m.Recipient.Email } : null
    }))
});

const withMembers = (id, ownerId) =>
  DocRecipientGroup.findOne({
    where: { id, OwnerId: ownerId },
    include: [{ model: DocRecipientGroupMember, as: 'Members', include: [{ model: DocRecipient, as: 'Recipient' }] }]
  });

exports.list = asyncHandler(async (req, res) => {
  const where = { OwnerId: req.userId };
  if (req.query.projectId) where.DocProjectId = req.query.projectId;
  const groups = await DocRecipientGroup.findAll({
    where,
    include: [{ model: DocRecipientGroupMember, as: 'Members', include: [{ model: DocRecipient, as: 'Recipient' }] }],
    order: [['Name', 'ASC']]
  });
  res.json({ data: groups.map(serialize) });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, projectId, members } = req.body;
  await assertOwnedRecipients(req.userId, members);

  const group = await sequelize.transaction(async (t) => {
    const g = await DocRecipientGroup.create(
      { OwnerId: req.userId, DocProjectId: projectId || null, Name: name },
      { transaction: t }
    );
    if (members?.length) {
      await DocRecipientGroupMember.bulkCreate(
        members.map((m) => ({
          DocRecipientGroupId: g.id,
          DocRecipientId: m.recipientId,
          SignerRole: m.signerRole || null,
          SigningOrder: m.signingOrder || 1
        })),
        { transaction: t }
      );
    }
    return g;
  });

  res.status(201).json({ data: serialize(await withMembers(group.id, req.userId)) });
});

exports.update = asyncHandler(async (req, res) => {
  const group = await DocRecipientGroup.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!group) throw notFound('Group not found');
  const { name, members } = req.body;
  if (members) await assertOwnedRecipients(req.userId, members);

  await sequelize.transaction(async (t) => {
    if (name) await group.update({ Name: name }, { transaction: t });
    if (members) {
      // Replace membership wholesale — simpler and race-free vs diffing.
      await DocRecipientGroupMember.destroy({ where: { DocRecipientGroupId: group.id }, transaction: t });
      if (members.length) {
        await DocRecipientGroupMember.bulkCreate(
          members.map((m) => ({
            DocRecipientGroupId: group.id,
            DocRecipientId: m.recipientId,
            SignerRole: m.signerRole || null,
            SigningOrder: m.signingOrder || 1
          })),
          { transaction: t }
        );
      }
    }
  });

  res.json({ data: serialize(await withMembers(group.id, req.userId)) });
});

exports.remove = asyncHandler(async (req, res) => {
  const group = await DocRecipientGroup.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!group) throw notFound('Group not found');
  await group.destroy();
  res.json({ ok: true });
});
