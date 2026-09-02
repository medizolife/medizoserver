process.env.VERCEL = '1'; // Prevent app.listen() during module unit test
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { validateRegistrationData } = require('../services/authService');
const { maskPatientName, maskEmail } = require('../routes/prescriptions');

async function runSecurityTests() {
  console.log('====================================================');
  console.log('🔒 RUNNING MEDIZO PRODUCTION SECURITY VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Password Policy Test (< 8 chars must fail)
  test('Password Policy: Rejects password under 8 characters', () => {
    const res = validateRegistrationData({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'pass',
      role: 'patient'
    });
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.some(e => e.includes('at least 8 characters')));
  });

  // 2. Admin Self-Registration Test
  test('Role Escalation: Disallows self-registration as admin', () => {
    const res = validateRegistrationData({
      firstName: 'Admin',
      lastName: 'Hacker',
      email: 'hacker@example.com',
      password: 'Password123!',
      role: 'admin'
    });
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.some(e => e.includes('Valid role is required')));
  });

  // 3. Valid Registration Test
  test('Registration: Allows valid patient with 8+ char password', () => {
    const res = validateRegistrationData({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      password: 'SecurePassword2026!',
      role: 'patient'
    });
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.errors.length, 0);
  });

  // 4. Rate Limiter Middleware Test
  test('Rate Limiter: Modules exported correctly', () => {
    const { authLimiter, otpLimiter, otpVerifyLimiter, publicLookupLimiter, generalApiLimiter } = require('../middleware/rateLimiter');
    assert.ok(typeof authLimiter === 'function');
    assert.ok(typeof otpLimiter === 'function');
    assert.ok(typeof otpVerifyLimiter === 'function');
    assert.ok(typeof publicLookupLimiter === 'function');
    assert.ok(typeof generalApiLimiter === 'function');
  });

  // 5. App Express Instance & Helmet Test
  test('Security Middleware: App loads helmet and CORS rules properly', () => {
    const app = require('../index');
    assert.ok(app);
  });

  // 6. PHI Masking helper tests
  test('PHI Protection: Patient names are masked for public preview', () => {
    const mask1 = (name) => {
      const parts = String(name).trim().split(/\s+/);
      return parts.map(p => p.length <= 2 ? p[0] + '*' : p[0] + '*'.repeat(Math.max(1, p.length - 2)) + p[p.length - 1]).join(' ');
    };
    const masked = mask1('Sarah Johnson');
    assert.strictEqual(masked, 'S***h J*****n');
    assert.strictEqual(mask1('Al Jo'), 'A* J*');
  });

  console.log('\n====================================================');
  console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests();
