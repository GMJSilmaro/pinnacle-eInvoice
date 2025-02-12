// DateTime Manager Class
class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');
        
        function update() {
            const now = new Date();
            
            // Update time
            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            
            // Update date
            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }
        
        // Update immediately and then every second
        update();
        setInterval(update, 1000);
    }
}

// Create a class for managing inbound invoices
class InvoiceTableManager {
    static instance = null;

    static getInstance() {
        if (!InvoiceTableManager.instance) {
            InvoiceTableManager.instance = new InvoiceTableManager();
        }
        return InvoiceTableManager.instance;
    }

    constructor() {
        // Prevent multiple instances
        if (InvoiceTableManager.instance) {
            return InvoiceTableManager.instance;
        }

        this.initializeTable();
        InvoiceTableManager.instance = this;
    }

    initializeTable() {
        if ($.fn.DataTable.isDataTable('#invoiceTable')) {
            return;
        }

        // Add refresh button to the table header
        const refreshButton = `
            <button id="refreshLHDNData" class="btn btn-outline-primary btn-sm me-2">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data
            </button>
        `;
        // Move button to be before the search input
        $('.dataTables_filter').prepend(refreshButton);

        this.table = $('#invoiceTable').DataTable({
            processing: false,
            serverSide: false,
            ajax: {
                url: '/api/lhdn/documents/recent',
                method: 'GET',
                data: function(d) {
                    // Add force refresh parameter
                    d.forceRefresh = window.forceRefreshLHDN || false;
                    return d;
                },
                dataSrc: (json) => {
                    const result = json && json.result ? json.result : [];
                    // Reset force refresh flag after data is loaded
                    window.forceRefreshLHDN = false;
                    // Update totals after data is loaded and table is ready
                    setTimeout(() => this.updateCardTotals(), 100);
                    return result;
                }
            },
            columns: [
                {
                    data: null,
                    orderable: false,
                    className: 'checkbox-column',
                    defaultContent: `
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input row-checkbox">
                        </div>`,
                    width: '28px'
                },
                {
                    data: 'uuid',
                    className: 'uuid-column',
                    width: '180px',
                    render: function(data) {
                        return `<a href="#" class="badge-status Valid text-truncate" data-bs-toggle="tooltip" data-bs-placement="top" title="Click to copy UUID">${data}</a>`;
                    }
                },
                {
                    data: 'internalId',
                    title: 'INTERNAL ID',
                    className: 'invoice-number text-center',
                    render: data => `<span class="badge-invoice">${data}</span>`
                },
                {
                    data: null,
                    title: 'TYPE',
                    className: 'type-column ',
                    render: function(row) {
                        return `<span class="badge-type invoice">Invoice ${row.typeVersionName || '1.0'}</span>`;
                    }
                },
                {
                    data: 'supplierName',
                    title: 'SUPPLIER',
                    className: 'customer-name',
                    render: function(data) {
                        return `<div class="customer-name" data-bs-toggle="tooltip" data-bs-placement="top" title="${data}">${data}</div>`;
                    }
                },
                {
                    data: 'receiverName',
                    title: 'RECEIVER',
                    className: 'customer-name',
                    render: function(data) {
                        return `<div class="customer-name" data-bs-toggle="tooltip" data-bs-placement="top" title="${data}">${data}</div>`;
                    }
                },
                {
                    data: 'dateTimeIssued',
                    title: 'ISSUE DATE', 
                    className: 'date-column text-left',
                    render: data => `<div class="date-column" data-bs-toggle="tooltip" data-bs-placement="top" title="${this.formatDate(data)}">${this.formatDate(data)}</div>`
                },
                {
                    data: 'dateTimeReceived',
                    title: 'RECEIVED DATE',
                    className: 'date-column text-left',
                    render: data => `<div class="date-column" data-bs-toggle="tooltip" data-bs-placement="top" title="${this.formatDate(data)}">${this.formatDate(data)}</div>`
                },
                {
                    data: null,
                    title: 'STATUS',
                    className: 'status-column text-center',
                    render: function(row) {
                        return `<span class="badge-status ${row.status}">${row.status}</span>`;
                    }
                },
                {
                    data: 'submissionChannel',
                    title: 'SOURCE',
                    className: 'source-column text-center',
                    render: data => `<span class="badge bg-primary rounded-pill">LHDN</span>`
                },
                {
                    data: 'totalSales',
                    title: 'TOTAL SALES',
                    className: 'amount-column text-end',
                    render: data => `<span class="text-nowrap">MYR ${parseFloat(data || 0).toLocaleString('en-MY', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    })}</span>`
                },
                {
                    data: null,
                    title: '',
                    className: 'action-column text-center',
                    orderable: false,
                    render: function(row) {
                        return `
                            <button class="outbound-action-btn submit" 
                                    onclick="viewInvoiceDetails('${row.uuid}')"
                                    data-uuid="${row.uuid}">
                                <i class="bi bi-eye me-1"></i>View</button>`;
                    }
                }
            ],
           
            scrollX: true,
            scrollCollapse: true,
            autoWidth: false,
            pageLength: 10,
            dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rtip',
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
                select: {
                    rows: {
                        _: 'Selected %d rows',
                        0: 'Click a row to select it',
                        1: 'Selected 1 row'
                    }
                }
            },
            drawCallback: (settings) => {
                // Only update totals if this is not the first draw
                if (settings._iDisplayLength !== undefined) {
                    this.updateCardTotals();
                }
            },
            initComplete: () => {
                // Update totals once table is fully initialized
                this.updateCardTotals();
            }
        });
        
