const path = require('path')
const axios = require('axios');
const CryptoJS = require('crypto-js');
const env = process.env.NODE_ENV || 'dev';
const fs = require('fs');
const forge = require('node-forge');
const jsonminify = require('jsonminify');
const crypto = require('crypto');
require('dotenv').config();
const { WP_CONFIGURATION } = require('../../models');
const { getTokenSession } = require('../token.service');

async function getConfig() {
  const config = await WP_CONFIGURATION.findOne({
    where: {
      Type: 'LHDN',
      IsActive: 1
    },
    order: [['CreateTS', 'DESC']]
  });

  if (!config) {
    throw new Error('LHDN configuration not found');
  }

  let settings = config.Settings;
  if (typeof settings === 'string') {
    settings = JSON.parse(settings);
  }

  return settings;
}

async function getTokenAsIntermediary() {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const httpOptions = {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'client_credentials',
      scope: 'InvoicingAPI'
    };

    const response = await axios.post(
      `${baseUrl}/connect/token`, 
      httpOptions, 
      {
        headers: {
          'onbehalfof': settings.tin,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if(response.status === 200) return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          console.log('=======================================================================================');
          console.log('              LHDN Intermediary Token API hitting rate limit HTTP 429                  ');
          console.log(`              Refetching................. (Waiting time: ${waitTime} ms)                  `);
          console.log('=======================================================================================');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getTokenAsIntermediary();
        }            
      }
    }
    throw new Error(`Failed to get token: ${err.message}`);
  }
}

