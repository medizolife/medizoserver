/**
 * Comprehensive Prescription PDF Generator
 * Generates a professional multi-page prescription PDF with publication-grade clinical design.
 * Content flows naturally — pages break only when space runs out, with zero empty ghost pages.
 */
if (typeof globalThis.__dirname === 'undefined') {
  globalThis.__dirname = '/';
}
const PDFDocument = require('pdfkit/js/pdfkit.standalone');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const Image = require('../models/ImageModel');

/**
 * Load an image buffer from D1 by its API URL path or Data URL.
 * e.g. "/api/doctors/images/clinicLogo-123.png" → looks up filename "clinicLogo-123.png"
 */
async function loadImageBuffer(urlPath) {
  if (!urlPath) return null;
  try {
    if (typeof urlPath === 'string' && urlPath.startsWith('data:image/')) {
      return urlPath; // pdfkit.standalone supports data URLs directly
    }
    const cleanUrl = String(urlPath).split('?')[0];
    const filename = cleanUrl.split('/').pop();
    if (!filename) return null;
    const imgDoc = await Image.findOne({ filename });
    if (imgDoc && imgDoc.data) {
      const buf = imgDoc.data;
      if (Buffer.isBuffer(buf)) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
      }
      return buf;
    }
  } catch (e) {
    console.error('D1 image lookup error:', e.message);
  }
  // Fallback: local file if filesystem is available
  try {
    const cleanUrl = String(urlPath).split('?')[0];
    const localPath = typeof __dirname !== 'undefined' ? path.join(__dirname, '..', cleanUrl.replace(/^\//, '')) : null;
    if (localPath && fs.existsSync && fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
  } catch (e) {}
  return null;
}

// ── Indian States List for Address Parsing ──
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi', 'New Delhi', 'Jammu and Kashmir', 'Ladakh',
  'Puducherry', 'Chandigarh', 'Andaman and Nicobar', 'Dadra and Nagar Haveli'
];

/**
 * Format address to display only City and State (e.g. "Patna, Bihar")
 */
function formatCityState(rawAddress, explicitCity, explicitState) {
  if (explicitCity && explicitState) {
    return `${explicitCity.trim()}, ${explicitState.trim()}`;
  }
  if (!rawAddress || typeof rawAddress !== 'string') {
    return explicitCity || explicitState || '';
  }

  const str = rawAddress.trim();
  if (!str) return '';

  // Clean out common country names, postal codes, and extra punctuation
  let cleaned = str
    .replace(/\b(India|United States|USA|UK|Canada)\b/gi, '')
    .replace(/\b\d{5,6}\b/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();

  let parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  let matchedState = '';
  let stateIndex = -1;

  for (let i = parts.length - 1; i >= 0; i--) {
    const partLower = parts[i].toLowerCase();
    const foundState = INDIAN_STATES.find(s => s.toLowerCase() === partLower || partLower.includes(s.toLowerCase()));
    if (foundState) {
      matchedState = foundState;
      stateIndex = i;
      break;
    }
  }

  if (!matchedState && explicitState) {
    matchedState = explicitState.trim();
  }

  let matchedCity = '';
  if (explicitCity) {
    matchedCity = explicitCity.trim();
  } else if (stateIndex > 0) {
    const seen = new Set();
    for (let i = stateIndex - 1; i >= 0; i--) {
      const p = parts[i].replace(/\b(Rural|Urban|District|Dist|City)\b/gi, '').trim() || parts[i];
      if (!matchedCity && p && !seen.has(p.toLowerCase())) {
        matchedCity = p;
        seen.add(p.toLowerCase());
      }
    }
  } else {
    if (parts.length >= 2) {
      matchedCity = parts[parts.length - 2];
      matchedState = parts[parts.length - 1];
    } else {
      matchedCity = parts[0];
    }
  }

  if (matchedCity && matchedState) {
    if (matchedCity.toLowerCase() === matchedState.toLowerCase()) {
      return matchedState;
    }
    return `${matchedCity}, ${matchedState}`;
  }
  return matchedCity || matchedState || parts.join(', ');
}

// ── colour palette ──
const C = {
  primary: '#006666',      // Deep medical teal
  section: '#004D4D',      // Dark teal for section headers
  lightBg: '#F8FCFA',      // Ice teal background
  warn: '#C53030',         // Clean crimson for allergies / urgent
  text: '#2D3748',         // Modern readable dark slate
  textLight: '#718096',    // Secondary neutral text
  white: '#FFFFFF',
  hdrBg: '#FFFFFF',
  tblHdr: '#E6F4F1',       // Soft pleasant teal table header
  border: '#CBD5E1',       // Crisp table border
  divider: '#E2E8F0',      // Inner table cell divider
  rowAlt: '#F8FAFC'        // Alternate row fill
};

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - 2 * M;
const FOOTER_ZONE = 36;          // space reserved at page bottom for footer
const maxY = PH - FOOTER_ZONE;

// ====================================================================
//  Main export
// ====================================================================
async function generatePrescriptionPDF(res, prescriptionId, prescription, patient, doctor) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margins: { top: M, bottom: 0, left: M, right: M },
        size: 'A4',
        bufferPages: true
      });
      const buffers = [];

      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => {
        try {
          const pdfBuffer = Buffer.concat(buffers);
          if (res && !res.headersSent) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            const isDownload = res.req?.query?.download === 'true';
            const dispositionType = isDownload ? 'attachment' : 'inline';
            res.setHeader('Content-Disposition', `${dispositionType}; filename="prescription-${prescriptionId}.pdf"`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(pdfBuffer);
          }
          resolve(pdfBuffer);
        } catch (e) {
          reject(e);
        }
      });
      doc.on('error', err => {
        console.error('PDFDocument internal error:', err);
        reject(err);
      });

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
      const pAddr      = formatCityState(patient.address || prescription.patientAddress || '', patient.city || prescription.patientCity, patient.state || prescription.patientState);
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

      const newPage = () => {
        doc.addPage({ margins: { top: M, bottom: 0, left: M, right: M } });
        pg++;
        y = M;
      };

      /** Ensure `needed` vertical pixels are available, break page if not */
      const ensureSpace = (needed = 40) => { if (y + needed > maxY && y > M + 5) newPage(); };

      /** Section title bar (dark teal background, crisp white text) */
      const titleBar = (title) => {
        ensureSpace(24);
        doc.rect(M, y, CW, 18).fill(C.section);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
          .text(title, M + 8, y + 4.5, { width: CW - 16, lineBreak: false });
        y += 20;
      };

      /** Bold label + value pair at (x, atY) */
      const bv = (label, val, x, atY) => {
        if (!val) return;
        const s = safeStr(val);
        if (!s) return;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        const lw = doc.widthOfString(label + ' ');
        doc.text(label + ' ', x, atY, { lineBreak: false });
        doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
          .text(s, x + lw, atY, { lineBreak: false });
      };

      /** Sub-header */
      const subHdr = (text, indent = M + 10, color = C.text) => {
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(color)
          .text(text, indent, y, { width: PW - M - indent });
        y += 13;
      };

      /** Warning bullet (red with standard marker) */
      const warnBullet = (text, indent = M + 15) => {
        ensureSpace(15);
        const s = safeStr(text);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.warn);
        const h = doc.heightOfString(`\u2022 ${s}`, { width: PW - M - indent - 5 });
        doc.text(`\u2022 ${s}`, indent, y, { width: PW - M - indent - 5 });
        y += Math.max(12, h + 1);
      };

      // ================================================================
      //                       CONTENT SECTIONS
      //  Everything flows top-to-bottom; pages break only when needed.
      // ================================================================

      // ─── 1. HEADER BOX (DOCTOR / CLINIC DETAILS) ─────────────────────
      const docFirstName = (doctor.firstName || prescription.doctorName?.split(' ')[0] || '').trim();
      const docLastName = (doctor.lastName || prescription.doctorName?.split(' ').slice(1).join(' ') || '').trim();
      let doctorDisplayName = `${docFirstName} ${docLastName}`.trim() || prescription.doctorName || 'Attending Physician';
      if (!doctorDisplayName.match(/^dr\.?\s+/i)) {
        doctorDisplayName = `Dr. ${doctorDisplayName}`;
      }

      const docSpecialization = doctor.specialization || doctor.doctorSpecialization || prescription.doctorSpecialization || prescription.specialization || 'General Physician';
      const docRegNo = doctor.registrationNumber || doctor.licenseNumber || doctor.doctorLicenseNumber || prescription.doctorRegistrationNumber || prescription.doctorLicenseNumber || prescription.registrationNumber || '';
      const drPhone = doctor.contactNumber || doctor.phone || doctor.doctorPhone || prescription.doctorPhone || prescription.contactNumber || '';
      const rawDocAddress = doctor.address || doctor.clinicAddress || prescription.doctorAddress || prescription.clinicAddress || '';
      const docAddress = formatCityState(rawDocAddress, doctor.city || prescription.doctorCity, doctor.state || prescription.doctorState);

      const clinicLogoBuf = await loadImageBuffer(doctor.clinicLogo);
      const hdrH = clinicLogoBuf ? 48 : 38;

      doc.roundedRect(M, y, CW, hdrH, 3).fillAndStroke(C.hdrBg, C.primary);
      doc.lineWidth(1.2);

      // Line 1: Doctor Name + Specialization (Left) | Clinic Name (Right)
      doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary);
      const nameW = doc.widthOfString(doctorDisplayName);
      doc.text(doctorDisplayName, M + 8, y + 6);

      if (docSpecialization) {
        doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#444444')
          .text(`  |  ${docSpecialization}`, M + 8 + nameW, y + 8.5, { width: Math.max(120, CW * 0.62 - nameW) });
      }

      // Line 2: Reg. No & Phone on Left / Center, Address on Right
      const hY = y + 21.5;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text);

      const leftParts = [];
      if (docRegNo) leftParts.push(`Reg. No: ${docRegNo}`);
      if (drPhone) leftParts.push(`Phone: ${drPhone}`);
      const leftStr = leftParts.join('   |   ');

      if (leftStr) {
        doc.text(leftStr, M + 8, hY, { width: CW * 0.48 });
      }

      if (docAddress) {
        const addrX = leftStr ? (M + CW * 0.50) : (M + 8);
        const addrW = leftStr ? (CW * 0.48) : (CW * 0.90);
        doc.text(`Address: ${docAddress}`, addrX, hY, { width: addrW });
      }

      // Right side – clinic logo (or clinic name fallback)
      if (clinicLogoBuf) {
        try {
          const logoMaxW = 110, logoMaxH = hdrH - 10;
          const logoX = PW - M - logoMaxW - 8;
          const logoY = y + 5;
          doc.image(clinicLogoBuf, logoX, logoY, {
            fit: [logoMaxW, logoMaxH],
            align: 'center',
            valign: 'center'
          });
        } catch (logoErr) {
          console.error('Clinic logo render error:', logoErr);
          const clinicName = doctor.clinicName || '';
          if (clinicName) {
            doc.font('Helvetica-Bold').fontSize(12).fillColor(C.primary)
              .text(clinicName, M, y + 10, { width: CW - 10, align: 'right' });
          }
        }
      } else {
        const clinicName = doctor.clinicName || '';
        if (clinicName) {
          doc.font('Helvetica-Bold').fontSize(12).fillColor(C.primary)
            .text(clinicName, M, y + 10, { width: CW - 10, align: 'right' });
        }
      }

      y += hdrH + 6;

      // ─── 2. PRESCRIPTION ID + QR CODE METADATA BAR ───────────────────
      const qrSize = 36;
      const rxY = y;
      
      // Left side: Prescription ID and Date & Time
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
        .text('Prescription ID:', M, rxY + 3, { continued: true });
      doc.font('Helvetica-Bold').fillColor(C.primary).text(`  ${rxId}`);
      
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
        .text('Date & Time:', M, rxY + 16, { continued: true });
      doc.font('Helvetica').fillColor(C.text).text(`      ${fDate}, ${fTime}`);

      // Right side: QR code
      try {
        const qrPayload = `https://medizo.life/verify-prescription?id=${prescriptionId}`;
        const qrUrl = await QRCode.toDataURL(qrPayload, {
          width: 160,
          margin: 0,
          color: { dark: '#000000', light: '#FFFFFF' },
          errorCorrectionLevel: 'M'
        });
        doc.image(qrUrl, PW - M - qrSize, rxY - 1, { width: qrSize, height: qrSize });
      } catch (e) {
        try {
          const qrUrl = await QRCode.toDataURL(String(prescriptionId), { width: 160, margin: 0 });
          doc.image(qrUrl, PW - M - qrSize, rxY - 1, { width: qrSize, height: qrSize });
        } catch (err2) {
          console.error('QR generation error:', err2);
        }
      }

      y = rxY + qrSize + 5;

      // ─── 3. PATIENT INFORMATION (COMPACT 2-COLUMN) ───────────────────
      {
        const L1 = M + 8, L2 = M + CW * 0.50;
        
        const pRows = [];
        pRows.push([{ label: 'Name:', val: pName }, { label: 'Patient ID:', val: pId }]);
        
        const col1_2 = { label: 'Age/Gender:', val: pAgeGender };
        const col2_2 = pBlood ? { label: 'Blood Type:', val: pBlood } : (pPhone ? { label: 'Contact:', val: pPhone } : null);
        pRows.push([col1_2, col2_2]);

        if (pAddr || (pPhone && col2_2?.label !== 'Contact:')) {
          const col1_3 = pAddr ? { label: 'Address:', val: pAddr } : null;
          const col2_3 = (pPhone && col2_2?.label !== 'Contact:') ? { label: 'Contact:', val: pPhone } : (pEmergency ? { label: 'Emergency:', val: pEmergency } : null);
          if (col1_3 || col2_3) pRows.push([col1_3, col2_3]);
        }

        const whStr = [pWeight, pHeight].filter(Boolean).join(' / ');
        const hasEmergencyUnused = pEmergency && !pRows.some(r => r[1]?.label === 'Emergency:');
        if (whStr || hasEmergencyUnused) {
          pRows.push([
            whStr ? { label: 'Weight/Height:', val: whStr } : null,
            hasEmergencyUnused ? { label: 'Emergency:', val: pEmergency } : null
          ]);
        }

        const rowCount = pRows.length;
        const bodyH = rowCount * 13 + 4;
        const boxH = 18 + bodyH;

        ensureSpace(boxH + 6);
        const startY = y;

        // Background & Header
        doc.rect(M, startY + 18, CW, bodyH).fill(C.lightBg);
        doc.rect(M, startY, CW, 18).fill(C.section);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
          .text('PATIENT INFORMATION', M + 8, startY + 4.5);
        doc.rect(M, startY, CW, boxH).strokeColor(C.primary).lineWidth(1).stroke();

        // Fields
        let py = startY + 22;
        pRows.forEach(row => {
          if (row[0] && row[0].val) bv(row[0].label, row[0].val, L1, py);
          if (row[1] && row[1].val) bv(row[1].label, row[1].val, L2, py);
          py += 12.5;
        });

        y = startY + boxH + 6;
      }

      // ─── 4. VITAL SIGNS (COMPACT GRID) ───────────────────────────────
      const hasVitals = vs.bloodPressure || vs.pulse || vs.temperature || vs.spo2 || vs.respiratoryRate || vs.bmi || vs.painScale;
      if (hasVitals) {
        ensureSpace(50);
        const startY = y;
        doc.rect(M, y, CW, 18).fill(C.section);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
          .text('VITAL SIGNS (Recorded at consultation)', M + 8, y + 4.5);
        y += 22;

        const vW = CW / 4;
        const vx = [M + 8, M + 8 + vW, M + 8 + vW * 2, M + 8 + vW * 3];

        if (vs.bloodPressure) {
          const bpParts = String(vs.bloodPressure).split('/');
          if (bpParts.length === 2) {
            bv('BP:', `${bpParts[0].trim()} / ${bpParts[1].trim()} mmHg`, vx[0], y);
          } else {
            bv('BP:', `${vs.bloodPressure} mmHg`, vx[0], y);
          }
        }
        y += 12.5;

        if (vs.pulse) bv('Pulse:', `${vs.pulse} bpm`, vx[0], y);
        if (vs.temperature) bv('Temp:', `${vs.temperature} °F`, vx[1], y);
        if (vs.spo2) bv('SpO2:', `${vs.spo2} %`, vx[2], y);
        if (vs.respiratoryRate) bv('Resp. Rate:', `${vs.respiratoryRate} /min`, vx[3], y);
        y += 12.5;

        if (vs.bmi || vs.painScale) {
          if (vs.bmi) bv('BMI:', `${vs.bmi} kg/m²`, vx[0], y);
          if (vs.painScale) bv('Pain Scale:', `${vs.painScale} / 10`, vx[1], y);
          y += 12.5;
        }

        doc.rect(M, startY, CW, y - startY + 2).strokeColor(C.primary).lineWidth(1).stroke();
        y += 6;
      }

      // ─── 5. MEDICAL HISTORY (TABULAR FORMAT) ─────────────────────────
      const historyRows = [];
      if (allergyList.length > 0) {
        historyRows.push({
          category: 'Known Allergies',
          details: allergyList.map(safeStr).filter(Boolean).join(', '),
          isWarning: true
        });
      }
      if (curMeds.length > 0) {
        historyRows.push({
          category: 'Current Medications',
          details: curMeds.map(safeStr).filter(Boolean).join(', '),
          isWarning: false
        });
      }
      if (surgHist.length > 0) {
        historyRows.push({
          category: 'Past Surgical History',
          details: surgHist.map(safeStr).filter(Boolean).join(', '),
          isWarning: false
        });
      }
      const chronicList = prescription.chronicConditions || patient.chronicConditions || [];
      if (chronicList && (Array.isArray(chronicList) ? chronicList.length > 0 : Boolean(chronicList))) {
        historyRows.push({
          category: 'Chronic Conditions',
          details: Array.isArray(chronicList) ? chronicList.map(safeStr).filter(Boolean).join(', ') : safeStr(chronicList),
          isWarning: false
        });
      }
      if (prescription.medicalHistory && typeof prescription.medicalHistory === 'string' && prescription.medicalHistory.trim()) {
        historyRows.push({
          category: 'Past Medical Notes',
          details: prescription.medicalHistory.trim(),
          isWarning: false
        });
      }

      if (historyRows.length > 0) {
        let histTotalH = 24 + 18;
        historyRows.forEach(row => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          histTotalH += rowH;
        });
        histTotalH += 5;

        ensureSpace(histTotalH);

        titleBar('MEDICAL HISTORY');

        // Table Header
        doc.rect(M, y, CW, 18).fill(C.tblHdr);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        doc.text('Record Type / Category', M + 6, y + 4.5, { width: 130 });
        doc.text('Clinical Details / History', M + 146, y + 4.5, { width: CW - 152 });

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        [M, M + 140, PW - M].forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        // Data Rows
        historyRows.forEach((row, idx) => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          const rowY = y;

          if (idx % 2 === 0) {
            doc.rect(M, rowY, CW, rowH).fill(C.lightBg);
          }

          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(row.isWarning ? C.warn : C.text)
            .text(row.category, M + 6, rowY + 4, { width: 130 });

          doc.font(row.isWarning ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(row.isWarning ? C.warn : C.text)
            .text(row.details, M + 146, rowY + 4, { width: CW - 152 });

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          [M, M + 140, PW - M].forEach(cx => {
            doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
          });

          y = rowY + rowH;
        });

        y += 5;
      }

      // ─── 6. CHIEF COMPLAINTS & CLINICAL NOTES (TABULAR FORMAT) ───────
      const clinicalRows = [];
      if (complaints.length > 0) {
        clinicalRows.push({
          category: 'Presenting Complaints',
          details: complaints.map(safeStr).filter(Boolean).join(', ')
        });
      }
      if (findings.length > 0) {
        clinicalRows.push({
          category: 'Clinical Findings',
          details: findings.map(safeStr).filter(Boolean).join(', ')
        });
      }
      if (provDiag.length > 0) {
        clinicalRows.push({
          category: 'Provisional Diagnosis',
          details: provDiag.map(safeStr).filter(Boolean).join(', ')
        });
      }

      if (clinicalRows.length > 0) {
        let clinTotalH = 24 + 18;
        clinicalRows.forEach(row => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          clinTotalH += rowH;
        });
        clinTotalH += 5;

        ensureSpace(clinTotalH);

        titleBar('CHIEF COMPLAINTS & CLINICAL NOTES');

        doc.rect(M, y, CW, 18).fill(C.tblHdr);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        doc.text('Clinical Parameter', M + 6, y + 4.5, { width: 130 });
        doc.text('Observations / Findings', M + 146, y + 4.5, { width: CW - 152 });

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        [M, M + 140, PW - M].forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        clinicalRows.forEach((row, idx) => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          const rowY = y;

          if (idx % 2 === 0) {
            doc.rect(M, rowY, CW, rowH).fill(C.lightBg);
          }

          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
            .text(row.category, M + 6, rowY + 4, { width: 130 });

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(row.details, M + 146, rowY + 4, { width: CW - 152 });

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          [M, M + 140, PW - M].forEach(cx => {
            doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
          });

          y = rowY + rowH;
        });

        y += 5;
      }

      // ─── 7. PRESCRIBED MEDICATIONS ───────────────────────────────────
      if (meds.length > 0) {
        const col = {
          num:   { x: M, w: 28 },
          name:  { x: M + 28, w: 142 },
          dos:   { x: M + 170, w: 95 },
          dur:   { x: M + 265, w: 90 },
          instr: { x: M + 355, w: CW - 355 }
        };

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

        const buildDosStr = (med) => {
          let s = safeStr(med.dosage);
          if (med.frequency) {
            const freqMap = {'1': 'Once daily', '2': 'Twice daily', '3': 'Thrice daily', '4': 'Four times daily', 'SOS': 'As needed (SOS)'};
            const freqLabel = freqMap[safeStr(med.frequency)] || safeStr(med.frequency);
            s = s ? `${s}\n(${freqLabel})` : freqLabel;
          }
          return s || '-';
        };

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

        let medsTotalH = 24 + 18;
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
          const rowH = Math.max(22, instrH + 6, nameH + 6, dosH + 6, durH + 6);
          medsTotalH += rowH;
        });

        if (medNotes.length > 0) {
          medsTotalH += 16;
          medNotes.forEach(note => {
            doc.font('Helvetica').fontSize(8.5);
            medsTotalH += Math.max(13, doc.heightOfString(`\u2022 ${safeStr(note)}`, { width: CW - 20 }) + 1);
          });
        }
        medsTotalH += 6;

        ensureSpace(medsTotalH);

        titleBar('PRESCRIBED MEDICATIONS');

        // Table header
        doc.rect(M, y, CW, 18).fill(C.tblHdr);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        doc.text('No.',             col.num.x + 2,   y + 4.5, { width: col.num.w - 4,   align: 'center' });
        doc.text('Medicine Name',   col.name.x + 4,  y + 4.5, { width: col.name.w - 8 });
        doc.text('Dosage',          col.dos.x + 4,   y + 4.5, { width: col.dos.w - 8,   align: 'center' });
        doc.text('Duration / Qty',  col.dur.x + 4,   y + 4.5, { width: col.dur.w - 8,   align: 'center' });
        doc.text('Instructions',    col.instr.x + 4, y + 4.5, { width: col.instr.w - 8 });

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        [M, col.name.x, col.dos.x, col.dur.x, col.instr.x, PW - M].forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        // Data rows
        meds.forEach((med, idx) => {
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
          const rowH = Math.max(22, instrH + 6, nameH + 6, dosH + 6, durH + 6);
          const rowY = y;

          if (idx % 2 === 0) {
            doc.rect(M, rowY, CW, rowH).fill(C.lightBg);
          }

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(`${idx + 1}`, col.num.x + 2, rowY + 5, { width: col.num.w - 4, align: 'center' });

          doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
            .text(safeStr(med.name) || '', col.name.x + 4, rowY + 5, { width: col.name.w - 8 });
          if (med.type) {
            const nh = doc.font('Helvetica-Bold').fontSize(9).heightOfString(safeStr(med.name) || '', { width: col.name.w - 8 });
            doc.font('Helvetica').fontSize(8).fillColor('#666666')
              .text(`(${safeStr(med.type)})`, col.name.x + 4, rowY + 5 + nh, { width: col.name.w - 8 });
          }

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(dosStr, col.dos.x + 4, rowY + 5, { width: col.dos.w - 8, align: 'center' });

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(durStr, col.dur.x + 4, rowY + 5, { width: col.dur.w - 8, align: 'center' });

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(instrStr, col.instr.x + 4, rowY + 5, { width: col.instr.w - 8 });

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          [M, col.name.x, col.dos.x, col.dur.x, col.instr.x, PW - M].forEach(cx => {
            doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
          });

          y = rowY + rowH;
        });

        y += 4;

        if (medNotes.length > 0) {
          subHdr('Important Medication Notes:', M + 10, C.warn);
          medNotes.forEach(note => warnBullet(safeStr(note)));
          y += 3;
        }
        y += 5;
      }

      // ─── 8. INVESTIGATIONS & DIAGNOSTIC TESTS REQUIRED ───────────────
      if (invList.length > 0) {
        const invCol = {
          num:    { x: M, w: 28 },
          name:   { x: M + 28, w: 150 },
          cond:   { x: M + 178, w: 105 },
          reason: { x: M + 283, w: 110 },
          instr:  { x: M + 393, w: CW - 393 }
        };

        const buildCondStr = (inv) => {
          const parts = [];
          if (inv.priority) parts.push(`Priority: ${safeStr(inv.priority).toUpperCase()}`);
          if (inv.fasting) parts.push(`Fasting: ${safeStr(inv.fasting)}`);
          return parts.length > 0 ? parts.join('\n') : 'Routine';
        };

        let invTotalH = 24 + 18;
        invList.forEach((inv) => {
          const testName = safeStr(inv.testName) || safeStr(inv);
          const condStr = buildCondStr(inv);
          const reasonStr = safeStr(inv.reason) || '-';
          const instrStr = safeStr(inv.specialInstructions) || '-';

          doc.font('Helvetica-Bold').fontSize(9);
          const nameH = doc.heightOfString(testName, { width: invCol.name.w - 8 });
          doc.font('Helvetica').fontSize(8.5);
          const condH = doc.heightOfString(condStr, { width: invCol.cond.w - 8 });
          const reasonH = doc.heightOfString(reasonStr, { width: invCol.reason.w - 8 });
          const instrH = doc.heightOfString(instrStr, { width: invCol.instr.w - 8 });

          const rowH = Math.max(20, nameH + 6, condH + 6, reasonH + 6, instrH + 6);
          invTotalH += rowH;
        });

        if (invNotes) invTotalH += 18;
        invTotalH += 6;

        ensureSpace(invTotalH);

        titleBar('INVESTIGATIONS & DIAGNOSTIC TESTS REQUIRED');

        doc.rect(M, y, CW, 18).fill(C.tblHdr);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        doc.text('No.',                  invCol.num.x + 2,    y + 4.5, { width: invCol.num.w - 4,   align: 'center' });
        doc.text('Investigation / Test', invCol.name.x + 4,   y + 4.5, { width: invCol.name.w - 8 });
        doc.text('Priority & Fasting',   invCol.cond.x + 4,   y + 4.5, { width: invCol.cond.w - 8,   align: 'center' });
        doc.text('Clinical Reason',      invCol.reason.x + 4, y + 4.5, { width: invCol.reason.w - 8 });
        doc.text('Special Instructions', invCol.instr.x + 4,  y + 4.5, { width: invCol.instr.w - 8 });

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        [M, invCol.name.x, invCol.cond.x, invCol.reason.x, invCol.instr.x, PW - M].forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        invList.forEach((inv, idx) => {
          const testName = safeStr(inv.testName) || safeStr(inv);
          const condStr = buildCondStr(inv);
          const reasonStr = safeStr(inv.reason) || '-';
          const instrStr = safeStr(inv.specialInstructions) || '-';

          doc.font('Helvetica-Bold').fontSize(9);
          const nameH = doc.heightOfString(testName, { width: invCol.name.w - 8 });
          doc.font('Helvetica').fontSize(8.5);
          const condH = doc.heightOfString(condStr, { width: invCol.cond.w - 8 });
          const reasonH = doc.heightOfString(reasonStr, { width: invCol.reason.w - 8 });
          const instrH = doc.heightOfString(instrStr, { width: invCol.instr.w - 8 });

          const rowH = Math.max(20, nameH + 6, condH + 6, reasonH + 6, instrH + 6);
          const rowY = y;

          if (idx % 2 === 0) {
            doc.rect(M, rowY, CW, rowH).fill(C.lightBg);
          }

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(`${idx + 1}`, invCol.num.x + 2, rowY + 5, { width: invCol.num.w - 4, align: 'center' });

          doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
            .text(testName, invCol.name.x + 4, rowY + 5, { width: invCol.name.w - 8 });

          doc.font('Helvetica').fontSize(8.5).fillColor(inv.priority === 'urgent' ? C.warn : C.text)
            .text(condStr, invCol.cond.x + 4, rowY + 5, { width: invCol.cond.w - 8, align: 'center' });

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(reasonStr, invCol.reason.x + 4, rowY + 5, { width: invCol.reason.w - 8 });

          doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
            .text(instrStr, invCol.instr.x + 4, rowY + 5, { width: invCol.instr.w - 8 });

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          [M, invCol.name.x, invCol.cond.x, invCol.reason.x, invCol.instr.x, PW - M].forEach(cx => {
            doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
          });

          y = rowY + rowH;
        });

        y += 4;

        if (invNotes) {
          subHdr('General Lab / Diagnostic Notes:', M + 10, C.warn);
          warnBullet(safeStr(invNotes));
          y += 3;
        }
        y += 5;
      }

      // ─── 9. DIETARY & LIFESTYLE RECOMMENDATIONS ───────────────────────
      const dietLifeRows = [];
      if (dietMods.length > 0) {
        dietLifeRows.push({
          category: 'Diet Modifications',
          details: dietMods.map(safeStr).filter(Boolean).join(', '),
          isWarning: false
        });
      }
      if (lifestyleChg.length > 0) {
        dietLifeRows.push({
          category: 'Lifestyle Advice',
          details: lifestyleChg.map(safeStr).filter(Boolean).join(', '),
          isWarning: false
        });
      }
      if (warnSigns.length > 0) {
        dietLifeRows.push({
          category: 'Emergency Warning Signs',
          details: warnSigns.map(safeStr).filter(Boolean).join(', '),
          isWarning: true
        });
      }

      if (dietLifeRows.length > 0) {
        let dlTotalH = 24 + 18;
        dietLifeRows.forEach(row => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          dlTotalH += rowH;
        });
        dlTotalH += 5;

        ensureSpace(dlTotalH);

        titleBar('DIETARY & LIFESTYLE RECOMMENDATIONS');

        doc.rect(M, y, CW, 18).fill(C.tblHdr);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text);
        doc.text('Advice Category', M + 6, y + 4.5, { width: 130 });
        doc.text('Recommendations & Instructions', M + 146, y + 4.5, { width: CW - 152 });

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        [M, M + 140, PW - M].forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        dietLifeRows.forEach((row, idx) => {
          doc.font('Helvetica-Bold').fontSize(8.5);
          const catH = doc.heightOfString(row.category, { width: 130 });
          doc.font('Helvetica').fontSize(8.5);
          const detH = doc.heightOfString(row.details, { width: CW - 150 });
          const rowH = Math.max(18, catH + 5, detH + 5);
          const rowY = y;

          if (idx % 2 === 0) {
            doc.rect(M, rowY, CW, rowH).fill(C.lightBg);
          }

          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(row.isWarning ? C.warn : C.text)
            .text(row.category, M + 6, rowY + 4, { width: 130 });

          doc.font(row.isWarning ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(row.isWarning ? C.warn : C.text)
            .text(row.details, M + 146, rowY + 4, { width: CW - 152 });

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          [M, M + 140, PW - M].forEach(cx => {
            doc.moveTo(cx, rowY).lineTo(cx, rowY + rowH).stroke();
          });

          y = rowY + rowH;
        });

        y += 5;
      }

      // ─── 10. STICKY FOOTER SECTIONS (FOLLOW-UP, SIGNATURE & STAMP) ───
      const hasFollowUp = fuDate || fuPurpose || fuBring.length > 0;
      let stickyTotalH = 0;

      let fuBoxH = 0;
      if (hasFollowUp) {
        let fuBodyLines = 0;
        if (fuDate) fuBodyLines++;
        if (fuPurpose) fuBodyLines++;
        if (fuBring.length) fuBodyLines += 1 + fuBring.length;
        if (drPhone) fuBodyLines++;
        const fuBodyH = fuBodyLines * 15 + 8;
        fuBoxH = 18 + fuBodyH;
        stickyTotalH += fuBoxH + 8;
      }

      let specialInstrH = 0;
      if (specialInstr) {
        doc.font('Helvetica').fontSize(9);
        specialInstrH = doc.heightOfString(specialInstr, { width: CW - 130 }) + 8;
        stickyTotalH += specialInstrH + 6;
      }

      let addNotesH = 0;
      if (addNotes) {
        doc.font('Helvetica').fontSize(9);
        addNotesH = doc.heightOfString(addNotes, { width: CW - 110 }) + 14;
        stickyTotalH += addNotesH + 6;
      }

      const signatureBuf = await loadImageBuffer(doctor.signature);
      const stampBuf = await loadImageBuffer(doctor.stamp);
      const hasSignatureImg = !!signatureBuf;
      const hasStampImg = !!stampBuf;
      const sigStampH = hasSignatureImg ? (hasStampImg ? 85 : 75) : (hasStampImg ? 75 : 60);
      stickyTotalH += sigStampH;

      ensureSpace(stickyTotalH + 5);

      // Follow-up Information box
      if (hasFollowUp) {
        const fuStartY = y;
        let fuBodyLines = 0;
        if (fuDate) fuBodyLines++;
        if (fuPurpose) fuBodyLines++;
        if (fuBring.length) fuBodyLines += 1 + fuBring.length;
        if (drPhone) fuBodyLines++;
        const fuBodyH = fuBodyLines * 15 + 8;

        doc.rect(M, fuStartY + 18, CW, fuBodyH).fill(C.lightBg);
        doc.rect(M, fuStartY, CW, 18).fill(C.section);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
          .text('FOLLOW-UP INFORMATION', M + 8, fuStartY + 4.5);
        doc.rect(M, fuStartY, CW, fuBoxH).strokeColor(C.primary).lineWidth(1).stroke();

        y = fuStartY + 22;
        if (fuDate) {
          const fuDateFmt = new Date(fuDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
          let appt = fuDateFmt;
          if (fuTime) appt += ` at ${fuTime}`;
          doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
            .text('Next Appointment: ', M + 10, y, { continued: true });
          doc.font('Helvetica').fontSize(9).text(appt, { underline: true });
          y += 15;
        }
        if (fuPurpose) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
            .text('Purpose: ', M + 10, y, { continued: true });
          doc.font('Helvetica').text(fuPurpose);
          y += 15;
        }
        if (fuBring.length) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text).text('Bring to follow-up:', M + 10, y); y += 13;
          fuBring.forEach(b => { doc.font('Helvetica').fontSize(8.5).fillColor(C.text).text(`\u2022 ${b}`, M + 15, y); y += 12; });
          y += 2;
        }
        if (drPhone) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
            .text('For Appointments: ', M + 10, y, { continued: true });
          doc.font('Helvetica').text(`Call ${drPhone}`);
          y += 15;
        }

        y = fuStartY + fuBoxH + 6;
      }

      // Special Instructions
      if (specialInstr) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
          .text('Special Instructions: ', M, y, { continued: true });
        doc.font('Helvetica').fontSize(9).text(specialInstr, { width: CW - 130 });
        const siH = doc.heightOfString(specialInstr, { width: CW - 130 });
        y += siH + 8;
      }

      // Additional Notes
      if (addNotes) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text)
          .text('Additional Notes: ', M, y, { continued: true });
        doc.font('Helvetica').fontSize(9).text(addNotes, { width: CW - 110 });
        y += addNotesH + 6;
      }

      // Prescribed by & Stamp
      y += 8;
      const sigY = y;
      let siy = sigY + 50;

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.primary).text('Prescribed by:', M, sigY);
      
      // Doctor Signature
      if (signatureBuf) {
        try {
          const sigImgW = 140, sigImgH = 45;
          doc.image(signatureBuf, M, sigY + 12, {
            fit: [sigImgW, sigImgH],
            align: 'left',
            valign: 'center'
          });
          doc.moveTo(M, sigY + 60).lineTo(M + 170, sigY + 60).strokeColor(C.primary).lineWidth(0.8).stroke();
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
            .text(doctorDisplayName, M, sigY + 63);
          siy = sigY + 76;
          if (docSpecialization) {
            const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
            doc.font('Helvetica').fontSize(8.5).text(spec, M, siy); siy += 11;
          }
          if (docRegNo) { doc.font('Helvetica').fontSize(8.5).text(`Reg. No: ${docRegNo}`, M, siy); siy += 11; }
          doc.font('Helvetica').fontSize(8.5).text(`Date: ${fDate}`, M, siy);
        } catch (sigErr) {
          console.error('Signature render error:', sigErr);
          doc.moveTo(M, sigY + 24).lineTo(M + 170, sigY + 24).strokeColor(C.primary).lineWidth(0.8).stroke();
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
            .text(doctorDisplayName, M, sigY + 28);
          siy = sigY + 44;
          if (docSpecialization) {
            const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
            doc.font('Helvetica').fontSize(8.5).text(spec, M, siy); siy += 11;
          }
          if (docRegNo) { doc.font('Helvetica').fontSize(8.5).text(`Reg. No: ${docRegNo}`, M, siy); siy += 11; }
          doc.font('Helvetica').fontSize(8.5).text(`Date: ${fDate}`, M, siy);
        }
      } else {
        doc.moveTo(M, sigY + 24).lineTo(M + 170, sigY + 24).strokeColor(C.primary).lineWidth(0.8).stroke();
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
          .text(doctorDisplayName, M, sigY + 28);
        siy = sigY + 44;
        if (docSpecialization) {
          const spec = docSpecialization.length > 35 ? docSpecialization.substring(0, 35) + '...' : docSpecialization;
          doc.font('Helvetica').fontSize(8.5).text(spec, M, siy); siy += 11;
        }
        if (docRegNo) { doc.font('Helvetica').fontSize(8.5).text(`Reg. No: ${docRegNo}`, M, siy); siy += 11; }
        doc.font('Helvetica').fontSize(8.5).text(`Date: ${fDate}`, M, siy);
      }

      // Doctor Stamp (Right side)
      const stampW = 120, stampH = 55;
      if (stampBuf) {
        const stampX = PW - M - stampW - 10;
        let stampDrawn = false;
        try {
          doc.rect(stampX, sigY + 5, stampW, stampH).strokeColor(C.primary).lineWidth(0.8).stroke();
          doc.image(stampBuf, stampX + 4, sigY + 8, {
            fit: [stampW - 8, stampH - 6],
            align: 'center',
            valign: 'center'
          });
          stampDrawn = true;
        } catch (stampErr) {
          console.error('Stamp render error:', stampErr);
        }
        y = stampDrawn ? Math.max(siy + 15, sigY + stampH + 15) : siy + 15;
      } else {
        y = siy + 15;
      }

      // ─── 11. PAGE FOOTER (APPLIED TO ALL PAGES IN ABSOLUTE FOOTER ZONE) ─────
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fY = PH - 26;
        doc.moveTo(M, fY).lineTo(PW - M, fY).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
          .text('For verification, scan the QR code to get the Prescription ID on medizo.life', M, fY + 5, {
            width: CW,
            height: 10,
            align: 'center',
            lineBreak: false
          });
        if (emergLine) {
          doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text)
            .text(`24x7 Emergency Helpline: ${emergLine}`, M, fY + 14, {
              width: CW,
              height: 10,
              align: 'center',
              lineBreak: false
            });
        }
      }

      doc.end();
    } catch (err) {
      console.error('generatePrescriptionPDF error:', err);
      reject(err);
    }
  });
}

module.exports = { generatePrescriptionPDF };
