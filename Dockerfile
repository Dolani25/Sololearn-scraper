# Use a lightweight Node image
FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]
