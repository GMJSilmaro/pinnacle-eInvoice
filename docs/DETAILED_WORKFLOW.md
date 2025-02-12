# Detailed Workflow Guide

## Git Workflow in Detail

### Feature Development Cycle

1. **Starting a New Feature**
   ```bash
   # Update development branch
   git checkout development
   git pull origin development
   
   # Create feature branch
   git checkout -b feature/FEATURE-NAME
   # Example: git checkout -b feature/einvoice-validation
   ```

2. **During Development**
   ```bash
   # Save your work frequently
   git add .
   git commit -m "feat: add invoice validation logic"
   
   # Push changes to remote
   git push origin feature/FEATURE-NAME
   
   # Update from development if needed
   git checkout development
   git pull origin development
   git checkout feature/FEATURE-NAME
   git merge development
   ```

3. **Code Review Process**
   - Create Pull Request on GitHub
   - Request review from team members
   - Address feedback and make changes
   - Update PR with new commits

4. **Merging Feature**
   ```bash
   # After PR approval
   git checkout development
   git merge feature/FEATURE-NAME
   git push origin development
   
   # Delete feature branch
   git branch -d feature/FEATURE-NAME
   git push origin --delete feature/FEATURE-NAME
   ```

## Docker Workflow in Detail

### Local Development

1. **Environment Setup**
   ```bash
   # Start fresh
   docker-compose -f docker-compose.dev.yml down
   docker system prune -f  # Clean unused resources
   
   # Build and start
   docker-compose -f docker-compose.dev.yml build --no-cache
   docker-compose -f docker-compose.dev.yml up -d
   
   # View logs
   docker-compose -f docker-compose.dev.yml logs -f app
   ```

2. **Common Docker Commands**
   ```bash
   # Check container status
   docker ps
   
   # Enter container shell
   docker exec -it tekauto-einvoice_app_1 bash
   
   # View container logs
   docker logs -f tekauto-einvoice_app_1
   
   # Check resource usage
   docker stats
   ```

3. **Troubleshooting**
   ```bash
   # Check container health
   docker inspect tekauto-einvoice_app_1
   
   # View network settings
   docker network ls
   docker network inspect tekauto-einvoice_default
   
   # Clean up system
   docker system prune -a
   docker volume prune
   ```

## CI/CD Pipeline Details

### GitHub Actions Workflow

1. **Development Pipeline**
   - Triggers on push to development branch
   - Runs unit tests
   - Builds development Docker image
   - Deploys to development environment
   - Updates status in GitHub

2. **Staging Pipeline**
   - Triggers on push to staging branch
   - Runs integration tests
   - Builds staging Docker image
   - Deploys to staging environment
   - Runs smoke tests

3. **Production Pipeline**
   - Triggers on push to production branch
   - Runs full test suite
   - Builds production Docker image
   - Creates release tag
   - Deploys to production
   - Runs health checks

### Environment Variables

1. **Development**
   ```env
   NODE_ENV=development
   PORT=3000
   DEBUG=true
   ```

2. **Staging**
   ```env
   NODE_ENV=staging
   PORT=3000
   DEBUG=false
   ```

3. **Production**
   ```env
   NODE_ENV=production
   PORT=3000
   DEBUG=false
   ```

## Testing Strategy

### Unit Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/invoice.test.js

# Run with coverage
npm test -- --coverage
```

### Integration Tests
```bash
# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

### Load Tests
```bash
# Run load tests
npm run test:load
```

## Monitoring and Logging

### Log Locations
- Application logs: `/logs/app.log`
- Error logs: `/logs/error.log`
- Access logs: `/logs/access.log`

### Monitoring Commands
```bash
# Check application status
curl http://localhost:3000/health

# Monitor resource usage
docker stats tekauto-einvoice_app_1

# View real-time logs
tail -f logs/app.log
```

## Database Management

### Backup and Restore
```bash
# Create backup
docker exec tekauto-einvoice_db_1 pg_dump -U postgres > backup.sql

# Restore from backup
docker exec -i tekauto-einvoice_db_1 psql -U postgres < backup.sql
```

### Migration Commands
```bash
# Run migrations
npm run migrate:up

# Rollback migration
npm run migrate:down

# Create new migration
npm run migrate:create
```
