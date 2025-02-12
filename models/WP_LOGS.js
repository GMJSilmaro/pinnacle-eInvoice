module.exports = (sequelize, DataTypes) => {
  const WP_LOGS = sequelize.define('WP_LOGS', {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    Description: DataTypes.STRING,
    CreateTS: DataTypes.DATE,
    LoggedUser: DataTypes.STRING,
    IPAddress: DataTypes.STRING,
    LogType: DataTypes.STRING,
    Module: DataTypes.STRING,
    Action: DataTypes.STRING,
    Status: DataTypes.STRING,
    UserID: DataTypes.INTEGER
  }, {
    tableName: 'WP_LOGS',
    timestamps: false
  });

  return WP_LOGS;
};
