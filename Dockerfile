FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port (useful for hosting providers)
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Run start script
CMD [ "npm", "start" ]
