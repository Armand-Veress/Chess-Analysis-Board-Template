# Build: Node.js 22 Alpine image
FROM node:22-alpine
WORKDIR /app

# Copy configuration files and install dependencies
COPY package*.json ./
RUN npm install


COPY . .


EXPOSE 4200

# Start the Angular server with external access for Docker
CMD ["npx", "ng", "serve", "--host", "0.0.0.0"]