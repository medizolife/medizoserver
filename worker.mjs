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

export default httpServerHandler(server);
