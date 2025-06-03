# 🗄️ Prisma Integration Guide for eInvoice Project

## 📋 Overview

The eInvoice project now includes comprehensive Prisma database integration in the build and deployment process. This ensures that database operations are properly handled during development, building, and production deployment.

## 🚀 Features Implemented

### **1. Build-Time Integration**
- ✅ Prisma schema validation during build
- ✅ Prisma client generation in build output
- ✅ Automatic inclusion of Prisma files in production builds
- ✅ Schema validation without requiring database connection

### **2. Deployment-Time Integration**
- ✅ Automatic database connection testing
- ✅ Migration deployment for production
- ✅ Prisma client regeneration after migrations
- ✅ Graceful handling of database connectivity issues

### **3. Development Tools**
- ✅ Comprehensive Prisma management script
- ✅ Health check functionality
- ✅ Database introspection and schema updates
- ✅ Easy-to-use npm scripts

## 📦 Available Commands

### **Basic Prisma Operations**
```bash
# Generate Prisma client
pnpm run db:generate

# Pull database schema
pnpm run db:pull

# Push schema to database
pnpm run db:push

# Deploy migrations (production)
pnpm run db:migrate

# Create new migration (development)
pnpm run db:migrate:dev

# Reset database
pnpm run db:reset

# Seed database
pnpm run db:seed

# Open Prisma Studio
pnpm run db:studio

# Validate schema
pnpm run db:validate

# Format schema
pnpm run db:format
```

### **Advanced Operations**
```bash
# Full database setup
pnpm run db:setup

# Database health check
pnpm run db:health

# Introspect and update schema
pnpm run db:introspect

# Build-time setup (validation + generation)
pnpm run db:build-setup

# Deployment-time setup (migrate + generate)
pnpm run db:deploy-setup
```

### **Direct Prisma Manager Usage**
```bash
# Using the Prisma manager script directly
node scripts/prisma-manager.js <command> [environment]

# Examples
node scripts/prisma-manager.js setup production
node scripts/prisma-manager.js health
node scripts/prisma-manager.js introspect development
```

## 🏗️ Build Process Integration

### **What Happens During Build**

1. **Schema Validation**: Validates Prisma schema syntax
2. **Client Generation**: Generates Prisma client for the build
3. **File Inclusion**: Copies Prisma schema and migrations to build output
4. **Security Check**: Ensures no sensitive database information in build

### **Build Configuration**

The build process automatically includes:
- `prisma/schema.prisma` - Database schema
- `prisma/migrations/**/*` - Migration files
- `src/**/*.js` - Source files including Prisma session store

## 🚀 Deployment Process Integration

### **What Happens During Deployment**

1. **Environment Check**: Verifies .env file exists
2. **Client Generation**: Generates Prisma client in deployment directory
3. **Connection Test**: Tests database connectivity
4. **Migration Deployment**: Applies pending migrations (if database accessible)
5. **Client Regeneration**: Regenerates client after migrations

### **Deployment Scenarios**

#### **Scenario 1: Database Accessible**
```
✅ Database connection successful
✅ Migrations applied
✅ Prisma client regenerated
✅ Ready to start application
```

#### **Scenario 2: Database Not Accessible**
```
⚠️  Database not accessible during deployment
ℹ️  Manual steps required:
   - Configure database connection
   - Run: pnpm run db:migrate
   - Run: pnpm run db:generate
```

## 🔧 Manual Database Operations

### **After Deployment Setup**

If database operations fail during deployment, run these commands manually:

```bash
# Navigate to deployment directory
cd C:\inetpub\wwwroot\eInvoice-prod

# Configure environment
copy .env.template .env
notepad .env

# Run database setup
pnpm run db:setup

# Or run individual steps
pnpm run db:generate
pnpm run db:migrate
pnpm run db:generate
```

### **Development Workflow**

```bash
# Start development
pnpm install
pnpm run db:setup

# Make schema changes
# Edit prisma/schema.prisma

# Create and apply migration
pnpm run db:migrate:dev --name "your-migration-name"

# Or push changes directly (development only)
pnpm run db:push
```

## 🏥 Health Monitoring

### **Database Health Check**

```bash
pnpm run db:health
```

**Output Example:**
```
📊 Health Check Results:
   Schema Valid: ✅
   Client Generated: ✅
   Database Connected: ✅
🎉 All Prisma health checks passed!
```

### **Troubleshooting Common Issues**

#### **Schema Validation Failed**
```bash
# Fix schema syntax errors
pnpm run db:format
pnpm run db:validate
```

#### **Client Not Generated**
```bash
# Regenerate client
pnpm run db:generate
```

#### **Database Connection Failed**
```bash
# Check environment variables
# Verify database server is running
# Test connection
pnpm run db:pull
```

## 📁 File Structure

### **Prisma Files in Build**
```
dist/production/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── [migration-files]
├── src/
│   └── lib/
│       └── prisma-session-store.js
└── [other-build-files]
```

### **Development Structure**
```
eInvoice/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   └── lib/
│       └── prisma-session-store.js
├── scripts/
│   └── prisma-manager.js
└── [other-files]
```

## 🔒 Security Considerations

### **What's Protected**
- ✅ Database credentials externalized to .env
- ✅ No hardcoded connection strings in build
- ✅ Migration files included but no sensitive data
- ✅ Prisma client generated without exposing credentials

### **Best Practices**
- Always use environment variables for database connections
- Never commit .env files to version control
- Use strong database passwords
- Restrict database access to necessary IPs only

## 🚨 Error Handling

### **Build Errors**
- Schema validation failures are logged but don't stop build
- Client generation failures are logged but don't stop build
- Build continues with warning messages

### **Deployment Errors**
- Database connection failures are logged but don't stop deployment
- Migration failures are logged with manual recovery instructions
- Application can still be deployed and started manually

## 📞 Support Commands

### **Get Help**
```bash
node scripts/prisma-manager.js help
```

### **Check Current Status**
```bash
pnpm run db:health
```

### **Full Reset (Development Only)**
```bash
pnpm run db:reset
pnpm run db:setup
```

---

**🎉 Your eInvoice project now has comprehensive Prisma integration!** The database operations are seamlessly integrated into your build and deployment process, ensuring consistent and reliable database management across all environments.
