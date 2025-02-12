Do not change any other methods or anything in the files I sent unless it's absolutely necessary for what I ask for to work. 
Do not do refactoring of code unless I explicitly ask to do it.
Do not fix style in the existing code unless I ask for that. 
Do not add or remove new lines in the end of the code (i.e. leave it as is either with or without). 
Do not remove existing comments unless I explicitly ask for it or we're removing that code completely.

# eInvoice Project Coding Conventions

## General Guidelines

### File Structure
- Use meaningful directory names in lowercase
- Group related files in dedicated directories (routes, services, middleware)
- Keep files focused and single-responsibility
- Use `.js` extension for JavaScript files
- Use `.html` extension for Swig templates

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for classes
- Use UPPER_SNAKE_CASE for constants
- Use kebab-case for file names
- Prefix private methods with underscore

### Code Style
- Use 2 spaces for indentation
- Use semicolons at the end of statements
- Use single quotes for strings
- Always use strict equality (===)
- Maximum line length: 100 characters

### Templates
- Store all templates in `/views` directory
- Use subdirectories for feature-specific templates
- Follow component-based structure for partials
- Use meaningful template names

### Routes
- Group routes by feature in separate files
- Use RESTful naming conventions
- Include version in API routes (/api/v1/...)
- Keep route handlers thin, move logic to services

### Error Handling
- Use async/await with try-catch
- Implement proper error middleware
- Log errors with appropriate detail
- Return consistent error responses

### Security
- Never commit sensitive data
- Use environment variables for configuration
- Implement proper input validation
- Use secure session settings

### Performance
- Implement caching where appropriate
- Use prerendering for static content
- Optimize database queries
- Implement proper logging levels

### Documentation
- Document all API endpoints
- Include JSDoc comments for functions
- Maintain README.md with setup instructions
- Document environment variables

### Testing
- Write unit tests for critical functionality
- Use meaningful test descriptions
- Follow arrange-act-assert pattern
- Maintain test coverage

## Examples

### JavaScript
```javascript
// Good
const getUserById = async (id) => {
  try {
    return await User.findById(id);
  } catch (error) {
    logger.error('Failed to fetch user:', error);
    throw error;
  }
};

// Bad
async function get_user(id) {
  return User.findById(id).catch(console.log);
}
```

### Route Definition
```javascript
// Good
router.get('/users/:id', userController.getUser);
router.post('/users', userController.createUser);

// Bad
router.get('/getUser/:id', (req, res) => {
  // Logic directly in route
});
```

### Template Structure
```html
{# Good #}
{% extends 'layout.html' %}
{% block content %}
  {% include 'partials/header.html' %}
  <main>{{ content }}</main>
{% endblock %}

{# Bad #}
<html>
  {# Inline everything #}
</html>