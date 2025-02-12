# Git Workflow Guide

## 🌳 Branch Structure

```
main/production    ●───────●────────●──────● (stable, live code)
                   │       │        │      │
staging            ●───────●────────●      │ (testing)
                   │       │        │      │
development        ●───────●────────●      │ (main dev branch)
                   │       │        │      │
feature branches   ●───●───●              │ (your work)
```

## 📝 Daily Commands

### Starting Your Day
```bash
# Get latest changes
git checkout development
git pull origin development

# Create your feature branch
git checkout -b feature/your-task
# Example: git checkout -b feature/lhdn-submission
```

### During Development
```bash
# See what files you changed
git status

# See your changes
git diff

# Save your work
git add .
git commit -m "type: description"
# Example: git commit -m "feat: add LHDN submission API"

# Push to remote
git push origin feature/your-task
```

### Branch Management
```bash
# List all branches
git branch

# Switch branches
git checkout branch-name

# Rename current branch
git branch -m new-name
# Example: git branch -m feature/lhdn-api

# Rename other branch
git branch -m old-name new-name

# Delete branch (after merging)
git branch -d branch-name
```

## 🔄 Common Workflows

### 1. Starting New Feature
```bash
git checkout development
git pull origin development
git checkout -b feature/new-feature
```

### 2. Updating Your Feature Branch
```bash
# Get latest development changes
git checkout development
git pull origin development

# Update your feature branch
git checkout feature/task
git merge development
```

### 3. Creating Pull Request
```bash
# Push your changes
git push origin feature/task

# Then create PR on GitHub:
# feature/task → development
# First switch back to development
git checkout development

# Update development with latest changes
git pull origin development

# Delete the local feature branch
git branch -d feature/task

# Delete the remote feature branch
git push origin --delete feature/task
```

### 4. Deployment Flow
```bash
# 1. Merge to Development (via PR)
git checkout development
git pull origin development
git merge feature/your-task
git push origin development

# 2. Deploy to Staging
git checkout staging
git pull origin staging
git merge development
git push origin staging

# 3. Deploy to Production
git checkout production
git pull origin production
git merge staging
git push origin production
```

## 🚨 Emergency Situations

### 1. Accidentally Committed to Wrong Branch
```bash
# Save current changes
git stash

# Switch to correct branch
git checkout correct-branch

# Apply changes
git stash pop
```

### 2. Need to Undo Last Commit
```bash
# Undo commit but keep changes
git reset --soft HEAD~1

# Undo commit and discard changes
git reset --hard HEAD~1
```

### 3. Accidentally Pushed to Production
```bash
# Create backup
git checkout production
git checkout -b backup-YYYY-MM-DD

# Revert the commit
git revert commit-hash
git push origin production
```

## 🏷️ Commit Message Types

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Formatting, missing semicolons, etc
- `refactor:` Code restructuring
- `test:` Adding tests
- `chore:` Maintenance tasks

Example:
```bash
git commit -m "feat: add LHDN API integration"
git commit -m "fix: correct tax calculation"
git commit -m "docs: update API documentation"
```

## ✅ Best Practices

1. **Never** commit directly to production/main
2. **Always** create feature branches from development
3. **Always** pull before starting new work
4. Write clear commit messages
5. Create small, focused commits
6. Test before pushing
7. Keep branches up to date with development

## 🔍 Useful Investigation Commands

```bash
# View commit history
git log --oneline

# View commit details
git show commit-hash

# View branch history
git log --graph --oneline --all

# Find which commit introduced a bug
git bisect start
git bisect bad  # current commit is bad
git bisect good commit-hash  # last known good commit
```
