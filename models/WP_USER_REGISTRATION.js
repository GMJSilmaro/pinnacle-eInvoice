// models/WP_USER_REGISTRATION.js
const { Op } = require('sequelize');
const authConfig = require('../config/auth.config');

module.exports = (sequelize, DataTypes) => {
  const WP_USER_REGISTRATION = sequelize.define('WP_USER_REGISTRATION', {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    FullName: DataTypes.STRING,
    Email: {
      type: DataTypes.STRING,
      unique: true
    },
    Username: {
      type: DataTypes.STRING,
      unique: true
    },
    Password: DataTypes.STRING,
    UserType: DataTypes.STRING,
    TIN: DataTypes.STRING,
    IDType: DataTypes.STRING,
    IDValue: DataTypes.STRING,
    ClientID: DataTypes.STRING,
    ClientSecret: DataTypes.STRING,
    DigitalSignaturePath: DataTypes.STRING,
    DigitalSignatureFileName: DataTypes.STRING,
    Admin: DataTypes.INTEGER, 
    CreateTS: DataTypes.DATE,
    Phone: DataTypes.STRING(50),
    ValidStatus: {
      type: DataTypes.CHAR(1),
      defaultValue: '1'
    },
    LastLoginTime: DataTypes.DATE,
    ProfilePicture: DataTypes.STRING,
    TwoFactorEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    NotificationsEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    UpdateTS: DataTypes.DATE
  }, {
    tableName: 'WP_USER_REGISTRATION',
    timestamps: false,
    hooks: {
      beforeUpdate: (user) => {
        user.UpdateTS = new Date();
      }
    }
  });

  
  WP_USER_REGISTRATION.updateConfig = async function(userId, clientId, clientSecret) {
    const transaction = await sequelize.transaction();
    
    try {
        // Find existing active config
        const existingConfig = await this.findOne({
            where: {
              ID: userId,
              isAdmin: 1,
              IsActive: true
            },
            transaction

        });


        if (existingConfig) {
            // Update existing config instead of creating new one
            await existingConfig.update({
                ClientID: clientId,
                ClientSecret: clientSecret,
                UpdateTS: sequelize.literal('GETDATE()')

            }, { transaction });

            await transaction.commit();
            return existingConfig;
        } else {
            // If no active config exists, create new one
            const result = await sequelize.query(
                `INSERT INTO WP_USER_REGISTRATION (ClientID, ClientSecret, UpdateTS) 
                 VALUES (:clientId, :clientSecret, GETDATE())`,
                {
                    replacements: {
                        ClientID: clientId,
                        ClientSecret: clientSecret,
                        UpdateTS: sequelize.literal('GETDATE()')
                    },

                    type: sequelize.QueryTypes.INSERT,
                    transaction


                }
            );

            await transaction.commit();
            return result;
        }
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

WP_USER_REGISTRATION.updateUserStatus = async function(userId, isActive = false) {
  if (!userId) {
    console.warn('Attempted to update user status with undefined userId');
    return false;
  }

  try {
    await this.update(
      {
        LastLoginTime: isActive ? sequelize.literal('GETDATE()') : null,
        isActive: isActive
      },
      {
        where: {
          ID: userId
        }
      }
    );
    return true;
  } catch (error) {
    console.error('Error updating user status:', error);
    return false;
  }
};

WP_USER_REGISTRATION.getOnlineUsers = async function() {
  try {
    const result = await sequelize.query(`
      SELECT 
        COUNT(1) as total,
        SUM(CASE 
          WHEN LastLoginTime IS NOT NULL AND CONVERT(bit, ValidStatus) = 1 
          THEN 1 
          ELSE 0 
        END) as active,
        SUM(CASE 
          WHEN LastLoginTime IS NOT NULL AND CONVERT(bit, ValidStatus) = 1 
          THEN 1 
          ELSE 0 
        END) as online_count
      FROM WP_USER_REGISTRATION 
      WHERE ValidStatus = '1'
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    return result[0];
  } catch (error) {
    console.error('Error getting online users:', error);
    return {
      total: 0,
      active: 0,
      online_count: 0
    };
  }
};

  return WP_USER_REGISTRATION;
};