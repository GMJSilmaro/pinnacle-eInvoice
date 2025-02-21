let originalFormData = null;
let hasUnsavedChanges = false;
let savedLHDNConfig = null;


async function loadSAPConfig() {
    try {
        console.log('Fetching SAP config...');
        const response = await fetch('/api/config/sap/get-config');
        console.log('Response status:', response.status);
        
        if (response.status === 401) {
            console.log('User not authenticated, redirecting to login');
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Log response headers
        console.log('Response headers:', Object.fromEntries([...response.headers]));
        const contentType = response.headers.get("content-type");
        console.log('Content-Type:', contentType);
        
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Response was not JSON");
        }
        
        // Get response text first for debugging
        const text = await response.text();
        console.log('Response text:', text);
        
        // Try to parse JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('JSON parse error:', e);
            throw new Error('Invalid JSON response from server');
        }
        
        console.log('Parsed data:', data);
        
        if (data.success && data.settings) {
            // Parse the settings string into an object
            let settings;
            try {
                settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
                console.log('Parsed settings:', settings);
            } catch (e) {
                console.error('Settings parse error:', e);
                throw new Error('Invalid settings format');
            }
            
            // Populate form fields
            document.getElementById('networkPath').value = settings.networkPath || '';
            document.getElementById('serverName').value = settings.domain || '';
            document.getElementById('serverUsername').value = settings.username || '';
            // Don't populate password for security reasons
            
           
        } else if (!data.success) {
            throw new Error(data.error || 'Failed to load configuration');
        }
    } catch (error) {
        console.error('Error loading SAP config:', error);
        
        // Don't show error toast if redirecting to login
        if (error.message !== 'User not authenticated') {
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to load SAP configuration',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    }
}

async function saveSAPConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Validating Configuration',
            text: 'Please wait while we validate the network path...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Get form values
        const networkPath = document.getElementById('networkPath').value;
        const domain = document.getElementById('serverName').value;
        const username = document.getElementById('serverUsername').value;
        const password = document.getElementById('serverPassword').value;

        // Validate required fields
        if (!networkPath) {
            throw new Error('Network path is required');
        }

        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        // First validate the network path
        const validationResponse = await fetch('/api/config/sap/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        if (validationResponse.status === 401) {
            throw new Error('Your session has expired. Please log in again.');
        }

        const validationResult = await validationResponse.json();

        if (!validationResult.success) {
            throw new Error(validationResult.error || 'Network path validation failed');
        }

        // If validation successful, save the configuration
        const saveResponse = await fetch('/api/config/sap/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath: validationResult.formattedPath || networkPath,
                domain,
                username,
                password
            })
        });

        if (saveResponse.status === 401) {
            throw new Error('Your session has expired. Please log in again.');
        }

        const saveResult = await saveResponse.json();

        if (!saveResult.success) {
            throw new Error(saveResult.error || 'Failed to save SAP configuration');
        }

        // Close loading dialog and show success
        Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'SAP configuration has been validated and saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });

    } catch (error) {
        console.error('Error saving SAP config:', error);
        
        // Close loading dialog if open
        Swal.close();
        
        // Show error message
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save SAP configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        }).then(() => {
            // If session expired, redirect to login
            if (error.message.includes('session has expired')) {
                window.location.href = '/login';
            }
        });
    }
}


// Consolidate all DOM ready event listeners into a single function
document.addEventListener('DOMContentLoaded', async function initializeAdminSettings() {
    try {
        // Get all nav items
        const navItems = document.querySelectorAll('.settings-nav-item');
        
        // Add click handler to each nav item
        navItems.forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Remove active class from all nav items
                navItems.forEach(nav => nav.classList.remove('active'));
                
                // Add active class to clicked item
                this.classList.add('active');
                
                // Get the section to show from data-section attribute
                const sectionId = this.getAttribute('data-section');
                
                // Hide all forms
                document.querySelectorAll('.settings-form').forEach(form => {
                    form.classList.remove('active');
                    form.style.display = 'none';
                });
                
                // Show the selected form
                const selectedForm = document.getElementById(sectionId);
                if (selectedForm) {
                    selectedForm.style.display = 'block';
                    // Use setTimeout to ensure display:block is applied before adding active class
                    setTimeout(() => {
                        selectedForm.classList.add('active');
                    }, 10);
                }
            });
        });

        // Show initial section (if none is active, show first one)
        const activeNav = document.querySelector('.settings-nav-item.active');
        if (activeNav) {
            activeNav.click();
        } else {
            const firstNav = document.querySelector('.settings-nav-item');
            if (firstNav) firstNav.click();
        }

        // Initialize LHDN configuration
        await loadLHDNConfig();
        await loadSAPConfig();
        // Start auto-refresh of access token (every 5 minutes)
        const tokenRefreshInterval = setInterval(updateAccessToken, 5 * 60 * 1000);

        // Load user data
        await loadUserData();

        // Add change detection to critical fields for LHDN config
        const criticalFields = ['clientId', 'clientSecret', 'middlewareUrl'];
        criticalFields.forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                element.addEventListener('input', updateTestConnectionButtonState);
            }
        });
        
        // Add environment change listener
        const environmentSelect = document.getElementById('environment');
        if (environmentSelect) {
            environmentSelect.addEventListener('change', () => {
                updateLHDNUrl();
                updateTestConnectionButtonState();
            });
        }


    } catch (error) {
        console.error('Error initializing admin settings:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Initialization Error',
            text: 'Failed to initialize admin settings: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
});


