const express = require('express');
const router = express.Router();
const db = require('../../models');
const { WP_USER_REGISTRATION, WP_LOGS, sequelize } = require('../../models');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Op } = require('sequelize');
const { auth } = require('../../middleware');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const uploadDir = file.fieldname === 'avatar' ? 
            'public/uploads/avatars' : 
            'public/uploads/signatures';
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const prefix = file.fieldname === 'avatar' ? 'avatar-' : 'signature-';
        cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'avatar') {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
    } else if (file.fieldname === 'signature') {
        if (!file.originalname.match(/\.(pfx|p12)$/i)) {
            return cb(new Error('Only PFX/P12 files are allowed!'), false);
        }
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Middleware to check if user is authenticated and is admin
const checkAdmin = (req, res, next) => {
    if (!req.session?.user?.admin) {
        return res.status(403).json({ 
            success: false, 
            message: 'Admin access required' 
        });
    }
    next();
};

// Get list of all users (admin only)
router.get('/users-list', checkAdmin, async (req, res) => {
    try {
        // Parse pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // Get total count for pagination
        const totalCount = await WP_USER_REGISTRATION.count();
        
        // Fetch users with pagination
        const users = await WP_USER_REGISTRATION.findAll({
            attributes: [
                'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
                'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
                'CreateTS', 'LastLoginTime', 'ProfilePicture'
            ],
            order: [['CreateTS', 'DESC']],
            limit: limit,
            offset: offset
        });

        res.json({
            users,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit)
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users'
        });
    }
});

// Get single user details (admin only)
router.get('/users-list/:id', checkAdmin, async (req, res) => {
    try {
        const user = await WP_USER_REGISTRATION.findByPk(req.params.id, {
            attributes: [
                'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
                'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
                'CreateTS', 'LastLoginTime', 'ProfilePicture'
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json(user);
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user details'
        });
    }
});

// Add new user (admin only)
router.post('/users-add', checkAdmin, async (req, res) => {
    try {
        const {
            fullName, email, username, password, userType,
            phone, admin, twoFactorEnabled, notificationsEnabled,
            validStatus, profilePicture, TIN, IDType, IDValue
        } = req.body;

        // Validate required fields
        if (!fullName || !email || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Required fields missing'
            });
        }

        // Check if username or email already exists
        const existingUser = await WP_USER_REGISTRATION.findOne({
            where: {
                [Op.or]: [
                    { Username: username },
                    { Email: email }
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or email already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user with all fields
        const newUser = await WP_USER_REGISTRATION.create({
            FullName: fullName,
            Email: email,
            Username: username,
            Password: hashedPassword,
            UserType: userType || null,
            TIN: TIN || null,
            IDType: IDType || null,
            IDValue: IDValue || null,
            Phone: phone || null,
            Admin: admin ? 1 : 0,
            ValidStatus: validStatus || '1',
            TwoFactorEnabled: twoFactorEnabled ? 1 : 0,
            NotificationsEnabled: notificationsEnabled ? 1 : 0,
            ProfilePicture: profilePicture || null,
            CreateTS: sequelize.literal('GETDATE()'),
            UpdateTS: sequelize.literal('GETDATE()'),
        });

        // Log the action
        await WP_LOGS.create({
            Description: `User ${req.session.user.username} created new user: ${username}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.session.user.username,
            Action: 'CREATE_USER',
            IPAddress: req.ip
        });

        // Fetch the created user with all fields
        const createdUser = await WP_USER_REGISTRATION.findByPk(newUser.ID, {
            attributes: [
                'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
                'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
                'CreateTS', 'LastLoginTime', 'ProfilePicture'
            ]
        });

        res.json({
            success: true,
            message: 'User created successfully',
            user: createdUser
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user: ' + error.message
        });
    }
});

// Update user (admin only)
router.put('/users-update/:id', checkAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { email, fullName, password } = req.body;

        // Validate required fields
        if (!email || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Full Name and Email are required'
            });
        }

        // Get existing user data to preserve other fields
        const user = await WP_USER_REGISTRATION.findByPk(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if email is already used by another user
        const existingUser = await WP_USER_REGISTRATION.findOne({
            where: {
                Email: email,
                ID: { [Op.ne]: id }
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email is already in use by another user'
            });
        }

        // Prepare update data (email, fullName and timestamp)
        const updateData = {
            Email: email,
            FullName: fullName,
            UpdateTS: sequelize.literal('GETDATE()')
        };

        // Only update password if provided
        if (password) {
            const saltRounds = 10;
            updateData.Password = await bcrypt.hash(password, saltRounds);
        }

        // Update user profile
        await WP_USER_REGISTRATION.update(updateData, {
            where: { ID: id }
        });

        // Get updated user data
        const updatedUser = await WP_USER_REGISTRATION.findByPk(id, {
            attributes: [
                'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
                'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
                'CreateTS', 'LastLoginTime', 'ProfilePicture', 'TIN', 'IDType', 'IDValue'
            ]
        });

        // Log the update
        await WP_LOGS.create({
            Description: `Admin ${req.session.user.username} updated user information for id ${id}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.session.user.username,
            Action: 'UPDATE_USER',
            IPAddress: req.ip,
            Details: JSON.stringify({
                updatedFields: Object.keys(updateData).join(', '),
                userId: id
            })
        });

        res.json({
            success: true,
            message: 'User updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user: ' + error.message
        });
    }
});

// Delete user (admin only)
router.delete('/users-delete/:id', checkAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Get user details for logging
        const user = await WP_USER_REGISTRATION.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Prevent deleting own account
        if (user.ID === req.session.user.id) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete your own account'
            });
        }

        // Delete profile picture if exists
        if (user.ProfilePicture) {
            try {
                const filePath = path.join('public', user.ProfilePicture);
                await fs.unlink(filePath);
            } catch (error) {
                console.error('Error deleting profile picture:', error);
            }
        }

        // Delete user
        await WP_USER_REGISTRATION.destroy({
            where: { ID: userId }
        });

        // Log the action
        await WP_LOGS.create({
            Description: `User ${req.session.user.username} deleted user: ${user.Username}`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.session.user.username,
            Action: 'DELETE_USER',
            IPAddress: req.ip
        });

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user: ' + error.message
        });
    }
});

