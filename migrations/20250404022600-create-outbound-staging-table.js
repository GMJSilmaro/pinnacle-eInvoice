'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WP_OUTBOUND_STAGING', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      fileName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      filePath: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      invoice_number: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      company: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      supplier: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      receiver: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      file_uploaded: {
        type: Sequelize.DATE,
        allowNull: true
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'Pending'
      },
      source: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      amount: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true
      },
      document_type: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      issue_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      issue_time: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      submission_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      uuid: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('GETDATE')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('GETDATE')
      }
    });

    // Create indexes for better performance
    await queryInterface.addIndex('WP_OUTBOUND_STAGING', ['invoice_number']);
    await queryInterface.addIndex('WP_OUTBOUND_STAGING', ['fileName']);
    await queryInterface.addIndex('WP_OUTBOUND_STAGING', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('WP_OUTBOUND_STAGING');
  }
};