// Handle profile picture upload
document.addEventListener('DOMContentLoaded', () => {
    const avatarContainer = document.getElementById('avatarContainer');
    const avatarUpload = document.getElementById('avatarUpload');
    
    avatarContainer.addEventListener('click', () => {
        avatarUpload.click();
    });
    
    avatarUpload.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                await Swal.fire({
                    icon: 'error',
                    title: 'File Too Large',
                    text: 'Please select an image under 5MB',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                return;
            }
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Invalid File Type',
                    text: 'Please select an image file',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                return;
            }
            
            try {
                const formData = new FormData();
                formData.append('avatar', file);
                
                const response = await fetch('/api/user/update-avatar', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    document.getElementById('profileAvatar').src = result.avatarUrl;
                    await Swal.fire({
                        icon: 'success',
                        title: 'Profile Picture Updated',
                        text: 'Your profile picture has been updated successfully',
                        timer: 2000,
                        timerProgressBar: true,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                await Swal.fire({
                    icon: 'error',
                    title: 'Upload Failed',
                    text: error.message || 'Failed to upload profile picture',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
            }
        }
    });
});


function setupNavigation() {
    const navItems = document.querySelectorAll('.settings-nav-item');
    const sections = document.querySelectorAll('.settings-form');

    // Initially hide all sections except the first one
    sections.forEach((section, index) => {
        section.style.display = index === 0 ? 'block' : 'none';
    });

    // Set first nav item as active
    if (navItems[0]) {
        navItems[0].classList.add('active');
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all items
            navItems.forEach(navItem => {
                navItem.classList.remove('active');
            });
            
            // Add active class to clicked item
            item.classList.add('active');
            
            // Hide all sections
            sections.forEach(section => {
                section.style.display = 'none';
            });
            
            // Show the selected section
            const targetId = item.getAttribute('href').substring(1);
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
        });
    });
}

async function loadUserData() {
    try {
        const response = await fetch('/api/user/profile');
        const data = await response.json();
        console.log(data);
        
        if (data.success && data.user) {
            // Store original data for reset functionality
            originalFormData = { ...data.user };
            
            // Get all form elements first
            const fullNameInput = document.getElementById('fullName');
            const emailInput = document.getElementById('email');
            const phoneInput = document.getElementById('phone');
            const usernameInput = document.getElementById('username');
            const userRoleInput = document.getElementById('userRole');
            const accountCreatedInput = document.getElementById('accountCreated');
            const profileAvatar = document.getElementById('profileAvatar');
            const lastLoginTime = document.getElementById('lastLoginTime');
            const accountStatus = document.getElementById('accountStatus');
            const lastUpdatedTime = document.getElementById('lastUpdatedTime');

            // Only set values if elements exist
            if (fullNameInput) fullNameInput.value = data.user.FullName || '';
            if (emailInput) emailInput.value = data.user.Email || '';
            if (phoneInput) phoneInput.value = data.user.Phone || '';
            if (usernameInput) usernameInput.value = data.user.Username || '';
            if (userRoleInput) userRoleInput.value = data.user.Admin ? 'Administrator' : 'User';
            if (accountCreatedInput) accountCreatedInput.value = formatDate(data.user.CreateTS);
            
            // Update profile picture if exists
            if (profileAvatar && data.user.ProfilePicture) {
                profileAvatar.src = data.user.ProfilePicture;
            }

            // Update status badge
            if (accountStatus) {
                updateStatusBadge(data.user.ValidStatus === '1');
            }

            // Update last login time
            if (lastLoginTime && data.user.LastLoginTime) {
                lastLoginTime.textContent = formatDate(data.user.LastLoginTime);
            }

            // Update last updated time - Check for both UpdateTS and UpdateTime fields
            if (lastUpdatedTime) {
                const updateTimestamp = data.user.UpdateTS || data.user.UpdateTime;
                if (updateTimestamp && updateTimestamp !== '0000-00-00 00:00:00') {
                    lastUpdatedTime.textContent = formatDate(updateTimestamp);
                } else {
                    lastUpdatedTime.textContent = formatDate(data.user.CreateTS) || 'Never';
                }
            }

            addChangeDetection();
 
        } else {
            throw new Error(data.message || 'Failed to load user data');
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load user profile: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Set default values for critical UI elements
        const defaultElements = {
            fullName: '',
            email: '',
            phone: '',
            username: '',
            userRole: '',
            accountCreated: '',
            lastUpdatedTime: formatDate(new Date()) // Set to current time if error
        };

        Object.entries(defaultElements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
    }
}

function addChangeDetection() {
    const editableFields = ['fullName', 'email', 'phone', 'twoFactorAuth', 'loginNotifications'];
    editableFields.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) {
            element.addEventListener('change', () => {
                hasUnsavedChanges = true;
                updateSaveButtonState();
            });
            if (element.type === 'text' || element.type === 'email' || element.type === 'tel') {
                element.addEventListener('input', () => {
                    hasUnsavedChanges = true;
                    updateSaveButtonState();
                });
            }
        }
    });
}

