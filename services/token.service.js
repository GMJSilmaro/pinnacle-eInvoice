const axios = require('axios');
const { WP_CONFIGURATION, WP_USER_REGISTRATION } = require('../models');

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
  expiryTime: 0
};

async function getTokenSession() {
  try {
    const now = Date.now();
    
    // Check if we have a valid token in the global cache
    if (globalTokenCache.token && globalTokenCache.expiryTime > now) {
      console.log('Using existing token from global cache (expires in', 
        Math.round((globalTokenCache.expiryTime - now) / 1000), 'seconds)');
      return globalTokenCache.token;
    }
    
    console.log('No valid token in global cache, generating a new one');
    
    // Get a new token if needed
    const tokenData = await getTokenAsTaxPayer();
    
    if (!tokenData || !tokenData.access_token) {
      throw new Error('Failed to obtain access token');
    }

    // Store in global cache with expiry time
    globalTokenCache.token = tokenData.access_token;
    globalTokenCache.expiryTime = now + (tokenData.expires_in * 1000);
    
    // Add a buffer to avoid edge cases (5 minutes before actual expiry)
    const bufferTime = 5 * 60 * 1000;
    globalTokenCache.safeExpiryTime = globalTokenCache.expiryTime - bufferTime;
    
    console.log('New token generated and stored in global cache (expires in', 
      Math.round(tokenData.expires_in), 'seconds)');

    return tokenData.access_token;
  } catch (error) {
    console.error('Error getting token session:', error);
    throw error;
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

async function getAccessToken(req) {
  try {
    // Check if token exists in session and is not expired
    if (req.session?.accessToken && req.session?.tokenExpiryTime > Date.now()) {
      console.log('Using existing token from session (expires in', 
        Math.round((req.session.tokenExpiryTime - Date.now()) / 1000), 'seconds)');
      return req.session.accessToken;
    }

    console.log('No valid token in session, generating a new one');
    
    // Get new token
    const tokenData = await getTokenAsTaxPayer();
    
    if (tokenData && tokenData.access_token) {
      // Store token in session with expiry
      req.session.accessToken = tokenData.access_token;
      req.session.tokenExpiryTime = Date.now() + (tokenData.expires_in * 1000);
      
      // Add a buffer to avoid edge cases (5 minutes before actual expiry)
      const bufferTime = 5 * 60 * 1000; 
      req.session.tokenSafeExpiryTime = req.session.tokenExpiryTime - bufferTime;
      
      console.log('New token generated and stored in session (expires in', 
        Math.round(tokenData.expires_in), 'seconds)');
      
      return tokenData.access_token;
    }
    
    throw new Error('Failed to obtain access token');
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
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