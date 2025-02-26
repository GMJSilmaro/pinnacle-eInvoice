const path = require('path');
const fs = require('fs');
const authConfig = require('./auth.config');

const sessionConfig = {
  secret: authConfig.session.secret,
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  proxy: true, // Trust the reverse proxy
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'development',
    sameSite: 'lax',
    maxAge: authConfig.session.cookie.maxAge
  },
  rolling: true // Refresh cookie on each request
};

module.exports = {
  port: process.env.PORT || 3000,
  sessionConfig
}; 