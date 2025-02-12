const path = require('path');
const fs = require('fs');

const sessionConfig = {
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  proxy: true, // Trust the reverse proxy
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'development',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  rolling: true // Refresh cookie on each request
};

// Add session expiry check
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

module.exports = {
  port: process.env.PORT || 3000,
  sessionConfig,
  SESSION_TIMEOUT
}; 