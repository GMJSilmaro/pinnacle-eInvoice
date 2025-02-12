// Add Tailwind styles at the top of the file
const tableStyles = `
<style>
    /* Source Badge Styles */
    .badge-source {
        @apply inline-flex items-center px-3 py-1 rounded-full text-sm font-medium;
    }
    .badge-source.manual {
        @apply bg-blue-100 text-blue-800;
    }
    .badge-source.schedule {
        @apply bg-purple-100 text-purple-800;
    }

    /* Table Styles */
    .outbound-table-container {
        @apply w-full overflow-hidden rounded-lg shadow bg-white;
    }
    
    .outbound-table {
        @apply min-w-full divide-y divide-gray-200;
    }
    
    .outbound-table th {
        @apply px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap;
    }
    
    .outbound-table td {
        @apply px-4 py-3 whitespace-nowrap text-sm text-gray-900;
    }

    /* Status Badge Styles */
    .outbound-status {
        @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
    }
    .outbound-status.pending {
        @apply bg-yellow-100 text-yellow-800;
    }
    .outbound-status.submitted {
        @apply bg-green-100 text-green-800;
    }
    .outbound-status.cancelled {
        @apply bg-gray-100 text-gray-800;
    }
    .outbound-status.rejected {
        @apply bg-red-100 text-red-800;
    }

    /* Responsive Design */
    @media (max-width: 1280px) {
        .outbound-table th, .outbound-table td {
            @apply px-2 py-2 text-xs;
        }
        .outbound-table-container {
            @apply mx-auto max-w-full;
        }
        .outbound-table {
            @apply table-auto;
        }
    }
</style>`;

// Add styles to document
document.head.insertAdjacentHTML('beforeend', tableStyles);

// Add additional styles to document
const additionalStyles = `
<style>
    /* Table Container */
    .outbound-table-wrapper {
        @apply w-full bg-white shadow-sm rounded-lg overflow-hidden;
    }

    /* Table Controls */
    .outbound-controls {
        @apply flex flex-wrap items-center justify-between p-4 border-b border-gray-200;
    }

    .outbound-length-control {
        @apply flex items-center space-x-2;
    }

    .outbound-search-control {
        @apply relative mt-2 sm:mt-0;
    }

    /* Table Header */
    .outbound-table thead th {
        @apply bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider;
    }

    /* Table Body */
    .outbound-table tbody td {
        @apply px-4 py-3 text-sm text-gray-900 border-b border-gray-200;
    }

    /* Table Footer */
    .outbound-bottom {
        @apply flex flex-wrap items-center justify-between p-4 border-t border-gray-200;
    }

    /* Pagination */
    .outbound-pagination {
        @apply flex items-center justify-end space-x-2;
    }

    .outbound-pagination .paginate_button {
        @apply px-3 py-1 text-sm font-medium rounded-md transition-colors;
    }

    .outbound-pagination .paginate_button.current {
        @apply bg-primary-600 text-white;
    }

    .outbound-pagination .paginate_button:not(.current) {
        @apply text-gray-700 hover:bg-gray-100;
    }

    /* Action Buttons */
    .outbound-action-btn {
        @apply inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md shadow-sm 
        transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2;
    }

    .outbound-action-btn.submit {
        @apply bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500;
    }

    .outbound-action-btn.cancel {
        @apply bg-red-600 text-white hover:bg-red-700 focus:ring-red-500;
    }

    .outbound-action-btn[disabled] {
        @apply bg-gray-200 text-gray-500 cursor-not-allowed opacity-70;
    }
    
  
</style>`;

// Add additional styles to document
document.head.insertAdjacentHTML('beforeend', additionalStyles);

async function validateXMLFile(fileName, type, company, date, version) {
  //console.log('Starting validation with params:', { fileName, type, company, date, version });
  
  if (!fileName || !type || !company || !date || !version) {
      console.error('Missing required parameters:', { fileName, type, company, date, version });
      throw new ValidationError('Missing required parameters for validation', [], fileName);
  }


  // Validate file extension
  if (!fileName.toLowerCase().endsWith('.xml')) {
      throw new ValidationError('Invalid file type', [{
          code: 'INVALID_FILE_TYPE',
          message: 'File must be an XML document',
          target: 'file',
          propertyPath: null,
          validatorType: 'System'
      }], fileName);
  }

  // Format date consistently
  const formattedDate = moment(date).format('YYYY-MM-DD');

  // Get file content
  try {
      //console.log('Fetching file content for:', fileName);
      const encodedFileName = encodeURIComponent(fileName);
      const queryParams = new URLSearchParams({
          type: type,
          company: company,
          date: formattedDate,
          version: version
      });

      const response = await fetch(`/api/xml/content/${encodedFileName}?${queryParams}`, {
          method: 'GET',
          headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
          }
      });

      if (!response.ok) {
          console.error('Response not OK:', response.status, response.statusText);
          let errorDetails;
          try {
              errorDetails = await response.json();
          } catch (e) {
              errorDetails = { error: await response.text() };
          }

          if (response.status === 404) {
              throw new ValidationError(`File not found: ${fileName}`, [{
                  code: 'FILE_NOT_FOUND',
                  message: errorDetails.details || 'The XML file could not be found in any of the expected locations',
                  target: 'file',
                  propertyPath: null,
                  validatorType: 'System'
              }], fileName);
          }

          throw new ValidationError('Failed to fetch file content', [{
              code: errorDetails.error?.code || 'FILE_READ_ERROR',
              message: errorDetails.error?.message || errorDetails.details || 'Could not read the XML file content',
              target: 'file',
              propertyPath: null,
              validatorType: 'System'
          }], fileName);
      }
      
      const fileData = await response.json();
      //console.log('Received file data:', { success: fileData.success, hasContent: !!fileData.content, filePath: fileData.filePath });

      if (!fileData || !fileData.content) {
          console.error('Invalid file content received:', fileData);
          throw new ValidationError('Invalid file content', [{
              code: 'INVALID_CONTENT',
              message: fileData.error?.message || 'The file content is not in the expected format',
              target: 'content',
              propertyPath: null,
              validatorType: 'Format'
          }], fileName);
      }

      // Basic XML validation
      try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(fileData.content, 'text/xml');
          
          // Check for parsing errors
          const parserError = xmlDoc.querySelector('parsererror');
          if (parserError) {
              throw new Error('XML parsing failed: ' + parserError.textContent);
          }

          // Add the validated content to the response
          fileData.parsedContent = xmlDoc;
      } catch (xmlError) {
          throw new ValidationError('XML validation failed', [{
              code: 'INVALID_XML',
              message: xmlError.message || 'The file contains invalid XML',
              target: 'content',
              propertyPath: null,
              validatorType: 'Format'
          }], fileName);
      }

      // Return validated data
      return {
          ...fileData,
          type,
          company,
          date: formattedDate,
          version
      };
  } catch (error) {
      // If it's already a ValidationError, just pass it through
      if (error instanceof ValidationError) {
          throw error;
      }
      // For other types of errors, wrap them in a ValidationError
      throw new ValidationError(error.message || 'Validation failed', [{
          code: 'VALIDATION_ERROR',
          message: error.message || 'An unexpected error occurred during validation',
          target: 'system',
          propertyPath: null,
          validatorType: 'System'
      }], fileName);
  }
}

