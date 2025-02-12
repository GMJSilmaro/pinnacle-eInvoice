// models/WP_USER_REGISTRATION.js
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

  return WP_USER_REGISTRATION;
};