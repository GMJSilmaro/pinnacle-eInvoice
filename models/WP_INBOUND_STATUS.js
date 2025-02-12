module.exports = (sequelize, DataTypes) => {
  const WP_INBOUND_STATUS = sequelize.define('WP_INBOUND_STATUS', {
    uuid: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false
    },
    submissionUid: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    longId: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    internalId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    typeName: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    typeVersionName: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    issuerTin: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    issuerName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    receiverId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    receiverName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    dateTimeReceived: {
      type: DataTypes.DATE,
      allowNull: true
    },
    dateTimeValidated: {
      type: DataTypes.DATE,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    documentStatusReason: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    cancelDateTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejectRequestDateTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    createdByUserId: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dateTimeIssued: {
      type: DataTypes.DATE,
      allowNull: true
    },
    totalExcludingTax: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true
    },
    totalDiscount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true
    },
    totalNetAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true
    },
    totalPayableAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true
    }
  }, {
    tableName: 'WP_INBOUND_STATUS',
    timestamps: false,
    freezeTableName: true
  });

  return WP_INBOUND_STATUS;
};
