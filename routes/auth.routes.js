const express = require('express');
const router = express.Router();
const { WP_USER_REGISTRATION, WP_LOGS } = require('../models');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const path = require('path');
const { generateAccessToken } = require('../services/token.service');
const { Sequelize } = require('sequelize');
const loggingConfig = require('../config/logging.config');
const { checkActiveSession, updateActiveSession, removeActiveSession, checkLoginAttempts } = require('../middleware/auth.middleware');

// Login route
const loginAttempts = new Map(); // Store for tracking failed attempts per username
const maxFailedAttempts = 5;
const blockDuration = 5 * 60 * 1000; // 5 minutes in milliseconds

// Cleanup old login attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of loginAttempts.entries()) {
    if (data.blockedUntil && data.blockedUntil < now) {
      loginAttempts.delete(username);
    }
  }
}, 60000); // Clean up every minute

// Enhanced logging function
async function logAuthEvent(type, details, req) {
    if (!loggingConfig.auth[type]) return;

    const username = details.username || 'unknown';
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    req.ip;
    
    // Map event types to specific actions for better display
    const actionMap = {
        loginAttempts: 'Unknown',
        successfulLogins: 'LOGIN',
        failedLogins: 'LOGIN_FAILED',
        logouts: 'LOGOUT',
        errors: 'ERROR',
        sessionActivity: 'SESSION',
    };

    const baseLogData = {
        CreateTS: new Date().toISOString(),
        LoggedUser: username,
        IPAddress: clientIP || '-1',
        Module: 'Authentication', // Add Module field
        Action: actionMap[type] || 'Unknown', // Add Action field
        Status: details.status || 'Unknown',
        Details: JSON.stringify({
            eventType: type,
            timestamp: new Date().toISOString(),
            ...details,
            ...(loggingConfig.auth.ipTracking && { ip: clientIP }),
            ...(loggingConfig.auth.userAgentTracking && { userAgent: req.headers['user-agent'] }),
            sessionId: req.session?.id,
            requestPath: req.path,
            requestMethod: req.method
        })
    };

    try {
        await WP_LOGS.create({
            ...baseLogData,
            Description: details.description || `Auth event: ${type}`
        });
    } catch (error) {
        console.error('Error logging auth event:', error);
    }
}

// Login page route (HTML)
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }

  // Check if there's an active session for this user from the URL parameter
  const hasExistingSession = req.query.sessionCheck === 'true';
  
  res.render('auth/login', {
    title: 'Login',
    layout: 'auth/auth.layout',
    sessionError: hasExistingSession // Use a different variable name
  });
});

router.post('/login', async (req, res) => {
  console.log('Auth Route - Login request received:', {
    body: req.body,
    hasUsername: !!req.body.username,
    hasPassword: !!req.body.password,
    method: req.method,
    path: req.path
  });

  const { username, password } = req.body;
  const currentTime = Date.now();
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                  req.headers['x-real-ip'] || 
                  req.connection.remoteAddress || 
                  req.ip;

  try {
    // Check if user is already logged in
    if (checkActiveSession(username)) {
      return res.status(400).json({
        success: false,
        message: 'This user is already logged in. Please log out from other sessions first.',
        sessionExists: true // Add this flag for frontend handling
      });
    }

    // Check login attempts
    const attemptCheck = checkLoginAttempts(username, clientIP);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: attemptCheck.message
      });
    }

    // Initial login attempt logging
    await logAuthEvent('loginAttempts', {
        username,
        description: `Login attempt for user "${username}"`,
        status: 'Unknown',
        action: 'Unknown'
    }, req);

    // Get user's login attempts
    const userAttempts = loginAttempts.get(username) || { count: 0, blockedUntil: 0 };

    // Check if the user is currently blocked
    if (userAttempts.blockedUntil > currentTime) {
      const remainingTime = Math.ceil((userAttempts.blockedUntil - currentTime) / 60000);
      console.log('Auth Route - User is blocked:', { username, remainingTime });
      await logAuthEvent('failedLogins', {
        username,
        description: `Login attempt for user "${username}"`,
        status: 'Unknown',
        action: 'LOGIN'
      }, req);
      return res.status(403).json({ 
        success: false, 
        message: `Account temporarily locked. Please try again in ${remainingTime} minute(s).` 
      });
    }

    console.log('Auth Route - Finding user in database');
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: username },
      attributes: ['ID', 'Username', 'Password', 'Admin', 'TIN', 'IDType', 'IDValue', 'Email', 'LastLoginTime', 'ValidStatus']
    });

    if (!user) {
      console.log('Auth Route - User not found:', { username });
      await logAuthEvent('failedLogins', {
        username,
        description: `Login attempt for user "${username}"`,
        status: 'Unknown',
        action: 'LOGIN'
      }, req);
      const remainingAttempts = maxFailedAttempts - (userAttempts.count + 1);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials',
        remainingAttempts: Math.max(0, remainingAttempts)
      });
    }

    // Check if account is active
    if (user.ValidStatus === '0') {
      console.log('Auth Route - Account inactive:', { username });
      await logAuthEvent('failedLogins', {
        username,
        description: `Login attempt for user "${username}"`,
        status: 'Unknown',
        action: 'LOGIN'
      }, req);
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.'
      });
    }

    console.log('Auth Route - Validating password');
    const isPasswordValid = await bcrypt.compare(password, user.Password);
    if (!isPasswordValid) {
      console.log('Auth Route - Invalid password:', { username });
      await logAuthEvent('failedLogins', {
        username,
        description: `Login attempt for user "${username}"`,
        status: 'Unknown',
        action: 'LOGIN'
      }, req);
      const remainingAttempts = maxFailedAttempts - (userAttempts.count + 1);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials',
        remainingAttempts: Math.max(0, remainingAttempts)
      });
    }

    console.log('Auth Route - Login successful, setting up session');
    // Successful login - Reset failed attempts
    loginAttempts.delete(username);

    // Update last login time and set user as active
    const currentLoginTime = moment().format('YYYY-MM-DD HH:mm:ss');
    await WP_USER_REGISTRATION.update({
      LastLoginTime: Sequelize.literal('GETDATE()'),
      ValidStatus: '1'
    }, {
      where: { ID: user.ID }
    });

    // Set up user session
    req.session.user = {
      id: user.ID,
      username: user.Username,
      admin: user.Admin,
      IDType: user.IDType,
      IDValue: user.IDValue,
      TIN: user.TIN,
      Email: user.Email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.session.id,
      lastLoginTime: currentLoginTime,
      isActive: true
    };

    // Generate access token and store it in session
    const accessToken = await generateAccessToken(req, user.ID);
    req.session.accessToken = accessToken; // Store access token in session
    req.session.tokenExpiryTime = Date.now() + (24 * 60 * 60 * 1000); // Set token expiry time

    // Log successful login
    await logAuthEvent('successfulLogins', {
      username,
      description: `Login successful for user ${username}`,
      status: 'Unknown',
      action: 'LOGIN',
      userId: user.ID,
      admin: user.Admin,
      lastLoginTime: user.LastLoginTime
    }, req);

    updateActiveSession(username);

    return res.json({ 
      success: true, 
      message: 'Login successful', 
      accessToken, 
      user: {
        ...req.session.user,
        lastLoginTime: user.LastLoginTime
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    await logAuthEvent('errors', {
      username,
      description: `Login error occurred for user ${username}`,
      error: error.message,
      stack: error.stack
    }, req);

    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred while processing your login request. Please try again.' 
    });
  }
});

