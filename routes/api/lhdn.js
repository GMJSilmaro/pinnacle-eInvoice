const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache'); // Change to NodeCache
const path = require('path');
const fs = require('fs').promises;
const jsrender = require('jsrender');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');
const xml2js = require('xml2js');


// Helper function to format currency numbers
function formatNumber(number) {
    if (!number) return '0.00';
    return parseFloat(number).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Helper function to overlay logo on QR code
async function generateQRWithLogo(qrData, logoUrl) {
    // Generate the QR code on a canvas
    const canvas = createCanvas(200, 200);
    await QRCode.toCanvas(canvas, qrData, {
        width: 200,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        },
        errorCorrectionLevel: 'H',
        quality: 1,
        version: 4
    });

    // Load and draw the logo
    try {
        const logo = await loadImage(logoUrl);
        const ctx = canvas.getContext('2d');
        
        // Calculate logo size (30% of QR code)
        const logoSize = canvas.width * 0.3;
        const logoX = (canvas.width - logoSize) / 2;
        const logoY = (canvas.height - logoSize) / 2;

        // Create white background for logo
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(logoX - 2, logoY - 2, logoSize + 4, logoSize + 4);
        
        // Draw the logo
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        
        return canvas.toDataURL();
    } catch (error) {
        console.error('Error overlaying logo:', error);
        // Return original QR code if logo overlay fails
        return canvas.toDataURL();
    }
}

// Initialize cache with 5 minutes standard TTL
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes in seconds

// Database models
const { WP_INBOUND_STATUS, WP_USER_REGISTRATION, WP_COMPANY_SETTINGS } = require('../../models');

// Helper function for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced delay function with exponential backoff
const calculateBackoff = (retryCount, baseDelay = 1000, maxDelay = 60000) => {
    const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount));
    const jitter = Math.random() * 1000; // Add some randomness to prevent thundering herd
    return backoff + jitter;
};

// Add this function to ensure temp directory exists
async function ensureTempDirectory() {
    const tempDir = path.join(__dirname, '../../public/temp');
    try {
        await fs.access(tempDir);
    } catch {
        // Directory doesn't exist, create it
        await fs.mkdir(tempDir, { recursive: true });
    }
}

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

