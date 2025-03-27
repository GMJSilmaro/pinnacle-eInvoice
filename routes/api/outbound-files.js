const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const XLSX = require('xlsx');
const { processExcelData } = require('../../services/lhdn/processExcelData');
const { mapToLHDNFormat } = require('../../services/lhdn/lhdnMapper');
const { WP_OUTBOUND_STATUS, WP_INBOUND_STATUS, WP_LOGS, WP_CONFIGURATION, sequelize } = require('../../models');
const moment = require('moment');
const axios = require('axios');
const { Op } = require('sequelize');
const { validateAndFormatNetworkPath, testNetworkPathAccessibility } = require('../../config/paths');
const { logDBOperation } = require('../../utils/logger');
const { exec } = require('child_process');
const LHDNSubmitter = require('../../services/lhdn/lhdnSubmitter');
const { getDocumentDetails, cancelValidDocumentBySupplier } = require('../../services/lhdn/lhdnService');
const { getActiveSAPConfig } = require('../../config/paths');
const NodeCache = require('node-cache');
const fileCache = new NodeCache({ stdTTL: 60 }); // 1 minute cache instead of 5 minutes
// Add cache helper functions at the top after fileCache declaration
const CACHE_KEY_PREFIX = 'outbound_files';

/**
 * Generate a cache key with optional parameters for more granular caching`
 */
function generateCacheKey(params = {}) {
    const baseKey = `${CACHE_KEY_PREFIX}_list`;
    // Add additional cache parameters if needed
    if (Object.keys(params).length > 0) {
        const paramsStr = Object.entries(params)
            .map(([key, value]) => `${key}=${value}`)
            .join('_');
        return `${baseKey}_${paramsStr}`;
    }
    return baseKey;
}

/**
 * Invalidate file cache with optional targeted invalidation
 */
function invalidateFileCache(params = {}) {
    if (Object.keys(params).length > 0) {
        // Targeted invalidation
        const cacheKey = generateCacheKey(params);
        fileCache.del(cacheKey);
    } else {
        // Full invalidation
        const cacheKey = generateCacheKey();
        fileCache.del(cacheKey);
    }
    
    // Log cache invalidation
    console.log('Cache invalidated:', params);
}

/**
 * Check for status updates since the last check
 * @param {string} lastUpdateTime - ISO timestamp of the last update check
 * @returns {Promise<boolean>} - True if there are new updates
 */
async function checkForStatusUpdates(lastUpdateTime) {
    try {
        if (!lastUpdateTime) return true;
        
        const latestUpdate = await WP_OUTBOUND_STATUS.findOne({
            attributes: ['updated_at'],
            where: {
                updated_at: {
                    [Op.gt]: new Date(lastUpdateTime)
                }
            },
            order: [['updated_at', 'DESC']],
            raw: true
        });
        
        return !!latestUpdate;
    } catch (error) {
        console.error('Error checking for status updates:', error);
        return false;
    }
}