function updateSaveButtonState() {
    const saveButton = document.querySelector('button[onclick*="savePersonalInfo"]');
    const resetButton = document.querySelector('button[onclick*="resetForm"]');
    
    if (!saveButton || !resetButton) {
        console.debug('Save or reset button not found in the DOM');
        return;
    }
    
    saveButton.disabled = !hasUnsavedChanges;
    resetButton.disabled = !hasUnsavedChanges;
    
    if (hasUnsavedChanges) {
        saveButton.classList.add('btn-primary');
        saveButton.classList.remove('btn-secondary');
    } else {
        saveButton.classList.remove('btn-primary');
        saveButton.classList.add('btn-secondary');
    }
}

function updateStatusBadge(isActive) {
    const statusBadge = document.getElementById('accountStatus');
    if (isActive) {
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i><span>Active</span>';
        statusBadge.style.background = '#ecfdf5';
        statusBadge.style.color = '#059669';
    } else {
        statusBadge.innerHTML = '<i class="fas fa-times-circle"></i><span>Inactive</span>';
        statusBadge.style.background = '#fef2f2';
        statusBadge.style.color = '#dc2626';
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function resetForm() {
    if (!originalFormData) return;
    
    // Reset form fields to original values
    document.getElementById('fullName').value = originalFormData.FullName || '';
    document.getElementById('email').value = originalFormData.Email || '';
    document.getElementById('phone').value = originalFormData.Phone || '';
    
    // Reset security settings
    document.getElementById('twoFactorAuth').checked = originalFormData.TwoFactorEnabled || false;
    document.getElementById('loginNotifications').checked = originalFormData.NotificationsEnabled || false;
    
    hasUnsavedChanges = false;
    updateSaveButtonState();
    
    Swal.fire({
        icon: 'info',
        title: 'Form Reset',
        text: 'All changes have been reset',
        timer: 2000,
        timerProgressBar: true,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

async function savePersonalInfo() {
    try {
        if (!hasUnsavedChanges) return;
        console.log("SAVE PROFILE IN SETTINGS CLICK!!");
        // Show loading state
      

        const data = {
            fullName: document.getElementById('fullName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
        };

        // Validate required fields
        if (!data.fullName || !data.email) {
            throw new Error('Full Name and Email are required');
        }

        const response = await fetch('/api/user/update-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
            // Update original form data
            originalFormData = { ...originalFormData, ...data };
            hasUnsavedChanges = false;
            updateSaveButtonState();

            // Update last updated time
            const lastUpdatedTime = document.getElementById('lastUpdatedTime');
            if (lastUpdatedTime) {
                lastUpdatedTime.textContent = formatDate(new Date());
            }

            await Swal.fire({
                icon: 'success',
                title: 'Profile Updated',
                text: 'Your profile has been updated successfully',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        } else {
            throw new Error(result.message || 'Failed to update profile');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to update profile',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function changePassword() {
    try {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            throw new Error('Please fill in all password fields');
        }

        if (newPassword !== confirmPassword) {
            throw new Error('New passwords do not match');
        }

        // Password strength validation
        if (newPassword.length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }

        if (!/[A-Z]/.test(newPassword)) {
            throw new Error('Password must contain at least one uppercase letter');
        }

        if (!/[a-z]/.test(newPassword)) {
            throw new Error('Password must contain at least one lowercase letter');
        }

        if (!/[0-9]/.test(newPassword)) {
            throw new Error('Password must contain at least one number');
        }

        if (!/[!@#$%^&*]/.test(newPassword)) {
            throw new Error('Password must contain at least one special character (!@#$%^&*)');
        }

        // Show loading state
        Swal.fire({
            title: 'Updating Password',
            text: 'Please wait while we update your password...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword,
                confirmPassword
            })
        });

        const result = await response.json();
        
        if (result.success) {
            // Clear password fields
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';

            await Swal.fire({
                icon: 'success',
                title: 'Password Updated',
                text: 'Your password has been changed successfully',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        } else {
            throw new Error(result.message || 'Failed to change password');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to change password',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function saveNotificationPreferences() {
    try {
        const data = {
            emailNotifications: document.getElementById('emailNotifications').checked,
            smsNotifications: document.getElementById('smsNotifications').checked
        };

        const response = await fetch('/api/saveNotificationPreferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
            showSuccess('Notification preferences saved successfully');
        } else {
            throw new Error(result.message || 'Failed to save notification preferences');
        }
    } catch (error) {
        console.error('Error saving notification preferences:', error);
        showError(error.message || 'Failed to save notification preferences');
    }
}

// Helper functions for showing success/error messages
function showSuccess(message) {
    // Create alert element
    const alert = document.createElement('div');
    alert.className = 'alert alert-success';
    alert.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    
    // Add to page
    showAlert(alert);
}

function showError(message) {
    // Create alert element
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    
    // Add to page
    showAlert(alert);
}

function showAlert(alertElement) {
    // Find the settings-form-content of the active section
    const activeSection = document.querySelector('.settings-form[style*="block"]') || document.querySelector('.settings-form');
    const content = activeSection.querySelector('.settings-form-content');
    
    // Insert alert at the top of the content
    content.insertBefore(alertElement, content.firstChild);
    
    // Remove after 3 seconds
    setTimeout(() => {
        alertElement.remove();
    }, 3000);
}

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const button = input.nextElementSibling;
    const icon = button.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Update the loadLHDNConfig function to store the saved configuration
async function loadLHDNConfig() {
    try {
        const response = await fetch('/api/config/lhdn/get-config');
        const data = await response.json();
        
        if (data.success && data.config) {
            // Parse the settings if it's a string
            let settings;
            try {
                // Handle both string and object formats
                if (typeof data.config.Settings === 'string') {
                    settings = JSON.parse(data.config.Settings);
                } else if (data.config.settings) {
                    settings = data.config.settings;
                } else {
                    settings = data.config;
                }

                console.log('Parsed settings:', settings); // Debug log
                
                // Store the saved configuration
                savedLHDNConfig = {
                    clientId: settings.clientId || '',
                    clientSecret: settings.clientSecret || '',
                    middlewareUrl: settings.middlewareUrl || (settings.environment === 'production' ? 'https://api.myinvois.hasil.gov.my' : 'https://preprod-api.myinvois.hasil.gov.my')
                };

                // Update last modified info if available
                const lastModifiedInfo = document.getElementById('lastModifiedInfo');
                const lastModifiedBy = document.getElementById('lastModifiedBy');
                const lastModifiedTime = document.getElementById('lastModifiedTime');

                if (settings.lastModifiedBy) {
                    lastModifiedBy.textContent = settings.lastModifiedBy.name || settings.lastModifiedBy.username;
                    lastModifiedTime.textContent = new Date(settings.lastModifiedBy.timestamp).toLocaleString();
                    lastModifiedInfo.style.display = 'block';
                } else {
                    lastModifiedInfo.style.display = 'none';
                }
                
            } catch (e) {
                console.error('Error parsing settings:', e);
                settings = {};
            }
            
            // Fill in the form fields
            document.getElementById('environment').value = settings.environment || 'default';
            
            // Set the middleware URL based on environment
            const middlewareUrl = document.getElementById('middlewareUrl');
            if (settings.environment === 'production') {
                middlewareUrl.value = 'https://api.myinvois.hasil.gov.my';
            } else {
                middlewareUrl.value = 'https://preprod-api.myinvois.hasil.gov.my';
            }
            
            // Set client credentials
            if (settings.clientId) document.getElementById('clientId').value = settings.clientId;
            if (settings.clientSecret) document.getElementById('clientSecret').value = settings.clientSecret;
            
            // Set connection settings
            document.getElementById('timeout').value = settings.timeout || 30;
            document.getElementById('retryEnabled').checked = settings.retryEnabled || false;

            // Update test connection button state
            updateTestConnectionButtonState();
            // After loading config, update the access token
            await updateAccessToken();
        }
    } catch (error) {
        console.error('Error loading LHDN config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load LHDN configuration',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

// Add function to check if critical fields have changed
function hasConfigurationChanged() {
    if (!savedLHDNConfig) return true; // If no saved config, allow testing
    
    const currentConfig = {
        clientId: document.getElementById('clientId').value,
        clientSecret: document.getElementById('clientSecret').value,
        middlewareUrl: document.getElementById('middlewareUrl').value
    };
    
    return currentConfig.clientId !== savedLHDNConfig.clientId ||
           currentConfig.clientSecret !== savedLHDNConfig.clientSecret ||
           currentConfig.middlewareUrl !== savedLHDNConfig.middlewareUrl;
}

// Add function to update test connection button state
function updateTestConnectionButtonState() {
    const testButton = document.querySelector('button[onclick="testConnection()"]');
    if (!testButton) return;

    const clientId = document.getElementById('clientId')?.value;
    const clientSecret = document.getElementById('clientSecret')?.value;
    const middlewareUrl = document.getElementById('middlewareUrl')?.value;

    const hasRequiredFields = clientId && clientSecret && middlewareUrl;
    const hasChanges = hasConfigurationChanged();

    testButton.disabled = !hasRequiredFields || !hasChanges;
    
    // Update button appearance
    if (hasRequiredFields && hasChanges) {
        testButton.classList.remove('btn-secondary');
        testButton.classList.add('btn-outline-secondary');
        testButton.title = 'Test connection with current configuration';
    } else {
        testButton.classList.remove('btn-outline-secondary');
        testButton.classList.add('btn-secondary');
        testButton.title = hasRequiredFields ? 
            'No changes detected in configuration' : 
            'Please fill in all required fields';
    }
}

// Add event listeners to critical fields
document.addEventListener('DOMContentLoaded', () => {
    const criticalFields = ['clientId', 'clientSecret', 'middlewareUrl'];
    criticalFields.forEach(fieldId => {
        document.getElementById(fieldId)?.addEventListener('input', updateTestConnectionButtonState);
    });
    
    // Also update when environment changes as it affects middlewareUrl
    document.getElementById('environment')?.addEventListener('change', () => {
        updateLHDNUrl();
        updateTestConnectionButtonState();
    });
    
    loadLHDNConfig();
});

async function testConnection() {
    try {
        const button = document.querySelector('button[onclick="testConnection()"]');
        if (!button) {
            throw new Error('Test connection button not found');
        }

        // Get current values
        const environment = document.getElementById('environment').value;
        const middlewareUrl = document.getElementById('middlewareUrl').value;
        const clientId = document.getElementById('clientId').value;
        const clientSecret = document.getElementById('clientSecret').value;

        // Validate required fields
        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        if (!middlewareUrl) {
            throw new Error('Middleware URL is required');
        }

        // Update button state
        const originalButtonHtml = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        button.disabled = true;

        try {
            // Show loading state
            Swal.fire({
                title: 'Testing Connection',
                text: 'Please wait while we verify your credentials...',
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Try to validate the credentials
            const response = await fetch('/api/config/lhdn/test-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clientId,
                    clientSecret,
                    environment,
                    middlewareUrl
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Connection test failed');
            }

            // Close loading dialog
            Swal.close();

            // Show success message with expiry details
            await Swal.fire({
                icon: 'success',
                title: 'Connection Test Successful',
                html: `
                    <div style="text-align: left;">
                        <p><i class="fas fa-check-circle text-success"></i> Credentials validation successful</p>
                        <p><i class="fas fa-clock text-info"></i> Token validity: ${result.expiresIn || 'N/A'} minutes</p>
                        <p class="text-muted small">Note: Token will be automatically refreshed when needed</p>
                    </div>
                `,
                showConfirmButton: true,
                confirmButtonText: 'Save Configuration',
                showCancelButton: true,
                cancelButtonText: 'Close'
            }).then((result) => {
                if (result.isConfirmed) {
                    saveLHDNConfig();
                }
            });

            // Update access token display if available
            if (result.accessToken) {
                const tokenInput = document.getElementById('accessToken');
                if (tokenInput) {
                    tokenInput.value = result.accessToken;
                }
            }

        } catch (error) {
            // Close any open loading dialog
            Swal.close();

            console.error('Connection test error:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Connection Test Failed',
                html: `
                    <div style="text-align: left;">
                        <p><i class="fas fa-times-circle text-danger"></i> ${error.message}</p>
                        <p class="text-muted small">Please verify your credentials and try again</p>
                    </div>
                `,
                showConfirmButton: true
            });
        } finally {
            // Restore button state
            button.innerHTML = originalButtonHtml;
            updateTestConnectionButtonState();
        }

    } catch (error) {
        console.error('Test connection setup error:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to setup connection test',
            showConfirmButton: true
        });
    }
}

async function saveLHDNConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const config = {
            environment: document.getElementById('environment').value,
            middlewareUrl: document.getElementById('middlewareUrl').value,
            clientId: document.getElementById('clientId').value,
            clientSecret: document.getElementById('clientSecret').value,
            timeout: parseInt(document.getElementById('timeout').value) || 30,
            retryEnabled: document.getElementById('retryEnabled').checked
        };

        // Validate required fields
        if (!config.clientId || !config.clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        const response = await fetch('/api/config/lhdn/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save configuration');
        }

        // Close loading dialog and show success
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'LHDN configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });

        // Reload the configuration to ensure UI is in sync
        await loadLHDNConfig();

    } catch (error) {
        console.error('Error saving LHDN config:', error);
        
        // Close loading dialog if open
        Swal.close();
        
        // Show error message
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save LHDN configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

function updateLHDNUrl() {
    const environment = document.getElementById('environment').value;
    const urlInput = document.getElementById('middlewareUrl');
    
    // Update URL based on environment
    if (environment === 'default') {
        urlInput.value = 'https://preprod-api.myinvois.hasil.gov.my';
    } else if (environment === 'sandbox') {
        urlInput.value = 'https://preprod-api.myinvois.hasil.gov.my';
    } else if (environment === 'production') {
        urlInput.value = 'https://api.myinvois.hasil.gov.my';
    } else {
        urlInput.value = 'https://api.myinvois.hasil.gov.my';
    }

}

function copyUrl() {
    const urlInput = document.getElementById('middlewareUrl');
    
    // Use modern clipboard API
    navigator.clipboard.writeText(urlInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyUrl()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'URL Copied to Clipboard',
            text: 'The LHDN e-Invoice BaseURL has been copied successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });

    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

// Network path validation functions
function validateAndFormatNetworkPath(path) {
    return new Promise((resolve) => {
        // Remove any trailing slashes
        path = path.replace(/\\+$/, '');
        
        // Ensure proper UNC format for network paths
        if (!path.startsWith('\\\\')) {
            if (path.startsWith('\\')) {
                path = '\\' + path;
            } else {
                path = '\\\\' + path;
            }
        }
        
        // Replace forward slashes with backslashes
        path = path.replace(/\//g, '\\');
        
        // Ensure no double backslashes in the middle of the path
        path = path.replace(/\\{2,}/g, '\\\\');
        
        resolve(path);
    });
}

async function testNetworkPathAccessibility(path, credentials) {
    try {
        // Send validation request to backend
        const response = await fetch('/api/config/sap/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath: path,
                domain: credentials.domain,
                username: credentials.username,
                password: credentials.password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Network path validation failed');
        }

        return {
            success: true,
            formattedPath: result.formattedPath || path
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            formattedPath: path
        };
    }
}

function copyNetworkPath() {
    const networkPathInput = document.getElementById('networkPath');
    
    // Use modern clipboard API
    navigator.clipboard.writeText(networkPathInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyNetworkPath()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Network Path Copied',
            text: 'The network path has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });
    }).catch(err => {
        console.error('Failed to copy network path:', err);
        showError('Failed to copy network path');
    });
}

async function copyAccessToken() {
    const tokenInput = document.getElementById('accessToken');
    
    try {
        await navigator.clipboard.writeText(tokenInput.value);
        
        const button = document.querySelector('button[onclick="copyAccessToken()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Access Token Copied',
            text: 'The access token has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });
    } catch (error) {
        console.error('Failed to copy access token:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to copy access token',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function updateAccessToken() {
    try {
        const response = await fetch('/api/config/lhdn/access-token');
        const data = await response.json();
        
        if (data.success) {
            const tokenInput = document.getElementById('accessToken');
            const expiryInfo = document.getElementById('tokenExpiryInfo');
            
            // Update token value
            tokenInput.value = data.accessToken;
            
            // Calculate and display expiry time
            if (data.expiryTime) {
                const expiryDate = new Date(data.expiryTime);
                const now = new Date();
                const minutesLeft = Math.round((expiryDate - now) / 60000);
                
                // Remove all status classes first
                expiryInfo.className = '';
                
                // Add base class and status class based on time left
                if (minutesLeft < 5) {
                    expiryInfo.className = 'status-error';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes! (Critical)`;
                } else if (minutesLeft < 15) {
                    expiryInfo.className = 'status-warning';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes (Warning)`;
                } else {
                    expiryInfo.className = 'status-active';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes`;
                }
            } else {
                expiryInfo.className = 'status-default';
                expiryInfo.textContent = 'Token expiry time not available';
            }

        } else {
            // Show warning if using default token
            if (data.usingDefault) {
                const tokenInput = document.getElementById('accessToken');
                const expiryInfo = document.getElementById('tokenExpiryInfo');
                
                tokenInput.value = data.accessToken;
                expiryInfo.className = 'status-warning';
                expiryInfo.textContent = 'Using default credentials';
                
                await Swal.fire({
                    icon: 'warning',
                    title: 'Using Default Token',
                    text: 'Using default credentials as no custom configuration was found',
                    timer: 5000,
                    timerProgressBar: true,
                    showConfirmButton: true,
                    position: 'top',
                    toast: false
                });
            } else {
                throw new Error(data.error || 'Failed to get access token');
            }
        }
    } catch (error) {
        console.error('Error updating access token:', error);
        
        // Show error in the token field and expiry info
        const tokenInput = document.getElementById('accessToken');
        const expiryInfo = document.getElementById('tokenExpiryInfo');
        
        tokenInput.value = 'Error generating token. Please check your configuration.';
        expiryInfo.className = 'status-error';
        expiryInfo.textContent = 'Token generation failed';
        
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to get access token: ' + error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

// Add auto-refresh of access token
setInterval(updateAccessToken, 5 * 60 * 1000); // Refresh every 5 minutes

// Template preview functionality
async function previewTemplate(templateName) {
    try {
        const modal = new bootstrap.Modal(document.getElementById('templatePreviewModal'));
        const previewFrame = document.getElementById('templatePreviewFrame');
        
        // Sample data following LHDN requirements
        const sampleData = {
            companyName: "Pixelcare Sdn Bhd",
            companyAddress: "Level 15, Menara LGB, 1, Jalan Wan Kadir, Taman Tun Dr Ismail, 60000 Kuala Lumpur, Malaysia",
            companyPhone: "+60 3-7728 7728",
            companyEmail: "finance@pixelcare.com.my",
            
            // Tax registration details
            supplierSSTID: "W10-1234567",  // SST Registration Number
            supplierTIN: "TIN82749174",    // Tax Identification Number
            supplierRegNo: "201901123456", // ROC Number
            supplierMSICCode: "62011",     // MSIC Code for Software Development
            
            // Invoice details
            invoiceNo: "INV-2024-0001",
            invoiceDate: new Date().toLocaleDateString('en-MY'),
            dueDate: new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-MY'), // 30 days from now
            paymentTerms: "Net 30",
            
            // Bank details
            bankName: "Maybank Berhad",
            accountNo: "514012345678",
            swiftCode: "MBBEMYKL",
            
            // Customer details
            buyerName: "Tech Solutions Enterprise Sdn Bhd",
            buyerAddress: "Unit 8-1, Level 8, Wisma UOA Damansara II, No. 6 Changkat Semantan, Damansara Heights, 50490 Kuala Lumpur",
            buyerTIN: "BT48291742",
            buyerPhone: "+60 3-2095 2095",
            
            // Line items with SST
            items: [
                {
                    description: "Enterprise Software License - Annual Subscription",
                    quantity: 1,
                    unitPrice: "12,000.00",
                    sst: "720.00",
                    amount: "12,720.00"
                },
                {
                    description: "Custom Software Development Services",
                    quantity: 80,
                    unitPrice: "150.00",
                    sst: "720.00",
                    amount: "12,720.00"
                },
                {
                    description: "Cloud Infrastructure Setup",
                    quantity: 1,
                    unitPrice: "5,000.00",
                    sst: "300.00",
                    amount: "5,300.00"
                }
            ],
            
            // Totals
            subtotal: "29,000.00",
            sstTotal: "1,740.00",
            totalAmount: "30,740.00",
            
            // Additional details
            digitalSignature: "DS-2024-0001-PC",
            qrCode: "/assets/img/sample-qr.png"
        };

        // Load the template with sample data
        previewFrame.src = `/reports/${templateName}.html`;
        
        previewFrame.onload = function() {
            try {
                // Get the template content
                const frameDoc = previewFrame.contentDocument || previewFrame.contentWindow.document;
                
                // Replace all placeholders with sample data
                let content = frameDoc.documentElement.outerHTML;
                for (const [key, value] of Object.entries(sampleData)) {
                    if (key === 'items') {
                        // Handle items array separately
                        const itemsTemplate = content.match(/{{#each items}}([\s\S]*?){{\/each}}/);
                        if (itemsTemplate && itemsTemplate[1]) {
                            let itemsHtml = '';
                            value.forEach(item => {
                                let itemHtml = itemsTemplate[1];
                                for (const [itemKey, itemValue] of Object.entries(item)) {
                                    itemHtml = itemHtml.replace(new RegExp(`{{${itemKey}}}`, 'g'), itemValue);
                                }
                                itemsHtml += itemHtml;
                            });
                            content = content.replace(/{{#each items}}[\s\S]*?{{\/each}}/, itemsHtml);
                        }
                    } else {
                        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
                    }
                }
                
                // Write the populated content back to the iframe
                frameDoc.open();
                frameDoc.write(content);
                frameDoc.close();
                
                modal.show();
            } catch (error) {
                console.error('Error populating template:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to populate template with sample data'
                });
            }
        };
    } catch (error) {
        console.error('Error loading template:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load template preview'
        });
    }
}

// XML Configuration Functions
async function loadXMLConfig() {
    try {
        const response = await fetch('/api/config/xml/get-config');
        const data = await response.json();
        
        if (data.success && data.settings) {
            // Parse the settings if it's a string
            let settings;
            try {
                settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
            } catch (e) {
                console.error('Settings parse error:', e);
                throw new Error('Invalid settings format');
            }
            
            // Populate form fields
            document.getElementById('xmlNetworkPath').value = settings.networkPath || '';
            document.getElementById('xmlServerName').value = settings.domain || '';
            document.getElementById('xmlUsername').value = settings.username || '';
            // Don't populate password for security reasons
            
            // Update last modified info if available
            const xmlLastModifiedInfo = document.getElementById('xmlLastModifiedInfo');
            const xmlLastModifiedBy = document.getElementById('xmlLastModifiedBy');
            const xmlLastModifiedTime = document.getElementById('xmlLastModifiedTime');

            if (settings.lastModifiedBy) {
                xmlLastModifiedBy.textContent = settings.lastModifiedBy.name || settings.lastModifiedBy.username;
                xmlLastModifiedTime.textContent = new Date(settings.lastModifiedBy.timestamp).toLocaleString();
                xmlLastModifiedInfo.style.display = 'block';
            } else {
                xmlLastModifiedInfo.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error loading XML config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load XML configuration: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function validateXmlPath() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Validating Path',
            text: 'Please wait while we validate the network path...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const networkPath = document.getElementById('xmlNetworkPath').value;
        const domain = document.getElementById('xmlServerName').value;
        const username = document.getElementById('xmlUsername').value;
        const password = document.getElementById('xmlPassword').value;

        // Validate required fields
        if (!networkPath) {
            throw new Error('Network path is required');
        }

        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        // Send validation request
        const response = await fetch('/api/config/xml/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Network path validation failed');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Validation Successful',
            text: 'Network path is valid and accessible',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Update the network path with formatted version if provided
        if (result.formattedPath) {
            document.getElementById('xmlNetworkPath').value = result.formattedPath;
        }

    } catch (error) {
        console.error('Error validating XML path:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Validation Failed',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function saveXmlConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const networkPath = document.getElementById('xmlNetworkPath').value;
        const domain = document.getElementById('xmlServerName').value;
        const username = document.getElementById('xmlUsername').value;
        const password = document.getElementById('xmlPassword').value;

        // Validate required fields
        if (!networkPath) {
            throw new Error('Network path is required');
        }

        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        // Save configuration
        const response = await fetch('/api/config/xml/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save XML configuration');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'XML configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Reload configuration to ensure UI is in sync
        await loadXMLConfig();

    } catch (error) {
        console.error('Error saving XML config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save XML configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

function copyXmlNetworkPath() {
    const networkPathInput = document.getElementById('xmlNetworkPath');
    
    navigator.clipboard.writeText(networkPathInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyXmlNetworkPath()"]');
        const icon = button.querySelector('i');
        
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Network Path Copied',
            text: 'The XML network path has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }).catch(err => {
        console.error('Failed to copy XML network path:', err);
        showError('Failed to copy network path');
    });
}

// Add XML config initialization to the DOMContentLoaded event
document.addEventListener('DOMContentLoaded', () => {
    // Initialize XML configuration
    loadXMLConfig();
});
