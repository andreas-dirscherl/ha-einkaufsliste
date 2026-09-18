#!/bin/sh
set -e

echo "Starting Einkaufsliste application..."
echo "Attempting to initialize database..."

# Start Node.js application
exec node backend/server.js
