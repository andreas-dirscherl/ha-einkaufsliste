#!/bin/sh
set -e

echo "🔧 Initializing application..."

# Ensure data directory exists with proper permissions
mkdir -p /app/data
chmod 777 /app/data

# Check if directory is writable
if [ ! -w /app/data ]; then
  echo "❌ ERROR: /app/data is not writable!"
  ls -la /app/data
  exit 1
fi

echo "✅ /app/data is ready"

# Create empty database file if it doesn't exist (helps with locks)
if [ ! -f /app/data/app.db ]; then
  touch /app/data/app.db
  chmod 666 /app/data/app.db
  echo "✅ Created database file"
fi

echo "🚀 Starting Node.js application..."
exec node backend/server.js
