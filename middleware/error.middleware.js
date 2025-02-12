const { WP_LOGS } = require('../models');
const moment = require('moment');

// Error handling middleware
const errorMiddleware = async (err, req, res, next) => {
  // Log the error
  console.error('Error:', err);

  // Get user info if available
  const username = req.session?.user?.username;
  const clientIP = req.ip;
  const userAgent = req.headers['user-agent'];

  try {
    // Log error to database
    await WP_LOGS.create({
      Description: `Error - ${err.message || 'Unknown error'}`,
      CreateTS: moment().format('YYYY-MM-DD HH:mm:ss'),
      LoggedUser: username,
      Details: JSON.stringify({
        action: 'error',
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        userIP: clientIP,
        userAgent: userAgent
      })
    });
  } catch (logError) {
    console.error('Error logging to database:', logError);
  }

  // Handle specific error types
  if (err.name === 'BQEAuthError') {
    return res.redirect('/outbound-bqe?auth=error');
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized access'
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorMiddleware; 