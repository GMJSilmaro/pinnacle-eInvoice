const axios = require('axios');
const { WP_CONFIGURATION, WP_USER_REGISTRATION, LHDN_TOKENS } = require('../models');

async function getConfig() {
  try {
    const config = await WP_CONFIGURATION.findOne({
      where: {
        Type: 'LHDN',
        IsActive: 1
      },
      order: [['CreateTS', 'DESC']]
    });

    if (!config) {
      throw new Error('LHDN configuration not found');
    }

    let settings = config.Settings;
    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch (parseError) {
        console.error('Error parsing LHDN settings JSON:', parseError);
        throw new Error('Invalid LHDN configuration format');
      }
    }

    // Validate essential settings
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid LHDN configuration structure');
    }

    // Validate required fields
    const requiredFields = ['clientId', 'clientSecret', 'middlewareUrl'];
    const missingFields = requiredFields.filter(field => !settings[field]);
    
    if (missingFields.length > 0) {
      console.warn(`LHDN configuration missing required fields: ${missingFields.join(', ')}`);
    }

    return settings;
  } catch (error) {
    if (error.name === 'SequelizeConnectionError' || error.name === 'SequelizeConnectionRefusedError') {
      console.error('Database connection error while fetching LHDN config:', error);
      throw new Error('Database connection error: ' + error.message);
    }
    
    console.error('Error getting LHDN configuration:', error);
    throw error;
  }
}

async function getTokenAsTaxPayer() {
  try {
    // Get LHDN configuration
    let settings;
    try {
      settings = await getConfig();
      if (!settings) {
        throw new Error('LHDN configuration is empty or invalid');
      }
    } catch (configError) {
      console.error('Configuration error:', configError);
      throw new Error(`Failed to get LHDN configuration: ${configError.message}`);
    }
    
    // Validate and construct base URL
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    if (!baseUrl) {
      throw new Error(`Missing ${settings.environment === 'production' ? 'middlewareUrl' : 'middlewareUrl'} in configuration`);
    }

    // Check if client credentials are configured
    if (!settings.clientId || !settings.clientSecret) {
      throw new Error('Missing client credentials in LHDN configuration');
    }

    // Ensure URL is properly formatted
    let formattedBaseUrl = baseUrl.trim();
    if (!formattedBaseUrl.startsWith('http://') && !formattedBaseUrl.startsWith('https://')) {
      formattedBaseUrl = 'https://' + formattedBaseUrl;
    }
    formattedBaseUrl = formattedBaseUrl.replace(/\/+$/, ''); // Remove trailing slashes

    const httpOptions = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'client_credentials',
      scope: 'InvoicingAPI'
    });

    console.log(`Requesting token from: ${formattedBaseUrl}/connect/token`);
    
    try {
      const response = await axios.post(
        `${formattedBaseUrl}/connect/token`, 
        httpOptions, 
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          validateStatus: status => status === 200,
          timeout: 10000 // 10 second timeout
        }
      );

      if(response.status === 200) return response.data;
      
      throw new Error(`Unexpected response: ${response.status}`);
    } catch (apiError) {
      // Check if this is an axios error with a response
      if (apiError.response) {
        console.error('API response error:', {
          status: apiError.response.status,
          data: apiError.response.data,
          headers: apiError.response.headers
        });
        
        // Rate limit handling
        if (apiError.response.status === 429) {
          const rateLimitReset = apiError.response.headers["x-rate-limit-reset"];
          if (rateLimitReset) {
            const resetTime = new Date(rateLimitReset).getTime();
            const currentTime = Date.now();
            const waitTime = resetTime - currentTime;

            if (waitTime > 0) {
              console.log('=======================================================================================');
              console.log('              LHDN Taxpayer Token API hitting rate limit HTTP 429                  ');
              console.log(`              Refetching................. (Waiting time: ${waitTime} ms)                  `);
              console.log('=======================================================================================');
              await new Promise(resolve => setTimeout(resolve, waitTime));
              return await getTokenAsTaxPayer();
            }            
          }
        }
        
        throw new Error(`API error (${apiError.response.status}): ${apiError.response.data?.error_description || apiError.response.data?.error || 'Unknown error'}`);
      }
      
      // Network or other error
      console.error('Network or request error:', apiError.message);
      throw new Error(`Network error: ${apiError.message}`);
    }
  } catch (err) {
    // Enhanced error message
    const errorMessage = err.message || 'Unknown token generation error';
    console.error('Token generation error:', {
      message: errorMessage,
      stack: err.stack
    });
    
    throw new Error(`Failed to get token: ${errorMessage}`);
  }
}

