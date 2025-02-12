'use strict';

module.exports = (sequelize, DataTypes) => {
    const WP_CONFIGURATION = sequelize.define('WP_CONFIGURATION', {
        ID: { 
            type: DataTypes.INTEGER, 
            primaryKey: true, 
            autoIncrement: true 
        },
        Type: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        UserID: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        Settings: {
            type: DataTypes.JSON,
            allowNull: false
        },
        IsActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        CreateTS: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('GETDATE()')
        },
        UpdateTS: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('GETDATE()')
        }
    }, {
        tableName: 'WP_CONFIGURATION',
        timestamps: false
    });

    // Add static methods
    WP_CONFIGURATION.findActiveConfig = async function(type, userId) {
        return await this.findOne({
            where: {
                Type: type,
                UserID: userId,
                IsActive: true
            }
        });
    };

    WP_CONFIGURATION.updateConfig = async function(type, userId, settings) {
        const transaction = await sequelize.transaction();
        
        try {
            // Deactivate existing configurations
            await this.update(
                { IsActive: false },
                { 
                    where: { 
                        Type: type,
                        UserID: userId,
                        IsActive: true
                    },
                    transaction
                }
            );

            // Create new configuration
            const newConfig = await this.create({
                Type: type,
                UserID: userId,
                Settings: settings,
                IsActive: true,
                CreateTS: sequelize.literal('GETDATE()'),
                UpdateTS: sequelize.literal('GETDATE()')
            }, { transaction });

            await transaction.commit();
            return newConfig;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    };

    return WP_CONFIGURATION;
};

