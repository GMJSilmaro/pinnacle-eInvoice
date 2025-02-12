// Wrap everything in an IIFE to avoid global namespace pollution
(function() {
  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNavbar);
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

  // Function to extend session
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
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        isWarningShown = false;
        resetIdleTimer();
        
        Swal.fire({
          title: '<i class="bi bi-check-circle text-success"></i> Session Extended',
          html: 'Your session has been successfully extended.',
          icon: false,
          timer: 2000,
          timerProgressBar: true,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-3 shadow',
            title: 'fs-5',
            htmlContainer: 'py-2'
          }
        });
      } else {
        throw new Error('Failed to extend session');
      }
    } catch (error) {
      console.error('Error extending session:', error);
      handleSessionExpiry();
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

  // Function to check session status with improved error handling
  async function checkSession() {
    try {
      // Don't check session if warning is shown
      if (isWarningShown) {
        return true;
      }

      // Clear any existing session error states
      sessionStorage.removeItem('sessionError');

      const response = await fetch('/api/user/profile', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        credentials: 'same-origin'
      });

      // Handle various response statuses
      if (response.status === 401 || response.status === 403) {
        return false;
      }

      if (!response.ok) {
        throw new Error(`Session check failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data || !data.success || !data.user) {
        return false;
      }

      // Update session timestamp on valid session
      sessionStorage.setItem('lastSessionCheck', Date.now().toString());
      sessionStorage.setItem('navbarData', JSON.stringify(data));

      return true;
    } catch (error) {
      console.error('Session check error:', error);
      sessionStorage.setItem('sessionError', error.message);
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
      fetch('/auth/logout', {
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
            window.location.href = '/auth/logout?expired=true&reason=idle';
          });
        } else {
          alert('Your session has expired. Please log in again.');
          window.location.href = '/auth/logout?expired=true&reason=idle';
        }
      });
    }
  }

  // Enhanced periodic session check
  function startSessionCheck() {
    if (window.sessionCheckInterval) {
      clearInterval(window.sessionCheckInterval);
    }

    // Check session every 5 minutes
    window.sessionCheckInterval = setInterval(async () => {
      if (window.location.pathname.includes('/auth/logout') || isWarningShown) {
        return;
      }

      const isValid = await checkSession();
      if (!isValid) {
        handleSessionExpiry();
      }
    }, 300000); // 5 minutes

    // Check session on tab focus
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !isWarningShown) {
        const lastCheck = parseInt(sessionStorage.getItem('lastSessionCheck') || '0');
        const timeSinceLastCheck = Date.now() - lastCheck;

        // Only check if more than 1 minute has passed since last check
        if (timeSinceLastCheck > 60000) {
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
    if (window.location.pathname === '/auth/login') {
      console.log('On login page, skipping navbar init...');
      return;
    }

    // Check if navbar elements exist
    if (!document.querySelector('.profile-username')) {
      console.log('Profile username element not found, skipping...');
      return;
    }

    try {
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
          console.log('User not authenticated, redirecting to login...');
          window.location.href = '/auth/login';
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