// Global token cache with expiry time
let globalTokenCache = {
  token: null,
  expiryTime: 0,
  safeExpiryTime: 0 // Add safe expiry time for proactive refresh
};

async function getTokenSession() {
  try {
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    // 1. Check in-memory cache first
    if (globalTokenCache.token && globalTokenCache.safeExpiryTime > now) {
      console.log('[Backend] Using existing token from in-memory cache (expires in',
        Math.round((globalTokenCache.expiryTime - now) / 1000), 'seconds)');
      return globalTokenCache.token;
    }

    console.log('[Backend] In-memory cache expired or empty. Checking database...');

    // 2. Check database for the latest valid token
    const latestToken = await LHDN_TOKENS.findOne({
      order: [['expiry_time', 'DESC']],
      where: {
        expiry_time: {
          [Sequelize.Op.gt]: new Date(now + bufferTime)
        }
      }
    });

    if (latestToken) {
      console.log('[Backend] Using existing token from database (expires in',
        Math.round((latestToken.expiry_time.getTime() - now) / 1000), 'seconds)');
      // Populate in-memory cache from database
      globalTokenCache.token = latestToken.access_token;
      globalTokenCache.expiryTime = latestToken.expiry_time.getTime();
      globalTokenCache.safeExpiryTime = globalTokenCache.expiryTime - bufferTime;
      return globalTokenCache.token;
    }

    console.log('[Backend] No valid token in cache or database. Generating a new one...');

    // 3. Get a new token if needed
    const tokenData = await getTokenAsTaxPayer();

    if (!tokenData || !tokenData.access_token) {
      console.error('[Backend] Failed to obtain access token: Empty response or missing access_token');
      throw new Error('Failed to obtain access token');
    }

    const newToken = tokenData.access_token;
    const newExpiryTime = now + (tokenData.expires_in * 1000);

    // 4. Store in in-memory cache
    globalTokenCache.token = newToken;
    globalTokenCache.expiryTime = newExpiryTime;
    globalTokenCache.safeExpiryTime = newExpiryTime - bufferTime;
    console.log('[Backend] New token stored in in-memory cache.');

    // 5. Save to database
    try {
      await LHDN_TOKENS.create({
        access_token: newToken,
        // Assuming refresh_token is not provided by getTokenAsTaxPayer based on the code
        // refresh_token: tokenData.refresh_token,
        expiry_time: new Date(newExpiryTime)
      });
      console.log('[Backend] New token successfully saved to database.');
    } catch (dbError) {
      console.error('[Backend] Error saving new token to database:', dbError);
      // Decide how to handle database save failure - for now, log and continue
    }


    console.log('[Backend] New token generated and stored (expires in',
      Math.round(tokenData.expires_in), 'seconds)');

    return newToken;
  } catch (error) {
    console.error('[Backend] Error getting token session:', error);
    // If token acquisition fails, clear any potentially invalid cached token
    globalTokenCache = { token: null, expiryTime: 0, safeExpiryTime: 0 };
    throw error; // Re-throwing to indicate failure
  }
}

// Token cache to store tokens and their expiry times
const tokenCache = new Map();

// Refresh threshold (5 minutes before expiry)
const REFRESH_THRESHOLD = 5 * 60 * 1000;

// Rate limiting configuration as per LHDN docs (12 RPM)
const RATE_LIMIT = {
  maxRequests: 12,
  windowMs: 60 * 1000, // 1 minute
  requests: new Map()
};

