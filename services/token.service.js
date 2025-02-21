const axios = require('axios');
const { WP_CONFIGURATION } = require('../models');

const generateAccessToken = async (req, userId = null) => {
  try {
    // Get LHDN configuration from database
    let config;
    
    if (userId) {
      // If userId is provided directly, use it
      config = await WP_CONFIGURATION.findActiveConfig('LHDN', userId);
    } else if (req.user && req.user.id) {
      // If userId is available in session, use it
      config = await WP_CONFIGURATION.findActiveConfig('LHDN', req.user.id);
    } else {
      // If no user ID is available, fall back to environment variables
      return await generateDefaultToken();
    }

    if (config && config.Settings) {
      // Parse settings
      const settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;
      
      if (settings.clientId && settings.clientSecret) {
        return await generateTokenWithCredentials(settings);
      }
    }

    // Fall back to default token generation if no valid config found
    return await generateDefaultToken();
  } catch (error) {
    console.error('Error generating access token:', error.response ? error.response.data : error.message);
    throw new Error('Failed to generate access token: ' + (error.response?.data?.error_description || error.message));
  }
};

// Helper function to generate token with specific credentials
const generateTokenWithCredentials = async (settings) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', settings.clientId);
    params.append('client_secret', settings.clientSecret);
    params.append('scope', 'InvoicingAPI');

    // Ensure proper URL construction
    let baseUrl = settings.middlewareUrl || process.env.ID_SRV_BASE_URL;
    
    // Remove any trailing slashes
    baseUrl = baseUrl.replace(/\/+$/, '');
    
    // Ensure the URL starts with https://
    if (!baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }
    
    console.log('Using base URL:', baseUrl); // Debug log
    
    const response = await axios.post(`${baseUrl}/connect/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Token response:', response.data); // Debug log
    return response.data.access_token;
  } catch (error) {
    console.error('Token generation error details:', {
      error: error.message,
      response: error.response?.data,
      config: error.config
    });
    throw error;
  }
};

// Helper function to generate token with default credentials
const generateDefaultToken = async () => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('scope', 'InvoicingAPI');

    // Ensure proper URL construction for default URL
    let baseUrl = process.env.ID_SRV_BASE_URL;
    
    // Remove any trailing slashes
    baseUrl = baseUrl.replace(/\/+$/, '');
    
    // Ensure the URL starts with https://
    if (!baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }

    console.log('Using default base URL:', baseUrl); // Debug log

    const response = await axios.post(`${baseUrl}/connect/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Default token response:', response.data); // Debug log
    return response.data.access_token;
  } catch (error) {
    console.error('Default token generation error details:', {
      error: error.message,
      response: error.response?.data,
      config: error.config
    });
    throw error;
  }
};

const checkTokenExpiry = (req) => {
  const accessToken = req.session.accessToken;
  const tokenExpiryTime = req.session.tokenExpiryTime;

  if (!accessToken || !tokenExpiryTime) {
    return false;
  }

  return Date.now() <= tokenExpiryTime;
};

// Function to test LHDN connection by generating a token
const generateToken = async (settings) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', settings.clientId);
    params.append('client_secret', settings.clientSecret);
    params.append('scope', 'InvoicingAPI');

    // Ensure proper URL construction
    let baseUrl = settings.middlewareUrl;
    
    // Remove any trailing slashes
    baseUrl = baseUrl.replace(/\/+$/, '');
    
    // Ensure the URL starts with https://
    if (!baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }
    
    console.log('Testing connection with base URL:', baseUrl);
    
    const response = await axios.post(`${baseUrl}/connect/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return {
      success: true,
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in / 60 // Convert seconds to minutes
    };
  } catch (error) {
    console.error('Token generation error details:', {
      error: error.message,
      response: error.response?.data,
      config: error.config
    });
    return {
      success: false,
      error: error.response?.data?.error_description || error.message
    };
  }
};

// Function to validate LHDN credentials without generating a token
const validateCredentials = async (settings) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', settings.clientId);
    params.append('client_secret', settings.clientSecret);
    params.append('scope', 'InvoicingAPI');

    // Ensure proper URL construction
    let baseUrl = settings.middlewareUrl || process.env.ID_SRV_BASE_URL;
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (!baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }
    
    console.log('Validating credentials with base URL:', baseUrl);
    
    // Only validate credentials without storing the token
    const response = await axios.post(`${baseUrl}/connect/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: status => status === 200 // Only consider 200 as success
    });

    return {
      success: true,
      expiresIn: response.data.expires_in / 60 // Convert seconds to minutes
    };
  } catch (error) {
    console.error('Credential validation error:', {
      error: error.message,
      response: error.response?.data,
      config: error.config
    });
    return {
      success: false,
      error: error.response?.data?.error_description || error.message
    };
  }
};

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
    
    return {
        baseUrl: settings.environment === 'production' 
            ? settings.productionUrl || settings.middlewareUrl 
            : settings.sandboxUrl || settings.middlewareUrl,
        environment: settings.environment,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        timeout: settings.timeout || 30000,
        retryEnabled: settings.retryEnabled || false
    };
}

// const getAccessToken = async (req) => {
//   try {
//     // Check if we have a valid token
//     if (checkTokenExpiry(req)) {
//       return req.session.accessToken;
//     }

//     // Generate new token if expired or not exists
//     const accessToken = await generateAccessToken(req);
    
//     // Store the new token in session
//     if (req.session) {
//       req.session.accessToken = accessToken;
//       req.session.tokenExpiryTime = Date.now() + (3600 * 1000); // Default 1 hour expiry
//     }
    
//     return accessToken;
//   } catch (error) {
//     throw error;
//   }
// };

async function getAccessToken(req) {
    try {
        const config = await getLHDNConfig();
        
        // Rest of the token acquisition logic using config instead of env vars
        const tokenUrl = `${config.baseUrl}/connect/token`;
        const data = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'client_credentials',
            scope: 'InvoicingAPI'
        });

        const response = await axios.post(tokenUrl, data, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.data && response.data.access_token) {
            // Store token in session
            req.session.accessToken = response.data.access_token;
            req.session.tokenExpiryTime = Date.now() + (response.data.expires_in * 1000);
            return response.data.access_token;
        }

        throw new Error('Failed to get access token');
    } catch (error) {
        console.error('Error getting access token:', error);
        throw error;
    }
}

module.exports = {
  generateAccessToken,
  checkTokenExpiry,
  getAccessToken,
  generateToken,
  validateCredentials
}; 