const express = require('express');
const router = express.Router();
const { WP_USER_REGISTRATION, WP_LOGS, sequelize } = require('../models');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const loggingConfig = require('../config/logging.config');
const { checkActiveSession, updateActiveSession, removeActiveSession, checkLoginAttempts, trackLoginAttempt } = require('../middleware/auth.middleware');
const passport = require('passport');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging.service');
const tokenService = require('../services/token.service');
const { updateUserActivity } = require('../middleware/auth.middleware');
const { WP_USER_LOGIN_HISTORY } = require('../models');
const logger = require('../utils/logger');
const { CONFIG, auth: authHelper } = require('../middleware');

// Move constants to top
const LOGIN_CONSTANTS = {
  MAX_ATTEMPTS: 3,
  BLOCK_DURATION: 5 * 60 * 1000, // 5 minutes
  CLEANUP_INTERVAL: 60000 // 1 minute
};

// Store for tracking failed attempts
const loginAttempts = new Map();

// Cleanup old login attempts
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of loginAttempts.entries()) {
    if (data.blockedUntil && data.blockedUntil < now) {
      loginAttempts.delete(username);
    }
  }
}, LOGIN_CONSTANTS.CLEANUP_INTERVAL);

// Enhanced logging function
async function logAuthEvent(type, details, req) {
  if (!loggingConfig.auth[type]) return;

  const username = details.username || 'unknown';
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                  req.headers['x-real-ip'] || 
                  req.connection.remoteAddress || 
                  req.ip;

  const actionMap = {
    loginAttempts: 'Unknown',
    successfulLogins: 'LOGIN',
    failedLogins: 'LOGIN_FAILED',
    logouts: 'LOGOUT',
    errors: 'ERROR',
    sessionActivity: 'SESSION',
  };

  try {
    await WP_LOGS.create({
      CreateTS: new Date(),
      LoggedUser: username,
      IPAddress: clientIP || '-1',
      Module: 'Authentication',
      Action: actionMap[type] || 'Unknown',
      Status: details.status || 'Unknown',
      Description: details.description || `Auth event: ${type}`,
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

// Login handler with Passport
router.post('/login', async (req, res, next) => {
  const { username } = req.body;
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                  req.headers['x-real-ip'] || 
                  req.connection.remoteAddress;
  try {
    // Check login attempts
    const attemptCheck = checkLoginAttempts(username, clientIP);
    if (!attemptCheck.allowed) {
      return res.status(429).json({ 
        success: false, 
        message: attemptCheck.message 
      });
    }
    // Use Passport authentication
    passport.authenticate('local', async (err, user, info) => {
      try {
        if (err) {
          await trackLoginAttempt(username, clientIP, false);
          return res.status(500).json({
            success: false,
            message: 'Authentication error',
            error: err.message
          });
        }

        if (!user) {
          await trackLoginAttempt(username, clientIP, false);
          return res.status(401).json({
            success: false,
            message: info ? info.message : 'Authentication failed'
          });
        }

        // Authentication successful
        req.login(user, async (loginErr) => {
          if (loginErr) {
            return res.status(500).json({
              success: false,
              message: 'Login error',
              error: loginErr.message
            });
          }

          // Update last login time
          const updatedUser = await WP_USER_REGISTRATION.update(
            {
              LastLoginTime: new Date()
            },
            {
              where: { ID: user.id }
            }
          );

          // Update active session tracking
          updateActiveSession(user.username);
          
          // Try to get LHDN token for future API calls
          let tokenData = null;
          try {
            const tokenResult = await tokenService.getAccessToken(user);
            
            // Store token only if successful
            if (tokenResult.success) {
              // Store token separately in session
              req.session.accessToken = tokenResult.token;
              req.session.tokenExpiry = tokenResult.expiry;
            } else {
              console.warn(`Token acquisition failed: ${tokenResult.error}`);
              // Continue with login - tokens will be obtained as needed during API calls
            }
          } catch (tokenError) {
            console.error('Token acquisition error:', tokenError);
            // Continue with login - we'll try to get the token again later
          }

          // Log successful login
          await LoggingService.log({
            description: 'User logged in successfully',
            username: user.username,
            userId: user.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.AUTH,
            action: ACTIONS.LOGIN,
            status: STATUS.SUCCESS
          });

          // Redirect based on request type
          if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({
              success: true,
              message: 'Successfully logged in',
              user: {
                id: user.id,
                username: user.username,
                email: user.email,
                isAdmin: user.admin === true
              },
              redirect: '/dashboard'
            });
          } else {
            return res.redirect('/dashboard');
          }
        });
      } catch (authError) {
        console.error('Authentication error:', authError);
        return res.status(500).json({
          success: false,
          message: 'Authentication process error',
          error: authError.message
        });
      }
    })(req, res, next);
  } catch (e) {
    console.error('Login route error:', e);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: e.message
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
      CreateTS: new Date(),
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
                    // Update user's last activity time to null on logout
          await updateUserActivity(userId, false);
          
          // Remove from active sessions
          removeActiveSession(username || req.session.user.username);
          
          // Log the logout
          await LoggingService.log({
              description: 'User logged out',
              username: req.session.user.username,
              userId: req.session.user.id,
              ipAddress: req.ip,
              logType: LOG_TYPES.INFO,
              action: ACTIONS.LOGOUT,
              status: STATUS.SUCCESS
          });
                
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

/**
 * API endpoint to refresh the access token
 */
router.post('/api/auth/refresh-token', async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get user details from session
    const user = req.session.user;
    
    console.log(`Refreshing token for user: ${user.username} (ID: ${user.id})`);
    
    // Attempt to get a new token
    const tokenResult = await tokenService.getAccessToken(user);
    
    if (!tokenResult.success) {
      console.error(`Token refresh failed for user ${user.username}:`, tokenResult.error);
      return res.status(400).json({
        success: false,
        message: 'Failed to refresh access token',
        error: tokenResult.error
      });
    }
    
    // Store the new token in the session
    req.session.accessToken = tokenResult.token;
    req.session.tokenExpiry = tokenResult.expiry;
    
    await LoggingService.log({
      description: `Access token refreshed successfully`,
      username: user.username,
      userId: user.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.AUTH,
      action: ACTIONS.UPDATE,
      status: STATUS.SUCCESS
    });
    
    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      expiresIn: tokenResult.expiresIn
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'An error occurred while refreshing the token',
      error: error.message
    });
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