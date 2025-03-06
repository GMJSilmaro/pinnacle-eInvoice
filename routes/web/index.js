const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware');

// Middleware to check for authentication
const checkSession = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/auth/logout'); // Redirect to login if session does not exist
  }
  next();
};

// Dashboard routes
router.get('/', auth.middleware, (req, res) => {
    res.render('dashboard/index.html', {
        title: 'Dashboard',
        user: req.session.user || null,
        layout: 'layout'
    });
});
// Dashboard routes
router.get('/dashboard', auth.middleware, (req, res) => {
    res.render('dashboard/index.html', {
        title: 'Dashboard',
        user: req.session.user || null,
        layout: 'layout'
    });
});

//  Inbound redirect
router.get('/inbound', auth.middleware, (req, res) => {
    res.render('dashboard/inbound.html', {
        title: 'Inbound',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Outbound redirect
router.get('/outbound', auth.middleware, (req, res) => {
    res.render('dashboard/outbound.html', {
        title: 'Outbound',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Help & Support route
router.get('/help', auth.middleware, (req, res) => {
    res.render('dashboard/help.html', {
        title: 'Help & Support',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Changelog route
router.get('/changelog', auth.middleware,  (req, res) => {
    res.render('dashboard/changelog.html', {
        title: 'Changelog',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Profile redirect
router.get('/profile', auth.middleware, (req, res) => {
    res.render('dashboard/profile.html', {
        title: 'Profile',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// User settings redirect for normal users
router.get('/settings/user/profile/:id', auth.isAdmin, (req, res) => {
    res.render('dashboard/user-settings-page.html', {
        title: 'User Settings',
        user: req.session.user || null,
        layout: 'layout'
    });
});


router.get('/company/profile/:name', auth.isAdmin, (req, res) => {
    res.render('dashboard/company-profile.html', {
      title: 'Company Profile',
      companyName: req.params.companyName,
      user: req.session.user || null,
      layout: 'layout'

    });
  });
  
router.get('/settings/user/admin/profile/:id', auth.isAdmin, (req, res) => {
    res.render('dashboard/admin-settings.html', {
        title: 'User Management',
        id: req.session.user.id,
        user: req.session.user || null,
        layout: 'layout'
    });
});

router.get('/users', auth.isAdmin, (req, res) => {
    res.render('dashboard/user-management.html', {
        title: 'Users Management',
        user: req.session.user || null,
        layout: 'layout'
    });
});

module.exports = router;