async function submitDocument(docs, token) {
  try {
    if (!token) {
      throw new Error('Authentication token is required');
    }

    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.post(
      `${baseUrl}/api/v1.0/documentsubmissions`, 
      { documents: docs }, 
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    // Improved error logging
    console.error('LHDN Submission Error:', {
      status: err.response?.status,
      message: err.message,
      details: err.response?.data?.error?.details || err.response?.data?.details,
      fullResponse: JSON.stringify(err.response?.data, null, 2)
    });

    // Handle rate limiting
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;
        
        console.log('=======================================================================================');
        console.log('              LHDN SubmitDocument API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await submitDocument(docs, token);
        }            
      }
    }

    // Enhanced error handling with human-readable messages
    const getHumanReadableError = (errorData) => {
      const errorCode = errorData?.code || 'UNKNOWN_ERROR';
      
      // Map of LHDN error codes to user-friendly messages
      const errorMessages = {
        'DS302': 'This document has already been submitted to LHDN. Please check the document status in LHDN portal.',
        'CF321': 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.',
        'CF364': 'Invalid item classification code. Please ensure all items have valid classification codes.',
        'CF401': 'Tax calculation error. Please verify all tax amounts and calculations in your document.',
        'CF402': 'Currency error. Please check that all monetary values use the correct currency code.',
        'CF403': 'Invalid tax code. Please verify the tax codes used in your document.',
        'CF404': 'Invalid identification. Please check all party identification numbers (TIN, BRN, etc.).',
        'CF405': 'Invalid party information. Please verify supplier/customer details are complete and valid.',
        'AUTH001': 'Authentication failure. Your session may have expired, please try logging in again.',
        'AUTH003': 'Unauthorized access. Your account does not have permission to submit this document.',
        'VALIDATION_ERROR': 'Document validation failed. Please review the document and correct all errors.',
        'DUPLICATE_SUBMISSION': 'This document has already been submitted or is being processed.',
        'E-INVOICE-TIN-VALIDATION-PARTY-VALIDATION': 'TIN validation failed. The document TIN doesn\'t match with your authenticated TIN.',
        'INVALID_PARAMETER': 'Invalid parameters provided. Please check your document formatting.',
        'UNKNOWN_ERROR': 'An unexpected error occurred. Please try again or contact support.'
      };
      
      return {
        code: errorCode,
        message: errorMessages[errorCode] || errorData?.message || 'Failed to submit document to LHDN. Please check your document and try again.',
        details: errorData?.details || errorData?.error?.details || [{
          code: errorCode,
          message: errorData?.message || 'Unknown error occurred',
          target: docs[0]?.codeNumber || 'Unknown'
        }]
      };
    };

    // Handle other errors
    if (err.response?.status === 500) {
      return {
        status: 'failed',
        error: {
          code: 'SYSTEM_ERROR',
          message: 'LHDN system is currently experiencing technical issues. Please try again later or contact LHDN support.',
          details: [{
            code: 'SYSTEM_ERROR',
            message: 'External LHDN SubmitDocument API hitting 500 (Internal Server Error). Please try again later.',
            target: docs[0]?.codeNumber || 'Unknown'
          }]
        }
      };
    }
    
    if (err.response?.status === 400) {
      const errorData = err.response.data;
      
      // Special handling for duplicate document submission
      if (errorData?.code === 'DS302' || (errorData?.details && errorData.details.some(d => d.code === 'DS302'))) {
        return {
          status: 'failed',
          error: {
            code: 'DS302',
            message: 'This document has already been submitted to LHDN',
            details: [{
              code: 'DS302',
              message: 'Document already exists in LHDN system. Please check the document status in LHDN portal.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }
      
      // Return enhanced error with human-readable message
      return { 
        status: 'failed', 
        error: getHumanReadableError(errorData) 
      };
    }
    
    // Default error handler for other status codes
    return {
      status: 'failed',
      error: {
        code: 'SUBMISSION_ERROR',
        message: 'Failed to submit document to LHDN',
        details: [{
          code: err.response?.status?.toString() || 'UNKNOWN',
          message: err.message || 'Unknown error occurred',
          target: docs[0]?.codeNumber || 'Unknown'
        }]
      }
    };
  }
} 

async function getDocumentDetails(irb_uuid, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.get(
      `${baseUrl}/api/v1.0/documents/${irb_uuid}/details`, 
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;
        
        console.log('=======================================================================================');
        console.log('              LHDN DocumentDetails API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getDocumentDetails(irb_uuid, token);
        }            
      }
    }
    console.error(`Failed to get IRB document details for document UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

async function cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const payload = {
      status: 'cancelled',
      reason: cancellation_reason || 'NA'
    };

    const response = await axios.put(
      `${baseUrl}/api/v1.0/documents/state/${irb_uuid}/state`,
      payload, 
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;
        
        console.log('=======================================================================================');
        console.log('              LHDN Cancel Document API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token);
        }            
      }
    }
    console.error(`Failed to cancel document for IRB UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

function jsonToBase64(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const base64String = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(jsonString));
    return base64String;
}

function calculateSHA256(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const hash = CryptoJS.SHA256(jsonString);
    return hash.toString(CryptoJS.enc.Hex);
}

function getCertificatesHashedParams(documentJson) {
  //Note: Supply your JSON without Signature and UBLExtensions
  let jsonStringifyData = JSON.stringify(documentJson)
  const minifiedJsonData = jsonminify(jsonStringifyData);

  const sha256Hash = crypto.createHash('sha256').update(minifiedJsonData, 'utf8').digest('base64');
  const docDigest = sha256Hash;

  const privateKeyPath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_KEY_FILE_PATH);
  const certificatePath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_CERT_FILE_PATH);

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const certificatePem = fs.readFileSync(certificatePath, 'utf8'); 

  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const md = forge.md.sha256.create();
  //NOTE DEV: 12/7/2024 - sign the raw json instead of hashed json
  // md.update(docDigest, 'utf8'); //disable this (no longer work)
  md.update(minifiedJsonData, 'utf8'); //enable this
  const signature = privateKey.sign(md);
  const signatureBase64 = forge.util.encode64(signature);

  // =============================================================
  // Calculate cert Digest
  // =============================================================
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();

  const sha256 = crypto.createHash('sha256').update(derBytes, 'binary').digest('base64');
  const certDigest = sha256;

  // =============================================================
  // Calculate the signed properties section digest
  // =============================================================
  let signingTime = new Date().toISOString()
  let signedProperties = 
  {
    "Target": "signature",
    "SignedProperties": [
      {
        "Id": "id-xades-signed-props",  
        "SignedSignatureProperties": [
            {
              "SigningTime": [
                {
                  "_": signingTime
                }
              ],
              "SigningCertificate": [
                {
                  "Cert": [
                    {
                      "CertDigest": [
                        {
                          "DigestMethod": [
                            {
                              "_": "",
                              "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                            }
                          ],
                          "DigestValue": [
                            {
                              "_": certDigest
                            }
                          ]
                        }
                      ],
                      "IssuerSerial": [
                        {
                          "X509IssuerName": [
                            {
                              "_": process.env.X509IssuerName_VALUE
                            }
                          ],
                          "X509SerialNumber": [
                            {
                              "_": process.env.X509SerialNumber_VALUE
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
      }
    ]
  }
  
  const signedpropsString = JSON.stringify(signedProperties);
  const signedpropsHash = crypto.createHash('sha256').update(signedpropsString, 'utf8').digest('base64');

  // return ({
  //     docDigest, // docDigest
  //     signatureBase64, // sig,
  //     certDigest,
  //     signedpropsHash, // propsDigest
  //     signingTime
  // })

  let certificateJsonPortion_Signature = [
      {
          "ID": [
            {
                "_": "urn:oasis:names:specification:ubl:signature:Invoice"
            }
          ],
          "SignatureMethod": [
            {
                "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ]
      }
  ]

  let certificateJsonPortion_UBLExtensions = [
    {
      "UBLExtension": [
        {
          "ExtensionURI": [
            {
              "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ],
          "ExtensionContent": [
            {
              "UBLDocumentSignatures": [
                {
                  "SignatureInformation": [
                    {
                      "ID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:1"
                        }
                      ],
                      "ReferencedSignatureID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:Invoice"
                        }
                      ],
                      "Signature": [
                        {
                          "Id": "signature",
                          "SignedInfo": [
                            {
                              "SignatureMethod": [
                                {
                                  "_": "",
                                  "Algorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
                                }
                              ],
                              "Reference": [
                                {
                                  "Id": "id-doc-signed-data",
                                  "URI": "",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": docDigest
                                    }
                                  ]
                                },
                                {
                                  "Id": "id-xades-signed-props",
                                  "Type": "http://uri.etsi.org/01903/v1.3.2#SignedProperties",
                                  "URI": "#id-xades-signed-props",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": signedpropsHash
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "SignatureValue": [
                            {
                              "_": signatureBase64
                            }
                          ],
                          "KeyInfo": [
                            {
                              "X509Data": [
                                {
                                  "X509Certificate": [
                                    {
                                      "_": process.env.X509Certificate_VALUE
                                    }
                                  ],
                                  "X509SubjectName": [
                                    {
                                      "_": process.env.X509SubjectName_VALUE
                                    }
                                  ],
                                  "X509IssuerSerial": [
                                    {
                                      "X509IssuerName": [
                                        {
                                          "_": process.env.X509IssuerName_VALUE
                                        }
                                      ],
                                      "X509SerialNumber": [
                                        {
                                          "_": process.env.X509SerialNumber_VALUE
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "Object": [
                            {
                              "QualifyingProperties": [
                                {
                                  "Target": "signature",
                                  "SignedProperties": [
                                    {
                                      "Id": "id-xades-signed-props",
                                      "SignedSignatureProperties": [
                                        {
                                          "SigningTime": [
                                            {
                                              "_": signingTime
                                            }
                                          ],
                                          "SigningCertificate": [
                                            {
                                              "Cert": [
                                                {
                                                  "CertDigest": [
                                                    {
                                                      "DigestMethod": [
                                                        {
                                                          "_": "",
                                                          "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                                        }
                                                      ],
                                                      "DigestValue": [
                                                        {
                                                          "_": certDigest
                                                        }
                                                      ]
                                                    }
                                                  ],
                                                  "IssuerSerial": [
                                                    {
                                                      "X509IssuerName": [
                                                        {
                                                          "_": process.env.X509IssuerName_VALUE
                                                        }
                                                      ],
                                                      "X509SerialNumber": [
                                                        {
                                                          "_": process.env.X509SerialNumber_VALUE
                                                        }
                                                      ]
                                                    }
                                                  ]
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ] 

  //Use this return value to inject back into your raw JSON Invoice[0] without Signature/UBLExtension earlier
  //Then, encode back to SHA256 and Base64 respectively for object value inside Submission Document payload.
  return ({
    certificateJsonPortion_Signature,
    certificateJsonPortion_UBLExtensions
  })

} 

async function testIRBCall(data) {
  try {
    const response = await axios.post(`${process.env.PREPROD_BASE_URL}/connect/token`, httpOptions, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if(response.status == 200) return response.data;
  } catch (err) {
    if (err.response.status == 429) {
      console.log('Current iteration hitting Rate Limit 429 of LHDN Taxpayer Token API, retrying...')
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];

      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          console.log('=======================================================================================');
          console.log('         (TEST API CALL) LHDN Taxpayer Token API hitting rate limit HTTP 429           ');
          console.log(`              Refetching................. (Waiting time: ${waitTime} ms)               `);
          console.log('=======================================================================================');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getTokenAsTaxPayer();
        }            
      }
    } else {
      throw new Error(`Failed to get token: ${err.message}`);
    }
  }
}

async function validateCustomerTin(settings, tin, idType, idValue, token) {
  try {
    if (!['NRIC', 'BRN', 'PASSPORT', 'ARMY'].includes(idType)) {
      throw new Error(`Invalid ID type. Only 'NRIC', 'BRN', 'PASSPORT', 'ARMY' are allowed`);
    }

    if (!settings) {
      settings = await getConfig();
    }
    
    const baseUrl = settings.environment === 'production' ? 
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.get(
      `${baseUrl}/api/v1.0/taxpayer/validate/${tin}?idType=${idType}&idValue=${idValue}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.status === 200) {
      return { status: 'success' };
    }
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await validateCustomerTin(settings, tin, idType, idValue, token);
        }
      }
    }
    throw err;
  }
}

module.exports = { 
    submitDocument,
    validateCustomerTin,
    getTokenAsIntermediary,
    cancelValidDocumentBySupplier,
    getDocumentDetails,
    jsonToBase64,
    calculateSHA256,
    getCertificatesHashedParams,
    testIRBCall
};