// Document fetching function
const fetchRecentDocuments = async (req) => {
    console.log('User from session:', req.session.user);
    const allDocuments = [];
    let pageNo = 1; 
    const pageSize = 100;
    let totalPages = 999; 
    let hasMorePages = true;

    // Get document retrieval limits
    const limits = getDocumentRetrievalLimits();

    // Configuration for rate limiting and retries
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second base delay between requests
    const maxDelay = 60000; // Maximum delay of 60 seconds
    const regularRequestDelay = 500; // 500ms delay between regular requests

    const config = {
        method: 'get',
        headers: {
            'Authorization': `Bearer ${req.session.accessToken}`
        },
        timeout: 30000
    };

    try {
        while (pageNo <= totalPages && hasMorePages) {
            let retryCount = 0;
            let success = false;
            let currentPageData = null;

            // Check if we've hit the maximum document limit
            if (allDocuments.length >= limits.maxDocuments) {
                console.log(`Maximum document limit (${limits.maxDocuments}) reached. Stopping pagination.`);
                break;
            }

            while (!success && retryCount <= maxRetries) {
                try {
                    // Add small delay between regular requests to prevent rate limiting
                    if (retryCount === 0 && pageNo > 1) {
                        await delay(regularRequestDelay);
                    }

                    config.url = `${process.env.API_BASE_URL}/api/v1.0/documents/recent?pageNo=${pageNo}&pageSize=${pageSize}`;
                    console.log(`Fetching page ${pageNo} (Attempt ${retryCount + 1}/${maxRetries + 1})...`);
                    
                    const response = await axios(config);
                    currentPageData = response.data;

                    // Log the complete raw data for the first document
                    if (pageNo === 1 && currentPageData.result && currentPageData.result.length > 0) {
                        console.log('Raw API Response:', JSON.stringify(currentPageData.result[0], null, 2));
                    }

                    if (!currentPageData.result || currentPageData.result.length === 0) {
                        console.log(`No more documents found on page ${pageNo}.`);
                        hasMorePages = false;
                        break;
                    }

                    // Filter documents based on time window
                    const validDocuments = currentPageData.result.filter(doc => limits.validateTimeWindow(doc.dateTimeIssued));
                    
                    if (validDocuments.length === 0) {
                        console.log('All documents on this page are outside the time window. Stopping pagination.');
                        hasMorePages = false;
                        break;
                    }

                    const mappedDocuments = validDocuments.map(doc => ({
                        ...doc,
                        typeName: doc.typeName,
                        typeVersionName: doc.typeVersionName,
                        totalSales: doc.total || doc.totalSales || doc.netAmount || doc.totalPayableAmount ||  0
                    }));

                    allDocuments.push(...mappedDocuments);
                    console.log(`Successfully fetched page ${pageNo} with ${validDocuments.length} valid documents.`);

                    if (currentPageData.meta?.totalPages) {
                        totalPages = currentPageData.meta.totalPages;
                    }

                    success = true;

                    // After successfully fetching each page, save to database
                    try {
                        if (currentPageData && currentPageData.result) {
                            await saveInboundStatus({ result: currentPageData.result });
                            console.log(`Saved page ${pageNo} documents to database`);
                        }
                    } catch (saveError) {
                        console.error(`Error saving page ${pageNo} to database:`, saveError);
                        // Continue fetching even if save fails
                    }

                    pageNo++;

                } catch (error) {
                    if (error.response?.status === 429) {
                        retryCount++;
                        if (retryCount <= maxRetries) {
                            const backoffDelay = calculateBackoff(retryCount, baseDelay, maxDelay);
                            console.log(`Rate limited on page ${pageNo}. Retry attempt ${retryCount}/${maxRetries}. Waiting ${Math.round(backoffDelay/1000)} seconds...`);
                            await delay(backoffDelay);
                            continue;
                        } else {
                            console.error(`Max retries (${maxRetries}) reached for page ${pageNo}. Stopping pagination.`);
                            hasMorePages = false;
                            break;
                        }
                    } else if (error.response?.status === 401 || error.response?.status === 403) {
                        console.error('Authentication/Authorization error:', error.response.status);
                        throw new Error('Authentication failed. Please log in again.');
                    } else if (error.code === 'ECONNABORTED') {
                        console.error(`Request timeout for page ${pageNo}`);
                        retryCount++;
                        if (retryCount <= maxRetries) {
                            const backoffDelay = calculateBackoff(retryCount, baseDelay, maxDelay);
                            console.log(`Retrying after timeout. Attempt ${retryCount}/${maxRetries}. Waiting ${Math.round(backoffDelay/1000)} seconds...`);
                            await delay(backoffDelay);
                            continue;
                        }
                    }
                    
                    console.error(`Unhandled error for page ${pageNo}:`, error.message);
                    throw error;
                }
            }

            if (!success && retryCount > maxRetries) {
                console.error(`Failed to fetch page ${pageNo} after ${maxRetries} retries. Stopping pagination.`);
                break;
            }
        }

        console.log(`Fetch complete. Total documents retrieved: ${allDocuments.length}`);
        return { result: allDocuments };
    } catch (error) {
        console.error('Error in fetchRecentDocuments:', error);
        throw error;
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
            throw error;
        }
    } else {
        console.log('Serving documents from cache');
    }

    return data;
};

