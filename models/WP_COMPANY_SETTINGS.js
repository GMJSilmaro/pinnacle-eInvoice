module.exports = (sequelize, DataTypes) => {
    const WP_COMPANY_SETTINGS = sequelize.define('WP_COMPANY_SETTINGS', {
      CompanyImage: DataTypes.STRING, 
      CompanyName: DataTypes.STRING,
      Industry: DataTypes.STRING,
      Country: DataTypes.STRING,
      TIN: DataTypes.STRING,
      BRN: DataTypes.STRING,
      About: DataTypes.TEXT,
      Address: DataTypes.STRING,
      Phone: DataTypes.STRING,
      Email: DataTypes.STRING,
      ValidStatus: DataTypes.STRING,
      ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      UserID: DataTypes.STRING,
    }, {
      tableName: 'WP_COMPANY_SETTINGS',
      timestamps: false
    });
  
    return WP_COMPANY_SETTINGS;
  };
  