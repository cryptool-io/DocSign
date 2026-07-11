'use strict';

// Drawn signatures/initials are stored as PNG data URLs (thousands of chars),
// but SignatureImageKey was VARCHAR(255) — too small. Widen it to TEXT, and add
// a separate initials image + type so a signer can draw initials distinct from
// their signature (e.g. "RZ" scribble vs full signature).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('DocEnvelopeSigners', 'SignatureImageKey', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('DocEnvelopeSigners', 'InitialsType', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('DocEnvelopeSigners', 'InitialsImageKey', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('DocEnvelopeSigners', 'InitialsImageKey');
    await queryInterface.removeColumn('DocEnvelopeSigners', 'InitialsType');
    await queryInterface.changeColumn('DocEnvelopeSigners', 'SignatureImageKey', {
      type: Sequelize.STRING,
      allowNull: true
    });
  }
};
