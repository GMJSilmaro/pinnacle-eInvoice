// Wrap everything in an IIFE to avoid global namespace pollution
(function() {
  // Reset DataTables request flags on page load to prevent conflicts
  window._dataTablesRequestInProgress = false;
  window._dataTablesRequestStartTime = null;

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Reset DataTables request flags again on DOM content loaded
      window._dataTablesRequestInProgress = false;
      window._dataTablesRequestStartTime = null;
      initializeNavbar();
    });
  } else {
    initializeNavbar();
  }

  // Idle timer configuration - increased to 30 minutes
  const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  const WARNING_TIMEOUT = 5 * 60 * 1000; // Show warning 5 minutes before timeout
  let idleTimer = null;
  let warningTimer = null;
  let lastActivity = Date.now();
  let isWarningShown = false;

  // Function to reset the idle timer
  function resetIdleTimer() {
    if (isWarningShown) {
      return; // Don't reset if warning is shown
    }

    lastActivity = Date.now();
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
    }

    // Set warning timer
    warningTimer = setTimeout(showIdleWarning, IDLE_TIMEOUT - WARNING_TIMEOUT);
    // Set idle timer
    idleTimer = setTimeout(handleIdle, IDLE_TIMEOUT);
  }

  // Function to show idle warning
  function showIdleWarning() {
    isWarningShown = true;
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: '<i class="bi bi-exclamation-triangle text-warning"></i> Session Expiring Soon',
        html: `
          <div class="text-center">
            <p class="mb-3">Your session will expire in 5 minutes due to inactivity.</p>
            <div class="d-flex justify-content-center align-items-center mb-3">
              <i class="bi bi-clock me-2"></i>
              <span id="session-countdown">5:00</span>
            </div>
            <p class="small text-muted">Click 'Stay Logged In' to continue your session</p>
          </div>
        `,
        icon: false,
        showCancelButton: true,
        confirmButtonText: '<i class="bi bi-arrow-clockwise"></i> Stay Logged In',
        cancelButtonText: '<i class="bi bi-box-arrow-right"></i> Logout Now',
        confirmButtonColor: '#198754',
        cancelButtonColor: '#dc3545',
        allowOutsideClick: false,
        allowEscapeKey: false,
        allowEnterKey: false,
        focusConfirm: true,
        customClass: {
          container: 'session-warning-modal',
          popup: 'rounded-3 shadow-lg',
          header: 'border-bottom pb-3',
          title: 'fs-5',
          htmlContainer: 'py-3',
          actions: 'border-top pt-3'
        },
        didOpen: () => {
          // Start countdown timer
          let timeLeft = 300; // 5 minutes in seconds
          const countdownEl = document.getElementById('session-countdown');
          const countdownInterval = setInterval(() => {
            timeLeft--;
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (timeLeft <= 60) { // Last minute
              countdownEl.classList.add('text-danger', 'fw-bold');
            }

            if (timeLeft <= 0) {
              clearInterval(countdownInterval);
              handleSessionExpiry();
            }
          }, 1000);

          // Store interval ID to clear it if user responds
          Swal.getPopup().setAttribute('data-interval-id', countdownInterval);
        },
        willClose: () => {
          // Clear countdown interval when modal closes
          const intervalId = Swal.getPopup().getAttribute('data-interval-id');
          if (intervalId) {
            clearInterval(intervalId);
          }
        }
      }).then((result) => {
        if (result.isConfirmed) {
          extendSession();
        } else {
          handleSessionExpiry();
        }
      });
    }
  }

  // Function to extend session - uses enhanced backend endpoint
  async function extendSession() {
    try {
      // Show loading state
      Swal.fire({
        title: 'Extending Session',
        html: '<i class="bi bi-arrow-repeat spin"></i> Please wait...',
        showConfirmButton: false,
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const response = await fetch('/api/user/extend-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to extend session');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to extend session');
      }

      // Reset warning state and timers
      isWarningShown = false;
      resetIdleTimer();

      // Update session data in storage
      sessionStorage.setItem('lastSessionCheck', Date.now().toString());

      // If we received session info, update the navbar data
      if (data.sessionInfo) {
        const navbarData = sessionStorage.getItem('navbarData');
        if (navbarData) {
          const parsedData = JSON.parse(navbarData);
          if (parsedData.user) {
            // Update relevant user data
            if (data.sessionInfo.username) {
              parsedData.user.username = data.sessionInfo.username;
            }
            if (data.sessionInfo.fullName) {
              parsedData.user.fullName = data.sessionInfo.fullName;
            }
            sessionStorage.setItem('navbarData', JSON.stringify(parsedData));
          }
        }
      }

      // Show success message with expiry time if available
      let successMessage = 'Your session has been successfully extended.';
      if (data.sessionInfo && data.sessionInfo.expiresAt) {
        const expiryTime = new Date(data.sessionInfo.expiresAt);
        const formattedTime = expiryTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        successMessage += `<br><span class="small text-muted">Valid until ${formattedTime}</span>`;
      }

      Swal.fire({
        title: '<i class="bi bi-check-circle text-success"></i> Session Extended',
        html: successMessage,
        icon: false,
        timer: 3000,
        timerProgressBar: true,
        showConfirmButton: false,
        customClass: {
          popup: 'rounded-3 shadow',
          title: 'fs-5',
          htmlContainer: 'py-2'
        }
      });
    } catch (error) {
      console.error('Error extending session:', error);

      // Show error message
      Swal.fire({
        title: '<i class="bi bi-exclamation-circle text-danger"></i> Session Error',
        html: `Unable to extend your session: ${error.message}`,
        icon: false,
        confirmButtonText: 'Login Again',
        confirmButtonColor: '#0d6efd',
        timer: 5000,
        timerProgressBar: true,
        customClass: {
          popup: 'rounded-3 shadow',
          title: 'fs-5',
          htmlContainer: 'py-2'
        }
      }).then((result) => {
        handleSessionExpiry();
      });
    }
  }

  // Function to handle idle timeout
  function handleIdle() {
    if (!isWarningShown) {
      handleSessionExpiry();
    }
  }

  // Function to setup idle detection
  function setupIdleDetection() {
    // Reset timer on various user activities
    const events = [
      'mousemove',
      'mousedown',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];

    events.forEach(event => {
      document.addEventListener(event, () => {
        if (!isWarningShown) {
          resetIdleTimer();
        }
      });
    });

    // Initial setup of idle timer
    resetIdleTimer();
  }

  // Function to check session status with improved error handling - uses lightweight endpoint
  async function checkSession() {
    // Don't check session if we're on the login page or other public pages
    if (window.location.pathname.includes('/auth/login') ||
        window.location.pathname.includes('/login') ||
        window.location.pathname.includes('/auth/register') ||
        window.location.pathname.includes('/register') ||
        window.location.pathname.includes('/auth/forgot-password')) {
      return true; // Consider session valid on public pages
    }
    try {
      // Don't check session if warning is shown
      if (isWarningShown) {
        return true;
      }

      // Check if we've recently had a session error to avoid repeated failed requests
      const lastErrorTime = sessionStorage.getItem('lastSessionErrorTime');
      if (lastErrorTime && (Date.now() - parseInt(lastErrorTime) < 30000)) { // 30 seconds cooldown
        console.log('Session check skipped due to recent error');
        return false;
      }

      // Use cached session data if available and recent (within last 5 minutes)
      const lastCheck = sessionStorage.getItem('lastSessionCheck');
      if (lastCheck) {
        const timeSinceLastCheck = Date.now() - parseInt(lastCheck);
        if (timeSinceLastCheck < 5 * 60 * 1000) { // 5 minutes
          console.log('Using cached session timestamp');
          return true;
        }
      }

      // Set a timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        // Only abort if we're not in the middle of a DataTables request
        // or if the DataTables request has been running for too long (more than 30 seconds)
        const dataTablesRunningTooLong = window._dataTablesRequestStartTime &&
          (Date.now() - window._dataTablesRequestStartTime > 30000);

        if (!window._dataTablesRequestInProgress || dataTablesRunningTooLong) {
          // If a DataTables request has been running too long, we should reset the flag
          if (dataTablesRunningTooLong) {
            console.warn('DataTables request has been running for too long, resetting flag');
            window._dataTablesRequestInProgress = false;
            window._dataTablesRequestStartTime = null;
          }
          controller.abort();
        }
      }, 5000); // 5 second timeout

      try {
        // Use the lightweight session check endpoint instead of the full profile endpoint
        const response = await fetch('/api/user/check-session', {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });

        // Clear the timeout since we got a response
        clearTimeout(timeoutId);

        // Handle various response statuses
        if (response.status === 401 || response.status === 403) {
          // Only log and consider session expired if we're on a protected page
          // and we're not on a page that uses DataTables
          if (!window.location.pathname.includes('/auth/') &&
              !window.location.pathname.includes('/dashboard/outbound')) {
            console.log('Session expired or unauthorized');
            return false;
          } else {
            // On auth pages or DataTables pages, 401 is handled separately
            return true;
          }
        }

        if (!response.ok) {
          throw new Error(`Session check failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data || !data.success) {
          console.log('Session check returned unsuccessful response');
          return false;
        }

        // Update session timestamp on valid session
        sessionStorage.setItem('lastSessionCheck', Date.now().toString());

        // If we need to update the UI with username, store it
        if (data.username) {
          const navbarData = sessionStorage.getItem('navbarData');
          if (navbarData) {
            // Update just the username in the existing data
            const parsedData = JSON.parse(navbarData);
            if (parsedData.user) {
              parsedData.user.username = data.username;
              sessionStorage.setItem('navbarData', JSON.stringify(parsedData));
            }
          }
        }

        return true;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError; // Re-throw to be caught by outer catch
      }
    } catch (error) {
      console.error('Session check error:', error);
      // Record the time of the error to implement cooldown
      sessionStorage.setItem('lastSessionErrorTime', Date.now().toString());
      // Don't set sessionError to avoid UI disruption
      return false;
    }
  }

  // Improved session expiry handler
  function handleSessionExpiry() {
    // Clear all timers first
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }

    // Clear session storage
    sessionStorage.clear();
    localStorage.removeItem('navbarData');

    // Only proceed with logout if not already on login page
    if (!window.location.pathname.includes('/auth/logout')) {
      const message = `
        <div class="text-center">
          <i class="bi bi-shield-lock display-4 text-danger mb-3"></i>
          <p class="mb-3">Your session has expired due to inactivity.</p>
          <p class="small text-muted">Please log in again to continue.</p>
        </div>
      `;

      // Perform logout
      fetch('/auth/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      }).finally(() => {
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            title: 'Session Expired',
            html: message,
            icon: false,
            confirmButtonText: '<i class="bi bi-box-arrow-in-right"></i> Return to Login',
            confirmButtonColor: '#0d6efd',
            allowOutsideClick: false,
            allowEscapeKey: false,
            customClass: {
              popup: 'rounded-3 shadow-lg',
              title: 'text-danger',
              htmlContainer: 'py-3',
              confirmButton: 'px-4'
            }
          }).then(() => {
            window.location.href = '/auth/auth/logout?expired=true&reason=idle';
          });
        } else {
          alert('Your session has expired. Please log in again.');
          window.location.href = '/auth/auth/logout?expired=true&reason=idle';
        }
      });
    }
  }

  // Session check disabled to reduce excessive logging
  function startSessionCheck() {
    if (window.sessionCheckInterval) {
      clearInterval(window.sessionCheckInterval);
    }

    console.log('Periodic session checking disabled to reduce excessive logging');

    // Session check disabled - only check on tab focus after long inactivity
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !isWarningShown) {
        const lastCheck = parseInt(sessionStorage.getItem('lastSessionCheck') || '0');
        const timeSinceLastCheck = Date.now() - lastCheck;

        // Only check if more than 10 minutes have passed since last check
        if (timeSinceLastCheck > 600000) { // 10 minutes instead of 1 minute
          console.log('Tab focus after long inactivity, checking session...');
          const isValid = await checkSession();
          if (!isValid) {
            handleSessionExpiry();
          }
        }
      }
    });
  }

  function updateUI(data) {
    const user = data.user || {};

    console.log('Updating UI with:', { user });

    try {
      // Hide loading placeholders
      document.querySelectorAll('.loading-placeholder').forEach(el => {
        el.style.display = 'none';
      });

      // Update username in header
      const usernameElement = document.querySelector('.profile-username');
      if (usernameElement) {
        const displayName = user.fullName || user.username || 'User';
        usernameElement.innerHTML = `<span>${displayName}</span>`;
      }

      // Update email in header
      const emailElement = document.querySelector('.profile-email');
      if (emailElement) {
        emailElement.innerHTML = `<i class="bi bi-envelope"></i> ${user.email || 'N/A'}`;
      }

      // Update admin badge
      const adminBadge = document.querySelector('.admin-badge');
      if (adminBadge) {
        adminBadge.style.display = user.admin ? 'inline-flex' : 'none';
      }

      // Update admin-only elements visibility
      const adminOnlyElements = document.querySelectorAll('.admin-only');
      adminOnlyElements.forEach(element => {
        if (element) {
          element.style.display = user.admin ? 'flex' : 'none';
        }
      });

      // Update normal-user-only elements visibility
      const normalUserElements = document.querySelectorAll('.normal-user-only');
      normalUserElements.forEach(element => {
        if (element) {
          element.style.display = user.admin ? 'none' : 'flex';
        }
      });

      // Update profile picture
      const logoElement = document.querySelector('.profile-logo');
      if (logoElement) {
        const defaultImage = '/assets/img/default-avatar.png';
        const profilePicUrl = user.profilePicture || defaultImage;

        // Add base URL if the path is relative
        const fullPicUrl = profilePicUrl?.startsWith('http') ?
          profilePicUrl :
          (profilePicUrl ? `${window.location.origin}${profilePicUrl}` : defaultImage);

        logoElement.src = fullPicUrl;
        logoElement.onerror = () => {
          console.log('Failed to load image:', fullPicUrl);
          logoElement.src = defaultImage;
        };
      }

      // Show all profile content
      document.querySelectorAll('.profile-content').forEach(el => {
        el.style.display = 'block';
      });

      // Setup dropdown functionality
      setupDropdown();

      console.log('UI update complete');
    } catch (error) {
      console.error('Error updating UI:', error);
    }
  }

  // Enhanced navbar refresh function
  async function refreshNavbar() {
    console.log('Refreshing navbar...');

    try {
      // Check session before refreshing
      const isValid = await checkSession();
      if (!isValid) {
        handleSessionExpiry();
        return;
      }

      // Clear cached data
      sessionStorage.removeItem('navbarData');

      // Reinitialize navbar
      await initializeNavbar();

      console.log('Navbar refresh complete');
    } catch (error) {
      console.error('Error refreshing navbar:', error);
      handleSessionExpiry();
    }
  }

  async function initializeNavbar() {
    console.log('Initializing navbar...');

    // Check if we're on the login page
    if (window.location.pathname === '/auth/login' || window.location.pathname === '/login') {
      console.log('On login page, skipping navbar init...');
      return;
    }

    // Check if navbar elements exist
    if (!document.querySelector('.profile-username')) {
      console.log('Profile username element not found, skipping...');
      return;
    }

    try {
      // Check if we already have a session error
      const sessionError = sessionStorage.getItem('sessionError');
      if (sessionError) {
        console.log('Session error detected:', sessionError);
        setDefaultValues();
        return;
      }

      const response = await fetch('/api/user/profile', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        credentials: 'same-origin'
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.log('User not authenticated');
          // Instead of redirecting, just set default values
          setDefaultValues();
          return;
        }
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const data = await response.json();
      console.log('Raw Navbar data:', data);

      if (!data.success) {
        throw new Error(data.message || 'Failed to fetch user details');
      }

      // Structure the data into our expected format
      const sanitizedData = {
        user: {
          userId: data.user.ID || '',
          username: data.user.Username || '',
          fullName: data.user.FullName || '',
          email: data.user.Email || '',
          admin: data.user.Admin === 1 || data.user.Admin === true || data.user.Admin === '1',
          tin: data.user.TIN || '',
          idType: data.user.IDType || '',
          idValue: data.user.IDValue || '',
          profilePicture: data.user.ProfilePicture || '/assets/img/default-avatar.png',
          lastLoginTime: data.user.LastLoginTime || null,
          validStatus: data.user.ValidStatus === '1' || data.user.ValidStatus === 1 || data.user.ValidStatus === true || data.user.ValidStatus === 'true',
          phone: data.user.Phone || '',
          twoFactorEnabled: data.user.TwoFactorEnabled || false,
          notificationsEnabled: data.user.NotificationsEnabled || false
        },
        success: true
      };

      // Only cache if we have actual user data
      if (sanitizedData.user.username || sanitizedData.user.email) {
        sessionStorage.setItem('navbarData', JSON.stringify(sanitizedData));
      }

      updateUI(sanitizedData);
      setupNavHighlighting();
      startSessionCheck();
      setupIdleDetection(); // Initialize idle detection

    } catch (error) {
      console.error('Error initializing navbar:', error);
      sessionStorage.removeItem('navbarData');
      setDefaultValues();
    }
  }

  function setupDropdown() {
    const profileBtn = document.querySelector('.pinnacle-header__profile-btn');
    const dropdown = document.querySelector('.pinnacle-header__dropdown');
    const arrow = document.querySelector('.pinnacle-header__profile-arrow');

    if (!profileBtn || !dropdown) return;

    let isOpen = false;

    // Toggle dropdown on button click
    profileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      dropdown.classList.toggle('show');
      if (arrow) {
        arrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0)';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !profileBtn.contains(e.target)) {
        isOpen = false;
        dropdown.classList.remove('show');
        if (arrow) {
          arrow.style.transform = 'rotate(0)';
        }
      }
    });

    // Close dropdown when pressing escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        isOpen = false;
        dropdown.classList.remove('show');
        if (arrow) {
          arrow.style.transform = 'rotate(0)';
        }
      }
    });
  }

  function setDefaultValues() {
    updateUI({
      user: {
        username: 'User',
        email: 'N/A',
        admin: false,
        profilePicture: '/assets/img/default-avatar.png',
        validStatus: false,
        lastLoginTime: null
      }
    });
  }

  function setupNavHighlighting() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item-link').forEach(link => {
      if (link) {
        link.classList.toggle('active', link.getAttribute('href') === currentPath);
      }
    });
  }

  // Make refreshNavbar available globally with session check
  window.refreshNavbar = async function() {
    const isValid = await checkSession();
    if (isValid) {
      return refreshNavbar();
    }
    handleSessionExpiry();
  };
})();