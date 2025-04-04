module.exports = {
  apps: [
    {
      name: 'eInvoice',
      script: './server.js',
      instances: 3,
      autorestart: true,
      watch: true,
      ignore_watch: ["node_modules", "public", "logs", "*.log", "temp", "*.xlsx"],
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        SECURE_COOKIE: 'false',
        TRUST_PROXY: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        SECURE_COOKIE: 'false',
        TRUST_PROXY: 'true'
      },
      log_file: 'C:/inetpub/wwwroot/eInvoice/logs/combined.log',  
      out_file: 'C:/inetpub/wwwroot/eInvoice/logs/out.log',        
      error_file: 'C:/inetpub/wwwroot/eInvoice/logs/error.log',    
    }
  ]
};
