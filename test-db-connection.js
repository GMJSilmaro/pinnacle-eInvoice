const sql = require('mssql');

// Configuration for connecting to SQL Server
const config = {
  user: 'sa',
  password: 'pxc@sql1234',
  server: 'PXCSERVER',
  database: 'PXC_E_INVOICE_DATABASE',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Alternative configuration using IP address
const configWithIP = {
  user: 'sa',
  password: 'pxc@sql1234',
  server: '47.250.53.233',
  database: 'PXC_E_INVOICE_DATABASE',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Try with different password formats
const configWithIP2 = {
  user: 'sa',
  password: 'pxc@sql1234', // URL encoded
  server: '47.250.53.253',
  database: 'PXC_E_INVOICE_DATABASE',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const configWithIP3 = {
  user: 'sa',
  password: 'pixel@1234', // URL encoded
  server: '47.250.53.253',
  database: 'PXC_TEKAUTO_E_INVOICE_DATABASE', // Different database name
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Function to test connection
async function testConnection(connectionConfig) {
  try {
    console.log(`Attempting to connect to SQL Server at ${connectionConfig.server}...`);

    // Connect to the database
    await sql.connect(connectionConfig);

    // Execute a simple query
    const result = await sql.query`SELECT @@VERSION as version`;

    console.log('Connection successful!');
    console.log('SQL Server version:', result.recordset[0].version);

    // Close the connection
    await sql.close();

    return true;
  } catch (err) {
    console.error('Database connection error:');
    console.error(err);

    // Close the connection if it was opened
    try {
      await sql.close();
    } catch (closeErr) {
      // Ignore errors when closing
    }

    return false;
  }
}

// Test all configurations
async function runTests() {
  console.log('=== Testing connection with hostname ===');
  const hostnameResult = await testConnection(config);

  console.log('\n=== Testing connection with IP address ===');
  const ipResult = await testConnection(configWithIP);

  console.log('\n=== Testing connection with IP address and URL encoded password ===');
  const ipResult2 = await testConnection(configWithIP2);

  console.log('\n=== Testing connection with IP address, URL encoded password, and different database name ===');
  const ipResult3 = await testConnection(configWithIP3);

  console.log('\n=== Summary ===');
  console.log(`Connection with hostname: ${hostnameResult ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Connection with IP address: ${ipResult ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Connection with IP address and URL encoded password: ${ipResult2 ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Connection with IP address, URL encoded password, and different database name: ${ipResult3 ? 'SUCCESS' : 'FAILED'}`);
}

// Run the tests
runTests().catch(err => {
  console.error('Error running tests:', err);
});
