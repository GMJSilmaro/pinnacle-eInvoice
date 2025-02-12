// Toast Manager Class
class ToastManager {
    static container = null;

    static init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'custom-toast-container';
            document.body.appendChild(this.container);
        }
    }

    static show(message, type = 'success') {
        this.init();

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `custom-toast ${type}`;
        
        // Create icon
        const icon = document.createElement('div');
        icon.className = `custom-toast-icon ${type}`;
        icon.innerHTML = type === 'success' 
            ? '<i class="bi bi-check-circle-fill"></i>'
            : '<i class="bi bi-x-circle-fill"></i>';
        
        // Create message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'custom-toast-message';
        messageDiv.textContent = message;
        
        // Assemble toast
        toast.appendChild(icon);
        toast.appendChild(messageDiv);
        this.container.appendChild(toast);
        
        // Remove toast after delay
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.2s ease-in-out forwards';
            setTimeout(() => toast.remove(), 200);
        }, 1500);
    }
}

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
                    className: 'outbound-checkbox-column',
                    defaultContent: `
                        <div class="outbound-checkbox-header">
                            <input type="checkbox" class="outbound-checkbox row-checkbox">
                        </div>`
                },
                {
                    data: 'uuid',
                    className: 'inbound-uuid-column',
                    render: function(data) {
                        return `
                            <div class="flex flex-col">
                                <div class="flex items-center gap-2">
                                    <a href="#" class="inbound-badge-status text-truncate copy-uuid" 
                                       data-bs-toggle="tooltip" 
                                       data-bs-placement="top" 
                                       title="${data}" 
                                       data-uuid="${data}"
                                       style="max-width: 180px; overflow: hidden; text-overflow: ellipsis;">
                                        ${data}
                                    </a>
                                </div>
                            </div>`;
                    }
                },
                {
                    data: 'internalId',
                    title: 'INTERNAL ID',
                    className: 'inbound-invoice-column',
                    render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                },
          
                {
                    data: 'supplierName',
                    title: 'SUPPLIER',
                    className: 'inbound-supplier-column',
                   render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                },
                {
                    data: 'receiverName',
                    title: 'RECEIVER',
                    className: 'inbound-buyer-column',
                    render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                },
                {
                    data: null,
                    className: 'inbound-date-column',
                    title: 'ISSUE DATE',
                    render: function(data, type, row) {
                        return this.renderDateInfo(row.dateTimeIssued);
                    }.bind(this)
                },
                {
                    data: null,
                    className: 'inbound-date-column',
                    title: 'RECEIVED DATE',
                    render: function(data, type, row) {
                        return this.renderDateInfo(row.dateTimeReceived);
                    }.bind(this)
                },
                {
                    data: 'status',
                    className: 'inbound-status-column',
                    render: function(data) {
                        const statusClass = data.toLowerCase();
                        const icons = {
                            valid: 'check-circle-fill',
                            invalid: 'x-circle-fill',
                            pending: 'hourglass-split',
                            rejected: 'x-circle-fill',
                            cancelled: 'x-circle-fill'
                        };
                        const statusColors = {
                            valid: '#198754',
                            invalid: '#dc3545',
                            pending: '#ff8307',
                            rejected: '#dc3545',
                            cancelled: '#ffc107'
                        };
                        const icon = icons[statusClass] || 'question-circle';
                        const color = statusColors[statusClass];

                        return `
                            <span class="inbound-status ${statusClass}" 
                                  style="display: inline-flex; align-items: center; gap: 6px; 
                                         padding: 6px 12px; border-radius: 6px; 
                                         background: ${color}15; color: ${color}; 
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>${data}
                            </span>`;
                    }
                },
                {
                    data: 'submissionChannel',
                    title: 'SOURCE',
                    className: 'inbound-source-column',
                    render: data => this.renderSource(data)
                },
                {
                    data: 'totalSales',
                    title: 'TOTAL SALES',
                    className: 'inbound-amount-column',
                    render: data => `<span class="text-nowrap">MYR ${parseFloat(data || 0).toLocaleString('en-MY', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    })}</span>`
                },
                {
                    data: null,
                    className: 'inbound-action-column',
                    orderable: false,
                    render: function(row) {
                        return `
                            <button class="outbound-action-btn submit" 
                                    onclick="viewInvoiceDetails('${row.uuid}')"
                                    data-uuid="${row.uuid}">
                                <i class="bi bi-eye me-1"></i>View
                            </button>`;
                    }
                }
            ],
           
            scrollX: true,
            scrollCollapse: true,
            autoWidth: false,
            pageLength: 10,
            dom: '<"inbound-controls"<"inbound-length-control"l><"inbound-search-control"f>>rt<"inbound-bottom"<"inbound-info"i><"inbound-pagination"p>>',
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

    renderInvoiceNumber(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';
        
        // Get document type icon based on type
        const getDocTypeIcon = (docType) => {
            const icons = {
                'Invoice 1.0': 'receipt',
                'Credit Note 1.0': 'arrow-return-left',
                'Debit Note 1.0': 'arrow-return-right',
                'Refund Note 1.0': 'cash-stack'
            };
            return icons[docType] || 'file-text';
        };

        // Get document type color based on type
        const getDocTypeColor = (docType) => {
            const colors = {
                'Invoice 1.0': '#0d6efd',
                'Credit Note 1.0': '#198754',
                'Debit Note 1.0': '#dc3545',
                'Refund Note 1.0': '#6f42c1'
            };
            return colors[docType] || '#6c757d';
        };

        const docType = 'Invoice ' + row.typeVersionName || 'Invoice 1.0';
        const docTypeIcon = getDocTypeIcon(docType);
        const docTypeColor = getDocTypeColor(docType);

        return `
            <div class="invoice-info-wrapper" style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
                <div class="invoice-main" style="display: flex; align-items: center; gap: 12px;">
                    
                </div>
                <div class="invoice-number" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 500;
                    color: #2c3345;
                    padding-left: 0;
                ">
                    <i class="bi bi-hash text-primary"></i>
                    <span class="invoice-text" title="${data}" style="
                        max-width: 180px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${data}</span>
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

    renderDateInfo(dateString) {
        if (!dateString) return '<span class="text-muted">N/A</span>';
        
        const date = new Date(dateString);
        
        // Format date parts
        const day = date.getDate().toString().padStart(2, '0');
        const month = date.toLocaleString('en-US', { month: 'short' });
        const year = date.getFullYear();
        const time = date.toLocaleString('en-US', { 
            hour: '2-digit',
            minute: '2-digit',
            hour12: true 
        });

        return `
            <div class="date-info-wrapper" style="
                display: flex;
                flex-direction: column;
                gap: 4px;
            ">
                <div class="date-main" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #2c3345;
                    font-weight: 500;
                ">
                    <i class="bi bi-calendar3 text-primary"></i>
                    <span>${day} ${month} ${year}</span>
                </div>
                <div class="time-info" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #6c757d;
                    font-size: 0.85em;
                ">
                    <i class="bi bi-clock text-secondary"></i>
                    <span>${time}</span>
                </div>
            </div>
        `;
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

    renderSource(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        return `<span class="badge-source ${data.toLowerCase()}">LHDN</span>`;
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
                    ToastManager.show('Successfully fetched fresh data from LHDN', 'success');
                }, 1000);

            } catch (error) {
                console.error('Error refreshing LHDN data:', error);
                
                // Show error in modal
                document.getElementById('loadingStatus').textContent = 'Oops! Something went wrong.';
                document.getElementById('loadingDetails').textContent = 'Please try again in a few moments.';
                
                // Close modal after error message
                setTimeout(() => {
                    bootstrap.Modal.getInstance(document.getElementById('loadingModal')).hide();
                    
                    // Show error toast
                    ToastManager.show('Unable to fetch fresh data from LHDN. Please try again.', 'error');
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
                ToastManager.show('Please select at least one record to export', 'error');
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
            ToastManager.show(`Successfully exported ${selectedRows.length} records`, 'success');

        } catch (error) {
            console.error('Export error:', error);
            ToastManager.show('Failed to export selected records', 'error');
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
        this.table.on('click', '.copy-uuid', (e) => {
            e.preventDefault();
            const uuid = $(e.currentTarget).data('uuid');
            const tooltipInstance = bootstrap.Tooltip.getInstance(e.currentTarget);
            
            navigator.clipboard.writeText(uuid).then(() => {
                // Hide tooltip if it exists
                if (tooltipInstance) {
                    tooltipInstance.hide();
                }
                
                // Show success message using our custom toast
                ToastManager.show('UUID copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Failed to copy:', err);
                ToastManager.show('Failed to copy UUID', 'error');
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
        const response = await fetch(`/api/lhdn/documents/${uuid}/xml-pdf`, {
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

            const contentId = `collapse${index}`;
            stepDiv.innerHTML = `
                <div class="lhdn-step-header ${statusClass}" data-bs-toggle="collapse" data-bs-target="#${contentId}" aria-expanded="${!isValid}" aria-controls="${contentId}">
                    <div class="lhdn-step-title">
                        <i class="bi bi-${statusIcon}"></i>
                        <span>${cleanedName}</span>
                        ${!isValid ? `<span class="error-count">(${allInnerErrors.length} ${allInnerErrors.length === 1 ? 'error' : 'errors'})</span>` : ''}
                    </div>
                    <div class="lhdn-step-status">
                        ${isValid ? 'Valid' : 'Invalid'}
                        <i class="bi bi-chevron-down ms-2"></i>
                    </div>
                </div>
                <div id="${contentId}" class="lhdn-step-content collapse ${!isValid ? 'show' : ''}" aria-labelledby="heading${index}">
                    ${
                        !isValid && allInnerErrors.length > 0
                            ? `
                                <div class="lhdn-validation-message">
                                    ${allInnerErrors.map((err, i) => `
                                        ${i > 0 ? '<div class="lhdn-inner-error mt-3">' : ''}
                                     <div class="lhdn-error-location">
                                        <strong class="lhdn-step-error">Field:</strong> 
                                        <span class="lhdn-step-error">${ValidationTranslations.getFieldName(err.propertyPath)}</span>
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong class="lhdn-step-error">Issue:</strong> 
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorMessage(err.error)}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong class="lhdn-step-error">Error Type:</strong> 
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(err.errorCode)}</span>
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
                                        <span class="text-break lhdn-step-error">${ValidationTranslations.getErrorMessage(step.error?.error)}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong>Error Type:</strong> 
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(step.error?.errorCode)}</span>
                                    </div>
                                </div>
                            ` : '<div class="lhdn-validation-success"><i class="bi bi-check-circle-fill"></i>No errors found</div>')
                    }
                </div>
            `;
            validationResultsDiv.appendChild(stepDiv);

            // Initialize collapse functionality
            const collapseElement = document.getElementById(contentId);
            if (collapseElement) {
                new bootstrap.Collapse(collapseElement, {
                    toggle: !isValid
                });
            }
        });

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('validationResultsModal'));
        
        // Add event listener for modal show
        const modalElement = document.getElementById('validationResultsModal');
        modalElement.addEventListener('shown.bs.modal', function () {
            // Reinitialize all collapses after modal is shown
            validationResultsDiv.querySelectorAll('.collapse').forEach(collapse => {
                bootstrap.Collapse.getInstance(collapse)?.dispose();
                new bootstrap.Collapse(collapse, {
                    toggle: collapse.classList.contains('show')
                });
            });
        });

        // Add event listener for modal close
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
