FROM ghcr.io/puppeteer/puppeteer:21.5.2

# Switch to root to install dependencies if needed, 
# though the ghcr image usually handles this.
USER root

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Expose port
EXPOSE 3000

# Start command
CMD [ "node", "server.js" ]
