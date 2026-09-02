/**
 * Cloudflare D1 HTTP REST API Client
 * 
 * Provides a lightweight wrapper around the Cloudflare D1 REST API
 * for executing SQL queries from outside Cloudflare Workers (e.g. Vercel).
 * 
 * Endpoint: POST /client/v4/accounts/{account_id}/d1/database/{database_id}/query
 */

function getD1Config() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '';
  return { accountId, apiToken, dbId };
}

/**
 * Check if D1 credentials or native binding are configured
 * @returns {boolean}
 */
function isD1Configured() {
  if (globalThis.__D1_DB__ || globalThis.DB) return true;
  const { accountId, apiToken, dbId } = getD1Config();
  return Boolean(accountId && apiToken && dbId);
}

/**
 * Execute a single SQL query against D1
 * @param {string} sql - The SQL query to execute
 * @param {Array} params - Bound parameters for the query
 * @returns {Promise<{results: Array, meta: Object}>} Query results
 */
async function queryD1(sql, params = []) {
  // 1. Prefer native Cloudflare Worker D1 binding (0 HTTP subrequests, zero latency)
  const nativeDb = globalThis.__D1_DB__ || globalThis.DB;
  if (nativeDb && typeof nativeDb.prepare === 'function') {
    try {
      const stmt = (params && params.length > 0)
        ? nativeDb.prepare(sql).bind(...params)
        : nativeDb.prepare(sql);
      const res = await stmt.all();
      return {
        results: res.results || [],
        meta: res.meta || {}
      };
    } catch (nativeErr) {
      console.error('Native D1 query error:', nativeErr.message, '| SQL:', sql.substring(0, 100));
      throw nativeErr;
    }
  }

  // 2. Fallback to Cloudflare D1 REST API (for external environments like Vercel or local Node)
  const { accountId, apiToken, dbId } = getD1Config();
  if (!accountId || !dbId) {
    throw new Error('Cloudflare D1 credentials not configured.');
  }

  const d1ApiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}`;

  try {
    const response = await fetch(`${d1ApiBase}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data.errors?.map(e => e.message).join(', ') || `D1 API error (HTTP ${response.status})`;
      console.error('D1 query error:', errorMsg, '| SQL:', sql.substring(0, 100));
      throw new Error(errorMsg);
    }

    // D1 returns results as an array of result sets; take the first one
    const resultSet = data.result?.[0] || { results: [], meta: {} };
    return {
      results: resultSet.results || [],
      meta: resultSet.meta || {}
    };
  } catch (error) {
    if (error.message?.includes('D1') || error.message?.includes('credentials')) {
      throw error;
    }
    console.error('D1 network error:', error.message);
    throw new Error(`D1 connection failed: ${error.message}`);
  }
}

/**
 * Execute multiple SQL statements in a batch
 * Useful for migrations and multi-statement operations
 * @param {Array<{sql: string, params?: Array}>} statements - Array of SQL statements
 * @returns {Promise<Array<{results: Array, meta: Object}>>} Array of result sets
 */
async function batchD1(statements) {
  if (!isD1Configured()) {
    throw new Error('Cloudflare D1 credentials not configured.');
  }

  // D1 REST API doesn't have a native batch endpoint,
  // so we execute statements sequentially
  const results = [];
  for (const stmt of statements) {
    const result = await queryD1(stmt.sql, stmt.params || []);
    results.push(result);
  }
  return results;
}

/**
 * Check if D1 is reachable by running a simple query
 * @returns {Promise<boolean>}
 */
async function isD1Connected() {
  if (!isD1Configured()) return false;
  try {
    await queryD1('SELECT 1');
    return true;
  } catch (error) {
    console.error('D1 connection check failed:', error.message);
    return false;
  }
}

/**
 * Execute raw SQL (convenience for schema migrations)
 * Splits multi-statement SQL by semicolons, respecting parentheses nesting
 * so CREATE TABLE (...) statements don't get broken mid-definition.
 * @param {string} rawSql - Raw SQL string potentially containing multiple statements
 * @returns {Promise<void>}
 */
async function execRawSQL(rawSql) {
  // Remove SQL comments (lines starting with --)
  const cleaned = rawSql.replace(/--[^\n]*/g, '').trim();
  
  // Split by semicolons that are NOT inside parentheses
  const statements = [];
  let current = '';
  let depth = 0;
  
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = '';
      continue;
    }
    current += ch;
  }
  // Don't forget the last statement if no trailing semicolon
  const last = current.trim();
  if (last.length > 0) statements.push(last);

  for (const sql of statements) {
    try {
      await queryD1(sql);
    } catch (error) {
      // Ignore "already exists" errors during migrations
      if (!error.message?.includes('already exists')) {
        console.error('Migration statement failed:', sql.substring(0, 80), error.message);
      }
    }
  }
}

module.exports = {
  queryD1,
  batchD1,
  isD1Connected,
  isD1Configured,
  execRawSQL
};
