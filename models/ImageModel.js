/**
 * Image storage helper for Cloudflare D1
 * Replaces the Mongoose Image model.
 * Images are stored as base64-encoded text in the D1 'images' table.
 */
const { queryD1 } = require('../config/d1-client');

/**
 * Find an image by filename
 * @param {string} filename
 * @returns {Promise<Object|null>}
 */
async function findByFilename(filename) {
  try {
    const { results } = await queryD1(
      'SELECT * FROM images WHERE filename = ? LIMIT 1',
      [filename]
    );
    if (results.length === 0) return null;
    const img = results[0];
    // Convert base64 string back to Buffer for compatibility
    if (img.data && typeof img.data === 'string') {
      img.data = Buffer.from(img.data, 'base64');
    }
    return img;
  } catch (error) {
    console.error('D1 findByFilename error:', error);
    return null;
  }
}

/**
 * Create/save an image record
 * @param {Object} imageData - { filename, originalName, mimeType, data (Buffer), size, imageType, uploadedBy }
 * @returns {Promise<Object>}
 */
async function createImage(imageData) {
  try {
    const { filename, originalName, mimeType, data, size, imageType, uploadedBy } = imageData;
    // Convert Buffer to base64 string for D1 storage
    const base64Data = Buffer.isBuffer(data) ? data.toString('base64') : data;

    const sql = `INSERT INTO images (filename, originalName, mimeType, data, size, imageType, uploadedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`;
    const { results } = await queryD1(sql, [
      filename, originalName, mimeType, base64Data, size, imageType || 'other', uploadedBy
    ]);

    if (results.length === 0) throw new Error('Failed to save image');
    return results[0];
  } catch (error) {
    console.error('D1 createImage error:', error);
    throw error;
  }
}

/**
 * Find images by user and optional type
 * @param {string} uploadedBy - User ID
 * @param {string} [imageType] - Optional image type filter
 * @returns {Promise<Array>}
 */
async function findByUser(uploadedBy, imageType) {
  try {
    let sql = 'SELECT * FROM images WHERE uploadedBy = ?';
    const params = [uploadedBy];
    if (imageType) {
      sql += ' AND imageType = ?';
      params.push(imageType);
    }
    const { results } = await queryD1(sql, params);
    // Convert base64 to Buffer
    return results.map(img => {
      if (img.data && typeof img.data === 'string') {
        img.data = Buffer.from(img.data, 'base64');
      }
      return img;
    });
  } catch (error) {
    console.error('D1 findByUser error:', error);
    return [];
  }
}

/**
 * Delete an image by filename
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
async function deleteByFilename(filename) {
  try {
    const { meta } = await queryD1('DELETE FROM images WHERE filename = ?', [filename]);
    return (meta?.changes || 0) > 0;
  } catch (error) {
    console.error('D1 deleteByFilename error:', error);
    return false;
  }
}

/**
 * Find one image matching query (Mongoose-compatible shim)
 * Supports { filename }, { uploadedBy, imageType } patterns
 * @param {Object} query
 * @returns {Promise<Object|null>}
 */
async function findOne(query) {
  if (query.filename) {
    return findByFilename(query.filename);
  }
  if (query.uploadedBy) {
    const images = await findByUser(query.uploadedBy, query.imageType);
    return images.length > 0 ? images[0] : null;
  }
  return null;
}

/**
 * Save an image (Mongoose-compatible shim)
 * Accepts an object with .save() pattern
 */
function createSaveable(data) {
  const obj = { ...data };
  obj.save = async function() {
    const saved = await createImage(obj);
    Object.assign(obj, saved);
    return obj;
  };
  return obj;
}

// Export as a Mongoose-like model for backward compatibility with routes
module.exports = {
  findOne,
  findByFilename,
  findByUser,
  createImage,
  deleteByFilename,
  // Mongoose-compatible constructor pattern
  create: createImage,
  new: createSaveable
};
