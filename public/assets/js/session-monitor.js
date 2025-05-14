// Session monitoring and timeout alerts - DISABLED
// This file has been disabled to reduce excessive session checking and logging
(function() {
    // Configuration - not used since monitoring is disabled
    const CHECK_INTERVAL = 300000; // 5 minutes (increased from 30 seconds)
    const WARNING_THRESHOLD = 60; // Show warning when 60 seconds remain
    const ACTIVITY_EVENTS = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart']; // Events that count as user activity

    let warningShown = false;
    let consecutiveFailures = 0;
    let sessionTimeoutTimer = null;
    let lastActivityTime = Date.now();
    let sessionExpiryTime = null;

    const MAX_FAILURES = 3; // Number of consecutive failures before forcing logout
    const SESSION_TIMEOUT_MODAL_ID = 'sessionTimeoutModal';

    // Track user activity
    function trackActivity() {
        lastActivityTime = Date.now();

        // If warning is shown, check if we should hide it
        if (warningShown) {
            const timeoutModal = document.getElementById(SESSION_TIMEOUT_MODAL_ID);
            if (timeoutModal) {
                // Don't auto-hide the modal - user needs to explicitly extend or let it expire
                // But we can update the countdown timer
                updateCountdown();
            }
        }
    }

    // Register activity event listeners
    ACTIVITY_EVENTS.forEach(eventType => {
        document.addEventListener(eventType, trackActivity, { passive: true });
    });

    // Check session status
    function checkSession() {
        // Skip session check if a DataTables request is in progress
        if (window._dataTablesRequestInProgress) {
            console.log('Skipping session check due to DataTables request in progress');
            return;
        }

        fetch('/api/user/profile', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin'
        })
        .then(response => {
            if (!response.ok) {
                throw response;
            }
            consecutiveFailures = 0; // Reset on successful response
            return response.json();
        })
        .then(data => {
            if (!data.success || !data.user) {
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_FAILURES) {
                    redirectToLogin();
                }
                return;
            }

            // Update session expiry time if provided
            if (data.sessionExpiryTime) {
                sessionExpiryTime = new Date(data.sessionExpiryTime).getTime();

                // Calculate time remaining
                const now = Date.now();
                const timeRemaining = Math.max(0, sessionExpiryTime - now);

                // Show warning if time remaining is less than warning threshold
                if (timeRemaining <= WARNING_THRESHOLD * 1000 && !warningShown) {
                    warningShown = true;
                    showTimeoutWarning(Math.ceil(timeRemaining / 1000));
                }

                // Clear existing timeout timer
                if (sessionTimeoutTimer) {
                    clearTimeout(sessionTimeoutTimer);
                }

                // Set new timeout timer
                if (timeRemaining > 0) {
                    sessionTimeoutTimer = setTimeout(() => {
                        redirectToLogin();
                    }, timeRemaining);
                }
            }

            // Handle timeout warning flag from server
            if (data.showTimeoutWarning && !warningShown) {
                warningShown = true;
                showTimeoutWarning(WARNING_THRESHOLD);
            }
        })
        .catch(error => {
            console.error('Session check error:', error);
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_FAILURES && error.status === 401) {
                redirectToLogin();
            }
        });
    }

    // Redirect to login page
    function redirectToLogin() {
        // Save current URL to return after login
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?returnUrl=${returnUrl}`;
    }

    // Extend session
    function extendSession() {
        fetch('/api/user/extend-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'same-origin'
        })
        .then(response => {
            if (!response.ok) {
                throw response;
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Reset warning state
                warningShown = false;

                // Update session expiry time
                if (data.sessionExpiryTime) {
                    sessionExpiryTime = new Date(data.sessionExpiryTime).getTime();
                }

                // Hide timeout warning
                hideTimeoutWarning();

                // Show success toast
                showExtendSessionSuccess();
            } else {
                // Session could not be extended, redirect to login
                redirectToLogin();
            }
        })
        .catch(error => {
            console.error('Error extending session:', error);
            // Redirect to login on error
            redirectToLogin();
        });
    }

    // Show session extension success toast
    function showExtendSessionSuccess() {
        // Create toast container if it doesn't exist
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            toastContainer.style.zIndex = '9999';
            document.body.appendChild(toastContainer);
        }

        // Create toast
        const toastId = 'sessionExtendedToast';
        const toast = document.createElement('div');
        toast.className = 'toast align-items-center text-white bg-success border-0';
        toast.id = toastId;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');

        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    <i class="bi bi-check-circle-fill me-2"></i>
                    Session extended successfully.
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;

        toastContainer.appendChild(toast);

        // Initialize and show toast
        const bsToast = new bootstrap.Toast(toast, {
            autohide: true,
            delay: 3000
        });
        bsToast.show();

        // Remove toast after it's hidden
        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
    }

    // Update countdown timer in timeout warning
    function updateCountdown() {
        if (!sessionExpiryTime) return;

        const countdownElement = document.getElementById('sessionCountdown');
        if (!countdownElement) return;

        const now = Date.now();
        const timeRemaining = Math.max(0, sessionExpiryTime - now);
        const secondsRemaining = Math.ceil(timeRemaining / 1000);

        countdownElement.textContent = secondsRemaining;

        // Update progress bar if it exists
        const progressBar = document.getElementById('sessionTimeoutProgress');
        if (progressBar) {
            const percentage = Math.min(100, Math.max(0, (timeRemaining / (WARNING_THRESHOLD * 1000)) * 100));
            progressBar.style.width = `${percentage}%`;

            // Update color based on time remaining
            if (percentage < 25) {
                progressBar.className = 'progress-bar bg-danger';
            } else if (percentage < 50) {
                progressBar.className = 'progress-bar bg-warning';
            } else {
                progressBar.className = 'progress-bar bg-success';
            }
        }

        // Continue updating if time remaining
        if (timeRemaining > 0) {
            requestAnimationFrame(updateCountdown);
        } else {
            // Time's up, redirect to login
            redirectToLogin();
        }
    }

    // Show timeout warning modal
    function showTimeoutWarning(secondsRemaining) {
        // Remove any existing timeout warnings
        hideTimeoutWarning();

        // Create modal if it doesn't exist
        const modalHTML = `
            <div class="modal fade" id="${SESSION_TIMEOUT_MODAL_ID}" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-labelledby="sessionTimeoutModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-warning text-dark">
                            <h5 class="modal-title" id="sessionTimeoutModalLabel">
                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                Session Timeout Warning
                            </h5>
                        </div>
                        <div class="modal-body">
                            <div class="d-flex align-items-center mb-3">
                                <div class="session-timeout-icon me-3">
                                    <i class="bi bi-clock-history text-warning" style="font-size: 2rem;"></i>
                                </div>
                                <div>
                                    <p class="mb-1">Your session will expire in <span id="sessionCountdown">${secondsRemaining}</span> seconds due to inactivity.</p>
                                    <p class="mb-0 text-muted small">You will be logged out automatically when the session expires.</p>
                                </div>
                            </div>
                            <div class="progress" style="height: 6px;">
                                <div id="sessionTimeoutProgress" class="progress-bar bg-warning" role="progressbar" style="width: 100%"></div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-secondary" id="logoutNowBtn">Logout Now</button>
                            <button type="button" class="btn btn-primary" id="extendSessionBtn">
                                <i class="bi bi-arrow-clockwise me-1"></i>
                                Extend Session
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Get modal element
        const modalElement = document.getElementById(SESSION_TIMEOUT_MODAL_ID);

        // Initialize modal
        const modal = new bootstrap.Modal(modalElement);
        modal.show();

        // Add event listeners
        const extendSessionBtn = document.getElementById('extendSessionBtn');
        const logoutNowBtn = document.getElementById('logoutNowBtn');

        if (extendSessionBtn) {
            extendSessionBtn.addEventListener('click', () => {
                extendSession();
            });
        }

        if (logoutNowBtn) {
            logoutNowBtn.addEventListener('click', () => {
                window.location.href = '/auth/logout';
            });
        }

        // Start countdown
        updateCountdown();
    }

    // Hide timeout warning
    function hideTimeoutWarning() {
        const modalElement = document.getElementById(SESSION_TIMEOUT_MODAL_ID);
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }

            // Remove modal after animation completes
            modalElement.addEventListener('hidden.bs.modal', () => {
                modalElement.remove();
            });
        }
    }

    // Session monitoring disabled
    // checkSession(); // Initial check disabled
    // setInterval(checkSession, CHECK_INTERVAL); // Interval check disabled
    console.log('Session monitoring disabled to reduce excessive logging');
})();