// Add new function to check for new files
async function checkForNewFiles(networkPath, lastCheck) {
    try {
        const types = ['Manual', 'Schedule'];
        let hasNewFiles = false;
        const lastCheckDate = new Date(lastCheck);

        // Fast check for recent files
        for (const type of types) {
            const typeDir = path.join(networkPath, type);
            
            // Skip if directory doesn't exist
            if (!fs.existsSync(typeDir)) continue;

            // Get list of company directories
            let companies;
            try {
                companies = await fsPromises.readdir(typeDir);
            } catch (err) {
                console.error(`Error reading type directory ${typeDir}:`, err);
                continue;
            }

            // Check each company directory
            for (const company of companies) {
                const companyDir = path.join(typeDir, company);
                
                // Skip if not a directory
                try {
                    const stat = await fsPromises.stat(companyDir);
                    if (!stat.isDirectory()) continue;
                    
                    // If the company directory itself is newer than our last check
                    if (new Date(stat.mtime) > lastCheckDate) {
                        return true;
                    }
                } catch (err) {
                    console.error(`Error checking company directory ${companyDir}:`, err);
                    continue;
                }

                // Get list of date directories
                let dates;
                try {
                    dates = await fsPromises.readdir(companyDir);
                } catch (err) {
                    console.error(`Error reading company directory ${companyDir}:`, err);
                    continue;
                }

                // Check each date directory
                for (const date of dates) {
                    const dateDir = path.join(companyDir, date);
                    
                    // Skip if not a directory
                    try {
                        const stat = await fsPromises.stat(dateDir);
                        if (!stat.isDirectory()) continue;
                        
                        // If the date directory itself is newer than our last check
                        if (new Date(stat.mtime) > lastCheckDate) {
                            return true;
                        }
                    } catch (err) {
                        console.error(`Error checking date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Get list of files
                    let files;
                    try {
                        files = await fsPromises.readdir(dateDir);
                    } catch (err) {
                        console.error(`Error reading date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Check if any file is newer than our last check
                    for (const file of files) {
                        const filePath = path.join(dateDir, file);
                        try {
                            const stats = await fsPromises.stat(filePath);
                            
                            // If any file is newer than our last check, return true
                            if (new Date(stats.mtime) > lastCheckDate) {
                                return true;
                            }
                        } catch (err) {
                            console.error(`Error checking file ${filePath}:`, err);
                            continue;
                        }
                    }
                }
            }
        }
        
        return hasNewFiles;
    } catch (error) {
        console.error('Error checking for new files:', error);
        return false;
    }
}

async function getOutgoingConfig() {
    const config = await WP_CONFIGURATION.findOne({
        where: {
            Type: 'OUTGOING',
            IsActive: 1
        },
        order: [['CreateTS', 'DESC']]
    });

    if (!config || !config.Settings) {
        throw new Error('Outgoing path configuration not found');
    }

    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;
    
    if (!settings.networkPath) {
        throw new Error('Outgoing network path not configured');
    }

    return settings;
};
/**
 * Read Excel file with optimized performance
 */
async function readExcelWithLogging(filePath) {
    try {
        // Use a more efficient approach to read Excel files
        // Only read the first sheet and the necessary data
        const workbook = XLSX.readFile(filePath, {
            cellFormula: false,      // Don't parse formulas
            cellHTML: false,         // Don't generate HTML
            cellNF: false,           // Don't parse number formats
            cellStyles: false,       // Don't parse styles
            cellDates: false,        // Don't convert dates
            sheetStubs: false,       // Don't generate stubs for empty cells
            sheetRows: 1000,         // Limit to first 1000 rows for performance
            bookImages: false,       // Don't parse images
            bookVBA: false           // Don't parse VBA
        });

        // Just get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert to JSON objects - only what we need
        const dataAsObjects = XLSX.utils.sheet_to_json(worksheet);
        const dataWithHeaders = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        return {
            dataWithHeaders,
            dataAsObjects,
            sheetNames: workbook.SheetNames,
            worksheet
        };
    } catch (error) {
        throw error;
    }
}

/**
 * Helper function to ensure directory exists
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fsPromises.access(dirPath);
        //console.log('Directory exists:', dirPath);
    } catch (error) {
        //console.log('Creating directory:', dirPath);
        await fsPromises.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Helper function to log errors with enhanced details
 * @param {string} description - Error description
 * @param {Error} error - Error object
 * @param {Object} options - Additional logging options
 */
async function logError(description, error, options = {}) {
    try {
        const logEntry = {
            Description: `${description}: ${error.message}`,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: options.logType || 'ERROR',
            Module: 'OUTBOUND_FILES',
            Action: options.action || 'LIST_ALL',
            Status: 'FAILED',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.error('Error logged:', {
            description,
            error: error.message,
            ...options
        });
    } catch (logError) {
        console.error('Error logging to database:', logError);
    }
}


/**
 * List all files from network directories with caching and duplicate filtering
 */
router.get('/list-all', async (req, res) => {
    console.log('Starting list-all endpoint');
    
    // Check authentication
    if (!req.session?.user) {
        console.log('Unauthorized access attempt - no session user');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Authentication required'
            }
        });
    }

    // Check if access token exists
    if (!req.session?.accessToken) {
        console.log('Unauthorized access attempt - no access token');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Access token required'
            }
        });
    }

    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        console.log('Generating cache key');
        const cacheKey = generateCacheKey();
        const { polling } = req.query;
        const realTime = req.query.realTime === 'true';
        
        // Get the latest status update timestamp
        console.log('Fetching latest status update');
        const latestStatusUpdate = await WP_OUTBOUND_STATUS.findOne({
            attributes: ['updated_at'],
            order: [['updated_at', 'DESC']],
            raw: true
        });
        console.log('Latest status update:', latestStatusUpdate);

        // Check cache first if not in real-time mode
        if (!realTime) {
            console.log('Checking cache');
            const cachedData = fileCache.get(cacheKey);
            if (cachedData) {
                console.log('Found cached data');
                // Use timestamp-based check for cache validity
                const cacheAge = new Date() - new Date(cachedData.timestamp);
                const maxCacheAge = polling ? 10 * 1000 : 30 * 1000; // 10 seconds for polling, 30 seconds otherwise

                try {
                    // Always check for new files when in polling mode
                    const hasNewFiles = polling ? 
                        await checkForNewFiles(cachedData.networkPath, cachedData.timestamp) : 
                        (cacheAge > maxCacheAge ? await checkForNewFiles(cachedData.networkPath, cachedData.timestamp) : false);
                    
                    // Check for status updates
                    const hasStatusUpdates = polling ? 
                        await checkForStatusUpdates(cachedData.lastStatusUpdate) :
                        (latestStatusUpdate && cachedData.lastStatusUpdate && 
                        new Date(latestStatusUpdate.updated_at) > new Date(cachedData.lastStatusUpdate));
                    
                    // If cache is valid, return cached data
                    if (!hasNewFiles && !hasStatusUpdates) {
                        console.log('Returning cached data');
                        return res.json({
                            success: true,
                            files: cachedData.files,
                            processLog: cachedData.processLog,
                            fromCache: true,
                            cachedAt: cachedData.timestamp,
                            lastStatusUpdate: cachedData.lastStatusUpdate,
                            realTime: realTime
                        });
                    }
                    
                    // Log why we're not using cache
                    if (hasNewFiles) console.log('Not using cache: New files detected');
                    if (hasStatusUpdates) console.log('Not using cache: Status updates detected');
                } catch (cacheError) {
                    console.error('Cache validation error:', cacheError);
                    // Continue with fresh data if cache validation fails
                }
            }
        }

        // Get active SAP configuration first since we need it for the network path
        console.log('Fetching SAP configuration');
        const config = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'SAP',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']],
            raw: true
        });

        if (!config || !config.Settings) {
            throw new Error('No active SAP configuration found');
        }

        // Parse Settings if it's a string
        let settings = config.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (parseError) {
                console.error('Error parsing SAP settings:', parseError);
                throw new Error('Invalid SAP configuration format');
            }
        }

        if (!settings.networkPath) {
            throw new Error('Network path not configured in SAP settings');
        }

        // Validate network path accessibility
        console.log('Validating network path:', settings.networkPath);
        const networkValid = await testNetworkPathAccessibility(settings.networkPath, {
            serverName: settings.domain || '',
            serverUsername: settings.username,
            serverPassword: settings.password
        });

        if (!networkValid.success) {
            throw new Error(`Network path not accessible: ${networkValid.error}`);
        }

        // Get inbound statuses for comparison
        console.log('Fetching inbound statuses');
        const inboundStatuses = await WP_INBOUND_STATUS.findAll({
            attributes: ['internalId', 'status', 'updated_at'],
            where: {
                status: {
                    [Op.like]: 'Invalid%'
                }
            },
            raw: true
        });

        // Create a map of inbound statuses for quick lookup
        const inboundStatusMap = new Map();
        inboundStatuses.forEach(status => {
            if (status.internalId) {
                inboundStatusMap.set(status.internalId, status);
            }
        });

        // Fetch outbound statuses that might need updates
        console.log('Fetching outbound statuses');
        let outboundStatusesToUpdate = [];
        if (inboundStatusMap.size > 0) {
            outboundStatusesToUpdate = await WP_OUTBOUND_STATUS.findAll({
                where: {
                    status: {
                        [Op.notIn]: ['Cancelled', 'Failed', 'Invalid']
                    }
                },
                raw: true
            });
        }
        
        // Process status updates in batches
        if (outboundStatusesToUpdate.length > 0) {
            console.log('Processing status updates');
            const batchSize = 100;
            const updatePromises = [];
            
            for (let i = 0; i < outboundStatusesToUpdate.length; i += batchSize) {
                const batch = outboundStatusesToUpdate.slice(i, i + batchSize);
                const batchPromises = [];
                
                for (const outbound of batch) {
                    if (outbound.invoice_number && inboundStatusMap.has(outbound.invoice_number)) {
                        const inbound = inboundStatusMap.get(outbound.invoice_number);
                        if (inbound.status.startsWith('Invalid')) {
                            batchPromises.push(
                                WP_OUTBOUND_STATUS.update(
                                    {
                                        status: inbound.status,
                                        updated_at: sequelize.literal('GETDATE()')
                                    },
                                    {
                                        where: { id: outbound.id }
                                    }
                                )
                            );
                        }
                    }
                }
                
                if (batchPromises.length > 0) {
                    updatePromises.push(Promise.all(batchPromises));
                }
            }
            
            if (updatePromises.length > 0) {
                await Promise.all(updatePromises);
                console.log('Updated outbound statuses');
            }
        }

        // Get existing submission statuses
        console.log('Fetching submission statuses');
        const submissionStatuses = await WP_OUTBOUND_STATUS.findAll({
            attributes: [
                'id',
                'UUID',
                'submissionUid',
                'fileName',
                'filePath',
                'invoice_number',
                'status',
                'date_submitted',
                'date_cancelled',
                'cancellation_reason',
                'cancelled_by',
                'updated_at'
            ],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        // Create status lookup map
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            const statusObj = {
                UUID: status.UUID,
                SubmissionUID: status.submissionUid,
                SubmissionStatus: status.status,
                DateTimeSent: status.date_submitted,
                DateTimeUpdated: status.updated_at,
                DateTimeCancelled: status.date_cancelled,
                CancelledReason: status.cancellation_reason,
                CancelledBy: status.cancelled_by,
                FileName: status.fileName,
                DocNum: status.invoice_number
            };
            
            if (status.fileName) statusMap.set(status.fileName, statusObj);
            if (status.invoice_number) statusMap.set(status.invoice_number, statusObj);
        });

        const files = [];
        const types = ['Manual', 'Schedule'];

        // Process directories
        console.log('Processing directories');
        for (const type of types) {
            const typeDir = path.join(settings.networkPath, type);
            try {
                await processTypeDirectory(typeDir, type, files, processLog, statusMap);
            } catch (dirError) {
                console.error(`Error processing ${type} directory:`, dirError);
                // Continue with other directories even if one fails
            }
        }

        // Create a map for latest documents
        console.log('Processing latest documents');
        const latestDocuments = new Map();

        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);
            }
        });

        // Convert map to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';
            
            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                date_cancelled: status?.DateTimeCancelled || null,
                cancellation_reason: status?.CancelledReason || null,
                cancelled_by: status?.CancelledBy || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null
            };
        });

        // Sort by modified time
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        // Update cache
        console.log('Updating cache');
        const cacheData = {
            files: mergedFiles,
            processLog,
            timestamp: new Date().toISOString(),
            lastStatusUpdate: latestStatusUpdate?.updated_at,
            networkPath: settings.networkPath
        };
        
        // Set shorter TTL for real-time mode
        if (realTime) {
            fileCache.set(cacheKey, cacheData, 15); // 15 seconds TTL for real-time mode
        } else {
            fileCache.set(cacheKey, cacheData);
        }

        console.log('Sending response');
        res.json({
            success: true,
            files: mergedFiles,
            processLog,
            fromCache: false,
            realTime: realTime
        });

    } catch (error) {
        console.error('Error in list-all:', error);
        await logError('Error listing outbound files', error, {
            action: 'LIST_ALL',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message,
            processLog,
            stack: error.stack // Include stack trace for debugging
        });
    }
});


