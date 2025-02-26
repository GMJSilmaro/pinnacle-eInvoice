const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { WP_OUTBOUND_STATUS, WP_LOGS, WP_CONFIGURATION, sequelize } = require('../../models');
const { testNetworkPathAccessibility } = require('../../config/paths');
const logsDir = path.join(__dirname, 'logsXML');


if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function getXMLConfig() {
  try {
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

    let settings = config.Settings;
    if (typeof settings === 'string') {
      settings = JSON.parse(settings);
    }

    if (!settings.networkPath) {
      throw new Error('XML network path not configured');
    }

    return settings;
  } catch (error) {
    console.error('Error getting XML config:', error);
    throw error;
  }
}

async function saveLog(description, loggedUser, uuid = null, additionalData = {}) {
  try {
    const user = typeof loggedUser === 'string' ? { Username: loggedUser } : (loggedUser || {});
    await WP_LOGS.create({
      Description: description + (uuid ? ' ' + uuid : ''),
      CreateTS: new Date().toISOString(),
      LoggedUser: user.Username,
      IPAddress: additionalData.ipAddress || null,
      LogType: 'SUBMISSION',
      Module: 'XML TO LHDN',
      Action: 'SUBMISSION',
      Status: 'SUCCESS',
      UserID: user.ID
    });
  } catch (error) {
    console.error('Error saving log:', error.message);
    const fallbackLogPath = path.join(__dirname, 'fallbackLogs.txt');
    fs.appendFileSync(fallbackLogPath, `${new Date().toISOString()} - Error saving log: ${error.message}\n`);
  }
}

async function fetchXMLData() {
  try {
    console.log('=== Fetching XML Data ===');
    const xmlConfig = await getXMLConfig();
    console.log('XML Config:', {
      networkPath: xmlConfig.networkPath,
      domain: xmlConfig.domain,
      hasUsername: !!xmlConfig.username,
      hasPassword: !!xmlConfig.password
    });

    const xmlFolderPath = xmlConfig.networkPath;
    console.log('XML Folder Path:', xmlFolderPath);

    const accessResult = await testNetworkPathAccessibility(xmlFolderPath, {
      serverName: xmlConfig.domain || '',
      serverUsername: xmlConfig.username,
      serverPassword: xmlConfig.password
    });

    if (!accessResult.success) {
      throw new Error(`Cannot access XML folder: ${accessResult.error}`);
    }

    const filePath = path.join(xmlFolderPath);
    console.log('Full File Path:', filePath);

    // Check if file exists and get stats
    const stats = await fs.promises.stat(filePath);

    console.log('File Stats:', {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile()
    });

    if (!stats.isFile()) {
      throw new Error('Path exists but is not a file');
    }

    return filePath;
  } catch (error) {
    console.error('Error in fetchXMLData:', error);
    throw error;
  }
}

function validatePayload(payload) {
  const errors = [];

  // Validate top-level properties
  if (!payload.submissionType) {
    errors.push("Missing submissionType");
  }
  if (!payload.submissionDate) {
    errors.push("Missing submissionDate");
  }
  if (!payload.submissionVersion) {
    errors.push("Missing submissionVersion");
  }

  if (!payload || !Array.isArray(payload.documents) || payload.documents.length === 0) {
    errors.push("Payload must contain at least one document.");
  } else {
    payload.documents.forEach((doc, index) => {
      // Required fields
      if (!doc.format || typeof doc.format !== 'string') {
        errors.push(`Document ${index + 1} is missing a valid 'format' field.`);
      }

      if (!doc.documentHash || typeof doc.documentHash !== 'string') {
        errors.push(`Document ${index + 1} is missing a valid 'documentHash' field.`);
      }

      if (!doc.codeNumber || typeof doc.codeNumber !== 'string') {
        errors.push(`Document ${index + 1} is missing a valid 'codeNumber' field.`);
      }

      if (!doc.document || typeof doc.document !== 'string') {
        errors.push(`Document ${index + 1} is missing a valid 'document' field.`);
      }

      // Additional required fields
      if (!doc.documentType) {
        errors.push(`Document ${index + 1} is missing 'documentType' field.`);
      }

      if (!doc.documentDate) {
        errors.push(`Document ${index + 1} is missing 'documentDate' field.`);
      }

      if (!doc.documentStatus) {
        errors.push(`Document ${index + 1} is missing 'documentStatus' field.`);
      }

      if (!doc.documentCurrency) {
        errors.push(`Document ${index + 1} is missing 'documentCurrency' field.`);
      }

      if (!doc.supplierPartyId) {
        errors.push(`Document ${index + 1} is missing 'supplierPartyId' field.`);
      }

      // Validate format
      if (!isValidDocumentFormat(doc.format)) {
        errors.push(`Document ${index + 1} has an invalid 'format' field.`);
      }

      // Validate date format
      if (doc.documentDate && !moment(doc.documentDate, 'YYYY-MM-DD', true).isValid()) {
        errors.push(`Document ${index + 1} has an invalid date format. Use YYYY-MM-DD.`);
      }
    });
  }

  return errors;
}

