#!/bin/sh
set -e

echo "Starting Einkaufsliste application..."

# Ensure /app/data directory exists with proper permissions
mkdir -p /app/data
chmod 755 /app/data

echo "Database location: /app/data/app.db"

# Start Node.js application
exec node backend/server.js