        // Assign the DataTable instance to the global variable
        window.inboundDataTable = this.table;
        
        this.initializeTableStyles();
        this.initializeEventListeners();
        this.initializeSelectAll();
        this.addExportButton();
        this.initializeTooltipsAndCopy();

        // Add spinning animation CSS
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .spin {
                animation: spin 1s linear infinite;
                display: inline-block;
            }
        `;
        document.head.appendChild(style);
    }

    // Add this new method to handle table styles initialization
    initializeTableStyles() {
        // Add custom search styling
        $('.dataTables_filter input').addClass('form-control form-control-sm');
        $('.dataTables_length select').addClass('form-select form-select-sm');
    }

    initializeEventListeners() {
        $('#invoiceTable').on('click', '.view-details', async (e) => {
            const uuid = $(e.currentTarget).data('uuid');
            await viewInvoiceDetails(uuid);
        });
    }

    cleanup() {
        // Cleanup function to be called when page is unloaded
        if (this.table) {
            this.table.destroy();
        }
    }

    // Helper methods
    formatDate(date) {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-MY', {
            style: 'currency',
            currency: 'MYR'
        }).format(amount || 0);
    }

    createStatusBadge(status, reason) {
        const statusClasses = {
            'Valid': 'bg-success',
            'Invalid': 'bg-danger',
            'Pending': 'bg-warning',
            'Rejected': 'bg-danger',
            'Cancelled': 'bg-secondary',
            'Queue': 'bg-info'
        };
        const className = statusClasses[status] || 'bg-secondary';
        const reasonHtml = reason ? `<br><small class="text-muted">${reason}</small>` : '';
        return `<span class="badge ${className}">${status || 'Unknown'}</span>${reasonHtml}`;
    }

    createSourceBadge(source) {
        const isPixelCare = source === 'PixelCare';
        return `<span class="badge ${isPixelCare ? 'bg-primary' : 'bg-info'}">
            <i class="bi ${isPixelCare ? 'bi-pc-display' : 'bi-building'}"></i>
            ${source || 'Unknown'}
        </span>`;
    }

    initializeSelectAll() {
        // Handle "Select All" checkbox
        $('#selectAll').on('change', (e) => {
            const isChecked = $(e.target).prop('checked');
            $('.row-checkbox').prop('checked', isChecked);
            this.updateExportButton();
        });

        // Handle individual checkbox changes
        $('#invoiceTable').on('change', '.row-checkbox', () => {
            const totalCheckboxes = $('.row-checkbox').length;
            const checkedCheckboxes = $('.row-checkbox:checked').length;
            $('#selectAll').prop('checked', totalCheckboxes === checkedCheckboxes);
            this.updateExportButton();
        });
    }

    addExportButton() {
        // Add export button after the table length control
        const exportBtn = $(`
            <button id="exportSelected" class="outbound-action-btn submit btn-sm ms-2" disabled>
                <i class="bi bi-download me-1"></i>Export Selected
                <span class="selected-count ms-1">(0)</span>
            </button>
        `);

        $('.dataTables_length').append(exportBtn);

        // Remove existing refresh button
        $('#refreshLHDNData').remove();

        // Add refresh button next to the export button
        const refreshButton = `
            <button id="refreshLHDNData" class="outbound-action-btn submit btn-sm ms-2">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data
            </button>
        `;
        $('.dataTables_length').append(refreshButton);

        // Handle export button click
        $('#exportSelected').on('click', () => this.exportSelectedRecords());
        
        // Add refresh button click handler
        $('#refreshLHDNData').on('click', async () => {
            try {
                const button = $('#refreshLHDNData');
                const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'));
                const progressBar = document.querySelector('#loadingModal .progress-bar');
                const statusText = document.getElementById('loadingStatus');
                const detailsText = document.getElementById('loadingDetails');
                
                // Disable button and show loading state
                button.prop('disabled', true);
                
                // Show loading modal
                loadingModal.show();
                
                // Update progress bar and status (initial state)
                progressBar.style.width = '10%';
                statusText.textContent = 'Connecting to LHDN server...';
                
                // Set force refresh flag
                window.forceRefreshLHDN = true;

                // Set up event listener for ajax events
                $(document).on('ajaxSend.dt', (e, xhr, settings) => {
                    if (settings.url.includes('/api/lhdn/documents/recent')) {
                        progressBar.style.width = '30%';
                        statusText.textContent = 'Connected! Fetching your documents...';
                    }
                });

                // Listen for xhr progress
                $(document).on('xhr.dt', (e, settings, json, xhr) => {
                    if (json && json.result) {
                        progressBar.style.width = '60%';
                        statusText.textContent = 'Documents received! Processing data...';
                        detailsText.textContent = `Found ${json.result.length} documents`;
                    }
                });

                // Reload the table
                await this.table.ajax.reload(null, false);

                // Update final progress
                progressBar.style.width = '100%';
                statusText.textContent = 'Success! Your data is now up to date.';
                
                // Close modal after a short delay
                setTimeout(() => {
                    loadingModal.hide();
                    // Reset progress bar for next time
                    progressBar.style.width = '0%';
                    detailsText.textContent = '';
                    
                    // Show success toast
                    Swal.fire({
                        icon: 'success',
                        title: 'Data Refreshed',
                        text: 'Successfully fetched fresh data from LHDN',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000,
                        backdrop: false // Add this line to remove the backdrop
                    });
                }, 1000);

            } catch (error) {
                console.error('Error refreshing LHDN data:', error);
                
                // Show error in modal
                document.getElementById('loadingStatus').textContent = 'Oops! Something went wrong.';
                document.getElementById('loadingDetails').textContent = 'Please try again in a few moments.';
                
                // Close modal after error message
                setTimeout(() => {
                    bootstrap.Modal.getInstance(document.getElementById('loadingModal')).hide();
                    
                    // Show error alert
                    Swal.fire({
                        icon: 'error',
                        title: 'Refresh Failed',
                        text: 'Unable to fetch fresh data from LHDN. Please try again.'
                    });
                }, 2000);
            } finally {
                // Reset button state
                $('#refreshLHDNData')
                    .prop('disabled', false)
                    .html('<i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data');
                
                // Clean up event listeners
                $(document).off('ajaxSend.dt');
                $(document).off('xhr.dt');
            }
        });
    }

    updateExportButton() {
        const selectedCount = $('.row-checkbox:checked').length;
        const exportBtn = $('#exportSelected');
        
        if (selectedCount > 0) {
            exportBtn.prop('disabled', false);
            exportBtn.find('.selected-count').text(`(${selectedCount})`);
        } else {
            exportBtn.prop('disabled', true);
            exportBtn.find('.selected-count').text('(0)');
        }
    }

    async exportSelectedRecords() {
        try {
            const selectedRows = [];
            $('.row-checkbox:checked').each((_, checkbox) => {
                const rowData = this.table.row($(checkbox).closest('tr')).data();
                selectedRows.push(rowData);
            });

            if (selectedRows.length === 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'No Records Selected',
                    text: 'Please select at least one record to export.'
                });
                return;
            }

            // Show loading state
            const exportBtn = $('#exportSelected');
            const originalHtml = exportBtn.html();
            exportBtn.prop('disabled', true);
            exportBtn.html('<i class="bi bi-arrow-repeat spin me-1"></i>Exporting...');

            // Prepare export data
            const exportData = selectedRows.map(row => ({
                UUID: row.uuid,
                'Internal ID': row.internalId,
                Type: row.typeName,
                Supplier: row.supplierName,
                Receiver: row.receiverName,
                'Issue Date': new Date(row.dateTimeIssued).toLocaleString(),
                'Received Date': new Date(row.dateTimeReceived).toLocaleString(),
                Status: row.status,
                'Total Sales': `RM ${parseFloat(row.totalSales).toFixed(2)}`
            }));

            // Convert to CSV
            const csvContent = this.convertToCSV(exportData);
            
            // Create and trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `inbound_invoices_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();

