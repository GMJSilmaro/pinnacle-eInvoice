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
const { isValidFileFormat } = require('../../utils/isValidFormat');

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
            CreateTS: new Date(),
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
 * Helper function to log success events
 * @param {string} description - Success description
 * @param {Object} options - Additional logging options
 */
async function logSuccess(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: new Date(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'OUTBOUND_FILES',
            Action: options.action || 'LIST_ALL',
            Status: 'SUCCESS',
            UserID: options.userId || null
        };

        await WP_LOGS.create(logEntry);
    } catch (logError) {
        console.error('Error logging success to database:', logError);
    }
}

/**
 * List all files from network directories
 */
router.get('/list-all', async (req, res) => {
    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        await logDBOperation(req.app.get('models'), req, 'Started listing all outbound files', {
            module: 'OUTBOUND',
            action: 'LIST_ALL'
        });

        //console.log('Starting list-all endpoint...');
        
      // Get active SAP configuration from database
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

// Validate network path format
const networkPath = await validateAndFormatNetworkPath(settings.networkPath);

// Test network accessibility
const networkValid = await testNetworkPathAccessibility(networkPath, {
    serverName: settings.domain || '',
    serverUsername: settings.username,
    serverPassword: settings.password
});

if (!networkValid.success) {
    throw new Error(`Network access failed: ${networkValid.error}`);
}

        // Get existing submission statuses with new schema
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
            raw: true
        });

        console.log('Found submission statuses:', submissionStatuses.length);

        // Create status lookup map with new schema
        const statusMap = new Map(
            submissionStatuses.flatMap(status => [
                [status.fileName, {
                    UUID: status.UUID, // Use submissionUid here
                    SubmissionUID: status.submissionUid,
                    SubmissionStatus: status.status,
                    DateTimeSent: status.date_submitted,
                    DateTimeUpdated: status.updated_at,
                    FileName: status.fileName,
                    DocNum: status.invoice_number
                }],
                // [status.invoice_number, {
                //     SubmissionUID: status.UUID, // Use submissionUid here
                //     SubmissionStatus: status.status,
                //     DateTimeSent: status.date_submitted,
                //     DateTimeUpdated: status.updated_at,
                //     FileName: status.fileName,
                //     DocNum: status.invoice_number
                // }]
            ])
        );

        console.log('Status Map:', statusMap);

        const files = [];
        const types = ['Manual', 'Schedule'];

        for (const type of types) {
            //console.log(`Processing type directory: ${type}`);
            const typeDir = path.join(networkPath, type);
           // console.log('Type directory path:', typeDir);
            await processTypeDirectory(typeDir, type, files, processLog, statusMap);
        }

        // Merge file information with database status
        const mergedFiles = files.map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            return {
                ...file,
                status: status?.SubmissionStatus || 'Pending',
                date_submitted: status?.DateTimeSent || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null
            };
        });

        //console.log('File processing complete');
        //console.log('Total files found:', mergedFiles.length);
        //console.log('Summary:', processLog.summary);

          // Log success
    await logDBOperation(req.app.get('models'), req, 'Successfully retrieved outbound files list', {
        module: 'OUTBOUND',
        action: 'LIST_ALL',
        status: 'SUCCESS'
    });

    res.json({
        success: true,
        files: mergedFiles,
        processLog
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
        console.log('Checking submission for document:', docNum);

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


/**
 * Process type directory (Manual/Schedule)
 */
async function processTypeDirectory(typeDir, type, files, processLog, statusMap) {
    console.log(`\nProcessing type directory: ${typeDir}`);
    try {
        // Ensure the directory exists
        await ensureDirectoryExists(typeDir);
        
        // Get list of companies
        const companies = await fsPromises.readdir(typeDir);
        console.log(`Found ${companies.length} companies in ${type}:`, companies);
        
        for (const company of companies) {
            console.log(`\nProcessing company: ${company}`);
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
    console.log(`Processing company directory: ${companyDir}`);
    try {
        // Ensure the directory exists
        await ensureDirectoryExists(companyDir);
        
        // Get list of dates
        const dates = await fsPromises.readdir(companyDir);
        console.log(`Found ${dates.length} dates in ${company}:`, dates);
        
        for (const date of dates) {
            console.log(`\nProcessing date: ${date}`);
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
    console.log(`Processing date directory: ${dateDir}`);
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

        // Ensure the directory exists
        await ensureDirectoryExists(dateDir);
    
        // Get list of files
        const dirFiles = await fsPromises.readdir(dateDir);
        console.log(`Found ${dirFiles.length} files in ${normalizedDate}:`, dirFiles);
        
        for (const file of dirFiles) {
            console.log(`\nProcessing file: ${file}`);
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
// function isValidFileFormat(fileName) {
//     try {
//         // Remove file extension
//         const baseName = path.parse(fileName).name;
        
//         // Define the regex pattern for both formats
//         // Updated to be more flexible with invoice number format
//         // Allows alphanumeric characters, hyphens, and underscores in the invoice number
//         const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9][A-Z0-9-]*[A-Z0-9])_eInvoice_(\d{14})$/;
//         const match = baseName.match(pattern);
        
//         if (!match) {
//             console.log(`Invalid file name format: ${fileName}`);
//             console.log('File name must follow this pattern:');
//             console.log('XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS');
//             console.log('Examples:');
//             console.log('- 01_ARINV118965_eInvoice_20250127102244 (Main format)');
//             console.log('- 01_IN-LABS-010001_eInvoice_20250128183637 (Alternative format)');
//             console.log('Where:');
//             console.log('- XX: Document type');
//             console.log('Standard Documents:');
//             console.log('  * 01: Invoice');
//             console.log('  * 02: Credit Note');
//             console.log('  * 03: Debit Note');
//             console.log('  * 04: Refund Note');
//             console.log('Self-billed Documents:');
//             console.log('  * 11: Self-billed Invoice');
//             console.log('  * 12: Self-billed Credit Note');
//             console.log('  * 13: Self-billed Debit Note');
//             console.log('  * 14: Self-billed Refund Note');
//             console.log('- InvoiceNumber: Document number (alphanumeric with optional hyphens)');
//             console.log('- eInvoice: Fixed text');
//             console.log('- YYYYMMDDHHMMSS: Timestamp');
//             return false;
//         }
        
//         // Extract components
//         const [, docType, invoiceNumber, timestamp] = match;
        
//         // Validate document type (already enforced by regex (0[1-4]|1[1-4]))
//         const docTypes = {
//             '01': 'Invoice',
//             '02': 'Credit Note',
//             '03': 'Debit Note',
//             '04': 'Refund Note',
//             '11': 'Self-billed Invoice',
//             '12': 'Self-billed Credit Note',
//             '13': 'Self-billed Debit Note',
//             '14': 'Self-billed Refund Note'
//         };

//         if (!docTypes[docType]) {
//             console.log(`Invalid document type: ${docType}`);
//             console.log('Valid document types:');
//             Object.entries(docTypes).forEach(([code, type]) => {
//                 console.log(`- ${code}: ${type}`);
//             });
//             return false;
//         }
        
//         // Additional validation for invoice number format
//         if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(invoiceNumber)) {
//             console.log(`Invalid invoice number format: ${invoiceNumber}`);
//             console.log('Invoice number must:');
//             console.log('- Start and end with alphanumeric characters');
//             console.log('- Contain only uppercase letters, numbers, and hyphens');
//             console.log('- Have at least 2 characters');
//             return false;
//         }
        
//         // Validate timestamp format
//         const year = parseInt(timestamp.substring(0, 4));
//         const month = parseInt(timestamp.substring(4, 6));
//         const day = parseInt(timestamp.substring(6, 8));
//         const hour = parseInt(timestamp.substring(8, 10));
//         const minute = parseInt(timestamp.substring(10, 12));
//         const second = parseInt(timestamp.substring(12, 14));
        
//         const date = new Date(year, month - 1, day, hour, minute, second);
        
//         if (
//             date.getFullYear() !== year ||
//             date.getMonth() + 1 !== month ||
//             date.getDate() !== day ||
//             date.getHours() !== hour ||
//             date.getMinutes() !== minute ||
//             date.getSeconds() !== second ||
//             year < 2000 || year > 2100
//         ) {
//             console.log(`Invalid timestamp: ${timestamp}`);
//             console.log('Timestamp must be a valid date/time in format: YYYYMMDDHHMMSS');
//             return false;
//         }
        
//         return true;
//     } catch (error) {
//         console.error('Error validating file name:', error);
//         return false;
//     }
// }


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
 * Process individual file
 */
async function processFile(file, dateDir, date, company, type, files, processLog, statusMap) {
    processLog.summary.total++;
    const logEntry = { file, valid: false, error: null };

    try {
        if (!file.match(/\.(xls|xlsx)$/i)) {
            logEntry.error = 'Not an Excel file';
            processLog.summary.invalid++;
            processLog.details.push(logEntry);
            return;
        }

        // Check file name format
        if (!isValidFileFormat(file)) {
            processLog.summary.invalid++;
            logEntry.error = 'Invalid file name format';
            processLog.details.push(logEntry);
            return;
        }

        const filePath = path.join(dateDir, file);
        const stats = await fsPromises.stat(filePath);
        
        // Extract invoice number from file name using any valid prefix
        const baseName = path.parse(file).name;
        const invoiceMatch = baseName.match(/^(0[1-4]|1[1-4])_([A-Z0-9_\-]+)_eInvoice_(\d{14})$/) || baseName.match(/((?:ARINV|INV|CN|DN|RN)\d+)/);
        //const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9_\-]+)_eInvoice_(\d{14})$/;
        //const match = baseName.match(pattern);
        const invoiceNumber = invoiceMatch ? invoiceMatch[2] : null;
        
        const submissionStatus = statusMap.get(file) || (invoiceNumber ? statusMap.get(invoiceNumber) : null);

        const excelData = await readExcelWithLogging(filePath);
        const buyerInfo = extractBuyerInfo(excelData.dataWithHeaders);

        files.push({
            type,
            company,
            date,
            fileName: file,
            filePath,
            size: stats.size,
            modifiedTime: stats.mtime,
            uploadedDate: date,
            submissionDate: submissionStatus?.DateTimeSent || null,
            lastUpdated: submissionStatus?.DateTimeUpdated || null,
            status: submissionStatus?.SubmissionStatus || 'Pending',
            uuid: submissionStatus?.UUID,
            buyerInfo,
            invoiceNumber
        });

        processLog.summary.valid++;
        logEntry.valid = true;

    } catch (error) {
        processLog.summary.errors++;
        logEntry.error = error.message;
        console.error(`Error processing file ${file}:`, error);
    }

    processLog.details.push(logEntry);
}


/**
 * Submit document to LHDN
 */
router.post('/:fileName/submit-to-lhdn', async (req, res) => {
    try {
        console.log('=== Manual LHDN Submission Start ===');
        const { fileName } = req.params;
        const { type, company, date, version } = req.body;
        console.log(`Submitting document version ${version}`);

        // Get SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error(config.error || 'Failed to get SAP configuration');
        }

        // Construct file path
        const dateFromFilename = fileName.match(/_(\d{8})\d{6}\.xls$/);
        if (!dateFromFilename) {
            throw new Error('Invalid timestamp in filename');
        }
        const formattedDate = moment(dateFromFilename[1], 'YYYYMMDD').format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);
        console.log('Processing file:', filePath);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${fileName}`);
        }

        // Process Excel Data
        const workbook = XLSX.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
            raw: true,
            defval: null,
            blankrows: false
        });

        // Process and map the data
        const processedDocs = processExcelData(rawData);
        if (!processedDocs || processedDocs.length === 0) {
            throw new Error('No valid documents found in Excel file');
        }

        const lhdnJson = mapToLHDNFormat(processedDocs, version);
        if (!lhdnJson) {
            throw new Error('Failed to generate LHDN JSON format');
        }

        // Submit using LHDNSubmitter
        const submitter = new LHDNSubmitter(req);
        const result = await submitter.submitDocument(lhdnJson, version, processedDocs[0]);

        res.json(result);

    } catch (error) {
        console.error('LHDN Submission Error:', error);
        res.status(400).json({
            success: false,
            error: {
                title: 'Submission Error',
                message: error.message || 'An unknown error occurred',
                code: error.code || 'UNKNOWN'
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
            CreateTS: sequelize.literal('GETDATE()'),
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

// Add the file content endpoint
router.post('/:fileName/content', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date } = req.body;
    
        // Get and validate SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success || !config.networkPath) {
            throw new Error('Invalid SAP configuration');
        }
    
        const networkPath = config.networkPath;
    
        // Test network accessibility
        const networkValid = await testNetworkPathAccessibility(networkPath, {
            serverName: config.domain || '',
            serverUsername: config.username,
            serverPassword: config.password
        });
    
        if (!networkValid.success) {
            throw new Error(`Network path not accessible: ${networkValid.error}`);
        }
    
        // Construct base directory path
        const typeDir = path.join(networkPath, type, company);
    
        // Search for the file in all date directories
        const dates = await fsPromises.readdir(typeDir);
        let foundFilePath = null;
    
        for (const dateDir of dates) {
            const currentDateDir = path.join(typeDir, dateDir);
            const files = await fsPromises.readdir(currentDateDir);
            if (files.includes(fileName)) {
                foundFilePath = path.join(currentDateDir, fileName);
                break;
            }
        }
    
        if (!foundFilePath) {
            return res.status(404).json({
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'File not found',
                    details: {
                        fileName,
                        type,
                        company
                    }
                }
            });
        }
    
        // Use the correct file path
        const filePath = foundFilePath;
    
        // Ensure directories exist
        await ensureDirectoryExists(typeDir);
        await ensureDirectoryExists(path.dirname(filePath));
    
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'File not found',
                    details: {
                        path: filePath
                    }
                }
            });
        }
    
        // Read Excel file
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch (error) {
            throw new Error(`Failed to read Excel file: ${error.message}`);
        }
    
        // Process Excel data
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, {
            raw: true,
            defval: null,
            blankrows: false
        });
    
        res.json({
            success: true,
            content: data
        });
    
    } catch (error) {
        console.error('Error in file content endpoint:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: error.message,
                details: error.stack
            }
        });
    }
    
});

module.exports = router;