// Upload digital signature
router.post('/upload-signature', checkAdmin, upload.single('signature'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        const signatureUrl = '/uploads/signatures/' + req.file.filename;
        
        res.json({
            success: true,
            message: 'Signature uploaded successfully',
            path: signatureUrl,
            filename: req.file.filename
        });
    } catch (error) {
        // Delete uploaded file if there's an error
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting uploaded file:', unlinkError);
            }
        }
        
        console.error('Error uploading signature:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload signature: ' + error.message
        });
    }
});

router.post('/auth/logout', checkAdmin, async (req, res) => {
    try {
        req.session.destroy();
        res.json({
            success: true,
            message: 'User logged out successfully'
        });
    } catch (error) {
        console.error('Error logging out user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to log out user: ' + error.message
        });
    }
});

// Extend session endpoint
router.post('/extend-session', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        // Get user from database to ensure they still exist and are valid
        const user = await WP_USER_REGISTRATION.findOne({
            where: {
                ID: req.session.user.id,
                ValidStatus: 1
            },
            attributes: ['ID', 'Username', 'FullName']
        });

        if (!user) {
            // User no longer exists or is no longer valid
            req.session.destroy((err) => {
                if (err) console.error('Error destroying invalid session:', err);
            });
            return res.status(401).json({
                success: false,
                message: 'User account is no longer valid'
            });
        }

        // Update session timestamp and touch the session
        req.session.lastActivity = Date.now();
        req.session.touch(); // This explicitly tells the session store to refresh the session
        
        // Log session extension
        await WP_LOGS.create({
            Description: `User ${req.session.user.username} extended their session`,
            CreateTS: sequelize.literal('GETDATE()'),
            LoggedUser: req.session.user.username,
            Action: 'EXTEND_SESSION',
            IPAddress: req.ip
        });

        // Return session info with the response
        res.json({
            success: true,
            message: 'Session extended successfully',
            sessionInfo: {
                username: user.Username,
                fullName: user.FullName,
                lastActivity: req.session.lastActivity,
                // Calculate when the session will expire
                expiresAt: new Date(Date.now() + req.session.cookie.maxAge).toISOString()
            }
        });
    } catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to extend session'
        });
    }
});

// Lightweight session check endpoint
router.get('/check-session', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session || !req.session.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        // Simply return success if session exists
        return res.json({
            success: true,
            message: 'Session is valid',
            username: req.session.user.username
        });
    } catch (error) {
        console.error('Error checking session:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check session'
        });
    }
});