            // Reset button state
            exportBtn.prop('disabled', false);
            exportBtn.html(originalHtml);

            // Show success message
            Swal.fire({
                icon: 'success',
                title: 'Export Complete',
                text: `Successfully exported ${selectedRows.length} records`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });

        } catch (error) {
            console.error('Export error:', error);
            Swal.fire({
                icon: 'error',
                title: 'Export Failed',
                text: 'Failed to export selected records. Please try again.'
            });
        }
    }

    convertToCSV(data) {
        if (data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        const rows = [
            headers.join(','), // Header row
            ...data.map(row => 
                headers.map(header => 
                    JSON.stringify(row[header] || '')
                ).join(',')
            )
        ];
        
        return rows.join('\n');
    }

    updateCardTotals() {
        // Check if table is initialized
        if (!this.table || !$.fn.DataTable.isDataTable('#invoiceTable')) {
            return;
        }

        try {
            const data = this.table.rows().data();
            const totals = {
                invoices: 0,
                valid: 0,
                invalid: 0,
                rejected: 0,
                cancelled: 0,
                queue: 0
            };

            // Count totals
            if (data && data.length) {
                data.each(row => {
                    totals.invoices++;
                    switch (row.status) {
                        case 'Valid':
                            totals.valid++;
                            break;
                        case 'Invalid':
                            totals.invalid++;
                            break;
                        case 'Rejected':
                            totals.rejected++;
                            break;
                        case 'Cancelled':
                            totals.cancelled++;
                            break;
                        case 'Queue':
                            totals.queue++;
                            break;
                    }
                });
            }

            // Update card values and hide spinners
            $('.total-invoice-value')
                .text(totals.invoices)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-primary">${totals.invoices}</span>`);

            $('.total-valid-value')
                .text(totals.valid)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-success">${totals.valid}</span>`);

            $('.total-invalid-value')
                .text(totals.invalid)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.invalid}</span>`);

            $('.total-rejected-value')
                .text(totals.rejected)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.rejected}</span>`);

            $('.total-cancel-value')
                .text(totals.cancelled)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-warning">${totals.cancelled}</span>`);

            $('.total-queue-value')
                .text(totals.queue)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-info">${totals.queue}</span>`);

            // Hide all spinners
            $('.loading-spinner').hide();

            // Remove any existing badges before adding new ones
            $('.card-icon .badge').remove();

        } catch (error) {
            console.error('Error updating card totals:', error);
            // Don't hide spinners if there was an error
        }
    }

    initializeTooltipsAndCopy() {
        // Initialize tooltips for new elements
        const initTooltips = () => {
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                new bootstrap.Tooltip(tooltipTriggerEl, {
                    trigger: 'hover'
                });
            });
        };

        // Initialize tooltips on first load
        initTooltips();

        // Reinitialize tooltips after table draw
        this.table.on('draw', () => {
            // Dispose existing tooltips
            const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltips.forEach(element => {
                const tooltip = bootstrap.Tooltip.getInstance(element);
                if (tooltip) {
                    tooltip.dispose();
                }
            });
            // Initialize new tooltips
            initTooltips();
        });

        // Handle UUID copy
        this.table.on('click', '.uuid-link', (e) => {
            e.preventDefault();
            const uuid = $(e.currentTarget).text();
            const tooltipInstance = bootstrap.Tooltip.getInstance(e.currentTarget);
            
            navigator.clipboard.writeText(uuid).then(() => {
                // Hide tooltip if it exists
                if (tooltipInstance) {
                    tooltipInstance.hide();
                }
                
                // Show success message
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'UUID copied to clipboard!',
                    showConfirmButton: false,
                    timer: 1500
                });
            }).catch(err => {
                console.error('Failed to copy:', err);
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'error',
                    title: 'Failed to copy UUID',
                    showConfirmButton: false,
                    timer: 1500
                });
            });
        });
    }
}

