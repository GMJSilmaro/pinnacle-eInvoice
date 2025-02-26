const path = require('path');
const fs = require('fs');
const authConfig = require('./auth.config');

const sessionConfig = {
  secret: authConfig.session.secret,
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  proxy: false, // Trust the reverse proxy
  cookie: {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: authConfig.session.cookie.maxAge
  },
  rolling: false // Refresh cookie on each request
};

module.exports = {
  port: process.env.PORT || 3000,
  sessionConfig
}; 