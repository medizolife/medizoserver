const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { auth, doctor } = require('../middleware/auth');
const { findUserById, updateUser, isMongoConnected } = require('../models/user');

// Try to import the Mongoose UserModel for direct updates
let UserModel;
try {
  UserModel = require('../models/UserModel');
} catch (e) {
  UserModel = null;
}

/**
 * @route   GET /api/digilocker/authorize
 * @desc    Build DigiLocker OAuth2 authorization URL with PKCE and redirect
 * @access  Private (Doctor only)
 *
 * Adapted from cluso-candidates reference implementation.
 * Uses an HTML interstitial to ensure cookies are stored before cross-domain redirect.
 */
router.get('/authorize', doctor, (req, res) => {
  const clientId = process.env.DIGILOCKER_CLIENT_ID || '';
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || '';
  const baseUrl = process.env.DIGILOCKER_BASE_URL || 'https://digilocker.meripehchaan.gov.in';

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: 'DigiLocker is not configured. Please set DIGILOCKER_CLIENT_ID and DIGILOCKER_REDIRECT_URI in server .env.'
    });
  }

  // Generate CSRF state, nonce, and PKCE code_verifier
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Store the doctor's user ID in the state so the callback can identify them
  // Format: randomState|userId
  const stateWithUser = `${state}|${req.user.id}`;

  // DigiLocker OAuth2 authorization URL parameters
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: stateWithUser,
    scope: 'openid',
    nonce: nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${baseUrl}/public/oauth2/1/authorize?${params.toString()}`;

  // Set cookies for state verification in callback
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600000, // 10 minutes in ms
    path: '/',
  };

  res.cookie('digilocker_state', stateWithUser, cookieOptions);
  res.cookie('digilocker_code_verifier', codeVerifier, cookieOptions);
  res.cookie('digilocker_nonce', nonce, cookieOptions);

  // Return an HTML interstitial that stores cookies before redirecting
  // This prevents cookie loss on cross-domain redirects (same approach as reference project)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting to DigiLocker...</title>
  <meta http-equiv="refresh" content="2;url=${authUrl}">
  <style>
    body { display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; }
    .loader { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #3f51b5; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #64748b; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Redirecting to DigiLocker for verification...</p>
  </div>
  <script>
    setTimeout(function() { window.location.href = ${JSON.stringify(authUrl)}; }, 500);
  </script>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * @route   GET /api/digilocker/callback
 * @desc    Handle DigiLocker OAuth2 callback — exchange code for token, save profile
 * @access  Public (DigiLocker redirects here)
 *
 * Adapted from cluso-candidates reference implementation.
 */
router.get('/callback', async (req, res) => {
  const baseUrl = process.env.DIGILOCKER_BASE_URL || 'https://digilocker.meripehchaan.gov.in';
  const clientId = process.env.DIGILOCKER_CLIENT_ID || '';
  const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET || '';
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || '';
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

  const { code, state, error, error_description } = req.query;

  console.log('[DigiLocker] Callback hit. code:', !!code, 'state:', !!state);

  // If user denied access or DigiLocker returned an error
  if (error) {
    const msg = error_description || error || 'Authorization denied';
    console.error('[DigiLocker] Auth error from DigiLocker:', msg);
    return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=${encodeURIComponent(msg)}`);
  }

  if (!code || !state) {
    console.error('[DigiLocker] Missing code or state');
    return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=Missing+authorization+code`);
  }

  // Validate state against cookie
  const storedState = req.cookies?.digilocker_state;
  console.log('[DigiLocker] State check — stored:', storedState ? 'present' : 'MISSING', 'received:', state ? 'present' : 'MISSING', 'match:', storedState === state);

  if (!storedState || storedState !== state) {
    console.error('[DigiLocker] State mismatch! Cookie state:', storedState, 'URL state:', state);
    return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=Invalid+state+parameter+(cookies+may+have+been+lost)`);
  }

  // Extract userId from state (format: randomState|userId)
  const userId = state.split('|')[1];
  if (!userId) {
    console.error('[DigiLocker] No userId in state');
    return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=Invalid+state+format`);
  }

  // Retrieve PKCE code_verifier from cookie
  const codeVerifier = req.cookies?.digilocker_code_verifier || '';

  try {
    // ── Step 1: Exchange code for token (with PKCE) ──
    const tokenParams = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const tokenResponse = await fetch(`${baseUrl}/public/oauth2/2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error('[DigiLocker] Token exchange failed:', tokenResponse.status, tokenError);
      return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=Token+exchange+failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('[DigiLocker] No access_token in response:', tokenData);
      return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=No+access+token+received`);
    }

    // ── Step 2: Extract user info from id_token and token response ──
    let user = {};

    // Source 1: Decode the id_token JWT
    if (tokenData.id_token) {
      try {
        const parts = tokenData.id_token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString()
          );
          console.log('[DigiLocker] id_token claims:', JSON.stringify(payload, null, 2));
          user = {
            name: payload.given_name || payload.name || payload.preferred_username || '',
            dob: payload.birthdate || payload.dob || '',
            gender: payload.gender || '',
            email: payload.email || '',
            mobile: payload.phone_number || payload.mobile || '',
            maskedAadhaar: payload.masked_aadhaar || '',
            digilockerid: payload.digilockerid || payload.sub || '',
            referenceKey: payload.reference_key || '',
            panNumber: payload.pan_number || '',
            drivingLicence: payload.driving_licence || '',
          };
        }
      } catch (jwtErr) {
        console.error('[DigiLocker] Could not decode id_token:', jwtErr);
      }
    }

    // Source 2: Token response top-level fields
    if (tokenData.name) user.name = tokenData.name;
    if (tokenData.dob) user.dob = tokenData.dob;
    if (tokenData.gender) user.gender = tokenData.gender;
    if (tokenData.email) user.email = tokenData.email;
    if (tokenData.mobile) user.mobile = tokenData.mobile;
    if (tokenData.digilockerid) user.digilockerid = tokenData.digilockerid;
    if (tokenData.eaadhaar) user.eaadhaar = tokenData.eaadhaar;
    if (tokenData.reference_key) user.referenceKey = tokenData.reference_key;

    // Source 3: Try the /user API
    try {
      const userResponse = await fetch(`${baseUrl}/public/oauth2/1/user`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userResponse.ok) {
        const apiUser = await userResponse.json();
        console.log('[DigiLocker] User API response:', JSON.stringify(apiUser, null, 2));
        if (apiUser.name) user.name = apiUser.name;
        if (apiUser.dob || apiUser.birthdate) user.dob = apiUser.dob || apiUser.birthdate;
        if (apiUser.gender) user.gender = apiUser.gender;
        if (apiUser.email) user.email = apiUser.email;
        if (apiUser.mobile || apiUser.phone_number) user.mobile = apiUser.mobile || apiUser.phone_number;
        if (apiUser.digilockerid) user.digilockerid = apiUser.digilockerid;
      } else {
        console.log('[DigiLocker] User API failed (expected with openid scope):', userResponse.status);
      }
    } catch (userErr) {
      console.log('[DigiLocker] User API error:', userErr);
    }

    // ── Step 3: Save DigiLocker profile to user document ──
    const digilockerProfile = {
      verified: true,
      name: user.name || '',
      dob: user.dob || '',
      gender: user.gender || '',
      email: user.email || '',
      mobile: user.mobile || '',
      maskedAadhaar: user.maskedAadhaar || '',
      digilockerid: user.digilockerid || '',
      referenceKey: user.referenceKey || '',
      eaadhaar: user.eaadhaar || '',
      panNumber: user.panNumber || '',
      drivingLicence: user.drivingLicence || '',
      linkedAt: new Date(),
    };

    console.log('[DigiLocker] Saving profile for doctor:', userId);

    // Update using Mongoose model directly if available
    if (isMongoConnected() && UserModel) {
      try {
        await UserModel.updateOne(
          { _id: userId },
          {
            $set: {
              digilockerVerified: true,
              digilockerProfile: digilockerProfile
            }
          }
        );
        console.log('[DigiLocker] Profile saved via Mongoose');
      } catch (mongoErr) {
        console.error('[DigiLocker] Mongoose update error:', mongoErr);
        // Fallback to user.js updateUser
        await updateUser(userId, {
          digilockerVerified: true,
          digilockerProfile: digilockerProfile
        });
      }
    } else {
      // Fallback to JSON file storage
      await updateUser(userId, {
        digilockerVerified: true,
        digilockerProfile: digilockerProfile
      });
    }

    // ── Step 4: Clear cookies and redirect ──
    res.clearCookie('digilocker_state');
    res.clearCookie('digilocker_code_verifier');
    res.clearCookie('digilocker_nonce');

    console.log('[DigiLocker] Verification complete, redirecting to dashboard');
    return res.redirect(`${clientUrl}/dashboard?digilocker=success`);

  } catch (err) {
    console.error('[DigiLocker] Callback error:', err);
    return res.redirect(`${clientUrl}/dashboard?digilocker=error&message=Internal+server+error`);
  }
});

/**
 * @route   GET /api/digilocker/status
 * @desc    Get current doctor's DigiLocker verification status
 * @access  Private (Doctor only)
 */
router.get('/status', doctor, async (req, res) => {
  try {
    const doctorId = req.user.id;

    // Check if user has digilockerVerified field
    if (isMongoConnected() && UserModel) {
      try {
        const user = await UserModel.findById(doctorId).select('digilockerVerified digilockerProfile').lean();
        if (user) {
          return res.json({
            verified: user.digilockerVerified || false,
            profile: user.digilockerProfile || null
          });
        }
      } catch (mongoErr) {
        console.error('[DigiLocker] Status MongoDB error:', mongoErr);
      }
    }

    // Fallback: check from user.js
    const user = await findUserById(doctorId);
    if (!user) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    return res.json({
      verified: user.digilockerVerified || false,
      profile: user.digilockerProfile || null
    });

  } catch (error) {
    console.error('[DigiLocker] Status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
