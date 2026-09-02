const rateLimit = require('express-rate-limit');

/**
 * Standard key generator with Cloudflare / reverse-proxy IP fallback
 */
const getClientIp = (req) => {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    req.ip ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );
};

// 1. General API limiter (300 requests per minute)
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false },
  message: {
    message: 'Too many requests from this IP, please try again after a minute.'
  }
});

// 2. Auth limiter for login endpoints (15 requests per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false },
  message: {
    message: 'Too many login attempts. Please try again after 15 minutes.'
  }
});

// 3. OTP generation limiter (5 OTP requests per 10 minutes)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false },
  message: {
    message: 'Too many OTP requests. Please wait 10 minutes before requesting a new code.'
  }
});

// 4. OTP verification limiter (10 attempts per 10 minutes)
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false },
  message: {
    message: 'Too many failed verification attempts. Please request a new OTP code.'
  }
});

// 5. Public prescription / QR code lookup limiter (60 requests per minute)
const publicLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false },
  message: {
    message: 'Lookup rate limit exceeded. Please try again in a few moments.'
  }
});

module.exports = {
  generalApiLimiter,
  authLimiter,
  otpLimiter,
  otpVerifyLimiter,
  publicLookupLimiter
};
