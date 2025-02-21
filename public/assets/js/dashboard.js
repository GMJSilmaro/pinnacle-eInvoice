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
  });
  
  async function fetchInitialData() {
    try {
      const response = await fetch('/api/dashboard/stats');
      const data = await response.json();
      
      // Safely update elements
      const updateElement = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
          element.innerText = value;
        }
      };
  
      updateElement('fileCount', data.fileCount || 0);
      updateElement('inboundCount', data.inboundCount || 0);
      updateElement('companyCount', data.companyCount || 0);
      
    } catch (error) {
      console.error('Error fetching initial data:', error);
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
      try {
          // Show loading state
          document.getElementById('fileCount').textContent = '...';
          document.getElementById('inboundCount').textContent = '...';
          document.getElementById('companyCount').textContent = '...';
  
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
  
      } catch (error) {
          console.error('Error updating dashboard stats:', error);
          // Show error state
          document.getElementById('fileCount').textContent = '-';
          document.getElementById('inboundCount').textContent = '-';
          document.getElementById('companyCount').textContent = '-';
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
  
  // Initialize dashboard when page loads
  document.addEventListener('DOMContentLoaded', function() {
     
  
      // Initialize the chart first
      initStackedBarChart();
      
      // Then fetch and update the data
      updateDashboardStats();
      
      // Show help guide popup
      setTimeout(showHelpGuidePopup, 1000);
      
      // Update stats every 5 minutes
      setInterval(updateDashboardStats, 5 * 60 * 1000);
  });
  
  // Add this to make closeHelpGuide available globally
  window.closeHelpGuide = closeHelpGuide;