/**
 * Check if a document has already been submitted
 */
router.get('/check-submission/:docNum', async (req, res) => {
    try {
        const { docNum } = req.params;
       // console.log('Checking submission for document:', docNum);

        const existingSubmission = await WP_OUTBOUND_STATUS.findOne({
            where: {
                [Op.or]: [
                    { uuid: docNum },
                    { invoice_number: docNum },
                    { fileName: { [Op.like]: `%${docNum}%` } }
                ]
            }
        });

        if (existingSubmission) {
            return res.json({
                exists: true,
                status: existingSubmission.status,
                submissionDate: existingSubmission.date_submitted,
                uuid: existingSubmission.uuid
            });
        }

        res.json({ exists: false });

    } catch (error) {
        console.error('Error checking submission:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add route to open Excel file
router.post('/:filename/open', async (req, res) => {
    try {
        const { filename } = req.params;
        const { type, company, date } = req.body;

        // Get SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error(config.error || 'Failed to get SAP configuration');
        }

        // Construct file path using config
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, filename);
        //console.log('Opening file from path:', filePath);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'The requested file was not found'
                }
            });
        }

        // Determine the OS and construct the appropriate command
        let command;
        switch (process.platform) {
            case 'win32':
                command = `start excel "${filePath}"`;
                break;
            case 'darwin':
                command = `open -a "Microsoft Excel" "${filePath}"`;
                break;
            case 'linux':
                command = `xdg-open "${filePath}"`;
                break;
            default:
                throw new Error('Unsupported operating system');
        }

        // Execute the command to open Excel
        exec(command, (error) => {
            if (error) {
                console.error('Error opening Excel file:', error);
                return res.status(500).json({
                    error: {
                        code: 'OPEN_ERROR',
                        message: 'Failed to open Excel file',
                        details: error.message
                    }
                });
            }

            res.json({
                success: true,
                message: 'Excel file opened successfully',
                filePath: filePath
            });
        });

    } catch (error) {
        console.error('Error opening Excel file:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to open Excel file',
                details: error.message
            }
        });
    }
}); 
/**
 * Process type directory
 */
