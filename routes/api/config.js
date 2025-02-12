const express = require('express');
const router = express.Router();
const { validateAndFormatNetworkPath, SERVER_CONFIG, testNetworkPathAccessibility } = require('../../config/paths');
const fs = require('fs').promises;
const db = require('../../models');
const { WP_CONFIGURATION, WP_USER_REGISTRATION, sequelize } = db;
const tokenService = require('../../services/token.service');



// Middleware to check if user is authenticated
const checkAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required' 
        });
    }
    req.user = req.session.user;
    next();
};

// Apply authentication check to all routes
router.use(checkAuth);

// Get SAP configuration
router.get('/sap/get-config', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            console.log('User not authenticated:', req.user);
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Get configuration from database
        console.log('Fetching config for user:', req.user.id);
        const config = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'SAP',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        console.log('Found config:', config);

        // Parse settings if it's a string
        let settings = config?.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (error) {
                console.error('Error parsing settings:', error);
                settings = {};
            }
        }

        // Set proper content type and return response
        res.setHeader('Content-Type', 'application/json');
        return res.json({
            success: true,
            networkPath: settings?.networkPath || '',
            settings: settings || {
                networkPath: '',
                domain: '',
                username: ''
            }
        });
    } catch (error) {
        console.error('Error getting SAP config:', error);
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to load SAP configuration'
        });
    }
});

// // Validate SAP network path
// router.post('/sap/validate-path', async (req, res) => {
//     try {
//         const { networkPath, domain, username, password } = req.body;

//         // Input validation
//         if (!networkPath || !username || !password) {
//             throw new Error('Network path, username and password are required');
//         }

//         // Format and validate the network path
//         const formattedPath = await validateAndFormatNetworkPath(networkPath);

//         // Test network path accessibility
//         const accessResult = await testNetworkPathAccessibility(formattedPath, {
//             serverName: domain || '',
//             serverUsername: username,
//             serverPassword: password
//         });

//         if (!accessResult.success) {
//             throw new Error(accessResult.error || 'Network path validation failed');
//         }

//         res.json({
//             success: true,
//             message: 'Network path validation successful',
//             formattedPath: accessResult.formattedPath
//         });

//     } catch (error) {
//         console.error('Error validating SAP path:', error);
//         res.status(400).json({
//             success: false,
//             error: error.message
//         });
//     }
// });

// // Save SAP configuration
// router.post('/sap/save-config', async (req, res) => {
//     try {
//         const { networkPath, domain, username, password } = req.body;

//         // Input validation
//         if (!networkPath || !username || !password) {
//             throw new Error('Network path, username and password are required');
//         }

//         // Format the network path
//         const formattedPath = await validateAndFormatNetworkPath(networkPath);

//         // Save to database
//         const settings = {
//             networkPath: formattedPath,
//             domain: domain || '',
//             username,
//             password
//         };

//         await WP_CONFIGURATION.updateConfig('SAP', req.user.id, settings);

//         // Update SERVER_CONFIG for current session
//         SERVER_CONFIG.networkPath = formattedPath;
//         SERVER_CONFIG.credentials = {
//             domain: domain || '',
//             username,
//             password
//         };

//         res.json({ 
//             success: true,
//             message: 'SAP configuration saved successfully',
//             config: {
//                 networkPath: formattedPath,
//                 domain: domain || '',
//                 username
//                 // Don't send password back
//             }
//         });
//     } catch (error) {
//         console.error('Error saving SAP config:', error);
//         res.status(500).json({ 
//             success: false,
//             error: error.message 
//         });
//     }
// });

