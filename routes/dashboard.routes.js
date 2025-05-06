const express = require('express');
const router = express.Router();
const path = require('path');
const { auth } = require('../middleware');

// Admin middleware
const isAdmin = (req, res, next) => {
  if (!req.session?.user?.admin) {
    return res.status(403).redirect('/');
  }
  next();
};

router.get('/', (req, res) => {
  res.render('dashboard/index', {
    title: 'Dashboard',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/audit-trail', (req, res) => {
  res.render('dashboard/audit-trail.html', {
    title: 'Audit Trail',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/outbound', (req, res) => {
  res.render('dashboard/outbound.html', {
    title: 'Outbound',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/consolidated', auth.middleware, (req, res) => {
  res.render('dashboard/consolidated.html', {
      title: 'Outbound Consolidation',
      user: req.session.user || null,
      layout: 'layout'
  });
});

router.get('/inbound', (req, res) => {
  res.render('dashboard/inbound.html', {
    title: 'Inbound',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/sdk-updates', (req, res) => {
  res.render('dashboard/sdk-updates.html', {
    title: 'SDK Updates',
    user: req.session.user || null,
    layout: 'layout'
  });
});

router.get('/company-profile', auth.isAdmin, (req, res) => {
  res.render('dashboard/company-profile.html', {
    title: 'Company Profile',
    user: req.session.user || null,
    layout: 'layout'
  });
});

// TIN Validator - Simple standalone page for validating TINs
router.get('/tin-validator', auth.middleware, (req, res) => {
  res.render('tin-validator.html', {
    title: 'TIN Validator',
    user: req.session.user || null,
    layout: false // No layout - standalone page
  });
});

module.exports = router; 