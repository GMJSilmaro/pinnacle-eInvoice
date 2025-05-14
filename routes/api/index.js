const express = require('express');
const router = express.Router();
const db = require('../../models');
const excel = require('exceljs');
const { auth } = require('../../middleware');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logDBOperation } = require('../../utils/logger');



// Import admin settings routes
const adminSettingsRoutes = require('./admin.settings.routes');
const outboundFilesRoutes = require('./outbound-files');
const userRoutes = require('./user');
const companySettingsRoutes = require('./company-settings.routes');
const xmlRoutes = require('./xml.routes');
const logsRoutes = require('./logs.routes');
const lhdnRoutes = require('./lhdn');
const configRoutes = require('./config');
const geminiRoutes = require('./gemini.routes');
const rssRoutes = require('./rss');

// Import consolidation routes
const consolidationRoutes = require('./consolidation.routes');

// Import utils routes
const utilsRoutes = require('./utils');


// Add admin settings routes
router.use('/admin', auth.isAdmin, adminSettingsRoutes);
// Use route modules
router.use('/outbound-files', outboundFilesRoutes);
router.use('/company', companySettingsRoutes);
router.use('/xml', xmlRoutes);
router.use('/logs', logsRoutes);
router.use('/lhdn', lhdnRoutes);
router.use('/config', configRoutes);
router.use('/user', userRoutes);
router.use('/gemini', geminiRoutes);
router.use('/rss', rssRoutes);

// Register consolidation routes
router.use('/consolidation', consolidationRoutes);

// Register utils routes
router.use('/utils', utilsRoutes);


// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../public/uploads/company-logos');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (!file.originalname.match(/\.(jpg|JPG|jpeg|JPEG|png|PNG|gif|GIF)$/)) {
    req.fileValidationError = 'Only image files are allowed!';
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});


// Get user and company details
router.get('/getUserAndCompanyDetails', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username },
      attributes: ['ID', 'Username', 'Email', 'Admin', 'TIN', 'IDType', 'IDValue', 'ClientID', 'ClientSecret', 'DigitalSignaturePath', 'DigitalSignatureFileName']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    // Send a more structured response
    res.json({
      success: true,
      user: {
        username: user.Username,
        email: user.Email,
        admin: user.Admin === 1,
        tin: user.TIN
      },
      company: company ? {
        companyName: company.CompanyName,
        email: company.Email,
        companyLogo: company.CompanyImage || '/assets/img/noimage.png',
        industry: company.Industry,
        country: company.Country,
        tin: company.TIN,
        brn: company.BRN,
        about: company.About,
        address: company.Address,
        phone: company.Phone
      } : null
    });

  } catch (error) {
    console.error('Error fetching user and company details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user and company details'
    });
  }
});

// Document endpoints
router.get('/documents/:uuid/document', async (req, res) => {
  const { uuid } = req.params;
  try {
    const response = await axios.get(
      `https://preprod-api.myinvois.hasil.gov.my/api/v1.0/documents/${uuid}/raw`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`
        }
      }
    );
    console.log("Document API response:", response.data);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Error fetching document details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch document details' });
  }
});

router.get('/documents/:uuid/details', async (req, res) => {
  const { uuid } = req.params;
  try {
    const response = await axios.get(
      `https://preprod-api.myinvois.hasil.gov.my/api/v1.0/documents/${uuid}/details`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`
        }
      }
    );
    console.log("Document Details API response:", response.data);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Error fetching document details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch document details' });
  }
});

// Document endpoints
router.get('/documents/recent', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get recent documents from WP_INBOUND_STATUS
    const documents = await WP_INBOUND_STATUS.findAll({
      where: {
        receiverId: user.TIN // Filter by user's TIN
      },
      order: [
        ['dateTimeReceived', 'DESC'] // Order by received date, newest first
      ],
      limit: 100 // Limit to most recent 100 documents
    });

    // Transform the data to match the table structure
    const result = documents.map(doc => ({
      uuid: doc.uuid,
      internalId: doc.internalId,
      typeName: doc.typeName,
      supplierName: doc.supplierName,
      receiverName: doc.receiverName,
      dateTimeIssued: doc.dateTimeIssued,
      dateTimeReceived: doc.dateTimeReceived,
      status: doc.status,
      totalSales: doc.totalPayableAmount,
      issuerTin: doc.issuerTin,
      receiverId: doc.receiverId
    }));

    res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error('Error fetching recent documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent documents',
      error: error.message
    });
  }
});

