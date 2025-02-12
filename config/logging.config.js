const loggingConfig = {
    // Database query logging
    sequelize: {
        logging: false  // Disable SQL query logging
    },

    // Application logging levels
    app: {
        errors: true,      // Always log errors
        warnings: true,    // Log warnings
        info: true,        // Enable general info logging
        debug: false,      // Don't log debug info
        queries: false     // Don't log database queries
    },

    // Authentication logging
    auth: {
        loginAttempts: true,      // Log all login attempts
        successfulLogins: true,    // Log successful logins
        failedLogins: true,       // Log failed logins
        logouts: true,            // Log logouts
        sessionActivity: true,     // Log session activities
        ipTracking: true,         // Track IP addresses
        userAgentTracking: true   // Track user agents
    }
};

module.exports = loggingConfig; 