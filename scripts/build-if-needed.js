/**
 * Auto-build script for DevForge
 * 
 * This script checks if the app needs to be built and builds it if necessary.
 * It runs before `npm start` to ensure the app is always ready to run.
 * 
 * Build conditions:
 * 1. dist/ folder doesn't exist → build
 * 2. dist/ is older than src/ → build
 * 3. package.json changed → build
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const distIndexPath = path.join(distPath, 'index.html');
const srcPath = path.join(projectRoot, 'src');
const packageJsonPath = path.join(projectRoot, 'package.json');

console.log('🔍 Checking if build is needed...');

// Check if dist exists
if (!fs.existsSync(distIndexPath)) {
  console.log('📦 dist/ not found - building app...');
  runBuild();
  process.exit(0);
}

// Get the newest file modification time in src/
function getNewestMtime(dir, newest = 0) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and hidden dirs
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          newest = getNewestMtime(fullPath, newest);
        }
      } else {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > newest) {
          newest = stat.mtimeMs;
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return newest;
}

// Get dist build time
const distStat = fs.statSync(distIndexPath);
const distMtime = distStat.mtimeMs;

// Get newest source file time
const srcMtime = getNewestMtime(srcPath);

// Get package.json time
const packageStat = fs.statSync(packageJsonPath);
const packageMtime = packageStat.mtimeMs;

// Check if rebuild needed
const newestSource = Math.max(srcMtime, packageMtime);

if (newestSource > distMtime) {
  const ageMinutes = Math.round((newestSource - distMtime) / 60000);
  console.log(`📦 Source files are newer than build (${ageMinutes}min) - rebuilding...`);
  runBuild();
} else {
  console.log('✅ Build is up-to-date - launching app...');
}

function runBuild() {
  console.log('🔨 Running vite build...');
  try {
    execSync('npm run build:app', { 
      cwd: projectRoot, 
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('✅ Build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    console.log('');
    console.log('💡 Tip: You can still run in dev mode with: npm run dev');
    process.exit(1);
  }
}