async function processTypeDirectory(typeDir, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(typeDir, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access directory ${typeDir}:`, accessError);
            throw new Error(`Cannot access directory: ${typeDir}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read directory contents
        let companies;
        try {
            companies = await fsPromises.readdir(typeDir);
        } catch (readError) {
            console.error(`Error reading directory ${typeDir}:`, readError);
            throw new Error(`Failed to read directory contents: ${typeDir}`);
        }

        if (!companies || companies.length === 0) {
            console.log(`No companies found in directory: ${typeDir}`);
            return;
        }

        // Process all companies in parallel for better performance
        await Promise.all(companies.map(async company => {
            const companyDir = path.join(typeDir, company);
            try {
                const stats = await fsPromises.stat(companyDir);
                if (!stats.isDirectory()) {
                    return; // Skip if not a directory
                }
                await processCompanyDirectory(companyDir, company, type, files, processLog, statusMap);
            } catch (companyError) {
                console.error(`Error processing company ${company}:`, companyError);
                processLog.details.push({
                    company,
                    error: companyError.message,
                    type: 'COMPANY_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }));
    } catch (error) {
        console.error(`Error processing ${type} directory:`, error);
        processLog.details.push({
            directory: typeDir,
            error: error.message,
            type: 'DIRECTORY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
        throw error; // Re-throw to be handled by the main route handler
    }
}

/**
 * Process company directory
 */
async function processCompanyDirectory(companyDir, company, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(companyDir, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access company directory ${companyDir}:`, accessError);
            throw new Error(`Cannot access directory: ${companyDir}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read directory contents
        let dates;
        try {
            dates = await fsPromises.readdir(companyDir);
        } catch (readError) {
            console.error(`Error reading company directory ${companyDir}:`, readError);
            throw new Error(`Failed to read company directory contents: ${companyDir}`);
        }

        if (!dates || dates.length === 0) {
            console.log(`No dates found in company directory: ${companyDir}`);
            return;
        }

        // Process all dates in parallel for better performance
        await Promise.all(dates.map(async date => {
            const dateDir = path.join(companyDir, date);
            try {
                const stats = await fsPromises.stat(dateDir);
                if (!stats.isDirectory()) {
                    return; // Skip if not a directory
                }
                await processDateDirectory(dateDir, date, company, type, files, processLog, statusMap);
            } catch (dateError) {
                console.error(`Error processing date directory ${date}:`, dateError);
                processLog.details.push({
                    company,
                    date,
                    error: dateError.message,
                    type: 'DATE_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }));
    } catch (error) {
        console.error(`Error processing company directory ${company}:`, error);
        processLog.details.push({
            company,
            directory: companyDir,
            error: error.message,
            type: 'COMPANY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
    }
}

/**
 * Process date directory
 */
async function processDateDirectory(dateDir, date, company, type, files, processLog, statusMap) {
    try {
        // Validate and normalize date format
        const normalizedDate = moment(date, ['YYYY-MM-DD', 'YYYY-DD-MM']).format('YYYY-MM-DD');
        if (!normalizedDate || normalizedDate === 'Invalid date') {
            console.error(`Invalid date format in directory: ${date}`);
            processLog.summary.errors++;
            processLog.details.push({
                error: `Invalid date format in directory: ${date}. Expected format: YYYY-MM-DD`
            });
            return;
        }

        await ensureDirectoryExists(dateDir);
    
        const dirFiles = await fsPromises.readdir(dateDir);
        
        // Process files in batches to prevent memory overload
        const batchSize = 10;
        for (let i = 0; i < dirFiles.length; i += batchSize) {
            const batch = dirFiles.slice(i, i + batchSize);
            // Process batch of files in parallel
            await Promise.all(batch.map(file => 
                processFile(file, dateDir, normalizedDate, company, type, files, processLog, statusMap)
            ));
        }
    } catch (error) {
        console.error(`Error processing date directory ${date}:`, error);
        processLog.details.push({
            error: error.message,
            type: 'DATE_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
    }
}

/**
 * Validates file name format
 * Format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS
 * Examples: 
 * - 01_ARINV118965_eInvoice_20250127102244.xls (Main format)
 * - 01_IN-LABS-010001_eInvoice_20250128183637.xls (Alternative format)
 * XX - Document type (as per LHDN MyInvois SDK):
 * - 01: Invoice
 * - 02: Credit Note
 * - 03: Debit Note
 * - 04: Refund Note
 * - 11: Self-billed Invoice
 * - 12: Self-billed Credit Note
 * - 13: Self-billed Debit Note
 * - 14: Self-billed Refund Note
 * InvoiceNumber: The actual document number (any length)
 * eInvoice: Fixed text
 * YYYYMMDDHHMMSS: Timestamp
 */
function isValidFileFormat(fileName) {
    try {
        // Remove file extension
        const baseName = path.parse(fileName).name;
        
        // Define the regex pattern for both formats
        // Updated to be more flexible with invoice number format
        // Allows alphanumeric characters, hyphens, and underscores in the invoice number
        const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9][A-Z0-9-]*[A-Z0-9])_eInvoice_(\d{14})$/;
        const match = baseName.match(pattern);
        
        if (!match) {
            return false;
        }
        
        // Extract components
        const [, docType, invoiceNumber, timestamp] = match;
        
        // Validate document type (already enforced by regex (0[1-4]|1[1-4]))
        const docTypes = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note',
            '11': 'Self-billed Invoice',
            '12': 'Self-billed Credit Note',
            '13': 'Self-billed Debit Note',
            '14': 'Self-billed Refund Note'
        };

        if (!docTypes[docType]) {
            //console.log(`Invalid document type: ${docType}`);
          //  console.log('Valid document types:');
            Object.entries(docTypes).forEach(([code, type]) => {
              //  console.log(`- ${code}: ${type}`);
            });
            return false;
        }
        
        if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(invoiceNumber)) {
            return false;
        }
        
        // Validate timestamp format
        const year = parseInt(timestamp.substring(0, 4));
        const month = parseInt(timestamp.substring(4, 6));
        const day = parseInt(timestamp.substring(6, 8));
        const hour = parseInt(timestamp.substring(8, 10));
        const minute = parseInt(timestamp.substring(10, 12));
        const second = parseInt(timestamp.substring(12, 14));
        
        const date = new Date(year, month - 1, day, hour, minute, second);
        
        if (
            date.getFullYear() !== year ||
            date.getMonth() + 1 !== month ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second ||
            year < 2000 || year > 2100
        ) {
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error validating file name:', error);
        return false;
    }
}

function extractTotalAmount(data) {
    try {
        // Find the row with 'F' identifier (footer row) which contains the total amounts
        const footerRow = data.find(row => row[0] === 'F');
        if (footerRow) {
            // Looking at the raw data, LegalMonetaryTotal_PayableAmount is at index 108
            const payableAmount = footerRow[108];
            
            // Format the amount with currency and handle number formatting
            if (payableAmount !== undefined && payableAmount !== null) {
                const amount = Number(payableAmount);
                if (!isNaN(amount)) {
                    return `MYR ${amount.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    })}`;
                }
            }
        }

        // Alternative: Look for the amount in the header mapping
        const headerRow = data.find(row => 
            row.includes('LegalMonetaryTotal_PayableAmount')
        );
        
        if (headerRow) {
            const amountIndex = headerRow.indexOf('LegalMonetaryTotal_PayableAmount');
            // Get the value from the corresponding data row
            const dataRow = data.find(row => row[0] === 'F');
            if (dataRow && amountIndex >= 0) {
                const amount = Number(dataRow[amountIndex]);
                if (!isNaN(amount)) {
                    return `MYR ${amount.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    })}`;
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting total amount:', error);
        console.error('Data structure:', data);
        return null;
    }
}

/**
 * Helper function to extract buyer information
 */
function extractSupplierInfo(data) {
    try {
        return {
            registrationName: data[3]?.[25] || null,
        };
    } catch (error) {
        console.error('Error extracting buyer info:', error);
        return {};
    }
}


/**
 * Helper function to extract buyer information
 */
function extractBuyerInfo(data) {
    try {
        return {
            registrationName: data[3]?.[41] || null
        };
    } catch (error) {
        console.error('Error extracting buyer info:', error);
        return {};
    }
}

/**
 * Helper function to extract dates
 */
function extractDates(data) {
    try {
        // Look for date and time in specific Excel columns
        let issueDate = null;
        let issueTime = null;
        
        if (data && data.length > 2) {
            // Get date and time from third row
            issueDate = data[2]?.__EMPTY_3 || null;
            issueTime = data[2]?.__EMPTY_4 || null;
        }

        return {
            issueDate,
            issueTime
        };
    } catch (error) {
        console.error('Error extracting dates:', error);
        return {
            issueDate: null,
            issueTime: null
        };
    }
}

/**
 * 
 * Process individual file
 */
async function processFile(file, dateDir, date, company, type, files, processLog, statusMap) {
    processLog.summary.total++;
    const logEntry = { file, valid: false, error: null };

    try {
        // Check if it's an Excel file
        if (!file.match(/\.(xls|xlsx)$/i)) {
            logEntry.error = {
                code: 'INVALID_FILE_TYPE',
                message: 'Not an Excel file',
                details: 'Only .xls and .xlsx files are supported'
            };
            processLog.summary.invalid++;
            processLog.details.push(logEntry);
            return;
        }

        // Check file name format
        if (!isValidFileFormat(file)) {
            processLog.summary.invalid++;
            logEntry.error = {
                code: 'INVALID_FILE_FORMAT',
                message: 'Invalid file name format',
                details: 'File name must follow the format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS'
            };
            processLog.details.push(logEntry);
            return;
        }

        const filePath = path.join(dateDir, file);
        const stats = await fsPromises.stat(filePath);
        
        // Extract document type and invoice number from file name
        const baseName = path.parse(file).name;
        const [docType, invoiceNumber] = baseName.split('_');
        
        // Map document types to their descriptions
        const docTypes = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note',
            '11': 'Self-billed Invoice',
            '12': 'Self-billed Credit Note',
            '13': 'Self-billed Debit Note',
            '14': 'Self-billed Refund Note'
        };
        
        const submissionStatus = statusMap.get(file) || (invoiceNumber ? statusMap.get(invoiceNumber) : null);

        const excelData = await readExcelWithLogging(filePath);
        const buyerInfo = extractBuyerInfo(excelData.dataWithHeaders);
        const supplierInfo = extractSupplierInfo(excelData.dataWithHeaders);
        const dates = extractDates(excelData.dataAsObjects);
        const totalAmount = extractTotalAmount(excelData.dataWithHeaders);

        //console.log('Current Dates:', dates);
        const issueDate = dates.issueDate;
        const issueTime = dates.issueTime;

        //console.log('Issue Date:', issueDate);
       // console.log('Issue Time:', issueTime);
      
        files.push({
            type,
            company,
            date,
            fileName: file,
            filePath,
            size: stats.size,
            modifiedTime: stats.mtime,
            uploadedDate: stats.birthtime || stats.mtime,
            issueDate: issueDate,
            issueTime: issueTime,
            submissionDate: submissionStatus?.DateTimeSent || null,
            lastUpdated: submissionStatus?.DateTimeUpdated || null,
            status: submissionStatus?.SubmissionStatus || 'Pending',
            uuid: submissionStatus?.UUID,
            buyerInfo,
            supplierInfo,
            totalAmount: totalAmount,
            invoiceNumber,
            documentType: docTypes[docType] || 'Unknown',
            documentTypeCode: docType,
            source: type
        });

        processLog.summary.valid++;
        logEntry.valid = true;

    } catch (error) {
        processLog.summary.errors++;
        logEntry.error = {
            code: 'PROCESSING_ERROR',
            message: error.message,
            details: error.stack
        };
        console.error(`Error processing file ${file}:`, error);
    }

    processLog.details.push(logEntry);
}

/**
 * Submit document to LHDN
 */
router.post('/:fileName/submit-to-lhdn', async (req, res) => {
    try {

        const { fileName } = req.params;
        const { type, company, date, version } = req.body;

        // Basic auth check
        if (!req.session?.accessToken) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Not authenticated'
                }
            });
        }

        // Validate all required parameters with more context
        const paramValidation = [
            { name: 'fileName', value: fileName, description: 'Excel file name' },
            { name: 'type', value: type, description: 'Document type (e.g., Manual)' },
            { name: 'company', value: company, description: 'Company identifier' },
            { name: 'date', value: date, description: 'Document date' },
            { name: 'version', value: version, description: 'LHDN version (e.g., 1.0, 1.1)' }
        ];

        const missingParams = paramValidation
            .filter(param => !param.value)
            .map(param => ({
                name: param.name,
                description: param.description
            }));

        if (missingParams.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`,
                    details: missingParams,
                    help: 'Please ensure all required parameters are provided in the request body'
                }
            });
        }

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);

        // Check for existing submission
        const existingCheck = await submitter.checkExistingSubmission(fileName);
        if (existingCheck.blocked) {
            return res.status(409).json(existingCheck.response);
        }

        try {
            // Get and process document data
            const processedData = await submitter.getProcessedData(fileName, type, company, date);
            
            // Ensure processedData is valid before mapping
            if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PROCESSING_ERROR',
                        message: 'Failed to process Excel data - no valid documents found'
                    }
                });
            }

            // Map to LHDN format only once
            const lhdnJson = mapToLHDNFormat(processedData, version);
            if (!lhdnJson) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'MAPPING_ERROR',
                        message: 'Failed to map data to LHDN format'
                    }
                });
            }

            // Prepare document for submission
            const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
            if (!payload) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PREPARATION_ERROR',
                        message: 'Failed to prepare document for submission'
                    }
                });
            }

            // Submit to LHDN using the session token
            const result = await submitter.submitToLHDNDocument(payload.documents);
            
            // Process result and update status
            if (result.status === 'failed') {
                // Handle validation errors from LHDN
                if (result.error?.error?.details) {
                    const errorDetails = result.error.error.details;
                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: JSON.stringify(errorDetails)
                    });

                    return res.status(400).json({
                        success: false,
                        error: errorDetails,
                        docNum: invoice_number
                    });
                }
            }
            if (result.data?.acceptedDocuments?.length > 0) {
                const acceptedDoc = result.data.acceptedDocuments[0];
                // First update the submission status in database
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: acceptedDoc.uuid,
                    submissionUid: result.data.submissionUid,
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Submitted',
                });
            
                // Then update the Excel file
                const excelUpdateResult = await submitter.updateExcelWithResponse(
                    fileName,
                    type,
                    company,
                    date,
                    acceptedDoc.uuid,
                    invoice_number
                );
                
                if (!excelUpdateResult.success) {
                    console.error('Failed to update Excel file:', excelUpdateResult.error);
                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'EXCEL_UPDATE_ERROR',
                            message: 'Failed to update Excel file',
                            details: excelUpdateResult.error
                        }
                    });
                }
            
                const response = {
                    success: true,
                    submissionUID: result.data.submissionUid,
                    acceptedDocuments: result.data.acceptedDocuments,
                    docNum: invoice_number,
                    fileUpdates: {
                        success: excelUpdateResult.success,
                        ...(excelUpdateResult.success ? 
                            { 
                                excelPath: excelUpdateResult.outgoingPath,
                            } : 
                            { error: excelUpdateResult.error }
                        )
                    }
                };

                // Invalidate the cache after successful submission
                invalidateFileCache();

                return res.json(response);
            }

            // Handle rejected documents
            if (result.data?.rejectedDocuments?.length > 0) {
                //('Rejected Documents:', JSON.stringify(result.data.rejectedDocuments, null, 2));
                
                const rejectedDoc = result.data.rejectedDocuments[0];
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: rejectedDoc.uuid || 'NA',
                    submissionUid: 'NA',
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Rejected',
                    error: JSON.stringify(rejectedDoc.error || rejectedDoc)
                });

                return res.status(400).json({
                    success: false,
                    error: rejectedDoc.error || rejectedDoc,
                    docNum: invoice_number,
                    rejectedDocuments: result.data.rejectedDocuments
                });
            }

            // Update the error handling section
            if (!result.data?.acceptedDocuments?.length && !result.data?.rejectedDocuments?.length) {
                //console.log('Full LHDN Response:', JSON.stringify(result, null, 2));
                throw new Error(`No documents were accepted or rejected by LHDN. Response: ${JSON.stringify(result.data)}`);
            }

        } catch (processingError) {
            console.error('Error processing document data:', processingError);
            // Handle specific errors as needed
            throw processingError; // Re-throw other errors to be caught by outer catch block
        }

    } catch (error) {
        console.error('=== Submit to LHDN Error ===', {
            error: error.message,
            stack: error.stack
        });

        // Update status if possible
        if (error.invoice_number) {
            try {
                await submitter.updateSubmissionStatus({
                    invoice_number: error.invoice_number,
                    fileName,
                    filePath: error.filePath || fileName,
                    status: 'Failed',
                    error: error.message
                });
            } catch (statusError) {
                console.error('Failed to update status:', statusError);
            }
        }

        // Determine appropriate error response
        const errorResponse = {
            success: false,
            error: {
                code: 'SUBMISSION_ERROR',
                message: error.message || 'An unexpected error occurred during submission',
                details: error.stack
            }
        };

        // Set appropriate status code based on error type
        if (error.response?.status === 401) {
            errorResponse.error.code = 'AUTH_ERROR';
            return res.status(401).json(errorResponse);
        }

        if (error.message.includes('getActiveSAPConfig')) {
            errorResponse.error.code = 'CONFIG_ERROR';
            errorResponse.error.message = 'SAP configuration error: Unable to get active configuration';
            return res.status(500).json(errorResponse);
        }

        res.status(500).json(errorResponse);
    }
});


/**
 * Cancel document
 */
router.post('/:uuid/cancel', async (req, res) => {
    const loggedUser = req.session.user?.username;
    const uuid = req.params.uuid;
    const reason = req.body.reason;

    await logDBOperation(req.app.get('models'), req, `Started cancellation of document ${uuid}`, {
        module: 'OUTBOUND',
        action: 'CANCEL',
        details: { uuid, reason }
    });

    if (!uuid) {
        await logDBOperation(req.app.get('models'), req, 'Missing UUID for document cancellation', {
            module: 'OUTBOUND',
            action: 'CANCEL',
            status: 'FAILED'
        });

        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters: uuid' 
        });
    }

    try {
        // Get document details first
        const token = req.session.accessToken;

        const documentDetails = await getDocumentDetails(uuid, token);
        if (!documentDetails.status === 'success' || !documentDetails.data) {
            throw new Error('Document not found');
        }

        // Cancel the document using the service function
        const cancelResponse = await cancelValidDocumentBySupplier(uuid, reason, token);

        if (cancelResponse.status === 'success') {
            // Update local database statuses
            await Promise.all([
                WP_OUTBOUND_STATUS.update(
                    {
                        status: 'Cancelled',
                        date_cancelled: sequelize.literal('GETDATE()'),
                        cancelled_by: loggedUser,
                        cancellation_reason: reason,
                        updated_at: sequelize.literal('GETDATE()'),
                    },
                    { 
                        where: { uuid: uuid } 
                    }
                ),
                WP_INBOUND_STATUS.update(
                    {
                        status: 'Cancelled',
                        dateTimeReceived: sequelize.literal('GETDATE()'),
                    },
                    { 
                        where: { uuid } 
                    }
                )
            ]);

            await logDBOperation(req.app.get('models'), req, `Successfully cancelled document ${uuid}`, {
                module: 'OUTBOUND',
                action: 'CANCEL',
                status: 'SUCCESS',
                details: { docNum: documentDetails.data.invoice_number }
            });

            return res.json({
                success: true,
                message: 'Invoice cancelled successfully'
            });
        }

        throw new Error('Unexpected response from cancellation API');

    } catch (error) {
        console.error('Error cancelling invoice:', error);
        await logDBOperation(req.app.get('models'), req, `Error cancelling document: ${error.message}`, {
            module: 'OUTBOUND',
            action: 'CANCEL',
            status: 'FAILED',
            error
        });

        // Handle specific error cases
        if (error.response) {
            const errorData = error.response.data;
            
            // Check if document is already cancelled
            if (errorData?.error?.code === 'ValidationError' && 
                errorData?.error?.details?.some(d => d.message?.includes('already cancelled'))) {
                
                // Update local status
                await Promise.all([
                    WP_OUTBOUND_STATUS.update(
                        { status: 'Cancelled' },
                        { where: { uuid: uuid } }
                    ),
                    WP_INBOUND_STATUS.update(
                        { status: 'Cancelled' },
                        { where: { uuid } }
                    )
                ]);

                return res.json({
                    success: true,
                    message: 'Document was already cancelled'
                });
            }

            // Handle 404 specifically
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found in LHDN system',
                    error: errorData?.message || 'Resource not found'
                });
            }

            // Handle other API errors
            return res.status(error.response.status).json({
                success: false,
                message: 'Failed to cancel invoice',
                error: errorData?.error?.message || error.message
            });
        }

        // Log the error
        await WP_LOGS.create({
            Description: `Failed to cancel invoice: ${error.message}`,
            CreateTS: new Date().toISOString(),
            LoggedUser: loggedUser || 'System',
            LogType: 'ERROR',
            Module: 'OUTBOUND',
            Action: 'CANCEL',
            Status: 'FAILED'
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to cancel invoice',
            error: error.message
        });
    }
});

router.post('/:fileName/content', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, uuid, submissionUid } = req.body;

        // 1. Get and validate SAP configuration
        const config = await getActiveSAPConfig();
  
        if (!config.success || !config.networkPath) {
            throw new Error('Invalid SAP configuration: ' + (config.error || 'No network path configured'));
        }

        // 2. Validate network path
        const networkValid = await testNetworkPathAccessibility(config.networkPath, {
            serverName: config.domain || '',
            serverUsername: config.username,
            serverPassword: config.password
        });
        // console.log('\nNetwork Path Validation:', networkValid);

        if (!networkValid.success) {
            throw new Error(`Network path not accessible: ${networkValid.error}`);
        }

        // 3. Construct and validate file path
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);

        // 4. Check if directories exist
        const typeDir = path.join(config.networkPath, type);
        const companyDir = path.join(typeDir, company);
        const dateDir = path.join(companyDir, formattedDate);

        // Ensure directories exist
        await ensureDirectoryExists(typeDir);
        await ensureDirectoryExists(companyDir);
        await ensureDirectoryExists(dateDir);

        // 5. Check if file exists
        const fileExists = fs.existsSync(filePath);

        if (!fileExists) {
            console.error('\nFile Not Found:', {
                fileName,
                path: filePath,
                type,
                company,
                date: formattedDate
            });
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: `File not found: ${fileName}`,
                    details: {
                        path: filePath,
                        type,
                        company,
                        date: formattedDate,
                        directories: {
                            typeDir: fs.existsSync(typeDir),
                            companyDir: fs.existsSync(companyDir),
                            dateDir: fs.existsSync(dateDir)
                        }
                    }
                }
            });
        }

        // 6. Read Excel file
        // console.log('\nReading Excel file...');
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
            console.log('Excel file read successfully');
        } catch (readError) {
            console.error('Error reading Excel file:', readError);
            throw new Error(`Failed to read Excel file: ${readError.message}`);
        }

        // 7. Process Excel data
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, {
            raw: true,
            defval: null,
            blankrows: false
        });

        // 8. Process the data
        const processedData = processExcelData(data);
        console.log('\nExcel data processed successfully');

        // 9. Create outgoing directory structure
        const outgoingConfig = await getOutgoingConfig();
        const outgoingBasePath = path.join(outgoingConfig.networkPath, type, company, formattedDate);
        await ensureDirectoryExists(outgoingBasePath);

        // 10. Copy the original Excel file to the outgoing directory
        const outgoingFilePath = path.join(outgoingBasePath, fileName);
        await fsPromises.copyFile(filePath, outgoingFilePath);

        // 11. Update the copied Excel file with UUID and submissionUid
        const outgoingWorkbook = XLSX.readFile(outgoingFilePath);
        const outgoingWorksheet = outgoingWorkbook.Sheets[outgoingWorkbook.SheetNames[0]];

        const range = XLSX.utils.decode_range(outgoingWorksheet['!ref']);
        for (let R = 0; R <= range.e.r; ++R) {
            // Update UUID field (_1)
            const uuidCell = XLSX.utils.encode_cell({r: R, c: 1}); // Column _1
            if (outgoingWorksheet[uuidCell]) {
                outgoingWorksheet[uuidCell].v = uuid;
                outgoingWorksheet[uuidCell].w = uuid;
            }

            // Update Internal Reference field (_2)
            const refCell = XLSX.utils.encode_cell({r: R, c: 2}); // Column _2
            if (outgoingWorksheet[refCell]) {
                outgoingWorksheet[refCell].v = submissionUid;
                outgoingWorksheet[refCell].w = submissionUid;
            }
        }

        // Save the updated workbook
        XLSX.writeFile(outgoingWorkbook, outgoingFilePath);

        res.json({
            success: true,
            content: processedData,
            outgoingPath: outgoingFilePath
        });

    } catch (error) {
        console.error('\nError in file content endpoint:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'READ_ERROR',
                message: 'Failed to read file content',
                details: error.message,
                stack: error.stack
            }
        });
    }
});

/**
 * Get submission details and update longId
 */
router.get('/submission/:submissionUid', async (req, res) => {
    try {
        const { submissionUid } = req.params;
        
        // Basic auth check
        if (!req.session?.accessToken) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Not authenticated'
                }
            });
        }

        const token = req.session.accessToken;
        
        // Call LHDN API to get submission details
        const response = await axios.get(
            `https://preprod-api.myinvois.hasil.gov.my/api/v1.0/documentsubmissions/${submissionUid}?pageNo=1&pageSize=10`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const submissionData = response.data;
        
        // Extract longId from the response
        if (submissionData?.documents?.length > 0) {
            const document = submissionData.documents[0];
            const longId = document.longId;

            // Update the database with the longId
            await WP_OUTBOUND_STATUS.update(
                { longId },
                { 
                    where: { 
                        submissionUid,
                        status: 'Submitted'
                    }
                }
            );

            return res.json({
                success: true,
                submissionUid,
                longId,
                status: submissionData.status,
                documents: submissionData.documents
            });
        }

        return res.json({
            success: false,
            error: {
                code: 'NO_DOCUMENTS',
                message: 'No documents found in submission'
            }
        });

    } catch (error) {
        console.error('Error getting submission details:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'SUBMISSION_DETAILS_ERROR',
                message: 'Failed to get submission details',
                details: error.message
            }
        });
    }
});


router.delete('/:fileName', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date } = req.query;

        // Get active SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error('Failed to get SAP configuration');
        }

        // Construct file path
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'File not found'
                }
            });
        }

        // Delete file
        await fsPromises.unlink(filePath);

        // Log the deletion
        await logDBOperation(req.app.get('models'), req, `Deleted file: ${fileName}`, {
            module: 'OUTBOUND',
            action: 'DELETE',
            status: 'SUCCESS'
        });

        res.json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting file:', error);
        
        await logDBOperation(req.app.get('models'), req, `Error deleting file: ${error.message}`, {
            module: 'OUTBOUND',
            action: 'DELETE',
            status: 'FAILED',
            error
        });

        res.status(500).json({
            success: false,
            error: {
                code: 'DELETE_ERROR',
                message: 'Failed to delete file',
                details: error.message
            }
        });
    }
});

/**
 * Real-time updates endpoint - optimized for frequent polling
 */
router.get('/real-time-updates', async (req, res) => {
    console.log('Starting real-time-updates endpoint');
    
    // Check authentication
    if (!req.session?.user) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Authentication required'
            }
        });
    }

    // Check if access token exists
    if (!req.session?.accessToken) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Access token required'
            }
        });
    }

    try {
        const { lastUpdate, lastFileCheck } = req.query;
        
        // Quick check for status updates
        const hasStatusUpdates = await checkForStatusUpdates(lastUpdate);
        
        // Quick check for new files
        let hasNewFiles = false;
        if (!hasStatusUpdates && lastFileCheck) {
            // Get active SAP configuration
            const config = await WP_CONFIGURATION.findOne({
                where: {
                    Type: 'SAP',
                    IsActive: 1
                },
                attributes: ['Settings'],
                raw: true
            });

            if (config && config.Settings) {
                // Parse Settings if it's a string
                let settings = config.Settings;
                if (typeof settings === 'string') {
                    try {
                        settings = JSON.parse(settings);
                    } catch (parseError) {
                        console.error('Error parsing SAP settings:', parseError);
                    }
                }

                if (settings && settings.networkPath) {
                    hasNewFiles = await checkForNewFiles(settings.networkPath, lastFileCheck);
                }
            }
        }

        // If there are updates, client should request full data
        if (hasStatusUpdates || hasNewFiles) {
            return res.json({
                success: true,
                hasUpdates: true,
                hasStatusUpdates,
                hasNewFiles,
                timestamp: new Date().toISOString()
            });
        }

        // No updates
        return res.json({
            success: true,
            hasUpdates: false,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in real-time-updates:', error);
        await logError('Error checking for real-time updates', error, {
            action: 'REAL_TIME_UPDATES',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Submit multiple documents to LHDN in bulk
 */
router.post('/bulk-submit', async (req, res) => {
    try {
        const { documents, version } = req.body;

        if (!Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No documents provided for bulk submission'
                }
            });
        }

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);
        const results = [];

        for (const doc of documents) {
            const { fileName, type, company, date } = doc;
            
            try {
                // Check for existing submission
                const existingCheck = await submitter.checkExistingSubmission(fileName);
                if (existingCheck.blocked) {
                    results.push({
                        fileName,
                        success: false,
                        error: existingCheck.response.error
                    });
                    continue;
                }

                // Get and process document data
                const processedData = await submitter.getProcessedData(fileName, type, company, date);
                
                if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
                    results.push({
                        fileName,
                        success: false,
                        error: {
                            code: 'PROCESSING_ERROR',
                            message: 'Failed to process Excel data - no valid documents found'
                        }
                    });
                    continue;
                }

                // Map to LHDN format
                const lhdnJson = mapToLHDNFormat(processedData, version);
                if (!lhdnJson) {
                    results.push({
                        fileName,
                        success: false,
                        error: {
                            code: 'MAPPING_ERROR',
                            message: 'Failed to map data to LHDN format'
                        }
                    });
                    continue;
                }

                // Prepare document for submission
                const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
                if (!payload) {
                    results.push({
                        fileName,
                        success: false,
                        error: {
                            code: 'PREPARATION_ERROR',
                            message: 'Failed to prepare document for submission'
                        }
                    });
                    continue;
                }

                // Submit to LHDN
                const result = await submitter.submitToLHDNDocument(payload.documents);

                if (result.status === 'failed') {
                    if (result.error?.error?.details) {
                        await submitter.updateSubmissionStatus({
                            invoice_number,
                            uuid: 'NA',
                            submissionUid: 'NA',
                            fileName,
                            filePath: processedData.filePath || fileName,
                            status: 'Failed',
                            error: JSON.stringify(result.error.error.details)
                        });

                        results.push({
                            fileName,
                            success: false,
                            error: result.error.error.details,
                            docNum: invoice_number
                        });
                        continue;
                    }
                }

                if (result.data?.acceptedDocuments?.length > 0) {
                    const acceptedDoc = result.data.acceptedDocuments[0];
                    
                    // Update submission status
                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: acceptedDoc.uuid,
                        submissionUid: result.data.submissionUid,
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Submitted',
                    });

                    // Update Excel file
                    const excelUpdateResult = await submitter.updateExcelWithResponse(
                        fileName,
                        type,
                        company,
                        date,
                        acceptedDoc.uuid,
                        invoice_number
                    );

                    results.push({
                        fileName,
                        success: true,
                        submissionUID: result.data.submissionUid,
                        acceptedDocuments: result.data.acceptedDocuments,
                        docNum: invoice_number,
                        fileUpdates: {
                            success: excelUpdateResult.success,
                            ...(excelUpdateResult.success ? 
                                { excelPath: excelUpdateResult.outgoingPath } : 
                                { error: excelUpdateResult.error }
                            )
                        }
                    });
                } else if (result.data?.rejectedDocuments?.length > 0) {
                    const rejectedDoc = result.data.rejectedDocuments[0];
                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: rejectedDoc.uuid || 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Rejected',
                        error: JSON.stringify(rejectedDoc.error || rejectedDoc)
                    });

                    results.push({
                        fileName,
                        success: false,
                        error: rejectedDoc.error || rejectedDoc,
                        docNum: invoice_number,
                        rejectedDocuments: result.data.rejectedDocuments
                    });
                }

            } catch (docError) {
                console.error(`Error processing document ${fileName}:`, docError);
                results.push({
                    fileName,
                    success: false,
                    error: {
                        code: 'PROCESSING_ERROR',
                        message: docError.message
                    }
                });
            }
        }

        // Invalidate the cache after bulk submission
        invalidateFileCache();

        return res.json({
            success: true,
            results
        });

    } catch (error) {
        console.error('=== Bulk Submit Error ===', {
            error: error.message,
            stack: error.stack
        });

        return res.status(500).json({
            success: false,
            error: {
                code: 'BULK_SUBMISSION_ERROR',
                message: error.message || 'An unexpected error occurred during bulk submission',
                details: error.stack
            }
        });
    }
});

