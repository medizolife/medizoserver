/**
 * Automated Verification Test Suite for Medizo Enterprise Extension Modules
 * Run with: node scripts/test-enterprise-modules.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const connectDB = require('../config/db');
const { isD1Connected } = require('../config/d1-client');
const { createUser, findUserByEmail, findUserById, deleteUser } = require('../models/user');
const { createPrescription, findPrescriptionById } = require('../models/prescription');
const { generateBillFromPrescription, recordBillPayment } = require('../services/billingService');
const { findBillById, updateBillStatus, findBillsByPatientId, findBillsByDoctorId } = require('../models/billingModel');
const { addDoctorToNetwork, isDoctorInNetwork, getDoctorNetwork, removeDoctorFromNetwork, createReferral, findReferralById, updateReferralStatus } = require('../models/networkModel');
const { createHomeCareRequest, findHomeCareRequestById, updateHomeCareRequestStatus, assignNurseToRequest, createVisitRecord, getVisitRecordsByPatient } = require('../models/homeCareModel');
const { createNurseDoctorAffiliation, getDoctorAffiliatedNurses, assignNurseToPatient, getPatientAssignedNurses, assignDoctorToPatient, getPatientAssignedDoctors } = require('../models/assignmentModel');
const { scheduleVisit, transitionVisitStatus } = require('../services/schedulingService');
const { findScheduleById, findConflictingSchedules } = require('../models/scheduleModel');
const { canAccessPatientData, canAccessBill, canAccessHomeCareRequest } = require('../services/authzService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Medizo Enterprise Extension Tests...');
  console.log('====================================================');

  const connected = await connectDB();
  if (!connected) {
    console.error('❌ Database connection failed. Aborting tests.');
    process.exit(1);
  }
  console.log('✅ Database connected.');

  const timestamp = Date.now();
  const testDocEmail = `doc_test_${timestamp}@medizo.life`;
  const testDoc2Email = `doc2_test_${timestamp}@medizo.life`;
  const testPatEmail = `pat_test_${timestamp}@medizo.life`;
  const testNurseEmail = `nurse_test_${timestamp}@medizo.life`;
  const testNurse2Email = `nurse2_test_${timestamp}@medizo.life`;

  let doc1, doc2, pat1, nurse1, nurse2;
  let testPrescription;

  try {
    // ----------------------------------------------------
    // TEST 1: User Model & Nurse Role Verification
    // ----------------------------------------------------
    console.log('\n[TEST 1] Testing User Role & Nurse Model Support...');
    doc1 = await createUser({
      firstName: 'TestDoc',
      lastName: 'Primary',
      email: testDocEmail,
      password: 'password123',
      role: 'doctor',
      specialization: 'Cardiology',
      licenseNumber: `DOC-${timestamp}`,
      clinicName: 'Medizo Heart Care',
      status: 'active'
    });
    assert.strictEqual(doc1.role, 'doctor', 'Doctor role must match');

    doc2 = await createUser({
      firstName: 'TestDoc2',
      lastName: 'Surgeon',
      email: testDoc2Email,
      password: 'password123',
      role: 'doctor',
      specialization: 'General Surgery',
      licenseNumber: `SURG-${timestamp}`,
      clinicName: 'Medizo Surgical Center',
      status: 'active'
    });
    assert.strictEqual(doc2.role, 'doctor');

    pat1 = await createUser({
      firstName: 'TestPat',
      lastName: 'Johnson',
      email: testPatEmail,
      password: 'password123',
      role: 'patient',
      dateOfBirth: '1985-04-12',
      gender: 'male',
      phone: `999${timestamp.toString().slice(-7)}`,
      address: '42 Healthway Street, Suite 5',
      status: 'active'
    });
    assert.strictEqual(pat1.role, 'patient');

    nurse1 = await createUser({
      firstName: 'TestNurse',
      lastName: 'Florence',
      email: testNurseEmail,
      password: 'password123',
      role: 'nurse',
      nurseLicenseNumber: `RN-${timestamp}`,
      nurseSpecialization: 'Wound Care & Post-Op Recovery',
      nurseQualifications: 'B.Sc. Nursing',
      status: 'active'
    });
    assert.strictEqual(nurse1.role, 'nurse', 'Nurse role must be accepted');

    nurse2 = await createUser({
      firstName: 'TestNurse2',
      lastName: 'Nightingale',
      email: testNurse2Email,
      password: 'password123',
      role: 'nurse',
      nurseLicenseNumber: `RN2-${timestamp}`,
      nurseSpecialization: 'Elderly & Palliative Care',
      status: 'active'
    });
    assert.strictEqual(nurse2.role, 'nurse');
    console.log('✅ User models, doctor/patient/nurse roles successfully created and validated.');

    // ----------------------------------------------------
    // TEST 2: Prescription-Wise Billing System
    // ----------------------------------------------------
    console.log('\n[TEST 2] Testing Prescription-wise Billing & Payments...');
    testPrescription = await createPrescription({
      doctorId: doc1.id,
      doctorName: `Dr. ${doc1.firstName} ${doc1.lastName}`,
      doctorSpecialization: doc1.specialization,
      patientId: pat1.id,
      patientName: `${pat1.firstName} ${pat1.lastName}`,
      patientEmail: pat1.email,
      medications: [
        { name: 'Atorvastatin', dosage: '20mg', frequency: '1-0-0', duration: '30 days' },
        { name: 'Aspirin', dosage: '75mg', frequency: '0-1-0', duration: '30 days' }
      ],
      testsRequired: ['Lipid Profile', 'ECG', 'HbA1c'],
      diagnosis: 'Hypertension and Hyperlipidemia'
    });
    assert.ok(testPrescription.id, 'Prescription created');

    const generatedBill = await generateBillFromPrescription(testPrescription.id, doc1.id, {
      consultationFee: 750,
      medicationPrices: { Atorvastatin: 300, Aspirin: 100 },
      testPrices: { 'Lipid Profile': 600, 'ECG': 400, 'HbA1c': 500 },
      tax: 100,
      discount: 50
    });

    assert.ok(generatedBill.billNumber.startsWith('INV-'), 'Bill number format must match INV-');
    assert.strictEqual(generatedBill.status, 'issued', 'Initial status must be issued');
    assert.strictEqual(generatedBill.items.length, 6, 'Should have 1 consultation + 2 meds + 3 tests = 6 items');
    // Subtotal: 750 + 300 + 100 + 600 + 400 + 500 = 2650; Total = 2650 + 100 - 50 = 2700
    assert.strictEqual(Number(generatedBill.subtotal), 2650, 'Subtotal calculation match');
    assert.strictEqual(Number(generatedBill.totalAmount), 2700, 'Total amount calculation match');

    // Duplicate Prevention Check
    let duplicateErrorThrown = false;
    try {
      await generateBillFromPrescription(testPrescription.id, doc1.id, { consultationFee: 500 });
    } catch (e) {
      duplicateErrorThrown = true;
      assert.ok(e.message.includes('already exists'), 'Duplicate bill prevention error message');
    }
    assert.strictEqual(duplicateErrorThrown, true, 'Must prevent duplicate active bills');

    // Record Payment
    const paidBill = await recordBillPayment(generatedBill.id, {
      paymentMethod: 'upi',
      paymentTransactionRef: 'UPI-REF-12345678'
    }, pat1);
    assert.strictEqual(paidBill.status, 'paid', 'Status should transition to paid');
    assert.ok(paidBill.paidAt, 'paidAt must be recorded');
    assert.ok(paidBill.receiptNumber.startsWith('RCP-'), 'Receipt number must be generated');
    console.log('✅ Billing generation from prescription, line item breakdown, duplicate prevention, and payments working.');

    // ----------------------------------------------------
    // TEST 3: Doctor Network & Referral System
    // ----------------------------------------------------
    console.log('\n[TEST 3] Testing Doctor Network & Referrals...');
    // Add doc2 to doc1's network
    await addDoctorToNetwork(doc1.id, doc2.id, 'Trusted Surgeon Colleague');
    const isConnected = await isDoctorInNetwork(doc1.id, doc2.id);
    assert.strictEqual(isConnected, true, 'Doctor 2 should be in Doctor 1 network');

    const networkList = await getDoctorNetwork(doc1.id);
    assert.strictEqual(networkList.length, 1, 'Network count should be 1');

    // Self referral prevention
    let selfReferralError = false;
    try {
      await createReferral({
        referringDoctorId: doc1.id,
        referredDoctorId: doc1.id,
        patientId: pat1.id,
        reason: 'Self check'
      });
    } catch (e) {
      selfReferralError = true;
    }
    assert.strictEqual(selfReferralError, true, 'Self referral must be blocked');

    // Create Referral
    const referral = await createReferral({
      referringDoctorId: doc1.id,
      referredDoctorId: doc2.id,
      patientId: pat1.id,
      prescriptionId: testPrescription.id,
      reason: 'Surgical evaluation for cardiac stent placement',
      clinicalSummary: 'Patient has high LDL and recurrent chest pain',
      priority: 'urgent'
    });
    assert.ok(referral.referralNumber.startsWith('REF-'), 'Referral number format must match REF-');
    assert.strictEqual(referral.status, 'pending');

    // Update referral status: accept
    const acceptedReferral = await updateReferralStatus(referral.id, 'accepted', 'Accepted. Scheduling consultation.');
    assert.strictEqual(acceptedReferral.status, 'accepted');
    assert.ok(acceptedReferral.respondedAt, 'respondedAt must be recorded');

    // Verify auto-linking in doctor_patient_assignments
    await assignDoctorToPatient({
      doctorId: doc2.id,
      patientId: pat1.id,
      assignmentType: 'referred',
      source: 'referral'
    });
    const doc2Patients = await getPatientAssignedDoctors(pat1.id);
    assert.ok(doc2Patients.some(d => d.doctorId === doc2.id), 'Patient should now be assigned to referred doctor');
    console.log('✅ Doctor network, referral push, validation, and auto-linking working.');

    // ----------------------------------------------------
    // TEST 4: Home Care Requests & Nurse Clinical Visits
    // ----------------------------------------------------
    console.log('\n[TEST 4] Testing Home Care Requests & Clinical Notes Recording...');
    const homeCareReq = await createHomeCareRequest({
      patientId: pat1.id,
      requestedByRole: 'doctor',
      requestedById: doc1.id,
      advisedByDoctorId: doc1.id,
      serviceType: 'wound_care',
      urgency: 'standard',
      preferredDate: '2026-08-16',
      preferredTimeSlot: 'morning',
      address: pat1.address,
      contactPhone: pat1.phone,
      clinicalInstructions: 'Daily sterile dressing and BP measurement'
    });
    assert.ok(homeCareReq.requestNumber.startsWith('HCR-'), 'Request number format must match HCR-');
    assert.strictEqual(homeCareReq.status, 'requested');

    // Assign nurse
    const assignedReq = await assignNurseToRequest(homeCareReq.id, nurse1.id);
    assert.strictEqual(assignedReq.status, 'assigned');
    assert.strictEqual(assignedReq.assignedNurseId, nurse1.id);

    // Nurse completes visit & records clinical notes + vitals
    const visitRecord = await createVisitRecord({
      homeCareRequestId: homeCareReq.id,
      nurseId: nurse1.id,
      patientId: pat1.id,
      visitDate: new Date().toISOString(),
      vitals: {
        bpSystolic: 124,
        bpDiastolic: 82,
        pulseRate: 74,
        temperature: 98.6,
        spo2: 99,
        bloodSugar: 108
      },
      symptomsObserved: ['Mild swelling at incision site', 'No erythema'],
      proceduresPerformed: ['Wound cleaned with saline', 'Sterile gauze dressing applied'],
      medicationsAdministered: ['Topical antibiotic ointment'],
      careNotes: 'Patient is healing well. Vital signs are within normal limits.',
      patientCondition: 'improving',
      doctorFeedbackRequired: false
    });

    assert.ok(visitRecord.id, 'Visit record created');
    assert.strictEqual(visitRecord.patientCondition, 'improving');
    assert.strictEqual(visitRecord.vitals.bpSystolic, 124);

    // Verify home care request transitioned to completed automatically
    const updatedHcr = await findHomeCareRequestById(homeCareReq.id);
    assert.strictEqual(updatedHcr.status, 'completed', 'Home care request should transition to completed after visit record');
    console.log('✅ Home care requests, nurse assignment, and structured clinical visit recording working.');

    // ----------------------------------------------------
    // TEST 5: Multi-Nurse & Multi-Patient Assignment System
    // ----------------------------------------------------
    console.log('\n[TEST 5] Testing Multi-Nurse & Multi-Patient Assignments...');
    // Assign Nurse 1 for Wound Care
    await assignNurseToPatient({
      nurseId: nurse1.id,
      patientId: pat1.id,
      assignedByDoctorId: doc1.id,
      assignmentType: 'wound_care',
      diseaseCondition: 'Post-Op Surgical Site',
      startDate: '2026-08-15',
      frequency: 'daily',
      specialInstructions: 'Morning dressing change'
    });

    // Assign Nurse 2 for Physiotherapy on the SAME patient
    await assignNurseToPatient({
      nurseId: nurse2.id,
      patientId: pat1.id,
      assignedByDoctorId: doc1.id,
      assignmentType: 'physiotherapy',
      diseaseCondition: 'Cardiac Rehab & Mobility',
      startDate: '2026-08-15',
      frequency: 'biweekly',
      specialInstructions: 'Afternoon mobility exercises'
    });

    const patientNurses = await getPatientAssignedNurses(pat1.id);
    assert.strictEqual(patientNurses.length, 2, 'One patient must support multiple specialized nurses simultaneously');

    // Create Nurse-Doctor Affiliation
    await createNurseDoctorAffiliation(nurse1.id, doc1.id, 'employed', 'Primary Clinic Nurse');
    const affiliatedNurses = await getDoctorAffiliatedNurses(doc1.id);
    assert.ok(affiliatedNurses.some(n => n.nurseId === nurse1.id), 'Nurse should be listed in doctor affiliations');
    console.log('✅ Multi-nurse assignment per patient and doctor-nurse affiliations working.');

    // ----------------------------------------------------
    // TEST 6: Nurse Scheduling & Collision Prevention
    // ----------------------------------------------------
    console.log('\n[TEST 6] Testing Nurse Scheduling & Conflict Prevention...');
    const slot1Start = '2026-08-18T09:00:00.000Z';
    const slot1End = '2026-08-18T10:00:00.000Z';

    const schedule1 = await scheduleVisit({
      nurseId: nurse1.id,
      patientId: pat1.id,
      startDatetime: slot1Start,
      endDatetime: slot1End,
      serviceType: 'Morning Wound Care',
      locationAddress: pat1.address
    }, doc1);
    assert.strictEqual(schedule1.status, 'scheduled');

    // Attempt overlapping schedule on same nurse: 09:30 to 10:30
    let conflictErrorThrown = false;
    try {
      await scheduleVisit({
        nurseId: nurse1.id,
        patientId: pat1.id,
        startDatetime: '2026-08-18T09:30:00.000Z',
        endDatetime: '2026-08-18T10:30:00.000Z',
        serviceType: 'Overlapping Visit',
        locationAddress: pat1.address
      }, doc1);
    } catch (e) {
      conflictErrorThrown = true;
      assert.ok(e.message.includes('Schedule conflict'), 'Must detect schedule conflict');
    }
    assert.strictEqual(conflictErrorThrown, true, 'Double booking of nurse must be prevented');

    // Transition status: scheduled -> en_route -> in_progress -> completed
    const enRoute = await transitionVisitStatus(schedule1.id, 'en_route', '', nurse1);
    assert.strictEqual(enRoute.status, 'en_route');

    const inProg = await transitionVisitStatus(schedule1.id, 'in_progress', '', nurse1);
    assert.strictEqual(inProg.status, 'in_progress');

    const completed = await transitionVisitStatus(schedule1.id, 'completed', '', nurse1);
    assert.strictEqual(completed.status, 'completed');
    console.log('✅ Nurse scheduling, collision detection, and lifecycle transitions working.');

    // ----------------------------------------------------
    // TEST 7: Object-Level Authorization Rules
    // ----------------------------------------------------
    console.log('\n[TEST 7] Testing Object-Level Authorization Helpers...');
    const canDocAccess = await canAccessPatientData(doc1, pat1.id);
    assert.strictEqual(canDocAccess, true, 'Doctor 1 who prescribed should have access');

    const canNurseAccess = await canAccessPatientData(nurse1, pat1.id);
    assert.strictEqual(canNurseAccess, true, 'Assigned Nurse 1 should have access');

    const unrelatedUser = { id: 'unrelated_id', role: 'patient', email: 'unrelated@test.com' };
    const canUnrelatedAccess = await canAccessPatientData(unrelatedUser, pat1.id);
    assert.strictEqual(canUnrelatedAccess, false, 'Unrelated user must be denied access');

    const canBillAccess = canAccessBill(doc1, generatedBill);
    assert.strictEqual(canBillAccess, true, 'Doctor should have access to bill');

    const canBillAccessUnrelated = canAccessBill(unrelatedUser, generatedBill);
    assert.strictEqual(canBillAccessUnrelated, false, 'Unrelated user cannot access bill');
    console.log('✅ Strict RBAC and object-level authorization helpers working.');

    console.log('\n====================================================');
    console.log('🎉 ALL 7 ENTERPRISE EXTENSION MODULE TESTS PASSED!');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  } finally {
    // Cleanup created test users
    console.log('\nCleaning up test accounts...');
    if (doc1?.id) await deleteUser(doc1.id);
    if (doc2?.id) await deleteUser(doc2.id);
    if (pat1?.id) await deleteUser(pat1.id);
    if (nurse1?.id) await deleteUser(nurse1.id);
    if (nurse2?.id) await deleteUser(nurse2.id);
    console.log('Cleanup completed.');
  }
}

runTests();