// Profile endpoint for session checking
router.get('/profile', async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        const user = await WP_USER_REGISTRATION.findOne({
            where: { ID: req.session.user.id },
            attributes: [
                'ID', 'FullName', 'Email', 'Phone', 'Username', 'Admin', 
                'TIN', 'IDType', 'IDValue', 'CreateTS', 'ValidStatus',
                'LastLoginTime', 'ProfilePicture', 'TwoFactorEnabled',
                'NotificationsEnabled', 'UpdateTS'
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: user
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user profile'
        });
    }
});

// Update user profile
router.post('/update-profile', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // Get user ID from session
        const userId = req.session.user.ID || req.session.user.id;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID not found in session'
            });
        }

        const { fullName, email, phone } = req.body;

        // Validate required fields
        if (!fullName || !email) {
            return res.status(400).json({
                success: false,
                message: 'Full Name and Email are required'
            });
        }

        // Check if email is already used by another user
        const existingUser = await WP_USER_REGISTRATION.findOne({
            where: {
                Email: email,
                ID: { [Op.ne]: userId }
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email is already in use by another user'
            });
        }

        // Update user profile
        await WP_USER_REGISTRATION.update({
            FullName: fullName,
            Email: email,
            Phone: phone,
            UpdateTS: sequelize.literal('GETDATE()')
        }, {
            where: { ID: userId }
        });

        // Update session data
        if (req.session.user) {
            req.session.user.FullName = fullName;
            req.session.user.Email = email;
            req.session.user.Phone = phone;
        }

        // Log the update
        await WP_LOGS.create({
            Description: `User ${req.session.user.Username || req.session.user.username} updated their profile`,
            CreateTS: new Date().toISOString(),
            LoggedUser: req.session.user.Username || req.session.user.username,
            Action: 'UPDATE_PROFILE',
            Details: JSON.stringify({
                fullName,
                email,
                phone,
            })
        });

        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile: ' + error.message
        });
    }
});

// Update profile picture
router.post('/update-avatar', upload.single('avatar'), async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session || !req.session.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        // Get user ID from session (handle both upper and lowercase)
        const userId = req.session.user.ID || req.session.user.id;
        
        if (!userId) {
            console.error('Session user ID not found:', req.session.user);
            return res.status(401).json({
                success: false,
                message: 'User ID not found in session'
            });
        }

        const user = await WP_USER_REGISTRATION.findByPk(userId);

        if (!user) {
            // Log the issue for debugging
            console.error('User not found with ID:', userId);
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Delete old profile picture if exists
        if (user.ProfilePicture) {
            try {
                const oldFilePath = path.join('public', user.ProfilePicture);
                await fs.unlink(oldFilePath);
            } catch (error) {
                console.error('Error deleting old profile picture:', error);
            }
        }

        // Update user's profile picture path
        const avatarPath = '/uploads/avatars/' + req.file.filename;
        
        // Format date to match MSSQL format without timezone
        const formattedDate = moment().utc().format('YYYY-MM-DD HH:mm:ss.SSS');
        
        await WP_USER_REGISTRATION.update({
            ProfilePicture: avatarPath,
            UpdateTS: sequelize.literal(`CAST('${formattedDate}' AS DATETIME2)`)
        }, {
            where: { ID: userId }
        });

        // Update session with new avatar path
        if (req.session.user.ID) {
            req.session.user.ProfilePicture = avatarPath;
        } else if (req.session.user.id) {
            req.session.user.profilePicture = avatarPath;
        }

        res.json({
            success: true,
            message: 'Profile picture updated successfully',
            avatarUrl: avatarPath
        });

    } catch (error) {
        console.error('Error updating profile picture:', error);
        // If there was an error, try to delete the uploaded file
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting uploaded file after error:', unlinkError);
            }
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update profile picture: ' + error.message
        });
    }
});

// Change password
router.post('/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'All password fields are required'
            });
        }

        // Check if passwords match
        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'New passwords do not match'
            });
        }

        // Get user with current password
        const user = await WP_USER_REGISTRATION.findOne({
            where: { ID: req.session?.user?.id }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.Password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Password strength validation
        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters long'
            });
        }

        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one uppercase letter'
            });
        }

        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one lowercase letter'
            });
        }

        if (!/[0-9]/.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one number'
            });
        }

        if (!/[!@#$%^&*]/.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one special character (!@#$%^&*)'
            });
        }

        // Hash new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await WP_USER_REGISTRATION.update({
            Password: hashedPassword,
            UpdateTS: sequelize.literal('GETDATE()')
        }, {
            where: { ID: user.ID }
        });

        // Log the password change
        await WP_LOGS.create({
            Description: `User ${user.Username} changed their password`,
            CreateTS: new Date().toISOString(),
            LoggedUser: user.Username,
            Action: 'CHANGE_PASSWORD',
            IPAddress: req.ip
        });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password: ' + error.message
        });
    }
});

