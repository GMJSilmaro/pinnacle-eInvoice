const fs = require('fs');
const path = require('path');
const { getCertificatesHashedParams } = require('./lhdnService');

/**
 * Logger configuration for mapping process
 */
const createLogger = () => {
  const logs = {
    steps: [],
    mappings: [],
    errors: []
  };

  const logStep = (step, data) => {
    logs.steps.push({
      timestamp: new Date().toISOString(),
      step,
      data
    });
  };

  const logMapping = (section, input, output) => {
    logs.mappings.push({
      timestamp: new Date().toISOString(),
      section,
      input,
      output
    });
  };

  const logError = (error, context) => {
    logs.errors.push({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      context
    });
  };

  const writeLogs = (invoiceNo, lhdnFormat) => {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'lhdn');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Write processing logs
      const processLogFileName = `lhdn_process_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const processLogPath = path.join(logsDir, processLogFileName);
      fs.writeFileSync(processLogPath, JSON.stringify(logs, null, 2));
      console.log(`[INFO] LHDN Processing logs written to: ${processLogPath}`);

      // Write LHDN format JSON
      const lhdnFileName = `lhdn_output_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const lhdnPath = path.join(logsDir, lhdnFileName);
      fs.writeFileSync(lhdnPath, JSON.stringify(lhdnFormat, null, 2));
      console.log(`[INFO] LHDN Output JSON written to: ${lhdnPath}`);
    } catch (error) {
      console.error('[ERROR] Failed to write LHDN logs:', error);
    }
  };

  return {
    logStep,
    logMapping,
    logError,
    writeLogs,
    getLogs: () => logs
  };
};

// Helper functions
const convertToBoolean = (value) => {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return false; // default to false if undefined/null
};

const wrapValue = (value, currencyID = null) => {
  // For currency amounts, keep as numbers or return undefined if invalid
  if (currencyID) {
    const numValue = Number(value);
    if (!isNaN(numValue)) {
      return [{
        "_": numValue,
        "currencyID": currencyID
      }];
    }
    return undefined;
  }

  // For non-currency fields, convert null/undefined to empty string
  if (value === null || value === undefined || value === '') {
    return [{
      "_": ""
    }];
  }

  // Convert everything else to string
  return [{
    "_": String(value)
  }];
};

const wrapBoolean = (value) => {
  return [{
    "_": convertToBoolean(value)
  }];
};

const wrapNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const numValue = Number(value);
  return isNaN(numValue) ? undefined : [{
    "_": numValue
  }];
};

const formatDateTime = (date) => {
  if (!date) return undefined;
  
  // If date is already a string in correct format, return it
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date)) {
    return date;
  }

  try {
    // Convert to Date object if it isn't already
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return undefined;
    }
    // Format as ISO string and remove milliseconds and timezone
    return dateObj.toISOString().split('.')[0];
  } catch (error) {
    console.error('Error formatting date:', error);
    return undefined;
  }
};

const mapAddressLines = (line) => {
  if (!line) return undefined;
  
  // Split the address line by commas or line breaks
  const lines = line.split(/[,\n]/).map(l => l.trim()).filter(l => l);
  
  return lines.map(l => ({
    "Line": [{ "_": l }]
  }));
};

const mapAllowanceCharges = (charges) => {
  if (!charges || !Array.isArray(charges)) {
    charges = [charges];
  }
  
  return charges.map(charge => ({
    "ChargeIndicator": wrapBoolean(charge.indicator),
    "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
    "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? [{
      "_": charge.multiplierFactorNumeric
    }] : undefined,
    "Amount": wrapValue(charge.amount || 0, 'MYR')
  })).filter(c => c);
};

const mapCommodityClassifications = (item) => {
  const classifications = [];
  
  if (item.classification?.code) {
    classifications.push({
      "ItemClassificationCode": [{
        "_": item.classification.code,
        "listID": item.classification.type || 'CLASS'
      }]
    });
  }
  
  // Add PTC classification if exists
  if (item.ptcCode) {
    classifications.push({
      "ItemClassificationCode": [{
        "_": item.ptcCode,
        "listID": "PTC"
      }]
    });
  }
  
  return classifications;
};

const mapPartyIdentifications = (identifications = []) => {
  const requiredTypes = ['TIN', 'BRN', 'SST', 'TTX'];
  
  const idMap = identifications.reduce((acc, id) => {
    if (id && id.schemeId) {
      acc[id.schemeId] = id.id || "";
    }
    return acc;
  }, {});

  return requiredTypes.map(schemeId => ({
    "ID": [{
      "_": idMap[schemeId] || "",
      "schemeID": schemeId,
    }]
  }));
};

