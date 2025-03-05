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
const fileCache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

// Add cache helper functions at the top after fileCache declaration
const CACHE_KEY_PREFIX = 'outbound_files';

function generateCacheKey() {
    return `${CACHE_KEY_PREFIX}_list`;
}

function invalidateFileCache() {
    const cacheKey = generateCacheKey();
    fileCache.del(cacheKey);
}

// Add new function to check for new files
async function checkForNewFiles(networkPath, lastCheck) {
    try {
        const types = ['Manual', 'Schedule'];
        let hasNewFiles = false;

        for (const type of types) {
            const typeDir = path.join(networkPath, type);
            
            // Skip if directory doesn't exist
            if (!fs.existsSync(typeDir)) continue;

            const companies = await fsPromises.readdir(typeDir);
            for (const company of companies) {
                const companyDir = path.join(typeDir, company);
                
                // Skip if not a directory
                if (!(await fsPromises.stat(companyDir)).isDirectory()) continue;

                const dates = await fsPromises.readdir(companyDir);
                for (const date of dates) {
                    const dateDir = path.join(companyDir, date);
                    
                    // Skip if not a directory
                    if (!(await fsPromises.stat(dateDir)).isDirectory()) continue;

                    const files = await fsPromises.readdir(dateDir);
                    for (const file of files) {
                        const filePath = path.join(dateDir, file);
                        const stats = await fsPromises.stat(filePath);
                        
                        // If any file is newer than our last check, return true
                        if (new Date(stats.mtime) > new Date(lastCheck)) {
                            return true;
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
 * Helper function to read Excel file with detailed logging
 */
async function readExcelWithLogging(filePath) {
    try {
        //console.log('\n=== Reading Excel File ===');
        //console.log('File Path:', filePath);

        const workbook = XLSX.readFile(filePath);
        //console.log('\nSheet Names:', workbook.SheetNames);

        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        //console.log('\nWorksheet Range:', worksheet['!ref']);

        const dataAsObjects = XLSX.utils.sheet_to_json(worksheet);
        const dataWithHeaders = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        //console.log(dataWithHeaders);
       console.log(dataAsObjects);

        // Log all cell addresses in first few rows
        //console.log('\n=== Cell by Cell Analysis (First 2 rows) ===');
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = 0; R <= Math.min(1, range.e.r); ++R) {
            for (let C = 0; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({r: R, c: C});
                const cell = worksheet[cellAddress];
                if (cell) {
                    //console.log(`${cellAddress}:`, cell.v);
                }
            }
        }

        return {
            dataWithHeaders,
            dataAsObjects,
            sheetNames: workbook.SheetNames,
            worksheet
        };
    } catch (error) {
        //console.error('Error reading Excel file:', error);
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

async function logCancellation(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: 'CANCEL',
            Status: options.status || 'SUCCESS',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.log('Cancellation logged:', {
            description,
            ...options
        });
    } catch (logError) {
        console.error('Error logging cancellation to database:', logError);
    }
}

/**
 * Helper function to log submissions
 */
async function logSubmission(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: 'SUBMIT',
            Status: options.status || 'SUCCESS',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.log('Submission logged:', {
            description,
            ...options
        });
    } catch (logError) {
        console.error('Error logging submission to database:', logError);
    }
}

/**
 * Helper function to log validations
 */
async function logValidation(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: options.hasErrors ? 'WARNING' : 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: 'VALIDATE',
            Status: options.status || (options.hasErrors ? 'FAILED' : 'SUCCESS'),
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.log('Validation logged:', {
            description,
            ...options
        });
    } catch (logError) {
        console.error('Error logging validation to database:', logError);
    }
}

/**
 * Helper function to log file operations (read/write/delete)
 */
async function logFileOperation(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: options.action || 'FILE_OP',
            Status: options.status || 'SUCCESS',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.log('File operation logged:', {
            description,
            ...options
        });
    } catch (logError) {
        console.error('Error logging file operation to database:', logError);
    }
}

/**
 * Helper function to log configuration changes
 */
async function logConfigChange(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: 'CONFIG',
            Status: options.status || 'SUCCESS',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
        
        console.log('Configuration change logged:', {
            description,
            ...options
        });
    } catch (logError) {
        console.error('Error logging configuration change to database:', logError);
    }
}

/**
 * Simple logging middleware
 */
async function logActivity(req, res, next) {
    const originalJson = res.json;
    const loggedUser = req.session?.user?.username;
    const action = getActionFromPath(req.path, req.method);

    try {
        // Log the start of the request
        await WP_LOGS.create({
            Description: `${action} operation started`,
            CreateTS: new Date().toISOString(),
            LoggedUser: loggedUser || 'System',
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: action,
            Status: 'PENDING',
            IPAddress: req.ip
        });

        // Override res.json to log the response
        res.json = function(data) {
            const isSuccess = data.success !== false;
            
            // Log the completion
            WP_LOGS.create({
                Description: isSuccess ? 
                    `${action} completed successfully` : 
                    `${action} failed: ${data.error?.message || 'Unknown error'}`,
                CreateTS: new Date().toISOString(),
                LoggedUser: loggedUser || 'System',
                LogType: isSuccess ? 'INFO' : 'ERROR',
                Module: 'OUTBOUND_FILES',
                Action: action,
                Status: isSuccess ? 'SUCCESS' : 'FAILED',
                IPAddress: req.ip
            }).catch(console.error);

            res.json = originalJson;
            return res.json(data);
        };

        next();
    } catch (error) {
        console.error('Logging error:', error);
        next();
    }
}

/**
 * Helper function to determine action from path
 */
function getActionFromPath(path, method) {
    if (path.includes('/cancel')) return 'CANCEL';
    if (path.includes('/validate')) return 'VALIDATE';
    if (path.includes('/submit')) return 'SUBMIT';
    if (path.includes('/content')) return 'READ';
    if (method === 'DELETE') return 'DELETE';
    //if (path.includes('/list-all')) return 'LIST';
    return 'OTHER';
}

// Add the middleware to your routes
router.use(logActivity);


/**
 * List all files from network directories with caching and duplicate filtering
 */
router.get('/list-all', async (req, res) => {
    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        const cacheKey = generateCacheKey();
        const { forceRefresh } = req.query;
        
        // Get the latest status update timestamp
        const latestStatusUpdate = await WP_OUTBOUND_STATUS.findOne({
            attributes: ['updated_at'],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        // Get active SAP configuration for network path check
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
            settings = JSON.parse(settings);
        }

        // Check cache first if not forcing refresh
        if (!forceRefresh) {
            const cachedData = fileCache.get(cacheKey);
            if (cachedData) {
                // Check if there are new files since last cache
                const hasNewFiles = await checkForNewFiles(settings.networkPath, cachedData.timestamp);
                
                // If no new files and status hasn't changed, return cached data
                if (!hasNewFiles && 
                    cachedData.lastStatusUpdate && 
                    latestStatusUpdate && 
                    new Date(cachedData.lastStatusUpdate) >= new Date(latestStatusUpdate.updated_at)) {
                    return res.json({
                        success: true,
                        files: cachedData.files,
                        processLog: cachedData.processLog,
                        fromCache: true,
                        cachedAt: cachedData.timestamp,
                        lastStatusUpdate: cachedData.lastStatusUpdate
                    });
                }
            }
        }

        // Get existing submission statuses with new schema and include recent updates
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
                'date_sync',
                'date_cancelled',
                'cancelled_by',
                'cancellation_reason',
                'created_at',
                'updated_at'
            ],
            order: [['updated_at', 'DESC']],
            raw: true
        });

        // Create status lookup map with new schema
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            // Use both fileName and invoice_number as keys for better matching
            if (status.fileName) {
                statusMap.set(status.fileName, {
                    UUID: status.UUID,
                    SubmissionUID: status.submissionUid,
                    SubmissionStatus: status.status,
                    DateTimeSent: status.date_submitted,
                    DateTimeUpdated: status.updated_at,
                    FileName: status.fileName,
                    DocNum: status.invoice_number
                });
            }
            if (status.invoice_number) {
                statusMap.set(status.invoice_number, {
                    UUID: status.UUID,
                    SubmissionUID: status.submissionUid,
                    SubmissionStatus: status.status,
                    DateTimeSent: status.date_submitted,
                    DateTimeUpdated: status.updated_at,
                    FileName: status.fileName,
                    DocNum: status.invoice_number
                });
            }
        });

        const files = [];
        const types = ['Manual', 'Schedule'];

        for (const type of types) {
            const typeDir = path.join(settings.networkPath, type);
            await processTypeDirectory(typeDir, type, files, processLog, statusMap);
        }

        // Create a map to store the latest version of each document
        const latestDocuments = new Map();

        // Process files to keep only the latest version of each document
        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);
            }
        });

        // Convert map back to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';
            
            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null
            };
        });

        // Sort by modified time descending
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        // Store in cache with status update timestamp
        const cacheData = {
            files: mergedFiles,
            processLog,
            timestamp: new Date().toISOString(),
            lastStatusUpdate: latestStatusUpdate?.updated_at
        };
        fileCache.set(cacheKey, cacheData);

        // // Log success
        // await logDBOperation(req.app.get('models'), req, 'Successfully retrieved outbound files list', {
        //     module: 'OUTBOUND',
        //     action: 'LIST_ALL',
        //     status: 'SUCCESS'
        // });

        res.json({
            success: true,
            files: mergedFiles,
            processLog,
            fromCache: false
        });

    } catch (error) {
        console.error('Error in list-all:', error);
        await logDBOperation(req.app.get('models'), req, `Error listing outbound files: ${error.message}`, {
            module: 'OUTBOUND',
            action: 'LIST_ALL',
            status: 'FAILED',
            error
        });

        res.status(500).json({
            success: false,
            error: error.message,
            processLog
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
 * Process type directory (Manual/Schedule)
 */
async function processTypeDirectory(typeDir, type, files, processLog, statusMap) {
   // console.log(`\nProcessing type directory: ${typeDir}`);
    try {
    await ensureDirectoryExists(typeDir);
    
        const companies = await fsPromises.readdir(typeDir);
      //  console.log(`Found ${companies.length} companies in ${type}:`, companies);
        
        for (const company of companies) {
           // console.log(`\nProcessing company: ${company}`);
            const companyDir = path.join(typeDir, company);
            await processCompanyDirectory(companyDir, company, type, files, processLog, statusMap);
        }
    } catch (error) {
        console.error(`Error processing ${type} directory:`, error);
        await logError(`Error processing ${type} directory`, error);
    }
}

/**
 * Process company directory
 */
async function processCompanyDirectory(companyDir, company, type, files, processLog, statusMap) {
   // console.log(`Processing company directory: ${companyDir}`);
    try {
    await ensureDirectoryExists(companyDir);
    
        const dates = await fsPromises.readdir(companyDir);
       // console.log(`Found ${dates.length} dates in ${company}:`, dates);
        
        for (const date of dates) {
          //  console.log(`\nProcessing date: ${date}`);
            const dateDir = path.join(companyDir, date);
            await processDateDirectory(dateDir, date, company, type, files, processLog, statusMap);
        }
    } catch (error) {
        console.error(`Error processing company directory ${company}:`, error);
        await logError(`Error processing company directory ${company}`, error);
    }
}

/**
 * Process date directory
 */
async function processDateDirectory(dateDir, date, company, type, files, processLog, statusMap) {
    //console.log(`Processing date directory: ${dateDir}`);
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
        //console.log(`Found ${dirFiles.length} files in ${normalizedDate}:`, dirFiles);
        
        for (const file of dirFiles) {
            //console.log(`\nProcessing file: ${file}`);
            await processFile(file, dateDir, normalizedDate, company, type, files, processLog, statusMap);
        }
    } catch (error) {
        console.error(`Error processing date directory ${date}:`, error);
        await logError(`Error processing date directory ${date}`, error);
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
router.post('/submit', async (req, res) => {
    const loggedUser = req.session?.user?.username;
    try {
        const { fileName, type, company, date } = req.body;

        await logSubmission(`Starting submission process for file: ${fileName}`, {
            user: loggedUser,
            status: 'PENDING',
            details: { fileName, type, company, date }
        });

        // Validate the file first
        await logValidation(`Pre-submission validation for file: ${fileName}`, {
            user: loggedUser,
            status: 'PENDING',
            details: { fileName, type, company, date }
        });

        const validationResult = await validateExcelFile(fileName, type, company, date);
        if (validationResult.errors && validationResult.errors.length > 0) {
            await logValidation(`Pre-submission validation failed for file: ${fileName}`, {
                user: loggedUser,
                hasErrors: true,
                details: { 
                    fileName,
                    errors: validationResult.errors,
                    errorCount: validationResult.errors.length
                }
            });

            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validationResult.errors
            });
        }

        // Get LHDN token
        const token = await getTokenAsIntermediary();
        if (!token) {
            await logError('Failed to get LHDN token', new Error('Token acquisition failed'), {
                user: loggedUser,
                action: 'SUBMIT',
                details: { fileName }
            });
            throw new Error('Failed to get LHDN token');
        }

        // Prepare document for submission
        const document = await prepareDocumentForSubmission(fileName, type, company, date);
        
        // Submit to LHDN
        await logSubmission(`Submitting document to LHDN: ${fileName}`, {
            user: loggedUser,
            status: 'IN_PROGRESS',
            details: { 
                fileName,
                documentId: document.id,
                type,
                company
            }
        });

        const submissionResponse = await submitDocument([document], token);

        if (submissionResponse.status === 'success') {
            // Update local status
            await WP_OUTBOUND_STATUS.create({
                UUID: submissionResponse.data.uuid,
                submissionUid: document.id,
                fileName: fileName,
                status: 'Submitted',
                date_submitted: new Date(),
                created_at: new Date(),
                updated_at: new Date()
            });

            await logSubmission(`Successfully submitted document to LHDN: ${fileName}`, {
                user: loggedUser,
                details: { 
                    fileName,
                    uuid: submissionResponse.data.uuid,
                    submissionUid: document.id,
                    response: submissionResponse.data
                }
            });

            return res.json({
                success: true,
                message: 'Document submitted successfully',
                data: submissionResponse.data
            });
        }

        throw new Error('Unexpected response from LHDN API');

    } catch (error) {
        await logError(`Submission error: ${error.message}`, error, {
            user: loggedUser,
            action: 'SUBMIT',
            details: req.body
        });

        // Handle specific error cases
        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT',
                    message: 'LHDN API rate limit exceeded. Please try again later.'
                }
            });
        }

        res.status(500).json({
            success: false,
            error: {
                message: 'Failed to submit document',
                details: error.message
            }
        });
    }
});

