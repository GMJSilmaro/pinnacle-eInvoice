# Pixelcare-e-Invoice-Middleware for LHDN - XML VARIANT


A specialized middleware solution designed to integrate business applications with LHDN's (Lembaga Hasil Dalam Negeri) e-Invoicing system. This middleware facilitates seamless invoice data exchange while ensuring compliance with Malaysian tax regulations.

## Overview

Pixelcare-e-Invoice-Middleware serves as a bridge between your business systems and LHDN's e-invoicing platform, automating the submission and verification of electronic invoices in accordance with Malaysian tax requirements.

## Key Features

- LHDN Integration
  - Direct connection to LHDN's e-invoicing APIs
  - Real-time invoice submission and validation
  - Automated tax compliance checks
  - Support for Malaysia's GST/SST requirements

- System Integration
  - Compatible with major ERP and accounting systems
  - Flexible data mapping and transformation
  - Batch processing capabilities
  - Error handling and retry mechanisms

- Compliance & Security
  - Adherence to LHDN's technical specifications
  - Secure data transmission using encryption
  - Digital signature support
  - Comprehensive audit logging
  - Data retention compliance

## Technical Requirements

- Server Requirements
  - Windows Server 2016 or later
  - .NET Framework 4.7.2 or later
  - SQL Server 2016 or later
  - Minimum 8GB RAM
  - 100GB storage space

- Network Requirements
  - Stable internet connection
  - Access to LHDN's API endpoints
  - Firewall configuration for secure communication
  - SSL/TLS support

## Installation Process

1. System Preparation
   - Verify server meets minimum requirements
   - Configure necessary permissions
   - Install required dependencies

2. Middleware Installation
   - Execute the installation package
   - Configure database connections
   - Set up LHDN API credentials
   - Configure system parameters

3. Integration Setup
   - Configure source system connections
   - Set up data mapping rules
   - Establish error handling protocols
   - Test connectivity

## Configuration

The middleware requires the following configurations:

- LHDN API credentials
- Database connection strings
- System endpoints
- Processing parameters
- Logging settings
- Backup configurations

## Support & Maintenance

- Technical Support
  - Email: support@pixelcare.com
  - Phone: +60 XX-XXXX XXXX
  - Support hours: 9 AM - 6 PM (Malaysia Time)

- Maintenance
  - Regular updates for LHDN compliance
  - System health monitoring
  - Performance optimization
  - Security patches

## Legal & Compliance

- Compliant with Malaysian tax regulations
- Adherence to LHDN's technical specifications
- Data protection in accordance with PDPA

## Contact Information

For inquiries and support:
- Sales: sales@pixelcare.com
- Support: support@pixelcare.com
- Office: +60 XX-XXXX XXXX

## CI/CD and Deployment

### Branch Strategy
- development: Development and integration branch
- staging: Pre-production testing branch
- production: Live production branch

### CI/CD Pipeline
The project uses GitHub Actions for automated CI/CD with the following workflow:

1. Development Pipeline
   - Triggered on push/PR to development branch
   - Runs tests
   - Builds Docker image
   - Deploys to development environment

2. Staging Pipeline
   - Triggered on push/PR to staging branch
   - Runs tests
   - Builds Docker image
   - Deploys to staging environment

3. Production Pipeline
   - Triggered on push/PR to production branch
   - Runs comprehensive tests
   - Builds Docker image
   - Deploys to production environment

### Docker Deployment
The application is containerized using Docker for consistent deployment across environments:

- Uses Windows Server container base image
- Includes all necessary dependencies
- Manages persistent volumes for logs, uploads, and sessions
- Supports environment-specific configurations

### Maintenance Guide
1. Code Changes
   - Create feature branch from development
   - Submit PR to development branch
   - After testing, merge to staging
   - After staging validation, merge to production

2. Deployment
   - Automated via GitHub Actions
   - Manual deployment possible using docker-compose
   - Monitor logs in /logs directory
   - Check container health using Docker commands

3. Monitoring
   - Access logs in mounted volume
   - Use Docker commands for container status
   - Monitor application metrics
   - Set up alerts for critical issues

### Environment Setup
1. Prerequisites
   - Docker Desktop for Windows
   - Git
   - Access to Azure Container Registry

