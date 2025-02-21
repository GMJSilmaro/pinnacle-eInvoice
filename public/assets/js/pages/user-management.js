// User Management Functions
document.addEventListener('DOMContentLoaded', function() {
    // Load users list on page load
    loadUsersList();

    // Initialize event listeners
    initializeEventListeners();
});

// Global variables for user management
let currentUserId = null;
let usersTable = null;

function initializeEventListeners() {
    // Add user form submission
    document.getElementById('addUserForm')?.addEventListener('submit', handleAddUser);

    // Edit user form submission
    document.getElementById('editUserForm')?.addEventListener('submit', handleEditUser);

    // Load company TINs when modal opens
    document.getElementById('addUserModal')?.addEventListener('show.bs.modal', async function() {
        try {
            const response = await fetch('/api/user/company/list');
            if (!response.ok) {
                throw new Error('Failed to fetch companies');
            }
            
            const companies = await response.json();
            const tinSelect = document.getElementById('newUserTIN');
            tinSelect.innerHTML = '<option value="">Select Company TIN</option>';
            
            companies.forEach(company => {
                const option = document.createElement('option');
                option.value = company.TIN || company.BRN;
                option.textContent = `${company.CompanyName} (${company.TIN || company.BRN})`;
                option.dataset.companyData = JSON.stringify(company);
                tinSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading company data:', error);
            showToast('error', 'Failed to load company information');
        }
    });

    // Handle TIN selection change
    document.getElementById('newUserTIN')?.addEventListener('change', function(e) {
        const selectedOption = this.options[this.selectedIndex];
        if (selectedOption.dataset.companyData) {
            const companyData = JSON.parse(selectedOption.dataset.companyData);
            // Auto-fill company related fields if needed
            document.getElementById('newUserIDType').value = 'BRN';
            document.getElementById('newUserIDValue').value = companyData.BRN || '';
            // You can add more auto-fill fields here
        }
    });

    // Username generation from full name with suggestions
    document.getElementById('newUserName')?.addEventListener('input', function(e) {
        const fullName = e.target.value;
        const email = document.getElementById('newUserEmail').value;
        const suggestions = generateUsernameSuggestions(fullName, email);
        
        // Update dropdown suggestions
        const dropdown = document.getElementById('usernameSuggestions');
        dropdown.innerHTML = '';
        suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'dropdown-item';
            a.href = '#';
            a.textContent = suggestion;
            a.onclick = (e) => {
                e.preventDefault();
                document.getElementById('newUserUsername').value = suggestion;
            };
            li.appendChild(a);
            dropdown.appendChild(li);
        });
        
        // Set first suggestion as default if username field is empty
        const usernameField = document.getElementById('newUserUsername');
        if (!usernameField.value && suggestions.length > 0) {
            usernameField.value = suggestions[0];
        }
    });

    // Username generation from email (as backup)
    document.getElementById('newUserEmail')?.addEventListener('input', function(e) {
        const email = e.target.value;
        const usernameField = document.getElementById('newUserUsername');
        const nameField = document.getElementById('newUserName');
        // Only update username if name field is empty
        if (usernameField && email && !nameField.value.trim()) {
            const username = email.split('@')[0].toLowerCase()
                .replace(/[^a-z0-9]/g, '') // Remove special characters
                .substring(0, 15); // Limit length to 15 characters
            usernameField.value = username;
        }
    });

    // Navigation between sections
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetSection = this.getAttribute('data-section');
            showSection(targetSection);
        });
    });

    // Search functionality
    const searchInput = document.querySelector('.search-box input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function(e) {
            filterUsers(e.target.value);
        }, 300));
    }
}

// Load users list
async function loadUsersList() {
    try {
        const response = await fetch('/api/user/users-list');
        if (!response.ok) throw new Error('Failed to fetch users');
        
        const users = await response.json();
        displayUsers(users);
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('error', 'Failed to load users list');
    }
}

// Display users in table
function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(user.FullName)}</td>
            <td>
                <div class="user-info">
                    <div>${escapeHtml(user.Email)}</div>
                    <small class="text-muted">${escapeHtml(user.Username || '')}</small>
                </div>
            </td>
            <td>
                <div class="badge-group">
                    <span class="badge ${user.Admin ? 'badge bg-info' : 'bg-secondary'}">${user.Admin ? 'Administrator' : 'User'}</span>
                </div>
            </td>
            <td>
                <div class="status-group">
                    <span class="badge ${user.ValidStatus === '1' ? 'bg-success' : 'bg-danger'}">${user.ValidStatus === '1' ? 'Active' : 'Inactive'}</span>
                </div>
            </td>
            <td>${user.LastLoginTime ? new Date(user.LastLoginTime).toLocaleString() : 'Never'}</td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-primary" onclick="editUser(${user.ID})" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.ID})" title="Delete User">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Add new user
