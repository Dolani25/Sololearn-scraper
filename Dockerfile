FROM ghcr.io/puppeteer/puppeteer:21.5.2

USER root
WORKDIR /usr/src/app

COPY package*.json ./

# CHANGE THIS LINE: use 'install' instead of 'ci'
RUN npm install 

COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]