// Custom Error Classes
class ValidationError extends Error {
  constructor(message, validationErrors = [], fileName = null) {
      super(message);
      this.name = 'ValidationError';
      this.validationErrors = validationErrors;
      this.fileName = fileName;
  }
}

  async function showVersionDialog() {
    return Swal.fire({
        html: `
            <div class="semi-minimal-dialog">
                <style>
                    .semi-minimal-dialog {
                        --primary: hsl(220 76% 55%);
                        --primary-light: hsl(220 76% 97%);
                        --text-main: hsl(220 39% 11%);
                        --text-muted: hsl(215 16% 47%);
                        font-family: system-ui, -apple-system, sans-serif;
                    }
                    
                    .dialog-heading {
                        text-align: center;
                        margin-bottom: 1.5rem;
                    }
                    
                    .dialog-title {
                        font-size: 1.125rem;
                        font-weight: 600;
                        color: var(--text-main);
                        margin-bottom: 0.25rem;
                    }
                    
                    .dialog-subtitle {
                        font-size: 0.875rem;
                        color: var(--text-muted);
                        line-height: 1.4;
                    }
                    
                    .version-card {
                        padding: 1rem;
                        border-radius: 8px;
                        border: 1px solid hsl(214 32% 91%);
                        margin-bottom: 0.75rem;
                        transition: all 0.2s ease;
                        cursor: pointer;
                        position: relative;
                        background: white;
                    }
                    
                    .version-card:hover:not(.disabled) {
                        transform: translateY(-2px);
                        box-shadow: 0 3px 6px rgba(0,0,0,0.05);
                    }
                    
                    .version-card.selected {
                        border-color: var(--primary);
                        background: var(--primary-light);
                    }
                    
                    .version-card.disabled {
                        background: hsl(220 33% 98%);
                        cursor: not-allowed;
                    }
                    
                    .version-header {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        margin-bottom: 0.5rem;
                    }
                    
                    .version-badge {
                        width: 24px;
                        height: 24px;
                        border-radius: 6px;
                        background: var(--primary-light);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: var(--primary);
                        font-size: 0.75rem;
                        font-weight: 600;
                    }
                    
                    .version-title {
                        font-size: 0.9375rem;
                        font-weight: 500;
                        color: var(--text-main);
                    }
                    
                    .version-desc {
                        font-size: 0.8125rem;
                        color: var(--text-muted);
                        line-height: 1.4;
                        margin-left: 0.5rem;
                    }
                    
                    .status-indicator {
                        position: absolute;
                        top: 12px;
                        right: 12px;
                        font-size: 0.75rem;
                        padding: 2px 8px;
                        border-radius: 4px;
                    }
                    
                    .status-available {
                        background: hsl(142 71% 95%);
                        color: hsl(142 76% 24%);
                    }
                    
                    .status-coming {
                        background: hsl(33 100% 96%);
                        color: hsl(27 90% 45%);
                    }
                </style>
  
                <div class="dialog-heading">
                    <h3 class="dialog-title">Select Document Version</h3>
                    <p class="dialog-subtitle">Choose your preferred format for submission</p>
                </div>
  
                <div class="version-card selected">
                    <div class="version-header">
                        <span class="version-badge">1.0</span>
                        <span class="version-title">Standard Version</span>
                    </div>
                    <p class="version-desc">
                        This is the standard e-invoice version designed for submitting invoices to LHDN without the need for a digital signature.
                    </p>
                    <span class="status-indicator status-available">Available Now</span>
                </div>
  
                <div class="version-card disabled">
                    <div class="version-header">
                        <span class="version-badge">1.1</span>
                        <span class="version-title">Secure Version</span>
                    </div>
                     <p class="version-desc">
                        Enhanced encrypted format with digital signature capabilities, 
                        tailored for LHDN's advanced security requirements.
                    </p>
                    <span class="status-indicator status-coming">Coming Soon</span>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Continue',
        cancelButtonText: 'Cancel',
        width: 480,
        padding: '1.5rem',
        focusConfirm: false,
        customClass: {
            confirmButton: 'outbound-action-btn submit',
            cancelButton: 'outbound-action-btn cancel',
            popup: 'semi-minimal-popup'
        },
        didOpen: () => {
            document.querySelectorAll('.version-card:not(.disabled)').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelector('.version-card.selected')?.classList.remove('selected');
                    card.classList.add('selected');
                });
            });
        }
    }).then((result) => {
        if (result.isConfirmed) {
            return '1.0';
        }
        return null;
    });
  }
  // Base template for semi-minimal dialog
  function createSemiMinimalDialog(options) {
    const {
        title,
        subtitle,
        content,
        showCancelButton = true,
        confirmButtonText = 'Continue',
        cancelButtonText = 'Cancel',
        width = 480,
        padding = '1.5rem',
        customClass = {},
        didOpen = () => {}
    } = options;
  
    return `
        <div class="semi-minimal-dialog">
            <style>
                .semi-minimal-dialog {
                    --primary: hsl(220 76% 55%);
                    --primary-light: hsl(220 76% 97%);
                    --text-main: hsl(220 39% 11%);
                    --text-muted: hsl(215 16% 47%);
                    --error: hsl(0 84% 60%);
                    --error-light: hsl(0 84% 97%);
                    --success: hsl(142 76% 36%);
                    --success-light: hsl(142 76% 97%);
                    --warning: hsl(37 90% 51%);
                    --warning-light: hsl(37 90% 97%);
                    --info: hsl(200 76% 55%);
                    --info-light: hsl(200 76% 97%);
                    font-family: system-ui, -apple-system, sans-serif;
                }
                
                .dialog-heading {
                    text-align: center;
                    margin-bottom: 1.5rem;
                }
                
                .dialog-title {
                    font-size: 1.125rem;
                    font-weight: 600;
                    color: var(--text-main);
                    margin-bottom: 0.25rem;
                }
                
                .dialog-subtitle {
                    font-size: 0.875rem;
                    color: var(--text-muted);
                    line-height: 1.4;
                }
                
                .content-card {
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid hsl(214 32% 91%);
                    margin-bottom: 0.75rem;
                    background: white;
                }
                
                .content-card:hover:not(.disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 3px 6px rgba(0,0,0,0.05);
                }
                
                .content-card.selected {
                    border-color: var(--primary);
                    background: var(--primary-light);
                }
                
                .content-card.disabled {
                    background: hsl(220 33% 98%);
                    cursor: not-allowed;
                }
                
  .content-header {
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    width: 100% !important;
    margin-bottom: 0.5rem !important;
    text-align: center !important;
  }
  
  .content-title {
    font-size: 0.9375rem !important;
    font-weight: 500 !important;
    color: var(--text-main) !important;
    text-align: center !important;
    width: 100% !important;
  }
                
                .content-badge {
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    background: var(--primary-light);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--primary);
                    font-size: 0.75rem;
                    font-weight: 600;
                }
                
                .content-badge.error {
                    background: var(--error-light);
                    color: var(--error);
                }
                
                .content-badge.success {
                    background: var(--success-light);
                    color: var(--success);
                }
                
                .content-badge.warning {
                    background: var(--warning-light);
                    color: var(--warning);
                }
                
                .content-badge.info {
                    background: var(--info-light);
                    color: var(--info);
                }
                
                
                .content-desc {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                    line-height: 1.4;
                    margin-left: 0.5rem;
                }
                
                .status-indicator {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    font-size: 0.75rem;
                    padding: 2px 8px;
                    border-radius: 4px;
                }
                
                .field-row {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 0.5rem;
                }
                
                .field-label {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                    min-width: 100px;
                }
                
                .field-value {
                    font-size: 0.875rem;
                    color: var(--text-main);
                    font-weight: 500;
                }
                
                  .loading-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
  
                .loading-step {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 1rem;
                    background: white;
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                    margin-bottom: 0.5rem;
                }
  
                .step-indicator {
                    width: 20px;
                    height: 20px;
                    position: relative;
                    flex-shrink: 0;
                }
  
                .step-indicator::before {
                    content: '';
                    position: absolute;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: #e9ecef;
                }
  
                .step-indicator.processing::before {
                    background: var(--primary);
                }
  
                .step-indicator.completed::before {
                    background: var(--success);
                }
  
                .step-indicator.error::before {
                    background: var(--error);
                }
  
                .step-content {
                    flex: 1;
                    min-width: 0;
                }
  
                .step-title {
                    font-size: 0.9375rem;
                    font-weight: 500;
                    color: var(--text-main);
                    margin-bottom: 0.25rem;
                }
  
                .step-message {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                }
  
                /* Loading animation */
                .loading-spinner {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 20px;
                    height: 20px;
                    border: 2px solid transparent;
                    border-top-color: var(--primary);
                    border-right-color: var(--primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
  
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
  
                /* Status-specific styles */
                .loading-step.processing {
                    border-color: var(--primary);
                    background: var(--primary-light);
                }
  
                .loading-step.completed {
                    border-color: var(--success);
                    background: var(--success-light);
                }
  
                .loading-step.error {
                    border-color: var(--error);
                    background: var(--error-light);
                }
  
                .loading-step.processing .step-message {
                    color: var(--primary);
                }
  
                .loading-step.completed .step-message {
                    color: var(--success);
                }
  
                .loading-step.error .step-message {
                    color: var(--error);
                }
            </style>
  
            <div class="dialog-heading">
                <h3 class="dialog-title">${title}</h3>
                ${subtitle ? `<p class="dialog-subtitle">${subtitle}</p>` : ''}
            </div>
  
            ${content}
        </div>
    `;
  }
  
  // Update showConfirmationDialog to use the new template
  async function showConfirmationDialog(fileName, source, company, date, version) {
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge">
                    <i class="fas fa-file-invoice"></i>
                </span>
                <span class="content-title">Document Details</span>
            </div>
            <div class="field-row">
                <span class="field-label">File Name:</span>
                <span class="field-value">${fileName}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Source:</span>
                <span class="field-value">
                    <span class="badge-source ${source.toLowerCase()}">${source}</span>
                </span>
            </div>
            <div class="field-row">
                <span class="field-label">Company:</span>
                <span class="field-value">${company}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Generated Date:</span>
                <span class="field-value">${new Date(date).toLocaleString(
                    'en-US',
                    {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                    }
                )}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Version:</span>
                <span class="field-value">${version}</span>
            </div>
        </div>
    `;
  
    return Swal.fire({
        html: createSemiMinimalDialog({
            title: 'Confirm Submission',
            subtitle: 'Please review the document details before submitting to LHDN',
            content: content,
            confirmButtonText: 'Yes, Submit',
            cancelButtonText: 'Cancel',
            width: 480,
            padding: '1.5rem',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel',
                popup: 'semi-minimal-popup'
            }
        }),
        showCancelButton: true,
        confirmButtonText: 'Yes, Submit',
        cancelButtonText: 'Cancel',
        width: 480,
        padding: '1.5rem',
        focusConfirm: false,
        customClass: {
            confirmButton: 'outbound-action-btn submit',
            cancelButton: 'outbound-action-btn cancel',
            popup: 'semi-minimal-popup'
        }
    }).then((result) => result.isConfirmed);
  }
  
  
  
  async function showSubmissionStatus(fileName, type, company, date, version) {
    //console.log('🚀 Starting submission status process:', { fileName, type, company, date, version });
    window.currentFileName = fileName;
  
    let modal = null;
    try {
        // Create steps HTML
        //console.log('📋 Creating steps container');
      // Update your showSubmissionStatus function's style section
      const stepsHtml = `
      <style>
          .step-card {
              transform: translateY(10px);
              opacity: 0.6;
              transition: all 0.3s ease;
              margin-bottom: 1rem;
              padding: 1rem;
              border-radius: 8px;
              border: 1px solid #e9ecef;
              display: flex;
              align-items: center;
              justify-content: center;
              text-align: center;
              flex-direction: column;
          }
          
          .step-card.processing {
              transform: translateY(0);
              opacity: 1;
              border-color: var(--primary);
              background: var(--primary-light);
          }
          
          .step-card.completed {
              opacity: 1;
              border-color: var(--success);
              background: var(--success-light);
          }
          
          .step-card.error {
              opacity: 1;
              border-color: var(--error);
              background: var(--error-light);
          }
          
          .step-badge {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-bottom: 0.5rem;
          }
          
          .step-card.processing .step-badge {
              background: var(--primary-light);
              color: var(--primary);
          }
          
          .step-card.completed .step-badge {
              background: var(--success-light);
              color: var(--success);
          }
          
          .step-card.error .step-badge {
              background: var(--error-light);
              color: var(--error);
          }
          
          .step-badge.spinning::after {
              content: '';
              width: 20px;
              height: 20px;
              border: 2px solid var(--primary);
              border-right-color: transparent;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              display: block;
          }
          
          @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
          }
          
          .step-content {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 0.25rem;
          }
          
          .step-title {
              font-weight: 500;
              font-size: 1rem;
              color: var(--text-main);
          }
          
          .step-status {
              font-size: 0.875rem;
              color: var(--text-muted);
          }
      </style>
      <div class="steps-container">
          ${getStepHtml(1, 'Validating Document in XML Format')}
          ${getStepHtml(2, 'Submit to LHDN')}
          ${getStepHtml(3, 'Processing')}
      </div>
  `;
        // Create and show modal
        ////console.log('📦 Creating submission modal');
        modal = await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Submitting Document to LHDN',
                subtitle: 'Please wait while we process your request',
                content: stepsHtml
            }),
            showConfirmButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: 480,
            padding: '1.5rem',
            customClass: {
                popup: 'semi-minimal-popup'
            },
            didOpen: async () => {
                try {
                    // Verify steps were created
                    //console.log('🔍 Verifying step elements:');
                    for (let i = 1; i <= 3; i++) {
                        const step = document.getElementById(`step${i}`);
                        if (step) {
                            //console.log(`✅ Step ${i} element found`);
                        } else {
                            console.error(`❌ Step ${i} element not found`);
                        }
                    }
  
                    // Step 1: Internal Validation
                    //console.log('🔍 Starting Step 1: Document Validation');
                    await updateStepStatus(1, 'processing', 'Validating document...');
                    const validatedData = await performStep1(fileName, type, company, date, version);
                    
                    if (!validatedData) {
                        throw new ValidationError('No data available for validation', [], fileName);
                    }
                    await updateStepStatus(1, 'completed', 'Validation completed');
  
                    // Step 2: Submit to LHDN
                    //console.log('📤 Starting Step 2: LHDN Submission');
                    await updateStepStatus(2, 'processing', 'Submitting to LHDN...');
                    
                    // Add the original parameters to the validated data
                    const submissionData = {
                        ...validatedData,
                        fileName,
                        type,
                        company,
                        date,
                        version
                    };
                    
                    const submitted = await performStep2(submissionData, version);
                    
                    if (!submitted) {
                        throw new Error('LHDN submission failed');
                    }
                    await updateStepStatus(2, 'completed', 'Submission completed');
  
                    // Step 3: Process Response
                    //console.log('⚙️ Starting Step 3: Processing');
                    await updateStepStatus(3, 'processing', 'Processing response...');
                    const processed = await performStep3(submitted);
                    
                    if (!processed) {
                        throw new Error('Response processing failed');
                    }
                    await updateStepStatus(3, 'completed', 'Processing completed');
  
                    //console.log('🎉 All steps completed successfully');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    if (modal) {
                        Swal.close();
                    }
                    
                    await showSuccessMessage(fileName, version);
                    // Refresh the table
                    window.location.reload();
                } catch (error) {
                    console.error('❌ Step execution failed:', error);
                    
                    // Find the current processing step and update its status to error
                    const currentStep = document.querySelector('.step-card.processing');
                    if (currentStep) {
                        const stepNumber = parseInt(currentStep.id.replace('step', ''));
                        //console.log(`⚠️ Updating step ${stepNumber} to error state`);
                        await updateStepStatus(stepNumber, 'error', 'Error occurred');
                    }
  
                    // Add delay for visual feedback
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Close the current modal
                    if (modal) {
                        modal.close();
                    }
  
                    // Show appropriate error modal based on error type
                    if (error instanceof ValidationError) {
                        //console.log('📋 Showing XML validation error modal');
                        await showXMLValidationError(error);
                    } else {
                        //console.log('🔴 Showing LHDN error modal');
                        await showLHDNErrorModal(error);
                    }

                    throw error; // Re-throw to be caught by outer catch
                }
            }
        });
  
        return true;
  
    } catch (error) {
        console.error('❌ Submission process failed:', error);
        
        // Show appropriate error modal based on error type
        if (error instanceof ValidationError) {
            //console.log('📋 Showing XML validation error modal');
            await showXMLValidationError(error);
        } else {
            //console.log('🔴 Showing LHDN error modal');
            await showLHDNErrorModal(error);
        }
        return false;
    }
  } 
  async function showSuccessMessage(fileName, version) {
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge success" style="margin-bottom: 10px;">
                    <i class="fas fa-check-circle"></i>
                </span>
                <span class="content-title">Submission Details</span>
            </div>
            <div class="field-row">
                <span class="field-label">File Name:</span>
                <span class="field-value">${fileName}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Version:</span>
                <span class="field-value">${version}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Submitted At:</span>
                <span class="field-value">${new Date().toLocaleString()}</span>
            </div>
        </div>
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge info">
                    <i class="fas fa-info-circle"></i>
                </span>
                <span class="content-title">Next Steps</span>
            </div>
            <div class="content-desc">
                You can track the status of your submission in the table below. The document will be processed by LHDN within 72 hours.
            </div>
        </div>
    `;
  
    return Swal.fire({
        html: createSemiMinimalDialog({
            title: 'Document Submitted Successfully',
            subtitle: 'Your document has been successfully submitted to LHDN',
            content: content
        }),
        confirmButtonText: 'Close',
        width: 480,
        padding: '1.5rem',
        customClass: {
            confirmButton: 'semi-minimal-confirm',
            popup: 'semi-minimal-popup'
        }
    });
  }
  
  // Main submission function
  async function submitToLHDN(fileName, source, company, date) {
    // Format the date consistently at the start
    const formattedDate = moment(date).format('YYYY-MM-DD');
    
    //console.log('=== Starting LHDN Submission Process ===');
   
    try {
        // 1. Show version selection dialog
        ////console.log('Step 1: Showing version selection dialog');
        const version = await showVersionDialog();
        ////console.log('Selected version:', version);
        
        if (!version) {
            //console.log('Version selection cancelled by user');
            return;
        }
        
        // 2. Show confirmation dialog
        //console.log('Step 2: Showing confirmation dialog');
      
        const confirmed = await showConfirmationDialog(fileName, source, company, formattedDate, version);
        console.log('User confirmation:', confirmed);
        
        if (!confirmed) {
            console.log('Submission cancelled by user');
            return;
        }
        
        // 3. Show submission status modal and start process
    
        
        // Pass the formatted date instead of the original date
        await showSubmissionStatus(fileName, source, company, formattedDate, version);
        
    } catch (error) {
        console.error('Submission error:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            params: {
                fileName,
                source,
                company,
                originalDate: date,
                formattedDate
            }
        });
        
        showSystemErrorModal({
            title: 'Submission Error',
            message: error.message || 'An error occurred during submission.',
            code: 'SUBMISSION_ERROR'
        });
    }
  }
  
  // Update the getStepHtml function to use the new styles
  // Function to get step HTML
  function getStepHtml(stepNumber, title) {
    ////console.log(`🔨 [Step ${stepNumber}] Creating HTML for step: ${title}`);
    
    const stepId = `step${stepNumber}`;
    ////console.log(`🏷️ [Step ${stepNumber}] Step ID created: ${stepId}`);
    
    return `
        <style>
            .step-badge.spinning::after {
                content: '';
                width: 12px;
                height: 12px;
                border: 2px solid var(--primary);
                border-right-color: transparent;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                display: block;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        </style>
        <div class="content-card step-card" id="${stepId}">
            <div class="content-header">
                <span class="content-badge step-badge">
                    <i class="fas fa-circle"></i>
                </span>
                <span class="">${title}</span>
            </div>
            <div class="content-desc step-status">Waiting...</div>
        </div>
    `;
  }
  
  // Helper function to update step status with animation
  async function updateStepStatus(stepNumber, status, message) {
    //console.log(`🔄 [Step ${stepNumber}] Updating status:`, { status, message });
  
    const step = document.getElementById(`step${stepNumber}`);
    if (!step) {
        console.error(`❌ [Step ${stepNumber}] Step element not found`);
        return;
    }
  
    // Remove all status classes first
    step.classList.remove('processing', 'completed', 'error');
    //console.log(`🎨 [Step ${stepNumber}] Removed old classes`);
  
    // Add the new status class
    step.classList.add(status);
    //console.log(`🎨 [Step ${stepNumber}] Added new class:`, status);
  
    // Update status message with fade effect
    const statusEl = step.querySelector('.step-status');
    if (statusEl && message) {
        //console.log(`✍️ [Step ${stepNumber}] Updating message to:`, message);
        statusEl.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
        statusEl.textContent = message;
        statusEl.style.opacity = '1';
    }
  
    // Update spinner visibility and icon
    const badge = step.querySelector('.step-badge');
    if (badge) {
        const icon = badge.querySelector('.fas');
        if (icon) {
            switch (status) {
                case 'processing':
                    icon.style.display = 'none';
                    badge.classList.add('spinning');
                    break;
                case 'completed':
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-check';
                    break;
                case 'error':
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-times';
                    break;
                default:
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-circle';
            }
        }
    }
  
    // Add delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    //console.log(`✅ [Step ${stepNumber}] Status update completed`);
  }

  
  async function performStep2(data, version) {
    try {
        //console.log('🚀 [Step 2] Starting LHDN submission with data:', data);
        await updateStepStatus(2, 'processing', 'Connecting to LHDN...');
        await updateStepStatus(2, 'processing', 'Preparing Documents...');
        
        // Extract the required parameters from the data
        const {
            fileName,
            type,
            company,
            date
        } = data;

        // Ensure we're using the correct parameter names
        const requestData = {
            fileName,
            source: type, // Map type to source for the backend
            company,
            date,
            version
        };

        //console.log('Submitting to LHDN with parameters:', requestData);

        // Make the API call to send-lhdn endpoint
        const response = await fetch('/api/xml/send-lhdn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('❌ [Step 2] API error response:', result);
            throw new Error(JSON.stringify(result.error));
        }

        //console.log('✅ [Step 2] Submission successful:', result);
        await updateStepStatus(2, 'completed', 'Submission completed');
        return result;

    } catch (error) {
        console.error('❌ [Step 2] LHDN submission failed:', error);
        await updateStepStatus(2, 'error', 'Submission failed');
        throw error;
    }
  }
  
  function showLHDNErrorModal(error) {
    //console.log('LHDN Error:', error);
    
    // Parse error message if it's a string
    let errorDetails = error;
    try {
        if (typeof error === 'string') {
            errorDetails = JSON.parse(error);
        }
    } catch (e) {
        console.warn('Error parsing error message:', e);
    }
  
    // Extract error message and details
    const errorMessage = errorDetails.message || errorDetails.error?.message || 'An unknown error occurred';
    const errorCode = errorDetails.code || errorDetails.error?.code || 'ERROR';
    const details = errorDetails.details || errorDetails.error?.details || [];
  
    Swal.fire({
        title: 'LHDN Submission Error',
        html: `
            <div class="content-card swal2-content" style="animation: slideIn 0.3s ease-out;">
                <div style="margin-bottom: 15px; text-align: center;">
                    <div class="error-icon" style="color: #dc3545; font-size: 28px; margin-bottom: 10%; animation: pulseError 1.5s infinite;">
                        <i class="fas fa-times-circle"></i>
                    </div>
                    <div style="background: #fff5f5; border-left: 4px solid #dc3545; padding: 8px; margin: 8px 0; border-radius: 4px; text-align: left;">
                        <i class="fas fa-exclamation-circle" style="color: #dc3545; margin-right: 5px;"></i>
                        An error occurred during submission
                    </div>
                </div>
    
                <div style="text-align: left; padding: 12px; border-radius: 8px; background: rgba(220, 53, 69, 0.05);">
                    <div style="margin-bottom: 8px;">
                        <span style="color: #595959; font-weight: 600;">Error Code:</span>
                        <span style="color: #dc3545; font-family: monospace; background: rgba(220, 53, 69, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: 4px;">${errorCode}</span>
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <span style="color: #595959; font-weight: 600;">Message:</span>
                        <div style="color: #595959; background: #fff; padding: 8px; border-radius: 4px; margin-top: 4px; border: 1px solid rgba(220, 53, 69, 0.2);">
                            ${errorMessage}
                        </div>
                    </div>
    
                    ${details.length > 0 ? `
                        <div>
                            <span style="color: #595959; font-weight: 600;">Details:</span>
                            <div style="margin-top: 4px; max-height: 150px; overflow-y: auto;">
                                ${details.map(detail => `
                                    <div style="background: #fff; padding: 8px; border-radius: 4px; margin-bottom: 4px; border: 1px solid rgba(220, 53, 69, 0.2); font-size: 0.9em;">
                                        ${detail.description || detail.message || detail}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
    
            <style>
                @keyframes pulseError {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.15); }
                    100% { transform: scale(1); }
                }
    
                @keyframes slideIn {
                    from { transform: translateY(-10px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
    
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
    
                .error-icon {
                    animation: pulseError 1.5s infinite;
                }
            </style>
        `,
        customClass: {
            confirmButton: 'outbound-action-btn submit',
            popup: 'semi-minimal-popup'
        },
        confirmButtonText: 'OK',
        showCloseButton: true
    });
  } 
  // Helper function to get next steps based on error code
  function getNextSteps(errorCode) {
    const commonSteps = `
        <li>Review each validation error carefully</li>
        <li>Update the required fields in your document</li>
        <li>Ensure all mandatory information is provided</li>
        <li>Try submitting the document again</li>
    `;
  
    const specificSteps = {
        'DS302': `
            <li>Check the document status in LHDN portal</li>
            <li>If you need to submit a correction, use the amendment feature</li>
            <li>Contact support if you need assistance with amendments</li>
        `,
        'DUPLICATE_SUBMISSION': `
            <li>Check the document status in the system</li>
            <li>Wait for the current submission to complete</li>
            <li>Contact support if you need to resubmit</li>
        `,
        'CF321': `
            <li>Check the document's issue date</li>
            <li>Documents must be submitted within 7 days of issuance</li>
            <li>Create a new document with current date if needed</li>
        `,
        'CF364': `
            <li>Review the item classification codes</li>
            <li>Ensure all items have valid classification codes</li>
            <li>Update missing or invalid classifications</li>
        `,
        'AUTH001': `
            <li>Try logging out and logging back in</li>
            <li>Check your internet connection</li>
            <li>Contact support if the issue persists</li>
        `
    };
  
    return specificSteps[errorCode] || commonSteps;
  }
  
  // Helper function to format field path for display
  function formatFieldPath(path) {
    if (!path) return 'General';
    
    const fieldMap = {
        'Invoice.ID': 'Invoice Number',
        'Invoice.IssueDate': 'Issue Date',
        'Invoice.InvoiceTypeCode': 'Invoice Type',
        'Invoice.BillingReference': 'Billing Reference',
        'Invoice.AdditionalDocumentReference': 'Additional Document Reference',
        'Invoice.AccountingSupplierParty': 'Supplier Information',
        'Invoice.AccountingCustomerParty': 'Customer Information',
        'Invoice.TaxTotal': 'Tax Information',
        'Invoice.LegalMonetaryTotal': 'Total Amounts',
        'Invoice.InvoiceLine': 'Invoice Line Items',
        'Invoice.InvoiceLine.Item.Classification': 'Item Classification',
        'Invoice.InvoiceLine.TaxTotal': 'Line Tax Information',
        'Invoice.InvoiceLine.Price': 'Item Price',
        'DatetimeIssued': 'Issue Date and Time'
    };
  
    // Try to match the path with the map
    for (const [key, value] of Object.entries(fieldMap)) {
        if (path.includes(key)) {
            return value;
        }
    }
  
    // If no match found, format the path
    return path
        .split('.')
        .pop()
        .replace(/([A-Z])/g, ' $1')
        .trim();
  }
  
  async function cancelDocument(uuid, fileName, submissionDate) {
    console.log('Cancelling document:', { uuid, fileName, submissionDate });
    
    try {
        // Show cancellation reason dialog
        const { value: reason } = await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Cancel Document',
                subtitle: 'Please provide a reason for cancellation',
                content: `
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-badge warning">
                                <i class="fas fa-exclamation-triangle"></i>
                            </span>
                            <span class="content-title">Document Details</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">File Name:</span>
                            <span class="field-value">${fileName}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">UUID:</span>
                            <span class="field-value">${uuid}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Submitted:</span>
                            <span class="field-value">${new Date(submissionDate).toLocaleString()}</span>
                        </div>
                        <div class="field-row mt-3">
                            <div class="alert alert-warning" role="alert">
                                <i class="fas fa-exclamation-triangle me-2"></i>
                                This action will cancel the document in LHDN system and cannot be undone.
                            </div>
                        </div>
                    </div>
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-title">Cancellation Reason</span>
                        </div>
                        <textarea id="cancellationReason" class="form-control" rows="3" 
                            placeholder="Please provide a reason for cancellation..."
                            style="margin-top: 10px; resize: none;"></textarea>
                    </div>
                `
            }),
            showCancelButton: true,
            confirmButtonText: 'Yes, Cancel Document',
            cancelButtonText: 'No, Keep Document',
            width: 480,
            padding: '1.5rem',
            preConfirm: () => {
                const reason = document.getElementById('cancellationReason').value;
                if (!reason || reason.trim().length < 5) {
                    Swal.showValidationMessage('Please provide a valid reason (minimum 5 characters)');
                    return false;
                }
                return reason;
            },
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel',
                popup: 'semi-minimal-popup'
            }
        });

        if (!reason) {
            console.log('Cancellation cancelled by user');
            return;
        }

        // Show loading state
        Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Cancelling Document',
                subtitle: 'Please wait while we process your request',
                content: `
                    <div class="loading-steps">
                        <div class="loading-step processing">
                            <div class="step-indicator">
                                <div class="loading-spinner"></div>
                            </div>
                            <div class="step-content">
                                <div class="step-title">Processing</div>
                                <div class="step-message">Cancelling document in LHDN system...</div>
                            </div>
                        </div>
                    </div>
                `
            }),
            showConfirmButton: false,
            allowOutsideClick: false,
            width: 480,
            padding: '1.5rem'
        });

        // Make API request
        const response = await fetch(`/api/xml/cancel/${uuid}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                reason: reason.trim(),
                fileName,
                submissionDate
            })
        });

        const result = await response.json();

        if (!response.ok) {
            let errorMessage = result.error?.message || 'Failed to cancel document';
            
            // Handle specific error cases
            if (response.status === 429) {
                errorMessage = 'Rate limit exceeded. Please try again in a few moments.';
            } else if (response.status === 404) {
                errorMessage = 'Document not found or already cancelled.';
            } else if (response.status === 400) {
                errorMessage = result.error?.message || 'Invalid request. Please check your input.';
                if (result.error?.details) {
                    errorMessage += `\n${result.error.details}`;
                }
            } else if (response.status === 401) {
                errorMessage = 'Your session has expired. Please log in again.';
            }
            throw new Error(errorMessage);
        }

        // Check if the cancellation was successful
        if (!result.success) {
            throw new Error(result.error?.message || 'Failed to cancel document in LHDN');
        }

        // Show success message
        await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Document Cancelled Successfully',
                subtitle: 'The document has been cancelled in LHDN system',
                content: `
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-badge success">
                                <i class="fas fa-check-circle"></i>
                            </span>
                            <span class="content-title">Cancellation Details</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">File Name:</span>
                            <span class="field-value">${fileName}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">UUID:</span>
                            <span class="field-value">${uuid}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Cancelled At:</span>
                            <span class="field-value">${new Date().toLocaleString()}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Status:</span>
                            <span class="field-value text-success">
                                <i class="fas fa-check-circle me-1"></i>
                                Cancelled in LHDN
                            </span>
                        </div>
                        ${result.details?.lhdnResponse ? `
                        <div class="field-row mt-3">
                            <div class="alert alert-info" role="alert">
                                <i class="fas fa-info-circle me-2"></i>
                                LHDN Reference: ${result.details.lhdnResponse.reference || 'N/A'}
                                <br>
                                <a href="/inbound" class="alert-link mt-2 d-inline-block">
                                    <i class="fas fa-external-link-alt me-1"></i>
                                    View in Inbound
                                </a>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `
            }),
            icon: 'success',
            confirmButtonText: 'OK',
            width: 480,
            padding: '1.5rem',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                popup: 'semi-minimal-popup'
            }
        });

        // Refresh the table
        window.location.reload();

    } catch (error) {
        console.error('Error cancelling document:', error);
        
        // Show error message
        await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Cancellation Failed',
                subtitle: 'An error occurred while cancelling the document',
                content: `
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-badge error">
                                <i class="fas fa-exclamation-circle"></i>
                            </span>
                            <span class="content-title">Error Details</span>
                        </div>
                        <div class="content-desc">
                            ${error.message + '\nPlease check the LHDN Inbound Result for more details. For invalid submission status, refer to the Inbound Result page.' || 'An unexpected error occurred'}
                        </div>
                        <div class="mt-3">
                            <div class="alert alert-info" role="alert">
                                <i class="fas fa-info-circle me-2"></i>
                                If this error persists, please contact support and provide the following details:
                                <br>
                                UUID: ${uuid}
                                <br>
                                File Name: ${fileName}
                            </div>
                        </div>
                        <a href="/inbound" class="outbound-action-btn submit mt-2 d-inline-flex align-items-center gap-2">
                            <i class="fas fa-external-link-alt"></i>
                            <span>View in Inbound</span>
                            <i class="fas fa-chevron-right ms-1"></i>
                        </a>
                    </div>
                `
            }),
            icon: 'error',
            confirmButtonText: 'OK',
            width: 480,
            padding: '1.5rem',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                popup: 'semi-minimal-popup'
            }
        });
    }
}
  
  // Show System Error Modal
  
  async function showXMLValidationError(error) {
    //console.log('Showing validation error for file:', error.fileName, 'Error:', error);
  
    await new Promise(resolve => setTimeout(resolve, 500));
  
    // Format validation errors for display
    let errorContent = '';
    if (error.validationErrors && error.validationErrors.length > 0) {
        const groupedErrors = error.validationErrors.reduce((acc, err) => {
            const errors = Array.isArray(err.errors) ? err.errors : [err.errors];
            acc[err.row] = acc[err.row] || [];
            acc[err.row].push(...errors);
            return acc;
        }, {});
  
        errorContent = Object.entries(groupedErrors).map(([row, errors]) => `
            <div class="content-card">
                <div class="content-header">
                    <span class="content-badge error">
                        <i class="fas fa-exclamation-circle"></i>
                    </span>
                    <span class="content-title" style="text-align: center;">${row}</span>
                </div>
                ${errors.map(e => `
                    <div class="content-desc">
                        ${typeof e === 'object' ? e.message : e}
                    </div>
                `).join('')}
            </div>
        `).join('');
    } else {
        errorContent = `
            <div class="content-card">
                <div class="content-header">
                    <span class="content-badge error">
                        <i class="fas fa-exclamation-circle"></i>
                    </span>
                    <span class="content-title" style="text-align: center;">Validation Error</span>
                </div>
                <div class="content-desc">
                    ${error.message || 'Unknown validation error'}
                </div>
            </div>
        `;
    }
  
    // Add user guidance
    const guidance = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-title" style="text-align: center;">Next Steps</span>
            </div>
            <div class="content-desc">
                <ul>
                    <li>Review the errors listed above carefully.</li>
                    <li>Ensure all mandatory fields are filled out correctly.</li>
                    <li>Check the format of the data (e.g., dates, numbers).</li>
                    <li>Try submitting the document again after corrections.</li>
                </ul>
            </div>
        </div>
    `;
  
    return Swal.fire({
        html: createSemiMinimalDialog({
            title: 'XML Validation Failed',
            subtitle: 'Correct the issues listed and proceed with creating a new document using the SAP Generated XML Template',
            content: errorContent + guidance
        }),

        icon: 'error',
        showCancelButton: false,
        confirmButtonText: 'I Understand',
        confirmButtonColor: '#405189',
        width: 480,
        padding: '1.5rem',
        customClass: {
            confirmButton: 'semi-minimal-confirm',
            popup: 'semi-minimal-popup'
        }
    }).then((result) => {
        if (result.isConfirmed && error.fileName) {
            //openExcelFile(error.fileName);
        }
    });
  }
  
  
  async function showSystemErrorModal(error) {
    //console.log('System Error:', error);
    
    // Function to get user-friendly error message
    function getErrorMessage(error) {
        const statusMessages = {
            '401': 'Authentication failed. Please try logging in again.',
            '403': 'You do not have permission to perform this action.',
            '404': 'The requested resource was not found.',
            '500': 'An internal server error occurred.',
            'default': 'An unexpected error occurred while processing your request.'
        };
  
        if (error.message && error.message.includes('status code')) {
            const statusCode = error.message.match(/\d+/)[0];
            return statusMessages[statusCode] || statusMessages.default;
        }
  
        return error.message || statusMessages.default;
    }
  
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge error">
                    <i class="fas fa-exclamation-circle"></i>
                </span>
                <span class="content-title">System Error</span>
            </div>
            <div class="content-desc">
                ${getErrorMessage(error)}
                ${error.invoice_number ? `
                    <div style="margin-top: 0.5rem;">
                        <i class="fas fa-file-invoice"></i>
                        Invoice Number: ${error.invoice_number}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
  
    return Swal.fire({
        html: createSemiMinimalDialog({
            title: error.type || 'System Error',
            subtitle: 'Please review the following issue:',
            content: content
        }),
        confirmButtonText: 'I Understand',
        confirmButtonColor: '#405189',
        width: 480,
        padding: '1.5rem',
        showClass: {
            popup: 'animate__animated animate__fadeIn'
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOut'
        },
        customClass: {
            confirmButton: 'semi-minimal-confirm',
            popup: 'semi-minimal-popup'
        }
    });
  }
  
  
  // Function to open Excel file
  function openExcelFile(fileName) {
    //console.log('Opening Excel file:', fileName);
    
    if (!fileName) {
        console.error('No file name provided to openExcelFile');
        Swal.fire({
            icon: 'error',
            title: 'Error Opening File',
            text: 'No file name provided',
            confirmButtonColor: '#405189'
        });
        return;
    }
  
    // Get the current row data from the DataTable
    const table = $('#invoiceTable').DataTable();
    if (!table) {
        console.error('DataTable not initialized');
        return;
    }
  
    const rows = table.rows().data();
    //console.log('Found rows:', rows.length);
    
    const rowData = rows.toArray().find(row => {
        //console.log('Comparing:', row.fileName, fileName);
        return row.fileName === fileName;
    });
    //console.log('Found row data:', rowData);
  
    if (!rowData) {
        console.error('Row data not found for file:', fileName);
        Swal.fire({
            icon: 'error',
            title: 'Error Opening File',
            text: 'File information not found in the table',
            confirmButtonColor: '#405189'
        });
        return;
    }
  
    // Log the attempt to open the file
    //console.log('Attempting to open file:', fileName, 'with data:', rowData);
  
    // Make the API call to open the file
    fetch(`/api/xml/files/${fileName}/open`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
  
        },
        body: JSON.stringify({
            type: rowData.type,
            company: rowData.company,
            date: rowData.uploadedDate // Changed from date to uploadedDate to match the table data
        })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.error?.message || 'Failed to open file');
        }
        //console.log('Excel file opened successfully');
    })
    .catch(error => {
        console.error('Error opening Excel file:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error Opening File',
            text: error.message || 'Failed to open Excel file',
            confirmButtonColor: '#405189'
        });
    });
  }
  
  class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');
        
        function update() {
            const now = new Date();
            
            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            
            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }
        
        update();
        setInterval(update, 1000);
    }
  }
  
  class InvoiceTableManager {
    static instance = null;
  
    static getInstance() {
        if (!InvoiceTableManager.instance) {
            InvoiceTableManager.instance = new InvoiceTableManager();
        }
        return InvoiceTableManager.instance;
    }
  
    constructor() {
        if (InvoiceTableManager.instance) return InvoiceTableManager.instance;
        this.initializeTable();
        InvoiceTableManager.instance = this;
    }
  
    initializeTable() {
        // Destroy existing table if it exists
        if ($.fn.DataTable.isDataTable('#invoiceTable')) {
            this.table.destroy();
            $('#invoiceTable').empty();
        }

        // Initialize DataTable with minimal styling configuration
        this.table = $('#invoiceTable').DataTable({
            processing: true,
            serverSide: false,
            ajax: {
                url: '/api/xml/files',
                method: 'GET',
                dataSrc: (json) => {
                    if (!json.success) {
                        console.error('Error:', json.error);
                        this.showEmptyState(json.error?.message || 'Failed to load data');
                        return [];
                    }
                    
                    if (!json.files || json.files.length === 0) {
                        this.showEmptyState('No XML files found');
                        return [];
                    }
                    
                    // Process the files data
                    const processedData = json.files.map(file => ({
                        ...file,
                        DT_RowId: file.fileName,
                        invoiceNumber: file.invoiceNumber || file.fileName.replace(/\.xml$/i, ''),
                        fileName: file.fileName,
                        documentType: file.documentType || 'Invoice',
                        company: file.company,
                        buyerInfo: file.buyerInfo || { registrationName: 'N/A' },
                        uploadedDate: file.uploadedDate ? new Date(file.uploadedDate).toISOString() : new Date().toISOString(),
                        issueDate: file.issueDate,
                        issueTime: file.issueTime,
                        date_submitted: file.submissionDate ? new Date(file.submissionDate).toISOString() : null,
                        status: file.status || 'Pending',
                        source: file.source,
                        uuid: file.uuid || null
                    }));

                    console.log("Current Process Data", processedData);

                    // Update card totals after data is loaded
                    setTimeout(() => this.updateCardTotals(), 0);
                    
                    return processedData;
                },
                error: (xhr, error, thrown) => {
                    console.error('Ajax error:', error);
                    let errorMessage = 'Error loading data. Please try again.';
                    
                    try {
                        const response = xhr.responseJSON;
                        if (response && response.error) {
                            errorMessage = response.error.message || errorMessage;
                        }
                    } catch (e) {
                        console.error('Error parsing error response:', e);
                    }
                    
                    this.showEmptyState(errorMessage);
                }
            },
            columns: [
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    width: '5px',
                    className: 'outbound-checkbox-column',
                    defaultContent: `<div class="outbound-checkbox-header">
                        <input type="checkbox" class="outbound-checkbox row-checkbox">
                    </div>`
                },
                {
                    data: 'invoiceNumber',
                    className: 'outbound-invoice-column',
                    title: 'INVOICE NO. / DOCUMENT',
                    render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                },
                {
                    data: 'company',
                    className: 'outbound-supplier-column',
                    title: 'SUPPLIER',
                    render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                },
                {
                    data: 'buyerInfo',
                    className: 'outbound-buyer-column',
                    title: 'BUYER',
                    render: (data, type, row) => this.renderBuyerInfo(data, type, row)
                },
                {
                    data: null,
                    className: 'outbound-date-column',
                    title: 'DATE INFO',
                    render: (data, type, row) => this.renderDateInfo(row.issueDate, row.issueTime, row.date_submitted, row)
                },
                {
                    data: 'status',
                    className: 'outbound-status-column',
                    title: 'STATUS',
                    render: (data) => this.renderStatus(data)
                },
                {
                    data: 'source',
                    className: 'outbound-source-column',
                    title: 'SOURCE',
                    render: (data) => this.renderSource(data)
                },
                {
                    data: null,
                    className: 'outbound-action-column',
                    title: 'ACTION',
                    orderable: false,
                    render: (data, type, row) => this.renderActions(row)
                }
            ],
            responsive: false,
            pageLength: 10,
            dom: '<"outbound-controls"<"outbound-length-control"l><"outbound-search-control"f>>rt<"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
            language: {
                search: '',
                searchPlaceholder: 'Search...',
                lengthMenu: 'Show _MENU_ entries',
                info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: 'Showing 0 to 0 of 0 entries',
                infoFiltered: '(filtered from _MAX_ total entries)',
                paginate: {
                    first: '<i class="bi bi-chevron-double-left"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>',
                    next: '<i class="bi bi-chevron-right"></i>',
                    last: '<i class="bi bi-chevron-double-right"></i>'
                },
                emptyTable: this.getEmptyStateHtml(),
                zeroRecords: this.getEmptyStateHtml('No matching records found')
            },
            order: [[4, 'asc']]
        });

        // Initialize features
        this.initializeFeatures();
    }
  
    // Helper method to determine document type
    getDocumentType(type) {
        const types = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note'
        };
        return types[type] || 'Invoice';
    }
  
    // Helper method to show error message
    showErrorMessage(message) {
        Swal.fire({
            title: 'Error Loading Data',
            text: message,
            icon: 'error',
            confirmButtonText: 'Retry',
            showCancelButton: true,
            cancelButtonText: 'Close',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.reload();
            }
        });
    }
  
    renderInvoiceNumber(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';
        
        // Get document type icon based on type
        const getDocTypeIcon = (docType) => {
            const icons = {
                'Invoice': 'receipt',
                'Credit Note': 'arrow-return-left',
                'Debit Note': 'arrow-return-right',
                'Refund Note': 'cash-stack'
            };
            return icons[docType] || 'file-text';
        };

        // Get document type color based on type
        const getDocTypeColor = (docType) => {
            const colors = {
                'Invoice': '#0d6efd',
                'Credit Note': '#198754',
                'Debit Note': '#dc3545',
                'Refund Note': '#6f42c1'
            };
            return colors[docType] || '#6c757d';
        };

        const docType = row.documentType || 'Invoice';
        const docTypeIcon = getDocTypeIcon(docType);
        const docTypeColor = getDocTypeColor(docType);

        return `
            <div class="invoice-info-wrapper" style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
                <div class="invoice-main" style="display: flex; align-items: left; gap: 12px;">
                      <div class="invoice-number" style="
                    display: flex;
                    align-items: left;
                    gap: 6px;
                    font-weight: 500;
                    color: #2c3345;
                    padding-left: 0;
                ">
                    <i class="bi bi-hash text-primary"></i>
                    <span class="invoice-text" title="${data}" style="
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${data}</span>
                </div>
                <div class="file-info" style="
                    display: flex;
                    align-items: left;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: #6c757d;
                    position: relative;
                    padding-left: 20px;
                ">
                    <i class="bi bi-filetype-xml" style="
                        position: absolute;
                        left: 0;
                        color: #198754;
                        font-size: 1rem;
                    "></i>
                    <span class="file-name-text" title="${row.fileName}" style="
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${row.fileName}</span>
                </div>
                    <div class="document-type" style="padding-left: 0;">
                        <span class="badge-document-type" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px 8px;
                            border-radius: 4px;
                            font-size: 0.75rem;
                            font-weight: 500;
                            background-color: ${docTypeColor}15;
                            color: ${docTypeColor};
                        ">
                            <i class="bi bi-${docTypeIcon}"></i>
                            ${docType}
                        </span>
                    </div>
                </div>
            </div>`;
    }

    renderCompanyInfo(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-building me-1"></i>
                    <span class="supplier-text">${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
    }

    renderBuyerInfo(data) {
        if (!data) {
            return '<span class="text-muted">Company Name</span>';
        }
        const buyerName = data.name || data.registrationName || data.buyerName || data.buyer?.name || data.buyer?.registrationName || 'N/A';
        return `
            <div class="cell-group">
                <div class="cell-main text-truncate">
                    <i class="bi bi-person-badge me-1"></i>
                    <span class="buyer-text" title="${buyerName}">${buyerName}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
    }

    renderDateInfo(issueDate, issueTime, submittedDate, row) {
        const issueDateFormatted = this.formatIssueDate(issueDate);
        const issueTimeFormatted = issueTime ? this.formatIssueTime(issueTime) : null;
        
        console.log("Rendering date info:", {
            issueDate,
            issueTime,
            issueDateFormatted,
            issueTimeFormatted,
            originalTime: issueTime
        });

        const submittedFormatted = submittedDate ? this.formatDate(submittedDate) : null;
        const showTimeRemaining = row.status === 'Submitted';
        const timeRemaining = showTimeRemaining ? this.calculateRemainingTime(submittedDate) : null;
    //     <div class="date-row">
    //     <i class="bi bi-calendar3 me-1"></i>    
    //     <span class="date-value">
    //         // ${issueDateFormatted}
    //         ${issueTimeFormatted ? `
    //             <span class="time-text text-muted" title="Original Issue Time: ${issueTime}">
    //                 at ${issueTimeFormatted}
    //             </span>
    //         ` : ''}
    //     </span>
    // </div>
        return `
            <div class="date-info"> 
               
                ${submittedFormatted ? `
                    <div class="date-row">
                        <i class="bi bi-check-circle me-1 text-success"></i>
                        <span class="date-value">${submittedFormatted}</span>
                    </div>
                ` : ''}
                ${showTimeRemaining && timeRemaining ? `
                    <div class="time-remaining">
                        <i class="bi bi-clock${timeRemaining.hours < 24 ? '-fill' : ''} me-1"></i>
                        <span class="time-text">${timeRemaining.hours}h ${timeRemaining.minutes}m left</span>
                    </div>
                ` : row.status !== 'Submitted' ? `
                    <div class="time-not-applicable">
                        <i class="bi bi-dash-circle me-1"></i>
                        <span>Not Applicable</span>
                    </div>
                ` : ''}
            </div>`;
    }
  
    renderTimeRemaining(date, row) {
        if (!date || row.status === 'Cancelled' || row.status === 'Failed' || row.status === 'Rejected') {
            return `<span class="badge-cancellation not-applicable bg-gray-300 text-gray-700">
                <i class="bi bi-dash-circle"></i>
                Not Applicable
            </span>`;
        }
  
        const timeInfo = this.calculateRemainingTime(date);
        if (!timeInfo) {
            return `<span class="badge-cancellation expired">
                <i class="bi bi-x-circle"></i>
                Expired
            </span>`;
        }
  
        return `<span class="badge-cancellation ${timeInfo.badgeClass}">
            <i class="bi bi-clock${timeInfo.hours < 24 ? '-fill' : ''} me-1"></i>
            ${timeInfo.hours}h ${timeInfo.minutes}m left
        </span>`;
    }
  
    renderSource(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        return `<span class="badge-source ${data.toLowerCase()}">${data}</span>`;
    }
  
    renderFileName(data) {
        return data ? `
            <div class="outbound-file-name">
                <i class="fas fa-file-xml text-success"></i>
                <span class="outbound-file-name-text" title="${data}">${data}</span>
            </div>` : '<span class="text-muted">N/A</span>';
    }
  
    renderDocumentType(data) {
        return `<span class="badge-type documentType" data-bs-toggle="tooltip" title="${data}">${data}</span>`;
    }
  
    renderStatus(data) {
        const status = data || 'Pending';
        const statusClass = status.toLowerCase();
        const icons = {
            pending: 'hourglass-split',
            submitted: 'check-circle-fill',
            cancelled: 'x-circle-fill',
            rejected: 'x-circle-fill',
            processing: 'arrow-repeat',
            failed: 'exclamation-triangle-fill'
        };
        const statusColors = {
            pending: '#ff8307',
            submitted: '#198754',
            cancelled: '#ffc107',
            rejected: '#dc3545',
            processing: '#0d6efd',
            failed: '#dc3545'
        };
        const icon = icons[statusClass] || 'question-circle';
        const color = statusColors[statusClass];

        // Add spinning animation for processing status
        const spinClass = statusClass === 'processing' ? 'spin' : '';
        
        return `<span class="outbound-status ${statusClass}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: ${color}15; color: ${color}; font-weight: 500; transition: all 0.2s ease;">
            <i class="bi bi-${icon} ${spinClass}" style="font-size: 14px;"></i>${status}</span>`;
    }
  
    renderActions(row) {
        if (!row.status || row.status === 'Pending') {
            return `
                <button 
                    class="outbound-action-btn submit"
                    onclick="submitToLHDN('${row.fileName}', '${row.source}', '${row.company}', '${row.uploadedDate}')"
                    data-id="${row.id}">
                    <i class="bi bi-cloud-upload"></i>
                    Submit
                </button>`;
        }
        
        if (row.status === 'Submitted') {
            const timeInfo = this.calculateRemainingTime(row.date_submitted);
            if (timeInfo && !timeInfo.expired) {
                return `
                    <button 
                        class="outbound-action-btn cancel"
                        onclick="cancelDocument('${row.uuid}', '${row.fileName}', '${row.date_submitted}')"
                        data-id="${row.id}"
                        data-uuid="${row.uuid}">
                        <i class="bi bi-x-circle"></i>
                        Cancel
                    </button>`;
            }
        }
        
        return `
            <button 
                class="outbound-action-btn"
                disabled>
                <i class="bi bi-check-circle"></i>
                ${row.status}
            </button>`;
    }
  
    calculateRemainingTime(submissionDate) {
        if (!submissionDate) return null;
        const submitted = new Date(submissionDate);
        const now = new Date();
        const deadline = new Date(submitted.getTime() + (72 * 60 * 60 * 1000));
        
        if (now >= deadline) return null;
        
        const remaining = deadline - now;
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        
        let badgeClass = 'success';
        if (hours < 6) badgeClass = 'danger';
        else if (hours < 24) badgeClass = 'warning';
        
        return { hours, minutes, badgeClass, expired: false };
    }
  
    initializeEventListeners() {
        $('#invoiceTable').on('click', '.submit-btn', async (e) => {
            const btn = $(e.currentTarget);
            const data = btn.data();
            await submitToLHDN(data.fileName, '01', 'Brahims', data.date);
        });
  
  
        $('#invoiceTable').on('click', '.cancel-btn', async (e) => {
            const fileName = $(e.currentTarget).data('fileName');
            await cancelDocument(fileName, uuid);
        });
    }
  
    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    formatIssueDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
        });
    }

    formatIssueTime(time) {
        if (!time) return null;
        
        try {
            // If time is in ISO format with Z (UTC)
            if (time.includes('Z')) {
                // Convert 24-hour format to 12-hour format
                const [hours, minutes] = time.split(':');
                const hour = parseInt(hours, 10);
                const ampm = hour >= 12 ? 'PM' : 'AM';
                const hour12 = hour % 12 || 12;
                
                // Format as "HH:MM AM/PM"
                return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
            }
            
            // For other time formats, try to parse and format consistently
            const [hours, minutes] = time.split(':');
            const hour = parseInt(hours, 10);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12;
            
            return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
        } catch (error) {
            console.error('Error formatting time:', error, {
                originalTime: time
            });
            // If parsing fails, return the original time
            return time;
        }
    }   
    initializeSelectAll() {
        $(document).on('change', '#selectAll', (e) => {
            const isChecked = $(e.target).prop('checked');
            $('.row-checkbox').prop('checked', isChecked);
            this.updateExportButton();
        });
  
        $('#invoiceTable').on('change', '.row-checkbox', () => {
            const totalCheckboxes = $('.row-checkbox').length;
            const checkedCheckboxes = $('.row-checkbox:checked').length;
            $('#selectAll').prop('checked', totalCheckboxes === checkedCheckboxes);
            this.updateExportButton();
        });
    }
  
    addExportButton() {
        const exportBtn = $(`
            <button id="exportSelected" class="outbound-export-btn" disabled>
                <i class="bi bi-download"></i>Export Selected
                <span class="selected-count">(0)</span>
            </button>
        `);
        
        $('.outbound-length-control').append(exportBtn);
        $('#exportSelected').on('click', () => this.exportSelectedRecords());
    }
  
    initializeTooltips() {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));
    }
  
    updateExportButton() {
        const selectedCount = $('.row-checkbox:checked').length;
        const exportBtn = $('#exportSelected');
        exportBtn.prop('disabled', selectedCount === 0);
        exportBtn.find('.selected-count').text(`(${selectedCount})`);
    }
  
    updateCardTotals() {
        if (!this.table) return;
  
        const data = this.table.rows().data();
        const totals = {
            total: 0,
            submitted: 0,
            pending: 0,
            rejected: 0,
            cancelled: 0
        };
  
        // Count all rows
        data.each(row => {
            const status = (row.status || 'Pending').toLowerCase();
            totals.total++;
            
            switch (status) {
                case 'submitted':
                    totals.submitted++;
                    break;
                case 'rejected':
                    totals.rejected++;
                    break;
                case 'cancelled':
                    totals.cancelled++;
                    break;
                case 'processing':
                case 'pending':
                case '':
                case null:
                case undefined:
                    totals.pending++;
                    break;
                default:
                    totals.pending++;
                    break;
            }
        });
  
        // Hide all loading spinners and show counts
        document.querySelectorAll('.loading-spinner').forEach(spinner => {
            spinner.style.display = 'none';
        });
        document.querySelectorAll('.count-info h6').forEach(count => {
            count.style.display = 'block';
        });
  
        // Update card values with animation
        this.animateNumber(document.querySelector('.total-invoice-count'), totals.total);
        this.animateNumber(document.querySelector('.total-submitted-count'), totals.submitted);
        this.animateNumber(document.querySelector('.total-rejected-count'), totals.rejected);
        this.animateNumber(document.querySelector('.total-cancelled-count'), totals.cancelled);
        this.animateNumber(document.querySelector('.total-pending-count'), totals.pending);

 
    }
  
    // Helper method to animate number changes
    animateNumber(element, targetValue) {
        const startValue = parseInt(element.textContent) || 0;
        const duration = 1000; // Animation duration in milliseconds
        const steps = 60; // Number of steps in animation
        const stepValue = (targetValue - startValue) / steps;
        let currentStep = 0;

        const animate = () => {
            currentStep++;
            const currentValue = Math.round(startValue + (stepValue * currentStep));
            element.textContent = currentValue;

            if (currentStep < steps) {
                requestAnimationFrame(animate);
            } else {
                element.textContent = targetValue; // Ensure final value is exact
            }
        };

        requestAnimationFrame(animate);
    }

    // Helper method to update circular progress
    updateProgress(element, percentage) {
        const radius = 40; // Should match your SVG circle radius
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;
        
        const progressCircle = element.querySelector('.progress-circle');
        if (progressCircle) {
            progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
            progressCircle.style.strokeDashoffset = offset;
        }

        // Update percentage text if it exists
        const percentageText = element.querySelector('.progress-percentage');
        if (percentageText) {
            percentageText.textContent = `${Math.round(percentage)}%`;
        }
    }

    // Helper method to update card colors
    updateCardColors(totals) {
        const cards = {
            'total-invoice': {
                element: '.total-invoice-card',
                value: totals.total,
         
            },
            'total-submitted': {
                element: '.total-submitted-card',
                value: totals.submitted,
               
            },
            'total-rejected': {
                element: '.total-rejected-card',
                value: totals.rejected,
            
            },
            'total-cancelled': {
                element: '.total-cancelled-card',
                value: totals.cancelled,
               
            },
            'total-pending': {
                element: '.total-pending-card',
                value: totals.pending,
                
            }
        };

        Object.values(cards).forEach(card => {
            const element = document.querySelector(card.element);
            if (element) {
                const intensity = card.value > 0 ? 1 : 0.7;
                element.style.background = `linear-gradient(135deg, ${card.colors[0]} 0%, ${card.colors[1]} 100%)`;
                element.style.opacity = intensity;
            }
        });
    }
  
    initializeFeatures() {
        this.initializeTableStyles();
        this.initializeEventListeners();
        this.initializeSelectAll();
        this.addExportButton();
        this.initializeTooltips();
    }
  
    initializeTableStyles() {
        $('.dataTables_filter input').addClass('form-control form-control-sm');
        $('.dataTables_length select').addClass('form-select form-select-sm');
    }
  
    refresh() {
        this.table?.ajax.reload(null, false);
    }
  
    cleanup() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
    }
  
    showProgressModal(title = 'Submitting Document to LHDN', message = 'Please wait while we process your request') {
        return `
            <div class="modal-content">
                <div class="modal-header">
                <div class="icon primary">
                    <i class="fas fa-file-earmark-text"></i>
                    </div>
                <div class="title">${title}</div>
                <div class="subtitle">${message}</div>
                </div>
                <div class="modal-body">
                <div class="progress-steps">
                    <div class="step">
                        <div class="step-icon">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="step-content">
                            <div class="step-title">Validating Document</div>
                            <div class="step-status">Validation completed</div>
                        </div>
                            </div>
                    <div class="step processing">
                        <div class="step-icon">
                            <div class="spinner-border spinner-border-sm"></div>
                                            </div>
                        <div class="step-content">
                            <div class="step-title">Uploading to LHDN</div>
                            <div class="step-status">Submitting to LHDN...</div>
                                        </div>
                                </div>
                    <div class="step">
                        <div class="step-icon">
                            <i class="fas fa-clock"></i>
                            </div>
                        <div class="step-content">
                            <div class="step-title">Processing</div>
                            <div class="step-status">Waiting...</div>
                                </div>
                            </div>
                    </div>
            </div>
        </div>
    `;
    }
  
    showErrorModal(title = 'XML Validation Failed', errors = []) {
        const errorList = errors.map(error => `
            <div class="error-item">
                <i class="fas fa-exclamation-circle"></i>
                <div class="error-content">${error}</div>
            </div>
        `).join('');
  
        return `
        <div class="modal-content">
            <div class="modal-header">
                <div class="icon error">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="title">${title}</div>
                <div class="subtitle">Please fix the following issues and try again</div>
            </div>
            <div class="modal-body">
                <div class="error-list">
                    ${errorList}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary">
                        <i class="fas fa-file-excel"></i>
                        Open Excel File
                    </button>
                    <button class="btn btn-light">
                        I Understand
                    </button>
                </div>
            </div>
        </div>
    `;
    }
  
    showConfirmModal(fileDetails) {
        return `
            <div class="modal-content">
                <div class="modal-header">
                <div class="icon primary">
                    <i class="fas fa-file-check"></i>
                    </div>
                <div class="title">Confirm Submission</div>
                <div class="subtitle">Please review the document details before submitting to LHDN</div>
                </div>
                <div class="modal-body">
                <div class="file-details">
                        <div class="detail-item">
                        <span class="field-label">File Name</span>
                        <span class="field-value">${fileDetails.fileName}</span>
                        </div>
                        <div class="detail-item">
                        <span class="field-label">Source</span>
                        <span class="field-value">${fileDetails.source}</span>
                        </div>
                        <div class="detail-item">
                        <span class="field-label">Company</span>
                        <span class="field-value">${fileDetails.company}</span>
                        </div>
                    <div class="detail-item">
                        <span class="field-label">Upload Date</span>
                        <span class="field-value">${fileDetails.uploadedDate}</span>
                    </div>
                    <div class="detail-item">
                        <span class="field-label">Version</span>
                        <span class="field-value">${fileDetails.version}</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary">
                        <i class="fas fa-check"></i>
                        Yes, Submit
                    </button>
                    <button class="btn btn-light">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `;
    }

    showEmptyState(message = 'No XML files found') {
        const emptyState = `
            <div class="empty-state-container text-center p-4">
                <div class="empty-state-icon mb-3">
                    <i class="fas fa-file-xml fa-3x text-muted"></i>
                </div>
                <h5 class="empty-state-title mb-2">No XML Files</h5>
                <p class="empty-state-description text-muted mb-3">${message}</p>
                <div class="empty-state-actions">
                    <button class="btn btn-primary" onclick="window.location.reload()">
                        <i class="fas fa-sync-alt me-1"></i>Refresh
                    </button>
                    <button class="btn btn-outline-secondary ms-2" onclick="this.dispatchEvent(new CustomEvent('show-help'))">
                        <i class="fas fa-question-circle me-1"></i>Help
                    </button>
                </div>
            </div>
        `;

        const tableContainer = document.querySelector('.outbound-table-container');
        if (tableContainer) {
            tableContainer.innerHTML = emptyState;
            
            // Add help button event listener
            const helpButton = tableContainer.querySelector('button[onclick*="show-help"]');
            if (helpButton) {
                helpButton.addEventListener('click', () => {
                    Swal.fire({
                        title: 'XML Files Help',
                        html: `
                            <div class="text-left">
                                <p>If you're seeing no XML files, here are some things to check:</p>
                                <ul class="text-left">
                                    <li>Verify that XML files exist in the correct directory</li>
                                    <li>Check file naming format (should be {fileName}.xml)</li>
                                    <li>Ensure you have proper permissions to access the files</li>
                                    <li>Contact your system administrator if the issue persists</li>
                                </ul>

                            </div>
                        `,
                        icon: 'info',
                        confirmButtonText: 'Got it'
                    });
                });
            }
        }
    }

    getEmptyStateHtml(message = 'No XML files found') {
        return `
            <div class="empty-state-container text-center p-4">
                <div class="empty-state-icon mb-3">
                    <i class="fas fa-file-xml fa-3x text-muted"></i>
                </div>
                <p class="empty-state-description text-muted">${message}</p>
            </div>
        `;
    }
  }
  
  // Initialize when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    const manager = InvoiceTableManager.getInstance();
    DateTimeManager.updateDateTime();
  });
  
  // Step functions for the submission process
  async function performStep1(fileName, type, company, date, version) {
    console.log('🚀 [Step 1] Starting validation with params:', { fileName, type, company, date, version });
    
    try {
        // Start processing
        console.log('🔍 [Step 1] Starting validation');
        await updateStepStatus(1, 'processing', 'Validating document format...');
        
        // Pass version to validateXMLFile
        const validatedData = await validateXMLFile(fileName, type, company, date, version);
        
        if (!validatedData) {
            console.error('❌ [Step 1] No data available for validation');
            await updateStepStatus(1, 'error', 'Validation failed');
            throw new ValidationError('No data available for validation', [], fileName);
        }
  
        // Complete successfully
        console.log('✅ [Step 1] Validation successful');
        await updateStepStatus(1, 'completed', 'Validation completed');
        
        return validatedData;
    } catch (error) {
        console.error('❌ [Step 1] Validation failed:', error);
        await updateStepStatus(1, 'error', 'Validation failed');
        throw error;
    }
  }
  
  // Helper function to group validation errors by type
  function groupValidationErrors(errors) {
    const groups = {};
    errors.forEach(error => {
        const type = error.type || 'VALIDATION_ERROR';
        if (!groups[type]) {
            groups[type] = [];
        }
        groups[type].push(error);
    });
    return groups;
  }
  
  // Helper function to get icon for error type
  function getErrorTypeIcon(type) {
    const icons = {
        'DS302': 'fa-copy',
        'CF321': 'fa-calendar-times',
        'CF364': 'fa-tags',
        'CF401': 'fa-calculator',
        'CF402': 'fa-money-bill',
        'CF403': 'fa-percent',
        'CF404': 'fa-id-card',
        'CF405': 'fa-address-card',
        'AUTH001': 'fa-lock',
        'DUPLICATE_SUBMISSION': 'fa-copy',
        'VALIDATION_ERROR': 'fa-exclamation-circle',
        'DB_ERROR': 'fa-database',
        'SUBMISSION_ERROR': 'fa-exclamation-triangle'
    };
    return icons[type] || 'fa-exclamation-circle';
  }
  
  // Helper function to format error type for display
  function formatErrorType(type) {
    const typeMap = {
        'DS302': 'Duplicate Document',
        'CF321': 'Date Validation',
        'CF364': 'Classification',
        'CF401': 'Tax Calculation',
        'CF402': 'Currency',
        'CF403': 'Tax Code',
        'CF404': 'Identification',
        'CF405': 'Party Information',
        'AUTH001': 'Authentication',
        'DUPLICATE_SUBMISSION': 'Duplicate Submission',
        'VALIDATION_ERROR': 'Validation Error',
        'DB_ERROR': 'Database Error',
        'SUBMISSION_ERROR': 'Submission Error'
    };
    return typeMap[type] || type.replace(/_/g, ' ');
  }
  
  async function showSubmissionStatus(fileName, type, company, date, version) {
    console.log('🚀 Starting submission status process:', { fileName, type, company, date, version });
    window.currentFileName = fileName;
  
    let modal = null;
    try {
        // Create steps HTML
        //console.log('📋 Creating steps container');
        const stepsHtml = `
           <style>
                .step-card {
                    transform: translateY(10px);
                    opacity: 0.6;
                    transition: all 0.3s ease;
                    margin-bottom: 1rem;
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    flex-direction: column;
                }
                
                .step-card.processing {
                    transform: translateY(0);
                    opacity: 1;
                    border-color: var(--primary);
                    background: var(--primary-light);
                }
                
                .step-card.completed {
                    opacity: 1;
                    border-color: var(--success);
                    background: var(--success-light);
                }
                
                .step-card.error {
                    opacity: 1;
                    border-color: var(--error);
                    background: var(--error-light);
                }
                
                .step-badge {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 0.5rem;
                }
                
                .step-card.processing .step-badge {
                    background: var(--primary-light);
                    color: var(--primary);
                }
                
                .step-card.completed .step-badge {
                    background: var(--success-light);
                    color: var(--success);
                }
                
                .step-card.error .step-badge {
                    background: var(--error-light);
                    color: var(--error);
                }
                
                .step-badge.spinning::after {
                    content: '';
                    width: 20px;
                    height: 20px;
                    border: 2px solid var(--primary);
                    border-right-color: transparent;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    display: block;
                }
                
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .step-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.25rem;
                }
                
                .step-title {
                    font-weight: 500;
                    font-size: 1rem;
                    color: var(--text-main);
                }
                
                .step-status {
                    font-size: 0.875rem;
                    color: var(--text-muted);
                }
            </style>
            <div class="steps-container">
                ${getStepHtml(1, 'Validating Document')}
                ${getStepHtml(2, 'Submit to LHDN')}
                ${getStepHtml(3, 'Processing')}
            </div>
        `;
  
        // Create and show modal
        //console.log('📦 Creating submission modal');
        modal = await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Submitting Document to LHDN',
                subtitle: 'Please wait while we process your request',
                content: stepsHtml
            }),
            showConfirmButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: 480,
            padding: '1.5rem',
            customClass: {
                popup: 'semi-minimal-popup'
            },
            didOpen: async () => {
                try {
                    // Verify steps were created
                    //console.log('🔍 Verifying step elements:');
                    for (let i = 1; i <= 3; i++) {
                        const step = document.getElementById(`step${i}`);
                        if (step) {
                            //console.log(`✅ Step ${i} element found`);
                        } else {
                            console.error(`❌ Step ${i} element not found`);
                        }
                    }
  
                    // Step 1: Internal Validation
                    //console.log('🔍 Starting Step 1: Document Validation');
                    await updateStepStatus(1, 'processing', 'Validating document...');
                    const validatedData = await performStep1(fileName, type, company, date, version);
                    
                    if (!validatedData) {
                        throw new ValidationError('No data available for validation', [], fileName);
                    }
                    await updateStepStatus(1, 'completed', 'Validation completed');
  
                    // Step 2: Submit to LHDN
                    //console.log('📤 Starting Step 2: LHDN Submission');
                    await updateStepStatus(2, 'processing', 'Submitting to LHDN...');
                    
                    // Add the original parameters to the validated data
                    const submissionData = {
                        ...validatedData,
                        fileName,
                        type,
                        company,
                        date,
                        version
                    };
                    
                    const submitted = await performStep2(submissionData, version);
                    
                    if (!submitted) {
                        throw new Error('LHDN submission failed');
                    }
                    await updateStepStatus(2, 'completed', 'Submission completed');
  
                    // Step 3: Process Response
                    //console.log('⚙️ Starting Step 3: Processing');
                    await updateStepStatus(3, 'processing', 'Processing response...');
                    const processed = await performStep3(submitted);
                    
                    if (!processed) {
                        throw new Error('Response processing failed');
                    }
                    await updateStepStatus(3, 'completed', 'Processing completed');
  
                    //console.log('🎉 All steps completed successfully');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    if (modal) {
                        Swal.close();
                    }
                    
                    await showSuccessMessage(fileName, version);
                    // Refresh the table
                    window.location.reload();
                } catch (error) {
                    console.error('❌ Step execution failed:', error);
                    
                    // Find the current processing step and update its status to error
                    const currentStep = document.querySelector('.step-card.processing');
                    if (currentStep) {
                        const stepNumber = parseInt(currentStep.id.replace('step', ''));
                        //console.log(`⚠️ Updating step ${stepNumber} to error state`);
                        await updateStepStatus(stepNumber, 'error', 'Error occurred');
                    }
  
                    // Add delay for visual feedback
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Close the current modal
                    if (modal) {
                        modal.close();
                    }
  
                    // Show appropriate error modal based on error type
                    if (error instanceof ValidationError) {
                        //console.log('📋 Showing XML validation error modal');
                        await showXMLValidationError(error);
                    } else {
                        //console.log('🔴 Showing LHDN error modal');
                        await showLHDNErrorModal(error);
                    }
                    throw error; // Re-throw to be caught by outer catch
                }
            }
        });
  
        return true;
  
    } catch (error) {
        console.error('❌ Submission process failed:', error);
        
        // Show appropriate error modal based on error type
        if (error instanceof ValidationError) {
            //console.log('📋 Showing XML validation error modal');
            await showXMLValidationError(error);
        } else {
            //console.log('🔴 Showing LHDN error modal');
            await showLHDNErrorModal(error);
        }
        return false;
    }
  }
  
  async function performStep2(data, version) {
    try {
        //console.log('🚀 [Step 2] Starting LHDN submission with data:', data);
        await updateStepStatus(2, 'processing', 'Connecting to LHDN...');
        await updateStepStatus(2, 'processing', 'Preparing Documents...');
        //console.log('📤 [Step 2] Initiating submission to LHDN');
        
        // Extract the required parameters from the data
        const {
            fileName,
            type,
            company,
            date
        } = data;
  
        // Make the API call to send-lhdn endpoint
        const response = await fetch('/api/xml/send-lhdn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fileName,
                type: type,
                company,
                date,
                version
            })
        });
  
        const result = await response.json();
  
        if (!response.ok) {
            console.error('❌ [Step 2] API error response:', result);
            throw new Error(JSON.stringify(result.error));
        }
  
        // Update the table row status
        const table = $('#invoiceTable').DataTable();
        const rows = table.rows().nodes();
        $(rows).each((index, row) => {
            const rowData = table.row(row).data();
            if (rowData.fileName === fileName) {
                rowData.status = 'Submitted';
                table.row(row).data(rowData).draw(false);
            }
        });
  
        //console.log('✅ [Step 2] Submission successful:', result);
        await updateStepStatus(2, 'completed', 'Submission completed');
        return result;
  
    } catch (error) {
        console.error('❌ [Step 2] LHDN submission failed:', error);
        await updateStepStatus(2, 'error', 'Submission failed');
        throw error;
    }
  } 
  
  async function performStep3(response) {
    //console.log('🚀 [Step 3] Starting response processing');
    
    try {
        // Start processing
        //console.log('📝 [Step 3] Processing LHDN response');
        await updateStepStatus(3, 'processing', 'Processing response...');
        
        // Process response
        if (!response || !response.success) {
            console.error('❌ [Step 3] Invalid response data');
        }
        
        //console.log('📝 [Step 3] Response data:', response ? 'Data present' : 'No data');
        if (!response) {
            console.error('❌ [Step 3] No response data to process');
            //console.log('Updating step status to error...');
            await updateStepStatus(3, 'error', 'Processing failed');
            throw new Error('No response data to process');
        }
  
        // Simulate processing time (if needed)
        //console.log('⏳ [Step 3] Processing response data...');
        await new Promise(resolve => setTimeout(resolve, 1000));
  
        // Complete successfully
        //console.log('✅ [Step 3] Response processing completed');
        //console.log('Updating step status to completed...');
        await updateStepStatus(3, 'completed', 'Processing completed');
        
        return true;
    } catch (error) {
        console.error('❌ [Step 3] Response processing failed:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        //console.log('Updating step status to error...');
        await updateStepStatus(3, 'error', 'Processing failed');
        throw error;
    }
  }
