'use strict';
module.exports = (sequelize, DataTypes) => {
const WP_OUTBOUND_STATUS = sequelize.define('WP_OUTBOUND_STATUS', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    UUID: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    submissionUid: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    fileName: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    filePath: {
        type: DataTypes.STRING(255),
        unique: true,
        allowNull: false
    },
    invoice_number: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'Pending'
    },
    date_submitted: {
        type: DataTypes.DATE,
        allowNull: true
    },
    date_sync: {
        type: DataTypes.DATE,
        allowNull: true
    },
    date_cancelled: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cancelled_by: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    cancellation_reason: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.fn('GETDATE')
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.fn('GETDATE')
    }
}, {
    tableName: 'WP_OUTBOUND_STATUS',
    timestamps: false,
    indexes: [
        {
            fields: ['UUID']
        },
        {
            fields: ['invoice_number']
        }
    ]
});

return WP_OUTBOUND_STATUS;
};