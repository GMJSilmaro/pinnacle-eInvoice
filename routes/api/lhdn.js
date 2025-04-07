const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache'); // Change to NodeCache
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const jsrender = require('jsrender');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { logger, apiLogger, versionLogger } = require('../../utils/logger');
const { getUnitType } = require('../../utils/UOM');
const { getInvoiceTypes } = require('../../utils/EInvoiceTypes');
const axiosRetry = require('axios-retry');
const moment = require('moment');
const { Op } = require('sequelize');

// Initialize cache with 5 minutes standard TTL
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes in seconds

// Database models
const { WP_INBOUND_STATUS, WP_USER_REGISTRATION, WP_COMPANY_SETTINGS, WP_CONFIGURATION, WP_OUTBOUND_STATUS, WP_LOGS } = require('../../models');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../../services/logging.service');

// Helper function for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to map invoice type names to codes
const getInvoiceTypeCode = (typeName) => {
    const typeMapping = {
        'Invoice': '01',
        'Credit Note': '02',
        'Debit Note': '03',
        'Refund Note': '04',
        'Self-billed Invoice': '11',
        'Self-billed Credit Note': '12',
        'Self-billed Debit Note': '13',
        'Self-billed Refund Note': '14'
    };

    // If typeName already starts with a valid code (e.g. "01 - Invoice"), extract it
    const codeMatch = typeName?.match(/^(0[1-4]|1[1-4])/);
    if (codeMatch) {
        return codeMatch[1];
    }

    // Otherwise look up the code from the mapping
    return typeMapping[typeName] || '01'; // Default to '01' if not found
};

// Enhanced delay function with exponential backoff
const calculateBackoff = (retryCount, baseDelay = 1000, maxDelay = 60000) => {
    const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount));
    const jitter = Math.random() * 1000; // Add some randomness to prevent thundering herd
    return backoff + jitter;
};

// Helper function to handle authentication errors
const handleAuthError = (req, res) => {
    // Clear session
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
    });

    // Return error response with redirect flag
    return res.status(401).json({
        success: false,
        message: 'Authentication failed. Please log in again.',
        redirect: '/login'
    });
};

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    trustProxy: false, // Disable trust proxy
    keyGenerator: function (req) {
        // Use session ID or user ID if available, fallback to IP
        return req.session?.user?.id || req.ip;
    },
    handler: function (req, res) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.',
            retryAfter: req.rateLimit.resetTime - Date.now()
        });
    }
});


axiosRetry.default(axios, { 
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
               error.response?.status === 429;
    }
});

// Document retrieval limitations
const getDocumentRetrievalLimits = () => {
    return {
        maxDocuments: 10000, // Maximum number of documents that can be returned
        timeWindowDays: 30,  // Time window in days for document retrieval
        validateTimeWindow: (dateTimeIssued) => {
            if (!dateTimeIssued) return false;
            const currentDate = new Date();
            const documentDate = new Date(dateTimeIssued);
            const diffTime = Math.abs(currentDate - documentDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 30; // Only allow documents within last 30 days
        }
    };
};

// Helper function to get LHDN config
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

    // Enhanced timeout configuration with reasonable defaults
    const defaultTimeout = 60000; // 60 seconds default
    const minTimeout = 30000;    // 30 seconds minimum
    const maxTimeout = 300000;   // 5 minutes maximum
    
    let timeout = parseInt(settings.timeout) || defaultTimeout;
    timeout = Math.min(Math.max(timeout, minTimeout), maxTimeout);

    return {
        baseUrl,
        environment: settings.environment,
        timeout: timeout,
        retryEnabled: settings.retryEnabled !== false, // Enable retries by default
        maxRetries: settings.maxRetries || 5,
        retryDelay: settings.retryDelay || 1000, // Base delay for exponential backoff
        maxRetryDelay: settings.maxRetryDelay || 60000 // Maximum retry delay
    };
}

// Helper function to get portal URL based on environment
function getPortalUrl(environment) {
    const portalUrls = {
        production: 'myinvois.hasil.gov.my',
        sandbox: 'preprod.myinvois.hasil.gov.my'
    };
    
    return portalUrls[environment] || portalUrls.sandbox; // Default to sandbox if environment not specified
}

