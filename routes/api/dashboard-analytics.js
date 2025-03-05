const express = require('express');
const router = express.Router();
const { WP_INBOUND_STATUS, WP_OUTBOUND_STATUS, sequelize, WP_CONFIGURATION, WP_USER_REGISTRATION } = require('../../models');
const { Op } = require('sequelize');
const { getAccessToken, checkTokenExpiry } = require('../../services/token.service');
const fetch = require('node-fetch');

async function getLHDNConfig() {
    const config = await WP_CONFIGURATION.findOne({
        where: {
            Type: 'LHDN',
            IsActive: 1
        },
        order: [['CreateTS', 'DESC']]
    });
  
    if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
    }
  
    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;
    
    const baseUrl = settings.environment === 'production' 
        ? settings.productionUrl || settings.middlewareUrl 
        : settings.sandboxUrl || settings.middlewareUrl;
  
    if (!baseUrl) {
        throw new Error('LHDN API URL not configured');
    }
  
    return {
        baseUrl,
        environment: settings.environment,
        timeout: Math.min(Math.max(parseInt(settings.timeout) || 60000, 30000), 300000),
        retryEnabled: settings.retryEnabled !== false,
        maxRetries: settings.maxRetries || 10, // Increased for polling
        retryDelay: settings.retryDelay || 3000, // 3 seconds base delay
        maxRetryDelay: settings.maxRetryDelay || 5000, // 5 seconds max delay
        rateLimit: {
            submissionRequests: settings.rateLimit?.submissionRequests || 300, // RPM
            minInterval: settings.rateLimit?.minInterval || 200 // ms between requests
        }
    };
  }

// Get Invoice Status Distribution
router.get('/invoice-status', async (req, res) => {
    try {
        // Get total counts first
        const outboundTotal = await WP_OUTBOUND_STATUS.count();
        const inboundTotal = await WP_INBOUND_STATUS.count();

        // Get counts for each status
        const [results] = await sequelize.query(`
            SELECT 
                'Submitted' as status,
                (SELECT COUNT(*) FROM WP_OUTBOUND_STATUS WHERE status = 'Submitted') as count,
                CAST(CAST((SELECT COUNT(*) FROM WP_OUTBOUND_STATUS WHERE status = 'Submitted') AS FLOAT) * 100 / 
                    NULLIF((SELECT COUNT(*) FROM WP_OUTBOUND_STATUS), 0) AS DECIMAL(5,2)) as percentage
            UNION ALL
            SELECT 
                'Pending' as status,
                (SELECT COUNT(*) FROM WP_OUTBOUND_STATUS WHERE status = 'Pending') as count,
                CAST(CAST((SELECT COUNT(*) FROM WP_OUTBOUND_STATUS WHERE status = 'Pending') AS FLOAT) * 100 / 
                    NULLIF((SELECT COUNT(*) FROM WP_OUTBOUND_STATUS), 0) AS DECIMAL(5,2)) as percentage
            UNION ALL
            SELECT 
                'Valid' as status,
                (SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Valid') as count,
                CAST(CAST((SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Valid') AS FLOAT) * 100 / 
                    NULLIF((SELECT COUNT(*) FROM WP_INBOUND_STATUS), 0) AS DECIMAL(5,2)) as percentage
            UNION ALL
            SELECT 
                'Invalid' as status,
                (SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Invalid') as count,
                CAST(CAST((SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Invalid') AS FLOAT) * 100 / 
                    NULLIF((SELECT COUNT(*) FROM WP_INBOUND_STATUS), 0) AS DECIMAL(5,2)) as percentage
            UNION ALL
            SELECT 
                'Cancelled' as status,
                (SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Cancelled') as count,
                CAST(CAST((SELECT COUNT(*) FROM WP_INBOUND_STATUS WHERE status = 'Cancelled') AS FLOAT) * 100 / 
                    NULLIF((SELECT COUNT(*) FROM WP_INBOUND_STATUS), 0) AS DECIMAL(5,2)) as percentage
        `);

        res.json(results);
    } catch (error) {
        console.error('Error fetching invoice status:', error);
        res.status(500).json({ error: 'Failed to fetch invoice status' });
    }
});

