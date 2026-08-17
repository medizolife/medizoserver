// Comprehensive endpoint test for Medizo API with correct paths
const BASE_URL = 'https://medizoserver.medizolife.workers.dev';

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE ENDPOINT AUDIT ---');
  
  // 1. Health check
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    console.log(`[PASS] GET /health: status ${res.status}, storage: ${data.storage}`);
  } catch (e) {
    console.error(`[FAIL] GET /health: ${e.message}`);
  }

  // 2. Auth logins for roles
  const tokens = {};
  const accounts = [
    { role: 'admin', email: 'admin@medizo.life', password: 'password123' },
    { role: 'doctor', email: 'doctor@test.com', password: 'password123' },
    { role: 'patient', email: 'patient@test.com', password: 'password123' },
    { role: 'pharmacist', email: 'pharmacist@test.com', password: 'password123' },
    { role: 'nurse', email: 'nurse@test.com', password: 'password123' },
  ];

  for (const acc of accounts) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: acc.email, password: acc.password })
      });
      const data = await res.json();
      if (res.status === 200 && data.token) {
        tokens[acc.role] = data.token;
        console.log(`[PASS] POST /api/auth/login (${acc.role}): 200 OK`);
      } else {
        console.log(`[WARN] POST /api/auth/login (${acc.role}): ${res.status}`, data.message);
      }
    } catch (e) {
      console.error(`[FAIL] POST /api/auth/login (${acc.role}): ${e.message}`);
    }
  }

  const doctorToken = tokens['doctor'];
  const patientToken = tokens['patient'];
  const adminToken = tokens['admin'];
  const nurseToken = tokens['nurse'];
  const pharmToken = tokens['pharmacist'];

  // Test correct endpoints
  const endpoints = [
    // Users & Patients
    { name: 'GET /api/users/patients/my-patients', token: doctorToken, method: 'GET', url: '/api/users/patients/my-patients' },
    { name: 'GET /api/users/patients', token: doctorToken, method: 'GET', url: '/api/users/patients' },
    { name: 'GET /api/users/profile (doctor)', token: doctorToken, method: 'GET', url: '/api/users/profile' },
    { name: 'GET /api/users/profile (patient)', token: patientToken, method: 'GET', url: '/api/users/profile' },
    
    // Doctors
    { name: 'GET /api/doctors/profile', token: doctorToken, method: 'GET', url: '/api/doctors/profile' },
    
    // Prescriptions
    { name: 'GET /api/prescriptions (doctor)', token: doctorToken, method: 'GET', url: '/api/prescriptions' },
    { name: 'GET /api/prescriptions (patient)', token: patientToken, method: 'GET', url: '/api/prescriptions' },
    { name: 'GET /api/prescriptions (pharmacist)', token: pharmToken, method: 'GET', url: '/api/prescriptions' },
    
    // Family Profiles
    { name: 'GET /api/family-profiles (patient)', token: patientToken, method: 'GET', url: '/api/family-profiles' },
    
    // Billing
    { name: 'GET /api/billing/doctor', token: doctorToken, method: 'GET', url: '/api/billing/doctor' },
    { name: 'GET /api/billing/my-bills', token: patientToken, method: 'GET', url: '/api/billing/my-bills' },
    
    // Network
    { name: 'GET /api/network', token: doctorToken, method: 'GET', url: '/api/network' },
    
    // Referrals
    { name: 'GET /api/referrals/outgoing', token: doctorToken, method: 'GET', url: '/api/referrals/outgoing' },
    { name: 'GET /api/referrals/incoming', token: doctorToken, method: 'GET', url: '/api/referrals/incoming' },
    
    // Home Care
    { name: 'GET /api/home-care/requests (doctor)', token: doctorToken, method: 'GET', url: '/api/home-care/requests' },
    { name: 'GET /api/home-care/requests (nurse)', token: nurseToken, method: 'GET', url: '/api/home-care/requests' },
    { name: 'GET /api/home-care/requests (patient)', token: patientToken, method: 'GET', url: '/api/home-care/requests' },
    
    // Nurse Assignments
    { name: 'GET /api/nurse-assignments/my-patients', token: nurseToken, method: 'GET', url: '/api/nurse-assignments/my-patients' },
    
    // Nurse Schedules
    { name: 'GET /api/nurse-schedules/my-schedule', token: nurseToken, method: 'GET', url: '/api/nurse-schedules/my-schedule' },
  ];

  let passCount = 0;
  let failCount = 0;

  for (const ep of endpoints) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (ep.token) {
        headers['x-auth-token'] = ep.token;
      }
      const res = await fetch(`${BASE_URL}${ep.url}`, {
        method: ep.method,
        headers
      });
      const text = await res.text();

      if (res.status >= 200 && res.status < 300) {
        console.log(`[PASS] ${ep.name}: status ${res.status}`);
        passCount++;
      } else {
        console.log(`[FAIL] ${ep.name}: status ${res.status} - body: ${text.substring(0, 120)}`);
        failCount++;
      }
    } catch (e) {
      console.error(`[ERR] ${ep.name}: ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n--- AUDIT COMPLETE: ${passCount} PASSED, ${failCount} FAILED ---`);
}

runTests();
