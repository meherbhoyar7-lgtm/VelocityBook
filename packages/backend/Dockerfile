FROM node:20-alpine
WORKDIR /app

# Copy root workspace configs and package manifests
COPY package*.json ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/backend/package.json ./packages/backend/

# Install workspace dependencies
RUN npm install

# Copy source trees
COPY packages/engine/ ./packages/engine/
COPY packages/backend/ ./packages/backend/

# Build engine and backend packages
RUN npm run build --workspace=@velocitybook/engine
RUN npm run build --workspace=@velocitybook/backend

WORKDIR /app/packages/backend

EXPOSE 3001
CMD ["node", "dist/server.js"]
