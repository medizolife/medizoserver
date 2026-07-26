const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: false // Optional for Google OAuth users
  },
  googleId: {
    type: String,
    default: null,
    sparse: true // Allow null but enforce uniqueness when set
  },
  picture: {
    type: String,
    default: ''
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  role: {
    type: String,
    enum: ['doctor', 'patient'],
    required: true
  },
  // Doctor-specific fields
  specialization: {
    type: String,
    default: ''
  },
  licenseNumber: {
    type: String,
    default: ''
  },
  clinicAddress: {
    type: String,
    default: ''
  },
  experience: {
    type: String,
    default: ''
  },
  qualifications: {
    type: String,
    default: ''
  },
  // Doctor profile and clinic images
  profileImage: {
    type: String,
    default: ''
  },
  clinicLogo: {
    type: String,
    default: ''
  },
  signature: {
    type: String,
    default: ''
  },
  // Extended contact information for doctors
  clinicName: {
    type: String,
    default: ''
  },
  alternateEmail: {
    type: String,
    default: ''
  },
  secondaryPhone: {
    type: String,
    default: ''
  },
  fax: {
    type: String,
    default: ''
  },
  whatsapp: {
    type: String,
    default: ''
  },
  website: {
    type: String,
    default: ''
  },
  linkedin: {
    type: String,
    default: ''
  },
  twitter: {
    type: String,
    default: ''
  },
  facebook: {
    type: String,
    default: ''
  },
  instagram: {
    type: String,
    default: ''
  },
  // Doctor's linked patients (patients added via "Add Existing")
  linkedPatients: {
    type: [String], // Array of patient IDs
    default: []
  },
  // Patient-specific fields
  dateOfBirth: {
    type: String,
    default: ''
  },
  gender: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  contactNumber: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  bloodType: {
    type: String,
    default: ''
  },
  allergies: {
    type: mongoose.Schema.Types.Mixed,
    default: { environmental: [], food: [], drugs: [], other: [] }
  },
  diseaseHistory: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  chronicConditions: {
    type: [String],
    default: []
  },
  medicalHistory: {
    type: String,
    default: ''
  },
  emergencyContact: {
    name: { type: String, default: '' },
    relationship: { type: String, default: '' },
    phone: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// Hash password before saving
// Use async middleware without calling next() — return to allow Mongoose to await the promise
userSchema.pre('save', async function() {
  // Skip if no password or password not modified (Google OAuth users may not have password)
  if (!this.password || !this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
userSchema.methods.generateToken = function() {
  const jwtSecret = process.env.JWT_SECRET || 'healthcare_management_secret_key_2025';
  return jwt.sign(
    { id: this._id, role: this.role },
    jwtSecret,
    { expiresIn: '1d' }
  );
};

// Transform to JSON (remove password)
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  user.id = user._id.toString();
  delete user.password;
  delete user.__v;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