async function viewInvoiceDetails(uuid) {
    try {
        // Get the table row data first
        const table = $('#invoiceTable').DataTable();
        const rowData = table.rows().data().toArray().find(row => row.uuid === uuid);
        
        console.log('Table Row Data:', rowData);
        
        // Show loading state
        $('#modalLoadingOverlay').removeClass('d-none');

        // Fetch document details
        const response = await fetch(`/api/lhdn/documents/${uuid}/display-details`);
        const result = await response.json();
        
        console.log('API Response:', result);

        if (!response.ok) {
            throw new Error(result.message || `Failed to fetch document details (Status: ${response.status})`);
        }

        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch invoice details');
        }

        // Parse document data if it exists
        if (result.documentInfo?.document) {
            try {
                const documentData = JSON.parse(result.documentInfo.document);
                console.log('Parsed Document Data:', documentData);
                result.documentInfo.parsedDocument = documentData;
            } catch (parseError) {
                console.warn('Failed to parse document data:', parseError);
            }
        }

        const documentInfo = result.documentInfo;
        console.log('Document Info:', documentInfo);

        // Check document status first
        if (documentInfo.status === 'Invalid') {
            // Close any existing modals
            const existingModal = bootstrap.Modal.getInstance(document.getElementById('documentDetailsModal'));
            if (existingModal) {
                existingModal.hide();
            }

            // Show validation results modal
            await openValidationResultsModal(uuid);
            return;
        }

        if (documentInfo.status === 'Submitted') {
            Swal.fire({
                icon: 'warning',
                title: 'Document Pending',
                text: 'This document is still being processed. Please wait for validation to complete.',
                confirmButtonColor: '#ffc107'
            });
            return;
        }

        // Get the document details modal element
        const modalElement = document.getElementById('documentDetailsModal');
        if (!modalElement) {
            throw new Error('Document details modal element not found');
        }

        // Create and show document details modal
        const modal = new bootstrap.Modal(modalElement);

        // Only proceed to show modal if document is Valid or Cancelled
        if (['Valid', 'Cancelled'].includes(documentInfo.status)) {
            await populateViewDetailsModal(modalElement, rowData, result);
            
            // Show modal
            modal.show();

            // Only load PDF for valid documents
            await loadPDF(uuid, result);
        } else {
            // For any other status
            Swal.fire({
                icon: 'info',
                title: 'Document Unavailable',
                text: `Document cannot be viewed when status is ${documentInfo.status}.`,
                confirmButtonColor: '#0dcaf0'
            });
        }

    } catch (error) {
        console.error('Error showing document details:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to show document details'
        });
    } finally {
        // Hide loading state
        $('#modalLoadingOverlay').addClass('d-none');
    }
}

