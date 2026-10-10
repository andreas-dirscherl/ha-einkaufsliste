#!/usr/bin/env node

/**
 * Generate VAPID keys for Web Push API
 * Run this once and add the keys to your .env file
 * 
 * Usage:
 *   node scripts/generate-vapid-keys.js
 */

import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

try {
  console.log('🔑 Generating VAPID keys for Web Push API...\n');
  
  const vapidKeys = webpush.generateVAPIDKeys();
  
  console.log('✓ VAPID Keys generated successfully!\n');
  console.log('Add these to your .env file:\n');
  console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
  console.log('VAPID_SUBJECT=mailto:admin@example.com\n');
  
  // Check if .env exists
  if (fs.existsSync(envPath)) {
    console.log('📝 Appending to .env file...');
    const envContent = `\n# Web Push Notifications\nVAPID_PUBLIC_KEY=${vapidKeys.publicKey}\nVAPID_PRIVATE_KEY=${vapidKeys.privateKey}\nVAPID_SUBJECT=mailto:admin@example.com\n`;
    fs.appendFileSync(envPath, envContent);
    console.log('✓ Keys added to .env\n');
  } else {
    console.log('⚠️  .env file not found. Please create it and add the keys above.\n');
  }
  
  console.log('🚀 Web Push is now configured!\n');
  console.log('Notes:');
  console.log('- Keep VAPID_PRIVATE_KEY secret - never commit to git');
  console.log('- VAPID_PUBLIC_KEY is sent to browsers (safe to share)');
  console.log('- VAPID_SUBJECT should be a valid email or mailto URL');
  
} catch (error) {
  console.error('❌ Error generating VAPID keys:', error.message);
  process.exit(1);
}
