// config/version.js
const path = require('path');
const VersionControl = require(path.join(__dirname, '..', './utils', 'versionControl'));

// Create the app version
const appVersion = new VersionControl({
  major: '1',
  minor: '1', 
  patch: '1',
  build: '002'
});

module.exports = appVersion;