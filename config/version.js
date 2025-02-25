// config/version.js
const path = require('path');
const VersionControl = require(path.join(__dirname, '..', './utils', 'versionControl'));

// Create the app version
const appVersion = new VersionControl({
  major: '1',
  minor: '0', 
  patch: '0',
  build: '004'
});

module.exports = appVersion;