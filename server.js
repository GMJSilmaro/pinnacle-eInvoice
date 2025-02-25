// 1. Environment and Core Dependencies
require('dotenv').config();
const express = require('express');
const https = require('https');
const session = require('express-session');
const cors = require('cors');
const swig = require('swig');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
// 2. Local Dependencies
const serverConfig = require('./config/server.config');
const { auth, error, maintenance, validation, CONFIG } = require('./middleware');
const versionHeader = require('./utils/versionHeader');
const appVersion = require('./config/version');
const { initJsReport } = require('./services/jsreport.service');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const apiRoutes = require('./routes/api/index');
const webRoutes = require('./routes/web/index');
// 3. Initialize Express
const app = express();

// Trust proxy headers from IIS
app.set('trust proxy', 'loopback');

// Version Header middleware
app.use(versionHeader);

// Enable CORS with specific options
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Security headers middleware
app.use((req, res, next) => {
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  // Add HSTS only for HTTPS requests
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    securityHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  res.set(securityHeaders);
  res.locals.appVersion = appVersion.getSemanticVersion();
  res.locals.appFullVersion = appVersion.getFullVersion();
  next();
});

// Configure Swig
swig.setDefaults({ 
  cache: process.env.NODE_ENV === 'production',
  loader: swig.loaders.fs(path.join(__dirname, 'views')),
  locals: {
    basedir: path.join(__dirname, 'views')
  }
});

app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));


// 4. Core Middleware Setup
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.error('Request has timed out.');
    res.status(503).send('Service temporarily unavailable. Please try again.');
  });
  next();
});

// Static file serving with correct MIME types
const staticFileMiddleware = (req, res, next) => {
  if (req.path.endsWith('.css')) {
    res.type('text/css');
  } else if (req.path.endsWith('.js')) {
    res.type('application/javascript');
  }
  next();
};

// Static file routes
app.use('/assets', staticFileMiddleware, express.static(path.join(__dirname, 'public/assets')));
app.use('/temp', express.static(path.join(__dirname, 'public/temp'))); 
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/reports', express.static(path.join(__dirname, 'src/reports')));


app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  ...serverConfig.sessionConfig,
  cookie: {
    ...serverConfig.sessionConfig.cookie,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: CONFIG.SESSION_TIMEOUT,
    rolling: true
  },
  resave: true,
  saveUninitialized: false
}));

// 5. Application Middleware
app.use(maintenance); // Maintenance mode check
app.use('/auth', authRoutes); // Auth routes (before auth middleware)
app.use('/api/v1/auth', authRoutes);

app.get('/api/version', (req, res) => {
  res.json({
    version: appVersion.getSemanticVersion(),
    fullVersion: appVersion.getFullVersion(),
    timestamp: appVersion.buildDate
  });
});


// Auth middleware for protected routes
app.use((req, res, next) => {
  const publicPaths = [
    '/assets/',
    '/favicon.ico',
    '/public/',
    '/uploads/',
    '/auth/',
    '/vendor/'
  ];
  
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }
  
  auth.middleware(req, res, next);
});

// Protected routes
app.use('/dashboard', dashboardRoutes);
app.use('/api', auth.isApiAuthenticated, apiRoutes);
app.use('/', webRoutes);

// 6. Error Handling
// 404 handler
app.use((req, res) => {
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ success: false, message: 'Not Found' });
  } else {
    res.status(404).render('error', { 
      title: 'Not Found',
      message: 'The page you are looking for does not exist.' 
    });
  }
});

// Global error handler
app.use(error);

async function ensureDirectories() {
  const dirs = [
      path.join(__dirname, 'public/temp'),
      path.join(__dirname, 'uploads/company-logos'),
      path.join(process.env.TEMP || os.tmpdir(), 'jsreport') // Add jsreport temp directory
  ];
  
  for (const dir of dirs) {
      try {
          await fsPromises.access(dir);
      } catch {
          console.log(`Creating directory: ${dir}`);
          await fsPromises.mkdir(dir, { recursive: true });
      }
  }
}
// 6. Server Startup
const startServer = async () => {
  try {
    await ensureDirectories();
    
    const jsreportInstance = await initJsReport();
    
    const port = serverConfig.port;
    // Create HTTPS server
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, 'ssl', 'client-key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'ssl', 'client-cert.pem')),
      requestCert: false,
      rejectUnauthorized: false
    };

    const server = https.createServer(httpsOptions, app);

    // Add middleware to redirect HTTP to HTTPS - but not for static files
    app.use((req, res, next) => {
      if (!req.secure && !req.path.startsWith('/assets/') && !req.path.startsWith('/public/')) {
        return res.redirect(['https://', req.get('Host'), req.url].join(''));
      }
      next();
    });

    server.listen(port, () => {
      console.log(`HTTPS Server started on https://localhost:${port}`);
    }).on('error', (err) => {
      console.error('Server error:', err);
      if (err.code === 'EACCES') {
        console.error(`Port ${port} requires elevated privileges`);
      } else if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use`);
      }
      process.exit(1);
    });

    // Modify the uncaught exception handler
    process.on('uncaughtException', async (err) => {
      console.error('Uncaught Exception:', err);
      if (jsreportInstance && typeof jsreportInstance.close === 'function') {
        try {
          await jsreportInstance.close();
        } catch (closeError) {
          console.error('Error closing jsreport:', closeError);
        }
      }
      process.exit(1);
    });

    // Modify the unhandled rejection handler
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      if (jsreportInstance && typeof jsreportInstance.close === 'function') {
        try {
          await jsreportInstance.close();
        } catch (closeError) {
          console.error('Error closing jsreport:', closeError);
        }
      }
    });
    
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM signal. Shutting down gracefully...');
      if (jsreportInstance && typeof jsreportInstance.close === 'function') {
        try {
          await jsreportInstance.close();
        } catch (closeError) {
          console.error('Error closing jsreport:', closeError);
        }
      }
      process.exit(0);
    });


  } catch (error) {
    console.error('Failed to start server:', error);
    if (jsreportInstance && typeof jsreportInstance.close === 'function') {
      try {
        await jsreportInstance.close();
      } catch (closeError) {
        console.error('Error closing jsreport:', closeError);
      }
    }
    process.exit(1);
  }
};

startServer();