// Registration page route (HTML)
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('auth/register', {
    title: 'Register',
    layout: 'auth/auth.layout'
  });
});

router.post('/register', async (req, res) => {
  const { username, password, email, tin, idType, idValue } = req.body;

  try {
    // Check if username already exists
    const existingUser = await WP_USER_REGISTRATION.findOne({
      where: { Username: username }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = await WP_USER_REGISTRATION.create({
      Username: username,
      Password: hashedPassword,
      Email: email,
      TIN: tin,
      IDType: idType,
      IDValue: idValue,
      Admin: '0', // Default to non-admin
      ValidStatus: '1', // Set as active
      CreateTS: new Date().toISOString(),
      LastLoginTime: null
    });

    // Log registration event
    await logAuthEvent('successfulLogins', {
      username,
      description: `New user registration: ${username}`,
      status: 'Success',
      action: 'REGISTER',
      userId: newUser.ID
    }, req);

    return res.json({
      success: true,
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('Registration error:', error);
    await logAuthEvent('errors', {
      username,
      description: 'Registration error',
      error: error.message,
      stack: error.stack
    }, req);

    return res.status(500).json({
      success: false,
      message: 'An error occurred during registration'
    });
  }
});

// Enhanced logout endpoint
router.get('/logout', async (req, res) => {
    const username = req.session?.user?.username;
    const userId = req.session?.user?.id;

    if (req.session) {
        try {
            if (username) {
                // Remove active session first
                removeActiveSession(username);
                
                await logAuthEvent('logouts', {
                    username,
                    userId,
                    description: `User ${username} signed out successfully`,
                    status: 'Success', // Changed from 'Unknown' to 'Success'
                    action: 'LOGOUT',
                    sessionDuration: req.session.user?.lastLoginTime ? 
                        moment().diff(moment(req.session.user.lastLoginTime), 'seconds') : null
                }, req);
            }

            // Clear the session cookie first
            res.clearCookie('connect.sid');
            
            // Then destroy the session
            req.session.destroy(err => {
                if (err) {
                    console.error('Session destruction error:', err);
                    logAuthEvent('errors', {
                        username,
                        description: `Logout error for user ${username}`,
                        error: err.message
                    }, req);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to logout'
                    });
                }

                // For GET requests, redirect to login page
                res.redirect('/auth/login');
            });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({
                success: false,
                message: 'An error occurred during logout'
            });
        }
    } else {
        res.clearCookie('connect.sid');
        res.redirect('/auth/login');
    }
});

// Add a catch-all route for /auth/* to handle 404s
router.use((req, res) => {
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ success: false, message: 'Auth endpoint not found' });
  } else {
    res.redirect('/auth/login');
  }
});

module.exports = router; 