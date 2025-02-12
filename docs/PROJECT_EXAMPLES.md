# Project-Specific Examples

## E-Invoice Development Examples

### 1. Adding New Invoice Validation Rule
```javascript
// In services/lhdn/lhdnService.js

// Add new validation function
async function validateInvoiceAmount(invoice) {
  if (!invoice.amount || invoice.amount <= 0) {
    throw new Error('Invoice amount must be greater than 0');
  }
  
  if (invoice.amount > 1000000) {
    // Log high-value invoices
    logger.warn(`High value invoice detected: ${invoice.id}`);
  }
  
  return true;
}

// Add to validation chain
const validationChain = [
  validateInvoiceAmount,
  validateTaxCode,
  validateCustomerInfo
];
```

### 2. Implementing New API Endpoint
```javascript
// In routes/api/invoice.js

router.post('/validate', async (req, res) => {
  try {
    const invoice = req.body;
    
    // Validate invoice
    await lhdnService.validateInvoice(invoice);
    
    // Submit to LHDN
    const result = await lhdnSubmitter.submitInvoice(invoice);
    
    res.json({
      success: true,
      reference: result.referenceNumber
    });
  } catch (error) {
    logger.error('Invoice validation failed:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});
```

### 3. Database Migration Example
```javascript
// In migrations/20250209_add_invoice_status.js

exports.up = function(knex) {
  return knex.schema.table('invoices', table => {
    table.string('status').defaultTo('pending');
    table.timestamp('submitted_at').nullable();
    table.string('lhdn_reference').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('invoices', table => {
    table.dropColumn('status');
    table.dropColumn('submitted_at');
    table.dropColumn('lhdn_reference');
  });
};
```

## Docker Examples

### 1. Development Environment with Hot Reload
```yaml
# In docker-compose.dev.yml
version: '3.8'

services:
  app:
    build: 
      context: .
      target: development
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - DEBUG=tekauto:*
    command: npm run dev
```

### 2. Production Build Example
```dockerfile
# In Dockerfile
# Build stage
FROM node:18-windowsservercore as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:18-windowsservercore
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --only=production
CMD ["npm", "start"]
```

## Testing Examples

### 1. Unit Test Example
```javascript
// In tests/invoice.test.js
describe('Invoice Validation', () => {
  test('should validate correct invoice format', async () => {
    const invoice = {
      invoiceNumber: 'INV001',
      amount: 1000.00,
      taxCode: 'MY123456789',
      items: [
        { description: 'Item 1', amount: 500.00 },
        { description: 'Item 2', amount: 500.00 }
      ]
    };

    const result = await lhdnService.validateInvoice(invoice);
    expect(result.isValid).toBe(true);
  });
});
```

### 2. Integration Test Example
```javascript
// In tests/integration/lhdn-api.test.js
describe('LHDN API Integration', () => {
  test('should submit invoice successfully', async () => {
    const invoice = generateTestInvoice();
    
    const response = await request(app)
      .post('/api/invoices/submit')
      .send(invoice);
      
    expect(response.status).toBe(200);
    expect(response.body.reference).toBeDefined();
  });
});
```

## CI/CD Examples

### 1. Development Deployment
```bash
# Deploy to development
git checkout development
git pull origin development

# Build and deploy
docker-compose -f docker-compose.dev.yml build --no-cache
docker-compose -f docker-compose.dev.yml up -d

# Run migrations
npm run migrate:up

# Verify deployment
curl http://localhost:3000/health
```

### 2. Production Deployment
```bash
# Create release
git checkout production
git merge staging
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# Deploy
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
curl https://api.production.com/health
```

## Monitoring Examples

### 1. Log Analysis
```javascript
// In utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'tekauto-einvoice' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log'
    })
  ]
});
```

### 2. Health Check Endpoint
```javascript
// In routes/health.js
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.raw('SELECT 1');
    
    // Check LHDN API
    await lhdnService.checkConnection();
    
    res.json({
      status: 'healthy',
      database: 'connected',
      lhdnApi: 'connected',
      version: process.env.VERSION || '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```
