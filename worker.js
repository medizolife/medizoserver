const { httpServerHandler } = require('cloudflare:node');
const app = require('./api/index.js');

module.exports = httpServerHandler(app);
