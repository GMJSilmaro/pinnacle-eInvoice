const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../../middleware');
const prisma = require('../../src/lib/prisma');
const bcrypt = require('bcryptjs');

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads/company-profiles';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'company-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
    }
  }
});

// Get company profile
router.get('/profile', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user details first
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find company using user's TIN
    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    // Get LHDN configuration
    const lhdnConfig = await WP_CONFIGURATION.findOne({
      where: {
        Type: 'LHDN',
        UserID: user.ID,
        IsActive: true
      },
      order: [['CreateTS', 'DESC']]
    });

    // Parse LHDN settings
    let lhdnSettings = {};
    if (lhdnConfig?.Settings) {
      try {
        lhdnSettings = typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) : lhdnConfig.Settings;
      } catch (error) {
        console.error('Error parsing LHDN settings:', error);
      }
    }

    // Prepare response data with default values
    const companyData = {
      companyName: company?.CompanyName || '',
      industry: company?.Industry || '',
      country: company?.Country || '',
      email: company?.Email || user.Email || '', // Fallback to user email
      phone: company?.Phone || user.Phone || '',
      address: company?.Address || '',
      tin: user.TIN || '', // Use TIN from user record
      brn: company?.BRN || user.IDValue || '', // Fallback to user's IDValue
      about: company?.About || '',
      profileImage: company?.CompanyImage || '/assets/img/noimage.png',
      validStatus: company?.ValidStatus || 1,
      clientId: lhdnSettings.clientId || '',
      clientSecret: lhdnSettings.clientSecret ? '****************' : ''

    };

    res.json({
      success: true,
      message: company ? 'Company profile found' : 'No company profile found. Please create one.',
      company: companyData,
      isNewCompany: !company,
      canEditTinBrn: user.Admin === 1 // Only admin can edit TIN/BRN
    });
  } catch (error) {
    console.error('Error fetching company profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update company profile (excluding TIN/BRN)
router.put('/profile', auth.isAdmin, async (req, res) => {
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

    const {
      companyName,
      industry,
      country,
      email,
      phone,
      address,
      about
    } = req.body;

    // Validate required fields
    if (!companyName || !email) {
      return res.status(400).json({
        success: false,
        message: 'Company name and email are required'
      });
    }

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      // Find or create company settings
      const [company, created] = await WP_COMPANY_SETTINGS.findOrCreate({
        where: { TIN: user.TIN },
        defaults: {
          CompanyName: companyName,
          Industry: industry,
          Country: country,
          Email: email,
          Phone: phone,
          Address: address,
          About: about,
          TIN: user.TIN,
          BRN: user.IDValue,
          UserID: user.ID,
          ValidStatus: 1,
          CreateTS: new Date().toISOString(),
          UpdateTS: new Date().toISOString(),
        },
        transaction
      });

      if (!created) {
        // Update existing company (excluding TIN/BRN)
        await company.update({
          CompanyName: companyName,
          Industry: industry,
          Country: country,
          Email: email,
          Phone: phone,
          Address: address,
          About: about,
          UpdateTS: new Date().toISOString(),
        }, { transaction });
      }

      // Log the action
      await WP_LOGS.create({
        Description: created ? 'Company profile created' : 'Company profile updated',
        CreateTS: new Date().toISOString(),
        LoggedUser: user.Username,
        LogType: 'INFO',
        Module: 'Company Management',
        Action: created ? 'CREATE' : 'UPDATE',
        Status: 'SUCCESS',
        UserID: user.ID
      }, { transaction });

      // Get LHDN configuration
      const lhdnConfig = await WP_CONFIGURATION.findOne({
        where: {
          Type: 'LHDN',
          UserID: user.ID,
          IsActive: true
        },
        order: [['CreateTS', 'DESC']],
        transaction
      });

      // Parse LHDN settings
      let lhdnSettings = {};
      if (lhdnConfig?.Settings) {
        try {
          lhdnSettings = typeof lhdnConfig.Settings === 'string' ?
            JSON.parse(lhdnConfig.Settings) : lhdnConfig.Settings;
        } catch (error) {
          console.error('Error parsing LHDN settings:', error);
        }
      }

      await transaction.commit();

      res.json({
        success: true,
        message: created ? 'Company profile created successfully' : 'Company profile updated successfully',
        company: {
          companyName: company.CompanyName,
          industry: company.Industry,
          country: company.Country,
          email: company.Email,
          phone: company.Phone,
          address: company.Address,
          tin: company.TIN,
          brn: company.BRN,
          about: company.About,
          profileImage: company.CompanyImage,
          validStatus: company.ValidStatus,
          clientId: lhdnSettings.clientId || '',
          clientSecret: lhdnSettings.clientSecret ? '****************' : ''
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error updating company profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update TIN
router.put('/registration-details/tin', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({

        success: false,
        message: 'User not authenticated'
      });
    }

    const { tin, password } = req.body;

    // Validate required fields
    if (!tin || !password) {
      return res.status(400).json({
        success: false,
        message: 'TIN and password are required'
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

    // Check if user is admin
    if (user.Admin !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update registration details'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      // Update user's TIN
      await WP_USER_REGISTRATION.update(
        { TIN: tin },
        {
          where: { ID: user.ID },
          transaction
        }
      );

      // Update or create company settings
      const [company] = await WP_COMPANY_SETTINGS.findOrCreate({
        where: { UserID: user.ID },
        defaults: {
          TIN: tin,
          BRN: user.IDValue,
          UserID: user.ID,
          ValidStatus: 1,
          CreateTS: new Date().toISOString(),
          UpdateTS: new Date().toISOString(),
        },
        transaction
      });


      if (company) {
        await company.update(
          {
            TIN: tin,
            UpdateTS: sequelize.literal('GETDATE()')

          },
          { transaction }
        );
      }

      // Log the action
      await WP_LOGS.create({
        Description: 'Tax Identification Number (TIN) updated',
        CreateTS: new Date().toISOString(),
        LoggedUser: user.Username,
        LogType: 'INFO',
        Module: 'Company Management',
        Action: 'UPDATE',
        Status: 'SUCCESS',
        UserID: user.ID
      }, { transaction });

      // Commit transaction
      await transaction.commit();

      res.json({
        success: true,
        message: 'Tax Identification Number updated successfully',
        data: {
          tin,
          username: user.Username
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error updating TIN:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update Tax Identification Number'
    });
  }
});

// Update BRN
router.put('/registration-details/brn', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { IDType = 'BRN', IDValue, password } = req.body;

    // Validate required fields
    if (!IDType || !IDValue || !password) {
      return res.status(400).json({
        success: false,
        message: 'ID Type, ID Value and password are required'
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

    // Check if user is admin
    if (user.Admin !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update registration details'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      // Update user's BRN (IDValue)
      await WP_USER_REGISTRATION.update(
        { IDValue: brn },
        {
          where: { ID: user.ID },
          transaction
        }
      );

      // Update or create company settings
      const [company] = await WP_COMPANY_SETTINGS.findOrCreate({
        where: { UserID: user.ID },
        defaults: {
          TIN: user.TIN,
          IDType: user.IDType,
          IDValue: user.IDValue,
          UserID: user.ID,
          ValidStatus: 0,
          CreateTS: new Date().toISOString(),

        },
        transaction
      });

      if (company) {
        await company.update(
          {
            BRN: brn,
            UpdateTS: sequelize.literal('GETDATE()')

          },
          { transaction }

        );
      }

      // Log the action
      await WP_LOGS.create({
        Description: 'Business Registration Number (BRN) updated',
        CreateTS: new Date().toISOString(),
        LoggedUser: user.Username,
        LogType: 'INFO',
        Module: 'Company Management',
        Action: 'UPDATE',
        Status: 'SUCCESS',
        UserID: user.ID
      }, { transaction });

      // Commit transaction
      await transaction.commit();

      res.json({
        success: true,
        message: 'Business Registration Number updated successfully',
        data: {
          brn,
          username: user.Username
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error updating BRN:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update Business Registration Number'
    });
  }
});

// Update LHDN credentials
router.put('/lhdn-credentials', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({

        success: false,
        message: 'User not authenticated'
      });
    }

    const { clientId, clientSecret, password } = req.body;

    // Validate required fields
    if (!clientId || !clientSecret || !password) {
      return res.status(400).json({
        success: false,
        message: 'Client ID, Client Secret and password are required'
      });
    }

    // Get user details
    const user = await WP_USER_REGISTRATION.findOne({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Save to WP_CONFIGURATION
    const settings = {
      clientId,
      clientSecret,
      lastModifiedBy: {
        userId: user.ID,
        username: user.Username,
        timestamp: sequelize.literal('GETDATE()')
      }
    };


    await WP_CONFIGURATION.updateConfig('LHDN', user.ID, settings);

    // Log the action
    await WP_LOGS.create({
      Description: 'LHDN credentials updated by ' + user.Username,
      CreateTS: new Date().toISOString(),
      LoggedUser: user.Username,
      LogType: 'INFO',
      Module: 'Company Management',
      Action: 'UPDATE',
      Status: 'SUCCESS',
      UserID: user.ID

    });

    // Get company to update status
    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    if (company) {
      await company.update({
        ValidStatus: 1,
        UpdateTS: sequelize.literal('GETDATE()')

      });
    }



    res.json({
      success: true,
      message: 'LHDN credentials updated successfully',
      data: {
        clientId,
        clientSecret: '****************'
      }
    });
  } catch (error) {
    console.error('Error updating LHDN credentials:', error);

    // Log the error
    if (req.session?.user) {
      await WP_LOGS.create({
        Description: 'Failed to update LHDN credentials',
        CreateTS: new Date().toISOString(),
        LoggedUser: req.session.user.username,
        LogType: 'ERROR',
        Module: 'Company Management',
        Action: 'UPDATE',
        Status: 'ERROR',
        UserID: req.session.user.id
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update LHDN credentials'
    });
  }
});

// Upload company profile image
router.post('/profile-image', auth.isAdmin, upload.single('profileImage'), async (req, res) => {
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
        message: 'No image file uploaded'
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
    const [company] = await WP_COMPANY_SETTINGS.findOrCreate({
      where: { TIN: user.TIN },
      defaults: {
        TIN: user.TIN,
        IDType: user.IDType,
        IDValue: user.IDValue,
        UserID: user.ID,
        ValidStatus: 1,
      }
    });



    const imageUrl = '/uploads/company-profiles/' + req.file.filename;

    // Remove old profile image if it exists
    if (company.CompanyImage) {
      const oldImagePath = path.join(__dirname, '../../../../public', company.CompanyImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Update company profile with new image URL
    await company.update({
      CompanyImage: imageUrl
    });

    // Log the action
    await WP_LOGS.create({
      Description: 'Company profile image updated',
      CreateTS: new Date().toISOString(),
      LoggedUser: user.Username,
      LogType: 'INFO',
      Module: 'Company Management',
      Action: 'UPDATE',
      Status: 'SUCCESS',
      UserID: user.ID
    });

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      imageUrl
    });
  } catch (error) {
    // Remove uploaded file if any error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading profile image:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete company profile image
router.delete('/profile-image', auth.isAdmin, async (req, res) => {
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

    // Remove profile image if it exists
    if (company.CompanyImage) {
      const imagePath = path.join(__dirname, '../../../../public', company.CompanyImage);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // Update company profile to remove image reference
    await company.update({
      CompanyImage: null
    });

    // Log the action
    await WP_LOGS.create({
      Description: 'Company profile image removed',
      CreateTS: new Date().toISOString(),
      LoggedUser: user.Username,
      LogType: 'INFO',
      Module: 'Company Management',
      Action: 'DELETE',
      Status: 'SUCCESS',
      UserID: user.ID
    });

    res.json({
      success: true,
      message: 'Profile image removed successfully'
    });
  } catch (error) {
    console.error('Error removing profile image:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get company settings for consolidation
router.get('/settings', auth.middleware, async (req, res) => {
  try {
    // Use req.user instead of req.session.user for API authentication
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user details first
    const user = await WP_USER_REGISTRATION.findOne({
      where: { ID: req.user.id }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find company using user's TIN
    const company = await WP_COMPANY_SETTINGS.findOne({
      where: { TIN: user.TIN }
    });

    if (!company) {
      // Return default data instead of error for better user experience
      return res.json({
        company_name: 'General Public',
        tin_number: user.TIN || 'T00000000',
        business_registration_number: user.IDValue || 'BRN00000',
        sst_number: '',
        msic_code: '',
        address: 'Company Address',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'MYS',
        contact_number: user.Phone || '',
        email: user.Email || ''
      });
    }

    // Format for consolidation module
    const companyData = {
      company_name: company.CompanyName,
      tin_number: company.TIN,
      business_registration_number: company.BRN,
      sst_number: company.SSTRegistrationNumber || '',
      msic_code: company.MSICCode || '',
      address: company.Address,
      address_line1: company.AddressLine1 || '',
      address_line2: company.AddressLine2 || '',
      city: company.City || '',
      state: company.State || '',
      postal_code: company.PostalCode || '',
      country: company.Country || 'MYS',
      contact_number: company.Phone,
      email: company.Email
    };

    res.json(companyData);
  } catch (error) {
    console.error('Error fetching company settings for consolidation:', error);
    // Return default data on error
    res.json({
      company_name: 'Your Company Name',
      tin_number: 'T00000000',
      business_registration_number: 'BRN00000',
      sst_number: '',
      msic_code: '',
      address: 'Company Address',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: 'MYS',
      contact_number: '',
      email: ''
    });
  }
});

module.exports = router;
