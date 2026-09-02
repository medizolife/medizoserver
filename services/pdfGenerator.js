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

/**
 * Draw a vector-rendered QR code using PDFKit path rectangles.
 * 100% vector, zero external image decoders needed, guaranteed to render across all environments.
 */
function drawVectorQr(doc, text, x, y, size, darkColor = '#0A2540', lightColor = '#FFFFFF') {
  try {
    const qr = QRCode.create(String(text || ''), { errorCorrectionLevel: 'M' });
    const modules = qr.modules;
    const count = modules.size;
    const cellSize = size / count;

    if (lightColor) {
      doc.rect(x - 2, y - 2, size + 4, size + 4).fillColor(lightColor).fill();
    }

    doc.fillColor(darkColor);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (modules.get(r, c)) {
          doc.rect(x + c * cellSize, y + r * cellSize, cellSize + 0.05, cellSize + 0.05).fill();
        }
      }
    }
    return true;
  } catch (e) {
    console.error('drawVectorQr error:', e.message);
    return false;
  }
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

      const pName      = `${patient.firstName || ''} ${patient.middleName || ''} ${patient.lastName || ''}`.replace(/\s+/g, ' ').trim() || prescription.patientName || 'Patient';
      let pAge = '';
      const dobVal = patient.dateOfBirth || patient.dob || prescription.patientDOB || prescription.patientDateOfBirth || prescription.dob;
      if (dobVal) {
        const dobTime = new Date(dobVal).getTime();
        if (!isNaN(dobTime)) {
          const years = Math.floor((Date.now() - dobTime) / (365.25 * 86400000));
          if (years >= 0 && years < 150) {
            pAge = `${years} Yrs`;
          }
        }
      }
      if (!pAge) {
        const directAge = patient.age || patient.patientAge || prescription.patientAge || prescription.age;
        if (directAge) {
          pAge = String(directAge).toLowerCase().includes('yr') ? String(directAge) : `${directAge} Yrs`;
        }
      }
      const rawGender  = patient.gender || prescription.patientGender || prescription.gender || '';
      const pGender    = rawGender ? rawGender.charAt(0).toUpperCase() + rawGender.slice(1).toLowerCase() : '';
      const pAgeGender = [pAge, pGender].filter(Boolean).join(' / ') || 'N/A';
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
      const topY = y;
      const qrSize = 78;
      const qrX = PW - M - qrSize;
      const qrY = topY - 1;
      const drBoxW = qrX - M - 10;

      // ─── 1. HEADER BOX (DOCTOR DETAILS - REDUCED WIDTH) ───────────────
      doc.roundedRect(M, topY, drBoxW, hdrH, 3).fillAndStroke(C.hdrBg, C.primary);
      doc.lineWidth(1.0);

      // Line 1: Doctor Name + Specialization (Left) | Clinic Name (Right)
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.primary);
      const nameW = doc.widthOfString(doctorDisplayName);
      doc.text(doctorDisplayName, M + 8, topY + 6);

      if (docSpecialization) {
        doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#444444')
          .text(`  |  ${docSpecialization}`, M + 8 + nameW, topY + 8, { width: Math.max(100, drBoxW * 0.60 - nameW) });
      }

      // Line 2: Reg. No & Phone on Left / Center, Address on Right
      const hY = topY + 21.5;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text);

      const leftParts = [];
      if (docRegNo) leftParts.push(`Reg. No: ${docRegNo}`);
      if (drPhone) leftParts.push(`Phone: ${drPhone}`);
      const leftStr = leftParts.join('   |   ');

      if (leftStr) {
        doc.text(leftStr, M + 8, hY, { width: drBoxW * 0.48 });
      }

      if (docAddress) {
        const addrX = leftStr ? (M + drBoxW * 0.50) : (M + 8);
        const addrW = leftStr ? (drBoxW * 0.48) : (drBoxW * 0.92);
        doc.text(`Address: ${docAddress}`, addrX, hY, { width: addrW });
      }

      // Clinic name / logo if present
      if (clinicLogoBuf) {
        try {
          const logoMaxW = 80, logoMaxH = hdrH - 10;
          const logoX = M + drBoxW - logoMaxW - 6;
          doc.image(clinicLogoBuf, logoX, topY + 5, {
            fit: [logoMaxW, logoMaxH],
            align: 'center',
            valign: 'center'
          });
        } catch (logoErr) {
          const clinicName = doctor.clinicName || '';
          if (clinicName) {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(C.primary)
              .text(clinicName, M, topY + 8, { width: drBoxW - 8, align: 'right' });
          }
        }
      } else {
        const clinicName = doctor.clinicName || '';
        if (clinicName) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.primary)
            .text(clinicName, M, topY + 8, { width: drBoxW - 8, align: 'right' });
        }
      }

      // ─── 2. PRESCRIPTION METADATA (LEFT SIDE UNDER DR BOX) ────────────
      const metaY = topY + hdrH + 4;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
        .text('Prescription ID:', M, metaY + 2, { continued: true });
      doc.font('Helvetica-Bold').fillColor(C.primary).text(`  ${rxId}`);
      
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
        .text('Date & Time:', M, metaY + 14, { continued: true });
      doc.font('Helvetica').fillColor(C.text).text(`      ${fDate}, ${fTime}`);

      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.secondary)
        .text('Verification Portal:', M, metaY + 26, { continued: true });
      doc.font('Helvetica').fillColor(C.text).text('  medizo.life');

      // ─── 3. BORDERLESS LARGE PURE BLACK VECTOR QR CODE (RIGHT SIDE) ───
      const clientBaseUrl = (process.env.CLIENT_URL || 'https://medizo.life').replace(/\/+$/, '');
      const qrPayload = `${clientBaseUrl}/dashboard?rxId=${prescriptionId}`;
      drawVectorQr(doc, qrPayload, qrX, qrY, qrSize, '#000000', null);

      y = topY + qrSize + 6;

      // ─── 3. PATIENT INFORMATION (COMPACT 2-COLUMN) ───────────────────
      {
        const L1 = M + 8, L2 = M + CW * 0.50;
        
        const pRows = [];
        // Row 1: Name & Patient ID
        pRows.push([{ label: 'Name:', val: pName }, { label: 'Patient ID:', val: pId }]);
        
        // Row 2: Age & Gender (Separated into distinct inputs/fields)
        pRows.push([
          { label: 'Age:', val: pAge || 'N/A' },
          { label: 'Gender:', val: pGender || 'N/A' }
        ]);

        // Row 3: Blood Type & Contact
        const col1_3 = pBlood ? { label: 'Blood Type:', val: pBlood } : (pPhone ? { label: 'Contact:', val: pPhone } : null);
        const col2_3 = (pBlood && pPhone) ? { label: 'Contact:', val: pPhone } : (pEmergency ? { label: 'Emergency:', val: pEmergency } : null);
        if (col1_3 || col2_3) {
          pRows.push([col1_3, col2_3]);
        }

        // Row 4: Address & Emergency Contact
        const usedContact = pRows.some(r => r[0]?.label === 'Contact:' || r[1]?.label === 'Contact:');
        const usedEmergency = pRows.some(r => r[0]?.label === 'Emergency:' || r[1]?.label === 'Emergency:');

        const col1_4 = pAddr ? { label: 'Address:', val: pAddr } : (!usedContact && pPhone ? { label: 'Contact:', val: pPhone } : null);
        const col2_4 = (!usedEmergency && pEmergency) ? { label: 'Emergency:', val: pEmergency } : null;
        if (col1_4 || col2_4) {
          pRows.push([col1_4, col2_4]);
        }

        // Row 5: Weight / Height if available
        const whStr = [pWeight, pHeight].filter(Boolean).join(' / ');
        const stillUnusedEmergency = pEmergency && !pRows.some(r => r[0]?.label === 'Emergency:' || r[1]?.label === 'Emergency:');
        if (whStr || stillUnusedEmergency) {
          pRows.push([
            whStr ? { label: 'Weight/Height:', val: whStr } : null,
            stillUnusedEmergency ? { label: 'Emergency:', val: pEmergency } : null
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
          const cleanBp = String(vs.bloodPressure).replace(/\s*mmHg/gi, '').trim();
          const bpParts = cleanBp.split('/');
          if (bpParts.length === 2) {
            bv('BP:', `${bpParts[0].trim()} / ${bpParts[1].trim()} mmHg`, vx[0], y);
          } else {
            bv('BP:', `${cleanBp} mmHg`, vx[0], y);
          }
        }
        y += 12.5;

        if (vs.pulse) {
          const cleanPulse = String(vs.pulse).replace(/\s*bpm/gi, '').trim();
          bv('Pulse:', `${cleanPulse} bpm`, vx[0], y);
        }
        if (vs.temperature) {
          const cleanTemp = String(vs.temperature).replace(/\s*°?\s*[FC]/gi, '').trim();
          bv('Temp:', `${cleanTemp} °F`, vx[1], y);
        }
        if (vs.spo2) {
          const cleanSpo2 = String(vs.spo2).replace(/\s*%/g, '').trim();
          bv('SpO2:', `${cleanSpo2} %`, vx[2], y);
        }
        if (vs.respiratoryRate) {
          const cleanResp = String(vs.respiratoryRate).replace(/\s*(\/min|bpm|cpm)/gi, '').trim();
          bv('Resp. Rate:', `${cleanResp} /min`, vx[3], y);
        }
        y += 12.5;

        if (vs.bmi || vs.painScale) {
          if (vs.bmi) {
            const cleanBmi = String(vs.bmi).replace(/\s*kg\/m²?/gi, '').trim();
            bv('BMI:', `${cleanBmi} kg/m²`, vx[0], y);
          }
          if (vs.painScale) {
            const cleanPain = String(vs.painScale).replace(/\s*\/\s*10/g, '').trim();
            bv('Pain Scale:', `${cleanPain} / 10`, vx[1], y);
          }
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
        const buildInstrStr = (med) => {
          const parts = [];
          const t = safeStr(med.timing);
          const mr = safeStr(med.mealRelation);
          const ins = safeStr(med.instructions);
          if (t && t !== '-') parts.push(t);
          if (mr && mr !== '-') parts.push(mr);
          if (ins && ins !== '-') parts.push(ins);
          return parts.length > 0 ? parts.join(' | ') : '-';
        };

        const hasAnyMedInstr = meds.some(m => {
          const s = buildInstrStr(m);
          return s && s !== '-';
        });

        const col = hasAnyMedInstr ? {
          num:   { x: M, w: 28 },
          name:  { x: M + 28, w: 142 },
          dos:   { x: M + 170, w: 95 },
          dur:   { x: M + 265, w: 90 },
          instr: { x: M + 355, w: CW - 355 }
        } : {
          num:   { x: M, w: 28 },
          name:  { x: M + 28, w: 217 },
          dos:   { x: M + 245, w: 135 },
          dur:   { x: M + 380, w: CW - 380 }
        };

        const divCols = hasAnyMedInstr
          ? [M, col.name.x, col.dos.x, col.dur.x, col.instr.x, PW - M]
          : [M, col.name.x, col.dos.x, col.dur.x, PW - M];

        const buildDosStr = (med) => {
          let s = safeStr(med.dosage);
          const intervalDays = Number(med.intervalDays) || 0;
          let intervalLabel = '';
          if (intervalDays > 1) {
            intervalLabel = intervalDays === 2 ? 'Alternate Days (Every 2d)' : intervalDays === 7 ? 'Weekly (Every 7d)' : `Every ${intervalDays} Days`;
          }

          if (med.frequency) {
            const freqMap = {'1': 'Once daily', '2': 'Twice daily', '3': 'Thrice daily', '4': 'Four times daily', 'SOS': 'As needed (SOS)'};
            const freqLabel = freqMap[safeStr(med.frequency)] || safeStr(med.frequency);
            s = s ? `${s}\n(${freqLabel})` : freqLabel;
          } else if (intervalLabel) {
            s = s ? `${s}\n(${intervalLabel})` : intervalLabel;
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
          const instrH = hasAnyMedInstr ? doc.heightOfString(instrStr, { width: col.instr.w - 8 }) : 0;
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
        if (hasAnyMedInstr) {
          doc.text('Instructions',    col.instr.x + 4, y + 4.5, { width: col.instr.w - 8 });
        }

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        divCols.forEach(cx => {
          doc.moveTo(cx, y).lineTo(cx, y + 18).stroke();
        });
        y += 18;

        // Data rows
        meds.forEach((med, idx) => {
          doc.font('Helvetica').fontSize(8.5);
          const instrStr = buildInstrStr(med);
          const instrH = hasAnyMedInstr ? doc.heightOfString(instrStr, { width: col.instr.w - 8 }) : 0;
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

          if (hasAnyMedInstr) {
            doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
              .text(instrStr, col.instr.x + 4, rowY + 5, { width: col.instr.w - 8 });
          }

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          divCols.forEach(cx => {
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
        const buildCondStr = (inv) => {
          const parts = [];
          if (inv.priority) parts.push(`Priority: ${safeStr(inv.priority).toUpperCase()}`);
          if (inv.fasting) parts.push(`Fasting: ${safeStr(inv.fasting)}`);
          return parts.length > 0 ? parts.join('\n') : 'Routine';
        };

        const hasAnyInvInstr = invList.some(inv => {
          const ins = safeStr(inv.specialInstructions);
          return ins && ins !== '-' && ins.toLowerCase() !== 'none';
        });

        const invCol = hasAnyInvInstr ? {
          num:    { x: M, w: 28 },
          name:   { x: M + 28, w: 150 },
          cond:   { x: M + 178, w: 105 },
          reason: { x: M + 283, w: 110 },
          instr:  { x: M + 393, w: CW - 393 }
        } : {
          num:    { x: M, w: 28 },
          name:   { x: M + 28, w: 200 },
          cond:   { x: M + 228, w: 135 },
          reason: { x: M + 363, w: CW - 363 }
        };

        const invDivCols = hasAnyInvInstr
          ? [M, invCol.name.x, invCol.cond.x, invCol.reason.x, invCol.instr.x, PW - M]
          : [M, invCol.name.x, invCol.cond.x, invCol.reason.x, PW - M];

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
          const instrH = hasAnyInvInstr ? doc.heightOfString(instrStr, { width: invCol.instr.w - 8 }) : 0;

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
        if (hasAnyInvInstr) {
          doc.text('Special Instructions', invCol.instr.x + 4,  y + 4.5, { width: invCol.instr.w - 8 });
        }

        doc.strokeColor(C.primary).lineWidth(0.6);
        doc.moveTo(M, y).lineTo(PW - M, y).stroke();
        doc.moveTo(M, y + 18).lineTo(PW - M, y + 18).stroke();
        invDivCols.forEach(cx => {
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
          const instrH = hasAnyInvInstr ? doc.heightOfString(instrStr, { width: invCol.instr.w - 8 }) : 0;

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

          if (hasAnyInvInstr) {
            doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
              .text(instrStr, invCol.instr.x + 4, rowY + 5, { width: invCol.instr.w - 8 });
          }

          doc.strokeColor(C.border).lineWidth(0.3);
          doc.moveTo(M, rowY + rowH).lineTo(PW - M, rowY + rowH).stroke();
          invDivCols.forEach(cx => {
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

/**
 * Generate official Indian Clinical "Bill of Supply" or "Tax Invoice" PDF
 * @param {Object} bill - Bill data object with items and payments
 * @param {Object} doctor - Attending doctor user record
 * @param {Object} patient - Patient user record
 * @returns {Promise<Buffer>}
 */
async function generateBillPDF(bill, doctor = {}, patient = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 30, bottom: 30, left: 35, right: 35 },
        bufferPages: true,
        autoFirstPage: true
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const PW = 595.28;
      const PH = 841.89;
      const M = 35;
      const CW = PW - 2 * M; // 525.28

      const isExempt = bill.gstType === 'exempt' || !bill.gstRate || bill.gstRate === 0;
      const docTitle = isExempt ? 'BILL OF SUPPLY' : 'TAX INVOICE';
      const docSub = isExempt ? '(Issued under Section 31(3)(c) of CGST Act - Healthcare SAC 999312)' : '(Tax Invoice under Section 31 of CGST Act)';

      // Colors
      const primaryColor = '#0E3B33';
      const accentColor = '#00C896';
      const textColor = '#1F2937';
      const mutedColor = '#6B7280';
      const bgCard = '#F3F4F6';

      let y = 35;

      // ─── 1. TOP CLINIC / DOCTOR HEADER ─────
      // Doctor & Clinic Name
      const clinicName = doctor.clinicName || 'MEDIZO HEALTHCARE CLINIC';
      const docName = `Dr. ${doctor.firstName || ''} ${doctor.lastName || ''}`.trim() || 'Attending Physician';
      const docSpec = doctor.specialization || 'General Practitioner';
      const docReg = doctor.licenseNumber || doctor.registrationNumber ? `Reg No: ${doctor.licenseNumber || doctor.registrationNumber}` : '';
      const clinicAddr = doctor.clinicAddress || doctor.address || 'India';
      const clinicPhone = doctor.phone || doctor.contactNumber || '';

      doc.font('Helvetica-Bold').fontSize(14).fillColor(primaryColor).text(clinicName, M, y, { width: 330 });
      y += 18;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(textColor).text(docName, M, y, { width: 330 });
      y += 14;
      doc.font('Helvetica').fontSize(9).fillColor(mutedColor).text(`${docSpec}${docReg ? ' | ' + docReg : ''}`, M, y, { width: 330 });
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor(mutedColor).text(`${clinicAddr}${clinicPhone ? ' | Ph: ' + clinicPhone : ''}`, M, y, { width: 330 });

      // Title & Invoice Meta Box (Right aligned)
      const rBoxX = PW - M - 160;
      let rY = 35;
      doc.rect(rBoxX, rY, 160, 65).fillColor(bgCard).fill();
      doc.rect(rBoxX, rY, 160, 65).strokeColor('#E5E7EB').lineWidth(1).stroke();

      doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryColor).text(docTitle, rBoxX, rY + 8, { width: 160, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(textColor).text(`Bill #: ${bill.billNumber || 'N/A'}`, rBoxX + 10, rY + 26);
      doc.font('Helvetica').fontSize(8).fillColor(mutedColor).text(`Date: ${bill.createdAt ? new Date(bill.createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN')}`, rBoxX + 10, rY + 38);
      
      const statusText = (bill.status || 'draft').toUpperCase();
      const statusColor = bill.status === 'paid' ? '#059669' : (bill.status === 'partially_paid' ? '#D97706' : '#2563EB');
      doc.font('Helvetica-Bold').fontSize(8).fillColor(statusColor).text(`Status: ${statusText}`, rBoxX + 10, rY + 50);

      y = Math.max(y + 20, 115);
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      y += 10;

      // ─── 2. PATIENT DETAILS ─────
      doc.rect(M, y, CW, 46).fillColor('#F9FAFB').fill();
      doc.rect(M, y, CW, 46).strokeColor('#E5E7EB').lineWidth(0.8).stroke();

      const patName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Valued Patient';
      const patId = bill.patientDisplayId || (patient.id ? `PT-${patient.id.substring(0, 6).toUpperCase()}` : 'N/A');
      const patAge = patient.dateOfBirth || patient.age ? `Age: ${patient.age || 'N/A'}` : '';
      const patGender = patient.gender ? `Gender: ${patient.gender}` : '';
      const patPhone = patient.phone || patient.contactNumber ? `Phone: ${patient.phone || patient.contactNumber}` : '';

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(mutedColor).text('PATIENT INFORMATION', M + 10, y + 6);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(textColor).text(patName, M + 10, y + 18);
      doc.font('Helvetica').fontSize(8.5).fillColor(mutedColor).text(`Patient ID: ${patId}`, M + 10, y + 31);

      doc.font('Helvetica').fontSize(8.5).fillColor(mutedColor).text(`${patAge} ${patGender ? '| ' + patGender : ''}`, M + 260, y + 18);
      doc.font('Helvetica').fontSize(8.5).fillColor(mutedColor).text(patPhone, M + 260, y + 31);

      if (doctor.clinicGstin) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(primaryColor).text(`Doc GSTIN: ${doctor.clinicGstin}`, M + 390, y + 18);
      }
      if (bill.patientGstin) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(primaryColor).text(`Pat GSTIN: ${bill.patientGstin}`, M + 390, y + 31);
      }

      y += 56;

      // ─── 3. ITEM TABLE HEADER ─────
      const colX = { no: M, desc: M + 25, sac: M + 255, qty: M + 315, rate: M + 355, disc: M + 415, amt: M + 465 };
      
      doc.rect(M, y, CW, 20).fillColor(primaryColor).fill();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
      doc.text('#', colX.no + 4, y + 6);
      doc.text('Service / Medical Item Description', colX.desc, y + 6);
      doc.text('SAC / HSN', colX.sac, y + 6);
      doc.text('Qty', colX.qty, y + 6, { align: 'center', width: 30 });
      doc.text('Rate (₹)', colX.rate, y + 6, { align: 'right', width: 50 });
      doc.text('Disc (₹)', colX.disc, y + 6, { align: 'right', width: 45 });
      doc.text('Amount (₹)', colX.amt, y + 6, { align: 'right', width: 55 });

      y += 20;

      // ─── 4. LINE ITEMS ─────
      const items = Array.isArray(bill.items) && bill.items.length > 0 ? bill.items : [
        { description: 'Doctor Consultation', hsnSacCode: '999312', quantity: 1, unitPrice: bill.subtotal || bill.totalAmount || 500, discountAmount: bill.discount || 0, totalPrice: bill.totalAmount || 500 }
      ];

      items.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(M, y, CW, 20).fillColor(rowBg).fill();
        doc.rect(M, y, CW, 20).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

        doc.font('Helvetica').fontSize(8).fillColor(textColor);
        doc.text(String(idx + 1), colX.no + 4, y + 6);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textColor).text(item.description || 'Medical Service', colX.desc, y + 6, { width: 225, ellipsis: true });
        doc.font('Helvetica').fontSize(8).fillColor(mutedColor).text(item.hsnSacCode || '999312', colX.sac, y + 6);
        doc.text(String(item.quantity || 1), colX.qty, y + 6, { align: 'center', width: 30 });
        doc.text(Number(item.unitPrice || 0).toFixed(2), colX.rate, y + 6, { align: 'right', width: 50 });
        doc.text(Number(item.discountAmount || 0).toFixed(2), colX.disc, y + 6, { align: 'right', width: 45 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(textColor).text(Number(item.totalPrice || 0).toFixed(2), colX.amt, y + 6, { align: 'right', width: 55 });

        y += 20;
      });

      y += 10;

      // ─── 5. SUMMARY & GST TAX BREAKDOWN ─────
      const sumX = PW - M - 200;
      doc.rect(sumX, y, 200, 110).fillColor('#F9FAFB').fill();
      doc.rect(sumX, y, 200, 110).strokeColor('#E5E7EB').lineWidth(0.8).stroke();

      let sY = y + 8;
      const addSummaryLine = (label, val, isBold = false, color = textColor) => {
        doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(isBold ? 9.5 : 8.5).fillColor(color);
        doc.text(label, sumX + 10, sY);
        doc.text(`₹ ${Number(val || 0).toFixed(2)}`, sumX + 100, sY, { align: 'right', width: 90 });
        sY += 14;
      };

      addSummaryLine('Gross Subtotal:', bill.subtotal || bill.totalAmount);
      if (Number(bill.discount) > 0) {
        addSummaryLine('Discount / Concession:', -Number(bill.discount), false, '#DC2626');
      }
      if (!isExempt && Number(bill.tax) > 0) {
        if (bill.gstType === 'cgst_sgst') {
          addSummaryLine(`CGST (${(Number(bill.gstRate) || 18)/2}%):`, bill.cgstAmount || (Number(bill.tax)/2));
          addSummaryLine(`SGST (${(Number(bill.gstRate) || 18)/2}%):`, bill.sgstAmount || (Number(bill.tax)/2));
        } else {
          addSummaryLine(`IGST (${Number(bill.gstRate) || 18}%):`, bill.igstAmount || bill.tax);
        }
      }
      
      doc.moveTo(sumX + 8, sY).lineTo(sumX + 192, sY).strokeColor('#D1D5DB').lineWidth(0.8).stroke();
      sY += 6;
      addSummaryLine('Total Payable (INR):', bill.totalAmount, true, primaryColor);
      addSummaryLine('Amount Paid:', bill.amountPaid || (bill.status === 'paid' ? bill.totalAmount : 0), false, '#059669');
      addSummaryLine('Balance Due:', bill.balanceDue || (bill.status === 'paid' ? 0 : bill.totalAmount), true, Number(bill.balanceDue) > 0 ? '#DC2626' : '#059669');

      // Left Box: UPI QR Code & Notes
      const lBoxW = CW - 215;
      doc.rect(M, y, lBoxW, 110).fillColor('#F9FAFB').fill();
      doc.rect(M, y, lBoxW, 110).strokeColor('#E5E7EB').lineWidth(0.8).stroke();

      if (bill.upiQrData || doctor.clinicUpiVpa) {
        const upiUri = bill.upiQrData || `upi://pay?pa=${doctor.clinicUpiVpa}&pn=${encodeURIComponent(docName)}&am=${bill.balanceDue || bill.totalAmount}&cu=INR`;
        drawVectorQr(doc, upiUri, M + 10, y + 10, 68, primaryColor, '#FFFFFF');
        
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(primaryColor).text('Scan to Pay via UPI', M + 88, y + 15);
        doc.font('Helvetica').fontSize(7.5).fillColor(mutedColor).text('Supports GPay, PhonePe, Paytm, BHIM', M + 88, y + 27);
        if (doctor.clinicUpiVpa) {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(textColor).text(`UPI ID: ${doctor.clinicUpiVpa}`, M + 88, y + 39);
        }
      } else {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(mutedColor).text('PAYMENT NOTES & REMARKS', M + 10, y + 15);
        doc.font('Helvetica').fontSize(8).fillColor(textColor).text(bill.notes || 'Healthcare clinical services consultation.', M + 10, y + 30, { width: lBoxW - 20 });
      }

      if (isExempt) {
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(mutedColor)
          .text('Note: Healthcare clinical services by authorized medical practitioner are exempt from GST under SAC 999312.', M + 10, y + 88, { width: lBoxW - 20 });
      }

      y += 125;

      // ─── 6. PAYMENT TRANSACTIONS LEDGER (IF ANY) ─────
      if (Array.isArray(bill.payments) && bill.payments.length > 0) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(primaryColor).text('PAYMENT TRANSACTIONS AUDIT', M, y);
        y += 12;
        bill.payments.forEach(p => {
          doc.font('Helvetica').fontSize(7.5).fillColor(mutedColor)
            .text(`• Paid ₹${Number(p.amountPaid).toFixed(2)} via ${(p.paymentMode || 'cash').toUpperCase()} on ${p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : 'N/A'}${p.upiTransactionRef ? ' (Ref: ' + p.upiTransactionRef + ')' : ''}${p.receiptNumber ? ' | Receipt: ' + p.receiptNumber : ''}`, M, y);
          y += 10;
        });
        y += 10;
      }

      // ─── 7. DOCTOR SIGNATURE & FOOTER ─────
      const sigX = PW - M - 120;
      doc.moveTo(sigX, PH - 70).lineTo(PW - M, PH - 70).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(textColor).text('Authorized Signatory / Stamp', sigX, PH - 62, { width: 120, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor(mutedColor).text(docName, sigX, PH - 52, { width: 120, align: 'center' });

      // Absolute Footer on all pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fY = PH - 25;
        doc.moveTo(M, fY).lineTo(PW - M, fY).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(mutedColor)
          .text('This is a computer-generated medical bill issued by Medizo Healthcare. For online verification visit medizo.life', M, fY + 6, {
            width: CW,
            align: 'center'
          });
      }

      doc.end();
    } catch (err) {
      console.error('generateBillPDF error:', err);
      reject(err);
    }
  });
}

module.exports = { generatePrescriptionPDF, generateBillPDF };

