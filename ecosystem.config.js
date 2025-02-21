module.exports = {
  apps: [
    {
      name: 'eInvoice',
      script: './server.js',
      instances: 1, 
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      log_file: 'C:/inetpub/wwwroot/eInvoice/logs/combined.log',  
      out_file: 'C:/inetpub/wwwroot/eInvoice/logs/out.log',        
      error_file: 'C:/inetpub/wwwroot/eInvoice/logs/error.log',    
    }
  ]
};
