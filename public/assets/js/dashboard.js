document.addEventListener('DOMContentLoaded', async () => {
    
    // Add event listeners
    document.getElementById('outbound-today')?.addEventListener('click', () => filterData('outbound', 'today'));
    document.getElementById('outbound-this-month')?.addEventListener('click', () => filterData('outbound', 'this-month'));
    document.getElementById('outbound-this-year')?.addEventListener('click', () => filterData('outbound', 'this-year'));
    document.getElementById('inbound-today')?.addEventListener('click', () => filterData('inbound', 'today'));
    document.getElementById('inbound-this-month')?.addEventListener('click', () => filterData('inbound', 'this-month'));
    document.getElementById('inbound-this-year')?.addEventListener('click', () => filterData('inbound', 'this-year'));
  
    // Fetch initial data only if not already fetched
    if (!sessionStorage.getItem('initialDataFetched')) {
      await fetchInitialData();
      sessionStorage.setItem('initialDataFetched', 'true');
    }

    initializeTooltips();

    // Initialize TIN search modal
    tinSearchModal = new bootstrap.Modal(document.getElementById('tinSearchModal'));
    
    // Add event listener for search type change
    document.getElementById('searchType')?.addEventListener('change', function(e) {
        const nameSearch = document.getElementById('nameSearch');
        const idSearch = document.getElementById('idSearch');
        
        if (e.target.value === 'name') {
            nameSearch.style.display = 'block';
            idSearch.style.display = 'none';
        } else {
            nameSearch.style.display = 'none';
            idSearch.style.display = 'block';
        }
    });

    // Add event listener for ID type change
    document.getElementById('idType')?.addEventListener('change', function(e) {
        const idValueExample = document.getElementById('idValueExample');
        const examples = {
            'BRN': '201901234567',
            'NRIC': '770625015324',
            'PASSPORT': 'A12345678',
            'ARMY': '551587706543'
        };
        
        if (e.target.value && examples[e.target.value]) {
            idValueExample.textContent = `Example: ${examples[e.target.value]} (${e.target.value})`;
        } else {
            idValueExample.textContent = 'Please select an ID type';
        }
    });
  });
  
  function showLoadingState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add('is-loading');
      element.classList.remove('no-data');
    }
  }
  
  function showNoDataState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove('is-loading');
      element.classList.add('no-data');
    }
  }
  
  function hideLoadingState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove('is-loading');
      element.classList.remove('no-data');
    }
  }
  
  async function fetchInitialData() {
    showLoadingState('stats-cards');
    
    try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        
        if (!data || (!data.fileCount && !data.inboundCount && !data.companyCount)) {
            showNoDataState('stats-cards');
            return;
        }

        // Safely update elements
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.innerText = value || '0';
            }
        };

        updateElement('fileCount', data.fileCount);
        updateElement('inboundCount', data.inboundCount);
        updateElement('companyCount', data.companyCount);
        
        hideLoadingState('stats-cards');
    } catch (error) {
        console.error('Error fetching initial data:', error);
        showNoDataState('stats-cards');
    }
  }
  
  async function filterData(type, period) {
    try {
      const url = type === 'outbound' 
        ? `/api/outbound-files/count?period=${period}`
        : `/api/inbound-status/count?period=${period}`;
  
      const response = await fetch(url);
      const data = await response.json();
  
      const element = type === 'outbound' 
        ? document.getElementById('fileCount')
        : document.querySelector('#totalCount');
  
      if (element) {
        element.innerText = data.count || '0';
      }
    } catch (error) {
      console.error(`Error fetching ${type} data for ${period}:`, error);
      const element = type === 'outbound'
        ? document.getElementById('fileCount')
        : document.querySelector('#totalCount');
      if (element) {
        element.innerText = 'Error';
      }
    }
  }
  
  // Fetch and update dashboard statistics
  async function updateDashboardStats() {
    showLoadingState('stackedBarChart');
    
    try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Failed to fetch statistics');
        }

        // Update card counts
        requestAnimationFrame(() => {
            document.getElementById('fileCount').textContent = data.stats.outbound || '0';
            document.getElementById('inboundCount').textContent = data.stats.inbound || '0';
            document.getElementById('companyCount').textContent = data.stats.companies || '0';
        });

        // Check if there's chart data
        const hasChartData = Object.values(data.stats).some(stat => 
            Array.isArray(stat) && stat.length > 0
        );

        if (!hasChartData) {
            showNoDataState('stackedBarChart');
            return;
        }

        // Initialize chart data for Monday to Saturday
        const chartData = {
            valid: new Array(6).fill(0),    // Green
            invalid: new Array(6).fill(0),   // Orange
            rejected: new Array(6).fill(0),  // Red
            cancelled: new Array(6).fill(0), // Purple
            pending: new Array(6).fill(0),   // Blue
            queue: new Array(6).fill(0)      // Dark Gray
        };

        // Helper function to get day index (0 = Monday, 5 = Saturday)
        function getDayIndex(dateStr) {
            const date = new Date(dateStr);
            let day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
            return day === 0 ? 5 : day - 1; // Convert to 0 = Monday, ..., 5 = Saturday
        }

        // Process outbound stats (pending, submitted)
        if (Array.isArray(data.stats.outboundStats)) {
            data.stats.outboundStats.forEach(stat => {
                if (!stat.date) return;
                
                const dayIndex = getDayIndex(stat.date);
                if (dayIndex < 0 || dayIndex > 5) return; // Skip invalid days
                
                const status = stat.status?.toLowerCase() || '';
                const count = parseInt(stat.count) || 0;
                
                // Map outbound statuses
                switch(status) {
                    case 'pending':
                        chartData.pending[dayIndex] += count;
                        break;
                    case 'submitted':
                        chartData.valid[dayIndex] += count;
                        break;
                    case 'queue':
                        chartData.queue[dayIndex] += count;
                        break;
                }
            });
        }

        // Process inbound stats (valid, invalid, cancelled, rejected)
        if (Array.isArray(data.stats.inboundStats)) {
            data.stats.inboundStats.forEach(stat => {
                if (!stat.date) return;
                
                const dayIndex = getDayIndex(stat.date);
                if (dayIndex < 0 || dayIndex > 5) return; // Skip invalid days
                
                const status = stat.status?.toLowerCase() || '';
                const count = parseInt(stat.count) || 0;
                
                // Map inbound statuses
                switch(status) {
                    case 'valid':
                    case 'validated':
                        chartData.valid[dayIndex] += count;
                        break;
                    case 'invalid':
                    case 'failed validation':
                        chartData.invalid[dayIndex] += count;
                        break;
                    case 'cancelled':
                    case 'cancel request':
                        chartData.cancelled[dayIndex] += count;
                        break;
                    case 'rejected':
                    case 'reject request':
                        chartData.rejected[dayIndex] += count;
                        break;
                }
            });
        }

        // Get current week's dates
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() - today.getDay() + 1);
        
        const dates = Array.from({length: 6}, (_, i) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            return date.toISOString().split('T')[0];
        });

        // Update chart using stackbar.js functions
        requestAnimationFrame(() => {
            updateChartData(dates, chartData);
        });

        hideLoadingState('stackedBarChart');
    } catch (error) {
        console.error('Error updating dashboard stats:', error);
        showNoDataState('stackedBarChart');
    }
  }
  
  // Show help guide popup
  function showHelpGuidePopup() {
      // Get current date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      const lastShown = localStorage.getItem('helpGuideLastShown');
      const shownThisSession = sessionStorage.getItem('helpGuideShown');
  
      // Show if:
      // 1. Never shown before, OR
      // 2. Last shown date is not today, OR
      // 3. New session (server reset) and not shown in this session
      if (!lastShown || lastShown !== today || (!shownThisSession && !sessionStorage.getItem('helpGuideShown'))) {
          const popupHtml = `
              <div class="help-guide-popup" id="helpGuidePopup">
                  <div class="help-guide-content">
                      <i class="fas fa-lightbulb" style="color: #f59e0b; font-size: 2rem; margin-bottom: 1rem;"></i>
                      <h3>Welcome to</h3>
                      <h2>Pinnacle e-Invoice Solution</h2>
                      <h3>LHDN Middleware</h3>
                      <p>Need help getting started? Check out our Help & Support page for:</p>
                      <ul>
                          <li><i class="fas fa-check-circle"></i> Step-by-step setup guide</li>
                          <li><i class="fas fa-check-circle"></i> Feature tutorials</li>
                          <li><i class="fas fa-check-circle"></i> FAQ section</li>
                          <li><i class="fas fa-check-circle"></i> Support contact information</li>
                      </ul>
                      <div class="help-guide-actions">
                          <button onclick="window.location.href='/help'" class="btn-view-help">View Help Page</button>
                          <button onclick="closeHelpGuide()" class="btn-close-help">Maybe Later</button>
                          <label class="dont-show-today">
                              <input type="checkbox" id="dontShowToday" />
                              Don't show again today
                          </label>
                      </div>
                  </div>
              </div>
          `;
  
          // Insert popup into the DOM
          document.body.insertAdjacentHTML('beforeend', popupHtml);
  
          // Add styles
          const styles = `
              <style>
                  .help-guide-popup {
                      position: fixed;
                      top: 0;
                      left: 0;
                      right: 0;
                      bottom: 0;
                      background: rgba(0, 0, 0, 0.5);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      z-index: 1000;
                      animation: fadeIn 0.3s ease;
                  }
  
                  .help-guide-content {
                      background: white;
                      padding: 2rem;
                      border-radius: 16px;
                      max-width: 500px;
                      width: 90%;
                      text-align: center;
                      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                      animation: slideUp 0.3s ease;
                  }
  
                  .help-guide-content h3 {
                      color: #1e293b;
                      font-size: 1.5rem;
                      margin-bottom: 1rem;
                  }
  
                  .help-guide-content p {
                      color: #64748b;
                      margin-bottom: 1.5rem;
                  }
  
                  .help-guide-content ul {
                      list-style: none;
                      padding: 0;
                      margin: 0 0 1.5rem 0;
                      text-align: left;
                  }
  
                  .help-guide-content ul li {
                      color: #475569;
                      margin-bottom: 0.75rem;
                      display: flex;
                      align-items: center;
                      gap: 0.5rem;
                  }
  
                  .help-guide-content ul li i {
                      color: #10b981;
                  }
  
                  .help-guide-actions {
                      display: flex;
                      flex-direction: column;
                      gap: 1rem;
                      align-items: center;
                  }
  
                  .help-guide-actions > div {
                      display: flex;
                      gap: 1rem;
                  }
  
                  .btn-view-help {
                      background: #3b82f6;
                      color: white;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 8px;
                      font-weight: 500;
                      cursor: pointer;
                      transition: all 0.2s;
                  }
  
                  .btn-view-help:hover {
                      background: #2563eb;
                      transform: translateY(-1px);
                  }
  
                  .btn-close-help {
                      background: #f1f5f9;
                      color: #64748b;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 8px;
                      font-weight: 500;
                      cursor: pointer;
                      transition: all 0.2s;
                  }
  
                  .btn-close-help:hover {
                      background: #e2e8f0;
                  }
  
                  .dont-show-today {
                      font-size: 0.875rem;
                      color: #64748b;
                      display: flex;
                      align-items: center;
                      gap: 0.5rem;
                      cursor: pointer;
                      margin-top: 0.5rem;
                  }
  
                  .dont-show-today input {
                      cursor: pointer;
                  }
  
                  @keyframes fadeIn {
                      from { opacity: 0; }
                      to { opacity: 1; }
                  }
  
                  @keyframes slideUp {
                      from { transform: translateY(20px); opacity: 0; }
                      to { transform: translateY(0); opacity: 1; }
                  }
  
                  @keyframes fadeOut {
                      from { opacity: 1; }
                      to { opacity: 0; }
                  }
              </style>
          `;
  
          // Add styles to head
          document.head.insertAdjacentHTML('beforeend', styles);
  
          // Mark as shown for this session
          sessionStorage.setItem('helpGuideShown', 'true');
      }
  }
  
  // Close help guide popup
  function closeHelpGuide() {
      const popup = document.getElementById('helpGuidePopup');
      if (popup) {
          // Check if "Don't show today" is checked
          const dontShowToday = document.getElementById('dontShowToday')?.checked;
          if (dontShowToday) {
              // Store today's date
              const today = new Date().toISOString().split('T')[0];
              localStorage.setItem('helpGuideLastShown', today);
          }
  
          popup.style.animation = 'fadeOut 0.3s ease';
          setTimeout(() => popup.remove(), 300);
      }
  }
  

