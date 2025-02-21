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
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dateTimeValidated: {
      type: DataTypes.STRING(100),
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
      type: DataTypes.STRING(100),
      allowNull: true
    },
    rejectRequestDateTime: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    createdByUserId: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dateTimeIssued: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    totalSales: {
      type: DataTypes.DECIMAL(18, 2),
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
    },
    created_at: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: sequelize.literal('GETDATE()')
    },
    updated_at: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: sequelize.literal('GETDATE()')
    },
    last_sync_date: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    sync_status: {
      type: DataTypes.STRING(50),
      allowNull: true
    }
  }, {
    tableName: 'WP_INBOUND_STATUS',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    freezeTableName: true,
    indexes: [
      {
        name: 'IX_WP_INBOUND_STATUS_dateTimeReceived',
        fields: [{ name: 'dateTimeReceived', order: 'DESC' }]
      },
      {
        name: 'IX_WP_INBOUND_STATUS_status',
        fields: ['status']
      },
      {
        name: 'IX_WP_INBOUND_STATUS_issuerTin',
        fields: ['issuerTin']
      },
      {
        fields: ['last_sync_date']
      }
    ]
  });

  return WP_INBOUND_STATUS;
};