const mapPartyAddress = (address) => {
  return {
    "CityName": wrapValue(address.city),
    "PostalZone": wrapValue(address.postcode),
    "CountrySubentityCode": wrapValue(address.state),
    "AddressLine": mapAddressLines(address.line || ""),
    "Country": [{
      "IdentificationCode": [{
        "_": address.country || "MYS",
        "listID": "ISO3166-1",
        "listAgencyID": "6"
      }]
    }]
  };
};

const DEFAULT_VALUES = {
  TAX_SCHEME: {
    id: 'OTH',
    schemeId: 'UN/ECE 5153',
    schemeAgencyId: '6'
  },
  TAX_CATEGORY: {
    id: '01',
    exemptionReason: 'NA'
  }
};

const mapTaxScheme = (scheme) => {
  const defaultScheme = DEFAULT_VALUES.TAX_SCHEME;
  return [{
    "ID": [{
      "_": String(scheme?.id || defaultScheme.id),
      "schemeID": scheme?.schemeId || defaultScheme.schemeId,
      "schemeAgencyID": scheme?.schemeAgencyId || defaultScheme.schemeAgencyId
    }]
  }];
};

const mapTaxCategory = (taxCategory, taxScheme) => {
  return [{
    "ID": wrapValue(String(taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id)),
    "TaxExemptionReason": taxCategory?.exemptionReason ? wrapValue(taxCategory.exemptionReason) : undefined,
    "TaxScheme": mapTaxScheme(taxScheme)
  }];
};

// const mapTaxTotal = (tax, currency) => {
//   const taxScheme = tax?.category?.scheme || DEFAULT_VALUES.TAX_SCHEME;
//   const taxCategory = tax?.category || DEFAULT_VALUES.TAX_CATEGORY;

//   return [{
//     "TaxAmount": wrapValue(tax?.taxAmount || 0, currency),
//     "TaxSubtotal": [{
//       "TaxableAmount": wrapValue(tax?.taxableAmount || 0, currency),
//       "TaxAmount": wrapValue(tax?.taxAmount || 0, currency),
//       "Percent": tax?.taxRate ? wrapNumericValue(tax.taxRate) : undefined,
//       "TaxCategory": mapTaxCategory(taxCategory, taxScheme)
//     }]
//   }];
// };

const mapTaxTotal = (taxTotal, currency) => {
  if (!taxTotal) return [];

  return [{
      "TaxAmount": wrapValue(taxTotal.taxAmount || 0, currency),
      "TaxSubtotal": taxTotal.taxSubtotal?.map(subtotal => ({
          "TaxableAmount": wrapValue(subtotal.taxableAmount || 0, currency),
          "TaxAmount": wrapValue(subtotal.taxAmount || 0, currency),
          "TaxCategory": [{
              "ID": [{
                  "_": subtotal.taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id
              }],
              "Percent": wrapNumericValue(subtotal.taxCategory?.percent || 0),
              "TaxExemptionReason": subtotal.taxCategory?.exemptionReason ? 
                  wrapValue(subtotal.taxCategory.exemptionReason) : undefined,
              "TaxScheme": [{
                  "ID": [{
                      "_": subtotal.taxCategory?.taxScheme?.id || "VAT", // This should be "OTH"
                      "schemeID": "UN/ECE 5153",
                      "schemeAgencyID": "6"
                  }]
              }]
          }]
      })) || []
  }];
};

const mapLineItem = (item, currency) => {
  if (!item) return null;

  return {
    "ID": wrapValue(String(item.lineId)),
    "InvoicedQuantity": [{
      "_": Number(item.quantity),
      "unitCode": item.unitCode
    }],
    "LineExtensionAmount": wrapValue(item.lineExtensionAmount, currency),
    "AllowanceCharge": item.allowanceCharges.map(charge => ({
      "ChargeIndicator": wrapBoolean(charge.chargeIndicator),
      "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
      "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? wrapNumericValue(charge.multiplierFactorNumeric) : undefined,
      "Amount": wrapValue(charge.amount || 0, currency)
    })),
    "TaxTotal": mapTaxTotal(item.taxTotal, currency),
    "Item": [{
      "CommodityClassification": mapCommodityClassifications(item.item),
      "Description": wrapValue(item.item.description),
      "OriginCountry": [{
        "IdentificationCode": [{
          "_": item.item.originCountry || "MYS",
          "listID": "ISO3166-1",
          "listAgencyID": "6"
        }]
      }]
    }],
    "Price": [{
      "PriceAmount": wrapValue(item.price.amount, currency)
    }],
    "ItemPriceExtension": [{
      "Amount": wrapValue(item.price.extension, currency)
    }]
  };
};