function isValidDocumentFormat(format) {
  const validFormats = ['XML', 'PDF', 'DOC']; // Add valid formats as per LHDN requirements
  return validFormats.includes(format);
}

// async function sendXMLToLHDN(req, res) {
//   let codeNumber;
//   let uuid;
//   let xmlFilePath;
//   const token = req.session.accessToken;

//   try {
//     // Use the file path that was found by the route
//     xmlFilePath = req.xmlFilePath;
//     if (!xmlFilePath) {
//       throw new Error('XML file path not provided');
//     }
//     console.log('Using XML file path:', xmlFilePath);

//     // Read XML data directly from the provided path
//     let xmlData = await fs.promises.readFile(xmlFilePath, 'utf8');
//     console.log('Successfully read XML file from:', xmlFilePath);

//     // Remove XML declaration and trim
//     xmlData = xmlData.replace(/<\?xml.*?\?>/, '').trim();

//     // Parse XML data
//     const parsedXml = await parseStringPromise(xmlData, { explicitArray: false });
//     codeNumber = parsedXml?.Invoice?.['cbc:ID'];
//     if (!codeNumber) {
//       throw new Error('Invoice ID not found in the XML');
//     }
//     console.log('Document Code Number:', codeNumber);

//     // Prepare payload for LHDN API
//     const payload = {
//       "documents": [
//         {
//           "format": "XML",
//           "documentHash": require('crypto')
//             .createHash('sha256')
//             .update(xmlData)
//             .digest('hex'),
//           "codeNumber": codeNumber,
//           "document": Buffer.from(xmlData).toString('base64')
//         }
//       ]
//     };
    
//     // Log the payload for debugging
//     console.log('Sending payload to LHDN:', payload, null, 2);
    
//     if (!payload) {
//         return res.status(400).json({
//             success: false,
//             error: {
//                 code: 'PREPARATION_ERROR',
//                 message: 'Failed to prepare document for submission'
//             }
//         });
//     }

//     // Submit to LHDN using the session token
//     const result = await submitDocument(payload.documents, token);
//         // Process result and update status
//         if (result.status === 'success' && result.data.acceptedDocuments?.length > 0) {
//           const acceptedDoc = result.data.acceptedDocuments[0];
//           await submitter.updateSubmissionStatus({
//               invoice_number,
//               uuid: acceptedDoc.uuid,
//               submissionUid: result.data.submissionUid,
//               fileName,
//               filePath: processedData.filePath || fileName,
//               status: 'Submitted'
//           });

//           return res.json({
//               success: true,
//               submissionUID: result.data.submissionUid,
//               acceptedDocuments: result.data.acceptedDocuments,
//               docNum: invoice_number
//           });
//       }

//   } catch (error) {
//     console.error('Error preparing document:', error);
    

//   }
// }

async function saveSubmissionStatus(docNum, uuid, status, sentTime, updatedTime, loggedUser, xmlFilePath) {
  try {
    const formattedSentTime = moment(sentTime).format('YYYY-MM-DD HH:mm:ss');
    const formattedUpdatedTime = moment(updatedTime).format('YYYY-MM-DD HH:mm:ss');

    const submissionData = {
      invoice_number: docNum,
      submissionUid: uuid || 'NA',
      fileName: path.basename(xmlFilePath || ''), // Get filename from path
      filePath: xmlFilePath || '',
      status: status,
      date_submitted: sequelize.literal('GETDATE()'),
      created_at: sequelize.literal('GETDATE()'),
    };

    await WP_OUTBOUND_STATUS.create(submissionData);
    await saveLog(`Invoice ${docNum} submitted successfully.`, loggedUser, uuid);
    await updateSubmissionStatus(submissionData);
  } catch (error) {
    console.error('Error saving submission status:', error);
    await saveLog(`Error saving submission status for invoice ${docNum}. Details: ${error.message}`, loggedUser);
  }
}

async function updateSubmissionStatus(data) {
  try {
    const submissionData = {
      invoice_number: data.invoice_number,
      UUID: data.uuid || 'NA',
      submissionUid: data.submissionUid || 'NA',
      fileName: data.fileName,
      filePath: data.filePath,
      status: data.status,
      date_submitted: sequelize.literal('GETDATE()'),
      cancellation_reason: data.error ? JSON.stringify(data.error) : null,
      created_at: sequelize.literal('GETDATE()'),
      updated_at: sequelize.literal('GETDATE()')
    };

    await WP_OUTBOUND_STATUS.upsert(submissionData);
    
    await saveLog(`Updated status to ${data.status} for invoice ${data.invoice_number}`, null, data.uuid, {
      action: 'STATUS_UPDATE',
      status: data.status
    });

  } catch (error) {
    console.error('Error updating submission status:', error);
    throw error;
  }
}

module.exports = sendXMLToLHDN;
