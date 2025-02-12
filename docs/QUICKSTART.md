# Quick Start Guide

## 🚀 First-Time Setup

### 1. Prerequisites
- Git installed
- Node.js 18+ installed
- Docker Desktop installed
- GitHub account with repository access
- Docker Hub account

### 2. Initial Setup
```bash
# Clone repository
git clone https://github.com/GMJSilmaro/tekauto-einvoice.git
cd tekauto-einvoice

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start Docker Desktop (as Administrator)
```

### 3. Development Environment
```bash
# Create and checkout development branch
git checkout -b development
git push origin development

# Start development environment
docker-compose -f docker-compose.dev.yml up -d
```

## 📝 Daily Development

### 1. Start Your Day
```bash
# Update your branches
git checkout development
git pull origin development

# Start Docker services
docker-compose -f docker-compose.dev.yml up -d
```

### 2. Create New Feature
```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
npm test

# Commit changes
git add .
git commit -m "feat: description"
git push origin feature/your-feature
```

### 3. End Your Day
```bash
# Commit all changes
git add .
git commit -m "wip: end of day commit"
git push origin feature/your-feature

# Stop Docker services
docker-compose -f docker-compose.dev.yml down
```

## 🔍 Common Tasks

### View Logs
```bash
# Application logs
docker-compose -f docker-compose.dev.yml logs -f app

# Database logs
docker-compose -f docker-compose.dev.yml logs -f db
```

### Database Operations
```bash
# Access database
docker exec -it tekauto-einvoice_db_1 psql -U postgres

# Run migrations
npm run migrate:up
```

### Testing
```bash
# Run tests
npm test

# Run specific test
npm test -- tests/your-test.js
```

## 🆘 Troubleshooting

### Docker Issues
1. **Container won't start**
   ```bash
   # Remove containers and volumes
   docker-compose down -v
   
   # Rebuild and start
   docker-compose -f docker-compose.dev.yml up -d --build
   ```

2. **Port conflicts**
   ```bash
   # Check ports in use
   netstat -ano | findstr "3000"
   
   # Kill process using port
   taskkill /PID <PID> /F
   ```

### Git Issues
1. **Merge conflicts**
   ```bash
   # Get latest changes
   git fetch origin
   
   # Reset to origin
   git reset --hard origin/development
   ```

2. **Wrong branch**
   ```bash
   # Save changes
   git stash
   
   # Switch branch
   git checkout correct-branch
   
   # Apply changes
   git stash pop
   ```

## 📞 Getting Help

- **Technical Issues**: Contact Gilbert @gmjsilmaro
- **Access Issues**: Contact System Admin
- **Documentation**: Check `/docs` folder
- **API Docs**: Visit `http://localhost:3000/api-docs`

## 🔐 Security Notes

- Never commit `.env` files
- Don't share your access tokens
- Use strong passwords
- Keep Docker Desktop updated
