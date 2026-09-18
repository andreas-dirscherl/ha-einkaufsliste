#!/usr/bin/env node
/**
 * Version Bump Script
 * Versioning schema: YYYY.MM.PATCH (e.g., 2026.9.0)
 * 
 * Usage:
 *   npm run version:bump patch  - bumps patch version (2026.9.0 -> 2026.9.1)
 *   npm run version:bump minor  - bumps month (2026.9.0 -> 2026.10.0)
 *   npm run version:check       - shows current version
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, 'package.json');

function getPackageJson() {
  const content = fs.readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(content);
}

function savePackageJson(pkg) {
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

function parseVersion(versionString) {
  const parts = versionString.split('.');
  return {
    year: parseInt(parts[0]),
    month: parseInt(parts[1]),
    patch: parseInt(parts[2])
  };
}

function buildVersionString(year, month, patch) {
  return `${year}.${month}.${patch}`;
}

function getCurrentDate() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

function bumpVersion(type = 'patch') {
  const pkg = getPackageJson();
  const current = parseVersion(pkg.version);
  const today = getCurrentDate();

  let newVersion;

  if (type === 'patch') {
    // Bump patch, reset if date changed
    if (current.year === today.year && current.month === today.month) {
      current.patch++;
    } else {
      current.year = today.year;
      current.month = today.month;
      current.patch = 0;
    }
  } else if (type === 'minor') {
    // Bump month
    current.month++;
    if (current.month > 12) {
      current.month = 1;
      current.year++;
    }
    current.patch = 0;
  }

  newVersion = buildVersionString(current.year, current.month, current.patch);
  pkg.version = newVersion;
  
  savePackageJson(pkg);
  console.log(`[OK] Version bumped to: ${newVersion}`);
  
  return newVersion;
}

function checkVersion() {
  const pkg = getPackageJson();
  const current = parseVersion(pkg.version);
  const today = getCurrentDate();
  
  const isLatest = current.year === today.year && current.month === today.month;
  const status = isLatest ? '✅ Current' : '⚠️ Outdated (month/year mismatch)';
  
  console.log(`📦 Current version: ${pkg.version} ${status}`);
  console.log(`📅 Today: ${today.year}.${today.month}`);
}

const args = process.argv.slice(2);
const command = args[0] || 'check';

if (command === 'patch') {
  bumpVersion('patch');
} else if (command === 'minor') {
  bumpVersion('minor');
} else if (command === 'check') {
  checkVersion();
} else {
  console.log('Usage: node scripts/version-bump.js [patch|minor|check]');
  process.exit(1);
}
