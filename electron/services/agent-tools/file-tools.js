const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
}

async function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak-${Date.now()}`;
  await fsPromises.copyFile(filePath, backupPath);
  return backupPath;
}

async function readFile(filePath) {
  const content = await fsPromises.readFile(filePath, 'utf-8');
  return { content };
}

async function writeFile(filePath, content) {
  await ensureDir(filePath);
  const backupPath = await backupFile(filePath);
  await fsPromises.writeFile(filePath, content, 'utf-8');
  return { backupPath };
}

async function editFile(filePath, oldText, newText) {
  const original = await fsPromises.readFile(filePath, 'utf-8');
  if (!original.includes(oldText)) {
    return { replaced: false, message: 'oldText not found' };
  }
  const updated = original.replace(oldText, newText);
  const backupPath = await backupFile(filePath);
  await fsPromises.writeFile(filePath, updated, 'utf-8');
  return { replaced: true, backupPath };
}

module.exports = {
  readFile,
  writeFile,
  editFile,
};




