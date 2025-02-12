'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('WP_ADMIN_SETTINGS', {
      ID: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      SettingKey: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      SettingValue: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      SettingGroup: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      Description: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      IsActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      CreatedBy: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      UpdatedBy: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      CreateTS: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('GETDATE()')
      },
      UpdateTS: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('GETDATE()')
      }
    }, {
      schema: 'dbo'
    });

    // Add indexes
    await queryInterface.addIndex('WP_ADMIN_SETTINGS', ['SettingGroup'], {
      schema: 'dbo'
    });
    await queryInterface.addIndex('WP_ADMIN_SETTINGS', ['IsActive'], {
      schema: 'dbo'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('WP_ADMIN_SETTINGS', {
      schema: 'dbo'
    });
  }
}; 