// Get LHDN System Status
router.get('/system-status', async (req, res) => {
    try {
        const lhdnConfig = await getLHDNConfig();
       // console.log(lhdnConfig);

        const baseUrl = lhdnConfig.baseUrl;
        const environment = lhdnConfig.environment;
        const timeout = lhdnConfig.timeout;
        const retryEnabled = lhdnConfig.retryEnabled;
        const maxRetries = lhdnConfig.maxRetries;
        const retryDelay = lhdnConfig.retryDelay;
   
        // Check API connection status
        const apiStatus = await checkTokenExpiry(req);
        let apiHealthy = null;

        if (apiStatus !== null) {
            apiHealthy = true;
        } else {
            apiHealthy = false;
        }
        // Get queue status
        const queueCount = await WP_INBOUND_STATUS.count({
            where: {
                status: 'Submitted'
            }
        });
        

        // Get last sync with proper date handling
        const [lastSyncResult] = await sequelize.query(`
           SELECT last_sync_date
           FROM WP_INBOUND_STATUS
           WHERE last_sync_date IS NOT NULL
           ORDER BY last_sync_date DESC
        `);

        //console.log(lastSyncResult);

        let latestSync = lastSyncResult?.[0]?.last_sync_date;
        if (latestSync === null) {    
            latestSync = 'No sync data';
        }else{
            latestSync = new Date(latestSync).toISOString();
        }
       // console.log(latestSync);

        res.json({
            apiStatus: apiStatus === null ? 'Connection Issues' : 'Connected',
            apiHealthy,
            queueCount,
            baseUrl,
            environment,
            timeout,
            retryEnabled,
            maxRetries,
            retryDelay,
            lastSync: latestSync
        });
    } catch (error) {
        console.error('Error fetching system status:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Get Top Customers
router.get('/top-customers', async (req, res) => {
    try {
        const [topCustomers] = await sequelize.query(`
                        SELECT 
                receiverName as CompanyName,
                COUNT(*) as invoiceCount,
                SUM(CAST(totalSales as DECIMAL(18,2))) as totalAmount,
                MAX(CONVERT(datetime2, dateTimeReceived)) as lastInvoiceDate,
                CASE 
                    WHEN MAX(CONVERT(datetime2, dateTimeReceived)) >= DATEADD(day, -30, GETDATE()) THEN '1'
                    ELSE '0'
                END as ValidStatus
            FROM WP_INBOUND_STATUS
            WHERE receiverName IS NOT NULL 
				AND status = 'valid'
                AND dateTimeReceived IS NOT NULL
                AND TRY_CONVERT(datetime2, dateTimeReceived) IS NOT NULL
            GROUP BY receiverName
            ORDER BY COUNT(*) DESC, SUM(CAST(totalSales as DECIMAL(18,2))) DESC
            OFFSET 0 ROWS
            FETCH NEXT 3 ROWS ONLY
        `);

        const formattedCustomers = topCustomers.map(customer => ({
            ...customer,
            CompanyImage: null,
            totalAmount: parseFloat(customer.totalAmount || 0).toFixed(2),
            invoiceCount: parseInt(customer.invoiceCount || 0),
            lastInvoiceDate: customer.lastInvoiceDate ? new Date(customer.lastInvoiceDate).toISOString() : null
        }));

        res.json(formattedCustomers);
    } catch (error) {
        console.error('Error fetching top customers:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

router.get('/online-users', async (req, res) => {
    try {
        //console.log('Fetching online users', req.session.user);
        const onlineUsers = await WP_USER_REGISTRATION.getOnlineUsers();
        res.json(onlineUsers);
    } catch (error) {
        console.error('Error fetching online users:', error);
        // Send a more graceful error response
        res.status(500).json({ 
            count: 0,
            users: [],
            error: 'Failed to fetch online users'
        });
    }
});

// Update user status endpoint
router.post('/update-user-status', async (req, res) => {
  try {
    const { userID, isActive } = req.body;
    console.log(userID, isActive);
    if (!userID) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const success = await WP_USER_REGISTRATION.updateUserStatus(userID, isActive);
    
    if (!success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to update user status'
      });
    }

    res.json({
      success: true,
      message: 'User status updated successfully'
    });
  } catch (error) {
    console.error('Error in update-user-status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Search Taxpayer TIN
router.get('/search-tin', async (req, res) => {
    try {
        const { taxpayerName, idType, idValue } = req.query;

        // Input validation
        if (!taxpayerName && (!idType || !idValue)) {
            return res.status(400).json({
                success: false,
                message: 'Either taxpayerName or both idType and idValue are required'
            });
        }

        if (idType && !idValue) {
            return res.status(400).json({
                success: false,
                message: 'idValue is required when idType is provided'
            });
        }

        if (idValue && !idType) {
            return res.status(400).json({
                success: false,
                message: 'idType is required when idValue is provided'
            });
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();
        const baseUrl = lhdnConfig.baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
        
        console.log('LHDN Config:', {
            baseUrl,
            environment: lhdnConfig.environment
        });

        // Get access token
        const accessToken = await getAccessToken(req);
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'Failed to get access token'
            });
        }

        // Construct the full URL with correct API path
        const apiUrl = `${baseUrl}/api/v1.0/taxpayer/search/tin`;
        console.log('Making request to:', apiUrl);

        // Make request to LHDN API with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), lhdnConfig.timeout);

        try {
            // Add query parameters directly to match the API signature
            const queryString = new URLSearchParams({
                ...(taxpayerName && { taxpayerName }),
                ...(idType && { idType }),
                ...(idValue && { idValue })
            }).toString();

            const finalUrl = `${apiUrl}?${queryString}`;
            console.log('Final URL:', finalUrl);

            const response = await fetch(finalUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeout);

            console.log('LHDN API Response Status:', response.status);
            
            const responseText = await response.text();
            console.log('LHDN API Response Body:', responseText);

            if (!response.ok) {
                let errorMessage = 'Unknown error';
                let errorData = {};
                
                try {
                    errorData = JSON.parse(responseText);
                    errorMessage = errorData.message || `Failed to search TIN (${response.status})`;
                } catch (e) {
                    console.error('Error parsing error response:', e);
                    errorMessage = responseText || `Failed to search TIN (${response.status})`;
                }

                return res.status(response.status).json({
                    success: false,
                    message: errorMessage,
                    error: errorData
                });
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error('Error parsing success response:', e);
                return res.status(500).json({
                    success: false,
                    message: 'Invalid response format from LHDN API'
                });
            }
            
            if (!data || !data.tin) {
                return res.status(404).json({
                    success: false,
                    message: 'No TIN found for the given criteria'
                });
            }

            res.json({
                success: true,
                tin: data.tin
            });

        } catch (fetchError) {
            if (fetchError.name === 'AbortError') {
                return res.status(504).json({
                    success: false,
                    message: 'Request timeout while searching TIN'
                });
            }
            console.error('Fetch error:', fetchError);
            throw fetchError;
        }

    } catch (error) {
        console.error('Error searching TIN:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Refresh Queue Status
router.get('/refresh-queue', async (req, res) => {
    try {
        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();
        
        // Get queue count from database or API
        // This is a placeholder - implement actual queue count logic based on your system
        const queueCount = await WP_OUTBOUND_STATUS.count({
            where: {
                Status: 'QUEUED'
            }
        });
        
        res.json({
            queueCount,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Error refreshing queue:', error);
        res.status(500).json({ error: 'Failed to refresh queue' });
    }
});

module.exports = router; 