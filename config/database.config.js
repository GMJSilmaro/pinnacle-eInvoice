require('dotenv').config();

// For debugging purposes
console.log('Database config loaded with:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

const config = {
  HOST: "PXCSERVER",
  USER: "sa",
  PASSWORD: "pxc@sql1234",
  DB: "PXC_TEKAUTO_E_INVOICE_DATABASE",
  dialect: "mssql",
  dialectOptions: {
    options: {
      useUTC: false,
      dateFirst: 1,
      enableArithAbort: false,
      trustServerCertificate: true
    },
    useUTC: false,
    authentication: {
      type: 'default',
      options: {
        userName: "sa",
        password: "pxc@sql1234"
      }
    },
    server: "PXCSERVER"
  },
  define: {
    timestamps: false
  }
};

module.exports = config;