// Function to populate the view details modal
async function populateViewDetailsModal(modalElement, rowData, result) {
    const documentInfo = result.documentInfo;
    // Update modal header content
    const modalTitle = modalElement.querySelector('.modal-title');
    const modalInvoiceNumber = modalElement.querySelector('#modal-invoice-number');
    const statusBadge = modalElement.querySelector('.badge-status');
    
    modalTitle.innerHTML = '<i class="bi bi-file-text me-2"></i>Document Details';
    modalInvoiceNumber.textContent = `#${documentInfo.internalId}`;
    statusBadge.className = `badge-status ${documentInfo.status} me-3`;
    statusBadge.textContent = documentInfo.status;

    // Prepare supplier info using rowData and supplierInfo
    const supplierInfo = {
        company: rowData.supplierName || rowData.issuerName,
        tin: rowData.supplierTIN || rowData.issuerTin,
        registrationNo: rowData.issuerID || documentInfo.supplierRegistrationNo || 'N/A',
        taxRegNo: documentInfo.supplierSstNo || rowData.issuerTaxRegNo || 'N/A',
        msicCode: documentInfo.supplierMsicCode || rowData.issuerMsicCode || 'N/A',
        address: documentInfo.supplierAddress || rowData.issuerAddress || 'N/A'
    };

    // Prepare buyer info using rowData and documentInfo
    const customerInfo = {
        company: rowData.receiverName || rowData.buyerName,
        tin: rowData.receiverTIN || rowData.buyerTIN,
        registrationNo: rowData.receiverId || documentInfo.receiverRegistrationNo || 'N/A',
        taxRegNo: documentInfo.receiverSstNo || rowData.receiverTaxRegNo || 'N/A',
        address: documentInfo.receiverAddress || rowData.receiverAddress || 'N/A'
    };

    // Prepare payment info using rowData and result
    const paymentInfo = {
        totalIncludingTax: result.paymentInfo?.totalIncludingTax || 0,
        totalExcludingTax: result.paymentInfo?.totalExcludingTax || 0,
        taxAmount: result.paymentInfo?.taxAmount || 0,
        irbmUniqueNo: documentInfo.uuid
    };

    // Update info sections content
    const supplierContentDiv = modalElement.querySelector('#supplier-info-content');
    const buyerContentDiv = modalElement.querySelector('#buyer-info-content');
    const paymentContentDiv = modalElement.querySelector('#payment-info-content');

    supplierContentDiv.innerHTML = createSupplierContent(supplierInfo);
    buyerContentDiv.innerHTML = createBuyerContent(customerInfo);
    paymentContentDiv.innerHTML = createPaymentContent(paymentInfo);
}

