FROM ghcr.io/puppeteer/puppeteer:21.5.2

# 1. CRITICAL FIX: Tell Puppeteer to skip downloading Chrome
# We also set the executable path so your code knows where the pre-installed Chrome is.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

USER root
WORKDIR /usr/src/app

COPY package*.json ./

# 2. This will now run much faster because it only installs the small JavaScript wrapper
RUN npm install

COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]

