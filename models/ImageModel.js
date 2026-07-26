const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  // Unique identifier for the image
  filename: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Original filename uploaded by user
  originalName: {
    type: String,
    required: true
  },
  // MIME type (image/png, image/jpeg, etc.)
  mimeType: {
    type: String,
    required: true
  },
  // Image binary data stored as Buffer
  data: {
    type: Buffer,
    required: true
  },
  // File size in bytes
  size: {
    type: Number,
    required: true
  },
  // Type of image (profileImage, clinicLogo, signature)
  imageType: {
    type: String,
    enum: ['profileImage', 'clinicLogo', 'signature', 'other'],
    default: 'other'
  },
  // Reference to the user who uploaded
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Create index for faster lookups
imageSchema.index({ uploadedBy: 1, imageType: 1 });

const Image = mongoose.model('Image', imageSchema);

module.exports = Image;
