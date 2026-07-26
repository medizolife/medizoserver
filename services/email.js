const nodemailer = require('nodemailer');

/**
 * Create a nodemailer transport
 * @returns {Object} Nodemailer transport
 */
const createTransport = () => {
  // Check if email credentials are configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || 
      process.env.EMAIL_USER === 'your-email@gmail.com' || 
      process.env.EMAIL_PASS === 'your-email-password') {
    throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in .env file.');
  }
  
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

/**
 * Send an email
 * @param {Object} options - Email options
 * @returns {Promise} Promise with email info
 */
const sendEmail = async (options) => {
  const transporter = createTransport();
  
  const mailOptions = {
    from: `Healthcare Management System <${process.env.EMAIL_USER}>`,
    to: options.to,
    subject: options.subject,
    html: options.html
  };
  
  return await transporter.sendMail(mailOptions);
};

/**
 * Send a prescription notification email to a patient
 * @param {Object} patient - Patient data
 * @param {Object} prescription - Prescription data
 * @param {Object} doctor - Doctor data
 * @returns {Promise} Promise with email info
 */
const sendPrescriptionNotification = async (patient, prescription, doctor) => {
  const viewUrl = `${process.env.CLIENT_URL}/prescriptions/${prescription.id}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #3f51b5;">New Prescription Available</h2>
      <p>Hello ${patient.firstName},</p>
      <p>Dr. ${doctor.lastName} has created a new prescription for you.</p>
      <div style="margin: 20px 0; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
        <p><strong>Date:</strong> ${new Date(prescription.createdAt).toLocaleDateString()}</p>
        <p><strong>Medication:</strong> ${prescription.medication}</p>
        <p><strong>Dosage:</strong> ${prescription.dosage}</p>
      </div>
      <p>You can view and download your prescription by clicking the button below:</p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${viewUrl}" style="background-color: #3f51b5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">View Prescription</a>
      </div>
      <p>If you have any questions, please contact your doctor directly.</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 12px; color: #777;">This is an automated message from the Healthcare Management System. Please do not reply to this email.</p>
    </div>
  `;
  
  return await sendEmail({
    to: patient.email,
    subject: 'New Prescription Available',
    html
  });
};

module.exports = {
  sendEmail,
  sendPrescriptionNotification
};