/**
 * List all files in a consolidated format
 */
router.get('/list-consolidated', async (req, res) => {
    console.log('Starting list-consolidated endpoint');

    // Check authentication
    if (!req.session?.user) {
        console.log('Unauthorized access attempt - no session user');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Authentication required'
            }
        });
    }

    // Check if access token exists
    if (!req.session?.accessToken) {
        console.log('Unauthorized access attempt - no access token');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Access token required'
            }
        });
    }

    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        // Get configuration for paths
        const config = await WP_CONFIGURATION.findOne({
            where: {
                Type: 'SAP',
                IsActive: 1
            },
            order: [['CreateTS', 'DESC']]
        });

        if (!config || !config.Settings) {
            throw new Error('No active SAP configuration found');
        }

        // Parse Settings if it's a string
        let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;
        
        if (!settings.networkPath) {
            throw new Error('Network path not configured in SAP settings');
        }

        // Define root directories using configuration
        const incomingDir = path.join('SFTPRoot_Consolidation', 'Incoming', 'PXC Branch');

        // Validate directory exists and is accessible
        let directoryExists = false;
        try {
            await fsPromises.access(incomingDir, fs.constants.R_OK);
            directoryExists = true;
        } catch (accessError) {
            console.error('Directory access error:', accessError);
            // Instead of throwing an error, continue with an empty files array
            // and return a success response with a warning message
            return res.json({
                success: true,
                allFiles: [],
                consolidatedData: [],
                warning: {
                    code: 'DIRECTORY_NOT_FOUND',
                    message: `Directory not found: ${incomingDir}. Please check configuration and network connectivity.`,
                    details: accessError.message
                },
                processLog,
                summary: {
                    totalCompanies: 0,
                    totalDocuments: 0,
                    submittedDocuments: 0,
                    pendingDocuments: 0,
                    failedDocuments: 0,
                    cancelledDocuments: 0
                }
            });
        }

        // Get existing submission statuses with additional details
        console.log('Fetching submission statuses');
        const submissionStatuses = await WP_OUTBOUND_STATUS.findAll({
            attributes: [
                'id',
                'UUID',
                'submissionUid',
                'fileName',
                'filePath',
                'invoice_number',
                'status',
                'date_submitted',
                'date_cancelled',
                'cancellation_reason',
                'cancelled_by',
                'updated_at',
                'longId',
                'error'
            ],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        // Create status lookup map with additional details
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            const statusObj = {
                UUID: status.UUID,
                SubmissionUID: status.submissionUid,
                SubmissionStatus: status.status,
                DateTimeSent: status.date_submitted,
                DateTimeUpdated: status.updated_at,
                DateTimeCancelled: status.date_cancelled,
                CancelledReason: status.cancellation_reason,
                CancelledBy: status.cancelled_by,
                FileName: status.fileName,
                DocNum: status.invoice_number,
                LongId: status.longId,
                Error: status.error
            };

            if (status.fileName) statusMap.set(status.fileName, statusObj);
            if (status.invoice_number) statusMap.set(status.invoice_number, statusObj);
        });

        const files = [];

        // Process the incoming directory
        console.log('Processing incoming directory');
        try {
            await processTypeDirectory(incomingDir, 'Incoming', files, processLog, statusMap);
        } catch (dirError) {
            console.error('Error processing incoming directory:', dirError);
            processLog.details.push({
                error: dirError.message,
                type: 'DIRECTORY_PROCESSING_ERROR'
            });
            processLog.summary.errors++;
            
            // Return a valid response with error information but don't throw an error
            if (files.length === 0) {
                return res.json({
                    success: true,
                    allFiles: [],
                    consolidatedData: [],
                    processLog: {
                        ...processLog,
                        details: [
                            ...processLog.details,
                            {
                                message: `Error accessing directory: ${incomingDir}`,
                                error: dirError.message,
                                type: 'DIRECTORY_ACCESS_ERROR'
                            }
                        ]
                    },
                    error: {
                        message: `Could not access directory: ${dirError.message}`,
                        code: 'DIRECTORY_ACCESS_ERROR'
                    }
                });
            }
        }

        // Check if we found any files, if not return an empty response
        if (files.length === 0) {
            console.log('No files found');
            return res.json({
                success: true,
                allFiles: [],
                consolidatedData: [],
                processLog,
                summary: {
                    totalCompanies: 0,
                    totalDocuments: 0,
                    submittedDocuments: 0,
                    pendingDocuments: 0,
                    failedDocuments: 0,
                    cancelledDocuments: 0
                }
            });
        }

        // Create a map for latest documents with additional processing
        console.log('Processing latest documents');
        const latestDocuments = new Map();
        const documentsByCompany = new Map();

        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);

                // Group by company
                if (!documentsByCompany.has(file.company)) {
                    documentsByCompany.set(file.company, []);
                }
                documentsByCompany.get(file.company).push(file);
            }
        });

        // Convert map to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';

            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                date_cancelled: status?.DateTimeCancelled || null,
                cancellation_reason: status?.CancelledReason || null,
                cancelled_by: status?.CancelledBy || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null,
                longId: status?.LongId || null,
                error: status?.Error || null
            };
        });

        // Sort by modified time
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        // Group documents by company and calculate company statistics
        const consolidatedData = Array.from(documentsByCompany.entries()).map(([company, docs]) => {
            const companyStats = {
                total: docs.length,
                submitted: docs.filter(d => d.status === 'Submitted').length,
                pending: docs.filter(d => d.status === 'Pending').length,
                failed: docs.filter(d => ['Failed', 'Invalid', 'Rejected'].includes(d.status)).length,
                cancelled: docs.filter(d => d.status === 'Cancelled').length
            };

            return {
                company,
                statistics: companyStats,
                documents: docs.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
            };
        });

        // Sort companies by total documents
        consolidatedData.sort((a, b) => b.statistics.total - a.statistics.total);

        console.log('Sending consolidated response');
        res.json({
            success: true,
            consolidatedData,
            allFiles: mergedFiles,
            processLog,
            summary: {
                totalCompanies: consolidatedData.length,
                totalDocuments: mergedFiles.length,
                submittedDocuments: mergedFiles.filter(f => f.status === 'Submitted').length,
                pendingDocuments: mergedFiles.filter(f => f.status === 'Pending').length,
                failedDocuments: mergedFiles.filter(f => ['Failed', 'Invalid', 'Rejected'].includes(f.status)).length,
                cancelledDocuments: mergedFiles.filter(f => f.status === 'Cancelled').length
            }
        });

    } catch (error) {
        console.error('Error in list-consolidated:', error);
        await logError('Error listing consolidated files', error, {
            action: 'LIST_CONSOLIDATED',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message,
            processLog,
            stack: error.stack
        });
    }
});

