#!/bin/sh
set -e

echo "Starting Einkaufsliste application..."
echo "Setting up database directory..."

# Ensure /app/data directory exists with correct permissions
mkdir -p /app/data
chmod 777 /app/data

# Try to write test file to verify permissions
if touch /app/data/.test 2>/dev/null; then
  rm -f /app/data/.test
  echo "Database directory is writable"
else
  echo "WARNING: /app/data is not writable - database will not persist!"
fi

echo "Attempting to initialize database..."

# Start Node.js application
exec node backend/server.js
