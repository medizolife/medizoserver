// Test script to download PDF and check QR code functionality
const http = require('http');
const fs = require('fs');

// First login to get token
const loginData = JSON.stringify({
  email: 'patient@test.com',
  password: 'password'
});

const loginOptions = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

console.log('Logging in...');
const loginReq = http.request(loginOptions, (loginRes) => {
  let loginBody = '';
  
  loginRes.on('data', (chunk) => {
    loginBody += chunk;
  });
  
  loginRes.on('end', () => {
    try {
      const loginResponse = JSON.parse(loginBody);
      const token = loginResponse.token;
      console.log('Login successful, token obtained');
      
      // Now download PDF
      const pdfOptions = {
        hostname: 'localhost',
        port: 5000,
        path: '/api/prescriptions/test-rx-001/download',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      };
      
      console.log('Downloading PDF...');
      const pdfReq = http.request(pdfOptions, (pdfRes) => {
        const writeStream = fs.createWriteStream('test-prescription.pdf');
        pdfRes.pipe(writeStream);
        
        writeStream.on('finish', () => {
          console.log('PDF downloaded successfully as test-prescription.pdf');
          console.log('Check server logs for QR code debugging information');
        });
      });
      
      pdfReq.on('error', (err) => {
        console.error('PDF download error:', err);
      });
      
      pdfReq.end();
      
    } catch (error) {
      console.error('Login failed:', error);
    }
  });
});

loginReq.on('error', (err) => {
  console.error('Login request error:', err);
});

loginReq.write(loginData);
loginReq.end();
