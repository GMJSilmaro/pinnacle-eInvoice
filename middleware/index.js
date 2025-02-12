const {
  authMiddleware,
  isAdmin,
  isApiAuthenticated,
  CONFIG,
  trackLoginAttempt,
  checkLoginAttempts,
  checkActiveSession,
  updateActiveSession,
  removeActiveSession,
  handleSessionExpiry,
  handleUnauthorized
} = require('./auth.middleware');

const errorMiddleware = require('./error.middleware');
const maintenanceMiddleware = require('./maintenance.middleware');
const validation = require('./validation');

module.exports = {
  auth: {
    middleware: authMiddleware,
    isAdmin,
    isApiAuthenticated,
    trackLoginAttempt,
    checkLoginAttempts,
    checkActiveSession,
    updateActiveSession,
    removeActiveSession,
    handleSessionExpiry,
    handleUnauthorized
  },
  error: errorMiddleware,
  maintenance: maintenanceMiddleware,
  validation,
  CONFIG
};