const mapInvoiceLines = (items, currency = 'MYR') => {
  if (!items || !Array.isArray(items)) {
    return [];
  }
  return items.map(item => mapLineItem(item, currency)).filter(Boolean);
};

// Add this helper function for document references
const mapDocumentReference = (reference) => {
  if (!reference) {
    return {
      "ID": wrapValue(""),
      "DocumentType": wrapValue("")
    };
  }
  return {
    "ID": wrapValue(reference.id || ""),
    "DocumentType": wrapValue(reference.type || ""),
    "DocumentDescription": reference.description ? wrapValue(reference.description) : undefined
  };
};

const mapToLHDNFormat = (excelData, version) => {
  const logger = createLogger();
  
  if (!excelData || !Array.isArray(excelData) || excelData.length === 0) {
    const error = new Error('No document data provided');
    logger.logError(error, { excelData });
    throw error;
  }

  const doc = excelData[0];
  
  if (!doc || !doc.header || !doc.header.invoiceNo) {
    const error = new Error('Invalid document structure');
    logger.logError(error, { doc });
    throw error;
  }

  try {
    logger.logStep('Starting LHDN mapping', { version, documentId: doc.header.invoiceNo });

    // Log input document structure
    logger.logStep('Input Document Structure', {
      header: doc.header,
      parties: {
        supplier: doc.supplier,
        buyer: doc.buyer,
        delivery: doc.delivery
      },
      itemsCount: doc.items?.length,
      summary: doc.summary
    });

    const lhdnFormat = {
      "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "Invoice": [{
        "ID": wrapValue(doc.header.invoiceNo),
        "IssueDate": doc.header.issueDate,
        "IssueTime": doc.header.issueTime,
        "InvoiceTypeCode": [{
          "_": doc.header.invoiceType,
          "listVersionID": version
        }],
        "DocumentCurrencyCode": wrapValue(doc.header.currency),
        "TaxCurrencyCode": wrapValue(doc.header.currency),
        "InvoicePeriod": [{
          "StartDate": wrapValue(doc.header.invoicePeriod.startDate),
          "EndDate": wrapValue(doc.header.invoicePeriod.endDate),
          "Description": wrapValue(doc.header.invoicePeriod.description)
        }],
        "BillingReference": doc.header.documentReference?.billingReference ? [{
          "InvoiceDocumentReference": [{
            "ID": wrapValue(doc.header.documentReference.billingReference || "")
          }]
        }] : [{
          "InvoiceDocumentReference": [{
            "ID": wrapValue("")
          }]
        }],
        "AdditionalDocumentReference": [
          // Main document reference
          mapDocumentReference({
            id: doc.header.documentReference?.billingReference || "",
            type: doc.header.documentReference?.billingReferenceType || ""
          }),
          // Additional references if they exist
          ...(doc.header.documentReference?.additionalRefs || [])
            .map(ref => mapDocumentReference(ref))
            .filter(Boolean)
        ],
        "AccountingSupplierParty": [{
          "AdditionalAccountID": [{
            "_": String(doc.supplier.additionalAccountID),
            "schemeAgencyName": doc.supplier.schemeAgencyName
          }],
          "Party": [{
            "IndustryClassificationCode": [{
              "_": String(doc.supplier.industryClassificationCode),
              "name": doc.supplier.industryName
            }],
            "PartyIdentification": doc.supplier.identifications.map(id => ({
              "ID": [{
                "_": String(id.id),
                "schemeID": id.schemeId
              }]
            })),
            "PostalAddress": [mapPartyAddress(doc.supplier.address)],
            "PartyLegalEntity": [{
              "RegistrationName": wrapValue(doc.supplier.name)
            }],
            "Contact": [{
              "Telephone": wrapValue(doc.supplier.contact.phone),
              "ElectronicMail": wrapValue(doc.supplier.contact.email)
            }]
          }]
        }],
        "AccountingCustomerParty": [{
          "Party": [{
            "PartyIdentification": mapPartyIdentifications(doc.buyer.identifications),
            "PostalAddress": [{
              "CityName": wrapValue(doc.buyer.address.city),
              "PostalZone": wrapValue(doc.buyer.address.postcode),
              "CountrySubentityCode": wrapValue(doc.buyer.address.state),
              "AddressLine": mapAddressLines(doc.buyer.address.line),
              "Country": [{
                "IdentificationCode": [{
                  "_": doc.buyer.address.country || "MYS",
                  "listID": "ISO3166-1",
                  "listAgencyID": "6"
                }]
              }]
            }],
            "PartyLegalEntity": [{
              "RegistrationName": wrapValue(doc.buyer.name)
            }],
            "Contact": [{
              "Telephone": wrapValue(doc.buyer.contact.phone),
              "ElectronicMail": wrapValue(doc.buyer.contact.email)
            }]
          }]
        }],
        ...(doc.delivery?.name || doc.delivery?.address ? {
          "Delivery": [{
            "DeliveryParty": [{
              ...(doc.delivery.identifications?.length > 0 && {
                "PartyIdentification": mapPartyIdentifications(doc.delivery.identifications)
              }),
              ...(doc.delivery.name && {
                "PartyLegalEntity": [{
                  "RegistrationName": wrapValue(doc.delivery.name)
                }]
              }),
              ...(doc.delivery.address && {
                "PostalAddress": [{
                  "CityName": wrapValue(doc.delivery.address.city),
                  "PostalZone": wrapValue(doc.delivery.address.postcode),
                  "CountrySubentityCode": wrapValue(doc.delivery.address.state),
                  "AddressLine": mapAddressLines(doc.delivery.address.line),
                  "Country": [{
                    "IdentificationCode": [{
                      "_": doc.delivery.address.country || "MYS",
                      "listID": "ISO3166-1",
                      "listAgencyID": "6"
                    }]
                  }]
                }]
              })
            }],
            ...(doc.delivery.shipment && {
              "Shipment": [{
                "ID": wrapValue(doc.delivery.shipment.id),
                "FreightAllowanceCharge": [{
                  "ChargeIndicator": wrapBoolean(doc.delivery.shipment.freightAllowanceCharge.indicator),
                  "AllowanceChargeReason": wrapValue(doc.delivery.shipment.freightAllowanceCharge.reason),
                  "Amount": wrapValue(doc.delivery.shipment.freightAllowanceCharge.amount, "MYR")
                }]
              }]
            })
          }]
        } : {}),
        "PaymentMeans": [{
          "PaymentMeansCode": wrapValue(String(doc.payment.paymentMeansCode)),
          "PayeeFinancialAccount": [{
            "ID": wrapValue(doc.payment.payeeFinancialAccount)
          }]
        }],
        "PaymentTerms": [{
          "Note": wrapValue(doc.payment.paymentTerms)
        }],
        "PrepaidPayment": [{
          "ID": wrapValue(doc.payment.prepaidPayment.id),
          "PaidAmount": wrapValue(doc.payment.prepaidPayment.amount, doc.header.currency),
          "PaidDate": wrapValue(doc.payment.prepaidPayment.date),
          "PaidTime": wrapValue(doc.payment.prepaidPayment.time)
        }],
        "AllowanceCharge": mapAllowanceCharges(doc.allowanceCharge),
        "TaxTotal": mapTaxTotal(doc.summary?.taxTotal, doc.header.currency),
        "LegalMonetaryTotal": [{
          "LineExtensionAmount": wrapValue(doc.summary.amounts.lineExtensionAmount, doc.header.currency),
          "TaxExclusiveAmount": wrapValue(doc.summary.amounts.taxExclusiveAmount, doc.header.currency),
          "TaxInclusiveAmount": wrapValue(doc.summary.amounts.taxInclusiveAmount, doc.header.currency),
          "AllowanceTotalAmount": wrapValue(doc.summary.amounts.allowanceTotalAmount, doc.header.currency),
          "ChargeTotalAmount": wrapValue(doc.summary.amounts.chargeTotalAmount, doc.header.currency),
          "PayableRoundingAmount": wrapValue(doc.summary.amounts.payableRoundingAmount, doc.header.currency),
          "PayableAmount": wrapValue(doc.summary.amounts.payableAmount, doc.header.currency)
        }],
        "InvoiceLine": mapInvoiceLines(doc.items, doc.header.currency)
      }]
    };

    // Log header mapping
    logger.logMapping('Header', doc.header, lhdnFormat.Invoice[0]);

    // Map and log supplier party
    const supplierParty = {
      "AccountingSupplierParty": [{
        "AdditionalAccountID": [{
          "_": String(doc.supplier.additionalAccountID),
          "schemeAgencyName": doc.supplier.schemeAgencyName
        }],
        "Party": [{
          "IndustryClassificationCode": [{
            "_": String(doc.supplier.industryClassificationCode),
            "name": doc.supplier.industryName
          }],
          "PartyIdentification": doc.supplier.identifications.map(id => ({
            "ID": [{
              "_": String(id.id),
              "schemeID": id.schemeId
            }]
          })),
          "PostalAddress": [mapPartyAddress(doc.supplier.address)],
          "PartyLegalEntity": [{
            "RegistrationName": wrapValue(doc.supplier.name)
          }],
          "Contact": [{
            "Telephone": wrapValue(doc.supplier.contact.phone),
            "ElectronicMail": wrapValue(doc.supplier.contact.email)
          }]
        }]
      }]
    };
    
    lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...supplierParty };
    logger.logMapping('Supplier', doc.supplier, supplierParty);

    // Map and log buyer party
    const buyerParty = {
      "AccountingCustomerParty": [{
        "Party": [{
          "PartyIdentification": mapPartyIdentifications(doc.buyer.identifications),
          "PostalAddress": [{
            "CityName": wrapValue(doc.buyer.address.city),
            "PostalZone": wrapValue(doc.buyer.address.postcode),
            "CountrySubentityCode": wrapValue(doc.buyer.address.state),
            "AddressLine": mapAddressLines(doc.buyer.address.line),
            "Country": [{
              "IdentificationCode": [{
                "_": doc.buyer.address.country || "MYS",
                "listID": "ISO3166-1",
                "listAgencyID": "6"
              }]
            }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": wrapValue(doc.buyer.name)
          }],
          "Contact": [{
            "Telephone": wrapValue(doc.buyer.contact.phone),
            "ElectronicMail": wrapValue(doc.buyer.contact.email)
          }]
        }]
      }]
    };

    lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...buyerParty };
    logger.logMapping('Buyer', doc.buyer, buyerParty);

    // Update tax and totals mapping
    const taxAndTotals = {
        "TaxTotal": mapTaxTotal(doc.summary?.taxTotal, doc.header.currency),
        "LegalMonetaryTotal": [{
            "LineExtensionAmount": wrapValue(doc.summary.amounts.lineExtensionAmount, doc.header.currency),
            "TaxExclusiveAmount": wrapValue(doc.summary.amounts.taxExclusiveAmount, doc.header.currency),
            "TaxInclusiveAmount": wrapValue(doc.summary.amounts.taxInclusiveAmount, doc.header.currency),
            "AllowanceTotalAmount": wrapValue(doc.summary.amounts.allowanceTotalAmount, doc.header.currency),
            "ChargeTotalAmount": wrapValue(doc.summary.amounts.chargeTotalAmount, doc.header.currency),
            "PayableRoundingAmount": wrapValue(doc.summary.amounts.payableRoundingAmount, doc.header.currency),
            "PayableAmount": wrapValue(doc.summary.amounts.payableAmount, doc.header.currency)
        }]
    };

    lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...taxAndTotals };
    logger.logMapping('TaxAndTotals', { 
        taxTotal: doc.summary?.taxTotal, 
        amounts: doc.summary?.amounts 
    }, taxAndTotals);

    // Add digital signature for version 1.1
    if (version === '1.1') {
      try {
        logger.logStep('Adding Digital Signature', { version });
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } = 
          getCertificatesHashedParams(lhdnFormat);

        lhdnFormat.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
        lhdnFormat.Invoice[0].Signature = certificateJsonPortion_Signature;
        
        logger.logMapping('DigitalSignature', 
          { version, hasSignature: true }, 
          { UBLExtensions: lhdnFormat.Invoice[0].UBLExtensions, Signature: lhdnFormat.Invoice[0].Signature }
        );
      } catch (error) {
        logger.logError(error, { version, stage: 'digital_signature' });
        throw new Error('Failed to add digital signature for version 1.1');
      }
    }

    // Clean the object
    const cleanObject = (obj) => {
      Object.keys(obj).forEach(key => {
        if (obj[key] === undefined || obj[key] === null) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          cleanObject(obj[key]);
        }
      });
      return obj;
    };

    const cleanedFormat = cleanObject(lhdnFormat);
    logger.logStep('Mapping Complete', {
      documentId: doc.header?.invoiceNo,
      version,
      hasSignature: version === '1.1'
    });

    // Write both logs and LHDN format
    logger.writeLogs(doc.header?.invoiceNo || 'unknown', cleanedFormat);

    return cleanedFormat;

  } catch (error) {
    logger.logError(error, { stage: 'mapping', documentId: doc.header?.invoiceNo });
    throw error;
  }
};

module.exports = { mapToLHDNFormat }; 