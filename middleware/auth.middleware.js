const { WP_USER_REGISTRATION } = require('../models');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging.service');

// Configuration constants
const CONFIG = {
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_COOLDOWN_TIME: 5 * 60 * 1000, // 5 minutes cooldown
  PUBLIC_PATHS: [
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/logout',
    '/assets',
    '/favicon.ico',
    '/public',
    '/uploads',
    '/vendor',
    '/api/health',
    '/',  // Root path
    '/login',
    '/register',
    '/auth'  // Allow access to auth pages
  ]
};

// Active sessions and login attempts tracking
const activeSessions = new Map();
const loginAttempts = new Map();

// Cleanup old login attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (now >= data.cooldownUntil) {
      loginAttempts.delete(key);
    }
  }
}, 60000); // Clean up every minute

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
  return res.redirect('/auth/login');
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
  const now = Date.now();
  const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0, cooldownUntil: 0 };

  if (success) {
    attempts.count = 0;
    attempts.cooldownUntil = 0;
  } else {
    attempts.count++;
    attempts.lastAttempt = now;
    
    if (attempts.count >= CONFIG.MAX_LOGIN_ATTEMPTS) {
      attempts.cooldownUntil = now + CONFIG.LOGIN_COOLDOWN_TIME;
    }
  }

  loginAttempts.set(key, attempts);

  await LoggingService.log({
    description: `Login attempt for user ${username} - ${success ? 'Success' : 'Failed'} (Attempt ${attempts.count})${attempts.cooldownUntil > now ? ' - In Cooldown' : ''}`,
    username,
    ipAddress: ip,
    logType: success ? LOG_TYPES.INFO : LOG_TYPES.WARNING,
    module: MODULES.AUTH,
    action: success ? ACTIONS.LOGIN : ACTIONS.FAILED_LOGIN,
    status: success ? STATUS.SUCCESS : STATUS.FAILED,
    details: {
      attempts: attempts.count,
      inCooldown: attempts.cooldownUntil > now,
      cooldownRemaining: Math.max(0, Math.ceil((attempts.cooldownUntil - now) / 1000))
    }
  });

  return attempts;
};

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
    attemptsRemaining: CONFIG.MAX_LOGIN_ATTEMPTS - attempts.count
  };
};

// Session management functions
const checkActiveSession = (username) => {
  const existingSession = activeSessions.get(username);
  if (existingSession) {
    const now = Date.now();
    if (now - existingSession.lastActivity < CONFIG.SESSION_TIMEOUT) {
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

// Main middleware functions
const authMiddleware = async (req, res, next) => {
  try {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    req.ip;

    const isPublicPath = CONFIG.PUBLIC_PATHS.some(path => 
      req.path.startsWith(path) || 
      req.path === '/' ||
      (req.method === 'POST' && req.path === '/auth/login')
    );

    if (isPublicPath) return next();

    if (!req.session?.user?.id) {
      return handleUnauthorized(req, res, 'no_session');
    }

    const lastActivity = req.session.user.lastActivityTime || req.session.user.lastLoginTime;
    const sessionAge = Date.now() - new Date(lastActivity).getTime();

    if (sessionAge > CONFIG.SESSION_TIMEOUT) {
      return handleSessionExpiry(req, res, 'session_timeout');
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: {
        ID: req.session.user.id,
        ValidStatus: '1'
      },
      attributes: [
        'ID', 'Username', 'Email', 'Admin', 'ValidStatus', 
        'LastLoginTime', 'TIN', 'IDType', 'IDValue', 'FullName',
        'Phone', 'TwoFactorEnabled', 'NotificationsEnabled', 'ProfilePicture'
      ]
    });

    if (!user) {
      return handleSessionExpiry(req, res, 'user_not_found');
    }

    // Update session with latest user data
    req.session.user = {
      ...req.session.user,
      admin: user.Admin === 1,
      lastActivityTime: Date.now()
    };

    updateActiveSession(user.Username);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    await LoggingService.log({
      description: 'Authentication middleware error',
      username: req.session?.user?.username || 'anonymous',
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.AUTH,
      action: ACTIONS.READ,
      status: STATUS.ERROR,
      details: { error: error.message }
    });
    next(error);
  }
};

const isAdmin = async (req, res, next) => {
  try {
    if (!req.session?.user) {
      return handleUnauthorized(req, res, 'no_session');
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { 
        ID: req.session.user.id,
        ValidStatus: '1'
      }
    });

    if (!user || user.Admin !== 1) {
      await LoggingService.log({
        description: 'Admin access denied',
        username: req.session.user.username,
        userId: req.session.user.id,
        ipAddress: req.ip,
        logType: LOG_TYPES.WARNING,
        module: MODULES.AUTH,
        action: ACTIONS.READ,
        status: STATUS.FAILED,
        details: {
          path: req.path,
          method: req.method,
          reason: 'insufficient_privileges'
        }
      });

      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    await LoggingService.log({
      description: 'Admin middleware error',
      username: req.session?.user?.username || 'anonymous',
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.AUTH,
      action: ACTIONS.READ,
      status: STATUS.ERROR,
      details: { error: error.message }
    });
    next(error);
  }
};

const isApiAuthenticated = async (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({
      success: false,
      message: 'API authentication required'
    });
  }

  const lastActivity = req.session.user.lastActivityTime || req.session.user.lastLoginTime;
  const sessionAge = Date.now() - new Date(lastActivity).getTime();

  if (sessionAge > CONFIG.SESSION_TIMEOUT) {
    await LoggingService.log({
      description: 'API session expired',
      username: req.session.user.username,
      userId: req.session.user.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.WARNING,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.FAILED,
      details: {
        path: req.path,
        method: req.method,
        reason: 'session_timeout'
      }
    });

    return res.status(401).json({
      success: false,
      message: 'API session expired',
      reason: 'timeout'
    });
  }

  req.session.user.lastActivityTime = Date.now();
  next();
};

module.exports = {
  CONFIG,
  authMiddleware,
  isAdmin,
  isApiAuthenticated,
  trackLoginAttempt,
  checkLoginAttempts,
  checkActiveSession,
  updateActiveSession,
  removeActiveSession,
  handleSessionExpiry,
  handleUnauthorized
}; 