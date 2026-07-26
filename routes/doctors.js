const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const mongoose = require('mongoose');
const { findUserById, updateUser, getUsers } = require('../models/user');
const { doctor } = require('../middleware/auth');
const Image = require('../models/ImageModel');

// Ensure uploads directory exists (fallback for when MongoDB is not available)
const uploadsDir = path.join(__dirname, '../uploads/doctors');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Check if MongoDB is connected
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Configure multer for memory storage (to process and store in MongoDB)
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
 * Compress image to reduce file size for MongoDB storage
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
    const doctor = await findUserById(doctorId);
    
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    // Remove password from response
    const { password, ...doctorData } = doctor;
    
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
      clinicName,
      clinicAddress,
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
      clinicName,
      clinicAddress,
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
    
    if (!updatedDoctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    res.json(updatedDoctor);
  } catch (error) {
    console.error('Update doctor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/doctors/images/:filename
 * @desc    Serve image from MongoDB
 * @access  Public
 */
router.get('/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!isMongoConnected()) {
      // Fallback to file system
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).json({ message: 'Image not found' });
    }
    
    const image = await Image.findOne({ filename });
    if (!image) {
      // Try filesystem fallback
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).json({ message: 'Image not found' });
    }
    
    res.set('Content-Type', image.mimeType);
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(image.data);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/doctors/upload-profile-image
 * @desc    Upload doctor profile image (max 20MB, compressed and stored in MongoDB)
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
    
    if (isMongoConnected()) {
      // Delete old image if exists
      const doctor = await findUserById(doctorId);
      if (doctor?.profileImage) {
        const oldFilename = doctor.profileImage.split('/').pop();
        await Image.deleteOne({ filename: oldFilename });
      }
      
      // Save to MongoDB
      const newImage = new Image({
        filename,
        originalName: req.file.originalname,
        mimeType: isJpeg ? 'image/jpeg' : 'image/png',
        data: compressedBuffer,
        size: compressedBuffer.length,
        imageType: 'profileImage',
        uploadedBy: doctorId
      });
      await newImage.save();
      
      const imageUrl = `/api/doctors/images/${filename}`;
      await updateUser(doctorId, { profileImage: imageUrl });
      res.json({ url: imageUrl });
    } else {
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
 * @desc    Upload clinic logo (max 20MB, compressed and stored in MongoDB)
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
    
    if (isMongoConnected()) {
      // Delete old image if exists
      const doctor = await findUserById(doctorId);
      if (doctor?.clinicLogo) {
        const oldFilename = doctor.clinicLogo.split('/').pop();
        await Image.deleteOne({ filename: oldFilename });
      }
      
      // Save to MongoDB
      const newImage = new Image({
        filename,
        originalName: req.file.originalname,
        mimeType: 'image/png',
        data: compressedBuffer,
        size: compressedBuffer.length,
        imageType: 'clinicLogo',
        uploadedBy: doctorId
      });
      await newImage.save();
      
      const imageUrl = `/api/doctors/images/${filename}`;
      await updateUser(doctorId, { clinicLogo: imageUrl });
      res.json({ url: imageUrl });
    } else {
      // Fallback: save to filesystem
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
 * @desc    Upload doctor signature (max 20MB, compressed, background removed, stored in MongoDB)
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
    
    if (isMongoConnected()) {
      // Delete old image if exists
      const doctor = await findUserById(doctorId);
      if (doctor?.signature) {
        const oldFilename = doctor.signature.split('/').pop();
        await Image.deleteOne({ filename: oldFilename });
      }
      
      // Save to MongoDB
      const newImage = new Image({
        filename,
        originalName: req.file.originalname,
        mimeType: 'image/png',
        data: processedBuffer,
        size: processedBuffer.length,
        imageType: 'signature',
        uploadedBy: doctorId
      });
      await newImage.save();
      
      const signatureUrl = `/api/doctors/images/${filename}`;
      await updateUser(doctorId, { signature: signatureUrl });
      res.json({ url: signatureUrl });
    } else {
      // Fallback: save to filesystem
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

module.exports = router;
