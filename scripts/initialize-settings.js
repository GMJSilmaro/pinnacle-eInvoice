const AdminSettingsService = require('../services/adminSettings.service');

async function initializeSettings() {
  try {
    console.log('Initializing default admin settings...');
    await AdminSettingsService.initializeDefaultSettings('SYSTEM');
    console.log('Default admin settings initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing default admin settings:', error);
    process.exit(1);
  }
}

initializeSettings(); 