/**
 * List all files with fixed paths (optimized version using hardcoded paths)
 */
router.get('/list-fixed-paths', async (req, res) => {
    console.log('Starting list-fixed-paths endpoint');
    
    // Check authentication
    if (!req.session?.user) {
        console.log('Unauthorized access attempt - no session user');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Authentication required'
            }
        });
    }

    // Check if access token exists
    if (!req.session?.accessToken) {
        console.log('Unauthorized access attempt - no access token');
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Access token required'
            }
        });
    }

    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        // Use fixed paths instead of getting from configuration
        const incomingPath = 'C:\\SFTPRoot_Consolidation\\Incoming\\PXC Branch';
        const outgoingPath = 'C:\\SFTPRoot_Consolidation\\Outgoing\\LHDN\\PXC Branch';

        console.log('Using fixed paths:');
        console.log('- Incoming:', incomingPath);
        console.log('- Outgoing:', outgoingPath);

        // Get the latest status update timestamp
        console.log('Fetching latest status update');
        const latestStatusUpdate = await WP_OUTBOUND_STATUS.findOne({
            attributes: ['updated_at'],
            order: [['updated_at', 'DESC']],
            raw: true
        });
        console.log('Latest status update:', latestStatusUpdate);

        // Get existing submission statuses
        console.log('Fetching submission statuses');
        const submissionStatuses = await WP_OUTBOUND_STATUS.findAll({
            attributes: [
                'id',
                'UUID',
                'submissionUid',
                'fileName',
                'filePath',
                'invoice_number',
                'status',
                'date_submitted',
                'date_cancelled',
                'cancellation_reason',
                'cancelled_by',
                'updated_at'
            ],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        // Create status lookup map
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            const statusObj = {
                UUID: status.UUID,
                SubmissionUID: status.submissionUid,
                SubmissionStatus: status.status,
                DateTimeSent: status.date_submitted,
                DateTimeUpdated: status.updated_at,
                DateTimeCancelled: status.date_cancelled,
                CancelledReason: status.cancellation_reason,
                CancelledBy: status.cancelled_by,
                FileName: status.fileName,
                DocNum: status.invoice_number
            };
            
            if (status.fileName) statusMap.set(status.fileName, statusObj);
            if (status.invoice_number) statusMap.set(status.invoice_number, statusObj);
        });

        const files = [];

        // Process incoming directory directly
        console.log('Processing incoming directory');
        try {
            // For consolidated view, we don't need to process by type/company/date
            // Since files are directly in the Incoming directory
            await processDirectoryFlat(incomingPath, 'Incoming', files, processLog, statusMap);
        } catch (dirError) {
            console.error(`Error processing incoming directory:`, dirError);
            // Continue with partial data if there's an error
        }

        // Create a map for latest documents
        console.log('Processing latest documents');
        const latestDocuments = new Map();

        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);
            }
        });

        // Convert map to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';
            
            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                date_cancelled: status?.DateTimeCancelled || null,
                cancellation_reason: status?.CancelledReason || null,
                cancelled_by: status?.CancelledBy || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null
            };
        });

        // Sort by modified time
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        console.log(`Found ${mergedFiles.length} files`);
        console.log('Sending response');
        res.json({
            success: true,
            files: mergedFiles,
            processLog,
            fromCache: false,
            paths: {
                incoming: incomingPath,
                outgoing: outgoingPath
            }
        });

    } catch (error) {
        console.error('Error in list-fixed-paths:', error);
        await logError('Error listing outbound files with fixed paths', error, {
            action: 'LIST_FIXED_PATHS',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message,
            processLog,
            stack: error.stack // Include stack trace for debugging
        });
    }
});