2. Local Development
   ```bash
   # Clone repository
   git clone [repository-url]
   git checkout development

   # Build and run
   docker-compose -f docker-compose.dev.yml up -d
   ```

## 🔄 Development Workflow Guide

### Branch Management

1. **Main Branches**
   ```bash
   development  # Development and integration branch
   staging      # Pre-production testing branch
   production   # Live production branch
   ```

2. **Working with Branches**
   ```bash
   # View all branches
   git branch -a

   # Create a new feature branch
   git checkout development
   git checkout -b feature/your-feature-name

   # Switch between branches
   git checkout development
   git checkout staging
   git checkout production
   ```

3. **Daily Development Workflow**
   ```bash
   # 1. Update your development branch
   git checkout development
   git pull origin development

   # 2. Create a feature branch
   git checkout -b feature/new-feature

   # 3. Make your changes and commit
   git add .
   git commit -m "Description of your changes"

   # 4. Push your feature branch
   git push origin feature/new-feature
   ```

4. **Merging Changes**
   ```bash
   # Merge to development
   git checkout development
   git merge feature/new-feature
   git push origin development

   # Merge to staging
   git checkout staging
   git merge development
   git push origin staging

   # Merge to production
   git checkout production
   git merge staging
   git push origin production
   ```

### Docker Workflow

1. **Local Development**
   ```bash
   # Start Docker Desktop as Administrator
   
   # Build and run development environment
   docker-compose -f docker-compose.dev.yml up -d

   # View logs
   docker-compose -f docker-compose.dev.yml logs -f

   # Stop development environment
   docker-compose -f docker-compose.dev.yml down
   ```

2. **Building and Pushing Images**
   ```bash
   # Login to Docker Hub
   docker login

   # Build image for different environments
   docker build -t gmjsilmaro/pixelcare:dev .
   docker build -t gmjsilmaro/pixelcare:staging .
   docker build -t gmjsilmaro/pixelcare:1.0.0 .

   # Push images to Docker Hub
   docker push gmjsilmaro/pixelcare:dev
   docker push gmjsilmaro/pixelcare:staging
   docker push gmjsilmaro/pixelcare:1.0.0
   ```

3. **Deployment**
   ```bash
   # Development
   docker-compose -f docker-compose.dev.yml up -d

   # Staging
   docker-compose -f docker-compose.staging.yml up -d

   # Production
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Version Control

1. **Creating a New Version**
   ```bash
   # Update version in package.json
   npm version patch  # For bug fixes
   npm version minor  # For new features
   npm version major  # For breaking changes

   # Create git tag
   git tag -a v1.0.0 -m "Version 1.0.0"
   git push origin v1.0.0
   ```

2. **Managing Tags**
   ```bash
   # List all tags
   git tag

   # Delete a tag locally
   git tag -d v1.0.0

   # Delete a tag from remote
   git push origin --delete v1.0.0
   ```

### Common Issues and Solutions

1. **Docker Issues**
   - Always run Docker Desktop as Administrator
   - Restart Docker Desktop if you encounter connection issues
   - Use `docker system prune` to clean up unused resources

2. **Git Issues**
   ```bash
   # Discard local changes
   git checkout -- .

   # Reset to remote branch
   git fetch origin
   git reset --hard origin/development

   # Clean untracked files
   git clean -fd
   ```

3. **Deployment Issues**
   ```bash
   # Check container logs
   docker logs container_name

   # Restart container
   docker-compose restart

   # Remove all containers and start fresh
   docker-compose down
   docker-compose up -d
   ```

### Best Practices

1. **Commits**
   - Write clear commit messages
   - Keep commits focused and atomic
   - Use conventional commit format:
     ```
     feat: add new feature
     fix: resolve bug
     docs: update documentation
     ```

2. **Branching**
   - Never commit directly to production
   - Always create feature branches from development
   - Delete feature branches after merging

3. **Docker**
   - Tag images with specific versions
   - Don't use latest tag in production
   - Regular cleanup of unused images and containers

4. **Testing**
   - Test changes in development first
   - Verify in staging before production
   - Monitor logs after deployment

---

 2025 Pixelcare Solutions. All rights reserved.
This software is proprietary and confidential.