async function handleAddUser(e) {
    e.preventDefault();

    // Get form data
    const formData = {
        fullName: document.getElementById('newUserName').value.trim(),
        email: document.getElementById('newUserEmail').value.trim(),
        username: document.getElementById('newUserUsername').value.trim(),
        password: generateTemporaryPassword(),
        userType: document.getElementById('newUserRole').value,
        // Properly handle TIN based on which input is visible
        TIN: document.getElementById('newUserTIN').style.display !== 'none' 
            ? document.getElementById('newUserTIN').value 
            : document.getElementById('newUserCustomTIN').value,
        IDType: document.getElementById('newUserIDType').value,
        IDValue: document.getElementById('newUserIDValue').value,
        phone: document.getElementById('newUserPhone').value.trim(),
        admin: document.getElementById('newUserRole').value === 'admin' ? 1 : 0,
        validStatus: '1',
        twoFactorEnabled: document.getElementById('newUserTwoFactor').checked,
        notificationsEnabled: document.getElementById('newUserNotifications').checked,
        createTS: new Date().toISOString(),
        lastLoginTime: null,
        profilePicture: null // Default profile picture will be handled by the server
    };

    // Additional validation for TIN and ID fields
    if (formData.TIN) {
        formData.TIN = formData.TIN.trim().toUpperCase(); // Ensure TIN is uppercase
    }

    if (formData.IDType && !formData.IDValue) {
        showToast('error', 'Please provide an ID Value when ID Type is selected');
        return;
    }

    if (!formData.IDType && formData.IDValue) {
        showToast('error', 'Please select an ID Type when providing an ID Value');
        return;
    }

    // Validate required fields
    const requiredFields = ['fullName', 'email', 'username'];
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
        showToast('error', `Please fill in all required fields: ${missingFields.join(', ')}`);
        return;
    }

    // Validate email format
    if (!isValidEmail(formData.email)) {
        showToast('error', 'Please enter a valid email address');
        return;
    }

    try {
        const response = await fetch('/api/user/users-add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                ...formData,
                // Ensure these fields are properly formatted for the database
                TIN: formData.TIN || null,
                IDType: formData.IDType || null,
                IDValue: formData.IDValue || null
            })
        });

        const data = await response.json();

        if (data.success) {
            // Hide the add user modal
            const addUserModal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
            addUserModal.hide();

            // Show success message
            showToast('success', 'User added successfully');

            // Show the temporary password
            showPasswordModal(formData.email, formData.password);

            // Reset form
            document.getElementById('addUserForm').reset();

            // Reload users list
            loadUsersList();
        } else {
            showToast('error', data.message || 'Failed to add user');
        }
    } catch (error) {
        console.error('Error adding user:', error);
        showToast('error', 'Failed to add user');
    }
}

