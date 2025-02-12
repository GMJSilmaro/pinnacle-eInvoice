const express = require('express');
const router = express.Router();

// Import route modules
const logsRoutes = require('./logs.routes');
const adminSettingsRoutes = require('./admin.settings.routes');
const invoiceRoutes = require('./invoice.routes');
const lhdnRoutes = require('./lhdn');
const configRoutes = require('./config');
const outboundFilesRoutes = require('./outbound-files');
const companySettingsRoutes = require('./company-settings.routes');
const xmlRoutes = require('./xml.routes');

router.use('/logs', logsRoutes);
router.use('/admin', adminSettingsRoutes);
router.use('/invoice', invoiceRoutes);
router.use('/lhdn', lhdnRoutes);
router.use('/config', configRoutes);

router.use('/outbound-files', outboundFilesRoutes);
router.use('/company', companySettingsRoutes);
router.use('/xml', xmlRoutes);

module.exports = router; 