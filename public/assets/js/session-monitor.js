// Session monitoring and timeout alerts
(function() {
    const CHECK_INTERVAL = 10000; // Check every 10 seconds
    let warningShown = false;

    function checkSession() {
        fetch('/api/user/profile', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
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
            if (!data.success || !data.user) {
                window.location.href = '/auth/login';
                return;
            }
            
            if (data.showTimeoutWarning && !warningShown) {
                warningShown = true;
                showTimeoutWarning();
            }
        })
        .catch(error => {
            console.error('Session check error:', error);
            if (error.status === 401) {
                window.location.href = '/auth/login';
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