'use strict';

/**
 * Per signature field: how the signer must sign — 'any' (type or draw),
 * 'type' (typed name only), or 'draw' (must hand-draw). Null = any.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocSignatureFields', 'SignatureMode', { type: Sequelize.STRING, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocSignatureFields', 'SignatureMode');
  }
};
