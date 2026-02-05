FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy compiled JavaScript files
COPY dist/ ./dist/

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]