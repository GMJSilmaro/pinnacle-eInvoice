module.exports = (sequelize, DataTypes) => {
    const WP_FLATFILE = sequelize.define("WP_FLATFILE", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        supplier_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        supplier_tin: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        supplier_brn: {
            type: DataTypes.STRING(50)
        },
        supplier_msic: {
            type: DataTypes.STRING(20)
        },
        supplier_sst: {
            type: DataTypes.STRING(50)
        },
        supplier_address: {
            type: DataTypes.STRING(255)
        },
        supplier_city: {
            type: DataTypes.STRING(100)
        },
        supplier_state: {
            type: DataTypes.STRING(50)
        },
        supplier_country: {
            type: DataTypes.STRING(3),
            defaultValue: "MYS"
        },
        supplier_contact: {
            type: DataTypes.STRING(20)
        },
        buyer_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        buyer_tin: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        buyer_brn: {
            type: DataTypes.STRING(50)
        },
        buyer_sst: {
            type: DataTypes.STRING(50)
        },
        buyer_address: {
            type: DataTypes.STRING(255)
        },
        buyer_city: {
            type: DataTypes.STRING(100)
        },
        buyer_state: {
            type: DataTypes.STRING(50)
        },
        buyer_country: {
            type: DataTypes.STRING(3),
            defaultValue: "MYS"
        },
        buyer_contact: {
            type: DataTypes.STRING(20)
        },
        invoice_no: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        invoice_date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        invoice_time: {
            type: DataTypes.TIME
        },
        currency_code: {
            type: DataTypes.STRING(3),
            defaultValue: "MYR"
        },
        exchange_rate: {
            type: DataTypes.DECIMAL(10, 4),
            defaultValue: 1.0000
        },
        einvoice_version: {
            type: DataTypes.STRING(5),
            defaultValue: "1.0"
        },
        einvoice_type: {
            type: DataTypes.STRING(2),
            defaultValue: "01"
        },
        item_description: {
            type: DataTypes.TEXT
        },
        classification: {
            type: DataTypes.STRING(10)
        },
        tax_type: {
            type: DataTypes.STRING(10)
        },
        tax_rate: {
            type: DataTypes.DECIMAL(5, 2)
        },
        tax_amount: {
            type: DataTypes.DECIMAL(15, 2)
        },
        total_excl_tax: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false
        },
        total_incl_tax: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(20),
            defaultValue: "Pending"
        },
        is_mapped: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        mapping_details: {
            type: DataTypes.TEXT
        },
        upload_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        processed_date: {
            type: DataTypes.DATE
        },
        processed_by: {
            type: DataTypes.STRING(50)
        },
        submission_id: {
            type: DataTypes.STRING(50)
        },
        lhdn_response: {
            type: DataTypes.TEXT
        },
        uuid: {
            type: DataTypes.STRING(36),
            unique: true
        }
    }, {
        tableName: 'WP_FLATFILE',
        timestamps: false,
        indexes: [
            {
                name: 'idx_status',
                fields: ['status']
            },
            {
                name: 'idx_is_mapped',
                fields: ['is_mapped']
            },
            {
                name: 'idx_invoice_no',
                fields: ['invoice_no']
            },
            {
                name: 'idx_supplier_tin',
                fields: ['supplier_tin']
            },
            {
                name: 'idx_buyer_tin',
                fields: ['buyer_tin']
            },
            {
                name: 'idx_invoice_date',
                fields: ['invoice_date']
            },
            {
                name: 'idx_upload_date',
                fields: ['upload_date']
            },
            {
                name: 'idx_einvoice_type',
                fields: ['einvoice_type']
            }
        ]
    });
    
    return WP_FLATFILE;
}; 