// Dashboard data endpoints
router.get('/inbound-status/count', async (req, res) => {
  try {
    const { period } = req.query;
    let whereClause = {};

    if (period) {
      const now = new Date();
      switch (period) {
        case 'today':
          whereClause.dateTimeReceived = {
            [Op.gte]: new Date(now.setHours(0, 0, 0, 0))
          };
          break;
        case 'this-month':
          whereClause.dateTimeReceived = {
            [Op.gte]: new Date(now.getFullYear(), now.getMonth(), 1)
          };
          break;
        case 'this-year':
          whereClause.dateTimeReceived = {
            [Op.gte]: new Date(now.getFullYear(), 0, 1)
          };
          break;
      }
    }

    const count = await WP_INBOUND_STATUS.count({ where: whereClause });
    res.json({ count });
  } catch (error) {
    console.error('Error getting inbound count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/dashboard/graph-data', async (req, res) => {
  try {
    const defaultData = {
      sentToLHDN: new Array(7).fill(0),
      valid: new Array(7).fill(0),
      invalid: new Array(7).fill(0),
      rejected: new Array(7).fill(0),
      cancelled: new Array(7).fill(0),
      failedToSend: new Array(7).fill(0)
    };

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    try {
      const results = await WP_OUTBOUND_STATUSY.findAll({
        attributes: [
          [sequelize.literal('DATEPART(WEEKDAY, DateTimeSent) - 1'), 'dayOfWeek'],
          'SubmissionStatus',
          [sequelize.fn('COUNT', '*'), 'count']
        ],

        where: {
          DateTimeSent: {
            [Op.gte]: startOfWeek,
            [Op.lte]: now
          }
        },
        group: [
          sequelize.literal('DATEPART(WEEKDAY, DateTimeSent)'),
          'SubmissionStatus'
        ],
        raw: true

      });

      results.forEach(row => {
        const dayIndex = row.dayOfWeek;
        const status = (row.SubmissionStatus || '').toLowerCase();
        const count = parseInt(row.count) || 0;

        switch(status) {
          case 'sent to lhdn':
          case 'Submitted':
            defaultData.sentToLHDN[dayIndex] = count;
            break;
          case 'Valid':
            defaultData.valid[dayIndex] = count;
            break;
          case 'Invalid':
            defaultData.invalid[dayIndex] = count;
            break;
          case 'Rejected':
            defaultData.rejected[dayIndex] = count;
            break;
          case 'Cancelled':
            defaultData.cancelled[dayIndex] = count;
            break;
          case 'failed':
          case 'failed to send':
            defaultData.failedToSend[dayIndex] = count;
            break;
        }
      });

      res.json(defaultData);
    } catch (dbError) {
      console.error('Database error:', dbError);
      res.json(defaultData);
    }
  } catch (error) {
    console.error('Error in graph data endpoint:', error);
    res.json({
      sentToLHDN: new Array(7).fill(0),
      valid: new Array(7).fill(0),
      invalid: new Array(7).fill(0),
      rejected: new Array(7).fill(0),
      cancelled: new Array(7).fill(0),
      failedToSend: new Array(7).fill(0)
    });
  }
});

// User details
router.get('/user-details', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    // Get full user details from database
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        ...req.session.user,
        id: user.ID // Add the database ID
      }
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Inbound status
router.get('/inbound-status', async (req, res) => {
  try {
    res.json({ success: true, count: 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Company count
router.get('/company-count', async (req, res) => {
  try {
    res.json({ success: true, count: 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Outbound files count
router.get('/outbound-files/count', async (req, res) => {
  try {
    // Add your outbound files count logic here
    res.json({ success: true, count: 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Logs
router.get('/logs', async (req, res) => {
  try {
    const logs = await WP_LOGS.findAll({
      order: [['CreateTS', 'DESC']],
      limit: 10
    });
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Graph data endpoint
router.get('/graph-data', async (req, res) => {
  try {
    const data = {
      sentToLHDN: new Array(7).fill(0),
      valid: new Array(7).fill(0),
      invalid: new Array(7).fill(0),
      rejected: new Array(7).fill(0),
      cancelled: new Array(7).fill(0)
    };
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard Statistics
router.get('/dashboard/stats', async (req, res) => {
    try {
        // Get outbound count
        let outboundCount = 0;
        if (db.WP_OUTBOUND_STATUS) {
            try {
                outboundCount = await db.WP_OUTBOUND_STATUS.count();
            } catch (error) {
                console.error('Error counting outbound status:', error);
            }
        }

        // Get inbound count
        let inboundCount = 0;
        if (db.WP_INBOUND_STATUS) {
            try {
                inboundCount = await db.WP_INBOUND_STATUS.count();
            } catch (error) {
                console.error('Error counting inbound status:', error);
            }
        }

        // Get company count
        let companyCount = 0;
        if (db.WP_COMPANY_SETTINGS) {
            try {
                companyCount = await db.WP_COMPANY_SETTINGS.count();
            } catch (error) {
                console.error('Error counting company settings:', error);
            }
        }

        // Get outbound stats for the chart (last 7 days)
        let outboundStats = [];
        if (db.WP_OUTBOUND_STATUS && db.sequelize && db.Op) {
            try {
                outboundStats = await db.WP_OUTBOUND_STATUS.findAll({
                    attributes: [
                        [db.sequelize.literal('CONVERT(DATE, date_submitted)'), 'date'],
                        'status',
                        [db.sequelize.fn('COUNT', db.sequelize.col('*')), 'count']
                    ],
                    where: {
                        date_submitted: {
                            [db.Op.gte]: db.sequelize.literal("DATEADD(day, -7, GETDATE())")
                        }
                    },
                    group: [
                        db.sequelize.literal('CONVERT(DATE, date_submitted)'),
                        'status'
                    ],
                    raw: true
                });
            } catch (error) {
                console.error('Error getting outbound stats:', error);
            }
        }

        // Get inbound stats for the chart (last 7 days)
        let inboundStats = [];
        if (db.WP_INBOUND_STATUS && db.sequelize && db.Op) {
            try {
                inboundStats = await db.WP_INBOUND_STATUS.findAll({
                    attributes: [
                        [db.sequelize.fn('TRY_CONVERT', db.sequelize.literal('DATE'), db.sequelize.col('dateTimeReceived')), 'date'],
                        'status',
                        [db.sequelize.fn('COUNT', db.sequelize.col('*')), 'count']
                    ],
                    where: db.sequelize.where(
                        db.sequelize.fn('TRY_CONVERT', db.sequelize.literal('DATE'), db.sequelize.col('dateTimeReceived')),
                        {
                            [db.Op.gte]: db.sequelize.literal("DATEADD(day, -7, GETDATE())")
                        }
                    ),
                    group: [
                        db.sequelize.fn('TRY_CONVERT', db.sequelize.literal('DATE'), db.sequelize.col('dateTimeReceived')),
                        'status'
                    ],
                    raw: true
                });
            } catch (error) {
                console.error('Error getting inbound stats:', error);
            }
        }

        res.json({
            success: true,
            stats: {
                outbound: outboundCount,
                inbound: inboundCount,
                companies: companyCount,
                outboundStats,
                inboundStats
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);

        // Log the error using LoggingService
        try {
            const { LoggingService, MODULES, ACTIONS, STATUS } = require('../../services/logging.service');
            await LoggingService.log({
                description: `Error fetching dashboard stats: ${error.message}`,
                username: req.session?.user?.username || 'System',
                userId: req.session?.user?.id || null,
                ipAddress: req.ip,
                logType: 'ERROR',
                module: MODULES.DASHBOARD || 'Dashboard',
                action: ACTIONS.VIEW || 'VIEW',
                status: STATUS.ERROR || 'FAILED',
                details: error
            });
        } catch (logError) {
            console.error('Error logging dashboard stats error:', logError);
        }

        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics',
            error: error.message
        });
    }
});

// Update company details
router.post('/updateCompanyDetails', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Update company details
    const {
      companyName,
      industry,
      country,
      about,
      address,
      phone,
      email
    } = req.body;

    await company.update({
      CompanyName: companyName,
      Industry: industry,
      Country: country,
      About: about,
      Address: address,
      Phone: phone,
      Email: email
    });

    res.json({
      success: true,
      message: 'Company details updated successfully'
    });
  } catch (error) {
    console.error('Error updating company details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update company details'
    });
  }
});

// Update company logo
router.post('/updateCompanyLogo', upload.single('companyLogo'), async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find or create company settings
    let company = await WP_COMPANY_SETTINGS.findOne({
      where: { UserID: user.ID }
    });

    if (!company) {
      // Create new company profile if it doesn't exist
      company = await WP_COMPANY_SETTINGS.create({
        UserID: user.ID,
        TIN: user.TIN,
        CompanyName: user.FullName || 'My Company',
        ValidStatus: 'Active',
        Email: user.Email
      });
    }

    // Delete old logo file if it exists
    if (company.CompanyImage) {
      const oldLogoPath = path.join(__dirname, '../../public', company.CompanyImage);
      if (fs.existsSync(oldLogoPath)) {
        fs.unlinkSync(oldLogoPath);
      }
    }

    // Update company logo path in database
    const logoUrl = `/uploads/company-logos/${req.file.filename}`;
    await company.update({
      CompanyImage: logoUrl
    });

    // Log the successful update
    await logDBOperation(
      { WP_LOGS },
      'UPDATE',
      req.session.user,
      'Company logo updated',
      { companyId: company.ID }
    );

    res.json({
      success: true,
      message: 'Company logo updated successfully',
      logoUrl,
      company: {
        id: company.ID,
        companyName: company.CompanyName,
        email: company.Email,
        tin: company.TIN
      }
    });
  } catch (error) {
    console.error('Error updating company logo:', error);

    // Log the error
    await logDBOperation(
      { WP_LOGS },
      'ERROR',
      req.session.user,
      'Failed to update company logo',
      { error: error.message }
    );

    // Delete uploaded file if there was an error
    if (req.file) {
      const filePath = path.join(__dirname, '../../public/uploads/company-logos', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update company logo',
      error: error.message
    });
  }
});

// Get complete profile data
router.get('/getProfileDetails', async (req, res) => {
  try {
    if (!req.session?.user) {
      console.log('No user session found');
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    console.log('Finding user with username:', req.session.user.username);
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username },
      attributes: [
        'ID',
        'FullName',
        'Email',
        'Username',
        'Admin',
        'CreateTS',
        'TIN',
        'IDType',
        'IDValue',
        'ClientID',
        'ClientSecret',
        'DigitalSignaturePath',
        'DigitalSignatureFileName'
      ]
    });

    if (!user) {
      console.log('User not found in database');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Finding company with UserID:', user.ID);
    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { UserID: user.ID },
      attributes: [
        'CompanyImage',
        'CompanyName',
        'Industry',
        'Country',
        'About',
        'Address',
        'Phone',
        'Email',
        'ValidStatus',
        'ID',
        'UserID',
        'BRN',
        'TIN'
      ]
    });

    console.log('Company found:', company ? 'Yes' : 'No');
    const response = {
      success: true,
      user: {
        id: user.ID,
        fullName: user.FullName,
        email: user.Email,
        username: user.Username,
        userType: user.UserType,
        tin: user.TIN,
        idType: user.IDType,
        idValue: user.IDValue,
        clientId: user.ClientID,
        clientSecret: user.ClientSecret,
        digitalSignaturePath: user.DigitalSignaturePath,
        digitalSignatureFileName: user.DigitalSignatureFileName,
        admin: user.Admin,
        createTS: user.CreateTS
      },
      company: company ? {
        companyImage: company.CompanyImage || '',
        companyName: company.CompanyName,
        industry: company.Industry,
        country: company.Country,
        tin: company.TIN,
        brn: company.BRN,
        about: company.About,
        address: company.Address,
        phone: company.Phone,
        email: company.Email,
        validStatus: company.ValidStatus,
        id: company.ID,
        userId: company.UserID
      } : null
    };
  //  console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error fetching profile details:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile details',
      error: error.message
    });
  }
});

// Update authentication details
router.post('/updateAuthDetails', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update authentication details
    const { clientId, clientSecret } = req.body;

    await user.update({
      ClientID: clientId,
      ClientSecret: clientSecret
    });

    res.json({
      success: true,
      message: 'Authentication details updated successfully'
    });
  } catch (error) {
    console.error('Error updating authentication details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update authentication details'
    });
  }
});

// Update user details
router.post('/updateUserDetails', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user details
    const { email } = req.body;

    await user.update({
      Email: email
    });

    res.json({
      success: true,
      message: 'User details updated successfully'
    });
  } catch (error) {
    console.error('Error updating user details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user details'
    });
  }
});

// Branch Company CRUD endpoints
router.post('/addBranch', upload.single('branchLogo'), async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const {
      branchName,
      location,
      tin,
      brn,
      contactPerson,
      contactEmail,
      address,
      userId
    } = req.body;

    // Convert userId to number and validate
    const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;

    if (isNaN(numericUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Create branch with all fields properly mapped
    const branch = await WP_COMPANY_SETTINGS.create({
      CompanyName: branchName || null,
      Country: location || null,
      TIN: tin || null,
      BRN: brn || null,
      About: contactPerson || null,
      Email: contactEmail || null,
      Address: address || null,
      UserID: numericUserId,
      ValidStatus: 'Active',
      CompanyImage: req.file ? `/uploads/company-logos/${req.file.filename}` : null,
      Industry: null, // Set default value for required fields
      Phone: null
    });

    res.json({
      success: true,
      message: 'Branch company added successfully',
      data: {
        id: branch.ID,
        branchName: branch.CompanyName,
        tin: branch.TIN,
        brn: branch.BRN,
        location: branch.Country,
        contactPerson: branch.About,
        contactEmail: branch.Email,
        address: branch.Address,
        status: branch.ValidStatus,
        companyLogo: branch.CompanyImage
      }
    });
  } catch (error) {
    console.error('Error adding branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add branch company',
      error: error.message
    });
  }
});

router.get('/getBranchCompanies', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get full user details from database
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Ensure we have a numeric user ID
    const userId = parseInt(user.ID, 10);
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    console.log('Querying branches with UserID:', userId); // Debug log

    const branches = await WP_COMPANY_SETTINGS.findAll({
      where: {
        UserID: userId
      }
    });

    console.log('Found branches:', branches); // Debug log

    res.json({
      success: true,
      data: branches.map(branch => ({
        id: branch.ID,
        branchName: branch.CompanyName,
        tin: branch.TIN,
        brn: branch.BRN,
        location: branch.Country,
        contactPerson: branch.About,
        contactEmail: branch.Email,
        address: branch.Address,
        status: branch.ValidStatus,
        companyLogo: branch.CompanyImage
      }))
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branch companies',
      error: error.message
    });
  }
});

router.put('/updateBranch/:id', upload.single('branchLogo'), async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get full user details from database
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { id } = req.params;
    const {
      branchName,
      location,
      tin,
      brn,
      contactPerson,
      contactEmail,
      address
    } = req.body;

    // Find the branch and verify ownership
    const branch = await WP_COMPANY_SETTINGS.findOne({
      where: {
        ID: id,
        UserID: user.ID
      }
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch company not found'
      });
    }

    // Prepare update data
    const updateData = {
      CompanyName: branchName || branch.CompanyName,
      Country: location || branch.Country,
      TIN: tin || branch.TIN,
      BRN: brn || branch.BRN,
      About: contactPerson || branch.About,
      Email: contactEmail || branch.Email,
      Address: address || branch.Address,
      ValidStatus: 'Active'
    };

    // Update logo if new file is uploaded
    if (req.file) {
      updateData.CompanyImage = `/uploads/company-logos/${req.file.filename}`;
    }

    // Update the branch
    await branch.update(updateData);

    // Return updated branch data
    res.json({
      success: true,
      message: 'Branch company updated successfully',
      data: {
        id: branch.ID,
        branchName: branch.CompanyName,
        tin: branch.TIN,
        brn: branch.BRN,
        location: branch.Country,
        contactPerson: branch.About,
        contactEmail: branch.Email,
        address: branch.Address,
        status: branch.ValidStatus,
        companyLogo: branch.CompanyImage
      }
    });
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update branch company',
      error: error.message
    });
  }
});

