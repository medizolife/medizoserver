const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { findUserById, updateUser, getUsers } = require('../models/user');
const { doctor } = require('../middleware/auth');
const Image = require('../models/ImageModel');

// Ensure uploads directory exists (fallback for when D1 is not available)
const uploadsDir = process.env.VERCEL 
  ? '/tmp/uploads/doctors' 
  : path.join(__dirname, '../uploads/doctors');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.log('Uploads dir notice:', e.message);
}

// Configure multer for memory storage (to process and store in D1)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB hard limit
});

/**
 * Compress image to reduce file size for D1 storage
 * Target: ~100KB or less while maintaining reasonable quality
 */
const compressImage = async (buffer, mimeType) => {
  try {
    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    
    // Resize if image is very large (max 800px on longest side for profile images)
    const maxDimension = 800;
    if (metadata.width > maxDimension || metadata.height > maxDimension) {
      sharpInstance = sharpInstance.resize(maxDimension, maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Convert to JPEG with quality reduction for smaller file size
    // (unless it's a PNG with transparency that we need to preserve)
    if (mimeType === 'image/png') {
      return await sharpInstance
        .png({ quality: 80, compressionLevel: 9 })
        .toBuffer();
    } else {
      return await sharpInstance
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
    }
  } catch (error) {
    console.error('Image compression error:', error);
    return buffer; // Return original if compression fails
  }
};

/**
 * @route   GET /api/doctors
 * @desc    Get all doctors
 * @access  Private (Doctor only)
 */
router.get('/', doctor, async (req, res) => {
  try {
    // Get all users (async)
    const users = await getUsers();
    
    // Filter doctors only
    const doctors = users
      .filter(user => user.role === 'doctor')
      .map(({ password, ...doctor }) => doctor);
    
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/doctors/profile
 * @desc    Get current doctor profile
 * @access  Private (Doctor only)
 */
router.get('/profile', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const doctorUser = await findUserById(doctorId);
    
    if (!doctorUser) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    // Remove password from response
    const { password, ...doctorData } = doctorUser;
    
    res.json(doctorData);
  } catch (error) {
    console.error('Get doctor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/doctors/profile
 * @desc    Update doctor profile
 * @access  Private (Doctor only)
 */
router.put('/profile', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;
    const { 
      firstName, 
      lastName, 
      specialization, 
      contactNumber,
      profileImage,
      clinicLogo,
      signature,
      stamp,
      clinicName,
      clinicAddress,
      clinicLatitude,
      clinicLongitude,
      clinicLocationAccuracy,
      clinicPlaceName,
      alternateEmail,
      secondaryPhone,
      fax,
      whatsapp,
      website,
      linkedin,
      twitter,
      facebook,
      instagram,
      licenseNumber,
      experience,
      qualifications
    } = req.body;
    
    // Update user with all fields
    const updatedDoctor = await updateUser(doctorId, {
      firstName,
      lastName,
      specialization,
      contactNumber,
      profileImage,
      clinicLogo,
      signature,
      stamp,
      clinicName,
      clinicAddress,
      clinicLatitude,
      clinicLongitude,
      clinicLocationAccuracy,
      clinicPlaceName,
      alternateEmail,
      secondaryPhone,
      fax,
      whatsapp,
      website,
      linkedin,
      twitter,
      facebook,
      instagram,
      licenseNumber,
      experience,
      qualifications
    });
    
    let finalDoctor = updatedDoctor;
    if (!finalDoctor) {
      finalDoctor = await findUserById(doctorId);
    }
    
    if (!finalDoctor) {
      return res.status(404).json({ message: 'Doctor profile not found' });
    }
    
    const { password, ...doctorData } = finalDoctor;
    res.json(doctorData);
  } catch (error) {
    console.error('Update doctor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/doctors/images/:filename
 * @desc    Serve image from D1 database
 * @access  Public
 */
router.get('/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Try D1 first
    const image = await Image.findOne({ filename });
    if (image) {
      res.set('Content-Type', image.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.send(image.data);
      return;
    }

    // Fallback to file system
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    
    return res.status(404).json({ message: 'Image not found' });
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Helper: Upload and save an image to D1
 */
async function saveImageToD1(doctorId, compressedBuffer, filename, originalName, mimeType, imageType, userField) {
  // Delete old image if exists
  try {
    const doctorUser = await findUserById(doctorId);
    if (doctorUser && doctorUser[userField]) {
      const oldFilename = doctorUser[userField].split('/').pop();
      if (oldFilename) {
        await Image.deleteByFilename(oldFilename);
      }
    }
  } catch (deleteError) {
    console.log('Notice: Old image delete attempt:', deleteError.message);
  }
  
  // Save to D1
  await Image.createImage({
    filename,
    originalName,
    mimeType,
    data: compressedBuffer,
    size: compressedBuffer.length,
    imageType,
    uploadedBy: doctorId
  });
  
  const imageUrl = `/api/doctors/images/${filename}`;
  await updateUser(doctorId, { [userField]: imageUrl });
  return imageUrl;
}

/**
 * @route   POST /api/doctors/upload-profile-image
 * @desc    Upload doctor profile image (max 20MB, compressed and stored in D1)
 * @access  Private (Doctor only)
 */
router.post('/upload-profile-image', doctor, async (req, res) => {
  try {
    // Handle multer upload
    await new Promise((resolve, reject) => {
      upload.single('profileImage')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            reject(new Error('File size must be less than 20MB'));
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const doctorId = req.user.id;
    
    // Compress the image
    const compressedBuffer = await compressImage(req.file.buffer, req.file.mimetype);
    const isJpeg = req.file.mimetype !== 'image/png';
    const extension = isJpeg ? '.jpg' : '.png';
    const filename = 'profileImage-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + extension;
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    
    try {
      const imageUrl = await saveImageToD1(doctorId, compressedBuffer, filename, req.file.originalname, mimeType, 'profileImage', 'profileImage');
      res.json({ url: imageUrl });
    } catch (d1Error) {
      console.log('D1 image save failed, falling back to filesystem:', d1Error.message);
      // Fallback: save to filesystem
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, compressedBuffer);
      const imageUrl = `/uploads/doctors/${filename}`;
      await updateUser(doctorId, { profileImage: imageUrl });
      res.json({ url: imageUrl });
    }
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

/**
 * @route   POST /api/doctors/upload-clinic-logo
 * @desc    Upload clinic logo (max 20MB, compressed and stored in D1)
 * @access  Private (Doctor only)
 */
router.post('/upload-clinic-logo', doctor, async (req, res) => {
  try {
    // Handle multer upload
    await new Promise((resolve, reject) => {
      upload.single('clinicLogo')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            reject(new Error('File size must be less than 20MB'));
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const doctorId = req.user.id;
    
    // Compress the image (keep PNG for logos to preserve transparency)
    const compressedBuffer = await compressImage(req.file.buffer, 'image/png');
    const filename = 'clinicLogo-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '.png';
    
    try {
      const imageUrl = await saveImageToD1(doctorId, compressedBuffer, filename, req.file.originalname, 'image/png', 'clinicLogo', 'clinicLogo');
      res.json({ url: imageUrl });
    } catch (d1Error) {
      console.log('D1 image save failed, falling back to filesystem:', d1Error.message);
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, compressedBuffer);
      const imageUrl = `/uploads/doctors/${filename}`;
      await updateUser(doctorId, { clinicLogo: imageUrl });
      res.json({ url: imageUrl });
    }
  } catch (error) {
    console.error('Upload clinic logo error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

/**
 * @route   POST /api/doctors/upload-signature
 * @desc    Upload doctor signature (max 20MB, compressed, stored in D1)
 * @access  Private (Doctor only)
 */
router.post('/upload-signature', doctor, async (req, res) => {
  try {
    // Handle multer upload
    await new Promise((resolve, reject) => {
      upload.single('signature')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            reject(new Error('File size must be less than 20MB'));
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const doctorId = req.user.id;
    const filename = 'signature-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '.png';
    
    // Resize and compress the signature image
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .resize(400, null, { withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch (processError) {
      console.error('Error processing signature image:', processError);
      processedBuffer = await compressImage(req.file.buffer, 'image/png');
    }
    
    try {
      const signatureUrl = await saveImageToD1(doctorId, processedBuffer, filename, req.file.originalname, 'image/png', 'signature', 'signature');
      res.json({ url: signatureUrl });
    } catch (d1Error) {
      console.log('D1 image save failed, falling back to filesystem:', d1Error.message);
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, processedBuffer);
      const signatureUrl = `/uploads/doctors/${filename}`;
      await updateUser(doctorId, { signature: signatureUrl });
      res.json({ url: signatureUrl });
    }
  } catch (error) {
    console.error('Upload signature error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

/**
 * @route   POST /api/doctors/upload-stamp
 * @desc    Upload doctor stamp (max 20MB, compressed, stored in D1)
 * @access  Private (Doctor only)
 */
router.post('/upload-stamp', doctor, async (req, res) => {
  try {
    // Handle multer upload
    await new Promise((resolve, reject) => {
      upload.single('stamp')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            reject(new Error('File size must be less than 20MB'));
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const doctorId = req.user.id;
    const filename = 'stamp-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '.png';
    
    // Resize and compress the stamp image
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .resize(400, null, { withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch (processError) {
      console.error('Error processing stamp image:', processError);
      processedBuffer = await compressImage(req.file.buffer, 'image/png');
    }
    
    try {
      const stampUrl = await saveImageToD1(doctorId, processedBuffer, filename, req.file.originalname, 'image/png', 'stamp', 'stamp');
      res.json({ url: stampUrl });
    } catch (d1Error) {
      console.log('D1 image save failed, falling back to filesystem:', d1Error.message);
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, processedBuffer);
      const stampUrl = `/uploads/doctors/${filename}`;
      await updateUser(doctorId, { stamp: stampUrl });
      res.json({ url: stampUrl });
    }
  } catch (error) {
    console.error('Upload stamp error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

module.exports = router;