// Save to database function
const saveInboundStatus = async (data) => {
    try {
        if (!data.result || !Array.isArray(data.result)) {
            console.warn("No valid data to process");
            return;
        }

        const savedCount = { success: 0, skipped: 0, failed: 0 };
        const errors = [];

        for (const item of data.result) {
            try {
                // Check if document already exists
                const existingDoc = await WP_INBOUND_STATUS.findOne({
                    where: { uuid: item.uuid }
                });

                if (existingDoc) {
                    savedCount.skipped++;
                    continue; // Skip if already exists
                }

                // Extract all possible monetary values with proper parsing
                const totalSales = parseFloat(item.totalSales || item.total || item.netAmount || item.totalPayableAmount || 0);
                const totalExcludingTax = parseFloat(item.totalExcludingTax || 0);
                const totalDiscount = parseFloat(item.totalDiscount || 0);
                const totalNetAmount = parseFloat(item.totalNetAmount || 0);
                const totalPayableAmount = parseFloat(item.totalPayableAmount || 0);

                // Create new record
                await WP_INBOUND_STATUS.create({
                    // Unique identifiers
                    uuid: item.uuid,
                    submissionUid: item.submissionUid || null,
                    longId: item.longId || null,
                    internalId: item.internalId || null,

                    // Document type info
                    typeName: item.typeName || null,
                    typeVersionName: item.typeVersionName || null,
                    documentType: item.documentType || null,
                    documentSubtype: item.documentSubtype || null,

                    // Issuer details
                    issuerTin: item.issuerTin || null,
                    issuerName: item.issuerName || null,
                    issuerAddress: item.issuerAddress || null,
                    issuerContact: item.issuerContact || null,
                    issuerEmail: item.issuerEmail || null,
                    issuerMsicCode: item.issuerMsicCode || null,
                    issuerBusinessActivity: item.issuerBusinessActivity || null,
                    issuerTaxRegNo: item.issuerTaxRegNo || null,

                    // Receiver details
                    receiverId: item.receiverId || null,
                    receiverName: item.receiverName || null,
                    receiverAddress: item.receiverAddress || null,
                    receiverContact: item.receiverContact || null,
                    receiverEmail: item.receiverEmail || null,
                    receiverMsicCode: item.receiverMsicCode || null,
                    receiverTaxRegNo: item.receiverTaxRegNo || null,

                    // Timestamps
                    dateTimeReceived: item.dateTimeReceived ? new Date(item.dateTimeReceived) : null,
                    dateTimeValidated: item.dateTimeValidated ? new Date(item.dateTimeValidated) : null,
                    dateTimeIssued: item.dateTimeIssued ? new Date(item.dateTimeIssued) : null,
                    cancelDateTime: item.cancelDateTime ? new Date(item.cancelDateTime) : null,
                    rejectRequestDateTime: item.rejectRequestDateTime ? new Date(item.rejectRequestDateTime) : null,

                    // Status information
                    status: item.status === 'Submitted' ? 'Queue' : (item.status || null),
                    documentStatusReason: item.documentStatusReason || null,
                    createdByUserId: item.createdByUserId || null,

                    // Financial information
                    totalSales: totalSales,
                    totalExcludingTax: totalExcludingTax,
                    totalDiscount: totalDiscount,
                    totalNetAmount: totalNetAmount,
                    totalPayableAmount: totalPayableAmount,

                    // Additional fields
                    taxType: item.taxType || null,
                    taxRate: item.taxRate || null,
                    exchangeRate: item.exchangeRate || null,
                    documentCurrency: item.documentCurrency || 'MYR',
                    submissionChannel: item.submissionChannel || null,

                    // Store raw document if available
                    rawDocument: item.document || null,
                    
                    // Metadata
                    last_sync_date: new Date(),
                    sync_status: 'success'
                });

                savedCount.success++;
                console.log(`Successfully saved new document with uuid: ${item.uuid}`);
            } catch (err) {
                savedCount.failed++;
                errors.push({ uuid: item.uuid, error: err.message });
                console.error(`Error processing item with uuid ${item.uuid}:`, err);
            }
        }

        console.log('Save operation completed:', {
            totalProcessed: data.result.length,
            successCount: savedCount.success,
            skippedCount: savedCount.skipped,
            failedCount: savedCount.failed,
            errors: errors.length > 0 ? errors : 'None'
        });

        return {
            success: true,
            savedCount,
            errors: errors.length > 0 ? errors : null
        };
    } catch (error) {
        console.error('Error in saveInboundStatus:', error);
        throw error;
    }
};

