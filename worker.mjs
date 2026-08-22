// Polyfill globals for modules that expect Node.js CJS globals
if (typeof globalThis.__dirname === 'undefined') {
  globalThis.__dirname = '/';
}
if (typeof globalThis.__filename === 'undefined') {
  globalThis.__filename = '/index.js';
}

import http from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from './api/index.js';

const server = http.createServer(app);
const nodeHandler = httpServerHandler(server);

export default {
  async fetch(request, env, ctx) {
    if (env) {
      if (env.DB) {
        globalThis.__D1_DB__ = env.DB;
      }
      if (env.JWT_SECRET) process.env.JWT_SECRET = env.JWT_SECRET;
      if (env.CLIENT_URL) process.env.CLIENT_URL = env.CLIENT_URL;
      if (env.CLOUDFLARE_ACCOUNT_ID) process.env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
      if (env.CLOUDFLARE_D1_DATABASE_ID) process.env.CLOUDFLARE_D1_DATABASE_ID = env.CLOUDFLARE_D1_DATABASE_ID;
      if (env.DIGILOCKER_CLIENT_ID) process.env.DIGILOCKER_CLIENT_ID = env.DIGILOCKER_CLIENT_ID;
      if (env.DIGILOCKER_CLIENT_SECRET) process.env.DIGILOCKER_CLIENT_SECRET = env.DIGILOCKER_CLIENT_SECRET;
      if (env.DIGILOCKER_REDIRECT_URI) process.env.DIGILOCKER_REDIRECT_URI = env.DIGILOCKER_REDIRECT_URI;
      if (env.DIGILOCKER_BASE_URL) process.env.DIGILOCKER_BASE_URL = env.DIGILOCKER_BASE_URL;
    }
    if (typeof nodeHandler === 'function') {
      return nodeHandler(request, env, ctx);
    }
    return nodeHandler.fetch(request, env, ctx);
  }
};