router.delete('/deleteBranch/:id', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get full user details from database
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { id } = req.params;
    const result = await WP_COMPANY_SETTINGS.destroy({
      where: {
        ID: id,
        UserID: user.ID
      }
    });

    if (result === 0) {
      return res.status(404).json({
        success: false,
        message: 'Branch company not found'
      });
    }

    res.json({
      success: true,
      message: 'Branch company deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete branch company',
      error: error.message
    });
  }
});

// Get all users
router.get('/users-list', auth.isAdmin, async (req, res) => {
  try {
    const users = await WP_USER_REGISTRATION.findAll({
      attributes: [
         'ID', 'FullName', 'Email', 'Username', 'Phone', 'UserType',
         'Admin', 'ValidStatus', 'TwoFactorEnabled', 'NotificationsEnabled',
         'CreateTS', 'LastLoginTime'
        ],
        order: [['CreateTS', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// Get audit logs with filtering and pagination
router.get('/audit-logs', auth.isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10; // Items per page
    const offset = (page - 1) * limit;

    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const actionType = req.query.actionType;

    // Build where clause
    const whereClause = {};
    if (startDate && endDate) {
      whereClause.CreateTS = {
        [Op.between]: [startDate, endDate]
      };
    }
    if (actionType) {
      // Add action type filter based on description
      const actionPattern = getActionPattern(actionType);
      if (actionPattern) {
        whereClause.Description = {
          [Op.like]: `%${actionPattern}%`
        };
      }
    }

    // Get total count for pagination
    const totalCount = await WP_LOGS.count({
      where: whereClause
    });

    // Get logs with pagination
    const logs = await WP_LOGS.findAll({
      where: whereClause,
      order: [['CreateTS', 'DESC']],
      limit: limit,
      offset: offset
    });

    // Get statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayActivities = await WP_LOGS.count({
      where: {
        CreateTS: {
          [Op.gte]: today
        }
      }
    });

    const activeUsers = await WP_LOGS.count({
      distinct: true,
      col: 'LoggedUser',
      where: {
        CreateTS: {
          [Op.gte]: new Date(new Date() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      }
    });

    res.json({
      success: true,
      logs: logs.map(log => ({
        Timestamp: log.CreateTS,
        Username: log.LoggedUser,
        ActionType: getActionType(log.Description),
        Description: log.Description,
        IPAddress: log.IPAddress
      })),
      totalPages: Math.ceil(totalCount / limit),
      stats: {
        totalActivities: totalCount,
        todayActivities: todayActivities,
        activeUsers: activeUsers
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    });
  }
});

// Export audit logs to Excel
router.get('/audit-logs/export', auth.isAdmin, async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const actionType = req.query.actionType;

    // Build where clause
    const whereClause = {};
    if (startDate && endDate) {
      whereClause.CreateTS = {
        [Op.between]: [startDate, endDate]
      };
    }
    if (actionType) {
      // Add action type filter based on description
      const actionPattern = getActionPattern(actionType);
      if (actionPattern) {
        whereClause.Description = {
          [Op.like]: `%${actionPattern}%`
        };
      }
    }

    const logs = await WP_LOGS.findAll({
      where: whereClause,
      order: [['CreateTS', 'DESC']]
    });

    // Create Excel workbook
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Audit Logs');

    // Add headers
    worksheet.columns = [
      { header: 'Timestamp', key: 'timestamp', width: 20 },
      { header: 'User', key: 'user', width: 20 },
      { header: 'Action', key: 'action', width: 15 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'IP Address', key: 'ipAddress', width: 15 }
    ];

    // Add data
    logs.forEach(log => {
      worksheet.addRow({
        timestamp: log.CreateTS,
        user: log.LoggedUser,
        action: getActionType(log.Description),
        description: log.Description,
        ipAddress: log.IPAddress
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${new Date().toISOString().split('T')[0]}.xlsx`);

    // Send workbook
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export audit logs'
    });
  }
});

// Helper function to determine action type from description
function getActionType(description) {
  const description_lower = description.toLowerCase();
  if (description_lower.includes('logged in')) return 'Login';
  if (description_lower.includes('logged out')) return 'Logout';
  if (description_lower.includes('created')) return 'Create';
  if (description_lower.includes('updated')) return 'Update';
  if (description_lower.includes('deleted')) return 'Delete';
  return 'Other';
}

// Helper function to get action pattern for filtering
function getActionPattern(actionType) {
  switch (actionType.toLowerCase()) {
    case 'login': return 'logged in';
    case 'logout': return 'logged out';
    case 'create': return 'created';
    case 'update': return 'updated';
    case 'delete': return 'deleted';
    default: return null;
  }
}

// Portal Settings endpoints
router.get('/getPortalSettings', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get settings from database
    const settings = await db.PortalSettings.findOne({
      where: { UserID: user.ID }
    });

    // Get company details
    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    // Merge settings with company data
    const defaultSettings = {
      company: company ? {
        name: company.CompanyName,
        rocNumber: company.BRN,
        taxNumber: company.TIN,
        sstNumber: '',
        address: company.Address,
        contactEmail: company.Email,
        contactPhone: company.Phone
      } : {},
      api: { environment: 'sandbox', timeout: 60 },
      invoice: { format: 'json', currency: 'MYR' },
      validation: { errorAction: 'reject' }
    };

    const userSettings = settings ? settings.Settings : defaultSettings;

    res.json({
      success: true,
      data: {
        ...defaultSettings,
        ...userSettings,
        company: {
          ...defaultSettings.company,
          ...(userSettings.company || {})
        }
      }
    });
  } catch (error) {
    console.error('Error fetching portal settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch portal settings'
    });
  }
});

router.post('/savePortalSettings', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Save or update settings
    await db.PortalSettings.upsert({
      UserID: user.ID,
      Settings: req.body,
      UpdateTS: new Date().toISOString(),
    });

    // Log the action
    await WP_LOGS.create({
      Description: `User ${user.Username} updated portal settings`,
      CreateTS: new Date().toISOString(),
      LoggedUser: user.Username
    });

    res.json({
      success: true,
      message: 'Settings saved successfully'
    });
  } catch (error) {
    console.error('Error saving portal settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save portal settings'
    });
  }
});


// Company Settings Routes
router.post('/company-settings/create', async (req, res) => {
    try {
        const { UserID, CompanyName, Industry, Country, Email, ValidStatus, About } = req.body;

        if (!UserID) {
            return res.status(400).json({
                success: false,
                message: 'UserID is required'
            });
        }

        // Get admin's default profile
        const adminUser = await WP_USER_REGISTRATION.findOne({
            where: { Admin: 1 }
        });

        let adminProfile = null;
        if (adminUser) {
            adminProfile = await WP_COMPANY_SETTINGS.findOne({
                where: { UserID: adminUser.ID }
            });
        }

        // Create company settings with admin's defaults
        const companySettings = await WP_COMPANY_SETTINGS.create({
            CompanyName: CompanyName || (adminProfile?.CompanyName || ''),
            Industry: Industry || (adminProfile?.Industry || ''),
            Country: Country || (adminProfile?.Country || 'Malaysia'),
            Email: Email || (adminProfile?.Email || ''),
            ValidStatus: ValidStatus || 'active',
            About: About || (adminProfile?.About || ''),
            UserID,
            TIN: adminProfile?.TIN || '',
            BRN: adminProfile?.BRN || '',
            Address: adminProfile?.Address || '',
            Phone: adminProfile?.Phone || ''
        });

        return res.json({
            success: true,
            data: companySettings
        });

    } catch (error) {
        console.error('Error creating company settings:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating company settings',
            error: error.message
        });
    }
});

// Get admin's default company profile
router.get('/admin-company-profile', async (req, res) => {
    try {
        const adminProfile = await models.WP_COMPANY_SETTINGS.findOne({
            include: [{
                model: models.WP_USER,
                where: { admin: true },
                required: true
            }]
        });

        if (!adminProfile) {
            return res.status(404).json({
                success: false,
                message: 'Admin profile not found'
            });
        }

        return res.json({
            success: true,
            data: adminProfile
        });
    } catch (error) {
        console.error('Error fetching admin profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching admin profile'
        });
    }
});

module.exports = router;