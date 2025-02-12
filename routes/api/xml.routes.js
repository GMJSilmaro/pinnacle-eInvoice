const express = require('express');
const router = express.Router();
const { WP_OUTBOUND_STATUS, WP_CONFIGURATION, WP_LOGS } = require('../../models');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { DOMParser } = require('xmldom');
const moment = require('moment');
const { sequelize } = require('../../models');
const { validateAndFormatNetworkPath, testNetworkPathAccessibility } = require('../../config/paths');

const LHDNSubmitter = require('../../services/lhdn/lhdnSubmitter');
const { cancelValidDocumentBySupplier } = require('../../services/lhdn/lhdnService');

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

/**
 * Helper function to ensure directory exists
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fsPromises.access(dirPath);
        console.log('Directory exists:', dirPath);
    } catch (error) {
        console.log('Creating directory:', dirPath);
        await fsPromises.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Helper function to log errors with enhanced details
 */
async function logError(description, error, options = {}) {
    try {
        const logEntry = {
            Description: `${description}: ${error.message}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'ERROR',
            Module: 'XML_FILES',
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
 */
async function logSuccess(description, options = {}) {
    try {
        const logEntry = {
            Description: description,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: 'INFO',
            Module: 'XML_FILES',
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
 * Process type directory (Manual/Schedule)
 */
async function processTypeDirectory(typeDir, type, files, processLog, statusMap) {
    console.log(`\nProcessing type directory: ${typeDir}`);
    try {
        await ensureDirectoryExists(typeDir);
        
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
        await ensureDirectoryExists(companyDir);
        
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

        await ensureDirectoryExists(dateDir);
    
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
 * Process individual XML file
 */
async function processFile(file, dateDir, date, company, type, files, processLog, statusMap) {
    processLog.summary.total++;
    const logEntry = { file, valid: false, error: null };

    try {
        // Check if it's an XML file
        if (!file.toLowerCase().endsWith('.xml')) {
            logEntry.error = {
                code: 'INVALID_FILE_TYPE',
                message: 'Not an XML file',
                details: 'Only .xml files are supported'
            };
            processLog.summary.invalid++;
            processLog.details.push(logEntry);
            return;
        }

        const filePath = path.join(dateDir, file);
        const stats = await fsPromises.stat(filePath);
        
        // Read and parse XML content
        const xmlContent = await fs.promises.readFile(filePath, 'utf8');
        const xmlDoc = new DOMParser().parseFromString(xmlContent, 'text/xml');
        
        // Extract invoice number from XML content
        const invoiceNumber = extractInvoiceNumber(xmlDoc) || path.parse(file).name;
        const buyerInfo = await extractBuyerInfo(xmlDoc);
        const docType = extractDocumentType(xmlDoc) || '01';  // Default to Invoice type
        
        // Extract issueDate from XML content
        const { date: issueDate, time: issueTime } = extractDates(xmlDoc);
        
        // Get submission status
        const submissionStatus = statusMap.get(file) || statusMap.get(invoiceNumber);

        const fileData = {
            type,
            company,
            date,
            fileName: file,
            filePath,
            size: stats.size,
            modifiedTime: stats.mtime,
            uploadedDate: date,
            issueDate: issueDate,
            issueTime: issueTime,
            submissionDate: submissionStatus?.DateTimeSent || null,
            lastUpdated: submissionStatus?.DateTimeUpdated || null,
            status: submissionStatus?.SubmissionStatus || 'Pending',
            uuid: submissionStatus?.UUID,
            buyerInfo,
            invoiceNumber,
            documentType: getDocumentTypeDescription(docType),
            documentTypeCode: docType,
            source: type
        };

        files.push(fileData);
        processLog.summary.valid++;
        logEntry.valid = true;

        console.log('Processed file:', {
            fileName: file,
            type,
            company,
            date,
            source: type,
            invoiceNumber,
            issueDate,
            issueTime
        });


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
 * Extract invoice number from XML document
 */
function extractInvoiceNumber(xmlDoc) {
    try {
        const nsURI = {
            cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
        };

        // Try to find invoice number in different possible elements
        const idElement = xmlDoc.getElementsByTagNameNS(nsURI.cbc, 'ID')[0];
        const invoiceNumberElement = xmlDoc.getElementsByTagNameNS(nsURI.cbc, 'InvoiceNumber')[0];
        
        return (idElement?.textContent || invoiceNumberElement?.textContent || '').trim();
    } catch (error) {
        console.error('Error extracting invoice number:', error);
        return null;
    }
}

/**
 * Extract document type from XML
 */
function extractDocumentType(xmlDoc) {
    try {
        const nsURI = {
            cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
        };

        const typeCodeElement = xmlDoc.getElementsByTagNameNS(nsURI.cbc, 'InvoiceTypeCode')[0];
        return typeCodeElement?.textContent || '01';  // Default to Invoice type
    } catch (error) {
        console.error('Error extracting document type:', error);
        return '01';  // Default to Invoice type
    }
}

/**
 * Get document type description
 */
function getDocumentTypeDescription(docType) {
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
    
    return docTypes[docType] || 'Invoice';
}

/**
 * Extract buyer information from XML
 */
async function extractBuyerInfo(xmlDoc) {
    try {
        const nsURI = {
            cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
            cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
        };

        const buyerParty = xmlDoc.getElementsByTagNameNS(nsURI.cac, 'AccountingCustomerParty')[0];
        if (!buyerParty) return {};

        const partyLegalEntity = buyerParty.getElementsByTagNameNS(nsURI.cac, 'PartyLegalEntity')[0];
        const partyIdentification = buyerParty.getElementsByTagNameNS(nsURI.cac, 'PartyIdentification')[0];

        return {
            registrationName: partyLegalEntity?.getElementsByTagNameNS(nsURI.cbc, 'RegistrationName')[0]?.textContent || null,
            registrationNumber: partyIdentification?.getElementsByTagNameNS(nsURI.cbc, 'ID')[0]?.textContent || null
        };
    } catch (error) {
        console.error('Error extracting buyer info:', error);
        return {};
    }
}

/**
 * Extract issue date from XML document
 */
function extractDates(xmlDoc) {
    try {
        const nsURI = {
            cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
        };

        // Try to find issue date and time elements
        const issueDateElement = xmlDoc.getElementsByTagNameNS(nsURI.cbc, 'IssueDate')[0];
        const issueTimeElement = xmlDoc.getElementsByTagNameNS(nsURI.cbc, 'IssueTime')[0];
        
        // Get the raw values
        const dateStr = issueDateElement ? issueDateElement.textContent.trim() : null;
        const timeStr = issueTimeElement ? issueTimeElement.textContent.trim() : null;

        console.log("Original XML Date:", dateStr);
        console.log("Original XML Time:", timeStr);

        return {
            date: dateStr,
            time: timeStr
        };
    } catch (error) {
        console.error('Error extracting issue date:', error);
        return {
            date: null,
            time: null
        };
    }
}

/**
 * Helper function to ensure daily directory exists
 */
async function ensureDailyDirectory(networkPath, type, company) {
    try {
        // Create base directories
        const typeDir = path.join(networkPath, type);
        const companyDir = path.join(typeDir, company);
        
        await ensureDirectoryExists(typeDir);
        await ensureDirectoryExists(companyDir);

        // Create today's directory
        const today = moment().format('YYYY-MM-DD');
        const todayDir = path.join(companyDir, today);
        await ensureDirectoryExists(todayDir);

        return todayDir;
    } catch (error) {
        console.error('Error creating daily directory:', error);
        throw error;
    }
}

/**
 * Helper function to get network path with fallback
 */
async function getNetworkPath() {
    // Get XML configuration
    const config = await WP_CONFIGURATION.findOne({
        where: {
            Type: 'XML',
            IsActive: 1
        },
        order: [['CreateTS', 'DESC']]
    });

    if (!config) {
        throw new Error('XML configuration not found');
    }

    let settings;
    try {
        settings = typeof config.Settings === 'string' 
            ? JSON.parse(config.Settings) 
            : config.Settings;
    } catch (error) {
        console.error('Error parsing settings:', error);
        throw new Error('Invalid XML configuration format');
    }

    if (!settings || !settings.networkPath) {
        throw new Error('Network path not configured');
    }

    // Validate network path with error handling
    try {
        const networkPath = await validateAndFormatNetworkPath(settings.networkPath);
        const networkValid = await testNetworkPathAccessibility(networkPath, {
            serverName: settings.domain || '',
            serverUsername: settings.username,
            serverPassword: settings.password
        });

        if (!networkValid.success) {
            console.warn('Network path validation failed, using local path:', networkValid.error);
            // Use a local path as fallback
            const localPath = path.join(process.cwd(), 'XML');
            await ensureDirectoryExists(localPath);
            return localPath;
        }

        return networkPath;
    } catch (pathError) {
        console.warn('Network path validation failed, using local path:', pathError.message);
        // Use a local path as fallback
        const localPath = path.join(process.cwd(), 'XML');
        await ensureDirectoryExists(localPath);
        return localPath;
    }
}

/**
 * Validate XML document structure and content
 */
async function validateXMLDocument(xmlContent) {
    try {
        const xmlDoc = new DOMParser().parseFromString(xmlContent, 'text/xml');
        const errors = [];

        // Check for XML parsing errors
        const parserErrors = xmlDoc.getElementsByTagName('parsererror');
        if (parserErrors.length > 0) {
            errors.push({
                code: 'XML_PARSE_ERROR',
                message: 'Invalid XML format',
                details: parserErrors[0].textContent
            });
            return { valid: false, errors };
        }

        // Define required elements and their validation rules
        const requiredElements = {
            'cbc:ID': 'Invoice Number is required',
            'cbc:IssueDate': 'Issue Date is required',
            'cbc:InvoiceTypeCode': 'Invoice Type Code is required',
            'cac:AccountingSupplierParty': 'Supplier information is required',
            'cac:AccountingCustomerParty': 'Customer information is required',
            'cac:TaxTotal': 'Tax information is required',
            'cac:LegalMonetaryTotal': 'Total amounts are required'
        };

        // Check required elements
        for (const [element, message] of Object.entries(requiredElements)) {
            const [ns, localName] = element.split(':');
            const nodes = xmlDoc.getElementsByTagNameNS(`urn:oasis:names:specification:ubl:schema:xsd:${ns === 'cbc' ? 'CommonBasicComponents-2' : 'CommonAggregateComponents-2'}`, localName);
            
            if (!nodes.length) {
                errors.push({
                    code: 'MISSING_REQUIRED_ELEMENT',
                    message,
                    field: element
                });
            }
        }

        // Validate dates
        const issueDateElement = xmlDoc.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', 'IssueDate')[0];
        if (issueDateElement) {
            const issueDate = new Date(issueDateElement.textContent);
            const now = new Date();
            const sevenDaysAgo = new Date(now.setDate(now.getDate() - 7));

            if (issueDate < sevenDaysAgo) {
                errors.push({
                    code: 'INVALID_DATE',
                    message: 'Issue date must be within the last 7 days',
                    field: 'cbc:IssueDate'
                });
            }
        }

        // Validate amounts
        const monetaryTotal = xmlDoc.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', 'LegalMonetaryTotal')[0];
        if (monetaryTotal) {
            const taxAmount = parseFloat(monetaryTotal.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', 'TaxAmount')[0]?.textContent || '0');
            const lineExtensionAmount = parseFloat(monetaryTotal.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', 'LineExtensionAmount')[0]?.textContent || '0');
            const taxInclusiveAmount = parseFloat(monetaryTotal.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', 'TaxInclusiveAmount')[0]?.textContent || '0');

            if (Math.abs(taxInclusiveAmount - (lineExtensionAmount + taxAmount)) > 0.01) {
                errors.push({
                    code: 'INVALID_AMOUNT',
                    message: 'Tax inclusive amount must equal line extension amount plus tax amount',
                    field: 'cac:LegalMonetaryTotal'
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    } catch (error) {
        console.error('XML validation error:', error);
        return {
            valid: false,
            errors: [{
                code: 'VALIDATION_ERROR',
                message: error.message,
                details: error.stack
            }]
        };
    }
}

// Route to list all XML files
router.get('/files', async (req, res) => {
    const startTime = Date.now();
    console.log('=== XML Files Request Started ===');
    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };
    
    try {
        // Get network path with fallback
        const networkPath = await getNetworkPath();

        // Get existing submission statuses
        const submissionStatuses = await WP_OUTBOUND_STATUS.findAll({
            attributes: [
                'id', 'UUID', 'submissionUid', 'fileName', 'filePath',
                'invoice_number', 'status', 'date_submitted', 'date_sync',
                'date_cancelled', 'cancelled_by', 'cancellation_reason',
                'created_at', 'updated_at'
            ],
            raw: true
        });

        // Create status lookup map
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

        // Create base directories and today's directory for each type/company
        for (const type of types) {
            const typeDir = path.join(networkPath, type);
            await ensureDirectoryExists(typeDir);
            
            // Create today's directory for default company
            await ensureDailyDirectory(networkPath, type, 'Brahims');
            
            // Process existing files
            await processTypeDirectory(typeDir, type, files, processLog, statusMap);
        }

        // Performance metrics
        const endTime = Date.now();
        const duration = endTime - startTime;

        await logSuccess('Successfully retrieved XML files list', {
            user: req.user?.username,
            action: 'LIST_ALL',
            details: {
                totalFiles: files.length,
                processingTime: duration
            }
        });

        // Return empty array if no files found
        if (files.length === 0) {
            return res.json({
                success: true,
                files: [],
                processLog: {
                    ...processLog,
                    summary: {
                        ...processLog.summary,
                        total: 0
                    }
                },
                metrics: {
                    duration,
                    totalFiles: 0
                }
            });
        }

        res.json({
            success: true,
            files,
            processLog,
            metrics: {
                duration,
                totalFiles: files.length
            }
        });

    } catch (error) {
        console.error('Error in /files route:', error);
        await logError('Failed to retrieve XML files list', error, {
            user: req.user?.username,
            action: 'LIST_ALL'
        });
        
        // Return a more informative error response
        res.status(500).json({
            success: false,
            error: {
                code: 'FETCH_ERROR',
                message: 'Failed to fetch XML files',
                details: {
                    error: error.message,
                    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
                }
            },
            files: [],
            processLog: {
                ...processLog,
                summary: {
                    ...processLog.summary,
                    errors: processLog.summary.errors + 1
                }
            }
        });
    }
});

// Route to submit XML to LHDN
router.post('/send-lhdn', async (req, res) => {
    try {
        console.log('=== Manual LHDN Submission Start ===');
        const { fileName, type, company, date, version } = req.body;
        
        if (!fileName || !type || !company || !date || !version) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required parameters',
                    details: {
                        required: ['fileName', 'type', 'company', 'date', 'version'],
                        received: { fileName, type, company, date, version }
                    }
                }
            });
        }

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

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);
           
        // Check for existing submission
        const existingSubmissionCheck = await submitter.checkExistingSubmission(fileName);
        if (existingSubmissionCheck.blocked) {
            return res.status(400).json(existingSubmissionCheck.response);
        }

        // Get network path with fallback
        const networkPath = await getNetworkPath();

        // Format date consistently
        const formattedDate = moment(date).format('YYYY-MM-DD');

        // Build the complete file path using the same helper functions
        const typeDir = path.join(networkPath, type);
        const companyDir = path.join(typeDir, company);
        const dateDir = path.join(companyDir, formattedDate);
        const filePath = path.join(dateDir, fileName);

        console.log('Constructed file path:', {
            networkPath,
            typeDir,
            companyDir,
            dateDir,
            filePath
        });

        // Check if file exists
        try {
            await fsPromises.access(filePath);
            console.log('File found:', filePath);
        } catch (error) {
            console.error('File not found:', filePath);
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'XML file not found',
                    details: {
                        fileName,
                        path: filePath,
                        type,
                        company,
                        date: formattedDate
                    }
                }
            });
        }

        // Read XML data
        const xmlData = await fs.promises.readFile(filePath, 'utf8');
        console.log('Successfully read XML file from:', filePath);

        // Start transaction
        const t = await sequelize.transaction();
        try {
            // Prepare document for submission
            const { payload, invoice_number } = await submitter.prepareXMLDocumentForSubmission(xmlData, version);
            if (!payload) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PREPARATION_ERROR',
                        message: 'Failed to prepare document for submission'
                    }
                });
            }

            // Submit to LHDN
            const result = await submitter.submitToLHDNDocument(payload.documents);
            
            // Process result and update status
            if (result.status === 'success' && result.data.acceptedDocuments?.length > 0) {
                const acceptedDoc = result.data.acceptedDocuments[0];
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: acceptedDoc.uuid,
                    submissionUid: result.data.submissionUid,
                    fileName,
                    filePath,
                    status: 'Submitted'
                }, t);

                await t.commit();
                
                await logSuccess('Successfully submitted XML to LHDN', {
                    user: req.user?.username,
                    action: 'SUBMIT_LHDN',
                    details: {
                        fileName,
                        submissionUid: result.data.submissionUid,
                        uuid: acceptedDoc.uuid,
                        filePath
                    }
                });

                return res.json({
                    success: true,
                    submissionUID: result.data.submissionUid,
                    acceptedDocuments: result.data.acceptedDocuments,
                    docNum: invoice_number
                });
            } else if (result.status === 'failed') {
                // Update status for rejected document
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: 'NA',
                    submissionUid: 'NA',
                    fileName,
                    filePath,
                    status: 'Rejected',
                    error: result.error
                }, t);

                await t.commit();
                return res.status(400).json({
                    success: false,
                    error: result.error
                });
            }

            // If we get here, something unexpected happened
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: {
                    code: 'SUBMISSION_ERROR',
                    message: 'Document submission failed',
                    details: result.error || 'Unknown error'
                }
            });

        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error in /send-lhdn route:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SUBMISSION_ERROR',
                message: error.message || 'Failed to send XML to LHDN',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
});

// Get XML file content
router.get('/content/:fileName', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, version } = req.query;

        console.log('=== XML Content Request ===');
        console.log('Request parameters:', {
            fileName,
            type,
            company,
            date,
            version
        });
        
        // Validate required parameters
        if (!type || !company || !date) {
            console.log('Missing required parameters:', { type, company, date });
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAMETERS',
                    message: 'Missing required parameters',
                    details: {
                        required: ['type', 'company', 'date'],
                        received: { type, company, date }
                    }
                }
            });
        }

        // Format date consistently
        const formattedDate = moment(date).format('YYYY-MM-DD');
        console.log('Formatted date:', formattedDate);
        
        // Get network path with fallback
        const networkPath = await getNetworkPath();
        console.log('Network path:', networkPath);

        // Build the complete file path
        const typeDir = path.join(networkPath, type);
        const companyDir = path.join(typeDir, company);
        const dateDir = path.join(companyDir, formattedDate);
        const filePath = path.join(dateDir, fileName);

        console.log('Constructed file path:', {
            networkPath,
            typeDir,
            companyDir,
            dateDir,
            filePath
        });

        // Check if file exists
        try {
            await fsPromises.access(filePath);
            console.log('File found:', filePath);
        } catch (error) {
            console.error('File not found:', filePath);
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'XML file not found',
                    details: {
                        fileName,
                        path: filePath,
                        type,
                        company,
                        date: formattedDate
                    }
                }
            });
        }

        // Read XML content
        console.log('Reading file content...');
        const content = await fs.promises.readFile(filePath, 'utf8');
        
        // Parse XML to validate it
        console.log('Parsing XML content...');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, 'text/xml');
        
        // Extract basic document info for response
        const buyerInfo = await extractBuyerInfo(xmlDoc);
        const stats = await fsPromises.stat(filePath);

        console.log('Successfully read file:', {
            size: stats.size,
            modifiedTime: stats.mtime,
            uploadedDate: stats.birthtime || stats.mtime
        });

        await logSuccess('Successfully retrieved XML file content', {
            user: req.user?.username,
            action: 'GET_CONTENT',
            details: { 
                fileName,
                filePath,
                type,
                company,
                date: formattedDate
            }
        });

        res.json({
            success: true,
            content,
            metadata: {
                fileName,
                filePath,
                size: stats.size,
                modifiedTime: stats.mtime,
                uploadedDate: stats.birthtime || stats.mtime,
                buyerInfo
            }
        });

    } catch (error) {
        console.error('Error reading XML file:', error);
        
        await logError('Failed to read XML file content', error, {
            user: req.user?.username,
            action: 'GET_CONTENT',
            details: {
                fileName,
                type,
                company,
                date
            }
        });

        res.status(500).json({
            success: false,
            error: {
                code: 'READ_ERROR',
                message: error.message || 'Failed to read XML file',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
});


// Cancel XML submission
router.post('/cancel/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        const { reason, fileName, submissionDate } = req.body;

        // Validate required parameters
        if (!uuid || !reason) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required parameters',
                    details: {
                        required: ['uuid', 'reason'],
                        received: { uuid, reason }
                    }
                }
            });
        }

        // Check if user is authenticated and has a valid token
        if (!req.session?.accessToken) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Authentication required or token expired'
                }
            });
        }

        // Start transaction
        const t = await sequelize.transaction();

        try {
            // Get document details from database
            const document = await WP_OUTBOUND_STATUS.findOne({
                where: { UUID: uuid },
                transaction: t
            });

            if (!document) {
                await t.rollback();
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'DOCUMENT_NOT_FOUND',
                        message: 'Document not found',
                        details: { uuid }
                    }
                });
            }

            // Check if document is already cancelled
            if (document.status === 'Cancelled') {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'ALREADY_CANCELLED',
                        message: 'Document is already cancelled',
                        details: { uuid, currentStatus: document.status }
                    }
                });
            }

            // Check cancellation time window (72 hours)
            const submissionTime = new Date(document.date_submitted);
            const timeDiff = sequelize.literal("DATEDIFF(HOUR, date_submitted, GETDATE())");
            
            const timeCheck = await WP_OUTBOUND_STATUS.findOne({
                where: { UUID: uuid },
                attributes: [[timeDiff, 'hoursDiff']],
                raw: true
            });

            if (timeCheck.hoursDiff > 72) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'CANCELLATION_WINDOW_EXPIRED',
                        message: 'Cancellation window has expired (72 hours)',
                        details: {
                            submissionDate: document.date_submitted,
                            hoursElapsed: timeCheck.hoursDiff
                        }
                    }
                });
            }

            // Use token from session
            const token = req.session.accessToken;

            // Call LHDN cancellation service
            try {
                const lhdnResponse = await cancelValidDocumentBySupplier(uuid, reason, token);

                if (lhdnResponse.status === 'error' || lhdnResponse.error) {
                    throw new Error(lhdnResponse.error?.message || lhdnResponse.error || 'Failed to cancel document in LHDN');
                }

                // Update status in database
                const [updated] = await Promise.all([
                    // Update outbound status
                    WP_OUTBOUND_STATUS.update({
                        status: 'Cancelled',
                        date_cancelled: sequelize.literal('GETDATE()'),
                        cancelled_by: req.user?.username || 'System',
                        cancellation_reason: reason,
                        updated_at: sequelize.literal('GETDATE()')
                    }, {
                        where: { UUID: uuid },
                        transaction: t
                    }),
                    // Log the cancellation
                    WP_LOGS.create({
                        Description: `Document cancelled: ${fileName || uuid}`,
                        CreateTS: sequelize.literal('GETDATE()'),
                        LoggedUser: req.user?.username || 'System',
                        LogType: 'INFO',
                        Module: 'XML_FILES',
                        Action: 'CANCEL',
                        Status: 'SUCCESS',
                        Details: JSON.stringify({
                            uuid,
                            reason,
                            fileName,
                            submissionDate,
                            lhdnResponse
                        })
                    }, {
                        transaction: t
                    })
                ]);

                if (!updated[0]) {
                    await t.rollback();
                    throw new Error('Failed to update document status');
                }

                // Commit transaction
                await t.commit();

                await logSuccess('Document cancelled successfully', {
                    user: req.user?.username,
                    action: 'CANCEL',
                    details: { uuid, fileName, lhdnResponse }
                });

                res.json({
                    success: true,
                    message: 'Document cancelled successfully',
                    details: {
                        uuid,
                        fileName,
                        cancelledBy: req.user?.username,
                        cancelledAt: sequelize.literal('GETDATE()'),
                        lhdnResponse
                    }
                });

            } catch (lhdnError) {
                // Handle LHDN API specific errors
                if (lhdnError.response?.status === 400) {
                    const errorMessage = lhdnError.response?.data?.error?.message || 
                                      lhdnError.response?.data?.message || 
                                      'Invalid request to LHDN API';
                    throw new Error(`LHDN API Error: ${errorMessage}`);
                }
                throw lhdnError;
            }

        } catch (error) {
            await t.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error in cancel route:', error);
        
        await logError('Failed to cancel document', error, {
            user: req.user?.username,
            action: 'CANCEL'
        });

        // Handle specific LHDN API errors
        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT',
                    message: 'LHDN API rate limit exceeded. Please try again later.',
                    details: error.message
                }
            });
        }

        res.status(500).json({
            success: false,
            error: {
                code: 'CANCELLATION_ERROR',
                message: error.message || 'Failed to cancel document',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
});

module.exports = router;
