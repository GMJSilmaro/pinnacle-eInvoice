module.exports = (sequelize, DataTypes) => {
  const WP_ADMIN_SETTINGS = sequelize.define('WP_ADMIN_SETTINGS', {
    ID: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    SettingKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    SettingValue: {
      type: DataTypes.STRING('MAX'),
      allowNull: false,
      get() {
        const rawValue = this.getDataValue('SettingValue');
        try {
          return JSON.parse(rawValue);
        } catch (e) {
          return rawValue;
        }
      },
      set(value) {
        this.setDataValue('SettingValue', 
          typeof value === 'object' ? JSON.stringify(value) : String(value)
        );
      }
    },
    SettingGroup: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    Description: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    IsActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    CreatedBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    UpdatedBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    CreateTS: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('GETDATE()')
    },
    UpdateTS: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('GETDATE()')
    }
  }, {
    tableName: 'WP_ADMIN_SETTINGS',
    schema: 'dbo',
    timestamps: false
  });

  // Static Methods
  WP_ADMIN_SETTINGS.getSetting = async function(key) {
    const setting = await this.findOne({
      where: {
        SettingKey: key,
        IsActive: true
      }
    });
    return setting ? setting.SettingValue : null;
  };

  WP_ADMIN_SETTINGS.getSettingsByGroup = async function(group) {
    const settings = await this.findAll({
      where: {
        SettingGroup: group,
        IsActive: true
      }
    });
    
    return settings.reduce((acc, setting) => {
      acc[setting.SettingKey] = setting.SettingValue;
      return acc;
    }, {});
  };

  WP_ADMIN_SETTINGS.upsertSetting = async function(key, value, group, description, userId) {
    const [setting] = await this.findOrCreate({
      where: { SettingKey: key },
      defaults: {
        SettingValue: value,
        SettingGroup: group,
        Description: description,
        CreatedBy: userId,
        UpdatedBy: userId,
        IsActive: true
      }
    });

    if (setting) {
      await setting.update({
        SettingValue: value,
        SettingGroup: group,
        Description: description || setting.Description,
        UpdatedBy: userId,
        UpdateTS: sequelize.literal('GETDATE()')
      });
    }

    return setting;
  };

  WP_ADMIN_SETTINGS.bulkUpsertSettings = async function(settings, userId) {
    const transaction = await sequelize.transaction();
    try {
      const results = await Promise.all(
        settings.map(({ key, value, group, description }) =>
          this.upsertSetting(key, value, group, description, userId)
        )
      );
      await transaction.commit();
      return results;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  return WP_ADMIN_SETTINGS;
}; 