// Validate SAP network path
router.post('/sap/validate-path', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format and validate the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Test network path accessibility
        const accessResult = await testNetworkPathAccessibility(formattedPath, {
            serverName: domain || '',
            serverUsername: username,
            serverPassword: password
        });

        if (!accessResult.success) {
            throw new Error(accessResult.error || 'Network path validation failed');
        }

        res.json({
            success: true,
            message: 'Network path validation successful',
            formattedPath: accessResult.formattedPath
        });

    } catch (error) {
        console.error('Error validating SAP path:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Save SAP configuration
router.post('/sap/save-config', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Save to database
        const settings = {
            networkPath: formattedPath,
            domain: domain || '',
            username,
            password
        };

        await WP_CONFIGURATION.updateConfig('SAP', req.user.id, settings);

        // Update SERVER_CONFIG for current session
        SERVER_CONFIG.networkPath = formattedPath;
        SERVER_CONFIG.credentials = {
            domain: domain || '',
            username,
            password
        };

        res.json({ 
            success: true,
            message: 'SAP configuration saved successfully',
            config: {
                networkPath: formattedPath,
                domain: domain || '',
                username
                // Don't send password back
            }
        });
    } catch (error) {
        console.error('Error saving SAP config:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Get LHDN configuration
router.get('/lhdn/get-config', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // First try to get global configuration
        const config = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'LHDN',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        // Parse settings if it's a string
        let settings = config?.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (error) {
                console.error('Error parsing settings:', error);
                settings = {};
            }
        }

        // Add last modified info if available
        if (config && config.UserID) {
            const lastModifiedUser = await db.WP_USER_REGISTRATION.findOne({
                where: { ID: config.UserID },
                attributes: ['FullName', 'Username']
            });
            if (lastModifiedUser) {
                settings.lastModifiedBy = {
                    name: lastModifiedUser.FullName,
                    username: lastModifiedUser.Username,
                    timestamp: config.UpdateTS
                };
            }
        }

        res.json({
            success: true,
            config: settings || {}
        });
    } catch (error) {
        console.error('Error loading LHDN config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save LHDN configuration
router.post('/lhdn/save-config', async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { environment, middlewareUrl, clientId, clientSecret, timeout, retryEnabled } = req.body;

        // Input validation
        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        if (!['sandbox', 'production'].includes(environment)) {
            throw new Error('Invalid environment specified');
        }

        if (timeout && (isNaN(timeout) || timeout < 0)) {
            throw new Error('Timeout must be a positive number');
        }

        // Find current active configuration
        const currentConfig = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'LHDN',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        // Save configuration
        const settings = {
            environment,
            middlewareUrl,
            clientId,
            clientSecret,
            timeout: timeout || 30,
            retryEnabled: !!retryEnabled
        };

        if (currentConfig) {
            // Update existing configuration
            await currentConfig.update({
                Settings: settings,
                UpdateTS: sequelize.literal('GETDATE()')
            }, {
                transaction: t
            });
        } else {
            // Create new configuration if none exists
            await WP_CONFIGURATION.create({
                Type: 'LHDN',
                Settings: settings,
                IsActive: 1,
                UserID: req.user.id,
                CreateTS: sequelize.literal('GETDATE()'),
                UpdateTS: sequelize.literal('GETDATE()')
            }, {
                transaction: t
            });
        }

        // Log the configuration change
        await db.WP_LOGS.create({
            Description: `LHDN configuration ${currentConfig ? 'updated' : 'created'} by ${req.user.username}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.user.username,
            LogType: 'CONFIG',
            Module: 'LHDN',
            Action: 'UPDATE',
            Status: 'SUCCESS',
            UserID: req.user.id,
            Details: JSON.stringify({
                configId: currentConfig?.ID,
                environment,
                middlewareUrl
            })
        }, {
            transaction: t
        });

        await t.commit();

        res.json({ 
            success: true,
            message: `LHDN configuration ${currentConfig ? 'updated' : 'created'} successfully`,
            config: {
                environment,
                middlewareUrl,
                clientId,
                timeout,
                retryEnabled
                // Don't send clientSecret back
            }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error saving LHDN config:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Test LHDN connection
router.post('/lhdn/test-connection', async (req, res) => {
    try {
        const { clientId, clientSecret, environment, middlewareUrl } = req.body;

        // Input validation
        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        // Validate the credentials
        const validationResult = await tokenService.validateCredentials({
            clientId,
            clientSecret,
            environment,
            middlewareUrl
        });

        if (!validationResult.success) {
            return res.status(400).json({
                success: false,
                error: validationResult.error || 'Failed to validate credentials'
            });
        }

        res.json({
            success: true,
            message: 'Connection test successful',
            expiresIn: validationResult.expiresIn
        });
    } catch (error) {
        console.error('Error testing LHDN connection:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Add this new route for getting access token
router.get('/lhdn/access-token', async (req, res) => {
    try {
        const accessToken = await tokenService.getAccessToken(req);
        
        res.json({
            success: true,
            accessToken,
            expiryTime: req.session.tokenExpiryTime
        });
    } catch (error) {
        console.error('Error getting access token:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get XML configuration
router.get('/xml/get-config', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Get configuration from database
        const config = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'XML',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        // Parse settings if it's a string
        let settings = config?.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (error) {
                console.error('Error parsing settings:', error);
                settings = {};
            }
        }

        // Add last modified info if available
        if (config && config.UserID) {
            const lastModifiedUser = await db.WP_USER_REGISTRATION.findOne({
                where: { ID: config.UserID },
                attributes: ['FullName', 'Username']
            });
            if (lastModifiedUser) {
                settings.lastModifiedBy = {
                    name: lastModifiedUser.FullName,
                    username: lastModifiedUser.Username,
                    timestamp: config.UpdateTS
                };
            }
        }

        res.json({
            success: true,
            networkPath: settings?.networkPath || '',
            settings: settings || {
                networkPath: '',
                domain: '',
                username: ''
            }
        });
    } catch (error) {
        console.error('Error getting XML config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Validate XML network path
router.post('/xml/validate-path', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format and validate the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Test network path accessibility
        const accessResult = await testNetworkPathAccessibility(formattedPath, {
            serverName: domain || '',
            serverUsername: username,
            serverPassword: password
        });

        if (!accessResult.success) {
            throw new Error(accessResult.error || 'Network path validation failed');
        }

        res.json({
            success: true,
            message: 'Network path validation successful',
            formattedPath: accessResult.formattedPath
        });

    } catch (error) {
        console.error('Error validating XML path:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Save XML configuration
router.post('/xml/save-config', async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Find current active configuration
        const currentConfig = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'XML',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        // Save new configuration
        const settings = {
            networkPath: formattedPath,
            domain: domain || '',
            username,
            password
        };

        if (currentConfig) {
            // Update existing configuration
            await currentConfig.update({
                Settings: settings,
                UpdateTS: sequelize.literal('GETDATE()')
            }, {
                transaction: t
            });
        } else {
            // Create new configuration if none exists
            await WP_CONFIGURATION.create({
                Type: 'XML',
                Settings: settings,
                IsActive: 1,
                UserID: req.user.id,
                CreateTS: sequelize.literal('GETDATE()'),
                UpdateTS: sequelize.literal('GETDATE()')
            }, {
                transaction: t
            });
        }

        // Log the configuration change
        await db.WP_LOGS.create({
            Description: `XML configuration ${currentConfig ? 'updated' : 'created'} by ${req.user.username}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.user.username,
            LogType: 'CONFIG',
            Module: 'XML',
            Action: 'UPDATE',
            Status: 'SUCCESS',
            UserID: req.user.id,
            Details: JSON.stringify({
                configId: currentConfig?.ID,
                networkPath: formattedPath,
                domain: domain || ''
            })
        }, {
            transaction: t
        });

        await t.commit();

        // Clear any cached configuration
        if (req.app.get('xml_config')) {
            req.app.set('xml_config', null);
        }

        res.json({ 
            success: true,
            message: `XML configuration ${currentConfig ? 'updated' : 'created'} successfully`,
            config: {
                networkPath: formattedPath,
                domain: domain || '',
                username
                // Don't send password back
            }
        });
    } catch (error) {
        await t.rollback();
        console.error('Error saving XML config:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

module.exports = router; 