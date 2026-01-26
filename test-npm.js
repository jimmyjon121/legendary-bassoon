const { execSync } = require('child_process');
const fs = require('fs');

try {
  console.log('Testing npm...');
  const result = execSync('npm install systeminformation@5.21.0 --save', {
    cwd: 'C:\\Users\\molin\\Downloads\\devforge',
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('Output:', result);
  fs.writeFileSync('npm-output.txt', result || 'empty');
} catch (error) {
  console.error('Error:', error.message);
  fs.writeFileSync('npm-output.txt', 'ERROR: ' + error.message + '\n' + (error.stdout || '') + '\n' + (error.stderr || ''));
}


