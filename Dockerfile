# Base image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port (adjust if needed)
EXPOSE 3000

# Run the application
CMD ["node", "src/main.js"]
