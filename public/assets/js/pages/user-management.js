// DOM Elements
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    loadUsersList();
    initializeEventListeners();
});

// Navigation between sections
function initializeEventListeners() {
    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetSection = this.getAttribute('data-section');
            showSection(targetSection);
        });
    });
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.settings-form').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    document.getElementById(sectionId).classList.add('active');
    
    // Update navigation active state
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active');
        if(item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
        }
    });
}

// Users List Functions
function loadUsersList() {
    // TODO: Replace with actual API call
    const mockUsers = [
        {
            id: 1,
            name: 'John Doe',
            email: 'john@example.com',
            role: 'Administrator',
            status: 'Active',
            lastLogin: '2024-02-20 10:30 AM'
        },
        // Add more mock users as needed
    ];
    
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = ''; // Clear existing rows
    
    mockUsers.forEach(user => {
        const row = createUserRow(user);
        tbody.appendChild(row);
    });
}

function createUserRow(user) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${user.name}</td>
        <td>${user.email}</td>
        <td><span class="badge bg-primary">${user.role}</span></td>
        <td><span class="badge bg-success">${user.status}</span></td>
        <td>${user.lastLogin}</td>
        <td>
            <button class="btn btn-sm btn-outline-primary me-1" onclick="editUser(${user.id})">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${user.id})">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    return tr;
}

// Add User Functions
function showAddUserForm() {
    showSection('add-user');
}

function resetForm() {
    document.getElementById('addUserForm').reset();
}

// Edit User Functions
function editUser(userId) {
    // TODO: Replace with actual API call to get user details
    const mockUser = {
        id: userId,
        name: 'John Doe',
        email: 'john@example.com',
        role: 'admin',
        status: 'active'
    };
    
    // Populate the edit form
    document.getElementById('editUserName').value = mockUser.name;
    document.getElementById('editUserEmail').value = mockUser.email;
    document.getElementById('editUserRole').value = mockUser.role;
    document.getElementById('editUserStatus').value = mockUser.status;
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
    modal.show();
}

function saveUserEdit() {
    // TODO: Implement user edit save functionality
    const userData = {
        name: document.getElementById('editUserName').value,
        email: document.getElementById('editUserEmail').value,
        role: document.getElementById('editUserRole').value,
        status: document.getElementById('editUserStatus').value
    };
    
    console.log('Saving user edit:', userData);
    // Close the modal
    bootstrap.Modal.getInstance(document.getElementById('editUserModal')).hide();
    // Reload users list
    loadUsersList();
}

// Delete User Functions
function deleteUser(userId) {
    // Show delete confirmation modal
    const modal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
    modal.show();
    // Store the user ID for the confirmation
    document.getElementById('deleteUserModal').dataset.userId = userId;
}

function confirmDeleteUser() {
    const userId = document.getElementById('deleteUserModal').dataset.userId;
    // TODO: Implement actual delete functionality
    console.log('Deleting user:', userId);
    
    // Close the modal
    bootstrap.Modal.getInstance(document.getElementById('deleteUserModal')).hide();
    // Reload users list
    loadUsersList();
}

// Role Permissions Functions
function loadRolePermissions() {
    const role = document.getElementById('roleSelector').value;
    // TODO: Replace with actual API call to get role permissions
    const mockPermissions = {
        admin: {
            dashboard_view: true,
            dashboard_export: true,
            users_view: true,
            users_create: true,
            users_edit: true,
            users_delete: true,
            invoices_view: true,
            invoices_create: true,
            invoices_edit: true,
            invoices_delete: true,
            invoices_approve: true,
            settings_view: true,
            settings_edit: true
        },
        user: {
            dashboard_view: true,
            dashboard_export: false,
            users_view: false,
            users_create: false,
            users_edit: false,
            users_delete: false,
            invoices_view: true,
            invoices_create: true,
            invoices_edit: true,
            invoices_delete: false,
            invoices_approve: false,
            settings_view: true,
            settings_edit: false
        },
        viewer: {
            dashboard_view: true,
            dashboard_export: false,
            users_view: false,
            users_create: false,
            users_edit: false,
            users_delete: false,
            invoices_view: true,
            invoices_create: false,
            invoices_edit: false,
            invoices_delete: false,
            invoices_approve: false,
            settings_view: true,
            settings_edit: false
        }
    };
    
    // Update checkboxes based on role permissions
    Object.keys(mockPermissions[role]).forEach(permission => {
        const checkbox = document.getElementById(`perm_${permission}`);
        if (checkbox) {
            checkbox.checked = mockPermissions[role][permission];
        }
    });
}

function saveRolePermissions() {
    const role = document.getElementById('roleSelector').value;
    const permissions = {};
    
    // Collect all permission values
    document.querySelectorAll('.permission-items input[type="checkbox"]').forEach(checkbox => {
        const permissionName = checkbox.id.replace('perm_', '');
        permissions[permissionName] = checkbox.checked;
    });
    
    // TODO: Implement actual save functionality
    console.log('Saving permissions for role:', role, permissions);
    
    // Show success message
    alert('Permissions saved successfully!');
} 