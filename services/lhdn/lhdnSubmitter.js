const {
  getCertificatesHashedParams,
  validateCustomerTin,
  submitDocument
} = require('./lhdnService');
const { WP_OUTBOUND_STATUS, WP_LOGS, sequelize, WP_CONFIGURATION } = require('../../models');
const moment = require('moment');
const { Op } = require('sequelize');
const axios = require('axios');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const { getActiveSAPConfig } = require('../../config/paths');
const { processExcelData } = require('./processExcelData');
const { parseStringPromise } = require('xml2js');
const { getTokenSession } = require('../token.service');

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

    return {
        baseUrl,
        environment: settings.environment,
        timeout: parseInt(settings.timeout) || 60000,
        retryEnabled: settings.retryEnabled !== false,
        maxRetries: settings.maxRetries || 3,
        retryDelay: settings.retryDelay || 3000,
        maxRetryDelay: settings.maxRetryDelay || 60000
    };
}

class LHDNSubmitter {
  constructor(req) {
    this.req = req;
    this.baseUrl = null;  // Will be set after loading config
    this.loadConfig();  // Initialize configuration
  }

  async loadConfig() {
    try {
      // Get LHDN configuration from database
      const config = await require('../../models').WP_CONFIGURATION.findOne({
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
        CreateTS: new Date().toISOString(),
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
      console.log("Using Login Authentication Token", token);
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
      // Get token from session
      const token = await getTokenSession();
      if (!token) {
        throw new Error('No valid authentication token found');
      }

      const result = await submitDocument(docs, token);
      console.log('Submission result:', JSON.stringify(result, null, 2));

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
      // Improved error logging
      console.error('Error submitting document:', {
        message: error.message,
        code: error.response?.data?.code,
        details: error.response?.data?.error?.details || error.response?.data?.details,
        fullError: JSON.stringify(error.response?.data, null, 2)
      });

      return {
        status: 'failed',
        error: {
          code: error.response?.data?.code || 'SUBMISSION_ERROR',
          message: error.message || 'Failed to submit document to LHDN',
          details: error.response?.data?.error?.details || error.response?.data?.details || error.response?.data
        }
      };
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

  async getSubmissionDetails(submissionUid, token) {
    try {
      const lhdnConfig = await getLHDNConfig();
      const response = await axios.get(
        `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.data?.documents?.[0]?.longId) {
        return {
          success: true,
          longId: response.data.documents[0].longId
        };
      }

      // Add retry logic for longId
      let retries = 0;
      const maxRetries = 3;
      while (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        const retryResponse = await axios.get(
          `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        if (retryResponse.data?.documents?.[0]?.longId) {
          return {
            success: true,
            longId: retryResponse.data.documents[0].longId
          };
        }
        retries++;
      }

      return {
        success: false,
        error: 'Could not retrieve longId after multiple attempts'
      };
    } catch (error) {
      console.error('Error getting submission details:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async updateExcelWithResponse(fileName, type, company, date, uuid, longId, invoice_number) {
    try {
      console.log('=== updateExcelWithResponse Start ===');
      console.log('Input Parameters:', { fileName, type, company, date, uuid, longId, invoice_number });

      // Get network path from config
      const config = await getActiveSAPConfig();
      console.log('SAP Config:', config);

      if (!config.success) {
        throw new Error('Failed to get SAP configuration');
      }

      // Format date properly for folder structure
      const formattedDate = moment(date).format('YYYY-MM-DD');

      // Construct base paths for outgoing files
      const outgoingBasePath = path.join('C:\\SFTPRoot\\Outgoing', type, company, formattedDate);
      const outgoingJSONPath = path.join('C:\\SFTPRoot\\Outgoing', type, company);
      const outgoingFilePath = path.join(outgoingBasePath, fileName);

      // Generate JSON file in the same folder as Excel
      const baseFileName = fileName.replace('.xls', '');
      const jsonFileName = `${baseFileName}.json`;
      const jsonFilePath = path.join(outgoingJSONPath, jsonFileName);

      // Create directory structure recursively
      await fsPromises.mkdir(outgoingBasePath, { recursive: true });

      // Construct incoming file path
      const incomingPath = path.join(config.networkPath, type, company, formattedDate, fileName);

      console.log('File Paths:', {
        incomingPath,
        outgoingFilePath,
        jsonFilePath
      });

      // Read source Excel file
      const workbook = XLSX.readFile(incomingPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Find header row and update UUID and invoice_number
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const typeCell = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (worksheet[typeCell] && worksheet[typeCell].v === 'H') {
          const uuidCell = XLSX.utils.encode_cell({ r: R, c: 2 });
          worksheet[uuidCell] = { t: 's', v: uuid };
          const invoiceCell = XLSX.utils.encode_cell({ r: R, c: 3 });
          worksheet[invoiceCell] = { t: 's', v: invoice_number };
          break;
        }
      }

      // Write updated Excel file
      XLSX.writeFile(workbook, outgoingFilePath);

      // Get processed data
      const processedData = await this.getProcessedData(fileName, type, company, date);
      console.log('Processed Data:', processedData);

      // Create JSON content with simplified structure
      const jsonContent = {
        "issueDate": moment(date).format('YYYY-MM-DD'),
        "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
        "invoiceTypeCode": processedData.invoiceType || processedData.header?.invoiceType || "01",
        "invoiceNo": invoice_number,
        "uuid": uuid,
      };
      // Write JSON file
      await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));

      const response = {
        success: true,
        outgoingPath: outgoingFilePath,
        jsonPath: jsonFilePath
      };

      console.log('=== updateExcelWithResponse Response ===', response);
      return response;

    } catch (error) {
      console.error('=== updateExcelWithResponse Error ===', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

}

module.exports = LHDNSubmitter;