async function updateAnalytics() {
    showLoadingState('invoice-status');
    showLoadingState('customer-list');
    showLoadingState('system-status');
    try {
        // Fetch Invoice Status
        const invoiceStatusResponse = await fetch('/api/dashboard-analytics/invoice-status');
        const invoiceStatusData = await invoiceStatusResponse.json();
        
        if (!invoiceStatusData || invoiceStatusData.length === 0) {
            showNoDataState('invoice-status');
        } else {
            hideLoadingState('invoice-status');
            // Update Invoice Status UI
            invoiceStatusData.forEach(status => {
                const percentage = Math.round(status.percentage) || 0;
                const count = status.count || 0;
                
                const statusKey = status.status.toLowerCase();
                const progressBar = document.querySelector(`.progress-bar[data-status="${statusKey}"]`);
                const percentageSpan = document.querySelector(`.percentage[data-status="${statusKey}"]`);
                const countSpan = document.querySelector(`.count[data-status="${statusKey}"]`);
                
                if (progressBar) {
                    progressBar.style.width = `${percentage}%`;
                    // Add color classes based on status
                    progressBar.className = `progress-bar ${getStatusColorClass(statusKey)}`;
                }
                if (percentageSpan) {
                    percentageSpan.textContent = `${percentage}%`;
                }
                if (countSpan) {
                    countSpan.textContent = count;
                }
            });
        }

        // Fetch System Status with error handling
        const systemStatusResponse = await fetch('/api/dashboard-analytics/system-status');
        if (!systemStatusResponse.ok) {
            throw new Error(`HTTP error! status: ${systemStatusResponse.status}`);
        }
        const systemStatusData = await systemStatusResponse.json();
        
        // Update System Status UI
        const apiStatusElement = document.getElementById('apiStatus');
        console.log(systemStatusData);
        if (apiStatusElement) {
            const statusClass = systemStatusData.apiHealthy ? 'bg-success' : 'bg-secondary';
            apiStatusElement.className = `badge ${statusClass}`;
            apiStatusElement.innerHTML = `
                <i class="fas fa-${systemStatusData.apiHealthy ? 'check-circle' : 'exclamation-circle'} me-1"></i>
                ${systemStatusData.apiStatus}
            `;
        }
        
        const queueCountElement = document.getElementById('queueCount');
        if (queueCountElement) {
            queueCountElement.textContent = `${systemStatusData.queueCount || 0} Total Queue`;
        }
        
        const lastSyncElement = document.getElementById('lastSync');
        if (lastSyncElement && systemStatusData.lastSync) {
            const lastSyncTime = new Date(systemStatusData.lastSync);
            const timeDiff = Math.round((Date.now() - lastSyncTime.getTime()) / 60000);
            lastSyncElement.textContent = `${timeDiff} mins ago`;
        }

        // Fetch Top Customers with error handling
        const topCustomersResponse = await fetch('/api/dashboard-analytics/top-customers');
        if (!topCustomersResponse.ok) {
            throw new Error(`HTTP error! status: ${topCustomersResponse.status}`);
        }
        const topCustomersData = await topCustomersResponse.json();
        
        if (!topCustomersData || topCustomersData.length === 0) {
            showNoDataState('customer-list');
        } else {
            hideLoadingState('customer-list');
            // Update Top Customers UI
            const customerList = document.querySelector('.customer-list');
            if (customerList && Array.isArray(topCustomersData)) {
                customerList.innerHTML = topCustomersData.map(customer => `
                    <div class="d-flex align-items-center mb-3 p-2 rounded customer-item">
                        <div class="customer-avatar me-3">
                            <div class="avatar-wrapper">
                                <img src="${customer.CompanyImage || '/assets/img/customers/default-logo.png'}"
                                    alt="${customer.CompanyName}"
                                    class="customer-logo"
                                    onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                <div class="avatar-fallback">
                                    <span>${(customer.CompanyName || '').substring(0, 2).toUpperCase()}</span>
                                </div>
                            </div>
                        </div>
                        <div class="customer-info flex-grow-1">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="mb-0 customer-name">${customer.CompanyName || 'Unknown Company'}</h6>
                                <span class="badge ${customer.ValidStatus === '1' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}">
                                    ${customer.ValidStatus === '1' ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center mt-1">
                                <small class="text-muted">
                                    <i class="fas fa-file-invoice me-1"></i>${customer.invoiceCount || 0} Invoices
                                </small>
                                <span class="fw-semibold text-secondary">
                                    MYR ${Number(customer.totalAmount || 0).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

    } catch (error) {
        console.error('Error updating analytics:', error);
        showNoDataState('invoice-status');
        showNoDataState('customer-list');
    }
}

// Add helper function for status colors
function getStatusColorClass(status) {
    const colorMap = {
        submitted: 'bg-primary',
        pending: 'bg-warning',
        valid: 'bg-success',
        invalid: 'bg-danger',
        cancelled: 'bg-secondary'
    };
    return colorMap[status] || 'bg-secondary';
}

// Function to update invoice status
async function updateInvoiceStatus() {
    try {
        const button = document.querySelector('.refresh-button .fa-sync-alt');
        button.style.animation = 'spin 1s linear';

        const response = await fetch('/api/dashboard-analytics/invoice-status');
        const data = await response.json();

        // Calculate total for percentage calculation
        const total = data.reduce((sum, status) => sum + (status.count || 0), 0);

        data.forEach(status => {
            const statusKey = status.status.toLowerCase();
            const count = status.count || 0;
            const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
            
            // Update progress bar
            const progressBar = document.querySelector(`.progress-bar[data-status="${statusKey}"]`);
            if (progressBar) {
                progressBar.style.width = `${percentage}%`;
                
                // Add animation class if percentage is significant
                if (percentage > 10) {
                    progressBar.classList.add('progress-bar-animated');
                } else {
                    progressBar.classList.remove('progress-bar-animated');
                }
            }

            // Update percentage/count text
            const percentageElement = document.querySelector(`.percentage[data-status="${statusKey}"]`);
            if (percentageElement) {
                percentageElement.textContent = `${count} document${count !== 1 ? 's' : ''}`;
            }
        });

        // Add subtle animation to the card
        const card = document.getElementById('invoice-status-card');
        card.classList.add('card-updated');
        setTimeout(() => {
            card.classList.remove('card-updated');
            button.style.animation = '';
        }, 1000);
    } catch (error) {
        console.error('Error updating invoice status:', error);
        const button = document.querySelector('.refresh-button .fa-sync-alt');
        button.style.animation = '';
    }
}

// Function to update system status
async function updateSystemStatus() {
    showLoadingState('system-status');
    
    try {
        const response = await fetch('/api/dashboard-analytics/system-status');
        const data = await response.json();

        if (!data) {
            showNoDataState('system-status');
            return;
        }

        hideLoadingState('system-status');
        // Update API Status with more details
        const apiStatus = document.getElementById('apiStatus');
        const apiLastCheck = document.getElementById('apiLastCheck');
        const apiEndpointUrl = document.getElementById('apiEndpointUrl');
        
        if (data.apiHealthy) {
            apiStatus.className = 'badge bg-success';
            apiStatus.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
        } else {
            apiStatus.className = 'badge bg-danger';
            apiStatus.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i>Connection Issues';
        }

        // Show environment info
        apiEndpointUrl.textContent = `Environment: ${data.environment || 'Production'}`;
        apiLastCheck.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;

        // Update Queue Status with details
        const queueCount = document.getElementById('queueCount');
        const queueDetails = document.getElementById('queueDetails');
        const queueProgressBar = document.getElementById('queueProgressBar');
        const queueStatusIndicator = document.getElementById('queueStatusIndicator');
        const queueLastUpdate = document.getElementById('queueLastUpdate');
        
        queueCount.textContent = `${data.queueCount} Queue`;
        queueLastUpdate.textContent = 'Just now';
        
        if (data.queueCount > 0) {
            // Calculate progress (this is just an example - adjust based on your actual data)
            const maxQueueSize = 20; // Example max queue size
            const progress = Math.min(100, Math.round((data.queueCount / maxQueueSize) * 100));
            
            // Update progress bar
            queueProgressBar.style.width = `${progress}%`;
            queueProgressBar.setAttribute('aria-valuenow', progress);
            
            // Update status based on queue size
            if (data.queueCount > 10) {
                queueCount.className = 'badge bg-danger text-white';
                queueStatusIndicator.className = 'ms-2 badge bg-danger-subtle text-danger';
                queueStatusIndicator.textContent = 'High Load';
            } else {
                queueCount.className = 'badge bg-info text-white';
                queueStatusIndicator.className = 'ms-2 badge bg-info-subtle text-info';
                queueStatusIndicator.textContent = 'Processing';
            }
            
            queueDetails.innerHTML = `<span class="text-info">Processing ${data.queueCount} document${data.queueCount !== 1 ? 's' : ''}</span>`;
        } else {
            // Empty queue
            queueCount.className = 'badge bg-success text-white';
            queueProgressBar.style.width = '0%';
            queueProgressBar.setAttribute('aria-valuenow', 0);
            queueStatusIndicator.className = 'ms-2 badge bg-success-subtle text-success';
            queueStatusIndicator.textContent = 'Ready';
            queueDetails.textContent = 'Queue is empty';
        }

        // Update Last Sync with enhanced status
        const lastSync = document.getElementById('lastSync');
        const syncStatus = document.getElementById('syncStatus');
        const syncDetails = document.getElementById('syncDetails');
        
        if (data.lastSync) {
            const timeDiff = Math.round((Date.now() - new Date(data.lastSync).getTime()) / 60000);
            lastSync.textContent = `${timeDiff} mins ago`;

            if (timeDiff < 60) {
                syncStatus.className = 'fas fa-circle ms-2 recent';
                syncDetails.innerHTML = '<span class="text-success">Sync is up to date</span>';
            } else if (timeDiff < 240) {
                syncStatus.className = 'fas fa-circle ms-2 warning';
                syncDetails.innerHTML = '<span class="text-warning">Sync is slightly delayed</span>';
            } else {
                syncStatus.className = 'fas fa-circle ms-2 danger';
                syncDetails.innerHTML = '<span class="text-danger">Sync needs attention</span>';
            }
        } else {
            lastSync.textContent = 'No sync data';
            syncStatus.className = 'fas fa-circle ms-2 danger';
            syncDetails.innerHTML = '<span class="text-danger">No synchronization data available</span>';
        }
        
        // Update Online Users
        const onlineUsers = document.getElementById('onlineUsers');
        const onlineUsersStatus = document.getElementById('onlineUsersStatus');
        const onlineUsersDetails = document.getElementById('onlineUsersDetails');
        
        if (data.onlineUsers !== undefined) {
            onlineUsers.textContent = data.onlineUsers;
            
            if (data.onlineUsers > 0) {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-success';
                onlineUsersDetails.textContent = `${data.onlineUsers} user${data.onlineUsers !== 1 ? 's' : ''} currently registered`;
            } else {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-warning';
                onlineUsersDetails.textContent = 'No users currently registered';
            }
        }
        
        // Add subtle animation to the card
        const card = document.getElementById('system-status-card');
        card.classList.add('card-updated');
        setTimeout(() => {
            card.classList.remove('card-updated');
        }, 1000);
    } catch (error) {
        console.error('Error updating system status:', error);
        hideLoadingState('system-status');
    }
}


async function refreshQueue() {
    try {
        const button = document.querySelector('.status-item button .fa-sync-alt');
        button.style.animation = 'spin 1s linear';

        const response = await fetch('/api/dashboard-analytics/refresh-queue');
        const data = await response.json();

        // Update Queue Status with details
        const queueCount = document.getElementById('queueCount');
        const queueDetails = document.getElementById('queueDetails');
        const queueProgressBar = document.getElementById('queueProgressBar');
        const queueStatusIndicator = document.getElementById('queueStatusIndicator');
        const queueLastUpdate = document.getElementById('queueLastUpdate');
        
        // Update last updated time
        queueLastUpdate.textContent = 'Just now';
        
        if (data && data.queueCount !== undefined) {
            queueCount.textContent = `${data.queueCount} Queue`;
            
            if (data.queueCount > 0) {
                // Calculate progress (this is just an example - adjust based on your actual data)
                const maxQueueSize = 20; // Example max queue size
                const progress = Math.min(100, Math.round((data.queueCount / maxQueueSize) * 100));
                
                // Update progress bar
                queueProgressBar.style.width = `${progress}%`;
                queueProgressBar.setAttribute('aria-valuenow', progress);
                
                // Update status based on queue size
                if (data.queueCount > 10) {
                    queueCount.className = 'badge bg-danger text-white';
                    queueStatusIndicator.className = 'ms-2 badge bg-danger-subtle text-danger';
                    queueStatusIndicator.textContent = 'High Load';
                } else {
                    queueCount.className = 'badge bg-info text-white';
                    queueStatusIndicator.className = 'ms-2 badge bg-info-subtle text-info';
                    queueStatusIndicator.textContent = 'Processing';
                }
                
                queueDetails.innerHTML = `<span class="text-info">Processing ${data.queueCount} document${data.queueCount !== 1 ? 's' : ''}</span>`;
            } else {
                // Empty queue
                queueCount.className = 'badge bg-success text-white';
                queueProgressBar.style.width = '0%';
                queueProgressBar.setAttribute('aria-valuenow', 0);
                queueStatusIndicator.className = 'ms-2 badge bg-success-subtle text-success';
                queueStatusIndicator.textContent = 'Ready';
                queueDetails.textContent = 'Queue is empty';
            }
            
            // Add subtle animation to the queue item
            const queueItem = button.closest('.status-item');
            queueItem.classList.add('card-updated');
            setTimeout(() => {
                queueItem.classList.remove('card-updated');
                button.style.animation = '';
            }, 1000);
        }
    } catch (error) {
        console.error('Error refreshing queue:', error);
        const button = document.querySelector('.status-item button .fa-sync-alt');
        if (button) button.style.animation = '';
    }
}



function initializeTooltips() {
    // Clean up any existing tooltips first
    const existingTooltips = document.querySelectorAll('.guide-tooltip');
    existingTooltips.forEach(tooltip => tooltip.remove());

    // Define tooltip content
    const tooltipContent = {
        'outbound-card': 'Track outbound e-invoices sent to LHDN for processing',
        'inbound-card': 'Monitor inbound e-invoices received from your suppliers',
        'companies-card': 'View all active companies in your network',
        'invoice-status-card': 'Real-time status distribution of your e-invoices',
        'system-status-card': 'Monitor LHDN system connectivity and queue status',
        'api-status': 'Shows current connection status with LHDN API',
        'queue-status': 'Displays number of documents waiting to be processed',
        'last-sync': 'Indicates when data was last synchronized with LHDN',
        'top-customers': 'View your most active customers based on transaction volume',
        'recent-activity': 'Track recent e-invoice related activities',
        'chart-section': 'Weekly breakdown of e-invoice processing status'
    };

    // Initialize Bootstrap tooltips with additional options
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    const tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl, {
            template: '<div class="tooltip guide-tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
            trigger: 'hover focus',
            container: 'body',
            animation: true,
            delay: { show: 200, hide: 100 }
        });
    });

    // Add global event listeners to handle tooltip cleanup
    document.addEventListener('scroll', hideAllTooltips, true);
    window.addEventListener('resize', hideAllTooltips);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideAllTooltips();
        }
    });

    // Hide tooltips when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.hasAttribute('data-bs-toggle')) {
            hideAllTooltips();
        }
    });
}

// Helper function to hide all tooltips
function hideAllTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.forEach(element => {
        const tooltip = bootstrap.Tooltip.getInstance(element);
        if (tooltip) {
            tooltip.hide();
        }
    });
}


async function updateOnlineUsers() {
    const onlineUsersElement = document.getElementById('onlineUsers');
    const onlineUsersStatus = document.getElementById('onlineUsersStatus');
    const onlineUsersDetails = document.getElementById('onlineUsersDetails');

    try {
        const response = await fetch('/api/dashboard-analytics/online-users');
        const data = await response.json();

        if (onlineUsersElement && data) {
            onlineUsersElement.textContent = data.total;
            
            // Update status indicator
            if (data.active > 0) {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-success';
                onlineUsersStatus.title = 'Users are currently registered';
            } else {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-secondary';
                onlineUsersStatus.title = 'No users currently registered';
            }

            // Update details text
            //onlineUsersDetails.textContent = `${data.total} total users`;
        }
    } catch (error) {
        console.error('Error updating online users:', error);
        if (onlineUsersElement) {
            onlineUsersElement.textContent = '--';
            onlineUsersStatus.className = 'fas fa-circle ms-2 text-danger';
            onlineUsersStatus.title = 'Error fetching online users';
            onlineUsersDetails.textContent = 'Unable to fetch online users';
        }
    }
}

window.addEventListener('beforeunload', function() {
    hideAllTooltips();
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.forEach(element => {
        const tooltip = bootstrap.Tooltip.getInstance(element);
        if (tooltip) {
            tooltip.dispose();
        }
    });
});

// Initialize and set up auto-refresh
document.addEventListener('DOMContentLoaded', function() {
    // Initialize loading states
    ['stats-cards', 'stackedBarChart', 'invoice-status', 'customer-list', 'system-status'].forEach(id => {
        showLoadingState(id);
    });

    // Initialize the chart
    initStackedBarChart();
    
    // Fetch initial data
    Promise.all([
        updateDashboardStats(),
        updateAnalytics(),
        updateSystemStatus(),
        updateOnlineUsers()
    ]).catch(error => {
        console.error('Error initializing dashboard:', error);
    });

    // Set up refresh intervals
    setInterval(updateSystemStatus, 30000);
    setInterval(updateInvoiceStatus, 120000);
    setInterval(updateDashboardStats, 5 * 60 * 1000);
    setInterval(updateOnlineUsers, 30000);

    // Show help guide popup
    setTimeout(showHelpGuidePopup, 1000);
});

window.closeHelpGuide = closeHelpGuide;

// TIN Search Modal Functions
let tinSearchModal;

function showTinSearchModal() {
    // Reset form and results
    document.getElementById('tinSearchForm').reset();
    document.getElementById('searchResult').style.display = 'none';
    document.getElementById('searchError').style.display = 'none';
    document.getElementById('idValueExample').textContent = 'Example: 201901234567 (BRN)';
    
    // Show modal
    tinSearchModal.show();
}

async function searchTIN() {
    const searchResult = document.getElementById('searchResult');
    const searchError = document.getElementById('searchError');
    const errorMessage = document.getElementById('errorMessage');
    const tinResult = document.getElementById('tinResult');
    
    // Hide previous results
    searchResult.style.display = 'none';
    searchError.style.display = 'none';
    
    try {
        const taxpayerName = document.getElementById('taxpayerName').value.trim();
        const idType = document.getElementById('idType').value;
        const idValue = document.getElementById('idValue').value.trim();
        
        // Validate inputs according to LHDN rules
        if (!taxpayerName && (!idType || !idValue)) {
            throw new Error('Please provide either Company Name or both ID Type and ID Value');
        }
        
        if (idType && !idValue) {
            throw new Error('Please enter an ID value');
        }
        
        if (idValue && !idType) {
            throw new Error('Please select an ID type');
        }
        
        // Prepare query parameters
        const params = new URLSearchParams();
        if (taxpayerName) params.append('taxpayerName', taxpayerName);
        if (idType) params.append('idType', idType);
        if (idValue) params.append('idValue', idValue);
        
        // Show loading state
        const searchButton = document.querySelector('#tinSearchModal .btn-primary');
        const originalText = searchButton.innerHTML;
        searchButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Searching...';
        searchButton.disabled = true;
        
        // Make API call
        const response = await fetch(`/api/dashboard-analytics/search-tin?${params}`);
        const data = await response.json();
        
        // Reset button state
        searchButton.innerHTML = originalText;
        searchButton.disabled = false;
        
        if (data.success && data.tin) {
            tinResult.textContent = data.tin;
            searchResult.style.display = 'block';
        } else {
            throw new Error(data.message || 'No TIN found for the given criteria');
        }
        
    } catch (error) {
        console.error('TIN search error:', error);
        errorMessage.textContent = error.message || 'Failed to search TIN';
        searchError.style.display = 'block';
        
        // Reset button state if error occurs during API call
        const searchButton = document.querySelector('#tinSearchModal .btn-primary');
        if (searchButton.disabled) {
            searchButton.innerHTML = '<i class="fas fa-search me-2"></i>Search';
            searchButton.disabled = false;
        }
    }
}