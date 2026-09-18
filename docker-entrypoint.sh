#!/bin/sh
set -e

echo "� Starting Einkaufsliste application..."
echo "📁 Database will be stored at: /app/app.db"

# Start Node.js application
exec node backend/server.js
