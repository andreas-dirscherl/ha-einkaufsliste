# Multi-stage Dockerfile for optimal image size

# Stage 1: Build stage (dependencies)
# Use Debian-based image for better build tool support
FROM node:20-bookworm AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies (npm install works without package-lock.json in Docker)
# Using --omit=dev to exclude dev dependencies
RUN npm install --omit=dev

# Stage 2: Runtime stage
# Keep Debian for glibc compatibility with better-sqlite3
FROM node:20-bookworm-slim

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Copy node_modules from builder
# Copy --from=builder /app/node_modules ./node_modules

# Copy application files
COPY backend ./backend
COPY frontend ./frontend
COPY assets ./assets
COPY package*.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "backend/server.js"]