// Routes
router.get('/documents/recent', async (req, res) => {
    console.log('LHDN documents/recent endpoint hit');
    try {
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        console.log('User from session:', req.session.user);
        console.log('Force refresh:', req.query.forceRefresh);
        
        try {
            const data = await getCachedDocuments(req);
            console.log('Got cached documents, count:', data.result.length);
            
            const documents = data.result.map(doc => ({
                uuid: doc.uuid,
                internalId: doc.internalId,
                dateTimeIssued: doc.dateTimeIssued,
                dateTimeReceived: doc.dateTimeReceived,
                status: doc.status,
                totalSales: doc.totalSales || doc.total || doc.netAmount || 0,
                totalExcludingTax: doc.totalExcludingTax || 0,
                totalDiscount: doc.totalDiscount || 0,
                totalNetAmount: doc.totalNetAmount || 0,
                totalPayableAmount: doc.totalPayableAmount || 0,
                issuerTin: doc.issuerTin,
                issuerTourismTaxNo: doc.issuerTourismTaxNo,
                issuerAddress: doc.issuerAddress,
                issuerContact: doc.issuerContact,
                issuerEmail: doc.issuerEmail,
                issuerMsicCode: doc.issuerMsicCode,
                issuerBusinessActivity: doc.issuerBusinessActivity,
                issuerID: doc.issuerID,
                issuerTaxRegNo: doc.issuerTaxRegNo,
                receiverId: doc.receiverId,
                receiverMsicCode: doc.receiverMsicCode,
                receiverAddress: doc.receiverAddress,
                receiverContact: doc.receiverContact,
                receiverEmail: doc.receiverEmail,
                receiverTaxRegNo: doc.receiverTaxRegNo,
                receiverAttention: doc.receiverAttention,
                projectTitle: doc.projectTitle,
                taxExemptionDetails: doc.taxExemptionDetails,
                taxExemptionAmount: doc.taxExemptionAmount,
                taxType: doc.taxType,
                taxRate: doc.taxRate,
                exchangeRate: doc.exchangeRate,
                originalInvoiceRefNo: doc.originalInvoiceRefNo,
                supplierName: doc.supplierName || doc.issuerName,
                receiverName: doc.receiverName || doc.buyerName,
                supplierTIN: doc.supplierTIN || doc.issuerTIN,
                receiverTIN: doc.receiverTIN || doc.buyerTIN,
                documentCurrency: doc.documentCurrency || 'MYR',
                typeName: doc.typeName,
                typeVersionName: doc.typeVersionName,
                submissionChannel: doc.submissionChannel,
                documentStatusReason: doc.documentStatusReason
            }));

            console.log('Sending response with documents:', documents.length);

            res.json({
                success: true,
                result: documents
            });
        } catch (error) {
            // Check if it's an authentication error
            if (error.message === 'Authentication failed. Please log in again.' || 
                error.response?.status === 401 || 
                error.response?.status === 403) {
                return handleAuthError(req, res);
            }
            throw error;
        }
    } catch (error) {
        console.error('Error in route handler:', error);
        
        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' || 
            error.response?.status === 401 || 
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        res.status(500).json({ 
            success: false, 
            error: {
                message: error.message,
                name: error.name,
                details: error.response?.data?.error || error.original?.message || null
            }
        });
    }
});