// Enhanced document fetching function with smart caching
const fetchRecentDocuments = async (req) => {
    console.log('Starting enhanced document fetch process...');
    
    try {  
        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();
        console.log('Using LHDN configuration:', {
            environment: lhdnConfig.environment,
            baseUrl: lhdnConfig.baseUrl,
            timeout: lhdnConfig.timeout
        });

        // First, check if we have data in the database
        const dbDocuments = await WP_INBOUND_STATUS.findAll({
            order: [['dateTimeReceived', 'DESC']],
            limit: 1000 // Limit to latest 1000 records
        });

        // If we have database records, use them as the initial data source
        if (dbDocuments && dbDocuments.length > 0) {
            console.log(`Found ${dbDocuments.length} documents in database`);
            
            // Check if we need to refresh from API
            const lastSyncedDocument = await WP_INBOUND_STATUS.findOne({
                order: [['last_sync_date', 'DESC']],
                attributes: ['last_sync_date']
            });
            
            const currentTime = new Date();
            const syncThreshold = 15 * 60 * 1000; // 15 minutes in milliseconds
            const forceRefresh = req.query.forceRefresh === 'true';
            
            // Only fetch from API if forced or if last sync is older than threshold
            if (!forceRefresh && lastSyncedDocument && lastSyncedDocument.last_sync_date) {
                const timeSinceLastSync = currentTime - new Date(lastSyncedDocument.last_sync_date);
                if (timeSinceLastSync < syncThreshold) {
                    console.log('Using database records - last sync was', Math.round(timeSinceLastSync/1000/60), 'minutes ago');
                    return {
                        result: dbDocuments,
                        cached: true,
                        fromDatabase: true
                    };
                }
            }
            
            // If we're here, we need to refresh from API but still have DB records as fallback
            console.log('Database records exist but need refresh from API');
        } else {
            console.log('No documents found in database, will fetch from API');
        }

        // Attempt to fetch from API
        try {
            console.log('Fetching fresh data from LHDN API...');
            const documents = [];
            let pageNo = 1;
            const pageSize = 100; // MyInvois recommended page size
            let hasMorePages = true;
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 3;

            // Track rate limiting
            let rateLimitRemaining = null;
            let rateLimitReset = null;

            while (hasMorePages) {
                let retryCount = 0;
                let success = false;

                while (!success && retryCount < lhdnConfig.maxRetries) {
                    try {
                        // Check rate limit before making request
                        if (rateLimitRemaining !== null && rateLimitRemaining <= 0) {
                            const waitTime = (new Date(rateLimitReset).getTime() - Date.now()) + 1000; // Add 1s buffer
                            if (waitTime > 0) {
                                console.log(`Rate limit reached. Waiting ${Math.round(waitTime/1000)}s before continuing...`);
                                await delay(waitTime);
                            }
                        }

                        const response = await axios.get(
                            `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
                            {
                                params: {
                                    pageNo: pageNo,
                                    pageSize: pageSize,
                                    sortBy: 'dateTimeValidated',
                                    sortOrder: 'desc'
                                },
                                headers: {
                                    'Authorization': `Bearer ${req.session.accessToken}`,
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json'
                                },
                                timeout: lhdnConfig.timeout
                            }
                        );

                        // Update rate limit tracking from headers
                        rateLimitRemaining = parseInt(response.headers['x-rate-limit-remaining'] || '-1');
                        rateLimitReset = response.headers['x-rate-limit-reset'];

                        // Handle pagination
                        const { result, pagination } = response.data;
                        
                        if (!result || result.length === 0) {
                            console.log(`No more documents found after page ${pageNo-1}`);
                            hasMorePages = false;
                            break;
                        }

                        // Map the required fields from the API response
                        const mappedDocuments = result.map(doc => ({
                            ...doc,
                            issuerTin: doc.issuerTin || doc.supplierTin || doc.supplierTIN,
                            issuerName: doc.issuerName || doc.supplierName,
                            receiverId: doc.receiverId || doc.buyerTin || doc.buyerTIN,
                            receiverName: doc.receiverName || doc.buyerName,
                            receiverTIN: doc.receiverTIN || doc.buyerTIN,
                            receiverRegistrationNo: doc.receiverRegistrationNo || doc.buyerRegistrationNo,
                            receiverAddress: doc.receiverAddress || doc.buyerAddress,
                            receiverPostcode: doc.receiverPostcode || doc.buyerPostcode,
                            receiverCity: doc.receiverCity || doc.buyerCity,
                            receiverState: doc.receiverState || doc.buyerState,
                            receiverCountry: doc.receiverCountry || doc.buyerCountry,
                            receiverPhone: doc.receiverPhone || doc.buyerPhone,
                            uuid: doc.uuid,
                            submissionUid: doc.submissionUid,
                            longId: doc.longId,
                            internalId: doc.internalId,
                            typeName: doc.typeName,
                            typeVersionName: doc.typeVersionName,
                            dateTimeReceived: doc.dateTimeReceived,
                            dateTimeIssued: doc.dateTimeIssued,
                            dateTimeValidated: doc.dateTimeValidated,
                            status: doc.status,
                            documentStatusReason: doc.documentStatusReason,
                            totalSales: doc.totalSales || doc.total || doc.netAmount || 0,
                            totalExcludingTax: doc.totalExcludingTax || 0,
                            totalDiscount: doc.totalDiscount || 0,
                            totalNetAmount: doc.totalNetAmount || 0,
                            totalPayableAmount: doc.totalPayableAmount || 0
                        }));

                        console.log(mappedDocuments);

                        documents.push(...mappedDocuments);
                        console.log(`Successfully fetched page ${pageNo} with ${mappedDocuments.length} documents`);

                        // Check if we have more pages based on pagination info
                        if (pagination) {
                            hasMorePages = pageNo < pagination.totalPages;
                        } else {
                            hasMorePages = result.length === pageSize;
                        }

                        // Reset consecutive errors counter on success
                        consecutiveErrors = 0;
                        success = true;
                        pageNo++;

                        // Add a small delay between requests to be considerate
                        if (hasMorePages) {
                            await delay(500);
                        }

                    } catch (error) {
                        retryCount++;
                        console.error(`Error fetching page ${pageNo}:`, error.message);

                        // Handle authentication errors
                        if (error.response?.status === 401 || error.response?.status === 403) {
                            throw new Error('Authentication failed. Please log in again.');
                        }

                        // Handle rate limiting
                        if (error.response?.status === 429) {
                            const resetTime = error.response.headers["x-rate-limit-reset"];
                            rateLimitRemaining = 0;
                            rateLimitReset = resetTime;
                            
                            const waitTime = new Date(resetTime).getTime() - Date.now();
                            if (waitTime > 0) {
                                console.log(`Rate limited. Waiting ${Math.round(waitTime/1000)}s before retry...`);
                                await delay(waitTime);
                                retryCount--; // Don't count rate limit retries
                                continue;
                            }
                        }

                        // Track consecutive errors
                        if (retryCount >= lhdnConfig.maxRetries) {
                            consecutiveErrors++;
                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                console.error(`Max consecutive errors (${maxConsecutiveErrors}) reached. Stopping fetch.`);
                                hasMorePages = false;
                                break;
                            }
                            console.log(`Moving to next page after max retries for page ${pageNo}`);
                            pageNo++;
                            break;
                        }

                        // Exponential backoff for other errors
                        const backoffDelay = Math.min(
                            lhdnConfig.maxRetryDelay,
                            lhdnConfig.retryDelay * Math.pow(2, retryCount)
                        );
                        console.log(`Retrying page ${pageNo} after ${backoffDelay/1000}s delay (attempt ${retryCount + 1}/${lhdnConfig.maxRetries})...`);
                        await delay(backoffDelay);
                    }
                }

                if (!success && consecutiveErrors >= maxConsecutiveErrors) {
                    hasMorePages = false;
                }
            }

            if (documents.length === 0) {
                throw new Error('No documents could be fetched from the API');
            }

            console.log(`Fetch complete. Total documents retrieved: ${documents.length}`);
            
            // Save the fetched documents to database
            await saveInboundStatus({ result: documents });

            // Log successful document fetch
            await LoggingService.log({
                description: `Successfully fetched ${documents.length} documents from LHDN`,
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.SUCCESS,
                details: { count: documents.length }
            });

            return { 
                result: documents,
                cached: false,
                fromApi: true
            };
        } catch (error) {
            console.error('Error fetching from LHDN API:', error.message);
            
            // Log the error
            await LoggingService.log({
                description: `Error fetching documents from LHDN: ${error.message}`,
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.ERROR,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.FAILED,
                details: { error: error.message }
            });
            
            // If we have database records, use them as fallback
            if (dbDocuments && dbDocuments.length > 0) {
                console.log(`Using ${dbDocuments.length} database records as fallback`);
                return {
                    result: dbDocuments,
                    cached: true,
                    fromDatabase: true,
                    fallback: true,
                    error: error.message
                };
            }
            
            // If no database records, rethrow the error
            throw error;
        }
    } catch (error) {
        console.error('Error in document fetch:', error);
        return { 
            success: false, 
            message: `Error fetching documents: ${error.message}`,
            error: error 
        };
    }
};
// Caching function
const getCachedDocuments = async (req) => {
    const cacheKey = `recentDocuments_${req.session?.user?.TIN || 'default'}`;
    const forceRefresh = req.query.forceRefresh === 'true';
    
    // Get from cache if not forcing refresh
    let data = forceRefresh ? null : cache.get(cacheKey);

    if (!data) {
        try {
            // If not in cache or forcing refresh, fetch from source
            data = await fetchRecentDocuments(req);
            // Store in cache
            cache.set(cacheKey, data);
            console.log(forceRefresh ? 'Force refreshed documents and cached the result' : 'Fetched documents and cached the result');
        } catch (error) {
            console.error('Error fetching documents:', error);
            
            // Try to get data from database as a last resort
            try {
                console.log('Attempting final fallback to database...');
                const fallbackDocuments = await WP_INBOUND_STATUS.findAll({
                    order: [['dateTimeReceived', 'DESC']],
                    limit: 1000
                });
                
                if (fallbackDocuments && fallbackDocuments.length > 0) {
                    console.log(`Final fallback successful. Retrieved ${fallbackDocuments.length} documents from database.`);
                    return {
                        result: fallbackDocuments,
                        cached: true,
                        fromDatabase: true,
                        fallback: true,
                        error: error.message
                    };
                }
            } catch (dbError) {
                console.error('Database fallback also failed:', dbError.message);
            }
            
            throw error;
        }
    } else {
        console.log('Serving documents from cache');
    }

    return data;
};

const generateTemplateHash = (templateData) => {
    const crypto = require('crypto');
    // Create a string of key data that should trigger regeneration when changed
    const keyData = JSON.stringify({
        logo: templateData.CompanyLogo,
        companyInfo: {
            name: templateData.companyName,
            address: templateData.companyAddress,
            phone: templateData.companyPhone,
            email: templateData.companyEmail
        },
        documentInfo: {
            type: templateData.InvoiceType,
            code: templateData.InvoiceCode,
            uuid: templateData.UniqueIdentifier
        },
        items: templateData.items,
        totals: {
            subtotal: templateData.Subtotal,
            tax: templateData.TotalTaxAmount,
            total: templateData.TotalPayableAmount
        }
    });
    return crypto.createHash('md5').update(keyData).digest('hex');
};

// Helper function to generate JSON response file
const generateResponseFile = async (item) => {
    try {
        // Only generate for valid documents with required fields
        if (!item.uuid || !item.submissionUid || !item.longId || item.status !== 'Valid') {
            console.log(`Skipping response file generation for ${item.uuid}: missing required fields or invalid status`);
            return { success: false, message: 'Skipped: Missing required fields or invalid status' };
        }

         // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Get outgoing path configuration
        const outgoingConfig = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'OUTGOING',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        if (!outgoingConfig || !outgoingConfig.Settings) {
            console.log(`No outgoing path configuration found, skipping response file generation for ${item.uuid}`);
            return { success: false, message: 'No outgoing path configuration found' };
        }

        let settings = typeof outgoingConfig.Settings === 'string' 
            ? JSON.parse(outgoingConfig.Settings) 
            : outgoingConfig.Settings;

        if (!settings.networkPath) {
            console.log(`No network path configured in outgoing settings for ${item.uuid}`);
            return { success: false, message: 'No network path configured' };
        }

        // Try to get user registration details
        const userRegistration = await WP_USER_REGISTRATION.findOne({
            where: { ValidStatus: 1 },
            order: [['CreateTS', 'DESC']]
        });

        if (!userRegistration || !userRegistration.TIN) {
            console.log(`No active user registration found with TIN`);
            return { success: false, message: 'No active user registration found' };
        }

        // Try to get company settings based on user's TIN
        let companySettings = await WP_COMPANY_SETTINGS.findOne({
            where: { TIN: userRegistration.TIN }
        });

        // If no company settings found with user's TIN, try with document TINs
        if (!companySettings) {
            console.log(`No company settings found for user TIN: ${userRegistration.TIN}, trying document TINs`);
            
            // Check if the document's issuerTin or receiverId matches any company settings
            if (item.issuerTin === userRegistration.TIN || item.receiverId === userRegistration.TIN) {
                companySettings = await WP_COMPANY_SETTINGS.findOne({
                    where: { 
                        TIN: {
                            [Op.in]: [item.issuerTin, item.receiverId].filter(Boolean)
                        }
                    }
                });
            }
        }

        if (!companySettings) {
            console.log(`No matching company settings found for TINs: User(${userRegistration.TIN}), Issuer(${item.issuerTin}), Receiver(${item.receiverId})`);
            return { success: false, message: 'No matching company settings found' };
        }

        // Set company name from settings
        const companyName = companySettings.CompanyName;

        // Get document details from outbound status
        const outboundDoc = await WP_OUTBOUND_STATUS.findOne({
            where: { UUID: item.uuid }
        });

        let type, company, date;
        let invoiceTypeCode = "01"; // Default invoice type code
        let invoiceNo = item.internalId || "";

        // Define sanitization function early so we can use it for all path components and IDs
        const sanitizePath = (str) => {
            if (!str) return '';
            // Replace all characters that are problematic in file paths
            return String(str).replace(/[<>:"/\\|?*]/g, '_');
        };

        // Sanitize the invoiceNo immediately
        invoiceNo = sanitizePath(invoiceNo);

        // Always try to get inbound data first
        const inboundDoc = await WP_INBOUND_STATUS.findOne({
            where: { uuid: item.uuid }
        });

        if (inboundDoc) {
            // Use the helper function to get invoice type code from typeName
            invoiceTypeCode = getInvoiceTypeCode(inboundDoc.typeName);
            // Get and sanitize the internal ID
            invoiceNo = sanitizePath(inboundDoc.internalId || item.internalId || "");
        }

        // Try to use outbound data if available
        if (outboundDoc && outboundDoc.filePath) {
            try {
                // Extract type, company, and date from filePath
                const pathParts = outboundDoc.filePath.split(path.sep);
                if (pathParts.length >= 4) {
                    const dateIndex = pathParts.length - 2;
                    const companyIndex = pathParts.length - 3;
                    const typeIndex = pathParts.length - 4;

                    type = pathParts[typeIndex] || 'LHDN';
                    company = companyName;  // Use company name from settings
                    date = pathParts[dateIndex] || moment().format('YYYY-MM-DD');
                    
                    // Only update invoice number if we got it from outbound
                    if (outboundDoc.internalId) {
                        invoiceNo = sanitizePath(outboundDoc.internalId);
                    }
                    
                    // Try to get invoice type code from typeName if available
                    if (outboundDoc.typeName) {
                        const typeMatch = outboundDoc.typeName.match(/^(\d{2})/);
                        if (typeMatch) {
                            invoiceTypeCode = typeMatch[1];
                        }
                    }
                } else {
                    console.log(`Invalid path structure in outbound doc for UUID: ${item.uuid}, using default values`);
                    throw new Error('Invalid path structure');
                }
            } catch (pathError) {
                console.log(`Using default values due to path error for UUID: ${item.uuid}`);
                type = 'LHDN';
                company = companyName;
                date = moment().format('YYYY-MM-DD');
            }
        } else {
            // Use default values if no outbound document
            console.log(`No outbound document or path for UUID: ${item.uuid}, using default values`);
            type = 'LHDN';
            company = companyName;
            date = moment().format('YYYY-MM-DD');
        }

        // Ensure all path components are strings and valid
        type = String(type || 'LHDN');
        company = String(company || companyName);
        date = String(date || moment().format('YYYY-MM-DD'));

        // Sanitize path components 
        type = sanitizePath(type);
        company = sanitizePath(company);
        date = sanitizePath(date);
        
        // Ensure invoiceNo is sanitized again (in case it was updated after initial sanitization)
        invoiceNo = sanitizePath(invoiceNo);

        // Generate filename with new format: {invoiceTypeCode}_{invoiceNo}_{uuid}.json
        const fileName = `${invoiceTypeCode}_${invoiceNo}_${item.uuid}.json`;

        // Construct paths for outgoing files using configured network path
        const outgoingBasePath = path.join(settings.networkPath, type, company);
        
        // CHANGE: Previously tried to use a specific path from outboundDoc which might not exist
        // Now use a simpler path structure for all documents
        const outgoingJSONPath = outgoingBasePath;
        
        // Create directory structure recursively
        await fsPromises.mkdir(outgoingBasePath, { recursive: true });

        const jsonFilePath = path.join(outgoingJSONPath, fileName);

        // Check if JSON response file already exists
        try {
            await fsPromises.access(jsonFilePath);
            console.log(`Response file already exists for ${item.uuid}, skipping generation`);
            return { 
                success: true, 
                message: 'Response file already exists', 
                path: jsonFilePath,
                fileName: fileName,
                company: company
            };
        } catch (err) {
            // File doesn't exist, continue with creation
        }

        const portalUrl = getPortalUrl(lhdnConfig.environment);
        const LHDNUrl = `https://${portalUrl}/${item.uuid}/share/${item.longId}`;

        // Create JSON content
        const jsonContent = {
            "issueDate": moment(date).format('YYYY-MM-DD'),
            "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
            "invoiceTypeCode": invoiceTypeCode,
            "invoiceNo": invoiceNo,
            "uuid": item.uuid,
            "submissionUid": item.submissionUid,
            "longId": item.longId,
            "status": item.status,
            "lhdnUrl": LHDNUrl,
        };

        try {
            // Make sure the directory exists (extra check)
            const dirPath = path.dirname(jsonFilePath);
            await fsPromises.mkdir(dirPath, { recursive: true });
            
            // Write JSON file
            await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));
            console.log(`Generated response file: ${jsonFilePath}`);
            
            return { 
                success: true, 
                message: 'Response file generated successfully', 
                path: jsonFilePath,
                fileName: fileName,
                company: company
            };
        } catch (writeError) {
            console.error(`Error writing response file for ${item.uuid}:`, writeError);
            
            // If original path fails, try a fallback path - simplify the path further
            try {
                // Create a simpler fallback path without any potential problematic components
                const fallbackDirName = `LHDN_Fallback_${moment().format('YYYYMMDD')}`;
                const fallbackPath = path.join(settings.networkPath, fallbackDirName);
                await fsPromises.mkdir(fallbackPath, { recursive: true });
                
                // Use a very simple filename pattern that removes all special characters
                const simplifiedUuid = item.uuid.replace(/[^a-zA-Z0-9]/g, '');
                const fallbackFileName = `document_${simplifiedUuid}.json`;
                const fallbackFilePath = path.join(fallbackPath, fallbackFileName);
                
                await fsPromises.writeFile(fallbackFilePath, JSON.stringify(jsonContent, null, 2));
                console.log(`Generated response file at fallback location: ${fallbackFilePath}`);
                
                return { 
                    success: true, 
                    message: 'Response file generated at fallback location', 
                    path: fallbackFilePath,
                    fileName: fallbackFileName,
                    company: company
                };
            } catch (fallbackError) {
                console.error(`Fallback path also failed for ${item.uuid}:`, fallbackError);
                throw writeError; // throw the original error
            }
        }
    } catch (error) {
        console.error(`Error generating response file for ${item.uuid}:`, error);
        return { 
            success: false, 
            message: `Error generating response file: ${error.message}`,
            error: error 
        };
    }
};

// Enhanced save to database function
const saveInboundStatus = async (data) => {
    if (!data.result || !Array.isArray(data.result)) {
        console.warn("No valid data to process");
        await LoggingService.log({
            description: "No valid data to process for inbound status",
            logType: LOG_TYPES.WARNING,
            module: MODULES.API,
            action: ACTIONS.CREATE,
            status: STATUS.WARNING
        });
        return;
    }

    const batchSize = 100;
    const batches = [];
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second
    let successCount = 0;
    let errorCount = 0;
    let responseFileResults = [];
    
    for (let i = 0; i < data.result.length; i += batchSize) {
        batches.push(data.result.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches of ${batchSize} documents each`);
    
    // Log the start of batch processing
    await LoggingService.log({
        description: `Starting to process ${data.result.length} documents in ${batches.length} batches`,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.CREATE,
        status: STATUS.PENDING,
        details: { totalDocuments: data.result.length, batchCount: batches.length }
    });

    // Helper function to format dates
    const formatDate = (date) => {
        if (!date) return null;
        if (typeof date === 'string') return date;
        if (date instanceof Date) return date.toISOString();
        return null;
    };

    // Process batches sequentially to reduce concurrency
    for (const batch of batches) {
        // Process documents in smaller chunks to reduce deadlock probability
        const chunkSize = 10;
        for (let i = 0; i < batch.length; i += chunkSize) {
            const chunk = batch.slice(i, i + chunkSize);
            const results = await Promise.all(chunk.map(async item => {
                try {
                    await WP_INBOUND_STATUS.upsert({
                        uuid: item.uuid,
                        submissionUid: item.submissionUid,
                        longId: item.longId,
                        internalId: item.internalId,
                        typeName: item.typeName,
                        typeVersionName: item.typeVersionName,
                        issuerTin: item.issuerTin,
                        issuerName: item.issuerName,
                        receiverId: item.receiverId,
                        receiverName: item.receiverName,
                        dateTimeReceived: formatDate(item.dateTimeReceived),
                        dateTimeValidated: formatDate(item.dateTimeValidated),
                        status: item.status,
                        documentStatusReason: item.documentStatusReason,
                        totalSales: item.totalSales || item.total || item.netAmount || 0,
                        totalExcludingTax: item.totalExcludingTax || 0,
                        totalDiscount: item.totalDiscount || 0,
                        totalNetAmount: item.totalNetAmount || 0,
                        totalPayableAmount: item.totalPayableAmount || 0,
                        last_sync_date: formatDate(new Date()),
                        sync_status: 'success'
                    });

                    // Generate response file only for valid documents
                    if (item.status === 'Valid') {
                        const responseResult = await generateResponseFile(item);
                        responseFileResults.push(responseResult);
                    }

                    // If the inbound document status is "Failed"
                    if (item.status === 'Failed') {
                        // Update the corresponding outbound status record
                        await WP_OUTBOUND_STATUS.update(
                            { 
                                status: 'Failed', 
                                updated_at: sequelize.literal('GETDATE()') 
                            },
                            { 
                                where: { UUID: item.uuid } 
                            }
                        );
                    }

                    successCount++;
                    return { success: true, item };
                } catch (error) {
                    console.error(`Error processing document ${item.uuid}:`, error);
                    errorCount++;
                    return { success: false, item, error };
                }
            }));

            // Log results for this chunk
            const chunkSuccesses = results.filter(r => r.success).length;
            const chunkErrors = results.filter(r => !r.success).length;
            console.log(`Chunk processed: ${chunkSuccesses} successes, ${chunkErrors} errors`);
        }
    }

    // Summarize response file generation results
    const successfulResponses = responseFileResults.filter(r => r.success);
    if (successfulResponses.length > 0) {
        console.log(`Successfully generated ${successfulResponses.length} response files`);
        successfulResponses.forEach(result => {
            console.log(`Generated: ${result.fileName} for company ${result.company}`);
        });
    }

    console.log(`Save operation completed. Success: ${successCount}, Errors: ${errorCount}`);
    
    return { 
        successCount, 
        errorCount,
        responseFiles: {
            total: responseFileResults.length,
            successful: successfulResponses.length,
            results: responseFileResults
        }
    };
};

const requestLogger = async (req, res, next) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] New request:`, {
        method: req.method,
        path: req.path,
        params: req.params,
        query: req.query,
        user: req.session?.user?.id || 'anonymous'
    });
    req.requestId = requestId;
    next();
};

// Apply logging middleware
router.use(requestLogger);

// Routes
router.get('/documents/recent', async (req, res) => {
    console.log('LHDN documents/recent endpoint hit');
    try {
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        console.log('User from session:', req.session.user);
        
        try {
            // Directly query the database instead of using API
            console.log('Querying database directly for recent documents');
            const dbDocuments = await WP_INBOUND_STATUS.findAll({
                order: [['dateTimeReceived', 'DESC']],
                limit: 1000
            });
            
            console.log('Got documents from database, count:', dbDocuments.length);
            
            // Helper function to format dates for display
            const formatDateForDisplay = (dateString) => {
                if (!dateString) return null;
                try {
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return dateString; // Return original if invalid
                    return date.toISOString();
                } catch (err) {
                    console.log('Error formatting date:', dateString, err);
                    return dateString;
                }
            };
            
            // Helper function to format dates for UI display
            const formatDateForUI = (dateString) => {
                if (!dateString) return null;
                try {
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return null;
                    
                    // Format as "Apr 07, 2025, 01:14 PM"
                    return date.toLocaleString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                } catch (err) {
                    console.log('Error formatting date for UI:', dateString, err);
                    return null;
                }
            };
            
            const documents = dbDocuments.map(doc => {
                // Get submission and validation dates
                const receivedDate = doc.dateTimeReceived || doc.created_at;
                const validatedDate = doc.dateTimeValidated;
                
                return {
                    uuid: doc.uuid,
                    submissionUid: doc.submissionUid,
                    longId: doc.longId,
                    internalId: doc.internalId,
                    dateTimeIssued: formatDateForDisplay(doc.dateTimeIssued),
                    dateTimeReceived: formatDateForDisplay(receivedDate),
                    dateTimeValidated: formatDateForDisplay(validatedDate),
                    submissionDate: formatDateForDisplay(receivedDate),
                    validationDate: formatDateForDisplay(validatedDate),
                    
                    // UI display formatted dates
                    receivedDateFormatted: formatDateForUI(receivedDate),
                    validatedDateFormatted: formatDateForUI(validatedDate),
                    dateInfo: {
                        date: formatDateForUI(validatedDate || receivedDate),
                        type: validatedDate ? 'Validated' : 'Submitted',
                        tooltip: validatedDate ? 'LHDN Validation Date' : 'LHDN Submission Date'
                    },
                    
                    status: doc.status,
                    totalSales: doc.totalSales || 0,
                    totalExcludingTax: doc.totalExcludingTax || 0,
                    totalDiscount: doc.totalDiscount || 0,
                    totalNetAmount: doc.totalNetAmount || 0,
                    totalPayableAmount: doc.totalPayableAmount || 0,
                    issuerTin: doc.issuerTin,
                    issuerName: doc.issuerName,
                    receiverId: doc.receiverId,
                    receiverName: doc.receiverName,
                    supplierName: doc.issuerName,
                    typeName: doc.typeName,
                    typeVersionName: doc.typeVersionName,
                    documentStatusReason: doc.documentStatusReason,
                    documentCurrency: 'MYR'
                };
            });

            console.log('Sending response with documents:', documents.length);

            res.json({
                success: true,
                result: documents,
                metadata: {
                    total: documents.length,
                    cached: true,
                    directDb: true,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Error querying database:', error);
            
            const statusCode = error.response?.status || 500;
            res.status(statusCode).json({ 
                success: false, 
                error: {
                    code: error.code || 'DATABASE_ERROR',
                    message: error.message || 'An error occurred while querying the database',
                    details: error.original?.message || null,
                    timestamp: new Date().toISOString()
                }
            });
        }
    } catch (error) {
        console.error('Error in route handler:', error);
        
        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' || 
            error.response?.status === 401 || 
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({ 
            success: false, 
            error: {
                code: error.code || 'INTERNAL_SERVER_ERROR',
                message: error.message || 'An unexpected error occurred',
                details: error.response?.data?.error || error.original?.message || null,
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.get('/documents/recent-total', async (req, res) => {
    try {
        const totalCount = await WP_INBOUND_STATUS.count();
        res.json({ totalCount, success: true });
    } catch (error) {
        console.error('Error getting total count:', error);
        res.json({ 
            totalCount: 0, 
            success: false, 
            message: 'Failed to fetch recent documents' 
        });
    }
});

// Sync endpoint
router.get('/sync', async (req, res) => {
    try {
            const apiData = await fetchRecentDocuments(req);
             // Log the start of document fetching
            await LoggingService.log({
                description: 'Starting document fetch from LHDN',
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.PENDING
            });
            await saveInboundStatus(apiData);
            
            res.json({ success: true });
        } catch (error) {
            console.error('Error syncing with API:', error);
            res.status(500).json({
                success: false,
                message: `Failed to sync with API: ${error.message}`
            });
        }
});

// Update display-details endpoint to fetch all required data
router.get('/documents/:uuid/display-details', async (req, res) => {
    const lhdnConfig = await getLHDNConfig();

    try {
        const { uuid } = req.params;

        // Log the request details
        console.log('Fetching details for document:', {
            uuid,
            user: req.session.user,
            timestamp: new Date().toISOString()
        });

        // Check if user is logged in
        if (!req.session.user || !req.session.accessToken) {
            return res.redirect('/login');
        }

        // Get document details directly from LHDN API using raw endpoint
        console.log('Fetching raw document from LHDN API...');
        const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const documentData = response.data;
        console.log('Raw document data:', JSON.stringify(documentData, null, 2));

        // Check if document field exists and can be parsed
        if (documentData.document) {
            try {
                const parsedDocument = JSON.parse(documentData.document);
                console.log('Parsed UBL structure:', JSON.stringify(parsedDocument, null, 2));
            } catch (parseError) {
                console.log('Failed to parse document field:', parseError);
            }
        } else {
            console.log('No document field present, using top-level fields');
            console.log('Available top-level fields:', Object.keys(documentData));
        }

        // Check if user is receiver and document status is Invalid or Submitted
        const isReceiver = req.session.user.TIN === documentData.receiverTin;
        if (isReceiver && (documentData.status === 'Invalid' || documentData.status === 'Submitted')) {
            return res.status(403).json({
                success: false,
                message: `Document details cannot be viewed when status is ${documentData.status}. Please wait for the document to be validated.`
            });
        }

        // Get document details directly from LHDN API using raw endpoint
        console.log('Fetching raw document from LHDN API...');
        const detailsResponse = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const detailsData = detailsResponse.data;
        console.log('Raw document details:', JSON.stringify(detailsData, null, 2));


        // Process validation results if document is invalid
        let processedValidationResults = null;
        if (detailsData.validationResults) {
            processedValidationResults = {
                status: detailsData.status,
                validationSteps: detailsData.validationResults.validationSteps?.map(step => {
                    let errors = [];
                    if (step.error) {
                        if (Array.isArray(step.error.errors)) {
                            errors = step.error.errors.map(err => ({
                                code: err.code || 'VALIDATION_ERROR',
                                message: err.message || err.toString(),
                                field: err.field || null,
                                value: err.value || null,
                                details: err.details || null
                            }));
                        } else if (typeof step.error === 'object') {
                            errors = [{
                                code: step.error.code || 'VALIDATION_ERROR',
                                message: step.error.message || step.error.toString(),
                                field: step.error.field || null,
                                value: step.error.value || null,
                                details: step.error.details || null
                            }];
                        } else {
                            errors = [{
                                code: 'VALIDATION_ERROR',
                                message: step.error.toString(),
                                field: null,
                                value: null,
                                details: null
                            }];
                        }
                    }

                    return {
                        name: step.name || 'Validation Step',
                        status: step.status || 'Invalid',
                        error: errors.length > 0 ? { errors } : null,
                        timestamp: step.timestamp || new Date().toISOString()
                    };
                }) || [],
                summary: {
                    totalSteps: detailsData.validationResults.validationSteps?.length || 0,
                    failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
                    lastUpdated: new Date().toISOString()
                }
            };
        }

        // Return basic document info if document field is not present
        if (!documentData.document) {
            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: detailsData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: detailsData.validationResults,
                    supplierName: documentData.supplierName,
                    supplierSstNo: documentData.supplierSstNo,
                    supplierMsicCode: documentData.supplierMsicCode,
                    supplierAddress: documentData.supplierAddress,
                    receiverSstNo: documentData.receiverSstNo,
                    receiverRegistrationNo: documentData.receiverRegistrationNo,
                    receiverAddress: documentData.receiverAddress
                },
                supplierInfo: {
                    company: documentData.supplierName,
                    tin: documentData.supplierTin,
                    registrationNo: documentData.supplierRegistrationNo,
                    taxRegNo: documentData.supplierSstNo,
                    msicCode: documentData.supplierMsicCode,
                    address: documentData.supplierAddress
                },
                customerInfo: {
                    company: documentData.receiverName,
                    tin: documentData.receiverTin,
                    registrationNo: documentData.receiverRegistrationNo,
                    taxRegNo: documentData.receiverSstNo,
                    address: documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: documentData.totalSales,
                    totalExcludingTax: documentData.totalExcludingTax,
                    taxAmount: documentData.totalSales - (documentData.totalExcludingTax || 0),
                    irbmUniqueNo: documentData.uuid,
                    irbmlongId: documentData.longId
                }
            });
        }

        // If document field exists, parse it and extract detailed info
        try {
            const parsedDocument = JSON.parse(documentData.document);
            const validationResults = detailsData.validationResults;
            const invoice = parsedDocument.Invoice[0];
            const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
            const customerParty = invoice.AccountingCustomerParty[0].Party[0];

            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: detailsData.longId,
                    irbmlongId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: validationResults,
                    supplierName: documentData.issuerName,
                    supplierTIN: documentData.issuerTin,
                    supplierSstNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.supplierSstNo,
                    supplierMsicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress,
                    receiverName: documentData.receiverName,
                    receiverId: documentData.receiverTin,
                    receiverSstNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.receiverSstNo,
                    receiverRegistrationNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.receiverRegistrationNo,
                    receiverAddress: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.supplierName,
                    tin: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || documentData.supplierTin,
                    registrationNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.supplierRegistrationNo,
                    taxRegNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.supplierSstNo,
                    msicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    address: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.receiverName,
                    tin: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || documentData.receiverTin,
                    registrationNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.receiverRegistrationNo,
                    taxRegNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.receiverSstNo,
                    address: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || documentData.totalSales,
                    totalExcludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || documentData.totalExcludingTax,
                    taxAmount: invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ || (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid,
                    irbmlongId: documentData.longId
                }
            });
        } catch (parseError) {
            console.error('Error parsing document:', parseError);
            // Return basic document info if parsing fails
            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: documentData.longId,
                    irbmlongId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: validationResults,
                    supplierName: supplierParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.supplierName,
                    supplierSstNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.supplierSstNo,
                    supplierMsicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress,
                    receiverSstNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.receiverSstNo,
                    receiverRegistrationNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.receiverRegistrationNo,
                    receiverAddress: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.supplierName,
                    tin: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || documentData.supplierTin,
                    registrationNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.supplierRegistrationNo,
                    taxRegNo: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.supplierSstNo,
                    msicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    address: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.receiverName,
                    tin: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || documentData.receiverTin,
                    registrationNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || documentData.receiverRegistrationNo,
                    taxRegNo: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || documentData.receiverSstNo,
                    address: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || documentData.totalSales,
                    totalExcludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || documentData.totalExcludingTax,
                    taxAmount: invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ || (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid,
                    irbmlongId: documentData.longId
                }
            });
        }

    } catch (error) {
        console.error('Error fetching document details:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch document details',
            error: {
                name: error.name,
                details: error.response?.data || error.stack
            }
        });
    }
});


// Helper function to get template data
async function getTemplateData(uuid, accessToken, user) {
    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();
    
    // Get raw document data
    const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    // Get company data
    const company = await WP_COMPANY_SETTINGS.findOne({
        where: { TIN: user.TIN }
    });

    // Handle company logo
    const logoPath = company?.CompanyImage
        ? path.join(__dirname, '../../public', company.CompanyImage)
        : null;

    let logoBase64;
    try {
        const logoBuffer = await fsPromises.readFile(logoPath);
        const logoExt = path.extname(logoPath).substring(1);
        logoBase64 = `data:image/${logoExt};base64,${logoBuffer.toString('base64')}`;
    } catch (error) {
        logoBase64 = null;
    }

    // Parse document data
    const rawData = response.data;
    const documentData = JSON.parse(rawData.document);
    const invoice = documentData.Invoice[0];

    const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
    const customerParty = invoice.AccountingCustomerParty[0].Party[0];

   // Generate QR code
   console.log('Generating QR code...');
   const longId = rawData.longId || rawData.longID;
   const lhdnUuid = rawData.uuid;
   const portalUrl = getPortalUrl(lhdnConfig.environment);
   const qrCodeUrl = `https://${portalUrl}/${lhdnUuid}/share/${longId}`;
   console.log('QR Code URL:', qrCodeUrl);

   const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
       width: 200,
       margin: 2,
       color: { dark: '#000000', light: '#ffffff' }
   });
   console.log('✓ QR code generated successfully');


    // Get tax information from UBL structure
    const taxTotal = invoice.TaxTotal?.[0];
    const taxSubtotal = taxTotal?.TaxSubtotal?.[0];
    const taxCategory = taxSubtotal?.TaxCategory?.[0];
    const totalTaxAmount = taxTotal?.TaxAmount?.[0]._ || 0;
    const taxExempReason = taxCategory?.TaxExemptionReason?.[0]._ || 'Not Applicable';

    // Map the tax type according to SDK documentation
    const getTaxTypeDescription = (code) => {
        const taxTypes = {
            '01': 'Sales Tax',
            '02': 'Service Tax',
            '03': 'Tourism Tax',
            '04': 'High-Value Goods Tax',
            '05': 'Sales Tax on Low Value Goods',
            '06': 'Not Applicable',
            'E': 'Tax exemption'
        };
        return taxTypes[code] || code;
    };

    const idTypes = ['TIN', 'BRN', 'NRIC', 'Passport', 'Army', 'SST', 'TTX'];
    function getIdTypeAndNumber(partyIdentification) {
        const tinInfo = partyIdentification?.find(id => id.ID[0].schemeID === 'TIN');
        if (!tinInfo) {
            throw new Error('TIN is mandatory and not found.');
        }

        for (const idType of idTypes) {
            if (idType === 'TIN') continue;
            const idInfo = partyIdentification?.find(id => id.ID[0].schemeID === idType);
            if (idInfo) {
                return { type: idType, number: idInfo.ID[0]._ };
            }
        }
        return { type: 'NA', number: 'NA' };
    }

    const supplierIdInfo = getIdTypeAndNumber(supplierParty.PartyIdentification, idTypes);
    const customerIdInfo = getIdTypeAndNumber(customerParty.PartyIdentification, idTypes);

    

    // Process tax information for each line item
    const taxSummary = {};
    const items = await Promise.all(invoice.InvoiceLine?.map(async (line, index) => {
        const lineAmount = parseFloat(line.LineExtensionAmount?.[0]._ || 0);
        const lineTax = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]._ || 0);
        const quantity = parseFloat(line.InvoicedQuantity?.[0]._ || 0);
        const unitPrice = parseFloat(line.Price?.[0]?.PriceAmount?.[0]._ || 0);
        const discount = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);
        const unitCode = line.InvoicedQuantity?.[0]?.unitCode || 'NA';
        const taxlineCurrency = line.TaxTotal?.[0]?.TaxAmount?.[0]?.currencyID || 'MYR';
        const allowanceCharges = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);
    
        // Get unit type name
        const unitType = await getUnitType(unitCode);

        // Extract tax information for this line
        const lineTaxCategory = line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
        const taxTypeCode = lineTaxCategory?.ID?.[0]._ || '06';
        const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);
    
         // Calculate hypothetical tax for exempt items
         let hypotheticalTax = '0.00';
         let isExempt = taxTypeCode === 'E' || taxTypeCode === '06';
         if (isExempt) {
             // Use standard service tax rate of 8% if item is exempt
             hypotheticalTax = (lineAmount * 8 / 100).toLocaleString('en-MY', { 
                 minimumFractionDigits: 2, 
                 maximumFractionDigits: 2 
             });
         }
     
         // Add to tax summary
         const taxKey = `${taxTypeCode}_${taxPercent}`;
         if (!taxSummary[taxKey]) {
             taxSummary[taxKey] = {
                 taxType: taxTypeCode,
                 taxRate: taxPercent,
                 baseAmount: 0,
                 taxAmount: 0,
                 hypotheticalTaxAmount: 0
             };
         }
         taxSummary[taxKey].baseAmount += lineAmount;
         taxSummary[taxKey].taxAmount += lineTax;
         taxSummary[taxKey].hypotheticalTaxAmount += isExempt ? parseFloat(hypotheticalTax.replace(/,/g, '')) : 0;
     
    
        // Format quantity with exactly 2 decimal places
        const formattedQuantity = quantity.toLocaleString('en-MY', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: false
        });
    
        // Format unit price with exactly 4 decimal places
        const formattedUnitPrice = unitPrice.toLocaleString('en-MY', {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
            useGrouping: false
        });
    
        return {
            No: index + 1,
            Cls: line.Item?.[0]?.CommodityClassification?.[0]?.ItemClassificationCode?.[0]._ || 'NA',
            Description: line.Item?.[0]?.Description?.[0]._ || 'NA',
            Quantity: formattedQuantity,
            UOM: unitType, // Display unit type name instead of code
            UnitPrice: formattedUnitPrice,
            QtyAmount: lineAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Disc: discount === 0 ? '0.00' : discount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Charges: allowanceCharges.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
            LineTaxPercent: taxPercent.toFixed(2),
            LineTaxAmount: lineTax.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            HypotheticalTax: hypotheticalTax,  // Add hypothetical tax to line items
            Total: (parseFloat(line.ItemPriceExtension?.[0]?.Amount?.[0]._ || 0) + lineTax).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            TaxType: getTaxTypeDescription(taxTypeCode)
        };
    }) || []);

    const currentInvoiceType = invoice.InvoiceTypeCode?.[0]._ || 'NA';
    const einvoiceType = await getInvoiceTypes(currentInvoiceType);

    const taxSummaryArray = Object.values(taxSummary).map(summary => ({
        baseAmount: parseFloat(summary.baseAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        taxType: getTaxTypeDescription(summary.taxType),
        taxRate: parseFloat(summary.taxRate).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        taxAmount: parseFloat(summary.taxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
        hypotheticalTaxAmount: summary.taxType === 'E' || summary.taxType === '06' ? 
        parseFloat(summary.hypotheticalTaxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 
        '0.00'
    }));

    // Sort the taxSummaryArray based on the desired order
    const taxTypeOrder = ['Service Tax', 'Sales Tax', 'Tourism Tax', 'High-Value Goods Tax', 'Sales Tax on Low Value Goods', 'Not Applicable', 'Tax exemption', 'Other'];
    taxSummaryArray.sort((a, b) => taxTypeOrder.indexOf(a.taxType) - taxTypeOrder.indexOf(b.taxType));

    

    const templateData = {
        CompanyLogo: logoBase64,
        companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
        companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
        companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
        companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',

        internalId: rawData.internalId || 'NA',

        InvoiceTypeCode: einvoiceType,
        InvoiceTypeName: rawData.typeName || 'NA',
        InvoiceVersion: rawData.typeVersionName || 'NA',
        InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'NA',
        UniqueIdentifier: rawData.uuid || 'NA',
        lhdnLink: qrCodeUrl,
        
        dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString(),
        documentCurrency: invoice.DocumentCurrencyCode?.[0]._ || 'MYR',
        taxCurrency: invoice.TaxCurrencyCode?.[0]._ || 'MYR',
        TaxExchangeRate: invoice.TaxExchangeRate?.[0]?.CalculationRate?.[0]._ || '----',
        issueDate: invoice.IssueDate?.[0]._ || 'NA',
        issueTime: invoice.IssueTime?.[0]._ || 'NA',

        
        OriginalInvoiceRef: invoice.BillingReference?.[0]?.InvoiceDocumentReference?.[0]?.ID?.[0]._ || 'Not Applicable',
        OriginalInvoiceDateTime: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString() : 'Not Applicable',
        OriginalInvoiceStartDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || '-- / -- / --',
        OriginalInvoiceEndDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || '-- / -- / --',
        OriginalInvoiceDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || '',

        SupplierTIN: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
        SupplierRegistrationNumber: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
        SupplierSSTID: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
        SupplierMSICCode: supplierParty.IndustryClassificationCode?.[0]._ || '00000',
        SupplierBusinessActivity: supplierParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
        SupplierIdType: supplierIdInfo.type,
        SupplierIdNumber: supplierIdInfo.number,

        BuyerTIN: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
        BuyerName: customerParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
        BuyerPhone: customerParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
        BuyerEmail: customerParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',
        BuyerRegistrationNumber: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
        BuyerAddress: customerParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
        BuyerSSTID: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
        BuyerMSICCode: customerParty.IndustryClassificationCode?.[0]._ || '00000',
        BuyerBusinessActivity: customerParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
        BuyerIdType: customerIdInfo.type,
        BuyerIdNumber: customerIdInfo.number,

        Prepayment: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PrepaidAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalNetAmount: parseFloat(rawData.totalNetAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
        Subtotal: parseFloat(invoice.LegalMonetaryTotal?.[0]?.LineExtensionAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalExcludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalIncludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalPayableAmount: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalTaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    
        TaxRate: Object.values(taxSummary).reduce((sum, item) => sum + item.taxRate, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        items: items,

        TaxType: taxCategory?.ID?.[0]._ || '06',
        TaxSchemeId: getTaxTypeDescription(taxCategory?.ID?.[0]._ || '06'),

        // taxSummary: taxSummaryArray.map(item => ({
        //     taxType: item.taxType,
        //     taxRate: item.taxRate,
        //     totalAmount: item.baseAmount || '0.00',
        //     totalTaxAmount: item.taxAmount || '0.00'
        // })),

         taxSummary: taxSummaryArray.map(item => ({
            taxType: item.taxType,
            taxRate: item.taxRate,
            totalAmount: item.baseAmount || '0.00',
            totalTaxAmount: item.taxAmount || '0.00',
            hypotheticalTaxAmount: item.hypotheticalTaxAmount || '0.00',
            LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
        })),


        companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NNot ApplicableA',
        companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'Not Applicable',
        companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'Not Applicable',
        companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'Not Applicable',
        
        InvoiceVersionCode: invoice.InvoiceTypeCode?.[0].listVersionID || 'Not Applicable',
        InvoiceVersion: rawData.typeVersionName || 'NA',
        InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'Not Applicable',
        UniqueIdentifier: rawData.uuid || 'Not Applicable',
        LHDNlongId: longId || 'Not Applicable',

        dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleDateString('en-GB'),
        issueDate: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._).toLocaleDateString('en-GB') : 'Not Applicable',
        issueTime: invoice.IssueTime?.[0]._ || 'Not Applicable',

        startPeriodDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || 'Not Applicable',
        endPeriodDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || 'Not Applicable',
        dateDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || 'Not Applicable',

        qrCode: qrCodeDataUrl,
        QRLink: qrCodeUrl,
        DigitalSignature: rawData.digitalSignature || '-',
        validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString(),
    };
   
   return templateData;
}

//route to check if PDF exists
router.get('/documents/:uuid/check-pdf', async (req, res) => {
    const { uuid, longId } = req.params;
    const requestId = req.requestId;
    
    try {
        console.log(`[${requestId}] Checking PDF existence for ${uuid}`);
        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);
        const hashPath = path.join(tempDir, `${uuid}.hash`);

        console.log(`[${requestId}] Paths:`, {
            pdfPath,
            hashPath
        });

        try {
            await fsPromises.access(pdfPath);
            console.log(`[${requestId}] PDF exists at ${pdfPath}`);
            return res.json({ 
                exists: true,
                url: `/temp/${uuid}.pdf`
            });
        } catch (error) {
            console.log(`[${requestId}] PDF not found at ${pdfPath}`);
            return res.json({ exists: false });
        }
    } catch (error) {
        console.error(`[${requestId}] Error checking PDF:`, error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check PDF existence',
            error: error.message
        });
    }
});

// Update PDF generation route
router.post('/documents/:uuid/pdf', async (req, res) => {
    const { uuid } = req.params;
    const requestId = req.requestId;

    try {
        console.log(`[${requestId}] Starting PDF Generation Process for ${uuid}`);
        
        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);
        const hashPath = path.join(tempDir, `${uuid}.hash`);

        console.log(`[${requestId}] Paths:`, {
            tempDir,
            pdfPath,
            hashPath
        });

        // Check directory exists
        try {
            await fsPromises.access(tempDir);
            console.log(`[${requestId}] Temp directory exists`);
        } catch {
            console.log(`[${requestId}] Creating temp directory`);
            await fsPromises.mkdir(tempDir, { recursive: true });
        }

        // Auth check
        if (!req.session?.user) {
            console.log(`[${requestId}] No user session found`);
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        console.log(`[${requestId}] User authenticated:`, {
            id: req.session.user.id,
            TIN: req.session.user.TIN
        });

        const forceRegenerate = req.query.force === 'true';
        console.log(`[${requestId}] Force regenerate:`, forceRegenerate);

        // Get template data
        console.log(`[${requestId}] Fetching template data...`);
        const templateData = await getTemplateData(uuid, req.session.accessToken, req.session.user);
        console.log(`[${requestId}] Template data fetched successfully`);

        // Check if regeneration needed
        if (!forceRegenerate) {
            try {
                const storedHash = await fsPromises.readFile(hashPath, 'utf8');
                const currentHash = generateTemplateHash(templateData);

                console.log(`[${requestId}] Hash comparison:`, {
                    stored: storedHash.substring(0, 8),
                    current: currentHash.substring(0, 8),
                    matches: storedHash === currentHash
                });

                if (storedHash === currentHash) {
                    console.log(`[${requestId}] Using cached PDF`);
                    return res.json({
                        success: true,
                        url: `/temp/${uuid}.pdf`,
                        cached: true,
                        message: 'Loading existing PDF from cache...'
                    });
                }
            } catch (error) {
                console.log(`[${requestId}] Cache check failed:`, error.message);
            }
        }

        // Generate new PDF
        console.log(`[${requestId}] Generating new PDF...`);
        const newHash = generateTemplateHash(templateData);

        const templatePath = path.join(__dirname, '../../src/reports/original-invoice-template.html');
        console.log(`[${requestId}] Using template:`, templatePath);

        const templateContent = await fsPromises.readFile(templatePath, 'utf8');
        const template = jsrender.templates(templateContent);
        const html = template.render(templateData);

        console.log(`[${requestId}] Launching browser...`);
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
        
        console.log(`[${requestId}] Setting page content...`);
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        console.log(`[${requestId}] Generating PDF...`);
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
        });

        await browser.close();
        console.log(`[${requestId}] Browser closed`);

        // Save files
        console.log(`[${requestId}] Saving PDF and hash...`);
        await fsPromises.writeFile(pdfPath, pdfBuffer);
        await fsPromises.writeFile(hashPath, newHash);

        console.log(`[${requestId}] PDF generated successfully:`, {
            path: pdfPath,
            hash: newHash.substring(0, 8),
            size: pdfBuffer.length
        });

        return res.json({
            success: true,
            url: `/temp/${uuid}.pdf`,
            cached: false,
            message: 'New PDF generated successfully'
        });

    } catch (error) {
        console.error(`[${requestId}] PDF Generation Error:`, {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'Server is busy. Please try again later.',
                retryAfter: error.response.headers['retry-after'] || 30
            });
        }
        
        return res.status(500).json({
            success: false,
            message: `Failed to generate PDF: ${error.message}`,
            details: error.stack
        });
    }
});