// Check rate limit
function checkRateLimit(clientId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;
  
  // Get or initialize requests for this client
  let clientRequests = RATE_LIMIT.requests.get(clientId) || [];
  
  // Remove old requests outside the current window
  clientRequests = clientRequests.filter(timestamp => timestamp > windowStart);
  
  // Check if we're over the limit
  if (clientRequests.length >= RATE_LIMIT.maxRequests) {
    const oldestRequest = clientRequests[0];
    const resetTime = oldestRequest + RATE_LIMIT.windowMs;
    return { allowed: false, resetTime };
  }
  
  // Add new request
  clientRequests.push(now);
  RATE_LIMIT.requests.set(clientId, clientRequests);
  
  return { allowed: true };
}

// async function getTokenAsTaxPayer(req, userID = null) {
//   try {
//     const userId = userID ? parseInt(userID, 10) : null;
//     const settings = await getLHDNConfig(userId);
//     const baseUrl = settings.baseUrl.trim().replace(/\/$/, '');
//     const clientId = settings.clientId.trim();

//     // Check cache first
//     const cachedToken = tokenCache.get(clientId);
//     if (cachedToken) {
//       const now = Date.now();
//       // Return cached token if it's not close to expiry
//       if (cachedToken.expiryTime > (now + REFRESH_THRESHOLD)) {
//         return cachedToken.token;
//       }
//     }

//     // Check rate limit
//     const rateLimitCheck = checkRateLimit(clientId);
//     if (!rateLimitCheck.allowed) {
//       const waitTime = rateLimitCheck.resetTime - Date.now();
//       console.log(`Rate limit reached. Waiting ${waitTime}ms before retry`);
//       await new Promise(resolve => setTimeout(resolve, waitTime));
//       return getTokenAsTaxPayer(req, userID);
//     }

//     // Format request according to LHDN API spec
//     const formData = new URLSearchParams();
//     formData.append('client_id', clientId);
//     formData.append('client_secret', settings.clientSecret.trim());
//     formData.append('grant_type', 'client_credentials');
//     formData.append('scope', 'InvoicingAPI');

//     const response = await axios({
//       method: 'POST',
//       url: `${baseUrl}/connect/token`,
//       data: formData,
//       headers: {
//         'Content-Type': 'application/x-www-form-urlencoded',
//         'Accept': 'application/json',
//         'Cache-Control': 'no-cache',
//         'User-Agent': 'PXCEInvoice/1.0'
//       },
//       maxRedirects: 5,
//       timeout: 10000, // 10 second timeout
//       validateStatus: null
//     });

//     if (response.status === 200 && response.data?.access_token) {
//       const token = {
//         access_token: response.data.access_token,
//         token_type: response.data.token_type,
//         expires_in: response.data.expires_in,
//         scope: response.data.scope
//       };

//       // Cache the token with expiry time
//       tokenCache.set(clientId, {
//         token,
//         expiryTime: Date.now() + (response.data.expires_in * 1000)
//       });

//       return token;
//     } else {
//       const errorMessage = response.data?.error_description || 
//                          response.data?.error || 
//                          'Authentication failed';
//       throw new Error(errorMessage);
//     }

//   } catch (err) {
//     if (err.response?.status === 429) {
//       // Implement exponential backoff for rate limiting
//       const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 60000);
//       await new Promise(resolve => setTimeout(resolve, backoffTime));
//       return getTokenAsTaxPayer(req, userID);
//     }

//     console.error('Token request error:', {
//       message: err.message,
//       response: {
//         status: err.response?.status,
//         data: err.response?.data
//       }
//     });

//     throw new Error(err.response?.data?.error_description || 
//                    err.response?.data?.error || 
//                    err.message);
//   }
// }

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;
  
  for (const [clientId, requests] of RATE_LIMIT.requests.entries()) {
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    if (validRequests.length === 0) {
      RATE_LIMIT.requests.delete(clientId);
    } else {
      RATE_LIMIT.requests.set(clientId, validRequests);
    }
  }
}, RATE_LIMIT.windowMs);

