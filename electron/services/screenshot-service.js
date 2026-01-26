const { desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { v4: uuidv4 } = require('uuid');
const { getAttachmentsDir } = require('./image-storage');

/**
 * Capture a screenshot of the primary display and save it
 * into the attachments directory. Returns the saved file path.
 */
async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      return { success: false, error: 'No screen sources available for capture' };
    }

    // Use the first screen as "primary" for now
    const primary = sources[0];
    const image = primary.thumbnail;

    if (!image || image.isEmpty()) {
      return { success: false, error: 'Failed to capture screenshot thumbnail' };
    }

    const buffer = image.toPNG();
    const dir = getAttachmentsDir();
    const id = uuidv4();
    const filePath = path.join(dir, `${id}-screenshot.png`);

    await fsPromises.writeFile(filePath, buffer);

    return {
      success: true,
      id,
      filePath,
      size: buffer.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Alias for backwards compatibility
const captureScreenshot = captureScreen;

module.exports = {
  captureScreen,
  captureScreenshot,
};

