// Helper functions to create content sections
function createSupplierContent(supplierInfo) {
    return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${supplierInfo?.company || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${supplierInfo?.tin || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${supplierInfo?.registrationNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${supplierInfo?.taxRegNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">MSIC CODE</div>
                <div class="value">${supplierInfo?.msicCode || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap">${supplierInfo?.address || 'N/A'}</div>
            </div>
        </div>
    `;
}

function createBuyerContent(customerInfo) {
    return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${customerInfo?.company || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${customerInfo?.tin || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${customerInfo?.registrationNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${customerInfo?.taxRegNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap">${customerInfo?.address || 'N/A'}</div>
            </div>
        </div>
    `;
}

function createPaymentContent(paymentInfo) {
    // Ensure all values are properly parsed as numbers
    const totalAmount = parseFloat(paymentInfo?.totalIncludingTax || 0);
    const subtotal = parseFloat(paymentInfo?.totalExcludingTax || 0);
    const taxAmount = parseFloat(paymentInfo?.taxAmount || 0);

    return `
        <div class="info-content">
            <div class="info-row highlight-row">
                <div class="label">TOTAL AMOUNT</div>
                <div class="value">
                    ${formatCurrency(totalAmount)}
                </div>
            </div>
            <div class="info-row">
                <div class="label">SUBTOTAL</div>
                <div class="value">
                    ${formatCurrency(subtotal)}
                </div>
            </div>
            <div class="info-row">
                <div class="label">TAX AMOUNT</div>
                <div class="value">
                    ${formatCurrency(taxAmount)}
                </div>
            </div>
            <div class="info-row">
                <div class="label">IRBM UNIQUE NO</div>
                <div class="value">
                    <span class="badge bg-light text-dark border">${paymentInfo?.irbmUniqueNo || 'N/A'}</span>
                </div>
            </div>
        </div>
    `;
}

// Helper function for formatting address from parts
function formatAddressFromParts(address) {
    if (!address) return 'N/A';
    
    const parts = [
        ...address.lines,
        address.city,
        address.postal,
        address.state,
        address.country
    ].filter(part => part && part !== 'N/A');
    
    return parts.length > 0 ? parts.join(', ') : 'N/A';
}

// Helper function for currency formatting
function formatCurrency(amount) {
    if (!amount || isNaN(amount)) return 'RM 0.00';
    return `RM ${parseFloat(amount).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing managers...');
    try {
        // Initialize invoice table using singleton
        const invoiceManager = InvoiceTableManager.getInstance();
        
        // Initialize date/time display
        DateTimeManager.updateDateTime();
        
        console.log('Managers initialized successfully');
    } catch (error) {
        console.error('Error initializing managers:', error);
        Swal.fire({
            icon: 'error',
            title: 'Initialization Error',
            text: 'Failed to initialize the application. Please refresh the page.',
            confirmButtonText: 'Refresh',
            showCancelButton: true,
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.reload();
            }
        });
    }
});

// Cleanup on page unload
window.addEventListener('unload', () => {
    if (window.invoiceTable) {
        window.invoiceTable.cleanup();
    }
});

async function loadPDF(uuid, documentData) {
    // Only proceed if document is Valid or Cancelled
    if (!['Valid', 'Cancelled'].includes(documentData.documentInfo.status)) {
        console.log('PDF generation skipped - document status:', documentData.documentInfo.status);
        return;
    }

    try {
        // Initial loading state with progress container
        $('.pdf-viewer-container').html(`
            <div class="d-flex flex-column align-items-center justify-content-center h-100">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div id="pdf-progress" class="text-center">
                    <p class="text-muted mb-2" id="pdf-main-status">Initializing PDF generation...</p>
                    <small class="text-muted d-block" id="pdf-status-message"></small>
                </div>
            </div>
        `);

        // Function to update both main status and detail message
        const updateStatus = (mainStatus, detailMessage = '') => {
            $('#pdf-main-status').text(mainStatus);
            $('#pdf-status-message').text(detailMessage);
        };

        updateStatus('Checking PDF status...', 'Looking for existing PDF file');

        // Try to get PDF
        const response = await fetch(`/api/lhdn/documents/${uuid}/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(documentData)
        });

        const data = await response.json();
        console.log('PDF response:', data);

        if (!data.success) {
            throw new Error(data.message || 'Failed to load PDF');
        }

        if (data.cached) {
            updateStatus('Loading cached PDF...', 'Using existing PDF from cache');
        } else {
            updateStatus('Generating new PDF...', 'This might take a few moments');
        }

        // Load the PDF
        const timestamp = new Date().getTime();
        const pdfUrl = `${data.url}?t=${timestamp}`;
        
        // Show final status before loading PDF viewer
        updateStatus(data.message || 'Loading PDF viewer...', 'Almost done');

        // Short delay to show the final status message
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Create iframe for PDF
        $('.pdf-viewer-container').html(`
            <iframe id="pdfViewer" class="w-100 h-100" style="border: none;" src="${pdfUrl}"></iframe>
        `);

    } catch (error) {
        console.error('Error loading PDF:', error);
        $('.pdf-viewer-container').html(`
            <div class="alert alert-danger m-3">
                <i class="bi bi-exclamation-triangle me-2"></i>
                Failed to load PDF: ${error.message}
                <button class="btn btn-outline-danger btn-sm ms-3" onclick="loadPDF('${uuid}', ${JSON.stringify(documentData)})">
                    <i class="bi bi-arrow-clockwise me-1"></i>Retry
                </button>
            </div>
        `);
    }
}

async function openValidationResultsModal(uuid) {
    try {
        // Show loading state
        Swal.fire({
            title: 'Loading...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch(`/api/lhdn/documents/${uuid}/display-details`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to fetch validation results');
        }

        Swal.close();

        // Get the validation results container
        const validationResultsDiv = document.getElementById("validationResults");
        if (!validationResultsDiv) {
            throw new Error('Validation results container not found');
        }
        validationResultsDiv.innerHTML = "";

        // Extract validation results from the response
        const data = result.data || result;
        const validationResults = data.documentInfo?.validationResults;

        console.log('Validation Results:', validationResults);

        if (!validationResults || !validationResults.validationSteps) {
            validationResultsDiv.innerHTML = `
                <div class="lhdn-validation-message error">
                    <i class="bi bi-exclamation-circle-fill"></i>
                    <span>No validation results available</span>
                </div>`;
            return;
        }

        // Add validation steps to the accordion
        validationResults.validationSteps.forEach((step, index) => {
            const stepDiv = document.createElement("div");
            stepDiv.classList.add("lhdn-validation-step");
            const isValid = step.status === "Valid";
            const statusClass = isValid ? "lhdn-step-valid" : "lhdn-step-invalid";
            const statusIcon = isValid ? "check-circle-fill" : "x-circle-fill";
            const cleanedName = step.name
                .replace(/Step[- ]?\d+/, "")
                .trim()
                .replace(/^[\.\-\s]+|[\.\-\s]+$/g, "");

            // Get all errors from the step
            const errors = step.error?.errors || [];
            const allInnerErrors = errors.length > 0 ? 
                errors.reduce((acc, err) => {
                    if (err.innerError && Array.isArray(err.innerError)) {
                        acc.push(...err.innerError);
                    }
                    return acc;
                }, []) : 
                (step.error?.innerError || []);

            stepDiv.innerHTML = `
                <div class="lhdn-step-header ${statusClass}" data-bs-toggle="collapse" data-bs-target="#collapse${index}">
                    <div class="lhdn-step-title">
                        <i class="bi bi-${statusIcon}"></i>
                        <span>${cleanedName}</span>
                        ${!isValid ? `<span class="error-count">(${allInnerErrors.length} ${allInnerErrors.length === 1 ? 'error' : 'errors'})</span>` : ''}
                    </div>
                    <div class="lhdn-step-status">
                        ${isValid ? 'Valid' : 'Invalid'}
                    </div>
                </div>
                <div id="collapse${index}" class="lhdn-step-content collapse ${!isValid ? 'show' : ''}">
                    ${
                        !isValid && allInnerErrors.length > 0
                            ? `
                                <div class="lhdn-validation-message">
                                    ${allInnerErrors.map((err, i) => `
                                        ${i > 0 ? '<div class="lhdn-inner-error mt-3">' : ''}
                                        <div class="lhdn-error-location">
                                            <strong>Field:</strong> 
                                            <span class="text-break">${ValidationTranslations.getFieldName(err.propertyPath)}</span>
                                        </div>
                                        <div class="lhdn-error-message">
                                            <strong>Issue:</strong> 
                                            <span class="text-break">${ValidationTranslations.getErrorMessage(err.error)}</span>
                                        </div>
                                        <div class="lhdn-error-code">
                                            <strong>Error Type:</strong> 
                                            <span>${ValidationTranslations.getErrorType(err.errorCode)}</span>
                                        </div>
                                        ${i > 0 ? '</div>' : ''}
                                    `).join('')}
                                    ${allInnerErrors.length > 1 ? `
                                        <div class="error-summary mt-4">
                                            <div class="alert alert-danger">
                                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                                <strong>Found ${allInnerErrors.length} validation issues in this step.</strong> Please fix all issues to proceed.
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            `
                            : (!isValid ? `
                                <div class="lhdn-validation-message">
                                    <div class="alert alert-danger mb-3">
                                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                        <strong>Validation Error:</strong> Please fix the following issue to proceed.
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong>Issue:</strong> 
                                        <span class="text-break text-danger">${ValidationTranslations.getErrorMessage(step.error?.error)}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong>Error Type:</strong> 
                                        <span class="text-danger">${ValidationTranslations.getErrorType(step.error?.errorCode)}</span>
                                    </div>
                                </div>
                            ` : '<div class="lhdn-validation-success"><i class="bi bi-check-circle-fill"></i>No errors found</div>')
                    }
                </div>
            `;
            validationResultsDiv.appendChild(stepDiv);
        });

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('validationResultsModal'));
        
        // Add event listener for modal close
        const modalElement = document.getElementById('validationResultsModal');
        modalElement.addEventListener('hidden.bs.modal', function (e) {
            // Remove modal-specific classes and backdrop
            document.body.classList.remove('modal-open');
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }
            
            // Prevent event from bubbling up
            e.stopPropagation();
            
            // Adjust columns without redrawing the table
            if (inboundDataTable) {
                inboundDataTable.columns.adjust().draw(false);
            }
        }, { once: true });

        modal.show();

    } catch (error) {
        console.error('Error opening validation results:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: `Failed to load validation results: ${error.message}`
        });
    }
}