/**
 * Process a flat directory structure (no type/company/date hierarchy)
 */
async function processDirectoryFlat(directory, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(directory, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access directory ${directory}:`, accessError);
            throw new Error(`Cannot access directory: ${directory}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read all files in the directory
        let dirContents;
        try {
            dirContents = await fsPromises.readdir(directory);
        } catch (readError) {
            console.error(`Error reading directory ${directory}:`, readError);
            throw new Error(`Failed to read directory contents: ${directory}`);
        }

        // Process each item
        for (const item of dirContents) {
            const itemPath = path.join(directory, item);
            
            try {
                const stats = await fsPromises.stat(itemPath);
                
                // If it's a directory, process recursively
                if (stats.isDirectory()) {
                    await processDirectoryFlat(itemPath, type, files, processLog, statusMap);
                    continue;
                }
                
                // If it's a file and Excel file, process it
                if (stats.isFile() && item.match(/\.(xls|xlsx)$/i)) {
                    await processFile(item, directory, 'N/A', 'PXC Branch', type, files, processLog, statusMap);
                }
            } catch (itemError) {
                console.error(`Error processing ${itemPath}:`, itemError);
                processLog.details.push({
                    file: item,
                    path: itemPath,
                    error: itemError.message,
                    type: 'ITEM_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }

    } catch (error) {
        console.error(`Error processing directory ${directory}:`, error);
        processLog.details.push({
            directory,
            error: error.message,
            type: 'DIRECTORY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
        throw error;
    }
}

module.exports = router;