const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function generateUsers() {
  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('password123', salt);
  
  const users = [
    {
      "id": "1",
      "firstName": "Dr. John",
      "lastName": "Smith",
      "email": "doctor@test.com",
      "password": hashedPassword,
      "role": "doctor",
      "specialization": "General Physician",
      "licenseNumber": "DOC123456",
      "createdAt": new Date().toISOString()
    },
    {
      "id": "2",
      "firstName": "Sarah",
      "lastName": "Johnson",
      "email": "patient@test.com",
      "password": hashedPassword,
      "role": "patient",
      "dateOfBirth": "1990-05-15",
      "gender": "female",
      "phone": "555-0123",
      "address": "123 Main St, City",
      "bloodType": "O+",
      "allergies": ["Penicillin"],
      "chronicConditions": [],
      "emergencyContact": {
        "name": "Mike Johnson",
        "relationship": "Husband",
        "phone": "555-0124"
      },
      "createdAt": new Date().toISOString()
    }
  ];
  
  // Save to users.json
  const usersFilePath = path.join(__dirname, 'data', 'users.json');
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  
  console.log('Demo users created successfully!');
  console.log('\nLogin Credentials:');
  console.log('=====================================');
  console.log('\nDoctor Account:');
  console.log('Email: doctor@test.com');
  console.log('Password: password123');
  console.log('\nPatient Account:');
  console.log('Email: patient@test.com');
  console.log('Password: password123');
  console.log('=====================================\n');
}

generateUsers().catch(console.error);
