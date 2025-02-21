const { 
  getCertificatesHashedParams,
  validateCustomerTin,
  submitDocument
} = require('./lhdnService');
const { WP_OUTBOUND_STATUS, WP_LOGS, sequelize } = require('../../models');
const moment = require('moment');
const { Op } = require('sequelize');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const { getActiveSAPConfig } = require('../../config/paths');
const { processExcelData } = require('./processExcelData');
const { parseStringPromise } = require('xml2js');

class LHDNSubmitter {
  constructor(req) {
    this.req = req;
    this.baseUrl = null;  // Will be set after loading config
    this.loadConfig();  // Initialize configuration
  }

  async loadConfig() {
    try {
      // Get LHDN configuration from database
      const config = await require('../models').WP_CONFIGURATION.findOne({
        where: {
          Type: 'LHDN',
          IsActive: 1
        },
        order: [['CreateTS', 'DESC']]
      });

      if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
      }

      // Parse settings if it's a string
      let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

      // Set base URL based on environment
      this.baseUrl = settings.environment === 'production' 
        ? settings.productionUrl || settings.middlewareUrl 
        : settings.sandboxUrl || settings.middlewareUrl;

      if (!this.baseUrl) {
        throw new Error('LHDN API URL not configured');
      }

      console.log('Using LHDN configuration:', {
        environment: settings.environment,
        baseUrl: this.baseUrl
      });

    } catch (error) {
      console.error('Error loading LHDN configuration:', error);
      throw new Error('Failed to load LHDN configuration: ' + error.message);
    }
  }

  async logOperation(description, options = {}) {
    const now = new Date();
    try {
      await WP_LOGS.create({
        Description: description,
        CreateTS: now,
        LoggedUser: this.req.session?.user?.username || 'System',
        IPAddress: this.req.ip,
        LogType: options.logType || 'INFO',
        Module: 'OUTBOUND',
        Action: options.action || 'SUBMIT',
        Status: options.status || 'SUCCESS',
        UserID: this.req.session?.user?.id
      });
    } catch (error) {
      console.error('Error creating log:', error);
    }
  }

  async validateCustomerTaxInfo(tin, idType, idValue) {
    try {
      const token = this.req.session.accessToken;
      console.log("Using Login Authentication Token",token);
      const result = await validateCustomerTin(tin, idType, idValue, token);
      return result;
    } catch (error) {
      await this.logOperation(`Customer tax validation failed for TIN: ${tin}`, {
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareDocumentForSubmission(lhdnJson, version) {
    try {
      console.log('Preparing document for submission with version:', version);
      
      const invoiceNumber = lhdnJson?.Invoice?.[0]?.ID?.[0]?._; 
      if (!invoiceNumber) {
        throw new Error('Invoice number not found in the document');
      }

      // Ensure version is set in the document
      if (lhdnJson?.Invoice?.[0]?.InvoiceTypeCode?.[0]) {
        lhdnJson.Invoice[0].InvoiceTypeCode[0].listVersionID = version;
      }

      // Different handling for v1.0 and v1.1
      if (version === '1.1') {
        console.log('Processing as v1.1 document with digital signature');
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } = 
          getCertificatesHashedParams(lhdnJson);

        lhdnJson.Invoice[0].Signature = certificateJsonPortion_Signature;
        lhdnJson.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
      } else {
        console.log('Processing as v1.0 document without digital signature');
        // Remove UBLExtensions and Signature if they exist
        if (lhdnJson.Invoice?.[0]) {
          delete lhdnJson.Invoice[0].UBLExtensions;
          delete lhdnJson.Invoice[0].Signature;
        }
      }
  
      // Create payload
      const payload = {
        "documents": [
          {
            "format": "JSON",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(JSON.stringify(lhdnJson))
              .digest('hex'),
            "codeNumber": invoiceNumber,
            "document": Buffer.from(JSON.stringify(lhdnJson)).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${invoiceNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: invoiceNumber };
    } catch (error) {
      console.error('Error preparing document:', error);
      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareXMLDocumentForSubmission(xmlData, version) {
    try {
      const preparedXMLData = xmlData.replace(/<\?xml.*?\?>/, '').trim();
      console.log('Preparing document for submission with version:', version);
      
      // Parse XML data for validation and extraction
      const parsedXml = await parseStringPromise(preparedXMLData, { explicitArray: false });
      const currentDate = new Date();
      const formattedDate = currentDate.toISOString().split('T')[0];
      const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

      const codeNumber = parsedXml?.Invoice?.['cbc:ID'];
      if (!codeNumber) {
        throw new Error('Invoice ID not found in the XML');
      }

      // Update the XML string directly using regex replacements
      let updatedXMLData = preparedXMLData;
      
      // Update IssueDate
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueDate>[^<]+<\/cbc:IssueDate>/,
        `<cbc:IssueDate>${formattedDate}</cbc:IssueDate>`
      );

      // Update IssueTime
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueTime>[^<]+<\/cbc:IssueTime>/,
        `<cbc:IssueTime>${formattedTime}</cbc:IssueTime>`
      );

      // Update version if needed
      if (version) {
        updatedXMLData = updatedXMLData.replace(
          /<cbc:InvoiceTypeCode[^>]*>/,
          `<cbc:InvoiceTypeCode listVersionID="${version}">`
        );
      }

      console.log('Prepared XML Data:', updatedXMLData);

      const payload = {
        "documents": [
          {
            "format": "XML",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(updatedXMLData)
              .digest('hex'),
            "codeNumber": codeNumber,
            "document": Buffer.from(updatedXMLData).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${codeNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: codeNumber };
    } catch (error) {
      console.error('Error preparing document:', error);

      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async checkExistingSubmission(fileName) {
    try {
      const docNum = this.extractDocNum(fileName);
      const existing = await WP_OUTBOUND_STATUS.findOne({
        where: {
          [Op.or]: [
            { invoice_number: docNum },
            { fileName: { [Op.like]: `%${docNum}%` } }
          ]
        }
      });

      if (existing && ['Submitted', 'Processing'].includes(existing.status)) {
        return {
          blocked: true,
          response: {
            success: false,
            error: {
              code: 'DUPLICATE_SUBMISSION',
              message: 'This document has already been submitted',
              details: [{
                code: 'DUPLICATE',
                message: `Document with ID ${docNum} was submitted on ${existing.date_submitted}`,
                status: existing.status
              }]
            }
          }
        };
      }

      if (existing) {
        await existing.update({
          status: 'Processing',
          updated_at: sequelize.literal('GETDATE()')
        });
      }

      return { blocked: false };
    } catch (error) {
      console.error('Error checking existing submission:', error);
      throw error;
    }
  }

  extractDocNum(fileName) {
    const match = fileName.match(/^(?:\d{2})_([^_]+)_/);
    return match ? match[1] : fileName;
  }

  async getProcessedData(fileName, type, company, date, data = null) {
    try {
      const filePath = await this.constructFilePath(fileName, type, company, date);

      if (data) {
        return {
          ...data,
          filePath
        };
      }

      // Process Excel file and return structured data
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });

      const processedData = processExcelData(rawData);
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }

  async constructFilePath(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }

      console.log('Constructing file path with:', {
        fileName,
        type,
        company,
        date,
      });

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Use the networkPath from config
      const networkPath = config.networkPath;
      if (!networkPath) {
        throw new Error('Network path not found in SAP configuration');
      }

      console.log('Using network path:', networkPath);

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
      console.log('Formatted date:', formattedDate);
      
      // Construct the full path
      const filePath = path.join(networkPath, type, company, formattedDate, fileName);
      console.log('Constructed file path:', filePath);
      
      // Verify the file exists
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);
        console.error('Path components:', {
          networkPath,
          type,
          company,
          formattedDate,
          fileName
        });
        throw new Error(`File not found: ${fileName}`);
      }

      console.log('File found at path:', filePath);
      return filePath;
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw error;
      }
      console.error('Error constructing file path:', error);
      throw new Error(`Failed to construct file path: ${error.message}`);
    }
  }

  async submitToLHDNDocument(docs) {
    try {
      const token = this.req.session.accessToken;
      const result = await submitDocument(docs, token);
      console.log('Token used for submission:', token);
      console.log('Current token session:', token);
      console.log('Submission result:', result);

      // Check if there are rejected documents
      if (result.data?.rejectedDocuments?.length > 0) {
        const rejectedDoc = result.data.rejectedDocuments[0];
        return {
          status: 'failed',
          error: {
            code: rejectedDoc.code || 'REJECTION',
            message: rejectedDoc.message || 'Document was rejected by LHDN',
            details: rejectedDoc
          }
        };
      }

      return result;
    } catch (error) {
      console.error('Error submitting document:', error);
      throw error;
    }
  }

  async updateSubmissionStatus(data, transaction = null) {
    try {
      const submissionData = {
        invoice_number: data.invoice_number,
        UUID: data.uuid || 'NA',
        submissionUid: data.submissionUid || 'NA',
        fileName: data.fileName,
        filePath: data.filePath,
        status: data.status,
        date_submitted: sequelize.literal('GETDATE()'),
        created_at: sequelize.literal('GETDATE()'),
        updated_at: sequelize.literal('GETDATE()')
      };

      await WP_OUTBOUND_STATUS.upsert(submissionData, { transaction });
      
      await this.logOperation(`Status Updated to ${data.status} for invoice ${data.invoice_number}`, {
        action: 'STATUS_UPDATE',
        status: data.status
      });

    } catch (error) {
      console.error('Error updating submission status:', error);
      throw error;
    }
  }

  async updateExcelWithResponse(fileName, type, company, date, uuid, invoice_number) {
    try {
        // Get network path from config
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error('Failed to get SAP configuration');
        }

        // Format date properly for folder structure
        const formattedDate = moment(date).format('YYYY-MM-DD');

        // Construct base paths
        const outgoingRoot = 'C:\\SFTPRoot\\MindValley\\Outgoing';
        const outgoingTypeDir = path.join(outgoingRoot, type);
        const outgoingCompanyDir = path.join(outgoingTypeDir, company);
        const outgoingDateDir = path.join(outgoingCompanyDir, formattedDate);

        // Create directory structure recursively
        await fsPromises.mkdir(outgoingRoot, { recursive: true });
        await fsPromises.mkdir(outgoingTypeDir, { recursive: true });
        await fsPromises.mkdir(outgoingCompanyDir, { recursive: true });
        await fsPromises.mkdir(outgoingDateDir, { recursive: true });

        // Construct file paths
        const incomingPath = path.join(config.networkPath, type, company, formattedDate, fileName);
        const outgoingFilePath = path.join(outgoingDateDir, fileName);

        // Read source Excel file
        const workbook = XLSX.readFile(incomingPath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];

        // Find header row (type "H") and update UUID and invoice_number
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            const typeCell = XLSX.utils.encode_cell({r: R, c: 0}); // First column
            if (worksheet[typeCell] && worksheet[typeCell].v === 'H') {
                // Update UUID in _1 column
                const uuidCell = XLSX.utils.encode_cell({r: R, c: 2}); // _1 column
                worksheet[uuidCell] = { t: 's', v: uuid };

                // Update invoice_number in _2 column
                const invoiceCell = XLSX.utils.encode_cell({r: R, c: 3}); // _2 column
                worksheet[invoiceCell] = { t: 's', v: invoice_number };
                break;
            }
        }

        // Write updated file to outgoing location
        XLSX.writeFile(workbook, outgoingFilePath);

        await this.logOperation(`Generate Response Excel file with UUID and invoice number: ${outgoingFilePath}`, {
            action: 'UPDATE_EXCEL'
        });

        return {
            success: true,
            outgoingPath: outgoingFilePath
        };

    } catch (error) {
        console.error('Error updating Excel file:', error);
        await this.logOperation(`Error updating Excel file: ${error.message}`, {
            action: 'UPDATE_EXCEL',
            status: 'FAILED',
            logType: 'ERROR'
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}


}

module.exports = LHDNSubmitter;