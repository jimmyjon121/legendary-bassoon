const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

let attachmentsDir = null;

function getAttachmentsDir() {
  if (attachmentsDir) return attachmentsDir;
  const userData = app.getPath('userData');
  attachmentsDir = path.join(userData, 'attachments');
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }
  return attachmentsDir;
}

// Encrypt file content using AES-256-GCM
function encryptBuffer(buffer, password) {
  const algorithm = 'aes-256-gcm';
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Combine: salt (16) + iv (16) + authTag (16) + encrypted data
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

// Decrypt file content
function decryptBuffer(encryptedBuffer, password) {
  const algorithm = 'aes-256-gcm';
  const salt = encryptedBuffer.subarray(0, 16);
  const iv = encryptedBuffer.subarray(16, 32);
  const authTag = encryptedBuffer.subarray(32, 48);
  const encrypted = encryptedBuffer.subarray(48);
  
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

async function saveAttachmentForMessage(messageId, file, password = null) {
  if (!file || !file.originalPath) {
    throw new Error('Attachment must include originalPath');
  }

  const baseDir = getAttachmentsDir();
  const ext = path.extname(file.originalPath) || path.extname(file.name || '') || '.bin';
  const id = uuidv4();
  // Use .enc extension for encrypted files
  const filename = password ? `${id}${ext}.enc` : `${id}${ext}`;
  const destPath = path.join(baseDir, filename);

  if (password) {
    // Read, encrypt, then write
    const fileBuffer = await fsPromises.readFile(file.originalPath);
    const encryptedBuffer = encryptBuffer(fileBuffer, password);
    await fsPromises.writeFile(destPath, encryptedBuffer);
  } else {
    // Simple copy for non-encrypted
    await fsPromises.copyFile(file.originalPath, destPath);
  }

  return {
    id,
    message_id: messageId,
    type: file.type || 'file',
    file_path: destPath,
    mime_type: file.mimeType || null,
    original_name: file.name || path.basename(file.originalPath),
    size: typeof file.size === 'number' ? file.size : null,
    encrypted: !!password,
  };
}

// Read and decrypt an attachment
async function readAttachment(filePath, password = null) {
  const buffer = await fsPromises.readFile(filePath);
  
  if (password && filePath.endsWith('.enc')) {
    return decryptBuffer(buffer, password);
  }
  
  return buffer;
}

module.exports = {
  getAttachmentsDir,
  saveAttachmentForMessage,
  readAttachment,
  encryptBuffer,
  decryptBuffer,
};