async function validateCustomerTin(settings, tin, idType, idValue, token) {
  try {
    if (!['NRIC', 'BRN', 'PASSPORT', 'ARMY'].includes(idType)) {
      throw new Error(`Invalid ID type. Only 'NRIC', 'BRN', 'PASSPORT', 'ARMY' are allowed`);
    }

    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.get(
      `${baseUrl}/api/v1.0/taxpayer/validate/${tin}?idType=${idType}&idValue=${idValue}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.status === 200) {
      return { status: 'success' };
    }
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await validateCustomerTin(settings, tin, idType, idValue, token);
        }
      }
    }
    throw err;
  }
}

function checkTokenExpiry(req) {
  const { accessToken, tokenExpiryTime } = req.session || {};
  return accessToken && tokenExpiryTime && Date.now() <= tokenExpiryTime;
}

// Function to validate LHDN credentials without generating a token
const validateCredentials = async (settings) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', settings.clientId);
    params.append('client_secret', settings.clientSecret);
    params.append('scope', 'InvoicingAPI');

    // Ensure proper URL construction
    let baseUrl = settings.baseUrl;
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

async function getAccessToken(user) {
  try {
    console.log('Getting access token for user:', user ? user.username : 'unknown');
    
    // Get LHDN configuration
    let settings;
    try {
      settings = await getConfig();
      if (!settings) {
        console.error('LHDN configuration is empty or invalid');
        // Return a success response with empty token to allow login
        return {
          success: true,
          token: null,
          expiry: Date.now() + (3600 * 1000), // 1 hour temporary
          expiresIn: 3600,
          warning: 'Missing or invalid LHDN configuration'
        };
      }
    } catch (configError) {
      console.error('Configuration error:', configError);
      // Return a success response with empty token to allow login
      return {
        success: true,
        token: null,
        expiry: Date.now() + (3600 * 1000), // 1 hour temporary
        expiresIn: 3600,
        warning: `Failed to get LHDN configuration: ${configError.message}`
      };
    }
    
    // Additional validation and logging for credentials
    if (!settings.clientId || !settings.clientSecret) {
      console.error('Missing client credentials in LHDN configuration. Check your configuration in the database.');
      // Return a success response with empty token to allow login
      return {
        success: true,
        token: null,
        expiry: Date.now() + (3600 * 1000), // 1 hour temporary
        expiresIn: 3600,
        warning: 'Missing client credentials in LHDN configuration'
      };
    }

    // Log masked credentials for debugging
    console.log('Using client credentials:', {
      clientId: settings.clientId,
      clientSecret: settings.clientSecret ? '****' + settings.clientSecret.substring(settings.clientSecret.length - 4) : 'null',
      environment: settings.environment || 'default',
      middlewareUrl: settings.middlewareUrl || 'not configured'
    });
    
    // Try to get a token
    try {
      const tokenData = await getTokenAsTaxPayer();
      
      if (!tokenData || !tokenData.access_token) {
        console.error('Failed to obtain access token - empty response');
        // Return a success response with empty token to allow login
        return {
          success: true,
          token: null,
          expiry: Date.now() + (3600 * 1000), // 1 hour temporary
          expiresIn: 3600,
          warning: 'Empty response from token service'
        };
      }
      
      // Return success with token info
      return {
        success: true,
        token: tokenData.access_token,
        expiry: Date.now() + (tokenData.expires_in * 1000),
        expiresIn: tokenData.expires_in
      };
    } catch (tokenError) {
      console.error('Token acquisition error:', tokenError);
      
      // Return a success response with empty token to allow login regardless of error
      return {
        success: true,
        token: null,
        expiry: Date.now() + (3600 * 1000), // 1 hour temporary
        expiresIn: 3600,
        warning: tokenError.message || 'Unknown error acquiring token'
      };
    }
  } catch (error) {
    console.error('Unexpected error in getAccessToken:', error);
    // Return a success response with empty token to allow login
    return {
      success: true,
      token: null,
      expiry: Date.now() + (3600 * 1000), // 1 hour temporary
      expiresIn: 3600,
      warning: 'Unexpected error acquiring token: ' + (error.message || 'Unknown error')
    };
  }
}

module.exports = {
  getTokenAsTaxPayer,
  getAccessToken,
  checkTokenExpiry,
  validateCredentials,
  validateCustomerTin,
  getTokenSession
};