router.get('/documents/recent-total', async (req, res) => {
    try {
        const data = await getCachedDocuments(req);
        const totalCount = data.result.length;
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


router.get('/documents/:uuid/display-details', async (req, res) => {
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
            return handleAuthError(req, res);
        }

        // Get document details directly from LHDN API using raw endpoint
        console.log('Fetching raw document from LHDN API...');
        const response = await axios.get(`${process.env.API_BASE_URL}/api/v1.0/documents/${uuid}/raw`, {
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
           const detailsResponse = await axios.get(`${process.env.API_BASE_URL}/api/v1.0/documents/${uuid}/details`, {
               headers: {
                   'Authorization': `Bearer ${req.session.accessToken}`,
                   'Content-Type': 'application/json'
               }
           });

           const detailsData = detailsResponse.data;
           const validationResults = detailsData.validationResults;
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
                    longId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: detailsData.validationResults,
                    supplierSstNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    supplierMsicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: getAddressLines(supplierParty) || documentData.supplierAddress,
                    receiverSstNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    receiverRegistrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    receiverAddress: getAddressLines(customerParty) || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.supplierName,
                    tin: findPartyId(supplierParty, 'TIN') || documentData.supplierTin,
                    registrationNo: findPartyId(supplierParty, 'BRN') || documentData.supplierRegistrationNo,
                    taxRegNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    msicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    address: getAddressLines(supplierParty) || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.receiverName,
                    tin: findPartyId(customerParty, 'TIN') || documentData.receiverTin,
                    registrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    taxRegNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    address: getAddressLines(customerParty) || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxInclusiveAmount']) || documentData.totalSales,
                    totalExcludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxExclusiveAmount']) || documentData.totalExcludingTax,
                    taxAmount: getMonetaryValue(invoice?.['cac:TaxTotal']?.[0]?.['cbc:TaxAmount']) || 
                              (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid
                }
            });
        }

        // If document field exists, parse it and extract detailed info
        try {
            //const parsedDocument = JSON.parse(documentData.document);
            // Check if document field exists and can be parsed
            let parsedDocument = null;
            if (documentData.document) {
                try {
                    // Try XML parsing first since we know it's XML
                    const parser = new xml2js.Parser({ explicitArray: true });
                    parsedDocument = await new Promise((resolve, reject) => {

                    parser.parseString(documentData.document, (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                });
                console.log('Parsed XML structure:', JSON.stringify(parsedDocument, null, 2));
            } catch (xmlError) {
                console.log('Failed to parse document as XML:', xmlError);
            }
        }
            // Extract data from parsed document (handles XML)
            const invoice = parsedDocument?.Invoice;
            const supplierParty = invoice?.['cac:AccountingSupplierParty']?.[0]?.['cac:Party']?.[0];

            const customerParty = invoice?.['cac:AccountingCustomerParty']?.[0]?.['cac:Party']?.[0];

            // Helper function to find party identification
            const findPartyId = (party, schemeId) => {
                if (!party?.['cac:PartyIdentification']) return null;
                const identification = party['cac:PartyIdentification'].find(id => 
                    id?.['cbc:ID']?.[0]?.$?.schemeID === schemeId
                );
                return identification?.['cbc:ID']?.[0]._ || null;
            };

            // Helper function to get address lines
            const getAddressLines = (party) => {
                const addressLines = party?.['cac:PostalAddress']?.[0]?.['cac:AddressLine'] || [];
                return addressLines.map(line => line['cbc:Line']?.[0]).filter(Boolean).join(', ');
            };

            // Helper function to get monetary value
            const getMonetaryValue = (path) => {
                return path?.[0]?._ ? parseFloat(path[0]._) : 0;
            };
            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: detailsData.validationResults,
                    supplierSstNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    supplierMsicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: getAddressLines(supplierParty) || documentData.supplierAddress,
                    receiverSstNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    receiverRegistrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    receiverAddress: getAddressLines(customerParty) || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.supplierName,
                    tin: findPartyId(supplierParty, 'TIN') || documentData.supplierTin,
                    registrationNo: findPartyId(supplierParty, 'BRN') || documentData.supplierRegistrationNo,
                    taxRegNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    msicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    address: getAddressLines(supplierParty) || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.receiverName,
                    tin: findPartyId(customerParty, 'TIN') || documentData.receiverTin,
                    registrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    taxRegNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    address: getAddressLines(customerParty) || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxInclusiveAmount']) || documentData.totalSales,
                    totalExcludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxExclusiveAmount']) || documentData.totalExcludingTax,
                    taxAmount: getMonetaryValue(invoice?.['cac:TaxTotal']?.[0]?.['cbc:TaxAmount']) || 
                              (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid
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
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: detailsData.validationResults,
                    supplierSstNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    supplierMsicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: getAddressLines(supplierParty) || documentData.supplierAddress,
                    receiverSstNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    receiverRegistrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    receiverAddress: getAddressLines(customerParty) || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.supplierName,
                    tin: findPartyId(supplierParty, 'TIN') || documentData.supplierTin,
                    registrationNo: findPartyId(supplierParty, 'BRN') || documentData.supplierRegistrationNo,
                    taxRegNo: findPartyId(supplierParty, 'SST') || documentData.supplierSstNo,
                    msicCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || documentData.supplierMsicCode,
                    address: getAddressLines(supplierParty) || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || documentData.receiverName,
                    tin: findPartyId(customerParty, 'TIN') || documentData.receiverTin,
                    registrationNo: findPartyId(customerParty, 'BRN') || documentData.receiverRegistrationNo,
                    taxRegNo: findPartyId(customerParty, 'SST') || documentData.receiverSstNo,
                    address: getAddressLines(customerParty) || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxInclusiveAmount']) || documentData.totalSales,
                    totalExcludingTax: getMonetaryValue(invoice?.['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxExclusiveAmount']) || documentData.totalExcludingTax,
                    taxAmount: getMonetaryValue(invoice?.['cac:TaxTotal']?.[0]?.['cbc:TaxAmount']) || 
                              (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid
                }
            });
        }

    } catch (error) {
        console.error('Error fetching document details:', error);
        
        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' || 
            error.response?.status === 401 || 
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

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
//route to check if PDF exists
router.get('/documents/:uuid/check-pdf', async (req, res) => {
    try {
        const { uuid, longId } = req.params;
        console.log('Checking PDF for document:', uuid);
        console.log('Long ID:', longId);
        const pdfPath = path.join(__dirname, '../../public/temp', `${uuid}.pdf`);
        
        try {
            await fs.access(pdfPath);
            return res.json({ exists: true });
        } catch {
            return res.json({ exists: false });
        }
    } catch (error) {
        console.error('Error checking PDF:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check PDF existence'
        });
    }
});
  
// XML PDF generation route
router.post('/documents/:uuid/xml-pdf', async (req, res) => {
    try {
        console.log('=== Starting PDF Generation Process ===');
        const { uuid } = req.params;
        //console.log('UUID:', uuid);

        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);
       // console.log('PDF Path:', pdfPath);

        // Check if PDF exists
        try {
            await fs.access(pdfPath);
           // console.log('✓ PDF already exists in cache:', pdfPath);
            return res.json({
                success: true,
                url: `/temp/${uuid}.pdf`,
                cached: true,
                message: 'Loading existing PDF from cache...'
            });
        } catch {
           // console.log('× PDF not found in cache, will generate new one');
        }

        // Get raw document data
       // console.log('Fetching document data from API...');
        const response = await axios.get(`${process.env.API_BASE_URL}/api/v1.0/documents/${uuid}/raw`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        //console.log('✓ Document data fetched successfully');

        // Get user and company data
       // console.log('Fetching user data...');
        const user = await WP_USER_REGISTRATION.findOne({
            where: { Username: req.session.user.username }
        });

        if (!user) {
            console.log('× User not found');
            throw new Error('User not found');
        }
       // console.log('✓ User found:', { username: user.Username, TIN: user.TIN });

        //console.log('Fetching company data...');
        const company = await WP_COMPANY_SETTINGS.findOne({
            where: { TIN: user.TIN }
        });
      //  console.log('✓ Company data:', company ? 'Found' : 'Not found');

        // Handle company logo
        //console.log('Processing company logo...');
        const logoPath = company?.CompanyImage 
            ? path.join(__dirname, '../../public', company.CompanyImage)
            : null;
       // console.log('Logo path:', logoPath);

        let logoBase64;
        try {
            const logoBuffer = await fs.readFile(logoPath);
            const logoExt = path.extname(logoPath).substring(1);
            logoBase64 = `data:image/${logoExt};base64,${logoBuffer.toString('base64')}`;
            console.log('✓ Logo converted to base64 successfully');
        } catch (error) {
            console.error('× Error reading logo:', error);
            console.log('Using default image placeholder');
            //logoBase64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJmZWF0aGVyIGZlYXRoZXItaW1hZ2UiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PGNpcmNsZSBjeD0iOC41IiBjeT0iOC41IiByPSIxLjUiPjwvY2lyY2xlPjxwb2x5bGluZSBwb2ludHM9IjIxIDE1IDEwIDIxIDMgMTUiPjwvcG9seWxpbmU+PC9zdmc+';
            logoBase64 = null;
        }

           // Parse document data
           const rawData = response.data;
           console.log('Raw data structure:', {
               hasDocument: !!rawData.document,
               typeName: rawData.typeName,
               internalId: rawData.internalId,
               uuid: rawData.uuid,
               dateTimeIssued: rawData.dateTimeIssued
           });
   
           // Parse XML
           let documentData;
           await new Promise((resolve, reject) => {
               xml2js.parseString(rawData.document, (err, result) => {
                   if (err) {
                       console.error('Error parsing XML:', err);
                       reject(err);
                   }
                   documentData = result;
                   resolve();
               });
           });
           
           console.log('Document parsed successfully');
           
        
        // Extract invoice data from XML structure
        const invoice = documentData.Invoice;
        const supplierParty = invoice['cac:AccountingSupplierParty']?.[0]?.['cac:Party']?.[0];
        const customerParty = invoice['cac:AccountingCustomerParty']?.[0]?.['cac:Party']?.[0];

        // Get tax information from XML structure
        const taxTotal = invoice['cac:TaxTotal']?.[0];
        const taxSubtotal = taxTotal?.['cac:TaxSubtotal']?.[0];
        const taxCategory = taxSubtotal?.['cac:TaxCategory']?.[0];

        // Calculate tax values
        const taxableAmount = parseFloat(taxSubtotal?.['cbc:TaxableAmount']?.[0]._ || 0);
        const taxAmountValue = parseFloat(taxTotal?.['cbc:TaxAmount']?.[0]._ || 0);
        const computedTaxRate = taxableAmount ? ((taxAmountValue / taxableAmount) * 100).toFixed(0) : '0';
        const taxAmount = taxAmountValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
       
        // Generate QR code
        console.log('Generating QR code...');
        const longId = rawData.longId || rawData.longID;
        const lhdnUuid = rawData.uuid;
        const qrCodeUrl = `https://preprod.myinvois.hasil.gov.my/${lhdnUuid}/share/${longId}`;
        console.log('QR Code URL:', qrCodeUrl);

        const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
            width: 200,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });
        console.log('✓ QR code generated successfully');

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
      
        // Update template data mapping for XML structure
        const templateData = {
            // Company Info
            CompanyLogo: logoBase64,
            companyName: supplierParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || 'NA',
            companyAddress: supplierParty?.['cac:PostalAddress']?.[0]?.['cac:AddressLine']?.map(line => line['cbc:Line']?.[0]).join(', ') || 'NA',
            companyPhone: supplierParty?.['cac:Contact']?.[0]?.['cbc:Telephone']?.[0] || 'NA',
            companyEmail: supplierParty?.['cac:Contact']?.[0]?.['cbc:ElectronicMail']?.[0] || 'NA',

            // Document Info
            InvoiceType: invoice['cbc:InvoiceTypeCode']?.[0]._ === '01' ? 'Tax Invoice' : invoice['cbc:InvoiceTypeCode']?.[0] || 'NA',
            InvoiceVersion: invoice['cbc:InvoiceTypeCode']?.[0]?.listVersionId?.[0]._ || '1.0',
            InvoiceCode: invoice['cbc:InvoiceTypeCode']?.[0]?._ || 'NA',
            UniqueIdentifier: rawData.uuid || 'NA',
            internalId: rawData.internalId || 'NA',
            submissionUid: rawData.submissionUid || 'NA',
            dateTimeIssued: new Date(invoice['cbc:IssueDate']?.[0] + 'T' + invoice['cbc:IssueTime']?.[0]).toLocaleString(),
            status: rawData.status || 'NA',

            OriginalInvoiceRef: invoice['cac:BillingReference']?.[0]?.['cac:InvoiceDocumentReference']?.[0]?.['cbc:ID']?.[0] || 'NA',
            dateTimeReceived: new Date(invoice['cbc:IssueDate']?.[0] + 'T' + invoice['cbc:IssueTime']?.[0]).toLocaleString(),

            // Supplier Info
            SupplierTIN: supplierParty?.['cac:PartyIdentification']?.find(id => id['cbc:ID']?.[0]?.$?.schemeID === 'TIN')?.['cbc:ID']?.[0]._ || 'NA',
            SupplierRegistrationNumber: supplierParty?.['cac:PartyIdentification']?.find(id => id['cbc:ID']?.[0]?.$?.schemeID === 'BRN')?.['cbc:ID']?.[0]._ || 'NA',
            SupplierSSTID: supplierParty?.['cac:PartyIdentification']?.find(id => id['cbc:ID']?.[0]?.$?.schemeID === 'SST')?.['cbc:ID']?.[0]._ || 'NA',
            SupplierMSICCode: supplierParty?.['cbc:IndustryClassificationCode']?.[0]._ || '00000',
            SupplierBusinessActivity: supplierParty?.['cbc:IndustryClassificationCode']?.[0]?.$?.name || 'NA',

            // Buyer Info
            BuyerTIN: customerParty?.['cac:PartyIdentification']?.find(id => id['cbc:ID']?.[0]?.$?.schemeID === 'TIN')?.['cbc:ID']?.[0]._ || 'NA',
            BuyerName: customerParty?.['cac:PartyLegalEntity']?.[0]?.['cbc:RegistrationName']?.[0] || 'NA',
            BuyerPhone: customerParty?.['cac:Contact']?.[0]?.['cbc:Telephone']?.[0] || 'NA',
            BuyerRegistrationNumber: customerParty?.['cac:PartyIdentification']?.find(id => id['cbc:ID']?.[0]?.$?.schemeID === 'BRN')?.['cbc:ID']?.[0]._ || 'NA',
            BuyerAddress: customerParty?.['cac:PostalAddress']?.[0]?.['cac:AddressLine']?.map(line => line['cbc:Line']?.[0]).join(', ') || 'NA',

            // Monetary values
            Subtotal: (parseFloat(invoice['cac:LegalMonetaryTotal']?.[0]?.['cbc:LineExtensionAmount']?.[0]._ || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
            TotalExcludingTax: (parseFloat(invoice['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxExclusiveAmount']?.[0]._ || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
            TotalIncludingTax: (parseFloat(invoice['cac:LegalMonetaryTotal']?.[0]?.['cbc:TaxInclusiveAmount']?.[0]._ || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
            TotalPayableAmount: (parseFloat(invoice['cac:LegalMonetaryTotal']?.[0]?.['cbc:PayableAmount']?.[0]._ || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
            TotalTaxAmount: taxAmountValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),

            // Tax Info
            TaxRate: computedTaxRate,
            TaxAmount: taxAmount,

            // Items array
            items: invoice['cac:InvoiceLine']?.map((line, index) => {
                const lineAmount = parseFloat(line['cbc:LineExtensionAmount']?.[0]._ || 0);
                const lineTax = parseFloat(line['cac:TaxTotal']?.[0]?.['cbc:TaxAmount']?.[0]._ || 0);
                const quantity = parseFloat(line['cbc:InvoicedQuantity']?.[0]._ || 0);
                const unitPrice = parseFloat(line['cac:Price']?.[0]?.['cbc:PriceAmount']?.[0]._ || 0);
                const discount = parseFloat(line['cac:AllowanceCharge']?.[0]?.['cbc:Amount']?.[0]._ || 0);

                return {
                    No: index + 1,
                    Cls: line['cac:Item']?.[0]?.['cac:CommodityClassification']?.[0]?.['cbc:ItemClassificationCode']?.[0]._ || 'NA',
                    Description: line['cac:Item']?.[0]?.['cbc:Description']?.[0] || 'NA',
                    Quantity: quantity.toLocaleString('en-US', {minimumFractionDigits: 5, maximumFractionDigits: 5}),
                    UnitPrice: unitPrice.toLocaleString('en-US', {minimumFractionDigits: 4, maximumFractionDigits: 4}),
                    QtyAmount: lineAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
                    Disc: discount === 0 ? '-' : discount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
                    LineTaxPercent: (parseFloat(line['cac:TaxTotal']?.[0]?.['cac:TaxSubtotal']?.[0]?.['cac:TaxCategory']?.[0]?.['cbc:Percent']?.[0] || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
                    LineTaxAmount: lineTax.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
                    Total: (lineAmount + lineTax).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
                };
            }) || [],

            // Footer
            TaxType: taxCategory?.['cbc:ID']?.[0] || '06',
            TaxSchemeId: getTaxTypeDescription(taxCategory?.['cbc:ID']?.[0] || '06'),
            TaxPercent: computedTaxRate,
            qrCode: qrCodeDataUrl,
            DigitalSignature: rawData.digitalSignature || '-',
            validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString()

        };

        console.log('Starting PDF generation process...');
        const templatePath = path.join(__dirname, '../../src/reports/original-invoice-template.html');
        console.log('Template path:', templatePath);

        console.log('Reading template file...');
        const templateContent = await fs.readFile(templatePath, 'utf8');
        console.log('✓ Template file read successfully');

        console.log('Rendering template...');
        const template = jsrender.templates(templateContent);
        const html = template.render(templateData);
        console.log('✓ Template rendered successfully');

        console.log('Launching Puppeteer...');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        console.log('Setting viewport...');
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
        
        console.log('Loading content into page...');
        await page.setContent(html, { waitUntil: 'networkidle0' });

        console.log('Generating PDF buffer...');
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
        });

        console.log('Closing browser...');
        await browser.close();

        console.log('Writing PDF file...');
        await fs.writeFile(pdfPath, pdfBuffer);
        console.log('✓ PDF written successfully to:', pdfPath);

        return res.json({
            success: true,
            url: `/temp/${uuid}.pdf`,
            cached: false,
            message: 'New PDF generated successfully'
        });

    } catch (error) {
        console.error('=== PDF Generation Error ===');
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return res.status(500).json({
            success: false,
            message: `Failed to generate PDF: ${error.message}`,
            details: error.stack
        });
    }
});


// Add static route for temp directory in your Express app
router.use('/temp', express.static(path.join(__dirname, '../../public/temp')));

module.exports = router; 