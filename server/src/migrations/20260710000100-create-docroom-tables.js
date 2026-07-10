'use strict';

const uuidPk = (Sequelize) => ({
  type: Sequelize.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: Sequelize.literal('uuid_generate_v4()')
});

const timestamps = (Sequelize) => ({
  createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
});

const userRef = (Sequelize, allowNull = false) => ({
  type: Sequelize.UUID,
  allowNull,
  references: { model: 'Users', key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: 'CASCADE'
});

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };

      await queryInterface.createTable('DocProjects', {
        id: uuidPk(Sequelize),
        Name: { type: Sequelize.STRING, allowNull: false },
        Slug: { type: Sequelize.STRING, allowNull: false, unique: true },
        Description: { type: Sequelize.TEXT, allowNull: true },
        LogoUrl: { type: Sequelize.STRING, allowNull: true },
        OwnerId: userRef(Sequelize),
        ArchivedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.createTable('DocDocuments', {
        id: uuidPk(Sequelize),
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        OwnerId: userRef(Sequelize),
        Name: { type: Sequelize.STRING, allowNull: false },
        StorageDriver: { type: Sequelize.STRING, allowNull: false, defaultValue: 's3' },
        FileKey: { type: Sequelize.STRING, allowNull: false },
        MimeType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'application/pdf' },
        SizeBytes: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        PageCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        // Content hash pinned at upload. Referenced by the audit trail so a signed
        // document can be proven byte-identical to what the signer saw.
        Sha256: { type: Sequelize.STRING(64), allowNull: false },
        Version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        ParentDocumentId: { type: Sequelize.UUID, allowNull: true },
        ArchivedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addConstraint('DocDocuments', {
        fields: ['ParentDocumentId'],
        type: 'foreign key',
        name: 'DocDocuments_ParentDocumentId_fkey',
        references: { table: 'DocDocuments', field: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        transaction: t
      });

      await queryInterface.createTable('DocTemplates', {
        id: uuidPk(Sequelize),
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        SourceDocumentId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocDocuments', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        OwnerId: userRef(Sequelize),
        Name: { type: Sequelize.STRING, allowNull: false },
        Description: { type: Sequelize.TEXT, allowNull: true },
        RequiresSignature: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        // [{ key, label, order }] - placeholder roles that get bound to real people at send time.
        SignerRoles: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        DefaultLinkSettings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        ArchivedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.createTable('DocRecipients', {
        id: uuidPk(Sequelize),
        OwnerId: userRef(Sequelize),
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        Name: { type: Sequelize.STRING, allowNull: false },
        Email: { type: Sequelize.STRING, allowNull: false },
        Company: { type: Sequelize.STRING, allowNull: true },
        Title: { type: Sequelize.STRING, allowNull: true },
        ArchivedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocRecipients', ['OwnerId', 'Email'], {
        unique: true,
        name: 'DocRecipients_OwnerId_Email_unique',
        transaction: t
      });

      await queryInterface.createTable('DocRecipientGroups', {
        id: uuidPk(Sequelize),
        OwnerId: userRef(Sequelize),
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        Name: { type: Sequelize.STRING, allowNull: false },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.createTable('DocRecipientGroupMembers', {
        id: uuidPk(Sequelize),
        DocRecipientGroupId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocRecipientGroups', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocRecipientId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocRecipients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        SignerRole: { type: Sequelize.STRING, allowNull: true },
        SigningOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocRecipientGroupMembers', ['DocRecipientGroupId', 'DocRecipientId'], {
        unique: true,
        name: 'DocRecipientGroupMembers_Group_Recipient_unique',
        transaction: t
      });

      await queryInterface.createTable('DocLinks', {
        id: uuidPk(Sequelize),
        DocDocumentId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocDocuments', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        DocRecipientId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocRecipients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        CreatedBy: userRef(Sequelize),
        Token: { type: Sequelize.STRING, allowNull: false, unique: true },
        Name: { type: Sequelize.STRING, allowNull: true },
        RequireEmail: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        PasswordHash: { type: Sequelize.STRING, allowNull: true },
        AllowDownload: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        Watermark: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        // Emails or @domain entries. Empty array means anyone with the link.
        AllowedEmails: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        NotifyOnView: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        ExpiresAt: { type: Sequelize.DATE, allowNull: true },
        MaxViews: { type: Sequelize.INTEGER, allowNull: true },
        ViewCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        RevokedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.createTable('DocViewSessions', {
        id: uuidPk(Sequelize),
        DocLinkId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocLinks', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        ViewerEmail: { type: Sequelize.STRING, allowNull: true },
        IpAddress: { type: Sequelize.STRING(45), allowNull: true },
        UserAgent: { type: Sequelize.TEXT, allowNull: true },
        Country: { type: Sequelize.STRING, allowNull: true },
        City: { type: Sequelize.STRING, allowNull: true },
        Referrer: { type: Sequelize.TEXT, allowNull: true },
        StartedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        LastSeenAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        TotalSeconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        PagesViewed: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        Downloaded: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocViewSessions', ['DocLinkId'], {
        name: 'DocViewSessions_DocLinkId_idx',
        transaction: t
      });

      await queryInterface.createTable('DocPageViews', {
        id: uuidPk(Sequelize),
        DocViewSessionId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocViewSessions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        PageNumber: { type: Sequelize.INTEGER, allowNull: false },
        Seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        FirstViewedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        LastViewedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocPageViews', ['DocViewSessionId', 'PageNumber'], {
        unique: true,
        name: 'DocPageViews_Session_Page_unique',
        transaction: t
      });

      await queryInterface.createTable('DocEnvelopes', {
        id: uuidPk(Sequelize),
        DocDocumentId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocDocuments', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT'
        },
        DocProjectId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocProjects', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        DocTemplateId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocTemplates', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        CreatedBy: userRef(Sequelize),
        Subject: { type: Sequelize.STRING, allowNull: false },
        Message: { type: Sequelize.TEXT, allowNull: true },
        Status: {
          type: Sequelize.ENUM('draft', 'sent', 'partially_signed', 'completed', 'declined', 'voided', 'expired'),
          allowNull: false,
          defaultValue: 'draft'
        },
        SigningOrder: {
          type: Sequelize.ENUM('sequential', 'parallel'),
          allowNull: false,
          defaultValue: 'parallel'
        },
        ExpiresAt: { type: Sequelize.DATE, allowNull: true },
        SentAt: { type: Sequelize.DATE, allowNull: true },
        CompletedAt: { type: Sequelize.DATE, allowNull: true },
        CompletedFileKey: { type: Sequelize.STRING, allowNull: true },
        CompletedSha256: { type: Sequelize.STRING(64), allowNull: true },
        VoidedAt: { type: Sequelize.DATE, allowNull: true },
        VoidReason: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.createTable('DocEnvelopeSigners', {
        id: uuidPk(Sequelize),
        DocEnvelopeId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'DocEnvelopes', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocRecipientId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocRecipients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        Name: { type: Sequelize.STRING, allowNull: false },
        Email: { type: Sequelize.STRING, allowNull: false },
        SignerRole: { type: Sequelize.STRING, allowNull: true },
        SigningOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        AccessToken: { type: Sequelize.STRING, allowNull: false, unique: true },
        Status: {
          type: Sequelize.ENUM('pending', 'viewed', 'signed', 'declined'),
          allowNull: false,
          defaultValue: 'pending'
        },
        // Emailed one-time code. Proving control of the mailbox is what carries the
        // ESIGN/eIDAS "identifiable signatory" requirement for a simple e-signature.
        OtpCodeHash: { type: Sequelize.STRING, allowNull: true },
        OtpExpiresAt: { type: Sequelize.DATE, allowNull: true },
        OtpAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        EmailVerifiedAt: { type: Sequelize.DATE, allowNull: true },
        SignatureType: { type: Sequelize.ENUM('typed', 'drawn'), allowNull: true },
        SignatureImageKey: { type: Sequelize.STRING, allowNull: true },
        ConsentedAt: { type: Sequelize.DATE, allowNull: true },
        ViewedAt: { type: Sequelize.DATE, allowNull: true },
        SignedAt: { type: Sequelize.DATE, allowNull: true },
        DeclinedAt: { type: Sequelize.DATE, allowNull: true },
        DeclineReason: { type: Sequelize.TEXT, allowNull: true },
        IpAddress: { type: Sequelize.STRING(45), allowNull: true },
        UserAgent: { type: Sequelize.TEXT, allowNull: true },
        NotifiedAt: { type: Sequelize.DATE, allowNull: true },
        RemindedAt: { type: Sequelize.DATE, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocEnvelopeSigners', ['DocEnvelopeId', 'SigningOrder'], {
        name: 'DocEnvelopeSigners_Envelope_Order_idx',
        transaction: t
      });

      await queryInterface.createTable('DocSignatureFields', {
        id: uuidPk(Sequelize),
        // A field belongs to a template (unbound, addressed by SignerRole) or to a
        // live envelope (bound, addressed by DocEnvelopeSignerId). Never both.
        DocTemplateId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocTemplates', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocEnvelopeId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocEnvelopes', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocEnvelopeSignerId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocEnvelopeSigners', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        SignerRole: { type: Sequelize.STRING, allowNull: true },
        Type: {
          type: Sequelize.ENUM('signature', 'initials', 'date', 'text', 'checkbox'),
          allowNull: false
        },
        PageNumber: { type: Sequelize.INTEGER, allowNull: false },
        // Fractions of page width/height (0..1) so the layout survives any render scale.
        X: { type: Sequelize.FLOAT, allowNull: false },
        Y: { type: Sequelize.FLOAT, allowNull: false },
        Width: { type: Sequelize.FLOAT, allowNull: false },
        Height: { type: Sequelize.FLOAT, allowNull: false },
        Required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        Label: { type: Sequelize.STRING, allowNull: true },
        Value: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.sequelize.query(
        `ALTER TABLE "DocSignatureFields"
           ADD CONSTRAINT "DocSignatureFields_template_xor_envelope"
           CHECK (("DocTemplateId" IS NULL) <> ("DocEnvelopeId" IS NULL));`,
        opts
      );

      await queryInterface.createTable('DocAuditEvents', {
        id: uuidPk(Sequelize),
        DocEnvelopeId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocEnvelopes', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocLinkId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocLinks', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        DocDocumentId: { type: Sequelize.UUID, allowNull: true },
        Sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        ActorType: {
          type: Sequelize.ENUM('owner', 'signer', 'viewer', 'system'),
          allowNull: false,
          defaultValue: 'system'
        },
        ActorId: { type: Sequelize.UUID, allowNull: true },
        ActorEmail: { type: Sequelize.STRING, allowNull: true },
        EventType: { type: Sequelize.STRING, allowNull: false },
        Metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        IpAddress: { type: Sequelize.STRING(45), allowNull: true },
        UserAgent: { type: Sequelize.TEXT, allowNull: true },
        OccurredAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        // sha256(PrevHash || canonical(event)). Rewriting or deleting any row breaks
        // every hash after it, which is what makes the trail tamper-evident.
        PrevHash: { type: Sequelize.STRING(64), allowNull: true },
        Hash: { type: Sequelize.STRING(64), allowNull: false },
        ...timestamps(Sequelize)
      }, opts);

      await queryInterface.addIndex('DocAuditEvents', ['DocEnvelopeId', 'Sequence'], {
        name: 'DocAuditEvents_Envelope_Sequence_idx',
        transaction: t
      });
      await queryInterface.addIndex('DocAuditEvents', ['DocLinkId'], {
        name: 'DocAuditEvents_DocLinkId_idx',
        transaction: t
      });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };
      const tables = [
        'DocAuditEvents',
        'DocSignatureFields',
        'DocEnvelopeSigners',
        'DocEnvelopes',
        'DocPageViews',
        'DocViewSessions',
        'DocLinks',
        'DocRecipientGroupMembers',
        'DocRecipientGroups',
        'DocRecipients',
        'DocTemplates',
        'DocDocuments',
        'DocProjects'
      ];
      for (const table of tables) {
        await queryInterface.dropTable(table, opts);
      }

      const enums = [
        'enum_DocEnvelopes_Status',
        'enum_DocEnvelopes_SigningOrder',
        'enum_DocEnvelopeSigners_Status',
        'enum_DocEnvelopeSigners_SignatureType',
        'enum_DocSignatureFields_Type',
        'enum_DocAuditEvents_ActorType'
      ];
      for (const name of enums) {
        await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${name}";`, opts);
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
