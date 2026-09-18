# Multi-stage Dockerfile for optimal image size

# Stage 1: Build stage (dependencies)
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies with build tools available
RUN npm ci --only=production

# Remove build dependencies to reduce layer size
RUN apk del .build-deps

# Stage 2: Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY backend ./backend
COPY frontend ./frontend
COPY assets ./assets
COPY package*.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "backend/server.js"]
