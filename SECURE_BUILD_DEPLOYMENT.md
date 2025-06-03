# 🔒 Secure Build & Deployment Guide for eInvoice Project

This document provides comprehensive instructions for implementing secure build and deployment processes for the eInvoice project, ensuring source code protection and production security.

## 🚨 Security Overview

### Critical Vulnerabilities Addressed:
- ✅ **Source Code Exposure**: Prevents direct access to source files
- ✅ **Sensitive Configuration**: Secures database credentials, API keys, certificates
- ✅ **Development Files**: Excludes test files, documentation, and development tools
- ✅ **Code Obfuscation**: Implements minification and obfuscation
- ✅ **Access Control**: Configures server-level security restrictions
- ✅ **Environment Security**: Externalizes sensitive environment variables

## 📁 Directory Structure

```
eInvoice/
├── src/                          # Source code (development only)
├── dist/                         # Build output (production ready)
│   ├── production/               # Production build
│   ├── staging/                  # Staging build
│   └── development/              # Development build
├── scripts/                      # Build and deployment scripts
│   ├── build.js                  # Main build script
│   ├── deploy.js                 # Deployment script
│   └── security-check.js         # Security validation
├── build.config.js               # Build configuration
├── web.config.production         # Secure IIS configuration
└── SECURE_BUILD_DEPLOYMENT.md    # This guide
```

## 🛠️ Installation & Setup

### 1. Install Build Dependencies

```bash
pnpm install
```

### 2. Verify Build Tools

```bash
# Check if all build dependencies are installed
pnpm list fs-extra glob uglify-js clean-css html-minifier-terser rimraf
```

## 🔧 Build Process

### Production Build

```bash
# Clean and build for production
pnpm run build

# Or run individual steps
pnpm run clean
pnpm run prebuild    # Runs security audit
pnpm run build
pnpm run postbuild   # Runs security check
```

### Staging Build

```bash
pnpm run build:staging
```

### Development Build

```bash
pnpm run build:dev
```

## 🚀 Deployment Process

### Production Deployment

```bash
# Deploy to default production path
pnpm run deploy

# Deploy to custom path
node scripts/deploy.js production "C:\custom\path"
```

### Staging Deployment

```bash
pnpm run deploy:staging
```

## 🔒 Security Features

### 1. Code Obfuscation & Minification

- **JavaScript**: Minified and obfuscated using UglifyJS
- **CSS**: Minified using CleanCSS
- **HTML**: Minified using html-minifier-terser
- **Comments**: Removed from all files
- **Console logs**: Removed in production builds

### 2. File Exclusion

The following files/directories are **NEVER** included in production builds:

```
❌ node_modules/          ❌ .env files
❌ config/                ❌ ssl/
❌ certificates/          ❌ database/
❌ migrations/            ❌ logs/
❌ sessions/              ❌ uploads/
❌ docs/                  ❌ *.bak files
❌ test files             ❌ .git/
❌ IDE files              ❌ Archive files
```

### 3. Server Security Configuration

The production `web.config` includes:

- **HTTPS Enforcement**: Automatic HTTP to HTTPS redirect
- **Security Headers**: XSS protection, clickjacking prevention, HSTS
- **File Access Control**: Blocks access to sensitive file types
- **Directory Protection**: Prevents browsing of sensitive directories
- **Request Filtering**: Blocks malicious URL patterns

### 4. Environment Variable Security

- **Externalized**: All sensitive data moved to environment variables
- **Template**: `.env.template` provided for deployment guidance
- **Validation**: Build process validates no secrets are hardcoded

## 📋 Deployment Checklist

### Pre-Deployment

- [ ] Run security audit: `pnpm run security:audit`
- [ ] Build application: `pnpm run build`
- [ ] Verify security check passes: `pnpm run security:check`
- [ ] Review security report in `dist/production/security-report.json`

### Deployment

- [ ] Deploy to target server: `pnpm run deploy`
- [ ] Copy `.env.template` to `.env` and configure
- [ ] Install SSL certificates in secure location
- [ ] Configure database connection
- [ ] Set up log directories with proper permissions

### Post-Deployment

- [ ] Start application: `pm2 start ecosystem.config.production.js`
- [ ] Verify application is running: `pm2 status`
- [ ] Check logs: `pm2 logs eInvoice-prod`
- [ ] Test application functionality
- [ ] Verify security headers are present

## 🔍 Security Validation

### Automated Security Checks

```bash
# Run comprehensive security check
pnpm run security:check

# Check specific build
node scripts/security-check.js dist/production
```

### Manual Security Verification

1. **File Access Test**: Try accessing sensitive files via browser
   ```
   https://yourdomain.com/.env          ❌ Should be blocked
   https://yourdomain.com/config/       ❌ Should be blocked
   https://yourdomain.com/logs/         ❌ Should be blocked
   ```

2. **Security Headers Test**: Check response headers
   ```bash
   curl -I https://yourdomain.com
   ```
   Should include:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Strict-Transport-Security: max-age=31536000`

3. **Source Code Protection**: Verify JavaScript is obfuscated
   - View page source
   - Check that JavaScript is minified/obfuscated
   - Ensure no readable variable names or comments

## 🚨 Security Incident Response

### If Sensitive Files Are Exposed

1. **Immediate Action**:
   ```bash
   # Stop application
   pm2 stop eInvoice-prod
   
   # Remove exposed files
   rm -rf /path/to/exposed/files
   
   # Rebuild and redeploy
   pnpm run build
   pnpm run deploy
   ```

2. **Investigation**:
   - Check security report for missed files
   - Review build configuration
   - Update exclusion patterns if needed

3. **Prevention**:
   - Update `.gitignore`
   - Enhance security checks
   - Review deployment process

## 📊 Monitoring & Maintenance

### Regular Security Tasks

- **Weekly**: Run security audit and check for vulnerabilities
- **Monthly**: Review and update security configurations
- **Quarterly**: Conduct comprehensive security assessment

### Log Monitoring

```bash
# Monitor application logs
pm2 logs eInvoice-prod

# Check for security-related errors
grep -i "error\|unauthorized\|forbidden" /var/log/einvoice/*.log
```

## 🆘 Troubleshooting

### Build Fails

```bash
# Check build dependencies
pnpm install

# Clean and retry
pnpm run clean
pnpm run build
```

### Deployment Fails

```bash
# Check target directory permissions
# Verify PM2 is installed
# Check if ports are available
```

### Security Check Fails

```bash
# Review security report
cat dist/production/security-report.json

# Fix identified issues
# Rebuild and recheck
```

## 📞 Support

For security-related issues or questions:

1. Review this documentation
2. Check security reports in build output
3. Consult with security team
4. Update security configurations as needed

---

**⚠️ IMPORTANT**: Never commit sensitive files to version control. Always use the secure build process for production deployments.