// Add email validation helper function
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Add this function to load company TINs
async function loadCompanyTINs(selectId, selectedTIN = '') {
    try {
        const response = await fetch('/api/user/company/list');
        if (!response.ok) {
            throw new Error('Failed to fetch companies');
        }
        
        const companies = await response.json();
        const tinSelect = document.getElementById(selectId);
        tinSelect.innerHTML = '<option value="">Select Company TIN</option>';
        
        companies.forEach(company => {
            const option = document.createElement('option');
            option.value = company.TIN || company.BRN;
            option.textContent = `${company.CompanyName} (${company.TIN || company.BRN})`;
            option.selected = (company.TIN === selectedTIN || company.BRN === selectedTIN);
            tinSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading company data:', error);
        showToast('error', 'Failed to load company information');
    }
}

// Edit user
async function editUser(userId) {
    try {
        const response = await fetch(`/api/user/users-list/${userId}`);
        const userData = await response.json();

        const modalHtml = `
            <div class="modal fade" id="editUserModal" tabindex="-1" aria-labelledby="editUserModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="editUserModalLabel">
                                <i class="fas fa-user-edit"></i>
                                Edit User
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <form id="editUserForm" class="modal-form-container">
                                <input type="hidden" id="editUserId" value="${userId}">
                                
                                <!-- Basic Information -->
                                <div class="form-group">
                                    <label for="editUserName" class="form-label required">Full Name</label>
                                    <input type="text" class="form-control" id="editUserName" value="${escapeHtml(userData.FullName)}" required minlength="2" maxlength="100">
                                </div>

                                <div class="form-group">
                                    <label for="editUserEmail" class="form-label required">Email Address</label>
                                    <input type="email" class="form-control" id="editUserEmail" value="${escapeHtml(userData.Email)}" required pattern="[^@\\s]+@[^@\\s]+\\.[^@\\s]+" maxlength="255">
                                </div>

                                <div class="form-group">
                                    <label for="editUserPhone" class="form-label">Phone Number</label>
                                    <input type="tel" class="form-control" id="editUserPhone" value="${escapeHtml(userData.Phone || '')}" pattern="[0-9+()\\-\\s]+" maxlength="20">
                                    <small class="text-muted">Include country code (e.g., +1234567890)</small>
                                </div>

                                <div class="form-group">
                                    <label for="editUserRole" class="form-label required">Role</label>
                                    <select class="form-select" id="editUserRole" required>
                                        <option value="">Select Role</option>
                                        <option value="admin" ${userData.Admin ? 'selected' : ''}>Administrator</option>
                                        <option value="user" ${!userData.Admin ? 'selected' : ''}>Regular User</option>
                                    </select>
                                </div>

                                <!-- Company Information -->
                                <div class="form-group">
                                    <label for="editUserTIN" class="form-label">Company TIN</label>
                                    <div class="input-group">
                                        <select class="form-select" id="editUserTIN">
                                            <option value="">Select Company TIN</option>
                                            <!-- Will be populated dynamically -->
                                        </select>
                                        <input type="text" class="form-control" id="editUserCustomTIN" placeholder="Or enter custom TIN" style="display: none;" pattern="[A-Z0-9\\-]+" maxlength="50" value="${escapeHtml(userData.TIN || '')}">
                                        <button class="btn btn-outline-secondary" type="button" onclick="toggleTINInput('edit')">
                                            <i class="fas fa-exchange-alt"></i>
                                        </button>
                                    </div>
                                    <small class="text-muted">Select from existing companies or enter a new one</small>
                                </div>

                                <div class="form-group">
                                    <label for="editUserIDType" class="form-label">ID Type</label>
                                    <select class="form-select" id="editUserIDType">
                                        <option value="">Select ID Type</option>
                                        <option value="BRN" ${userData.IDType === 'BRN' ? 'selected' : ''}>BRN</option>
                                        <option value="Passport" ${userData.IDType === 'Passport' ? 'selected' : ''}>Passport</option>
                                        <option value="National ID" ${userData.IDType === 'National ID' ? 'selected' : ''}>National ID</option>
                                        <option value="Driver's License" ${userData.IDType === "Driver's License" ? 'selected' : ''}>Driver's License</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label for="editUserIDValue" class="form-label">ID Value</label>
                                    <input type="text" class="form-control" id="editUserIDValue" value="${escapeHtml(userData.IDValue || '')}" pattern="[A-Z0-9\\-]+" maxlength="50">
                                </div>

                                <!-- Password Change Section -->
                                <div class="form-group">
                                    <label for="editUserPassword" class="form-label d-flex justify-content-between align-items-center">
                                        <span>Change Password</span>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="generateNewPassword('editUserPassword')">
                                            Generate New Password
                                        </button>
                                    </label>
                                    <div class="input-group">
                                        <input type="password" 
                                               class="form-control" 
                                               id="editUserPassword" 
                                               placeholder="Leave blank to keep current password"
                                               autocomplete="new-password">
                                        <button type="button" class="btn btn-outline-secondary" onclick="togglePasswordVisibility('editUserPassword')">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                    </div>
                                    <small class="text-muted">Minimum 8 characters, must include uppercase, lowercase, number, and special character</small>
                                </div>

                                <!-- Security Settings -->
                                <div class="form-group">
                                    <label class="form-label d-block">Security Settings</label>
                                    <div class="form-check form-switch">
                                        <input type="checkbox" class="form-check-input" id="editUserTwoFactor" ${userData.TwoFactorEnabled ? 'checked' : ''}>
                                        <label class="form-check-label" for="editUserTwoFactor">Enable Two-Factor Authentication</label>
                                    </div>
                                    <div class="form-check form-switch mt-2">
                                        <input type="checkbox" class="form-check-input" id="editUserNotifications" ${userData.NotificationsEnabled ? 'checked' : ''}>
                                        <label class="form-check-label" for="editUserNotifications">Enable Notifications</label>
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="handleEditUser(event)">
                                <i class="fas fa-save"></i> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        // Remove existing modal if it exists
        const existingModal = document.getElementById('editUserModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add new modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize and show the modal
        const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
        modal.show();

        // If custom TIN is being used, switch to custom TIN input
        if (userData.TIN && !document.querySelector(`#editUserTIN option[value="${userData.TIN}"]`)) {
            toggleTINInput('edit');
            document.getElementById('editUserCustomTIN').value = userData.TIN;
        }
    } catch (error) {
        console.error('Error fetching user details:', error);
        showToast('error', 'Failed to load user details');
    }
}

// Handle edit user form submission
async function handleEditUser(e) {
    e.preventDefault();

    const userId = document.getElementById('editUserId').value;
    const password = document.getElementById('editUserPassword').value;
    const tinSelect = document.getElementById('editUserTIN');
    const customTIN = document.getElementById('editUserCustomTIN');

    const formData = {
        fullName: document.getElementById('editUserName').value.trim(),
        email: document.getElementById('editUserEmail').value.trim(),
        phone: document.getElementById('editUserPhone').value.trim(),
        tin: tinSelect.style.display !== 'none' ? tinSelect.value : customTIN.value,
        idType: document.getElementById('editUserIDType').value,
        idValue: document.getElementById('editUserIDValue').value.trim(),
        admin: document.getElementById('editUserRole').value === 'admin' ? 1 : 0,
        twoFactorEnabled: document.getElementById('editUserTwoFactor').checked,
        notificationsEnabled: document.getElementById('editUserNotifications').checked
    };

    // Only include password if it was changed
    if (password) {
        formData.password = password;
    }

    // Additional validation for TIN and ID fields
    if (formData.idType && !formData.idValue) {
        showToast('error', 'Please provide an ID Value when ID Type is selected');
        return;
    }

    if (!formData.idType && formData.idValue) {
        showToast('error', 'Please select an ID Type when providing an ID Value');
        return;
    }

    // Validate required fields
    if (!formData.fullName || !formData.email) {
        showToast('error', 'Please fill in all required fields');
        return;
    }

    // Validate email format
    if (!isValidEmail(formData.email)) {
        showToast('error', 'Please enter a valid email address');
        return;
    }

    try {
        const response = await fetch(`/api/user/users-update/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                ...formData,
                // Ensure these fields are properly formatted for the database
                TIN: formData.tin || null,
                IDType: formData.idType || null,
                IDValue: formData.idValue || null
            })
        });

        const data = await response.json();

        if (data.success) {
            // Hide the edit user modal
            const editUserModal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
            editUserModal.hide();

            // Show success message
            showToast('success', 'User updated successfully');

            // If password was changed, show it in a modal
            if (password) {
                showPasswordModal(formData.email, password);
            }

            // Reload users list
            loadUsersList();
        } else {
            showToast('error', data.message || 'Failed to update user');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showToast('error', 'Failed to update user');
    }
}

// Toggle password visibility
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling.querySelector('i');
    
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

// Generate new password
function generateNewPassword(inputId) {
    const input = document.getElementById(inputId);
    const password = generateTemporaryPassword();
    input.type = 'text';
    input.value = password;
    
    // Update the eye icon
    const icon = input.nextElementSibling.querySelector('i');
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
}

// Delete user
async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
        const response = await fetch(`/api/user/users-delete/${userId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showToast('success', 'User deleted successfully');
            loadUsersList();
        } else {
            showToast('error', data.message || 'Failed to delete user');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('error', 'Failed to delete user');
    }
}

// Utility functions
function showSection(sectionId) {
    document.querySelectorAll('.settings-form').forEach(form => {
        form.classList.remove('active');
    });
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active');
    });

    document.getElementById(sectionId).classList.add('active');
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');
}

function generateUsername(fullName) {
    return fullName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 8) + Math.floor(Math.random() * 1000);
}