// TIN Validation route
router.get('/taxpayer/validate/:tin', limiter, async (req, res) => {
    const { tin } = req.params;
    const { idType, idValue } = req.query;
    const requestId = req.requestId || req.headers['x-request-id'] || Math.random().toString(36).substring(2, 15);

    console.log(`[${requestId}] TIN Validation Request:`, {
        tin,
        idType,
        idValue
    });

    try {
        // Input validation
        if (!tin || !idType || !idValue) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: {
                        tin: !tin ? 'TIN is required' : null,
                        idType: !idType ? 'ID Type is required' : null,
                        idValue: !idValue ? 'ID Value is required' : null
                    }
                }
            });
        }

        // Validate ID Type
        const validIdTypes = ['NRIC', 'PASSPORT', 'BRN', 'ARMY'];
        if (!validIdTypes.includes(idType.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID Type',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: {
                        idType: `ID Type must be one of: ${validIdTypes.join(', ')}`
                    }
                }
            });
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Check cache first
        const cacheKey = `tin_validation_${tin}_${idType}_${idValue}`;
        const cachedResult = cache.get(cacheKey);

        if (cachedResult) {
            console.log(`[${requestId}] Returning cached validation result for TIN: ${tin}`);
            return res.json({
                success: true,
                result: cachedResult,
                cached: true
            });
        }

        // Prepare standard LHDN API headers according to SDK specification
        const headers = {
            'Authorization': `Bearer ${req.session.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
            'X-Date': req.headers['x-date'] || new Date().toISOString(),
            'X-Client-ID': req.headers['x-client-id'] || 'eInvoice-WebApp',
            'X-Forwarded-For': req.headers['x-forwarded-for'] || req.ip,
            'X-User-Agent': req.headers['x-user-agent'] || req.headers['user-agent'],
            'X-Channel': req.headers['x-channel'] || 'Web'
        };

        // Add User session related headers if available
        if (req.session?.user) {
            headers['X-User-ID'] = req.session.user.id;
            headers['X-User-TIN'] = req.session.user.TIN;
            headers['X-User-Name'] = req.session.user.username;
        }

        // Make API call to LHDN
        console.log(`[${requestId}] Calling LHDN API for TIN validation with standard headers...`);
        const response = await axios.get(
            `${lhdnConfig.baseUrl}/api/v1.0/taxpayer/validate/${tin}`,
            {
                params: {
                    idType: idType.toUpperCase(),
                    idValue: idValue
                },
                headers: headers,
                timeout: lhdnConfig.timeout
            }
        );

        // Log successful validation
        await LoggingService.log({
            description: `TIN Validation successful for ${tin}`,
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.VALIDATE,
            status: STATUS.SUCCESS,
            details: { tin, idType, idValue, requestId }
        });

        // Cache the successful result
        const validationResult = {
            isValid: true,
            tin: tin,
            idType: idType,
            idValue: idValue,
            timestamp: new Date().toISOString(),
            requestId: requestId
        };
        cache.set(cacheKey, validationResult, 300); // Cache for 5 minutes

        return res.json({
            success: true,
            result: validationResult,
            cached: false
        });

    } catch (error) {
        console.error(`[${requestId}] TIN Validation Error:`, error);

        // Log validation error
        await LoggingService.log({
            description: `TIN Validation failed for ${tin}: ${error.message}`,
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.VALIDATE,
            status: STATUS.FAILED,
            details: { tin, idType, idValue, error: error.message, requestId }
        });

        // Handle specific error cases
        if (error.response?.status === 404) {
            return res.status(404).json({
                success: false,
                message: 'Invalid TIN or ID combination',
                error: {
                    code: 'NOT_FOUND',
                    details: 'The provided TIN and ID combination cannot be found or is invalid',
                    requestId: requestId
                }
            });
        }

        if (error.response?.status === 400) {
            return res.status(400).json({
                success: false,
                message: 'Invalid input parameters',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: error.response.data?.message || 'The provided parameters are invalid',
                    requestId: requestId
                }
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'Rate limit exceeded',
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    details: 'Too many validation requests. Please try again later.',
                    retryAfter: error.response.headers['retry-after'] || 60,
                    requestId: requestId
                }
            });
        }

        // Generic error response
        return res.status(500).json({
            success: false,
            message: 'TIN validation failed',
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                details: error.message,
                requestId: requestId
            }
        });
    }
});

module.exports = router;