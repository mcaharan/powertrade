const mysql = require('mysql2');
require('dotenv').config();

function createMockPool() {
  const warn = (msg) => console.warn('[DB-FALLBACK]', msg);
  warn('MySQL not available, using mock data.');

  const query = async (sql) => {
    const text = String(sql || '');

    if (/SELECT\s+1/i.test(text)) {
      return [[{ 1: 1 }], []];
    }

    if (/COUNT\(/i.test(text)) {
      const aliases = [...text.matchAll(/AS\s+([a-zA-Z_][\w]*)/gi)].map((m) => m[1]);
      const values = {
        totalUsers: 1,
        totalTrades: 3,
        openOrders: 1,
        totalVolume: 12345.67,
        cnt: 3,
        pending: 1,
        accepted: 1,
        filled: 1,
        cancelled: 0,
        failed: 0,
        total: 3,
      };
      const row = aliases.length
        ? Object.fromEntries(aliases.map((alias) => [alias, values[alias] ?? 0]))
        : { cnt: values.cnt };
      return [[row], []];
    }

    if (/SUM\(/i.test(text)) {
      const aliases = [...text.matchAll(/AS\s+([a-zA-Z_][\w]*)/gi)].map((m) => m[1]);
      const row = aliases.length
        ? Object.fromEntries(aliases.map((alias) => [alias, 12345.67]))
        : [{ total: 12345.67 }];
      return [[row], []];
    }

    if (/FROM\s+users/i.test(text)) {
      return [[
        { id: 1, name: 'Admin', email: 'admin@powertrade.io', role: 'admin', created_at: new Date().toISOString() },
      ], []];
    }

    if (/FROM\s+trades/i.test(text)) {
      return [[
        { id: 101, user_id: 1, symbol: 'NIFTY', side: 'BUY', quantity: 1, price: 245.5, total: 245.5, status: 'FILLED', created_at: new Date().toISOString(), user_name: 'Admin' },
        { id: 102, user_id: 1, symbol: 'BANKNIFTY', side: 'SELL', quantity: 2, price: 182.25, total: 364.5, status: 'OPEN', created_at: new Date().toISOString(), user_name: 'Admin' },
      ], []];
    }

    if (/FROM\s+portfolio/i.test(text)) {
      return [[
        { id: 1, user_id: 1, symbol: 'NIFTY', quantity: 1, avg_price: 245.5, user_name: 'Admin' },
      ], []];
    }

    if (/FROM\s+angelone_accounts/i.test(text)) {
      return [[
        { id: 1, label: 'Primary Account', client_code: 'PT1001', api_key: 'mock-key', connected: 1, connected_at: new Date().toISOString(), created_at: new Date().toISOString() },
      ], []];
    }

    if (/FROM\s+trade_setups/i.test(text)) {
      return [[
        { id: 1, account_id: 1, segment_name: 'NIFTY', instrument_type: 'INDEX', lot_size: 1, default_qty: 1, is_active: 1, created_at: new Date().toISOString() },
      ], []];
    }

    if (/FROM\s+orders/i.test(text)) {
      return [[
        { id: 201, account_id: 1, setup_id: 1, segment_name: 'NIFTY', side: 'BUY', quantity: 1, price: 245.5, order_type: 'MARKET', status: 'PENDING', created_at: new Date().toISOString(), account_label: 'Primary Account' },
      ], []];
    }

    if (/FROM\s+strategies/i.test(text)) {
      return [[
        { id: 1, account_id: 1, name: 'Mock Strategy', description: 'Fallback strategy', is_active: 1, created_at: new Date().toISOString() },
      ], []];
    }

    return [[], []];
  };

  return {
    query,
    execute: query,
    promise() {
      return this;
    },
  };
}

const realPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'powertrade',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}).promise();

const mockPool = createMockPool();

module.exports = {
  async query(sql, params) {
    try {
      return await realPool.query(sql, params);
    } catch (err) {
      console.warn('[DB] query failed, using mock:', err?.message || err);
      return mockPool.query(sql, params);
    }
  },
  async execute(sql, params) {
    try {
      return await realPool.execute(sql, params);
    } catch (err) {
      console.warn('[DB] execute failed, using mock:', err?.message || err);
      return mockPool.execute(sql, params);
    }
  },
  promise() {
    return this;
  },
};