function generateTemporaryPassword() {
    const length = 12;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showToast(type, message) {
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white bg-${type === 'success' ? 'success' : 'danger'} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    // Add toast to container
    toastContainer.appendChild(toastEl);

    // Initialize and show toast
    const toast = new bootstrap.Toast(toastEl, {
        animation: true,
        autohide: true,
        delay: 3000
    });
    toast.show();

    // Remove toast element after it's hidden
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

// Filter users based on search input
function filterUsers(searchTerm) {
    const rows = document.querySelectorAll('#usersTableBody tr');
    searchTerm = searchTerm.toLowerCase();

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

// View user details
async function viewDetails(userId) {
    try {
        const response = await fetch(`/api/user/users-list/${userId}`);
        const userData = await response.json();

        const modal = new bootstrap.Modal(document.getElementById('userDetailsModal'));
        const modalBody = document.querySelector('#userDetailsModal .modal-body');

        modalBody.innerHTML = `
            <div class="user-details-container">
                <div class="user-profile-section">
                    <img src="${userData.ProfilePicture || '/assets/img/default-avatar.png'}" 
                         alt="Profile Picture" class="profile-picture">
                    <h4>${escapeHtml(userData.FullName)}</h4>
                    <p class="text-muted">${escapeHtml(userData.Username)}</p>
                </div>
                
                <div class="details-grid">
                    <div class="detail-item">
                        <label>Email:</label>
                        <span>${escapeHtml(userData.Email)}</span>
                    </div>
                    <div class="detail-item">
                        <label>Phone:</label>
                        <span>${escapeHtml(userData.Phone || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>TIN:</label>
                        <span>${escapeHtml(userData.TIN || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>ID Type:</label>
                        <span>${escapeHtml(userData.IDType || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>ID Value:</label>
                        <span>${escapeHtml(userData.IDValue || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>User Type:</label>
                        <span>${escapeHtml(userData.UserType || 'Standard')}</span>
                    </div>
                    <div class="detail-item">
                        <label>Created:</label>
                        <span>${new Date(userData.CreateTS).toLocaleString()}</span>
                    </div>
                    <div class="detail-item">
                        <label>Last Login:</label>
                        <span>${userData.LastLoginTime ? new Date(userData.LastLoginTime).toLocaleString() : 'Never'}</span>
                    </div>
                </div>

                <div class="user-settings-section">
                    <h5>Security Settings</h5>
                    <div class="settings-grid">
                        <div class="setting-item">
                            <i class="fas ${userData.TwoFactorEnabled ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'}"></i>
                            Two-Factor Authentication
                        </div>
                        <div class="setting-item">
                            <i class="fas ${userData.NotificationsEnabled ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'}"></i>
                            Notifications
                        </div>
                    </div>
                </div>
            </div>
        `;

        modal.show();
    } catch (error) {
        console.error('Error fetching user details:', error);
        showToast('error', 'Failed to load user details');
    }
}

// Show temporary password modal
function showPasswordModal(email, password) {
    const modal = new bootstrap.Modal(document.getElementById('tempPasswordModal'));
    const modalBody = document.querySelector('#tempPasswordModal .modal-body');
    
    modalBody.innerHTML = `
        <div class="alert alert-warning">
            <strong>Important!</strong> Please save or send these credentials securely.
        </div>
        <div class="credentials-container">
            <div class="credential-item">
                <label>Email:</label>
                <span>${escapeHtml(email)}</span>
            </div>
            <div class="credential-item">
                <label>Temporary Password:</label>
                <div class="password-display">
                    <code>${escapeHtml(password)}</code>
                    <button class="btn btn-sm btn-outline-secondary" onclick="copyToClipboard('${password}')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modal.show();
}

// Copy to clipboard utility
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('success', 'Copied to clipboard');
    }).catch(() => {
        showToast('error', 'Failed to copy to clipboard');
    });
}

// Add this helper function
function generateUsernameSuggestions(fullName, email) {
    const suggestions = [];
    const nameParts = fullName.toLowerCase().split(' ');
    
    if (nameParts.length > 0) {
        // First name + random number
        suggestions.push(nameParts[0] + Math.floor(Math.random() * 1000));
        
        // First name + last name (if exists)
        if (nameParts.length > 1) {
            suggestions.push(nameParts[0] + nameParts[nameParts.length - 1]);
            suggestions.push(nameParts[0][0] + nameParts[nameParts.length - 1]);
        }
    }
    
    // From email if available
    if (email) {
        const emailUsername = email.split('@')[0].toLowerCase();
        suggestions.push(emailUsername);
    }
    
    // Clean up and ensure uniqueness
    return [...new Set(suggestions.map(s => s.replace(/[^a-z0-9]/g, '')))];
}

// Update the toggleTINInput function to handle both add and edit forms
function toggleTINInput(mode = 'add') {
    const prefix = mode === 'edit' ? 'edit' : 'new';
    const select = document.getElementById(`${prefix}UserTIN`);
    const input = document.getElementById(`${prefix}UserCustomTIN`);
    
    if (select.style.display !== 'none') {
        select.style.display = 'none';
        input.style.display = 'block';
        input.value = select.value; // Transfer the selected value if any
    } else {
        select.style.display = 'block';
        input.style.display = 'none';
        select.value = ''; // Clear the dropdown selection
    }
} 