'use strict';

/** Lets a signer hide an envelope from their personal inbox (To sign / Signed by
 *  you) without affecting the sender's copy. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocEnvelopeSigners', 'DismissedAt', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocEnvelopeSigners', 'DismissedAt');
  }
};
