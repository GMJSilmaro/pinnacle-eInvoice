// Session monitoring and timeout alerts
(function() {
    const CHECK_INTERVAL = 30000; // Check every 30 seconds instead of 10
    let warningShown = false;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3; // Number of consecutive failures before forcing logout

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
                    window.location.href = '/login';
                }
                return;
            }
            
            if (data.showTimeoutWarning && !warningShown) {
                warningShown = true;
                showTimeoutWarning();
            }
        })
        .catch(error => {
            console.error('Session check error:', error);
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_FAILURES && error.status === 401) {
                window.location.href = '/login';
            }
        });
    }

    function showTimeoutWarning() {
        // Create and show a Bootstrap alert
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-warning alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
        alertDiv.setAttribute('role', 'alert');
        alertDiv.style.zIndex = '9999';
        
        alertDiv.innerHTML = `
            <strong>Warning!</strong> Your session will expire in 30 seconds due to inactivity.
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        document.body.appendChild(alertDiv);

        // Remove the alert after 25 seconds if not already closed
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 25000);
    }

    // Start monitoring
    setInterval(checkSession, CHECK_INTERVAL);
})(); 