/**
 * Cancel document
 */
router.post('/:uuid/cancel', async (req, res) => {
    const loggedUser = req.session.user?.username;
    const uuid = req.params.uuid;
    const reason = req.body.reason;

    if (!uuid) {
        await logError('Missing UUID for document cancellation', new Error('Missing UUID'), {
            user: loggedUser,
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

        await logCancellation(`Started cancellation process for document ${uuid}`, {
            user: loggedUser,
            status: 'PENDING',
            details: { uuid, reason }
        });

        const documentDetails = await getDocumentDetails(uuid, token);
        if (!documentDetails.status === 'success' || !documentDetails.data) {
            await logError('Document not found for cancellation', new Error('Document not found'), {
                user: loggedUser,
                action: 'CANCEL',
                status: 'FAILED',
                details: { uuid }
            });
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

            await logCancellation(`Successfully cancelled document ${uuid}`, {
                user: loggedUser,
                details: { 
                    uuid,
                    reason,
                    docNum: documentDetails.data.invoice_number,
                    response: cancelResponse
                }
            });

            return res.json({
                success: true,
                message: 'Invoice cancelled successfully'
            });
        }

        throw new Error('Unexpected response from cancellation API');

    } catch (error) {
        console.error('Error cancelling invoice:', error);
        
        await logError(`Error cancelling document: ${error.message}`, error, {
            user: loggedUser,
            action: 'CANCEL',
            status: 'FAILED',
            details: { uuid, reason }
        });

        // Handle specific error cases
        if (error.response) {
            const errorData = error.response.data;
            
            // Check if document is already cancelled
            if (errorData?.error?.code === 'ValidationError' && 
                errorData?.error?.details?.some(d => d.message?.includes('already cancelled'))) {
                
                await logCancellation(`Document ${uuid} was already cancelled`, {
                    user: loggedUser,
                    status: 'WARNING',
                    details: { uuid, reason, errorData }
                });

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
                await logError('Document not found in LHDN system', error, {
                    user: loggedUser,
                    action: 'CANCEL',
                    status: 'FAILED',
                    details: { uuid, reason }
                });

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
    }
});

router.post('/:fileName/content', async (req, res) => {
    const loggedUser = req.session?.user?.username;
    try {
        const { fileName } = req.params;
        const { type, company, date, uuid, submissionUid } = req.body;

        await logFileOperation(`Accessing file content: ${fileName}`, {
            user: loggedUser,
            action: 'READ',
            details: { fileName, type, company, date }
        });

        // 1. Get and validate SAP configuration
        const config = await getActiveSAPConfig();
  
        if (!config.success || !config.networkPath) {
            await logError('Invalid SAP configuration', new Error(config.error || 'No network path configured'), {
                user: loggedUser,
                action: 'CONFIG_CHECK'
            });
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
            // console.log('Excel file read successfully');
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
        // console.log('\nExcel data processed successfully');

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

        // Add logging for successful file read
        await logFileOperation(`Successfully read file content: ${fileName}`, {
            user: loggedUser,
            action: 'READ',
            details: { fileName, type, company, date, filePath }
        });

        res.json({
            success: true,
            content: processedData,
            outgoingPath: outgoingFilePath
        });

    } catch (error) {
        await logError(`Error accessing file content: ${error.message}`, error, {
            user: loggedUser,
            action: 'READ',
            details: req.params
        });
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

router.post('/validate', async (req, res) => {
    const loggedUser = req.session?.user?.username;
    try {
        const { fileName, type, company, date } = req.body;

        await logValidation(`Starting validation for file: ${fileName}`, {
            user: loggedUser,
            status: 'PENDING',
            details: { fileName, type, company, date }
        });

        // Get SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success) {
            await logError('SAP configuration error during validation', new Error(config.error), {
                user: loggedUser,
                action: 'VALIDATE',
                details: { fileName }
            });
            throw new Error(`SAP configuration error: ${config.error}`);
        }

        // Validate file path and access
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);

        if (!fs.existsSync(filePath)) {
            await logError('File not found during validation', new Error('File not found'), {
                user: loggedUser,
                action: 'VALIDATE',
                details: { fileName, filePath }
            });
            throw new Error('File not found');
        }

        // Perform validation
        const validationResult = await validateExcelFile(fileName, type, company, date);

        if (validationResult.errors && validationResult.errors.length > 0) {
            await logValidation(`Validation failed for file: ${fileName}`, {
                user: loggedUser,
                hasErrors: true,
                details: { 
                    fileName,
                    errors: validationResult.errors,
                    errorCount: validationResult.errors.length
                }
            });

            return res.status(400).json({
                success: false,
                errors: validationResult.errors
            });
        }

        await logValidation(`Validation successful for file: ${fileName}`, {
            user: loggedUser,
            details: { 
                fileName,
                type,
                company,
                date
            }
        });

        res.json({
            success: true,
            message: 'File validation successful',
            data: validationResult.data
        });

    } catch (error) {
        await logError(`Validation error: ${error.message}`, error, {
            user: loggedUser,
            action: 'VALIDATE',
            details: req.body
        });

        res.status(500).json({
            success: false,
            error: {
                message: 'Validation failed',
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

module.exports = router;