// Get user security settings
router.get('/security-settings', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }

    // Use session user ID instead of req.user
    const userId = req.session.user.ID || req.session.user.id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found in session'
      });
    }

    const config = await db.WP_CONFIGURATION.findActiveConfig('SECURITY', userId);
    
    // Default security settings
    const defaultSettings = {
      ipRestriction: {
        enabled: false,
        allowedIPs: []
      },
      sessionSecurity: {
        singleSessionOnly: false,
        sessionTimeout: 30 // minutes
      },
      invoiceSecurity: {
        requireApproval: false,
        detailedAuditLog: true,
        digitalSignatureRequired: false
      },
      passwordSecurity: {
        expiryDays: 90,
        keepPasswordHistory: 3
      },
      accountRecovery: {
        emailEnabled: true,
        phoneEnabled: false
      },
      twoFactorAuth: {
        enabled: false,
        method: 'authenticator' // authenticator, sms, email
      }
    };

    // If no config exists, return default settings
    if (!config) {
      return res.json({
        success: true,
        settings: defaultSettings
      });
    }

    // Parse settings if it's a string
    let savedSettings = {};
    try {
      savedSettings = typeof config.Settings === 'string' ? 
        JSON.parse(config.Settings) : config.Settings;
    } catch (e) {
      console.error('Error parsing saved settings:', e);
    }

    // Merge saved settings with defaults to ensure all fields exist
    const settings = {
      ...defaultSettings,
      ...savedSettings
    };

    res.json({
      success: true,
      settings
    });

  } catch (error) {
    console.error('Error fetching security settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch security settings',
      error: error.message 
    });
  }
});

// Save user security settings
router.post('/security-settings', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }

    const settings = req.body;

    // Basic validation
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid settings format'
      });
    }

    // Save to database
    await db.WP_CONFIGURATION.updateConfig('SECURITY', req.user.id, settings);

    // Log the action
    await db.WP_LOGS.create({
      Description: `User ${req.user.Username} updated security settings`,
      CreateTS: new Date().toISOString(),
      LoggedUser: req.user.Username
    });

    res.json({
      success: true,
      message: 'Security settings saved successfully'
    });

  } catch (error) {
    console.error('Error saving security settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save security settings',
      error: error.message 
    });
  }
});

// Get company list for user registration
router.get('/company/list', checkAdmin, async (req, res) => {
    try {
        const companies = await db.sequelize.query(`
            SELECT 
                CompanyImage,
                CompanyName,
                Industry,
                Country,
                TIN,
                BRN,
                About,
                Address,
                Phone,
                Email,
                ValidStatus,
                ID,
                UserID
            FROM [PXC_E_INVOICE_DATABASE].[dbo].[WP_COMPANY_SETTINGS]
            WHERE ValidStatus = '1'
            ORDER BY CompanyName ASC
        `, {
            type: db.sequelize.QueryTypes.SELECT
        });

        res.json(companies);
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch company list'
        });
    }
});

/**
 * Get user profile information - used for session checks
 */
router.get('/profile', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session || !req.session.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        // Get user from database to ensure they still exist and are valid
        const user = await WP_USER_REGISTRATION.findOne({
            where: {
                ID: req.session.user.id,
                ValidStatus: 1
            },
            attributes: [
                'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
                'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
                'ProfilePicture'
            ]
        });

        if (!user) {
            // User no longer exists or is no longer valid
            req.session.destroy();
            return res.status(401).json({
                success: false,
                message: 'User account is no longer valid'
            });
        }

        // Return user profile data
        return res.json({
            success: true,
            user: {
                id: user.ID,
                fullName: user.FullName,
                email: user.Email,
                username: user.Username,
                phone: user.Phone,
                userType: user.UserType,
                admin: user.Admin === 1,
                profilePicture: user.ProfilePicture,
                twoFactorEnabled: user.TwoFactorEnabled === 1,
                notificationsEnabled: user.NotificationsEnabled === 1
            }
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch user profile'
        });
    }
});

module.exports = router; 