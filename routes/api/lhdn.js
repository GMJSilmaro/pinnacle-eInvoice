const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache'); // Change to NodeCache
const path = require('path');
const fs = require('fs').promises;
const jsrender = require('jsrender');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { getUnitType } = require('../../utils/UOM');

const { createCanvas, loadImage } = require('canvas');

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
const { raw } = require('body-parser');

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

// Document fetching function
const fetchRecentDocuments = async (req) => {
    console.log('User from session:', req.session.user);
    const allDocuments = [];
    let pageNo = 1;
    const pageSize = 100;
    let totalPages = 999;
    let hasMorePages = true;

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

            while (!success && retryCount <= maxRetries) {
                try {
                    // Add small delay between regular requests to prevent rate limiting
                    if (retryCount === 0 && pageNo > 1) {
                        await delay(regularRequestDelay);
                    }

                    config.url = `${process.env.API_BASE_URL}/api/v1.0/documents/recent?pageNo=${pageNo}&pageSize=${pageSize}`;
                    console.log(`Fetching page ${pageNo} (Attempt ${retryCount + 1}/${maxRetries + 1})...`);

                    const response = await axios(config);
                    const data = response.data;

                    // Log the complete raw data for the first document
                    if (pageNo === 1 && data.result && data.result.length > 0) {
                        console.log('Raw API Response:', JSON.stringify(data.result[0], null, 2));
                    }

                    if (!data.result || data.result.length === 0) {
                        console.log(`No more documents found on page ${pageNo}.`);
                        hasMorePages = false;
                        break;
                    }

                    const mappedDocuments = data.result.map(doc => ({
                        ...doc,
                        typeName: doc.typeName,
                        typeVersionName: doc.typeVersionName,
                        totalSales: doc.total || doc.totalSales || doc.netAmount || doc.totalPayableAmount || 0
                    }));

                    allDocuments.push(...mappedDocuments);
                    console.log(`Successfully fetched page ${pageNo} with ${data.result.length} documents.`);

                    if (data.meta?.totalPages) {
                        totalPages = data.meta.totalPages;
                    }

                    success = true;
                    pageNo++;

                } catch (error) {
                    if (error.response?.status === 429) {
                        retryCount++;
                        if (retryCount <= maxRetries) {
                            const backoffDelay = calculateBackoff(retryCount, baseDelay, maxDelay);
                            console.log(`Rate limited on page ${pageNo}. Retry attempt ${retryCount}/${maxRetries}. Waiting ${Math.round(backoffDelay / 1000)} seconds...`);
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
                            console.log(`Retrying after timeout. Attempt ${retryCount}/${maxRetries}. Waiting ${Math.round(backoffDelay / 1000)} seconds...`);
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

        for (const item of data.result) {
            try {
                await WP_INBOUND_STATUS.upsert({
                    uuid: item.uuid,
                    submissionUid: item.submissionUid || null,
                    longId: item.longId || null,
                    internalId: item.internalId || null,
                    typeName: item.typeName || null,
                    typeVersionName: item.typeVersionName || null,
                    issuerTin: item.issuerTin || null,
                    issuerName: item.issuerName || null,
                    receiverId: item.receiverId || null,
                    receiverName: item.receiverName || null,
                    dateTimeReceived: item.dateTimeReceived ? new Date(item.dateTimeReceived) : null,
                    dateTimeValidated: item.dateTimeValidated ? new Date(item.dateTimeValidated) : null,
                    dateTimeIssued: item.dateTimeIssued ? new Date(item.dateTimeIssued) : null,
                    status: item.status || null,
                    documentStatusReason: item.documentStatusReason || null,
                    cancelDateTime: item.cancelDateTime ? new Date(item.cancelDateTime) : null,
                    rejectRequestDateTime: item.rejectRequestDateTime ? new Date(item.rejectRequestDateTime) : null,
                    createdByUserId: item.createdByUserId || null,
                    totalExcludingTax: parseFloat(item.totalExcludingTax) || null,
                    totalDiscount: parseFloat(item.totalDiscount) || null,
                    totalNetAmount: parseFloat(item.totalNetAmount) || null,
                    totalPayableAmount: parseFloat(item.totalPayableAmount) || null
                });

                console.log(`Successfully processed item with uuid: ${item.uuid}`);
            } catch (err) {
                console.error(`Error processing item with uuid ${item.uuid}:`, err);
            }
        }
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
            // Clear session and redirect to login
            req.session.destroy((err) => {
                if (err) {
                    console.error('Error destroying session:', err);
                }
            });
            return res.status(401).json({
                success: false,
                message: 'User not authenticated',
                redirect: '/login'
            });
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
            console.error('Error processing documents:', error);
            throw error;
        }
    } catch (error) {
        console.error('Error in route handler:', error);
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

// Update display-details endpoint to fetch all required data
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
            return res.redirect('/login');
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
                    irbmUniqueNo: documentData.uuid
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
                    longId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    validationResults: validationResults,
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
                    irbmUniqueNo: documentData.uuid
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

// Update PDF generation route
router.post('/documents/:uuid/pdf', async (req, res) => {
    try {
        console.log('=== Starting PDF Generation Process ===');
        const { uuid } = req.params;

        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);

        // Check if PDF exists
        try {
            await fs.access(pdfPath);
            return res.json({
                success: true,
                url: `/temp/${uuid}.pdf`,
                cached: true,
                message: 'Loading existing PDF from cache...'
            });
        } catch {
            // PDF not found in cache, will generate new one
        }

        // Get raw document data
        const response = await axios.get(`${process.env.API_BASE_URL}/api/v1.0/documents/${uuid}/raw`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        // Get user and company data
        const user = await WP_USER_REGISTRATION.findOne({
            where: { Username: req.session.user.username }
        });

        if (!user) {
            throw new Error('User not found');
        }

        const company = await WP_COMPANY_SETTINGS.findOne({
            where: { TIN: user.TIN }
        });

        // Handle company logo
        const logoPath = company?.CompanyImage
            ? path.join(__dirname, '../../public', company.CompanyImage)
            : null;

        let logoBase64;
        try {
            const logoBuffer = await fs.readFile(logoPath);
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
        const longId = rawData.longId || rawData.longID;
        const lhdnUuid = rawData.uuid;
        const lhdnLongId = longId;
        const qrCodeUrl = `https://preprod.myinvois.hasil.gov.my/${lhdnUuid}/share/${longId}`;
        const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
            width: 200,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });

        // Get tax information from UBL structure
        const taxTotal = invoice.TaxTotal?.[0];
        const taxSubtotal = taxTotal?.TaxSubtotal?.[0];
        const taxCategory = taxSubtotal?.TaxCategory?.[0];

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
        
            // Add to tax summary
            const taxKey = `${taxTypeCode}_${taxPercent}`;
            if (!taxSummary[taxKey]) {
                taxSummary[taxKey] = {
                    taxType: taxTypeCode,
                    taxRate: taxPercent,
                    baseAmount: 0,
                    taxAmount: 0
                };
            }
            taxSummary[taxKey].baseAmount += lineAmount;
            taxSummary[taxKey].taxAmount += lineTax;
        
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
                UnitPrice: taxlineCurrency + ' ' + formattedUnitPrice,
                QtyAmount: lineAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                Disc: discount === 0 ? '0.00' : discount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                Charges: allowanceCharges.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
                LineTaxPercent: taxPercent.toFixed(2),
                LineTaxAmount: taxlineCurrency + ' ' + lineTax.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                Total: taxlineCurrency + ' ' + (lineAmount + lineTax).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                TaxType: getTaxTypeDescription(taxTypeCode)
            };
        }) || []);
        
        const taxSummaryArray = Object.values(taxSummary).map(summary => ({
            baseAmount: parseFloat(summary.baseAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            taxType: getTaxTypeDescription(summary.taxType),
            taxRate: parseFloat(summary.taxRate).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            taxAmount: parseFloat(summary.taxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
            InvoiceType: invoice.InvoiceTypeCode?.[0]._ === '01' ? 'Invoice' : invoice.InvoiceTypeCode?.[0]._ || 'NA',
            InvoiceTypeCode: invoice.InvoiceTypeCode?.[0]._ || 'NA',
            InvoiceTypeName: rawData.typeName || 'NA',
            InvoiceVersion: rawData.typeVersionName || 'NA',
            InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'NA',
            UniqueIdentifier: rawData.uuid || 'NA',
            longID: lhdnLongId || 'NA',
            lhdnLink: qrCodeUrl,

            OriginalInvoiceRef: invoice.BillingReference?.[0]?.AdditionalDocumentReference?.[0]?.ID?.[0]._ || 'NA',
            dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString(),
            documentCurrency: invoice.DocumentCurrencyCode?.[0]._ || 'MYR',
            taxCurrency: invoice.TaxCurrencyCode?.[0]._ || 'MYR',
            TaxExchangeRate: invoice.TaxExchangeRate?.[0]?.CalculationRate?.[0]._ || '----',
            issueDate: invoice.IssueDate?.[0]._ || 'NA',
            issueTime: invoice.IssueTime?.[0]._ || 'NA',

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

            qrCode: qrCodeDataUrl,
            QRLink: qrCodeUrl,
            DigitalSignature: rawData.digitalSignature || '-',
            validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString(),

            taxSummary: taxSummaryArray.map(item => ({
                taxType: item.taxType,
                taxRate: item.taxRate,
                totalAmount: item.baseAmount || '0.00',
                totalTaxAmount: item.taxAmount || '0.00'
            })),

            companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
            companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
            companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
            companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',
            InvoiceType: invoice.InvoiceTypeCode?.[0]._ === '01' ? 'Invoice 1.0' : invoice.InvoiceTypeCode?.[0]._ || 'NA',
            InvoiceVersionCode: invoice.InvoiceTypeCode?.[0].listVersionID || 'NA',
            InvoiceVersion: rawData.typeVersionName || 'NA',
            InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'NA',
            UniqueIdentifier: rawData.uuid || 'NA',
            LHDNlongId: rawData.longId || 'NA',
            OriginalInvoiceRef: invoice.BillingReference?.[0]?.AdditionalDocumentReference?.[0]?.ID?.[0]._ || 'NA',
            dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleDateString('en-GB'),
            issueDate: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._).toLocaleDateString('en-GB') : 'NA',
            issueTime: invoice.IssueTime?.[0]._ || 'NA',

            startPeriodDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || 'NA',
            endPeriodDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || 'NA',
            dateDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || 'NA',

            qrCode: qrCodeDataUrl,
            DigitalSignature: rawData.digitalSignature || '-',
            validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString()
        };

        console.log('Template data mapped:', {
            companyInfo: {
                name: templateData.companyName,
                hasLogo: !!templateData.CompanyLogo
            },
            documentInfo: {
                type: templateData.InvoiceType,
                code: templateData.InvoiceCode,
                uuid: templateData.UniqueIdentifier
            },
            lineItems: `${templateData.items.length} items processed`,
            totals: {
                subtotal: templateData.Subtotal,
                tax: templateData.TotalTaxAmount,
                total: templateData.TotalPayableAmount
            }
        });

        // Generate PDF
        const templatePath = path.join(__dirname, '../../src/reports/original-invoice-template.html');
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const template = jsrender.templates(templateContent);
        const html = template.render(templateData);

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
        });

        await browser.close();
        await fs.writeFile(pdfPath, pdfBuffer);

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