/**
 * Comprehensive Prescription PDF Generator
 * Generates a professional multi-page prescription PDF matching the LaTeX template.
 * Content flows naturally — pages break only when space runs out.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const Image = require('../models/ImageModel');

/**
 * Load an image buffer from D1 by its API URL path.
 * e.g. "/api/doctors/images/clinicLogo-123.png" → looks up filename "clinicLogo-123.png"
 * Falls back to local file if D1 lookup fails.
 */
async function loadImageBuffer(urlPath) {
  if (!urlPath) return null;
  try {
    if (typeof urlPath === 'string' && urlPath.startsWith('data:image/')) {
      const base64Data = urlPath.split(',')[1];
      if (base64Data) return Buffer.from(base64Data, 'base64');
    }
    // Clean query parameters from urlPath if any, e.g. /api/doctors/images/stamp.png?v=123
    const cleanUrl = String(urlPath).split('?')[0];
    // Extract filename from API path like /api/doctors/images/<filename>
    const filename = cleanUrl.split('/').pop();
    if (!filename) return null;
    const imgDoc = await Image.findOne({ filename });
    if (imgDoc && imgDoc.data) return imgDoc.data;
  } catch (e) {
    console.error('D1 image lookup error:', e.message);
  }
  // Fallback: try local file
  const cleanUrl = String(urlPath).split('?')[0];
  const localPath = path.join(__dirname, '..', cleanUrl.replace(/^\//, ''));
  if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
  return null;
}

// ── colour palette ──
const C = {
  primary: '#006666',
  section: '#004D4D',
  lightBg: '#F0F0F0',
  warn: '#CC0000',
  text: '#333333',
  white: '#FFFFFF',
  hdrBg: '#ffffff',
  tblHdr: '#D9EDED',
  border: '#BBBBBB',
};

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - 2 * M;
const FOOTER_ZONE = 92;          // space reserved at page bottom for footer
const maxY = PH - FOOTER_ZONE;

// ====================================================================
//  Main export
// ====================================================================
async function generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctor) {
  const doc = new PDFDocument({ margin: M, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  const isDownload = res.req?.query?.download === 'true';
  const dispositionType = isDownload ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${dispositionType}; filename="prescription-${prescriptionId}.pdf"`);
  doc.pipe(res);

  let y = M;
  let pg = 1;

  // ── data normalisation ──────────────────────────────────────────
  const complaints     = prescription.presentingComplaints || [];
  const findings       = prescription.clinicalFindings || [];
  let provDiag         = prescription.provisionalDiagnosis || [];
  if (!provDiag.length && prescription.diagnosis) provDiag = [prescription.diagnosis];
  const curMeds        = prescription.currentMedications || [];
  const surgHist       = prescription.pastSurgicalHistory || [];
  const meds           = prescription.medications || [];
  const medNotes       = prescription.medicationNotes || [];

  let invList = [];
  if (prescription.investigations) {
    if (typeof prescription.investigations === 'string') {
      invList = prescription.investigations.split(',').map(s => ({ testName: s.trim() })).filter(i => i.testName);
    } else if (Array.isArray(prescription.investigations)) {
      invList = prescription.investigations.map(i => (typeof i === 'string' ? { testName: i } : i));
    }
  }
  if (prescription.testsRequired && prescription.testsRequired.length > 0) {
    prescription.testsRequired.forEach(t => {
      if (!invList.find(i => i.testName === t)) invList.push({ testName: t });
    });
  }
  const invNotes       = prescription.investigationNotes || '';
  const dietMods       = prescription.dietModifications || [];
  const lifestyleChg   = prescription.lifestyleChanges || [];
  const warnSigns      = prescription.warningSigns || [];
  const fuInfo         = prescription.followUpInfo || {};
  const fuDate         = fuInfo.appointmentDate || prescription.followUpDate || '';
  const fuTime         = fuInfo.appointmentTime || '';
  const fuPurpose      = fuInfo.purpose || '';
  const fuBring        = fuInfo.bringItems || [];
  const emergLine      = prescription.emergencyHelpline || '';
  const addNotes       = prescription.notes || '';
  const specialInstr   = prescription.instructions || '';
  const vs             = prescription.vitalSigns || {};

  // patient helpers
  let allergyList = [];
  if (patient.allergies) {
    const a = patient.allergies;
    if (typeof a === 'object' && !Array.isArray(a)) {
      Object.values(a).forEach(arr => { if (Array.isArray(arr)) allergyList = allergyList.concat(arr); });
    } else if (Array.isArray(a)) allergyList = a;
    else if (typeof a === 'string') allergyList = a.split(',').map(s => s.trim()).filter(Boolean);
  }

  const pName      = `${patient.firstName || ''} ${patient.middleName || ''} ${patient.lastName || ''}`.replace(/\s+/g, ' ').trim() || 'Patient';
  let pAge = '';
  if (patient.dateOfBirth) {
    const dobTime = new Date(patient.dateOfBirth).getTime();
    if (!isNaN(dobTime)) {
      const years = Math.floor((Date.now() - dobTime) / (365.25 * 86400000));
      if (years >= 0 && years < 150) pAge = `${years} Years`;
    }
  }
  const pGender    = patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : '';
  const pAgeGender = [pAge, pGender].filter(Boolean).join(' / ');
  const pId        = prescription.patientDisplayId || (patient.id ? `PT-${String(patient.id).slice(-6)}` : '');
  const pPhone     = patient.contactNumber || patient.phone || '';
  const pEmail     = patient.email || '';
  const pAddr      = patient.address || '';
  const pWeight    = patient.weight ? `${patient.weight} kg` : '';
  const pHeight    = patient.height ? `${patient.height} cm` : '';
  const pBlood     = patient.bloodType || '';
  const pEmergency = patient.emergencyContact || '';

  const prescDate = prescription.createdAt && !isNaN(new Date(prescription.createdAt).getTime()) ? new Date(prescription.createdAt) : new Date();
  const fDate     = prescDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const fTime     = prescDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const rxId      = `RX-${prescDate.getFullYear()}-${String(prescDate.getMonth() + 1).padStart(2, '0')}-${String(prescDate.getDate()).padStart(2, '0')}-${String(prescriptionId || '00000').slice(-5).padStart(5, '0')}`;

  // ── low-level helpers ───────────────────────────────────────────

  /** Safely convert any value to a printable string (prevents [object Object]) */
  const safeStr = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(safeStr).filter(Boolean).join(', ');
    if (typeof val === 'object') {
      if (val.label) return String(val.label);
      if (val.value) return String(val.value);
      if (val.text)  return String(val.text);
      if (val.name)  return String(val.name);
      const entries = Object.entries(val).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    return String(val);
  };

  const addFooter = () => {
    const fY = PH - FOOTER_ZONE + 6;
    doc.moveTo(M, fY).lineTo(PW - M, fY).strokeColor('#AAAAAA').lineWidth(0.5).stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
      .text('This is a digitally generated prescription by www.medizo.life', M, fY + 5, { width: CW, align: 'center' });
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
      .text('For verification, scan the QR code to get the Prescription ID', M, fY + 18, { width: CW, align: 'center' });
    if (emergLine) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
        .text(`24x7 Emergency Helpline: ${emergLine}`, M, fY + 31, { width: CW, align: 'center' });
    }
  };

  const newPage = () => { addFooter(); doc.addPage(); pg++; y = M; };

  /** Ensure `needed` vertical pixels are available, break page if not */
  const ensureSpace = (needed = 60) => { if (y + needed > maxY && y > M + 5) newPage(); };

  /** Section title bar (dark background, white text) */
  const titleBar = (title) => {
    ensureSpace(30);
    doc.rect(M, y, CW, 20).fill(C.section);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
      .text(title, M + 8, y + 5, { width: CW - 16, lineBreak: false });
    y += 24;
  };

  /** Bold label + value pair at (x, atY) */
  const bv = (label, val, x, atY) => {
    if (!val) return;
    const s = safeStr(val);
    if (!s) return;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text);
    const lw = doc.widthOfString(label + ' ');
    doc.text(label + ' ', x, atY, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(C.text)
      .text(s, x + lw, atY, { lineBreak: false });
  };

  /** Bullet point */
  const bullet = (text, indent = M + 15, color = C.text) => {
    ensureSpace(16);
    const s = safeStr(text);
    doc.font('Helvetica').fontSize(9.5).fillColor(color);
    const h = doc.heightOfString(`\u2022 ${s}`, { width: PW - M - indent - 5 });
    doc.text(`\u2022 ${s}`, indent, y, { width: PW - M - indent - 5 });
    y += Math.max(13, h + 1);
  };

  /** Warning bullet (red with triangle) */
  const warnBullet = (text, indent = M + 15) => {
    ensureSpace(16);
    const s = safeStr(text);
    doc.font('Helvetica').fontSize(9.5).fillColor(C.warn);
    const h = doc.heightOfString(`\u25B3 ${s}`, { width: PW - M - indent - 5 });
    doc.text(`\u25B3 ${s}`, indent, y, { width: PW - M - indent - 5 });
    y += Math.max(13, h + 1);
  };

  /** Sub-header */
  const subHdr = (text, indent = M + 10, color = C.text) => {
    ensureSpace(18);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(color)
      .text(text, indent, y, { width: PW - M - indent });
    y += 14;
  };

  // ================================================================
  //                       CONTENT SECTIONS
  //  Everything flows top-to-bottom; pages break only when needed.
  // ================================================================

  // ─── HEADER BOX ────────────────────────────────────────────────
  const hdrH = 80;
  doc.roundedRect(M, y, CW, hdrH, 4).fillAndStroke(C.hdrBg, C.primary);
  doc.lineWidth(1.5);

  const docFirstName = (doctor.firstName || prescription.doctorName?.split(' ')[0] || '').trim();
  const docLastName = (doctor.lastName || prescription.doctorName?.split(' ').slice(1).join(' ') || '').trim();
  let doctorDisplayName = `${docFirstName} ${docLastName}`.trim() || prescription.doctorName || 'Attending Physician';
  if (!doctorDisplayName.match(/^dr\.?\s+/i)) {
    doctorDisplayName = `Dr. ${doctorDisplayName}`;
  }

  const docSpecialization = doctor.specialization || doctor.doctorSpecialization || prescription.doctorSpecialization || prescription.specialization || 'General Physician';
  const docRegNo = doctor.registrationNumber || doctor.licenseNumber || doctor.doctorLicenseNumber || prescription.doctorRegistrationNumber || prescription.doctorLicenseNumber || prescription.registrationNumber || '';
  const drPhone = doctor.contactNumber || doctor.phone || doctor.doctorPhone || prescription.doctorPhone || prescription.contactNumber || '';
  const docAddress = doctor.address || doctor.clinicAddress || prescription.doctorAddress || prescription.clinicAddress || '';

  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.primary)
    .text(doctorDisplayName, M + 10, y + 8, { width: CW * 0.55 });

  let hY = y + 26;
  if (docSpecialization) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(C.text)
      .text(docSpecialization, M + 10, hY, { width: CW * 0.55 });
    hY += 13;
  }
  if (docRegNo) {
    doc.font('Helvetica').fontSize(9).fillColor(C.text)
      .text(`Reg. No: ${docRegNo}`, M + 10, hY);
    hY += 12;
  }
  if (drPhone) {
    doc.font('Helvetica').fontSize(9).fillColor(C.text)
      .text(`Phone: ${drPhone}`, M + 10, hY, { width: CW * 0.6 });
    hY += 12;
  }
  if (docAddress) {
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
      .text(`Address: ${docAddress}`, M + 10, hY, { width: CW * 0.6 });
  }

  // Right side – clinic logo (or clinic name fallback)
  const clinicLogoBuf = await loadImageBuffer(doctor.clinicLogo);

  if (clinicLogoBuf) {
    try {
      // Fit the logo into the right portion of the header box
      const logoMaxW = 120, logoMaxH = 65;
      const logoX = PW - M - logoMaxW - 8;
      const logoY = y + 6;
      doc.image(clinicLogoBuf, logoX, logoY, {
        fit: [logoMaxW, logoMaxH],
        align: 'center',
        valign: 'center'
      });
    } catch (logoErr) {
      console.error('Clinic logo render error:', logoErr);
      // fallback to clinic name text
      const clinicName = doctor.clinicName || '';
      if (clinicName) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(C.primary)
          .text(clinicName, M, y + 20, { width: CW - 10, align: 'right' });
      }
    }
  } else {
    // No logo uploaded – show clinic name if available
    const clinicName = doctor.clinicName || '';
    if (clinicName) {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(C.primary)
        .text(clinicName, M, y + 20, { width: CW - 10, align: 'right' });
    }
  }

  y += hdrH + 8;

  // ─── PRESCRIPTION ID + QR ──────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
    .text('Prescription ID:', M, y, { continued: true });
  doc.font('Courier').text(`  ${rxId}`);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
    .text('Date & Time:', M, y + 15, { continued: true });
  doc.font('Helvetica').text(`      ${fDate}, ${fTime}`);

  // QR code – rendered to the right of the prescription ID / date lines
  const qrSize = 80;  // PDF points (~150% of original)
  let qrRendered = false;
  try {
    const qrPayload = prescriptionId;  // Encode only the MongoDB _id for verification
    const qrUrl = await QRCode.toDataURL(qrPayload, {
      width: 400,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'M'
    });
    const qrBuf = Buffer.from(qrUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    doc.image(qrBuf, PW - M - qrSize - 5, y - 5, { width: qrSize, height: qrSize });
    qrRendered = true;
  } catch (e) { console.error('QR generation error:', e); }

  // Advance y past whichever is taller: the two text lines (30px) or the QR code
  y += qrRendered ? (qrSize + 8) : 35;

  // ─── PATIENT INFORMATION ───────────────────────────────────────
  {
    // Pre-calculate the box height so we can draw bg FIRST, then text on top
    const L1 = M + 10, L2 = M + CW * 0.55;
    let rows = 2; // Name + Age/Gender always shown
    if (pWeight || pHeight) rows++;
    if (pAddr) rows++;
    if (pPhone) rows++;
    if (pEmergency) rows++;
    const bodyH = rows * 15 + 8;
    const boxH = 20 + bodyH; // title bar + body

    ensureSpace(boxH + 10);
    const startY = y;

    // 1. Background fill for the body area
    doc.rect(M, startY + 20, CW, bodyH).fill(C.lightBg);
    // 2. Title bar
    doc.rect(M, startY, CW, 20).fill(C.section);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
      .text('PATIENT INFORMATION', M + 8, startY + 5);
    // 3. Border around the whole box
    doc.rect(M, startY, CW, boxH).strokeColor(C.section).lineWidth(1.5).stroke();

    // 4. Now draw text ON TOP of the background
    y = startY + 24;
    bv('Name:', pName, L1, y);          bv('Patient ID:', pId, L2, y);          y += 15;
    bv('Age/Gender:', pAgeGender, L1, y); if (pBlood) bv('Blood Type:', pBlood, L2, y); y += 15;
    if (pWeight || pHeight) { if (pWeight) bv('Weight:', pWeight, L1, y); if (pHeight) bv('Height:', pHeight, L2, y); y += 15; }
    if (pAddr) { bv('Address:', pAddr, L1, y); y += 15; }
    if (pPhone) { bv('Contact:', pPhone, L1, y); y += 15; }
    if (pEmergency) { bv('Emergency Contact:', pEmergency, L1, y); y += 15; }

    y = startY + boxH + 8;
  }

  // ─── VITAL SIGNS ───────────────────────────────────────────────
  const hasVitals = vs.bloodPressure || vs.pulse || vs.temperature || vs.spo2 || vs.respiratoryRate || vs.bmi || vs.painScale;
  if (hasVitals) {
    ensureSpace(65);
    const startY = y;
    doc.rect(M, y, CW, 20).fill(C.section);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
      .text('VITAL SIGNS (Recorded at consultation)', M + 8, y + 5);
    y += 25;

    const vW = CW / 4;
    const vx = [M + 10, M + 10 + vW, M + 10 + vW * 2, M + 10 + vW * 3];

    // Blood Pressure – split into systolic / diastolic with units
    if (vs.bloodPressure) {
      const bpParts = String(vs.bloodPressure).split('/');
      if (bpParts.length === 2) {
        bv('BP:', `${bpParts[0].trim()} mmHg (Systolic) / ${bpParts[1].trim()} mmHg (Diastolic)`, vx[0], y);
      } else {
        bv('BP:', `${vs.bloodPressure} mmHg`, vx[0], y);
      }
    }
    y += 15;

    // Remaining vitals with proper units
    if (vs.pulse) bv('Pulse:', `${vs.pulse} bpm`, vx[0], y);
    if (vs.temperature) bv('Temp:', `${vs.temperature} °F`, vx[1], y);
    if (vs.spo2) bv('SpO2:', `${vs.spo2} %`, vx[2], y);
    if (vs.respiratoryRate) bv('Resp. Rate:', `${vs.respiratoryRate} breaths/min`, vx[3], y);
    y += 15;
    if (vs.bmi) bv('BMI:', `${vs.bmi} kg/m²`, vx[0], y);
    if (vs.painScale) bv('Pain Scale:', `${vs.painScale} / 10`, vx[1], y);
    y += 12;

    doc.rect(M, startY, CW, y - startY + 3).strokeColor(C.section).lineWidth(1.5).stroke();
    y += 8;
  }

  // ─── MEDICAL HISTORY ───────────────────────────────────────────
  const hasHistory = allergyList.length > 0 || curMeds.length > 0 || surgHist.length > 0;
  if (hasHistory) {
    titleBar('MEDICAL HISTORY');
    if (allergyList.length) { subHdr('Known Allergies:', M + 10, C.warn); allergyList.forEach(a => warnBullet(a)); y += 2; }
    if (curMeds.length)     { subHdr('Current Medications:'); curMeds.forEach(m => bullet(m)); y += 2; }
    if (surgHist.length)    { subHdr('Past Surgical History:'); surgHist.forEach(s => bullet(s)); y += 2; }
    y += 6;
  }

  // ─── CHIEF COMPLAINTS & CLINICAL NOTES ─────────────────────────
  const hasClinical = complaints.length > 0 || findings.length > 0 || provDiag.length > 0;
  if (hasClinical) {
    titleBar('CHIEF COMPLAINTS & CLINICAL NOTES');
    if (complaints.length) { subHdr('Presenting Complaints:'); complaints.forEach(c => bullet(c)); y += 2; }
    if (findings.length)   { subHdr('Clinical Examination Findings:'); findings.forEach(f => bullet(f)); y += 2; }
    if (provDiag.length)   { subHdr('Provisional Diagnosis:'); provDiag.forEach(d => bullet(d)); y += 2; }
    y += 30;
  }

  // ─── Rx — PRESCRIBED MEDICATIONS ───────────────────────────────
  if (meds.length > 0) {
    // safeStr is defined at the top-level scope

    const col = {
      num:   { x: M + 1, w: 28 },
      name:  { x: M + 29, w: 140 },
      dos:   { x: M + 169, w: 95 },
      dur:   { x: M + 264, w: 90 },
      instr: { x: M + 354, w: CW - 356 },
    };

    /** Build combined instruction string for a medication */
    const buildInstrStr = (med) => {
      const parts = [];
      const t = safeStr(med.timing);
      const mr = safeStr(med.mealRelation);
      const ins = safeStr(med.instructions);
      if (t) parts.push(t);
      if (mr) parts.push(mr);
      if (ins) parts.push(ins);
      return parts.length > 0 ? parts.join(' | ') : '-';
    };

    /** Build dosage string for a medication */
    const buildDosStr = (med) => {
      let s = safeStr(med.dosage);
      if (med.frequency) {
        const freqMap = {'1': 'Once daily', '2': 'Twice daily', '3': 'Thrice daily', '4': 'Four times daily', 'SOS': 'As needed (SOS)'};
        const freqLabel = freqMap[safeStr(med.frequency)] || safeStr(med.frequency);
        s = s ? `${s}\n(${freqLabel})` : freqLabel;
      }
      return s || '-';
    };

    /** Build duration string for a medication */
    const buildDurStr = (med) => {
      let s = safeStr(med.duration);
      if (!s && (med.durationWeeks || med.durationDays)) {
        const p = [];
        if (med.durationWeeks) p.push(`${safeStr(med.durationWeeks)} Weeks`);
        if (med.durationDays)  p.push(`${safeStr(med.durationDays)} Days`);
        s = p.join(' ');
      }
      const qty = safeStr(med.quantity);
      if (qty) {
        s = s ? `${s}\n[Qty: ${qty}]` : `Qty: ${qty}`;
      }
      return s || '-';
    };

    // Pre-calculate total height for all medications to keep them together
    let medsTotalH = 30; // title bar height
    medsTotalH += 22; // table header
    meds.forEach((med) => {
      doc.font('Helvetica').fontSize(8.5);
      const instrStr = buildInstrStr(med);
      const instrH = doc.heightOfString(instrStr, { width: col.instr.w - 8 });
      const dosStr = buildDosStr(med);
      const dosH = doc.heightOfString(dosStr, { width: col.dos.w - 8 });
      const durStr = buildDurStr(med);
      const durH = doc.heightOfString(durStr, { width: col.dur.w - 8 });
      const nameStr = safeStr(med.name) + (med.type ? `\n(${safeStr(med.type)})` : '');
      doc.font('Helvetica-Bold').fontSize(9);
      const nameH = doc.heightOfString(nameStr, { width: col.name.w - 8 });
      const rowH = Math.max(30, instrH + 10, nameH + 10, dosH + 10, durH + 10);
      medsTotalH += rowH;
    });
    // Add space for medication notes if present
    if (medNotes.length > 0) {
      medsTotalH += 18; // subheader
      medNotes.forEach(note => {
        doc.font('Helvetica').fontSize(9.5);
        medsTotalH += Math.max(16, doc.heightOfString(`\u25B3 ${safeStr(note)}`, { width: PW - M - (M + 15) - 5 }) + 1);
      });
    }
    medsTotalH += 16; // padding

    // Ensure all medications fit on the same page
    ensureSpace(medsTotalH);

    titleBar('PRESCRIBED MEDICATIONS');

    // ── table header ──
    const thY = y;
    doc.rect(M + 1, y, CW - 2, 20).fill(C.tblHdr);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
    doc.text('No.',             col.num.x + 2,   y + 5, { width: col.num.w - 4,   align: 'center' });
    doc.text('Medicine Name',   col.name.x + 4,  y + 5, { width: col.name.w - 8 });
    doc.text('Dosage',          col.dos.x + 4,   y + 5, { width: col.dos.w - 8,   align: 'center' });
    doc.text('Duration / Qty',  col.dur.x + 4,   y + 5, { width: col.dur.w - 8,   align: 'center' });
    doc.text('Instructions',    col.instr.x + 4, y + 5, { width: col.instr.w - 8 });

    // header borders
    doc.strokeColor(C.text).lineWidth(0.5);
    doc.moveTo(M + 1, y).lineTo(PW - M - 1, y).stroke();
    doc.moveTo(M + 1, y + 20).lineTo(PW - M - 1, y + 20).stroke();
    [col.name.x, col.dos.x, col.dur.x, col.instr.x].forEach(cx => {
      doc.moveTo(cx, y).lineTo(cx, y + 20).stroke();
    });
    doc.moveTo(M + 1, y).lineTo(M + 1, y + 20).stroke();
    doc.moveTo(PW - M - 1, y).lineTo(PW - M - 1, y + 20).stroke();
    y += 22;

    // ── data rows ──
    meds.forEach((med, idx) => {
      // compute row height
      doc.font('Helvetica').fontSize(8.5);
      const instrStr = buildInstrStr(med);
      const instrH = doc.heightOfString(instrStr, { width: col.instr.w - 8 });
      const dosStr = buildDosStr(med);
      const dosH = doc.heightOfString(dosStr, { width: col.dos.w - 8 });
      const durStr = buildDurStr(med);
      const durH = doc.heightOfString(durStr, { width: col.dur.w - 8 });
      const nameStr = safeStr(med.name) + (med.type ? `\n(${safeStr(med.type)})` : '');
      doc.font('Helvetica-Bold').fontSize(9);
      const nameH = doc.heightOfString(nameStr, { width: col.name.w - 8 });
      const rowH = Math.max(30, instrH + 10, nameH + 10, dosH + 10, durH + 10);

      const rowY = y;

      // Alternate row background for readability
      if (idx % 2 === 0) {
        doc.rect(M + 1, rowY, CW - 2, rowH).fill('#F8FCFA');
      }

      // cell content — No.
      doc.font('Helvetica').fontSize(9).fillColor(C.text)
        .text(`${idx + 1}`, col.num.x + 2, rowY + 6, { width: col.num.w - 4, align: 'center' });

      // cell content — Medicine Name
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
        .text(safeStr(med.name) || '', col.name.x + 4, rowY + 6, { width: col.name.w - 8 });
      if (med.type) {
        const nh = doc.font('Helvetica-Bold').fontSize(9).heightOfString(safeStr(med.name) || '', { width: col.name.w - 8 });
        doc.font('Helvetica').fontSize(8).fillColor('#666666')
          .text(`(${safeStr(med.type)})`, col.name.x + 4, rowY + 6 + nh, { width: col.name.w - 8 });
      }

      // cell content — Dosage
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
        .text(dosStr, col.dos.x + 4, rowY + 6, { width: col.dos.w - 8, align: 'center' });

      // cell content — Duration / Qty
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
        .text(durStr, col.dur.x + 4, rowY + 6, { width: col.dur.w - 8, align: 'center' });

      // cell content — Instructions
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
        .text(instrStr, col.instr.x + 4, rowY + 6, { width: col.instr.w - 8 });

      // row borders
      doc.strokeColor(C.border).lineWidth(0.3);
      doc.moveTo(M + 1, rowY + rowH).lineTo(PW - M - 1, rowY + rowH).stroke();
      [M + 1, col.name.x, col.dos.x, col.dur.x, col.instr.x, PW - M - 1].forEach(cx => {
        doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
      });

      y = rowY + rowH;
    });

    y += 6;

    // medication notes
    if (medNotes.length > 0) {
      subHdr('Important Medication Notes:', M + 10, C.warn);
      medNotes.forEach(note => warnBullet(safeStr(note)));
      y += 4;
    }
    y += 6;
  }

  // ─── INVESTIGATIONS REQUIRED ───────────────────────────────────
  if (invList.length > 0) {
    // Pre-calculate total height for all investigations to keep them together
    let invTotalH = 30; // title bar height
    invList.forEach((inv) => {
      let invItemH = 16; // base height for test name
      if (inv.reason) {
        doc.font('Helvetica').fontSize(9);
        invItemH += doc.heightOfString(`   ${inv.reason}`, { width: CW - 40 }) + 2;
      }
      const details = [];
      if (inv.priority) details.push(`Priority: ${inv.priority}`);
      if (inv.fasting)  details.push(`Fasting required: ${inv.fasting}`);
      if (details.length) {
        invItemH += 15;
      }
      if (inv.specialInstructions) {
        doc.font('Helvetica-Oblique').fontSize(8.5);
        invItemH += doc.heightOfString(`Instructions: ${inv.specialInstructions}`, { width: CW - 40 }) + 2;
      }
      invItemH += 4; // spacing
      invTotalH += invItemH;
    });
    if (invNotes) {
      invTotalH += 20; // notes line
    }
    invTotalH += 10; // padding

    // Ensure all investigations fit on the same page
    ensureSpace(invTotalH);

    titleBar('INVESTIGATIONS REQUIRED');
    invList.forEach((inv, idx) => {
      const testName = safeStr(inv.testName) || safeStr(inv);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text);
      doc.text(`${idx + 1}. ${testName}`, M + 12, y, { width: CW - 30 });
      const reason = safeStr(inv.reason);
      if (reason) {
        doc.font('Helvetica').fontSize(9).fillColor(C.text)
          .text(`   ${reason}`, M + 22, y + 13, { width: CW - 40 });
        y += 13;
      }
      y += 14;
      const details = [];
      if (inv.priority) details.push(`Priority: ${safeStr(inv.priority)}`);
      if (inv.fasting)  details.push(`Fasting required: ${safeStr(inv.fasting)}`);
      if (details.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666')
          .text(details.join(' \u2014 '), M + 22, y, { width: CW - 40 });
        y += 13;
      }
      // Render special instructions if present
      const specInstr = safeStr(inv.specialInstructions);
      if (specInstr) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#555555')
          .text(`Instructions: ${specInstr}`, M + 22, y, { width: CW - 40 });
        const instrH = doc.heightOfString(`Instructions: ${specInstr}`, { width: CW - 40 });
        y += Math.max(12, instrH + 1);
      }
      y += 2;
    });
    if (invNotes) {
      const notesStr = safeStr(invNotes);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
        .text('Note: ', M + 10, y, { continued: true });
      doc.font('Helvetica').text(notesStr, { width: CW - 60 });
      y += 14;
    }
    y += 6;
  }

  // ─── DIETARY & LIFESTYLE ───────────────────────────────────────
  const hasDietLife = dietMods.length > 0 || lifestyleChg.length > 0 || warnSigns.length > 0;
  if (hasDietLife) {
    titleBar('DIETARY & LIFESTYLE RECOMMENDATIONS');
    if (dietMods.length)     { subHdr('Diet Modifications:'); dietMods.forEach(d => bullet(d)); y += 2; }
    if (lifestyleChg.length) { subHdr('Lifestyle Changes:'); lifestyleChg.forEach(l => bullet(l)); y += 2; }
    if (warnSigns.length) {
      subHdr('Warning Signs - Seek Immediate Medical Attention if:', M + 10, C.warn);
      warnSigns.forEach(w => warnBullet(w));
      y += 2;
    }
    y += 6;
  }

  // ─── STICKY FOOTER SECTIONS ─────────────────────────────────────
  // Keep Follow-up, Additional Notes, Prescribed by, and Stamp together on the same page
  const hasFollowUp = fuDate || fuPurpose || fuBring.length > 0;

  // Pre-calculate total height needed for all sticky sections
  let stickyTotalH = 0;

  // Follow-up box height
  let fuBoxH = 0;
  if (hasFollowUp) {
    let fuBodyLines = 0;
    if (fuDate) fuBodyLines++;
    if (fuPurpose) fuBodyLines++;
    if (fuBring.length) fuBodyLines += 1 + fuBring.length;
    if (drPhone) fuBodyLines++;
    const fuBodyH = fuBodyLines * 16 + 10;
    fuBoxH = 20 + fuBodyH;
    stickyTotalH += fuBoxH + 10;
  }

  // Special instructions height
  let specialInstrH = 0;
  if (specialInstr) {
    doc.font('Helvetica').fontSize(9.5);
    specialInstrH = doc.heightOfString(specialInstr, { width: CW - 130 }) + 10;
    stickyTotalH += specialInstrH + 8;
  }

  // Additional notes height
  let addNotesH = 0;
  if (addNotes) {
    doc.font('Helvetica').fontSize(9.5);
    addNotesH = doc.heightOfString(addNotes, { width: CW - 110 }) + 20;
    stickyTotalH += addNotesH + 8;
  }

  // Signature & stamp section height (accounts for signature/stamp image if present)
  const signatureBuf = await loadImageBuffer(doctor.signature);
  const stampBuf = await loadImageBuffer(doctor.stamp);
  const hasSignatureImg = !!signatureBuf;
  const hasStampImg = !!stampBuf;
  const sigStampH = hasSignatureImg ? (hasStampImg ? 155 : 130) : (hasStampImg ? 130 : 100);
  stickyTotalH += sigStampH;

  // Ensure all sticky sections fit on the same page
  ensureSpace(stickyTotalH + 20);

  // ─── FOLLOW-UP INFORMATION ─────────────────────────────────────
  if (hasFollowUp) {
    const fuStartY = y;

    // Calculate body height again for rendering
    let fuBodyLines = 0;
    if (fuDate) fuBodyLines++;
    if (fuPurpose) fuBodyLines++;
    if (fuBring.length) fuBodyLines += 1 + fuBring.length;
    if (drPhone) fuBodyLines++;
    const fuBodyH = fuBodyLines * 16 + 10;

    // 1. Background
    doc.rect(M, fuStartY + 20, CW, fuBodyH).fill(C.hdrBg);
    // 2. Title bar
    doc.rect(M, fuStartY, CW, 20).fill(C.section);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
      .text('FOLLOW-UP INFORMATION', M + 8, fuStartY + 5);
    // 3. Border
    doc.rect(M, fuStartY, CW, fuBoxH).strokeColor(C.section).lineWidth(1.5).stroke();

    // 4. Content on top
    y = fuStartY + 25;
    if (fuDate) {
      const fuDateFmt = new Date(fuDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      let appt = fuDateFmt;
      if (fuTime) appt += ` at ${fuTime}`;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
        .text('Next Appointment: ', M + 10, y, { continued: true });
      doc.font('Helvetica').fontSize(10).text(appt, { underline: true });
      y += 16;
    }
    if (fuPurpose) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
        .text('Purpose: ', M + 10, y, { continued: true });
      doc.font('Helvetica').text(fuPurpose);
      y += 16;
    }
    if (fuBring.length) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text).text('Bring to follow-up:', M + 10, y); y += 14;
      fuBring.forEach(b => { doc.font('Helvetica').fontSize(9.5).fillColor(C.text).text(`\u2022 ${b}`, M + 15, y); y += 13; });
      y += 2;
    }
    if (drPhone) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
        .text('For Appointments: ', M + 10, y, { continued: true });
      doc.font('Helvetica').text(`Call ${drPhone}`);
      y += 16;
    }

    y = fuStartY + fuBoxH + 8;
  }
  // ─── SPECIAL INSTRUCTIONS ──────────────────────────────────
  if (specialInstr) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
      .text('Special Instructions: ', M, y, { continued: true });
    doc.font('Helvetica').fontSize(9.5).text(specialInstr, { width: CW - 130 });
    const siH = doc.heightOfString(specialInstr, { width: CW - 130 });
    y += siH + 10;
  }
  // ─── ADDITIONAL NOTES ──────────────────────────────────────────
  if (addNotes) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
      .text('Additional Notes: ', M, y, { continued: true });
    doc.font('Helvetica').fontSize(9.5).text(addNotes, { width: CW - 110 });
    y += addNotesH + 8;
  }

  // ─── SIGNATURE & STAMP ─────────────────────────────────────────
  y += 10;
  const sigY = y;
  let siy = sigY + 54;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text).text('Prescribed by:', M, sigY);
  
  // Render signature (image or text fallback)
  if (signatureBuf) {
    try {
      const sigImgW = 150, sigImgH = 50;
      doc.image(signatureBuf, M, sigY + 14, {
        fit: [sigImgW, sigImgH],
        align: 'left',
        valign: 'center'
      });
      doc.moveTo(M, sigY + 68).lineTo(M + 170, sigY + 68).strokeColor(C.text).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
        .text(doctorDisplayName, M, sigY + 72);
      siy = sigY + 86;
      if (docSpecialization) {
        const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
        doc.font('Helvetica').fontSize(9).text(spec, M, siy); siy += 12;
      }
      if (docRegNo) { doc.font('Helvetica').fontSize(9).text(`Reg. No: ${docRegNo}`, M, siy); siy += 12; }
      doc.font('Helvetica').fontSize(9).text(`Date: ${fDate}`, M, siy);
    } catch (sigErr) {
      console.error('Signature render error:', sigErr);
      doc.moveTo(M, sigY + 28).lineTo(M + 170, sigY + 28).strokeColor(C.text).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
        .text(doctorDisplayName, M, sigY + 32);
      siy = sigY + 54;
      if (docSpecialization) {
        const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
        doc.font('Helvetica').fontSize(9).text(spec, M, siy); siy += 12;
      }
      if (docRegNo) { doc.font('Helvetica').fontSize(9).text(`Reg. No: ${docRegNo}`, M, siy); siy += 12; }
      doc.font('Helvetica').fontSize(9).text(`Date: ${fDate}`, M, siy);
    }
  } else {
    doc.moveTo(M, sigY + 28).lineTo(M + 170, sigY + 28).strokeColor(C.text).lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text)
      .text(doctorDisplayName, M, sigY + 32);
    siy = sigY + 54;
    if (docSpecialization) {
      const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
      doc.font('Helvetica').fontSize(9).text(spec, M, siy); siy += 12;
    }
    if (docRegNo) { doc.font('Helvetica').fontSize(9).text(`Reg. No: ${docRegNo}`, M, siy); siy += 12; }
    doc.font('Helvetica').fontSize(9).text(`Date: ${fDate}`, M, siy);
  }

  // Render Doctor's Stamp (only if doctor has uploaded a stamp image — no placeholder)
  const stampW = 140, stampH = 70;
  if (stampBuf) {
    const stampX = PW - M - 150;
    let stampDrawn = false;
    try {
      doc.rect(stampX, sigY + 5, stampW, stampH).strokeColor(C.primary).lineWidth(1).stroke();
      doc.image(stampBuf, stampX + 5, sigY + 10, {
        fit: [stampW - 10, stampH - 10],
        align: 'center',
        valign: 'center'
      });
      stampDrawn = true;
    } catch (stampErr) {
      console.error('Stamp render error:', stampErr);
    }
    y = stampDrawn ? Math.max(siy + 18, sigY + stampH + 20) : siy + 18;
  } else {
    // No stamp uploaded — skip stamp section entirely, clean layout
    y = siy + 18;
  }

  // page footer on last page
  addFooter();

  doc.end();
}

module.exports = { generatePrescriptionPDF };
