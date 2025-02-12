# Use Node.js LTS version
FROM node:18-windowsservercore

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads sessions

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
