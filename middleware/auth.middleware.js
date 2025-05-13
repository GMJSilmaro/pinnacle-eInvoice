const { WP_USER_REGISTRATION, sequelize } = require('../models');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging.service');
const authConfig = require('../config/auth.config');

// Active sessions and login attempts tracking
const activeSessions = new Map();
const loginAttempts = new Map();

// Cleanup old login attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (data.cooldownUntil && data.cooldownUntil < now) {
      loginAttempts.delete(key);
    }
  }
}, authConfig.login.cleanupInterval);

// Helper function to handle unauthorized access
const handleUnauthorized = async (req, res, reason = 'unauthorized') => {
  await LoggingService.log({
    description: `Unauthorized access attempt - ${reason}`,
    username: req.session?.user?.username || 'anonymous',
    userId: req.session?.user?.id,
    ipAddress: req.ip,
    logType: LOG_TYPES.WARNING,
    module: MODULES.AUTH,
    action: ACTIONS.READ,
    status: STATUS.FAILED,
    details: {
      path: req.path,
      method: req.method,
      reason
    }
  });

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      reason: reason
    });
  }
  return res.redirect('/login');
};

// Helper function to handle session expiry
const handleSessionExpiry = (req, res, reason) => {
  return new Promise(async (resolve) => {
    const username = req.session?.user?.username;
    const userId = req.session?.user?.id;

    await LoggingService.log({
      description: `Session expired - ${reason}`,
      username: username || 'anonymous',
      userId: userId,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.AUTH,
      action: ACTIONS.LOGOUT,
      status: STATUS.SUCCESS,
      details: { reason }
    });

    req.session.destroy(() => {
      removeActiveSession(username);
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        resolve(res.status(401).json({
          success: false,
          message: reason || 'Session expired'
        }));
      } else {
        resolve(res.redirect('/auth/login?expired=true&reason=' + encodeURIComponent(reason || 'timeout')));
      }
    });
  });
};

// Login attempt tracking functions
const trackLoginAttempt = async (username, ip, success) => {
  const key = `${username}:${ip}`;
  const now = new Date();
  const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0, cooldownUntil: 0 };

  if (success) {
    attempts.count = 0;
    attempts.cooldownUntil = 0;
  } else {
    attempts.count++;
    attempts.lastAttempt = now.getTime();
    
    if (attempts.count >= authConfig.login.maxAttempts) {
      attempts.cooldownUntil = now.getTime() + authConfig.login.lockoutDuration;
    }
  }

  loginAttempts.set(key, attempts);

  // Format the timestamp in SQL Server format
  const timestamp = now.toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .split('.')[0]; // Remove milliseconds

  await LoggingService.log({
    description: success ? 
      `User login: ${username}` : 
      `Login attempt for user ${username} - Failed (Attempt ${attempts.count})${attempts.cooldownUntil > now.getTime() ? ' - Account locked' : ''}`,
    username,
    ipAddress: ip,
    logType: success ? LOG_TYPES.INFO : LOG_TYPES.WARNING,
    module: MODULES.AUTH,
    action: success ? ACTIONS.LOGIN : ACTIONS.FAILED_LOGIN,
    status: success ? STATUS.SUCCESS : STATUS.FAILED,
    details: {
      attempts: attempts.count,
      inCooldown: attempts.cooldownUntil > now.getTime(),
      cooldownRemaining: Math.max(0, Math.ceil((attempts.cooldownUntil - now.getTime()) / 1000)),
      timestamp: timestamp
    }
  });

  return attempts;
};

// Check login attempts
const checkLoginAttempts = (username, ip) => {
  const key = `${username}:${ip}`;
  const attempts = loginAttempts.get(key);
  
  if (!attempts) return { allowed: true };

  const now = Date.now();
  
  if (now < attempts.cooldownUntil) {
    const remainingCooldown = Math.ceil((attempts.cooldownUntil - now) / 1000);
    return {
      allowed: false,
      cooldownRemaining: remainingCooldown,
      message: `Too many login attempts. Please try again in ${Math.ceil(remainingCooldown / 60)} minutes.`
    };
  }

  return { 
    allowed: true,
    attemptsRemaining: authConfig.login.maxAttempts - attempts.count
  };
};

// Session management functions
const checkActiveSession = (username) => {
  const existingSession = activeSessions.get(username);
  if (existingSession) {
    const now = Date.now();
    if (now - existingSession.lastActivity < authConfig.session.timeout) {
      return true;
    }
    activeSessions.delete(username);
  }
  return false;
};

const updateActiveSession = (username) => {
  activeSessions.set(username, {
    lastActivity: Date.now()
  });
};

const removeActiveSession = (username) => {
  activeSessions.delete(username);
};

// Authentication middleware
const authMiddleware = (req, res, next) => {
  // Check if path is public
  if (authConfig.publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  res.redirect('/login');
};

const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.Admin === 1) {
    return next();
  }
  
  res.status(403).json({
    success: false,
    message: 'Admin access required'
  });
};

// Update to handle cases where req object isn't available
async function updateUserActivity(userId, isActive = true, req = null) {
  try {
    const updateData = {
      LastLoginTime: isActive ? sequelize.literal('GETDATE()') : null,
      isActive: isActive
    };

    // Only include IP address if req object is available
    if (req) {
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                      req.headers['x-real-ip'] || 
                      req.connection.remoteAddress || 
                      req.ip;
      updateData.LastIPAddress = clientIP;
    }

    await WP_USER_REGISTRATION.update(updateData, {
      where: { ID: userId }
    });

    return true;
  } catch (error) {
    console.error('Error updating user activity:', error);
    return false;
  }
}

const handleLogout = async (req, res) => {
    try {
        if (req.session?.user?.id) {
            // Update user's active status to false on logout
            req.session.user.isActive = false;
            await updateUserActivity(req.session.user.id, false);
            
            // Remove from active sessions
            removeActiveSession(req.session.user.username);
            
            // Format timestamp consistently
            const now = new Date();
            const timestamp = now.toISOString()
                .replace('T', ' ')
                .replace('Z', '')
                .split('.')[0];
            
            // Log the logout
            await LoggingService.log({
                description: 'User logged out',
                username: req.session.user.username,
                userId: req.session.user.id,
                ipAddress: req.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.AUTH,
                action: ACTIONS.LOGOUT,
                status: STATUS.SUCCESS,
                details: {
                    timestamp: timestamp
                }
            });
        }

        req.session.destroy(() => {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                res.json({ success: true });
            } else {
                res.redirect('/login');
            }
        });
    } catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({ success: false, error: 'Logout failed' });
    }
};

// Update the isApiAuthenticated middleware to pass the req object
async function isApiAuthenticated(req, res, next) {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Pass the req object when updating activity
    await updateUserActivity(req.session.user.id, true, req);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  authMiddleware,
  isAdmin,
  isApiAuthenticated,
  trackLoginAttempt,
  checkLoginAttempts,
  checkActiveSession,
  updateActiveSession,
  removeActiveSession,
  handleSessionExpiry,
  handleUnauthorized,
  handleLogout,
  updateUserActivity
}; 