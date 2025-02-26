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
        console.log(dataWithHeaders);
       //console.log(dataAsObjects);

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

        // Create status lookup map with new schema
        const statusMap = new Map(
            submissionStatuses.flatMap(status => [
                [status.fileName, {
                    UUID: status.UUID,
                    SubmissionUID: status.submissionUid,
                    SubmissionStatus: status.status,
                    DateTimeSent: status.date_submitted,
                    DateTimeUpdated: status.updated_at,
                    FileName: status.fileName,
                    DocNum: status.invoice_number
                }]
            ])
        );

        const files = [];
        const types = ['Manual', 'Schedule'];

        for (const type of types) {
            const typeDir = path.join(networkPath, type);
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
            // console.log(`Invalid file name format: ${fileName}`);
            // console.log('File name must follow this pattern:');
            // console.log('XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS');
            // console.log('Examples:');
            // console.log('- 01_ARINV118965_eInvoice_20250127102244 (Main format)');
            // console.log('- 01_IN-LABS-010001_eInvoice_20250128183637 (Alternative format)');
            // console.log('Where:');
            // console.log('- XX: Document type');
            // console.log('Standard Documents:');
            // console.log('  * 01: Invoice');
            // console.log('  * 02: Credit Note');
            // console.log('  * 03: Debit Note');
            // console.log('  * 04: Refund Note');
            // console.log('Self-billed Documents:');
            // console.log('  * 11: Self-billed Invoice');
            // console.log('  * 12: Self-billed Credit Note');
            // console.log('  * 13: Self-billed Debit Note');
            // console.log('  * 14: Self-billed Refund Note');
            // console.log('- InvoiceNumber: Document number (alphanumeric with optional hyphens)');
            // console.log('- eInvoice: Fixed text');
            // console.log('- YYYYMMDDHHMMSS: Timestamp');
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
        
        // Additional validation for invoice number format
        if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(invoiceNumber)) {
            // console.log(`Invalid invoice number format: ${invoiceNumber}`);
            // console.log('Invoice number must:');
            // console.log('- Start and end with alphanumeric characters');
            // console.log('- Contain only uppercase letters, numbers, and hyphens');
            // console.log('- Have at least 2 characters');
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
           // console.log(`Invalid timestamp: ${timestamp}`);
           // console.log('Timestamp must be a valid date/time in format: YYYYMMDDHHMMSS');
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

        // Log the data structure for debugging
        console.log('Footer row:', footerRow);
        console.log('Data structure:', data);
        
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
                console.log('Accepted Document:', acceptedDoc);
                console.log('Full LHDN Response:', result.data);
            
                // // Add retry logic for submission details
                // let submissionDetails;
                // let retryCount = 0;
                // const maxRetries = 3;
                
                // while (retryCount < maxRetries) {
                //     submissionDetails = await submitter.getSubmissionDetails(
                //         result.data.submissionUid, 
                //         req.session.accessToken
                //     );
                    
                //     if (submissionDetails.success && submissionDetails.longId) {
                //         break;
                //     }
                    
                //     await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                //     retryCount++;
                // }

                // const longId = submissionDetails.success && submissionDetails.longId ? 
                //     submissionDetails.longId : 
                //     'NA';

                // First update the submission status in database
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: acceptedDoc.uuid,
                    submissionUid: result.data.submissionUid,
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Submitted'
                });
            
                // Then update the Excel file
                const excelUpdateResult = await submitter.updateExcelWithResponse(
                    fileName,
                    type,
                    company,
                    date,
                    acceptedDoc.uuid,
                    //longId,  // This should now be either the real longId or 'NA'
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
                    longId: longId, 
                    acceptedDocuments: result.data.acceptedDocuments,
                    docNum: invoice_number,
                    fileUpdates: {
                        success: excelUpdateResult.success,
                        ...(excelUpdateResult.success ? 
                            { 
                                excelPath: excelUpdateResult.outgoingPath,
                                //jsonPath: excelUpdateResult.jsonPath 
                            } : 
                            { error: excelUpdateResult.error }
                        )
                    }
                };

                console.log('=== Final Response ===', response);
                return res.json(response);
            }

            // Handle rejected documents
            if (result.data?.rejectedDocuments?.length > 0) {
                console.log('Rejected Documents:', JSON.stringify(result.data.rejectedDocuments, null, 2));
                
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
                console.log('Full LHDN Response:', JSON.stringify(result, null, 2));
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
        const outgoingBasePath = path.join('C:\\SFTPRoot\\MindValley\\Outgoing', type, company, formattedDate);
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

module.exports = router;