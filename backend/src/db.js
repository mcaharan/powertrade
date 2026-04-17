const mysql = require('mysql2');
require('dotenv').config();

function createMockPool() {
  const warn = (msg) => console.warn('[DB-FALLBACK]', msg);
  warn('MySQL not available, using mock data.');

  const nowIso = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const toId = (value) => Number.parseInt(value, 10);

  const state = {
    nextAccountId: 2,
    nextTradeSetupId: 2,
    nextOrderId: 202,
    nextStrategyId: 2,
    angeloneAccounts: [
      {
        id: 1,
        label: 'Primary Account',
        client_code: 'PT1001',
        password_enc: 'mock-password',
        totp_secret: 'MOCKTOTP',
        api_key: 'mock-key',
        jwt_token: 'mock-jwt-token',
        refresh_token: 'mock-refresh-token',
        feed_token: 'mock-feed-token',
        connected: 1,
        connected_at: nowIso(),
        created_at: nowIso(),
      },
    ],
    tradeSetups: [
      {
        id: 1,
        account_id: 1,
        segment_name: 'NIFTY',
        instrument_type: 'INDEX',
        lot_size: 1,
        default_qty: 1,
        is_active: 1,
        created_at: nowIso(),
      },
    ],
    orders: [
      {
        id: 201,
        account_id: 1,
        setup_id: 1,
        segment_name: 'NIFTY',
        side: 'BUY',
        quantity: 1,
        price: 245.5,
        order_type: 'MARKET',
        status: 'PENDING',
        created_at: nowIso(),
        account_label: 'Primary Account',
      },
    ],
    strategies: [
      {
        id: 1,
        account_id: 1,
        name: 'Mock Strategy',
        description: 'Fallback strategy',
        is_active: 1,
        created_at: nowIso(),
      },
    ],
  };

  const projectSelectedColumns = (rows, text, tableName) => {
    const match = text.match(new RegExp(`select\\s+([\\s\\S]+?)\\s+from\\s+${tableName}`, 'i'));
    if (!match) return clone(rows);

    const rawColumns = match[1].trim();
    if (rawColumns === '*') return clone(rows);

    const columns = rawColumns
      .split(',')
      .map((column) => column.trim().replace(/`/g, ''))
      .filter(Boolean);

    return rows.map((row) => {
      const projected = {};
      for (const column of columns) {
        const aliasMatch = column.match(/^(.+?)\s+as\s+([a-zA-Z_][\w]*)$/i);
        const source = (aliasMatch ? aliasMatch[1] : column).trim();
        const target = (aliasMatch ? aliasMatch[2] : source).trim();
        if (source in row) {
          projected[target] = row[source];
        }
      }
      return projected;
    });
  };

  const result = (rows) => [rows, []];

  const query = async (sql, params = []) => {
    const text = String(sql || '').trim();

    if (/SELECT\s+1/i.test(text)) {
      return [[{ 1: 1 }], []];
    }

    if (/^(CREATE|USE)\s+/i.test(text)) {
      return [{ affectedRows: 0 }, []];
    }

    if (/^SELECT[\s\S]+FROM\s+angelone_accounts/i.test(text) && !/FROM\s+trade_setups/i.test(text)) {
      let rows = state.angeloneAccounts;
      if (/WHERE\s+id\s*=\s*\?/i.test(text)) {
        const id = toId(params[0]);
        rows = rows.filter((account) => account.id === id);
      }
      return result(projectSelectedColumns(rows, text, 'angelone_accounts'));
    }

    if (/^INSERT\s+INTO\s+angelone_accounts/i.test(text)) {
      const [label, clientCode, password, totpSecret, apiKey] = params;
      const duplicate = state.angeloneAccounts.some((account) => account.client_code === clientCode);
      if (duplicate) {
        const error = new Error('Duplicate entry');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }

      const account = {
        id: state.nextAccountId++,
        label,
        client_code: clientCode,
        password_enc: password,
        totp_secret: totpSecret,
        api_key: apiKey,
        jwt_token: null,
        refresh_token: null,
        feed_token: null,
        connected: 0,
        connected_at: null,
        created_at: nowIso(),
      };
      state.angeloneAccounts.push(account);
      return [{ insertId: account.id, affectedRows: 1 }, []];
    }

    if (/^UPDATE\s+angelone_accounts/i.test(text)) {
      const id = toId(params[params.length - 1]);
      const account = state.angeloneAccounts.find((item) => item.id === id);
      if (!account) return [{ affectedRows: 0 }, []];

      if (/jwt_token\s*=\s*NULL/i.test(text) && /connected\s*=\s*0/i.test(text)) {
        account.jwt_token = null;
        account.refresh_token = null;
        account.feed_token = null;
        account.connected = 0;
        account.connected_at = null;
      } else if (/jwt_token\s*=\s*\?/i.test(text) && /refresh_token\s*=\s*\?/i.test(text) && /feed_token\s*=\s*\?/i.test(text)) {
        account.jwt_token = params[0];
        account.refresh_token = params[1];
        account.feed_token = params[2];
        account.connected = /connected\s*=\s*1/i.test(text) ? 1 : account.connected;
        account.connected_at = nowIso();
      }

      return [{ affectedRows: 1 }, []];
    }

    if (/^DELETE\s+FROM\s+angelone_accounts/i.test(text)) {
      const id = toId(params[0]);
      const beforeCount = state.angeloneAccounts.length;
      state.angeloneAccounts = state.angeloneAccounts.filter((account) => account.id !== id);
      state.tradeSetups = state.tradeSetups.filter((setup) => setup.account_id !== id);
      state.orders = state.orders.filter((order) => order.account_id !== id);
      state.strategies = state.strategies.filter((strategy) => strategy.account_id !== id);
      return [{ affectedRows: beforeCount - state.angeloneAccounts.length }, []];
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

    if (/FROM\s+angelone_accounts/i.test(text) && !/FROM\s+trade_setups/i.test(text)) {
      return result(projectSelectedColumns(state.angeloneAccounts, text, 'angelone_accounts'));
    }

    if (/^INSERT\s+INTO\s+trade_setups/i.test(text)) {
      const [
        accountId, segmentName, instrumentType, lotSize, defaultQty, maxQty,
        maxTradesPerDay, maxLossPerDay, maxProfitPerDay,
        stopLossPoints, targetPoints, trailingStopPoints,
        tradeStartTime, tradeEndTime, notes,
      ] = params;
      const setup = {
        id: state.nextTradeSetupId++,
        account_id: toId(accountId),
        segment_name: segmentName,
        instrument_type: instrumentType || null,
        lot_size: lotSize || 1,
        default_qty: defaultQty || 1,
        max_qty: maxQty || null,
        max_trades_per_day: maxTradesPerDay || null,
        max_loss_per_day: maxLossPerDay || null,
        max_profit_per_day: maxProfitPerDay || null,
        stop_loss_points: stopLossPoints || null,
        target_points: targetPoints || null,
        trailing_stop_points: trailingStopPoints || null,
        trade_start_time: tradeStartTime || null,
        trade_end_time: tradeEndTime || null,
        is_active: 1,
        notes: notes || null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.tradeSetups.push(setup);
      return [{ insertId: setup.id, affectedRows: 1 }, []];
    }

    if (/^UPDATE\s+trade_setups/i.test(text)) {
      const id = toId(params[params.length - 1]);
      const setup = state.tradeSetups.find((s) => s.id === id);
      if (!setup) return [{ affectedRows: 0 }, []];
      // Extract SET clause column=? pairs and map them to values
      const setClauses = text.match(/SET\s+([\s\S]+?)\s+WHERE/i);
      if (setClauses) {
        const pairs = setClauses[1].split(',').map((p) => p.trim());
        pairs.forEach((pair, idx) => {
          const col = pair.replace(/\s*=\s*\?.*/, '').trim();
          if (col) setup[col] = params[idx] !== undefined ? params[idx] : null;
        });
        setup.updated_at = nowIso();
      }
      return [{ affectedRows: 1 }, []];
    }

    if (/^DELETE\s+FROM\s+trade_setups/i.test(text)) {
      const id = toId(params[0]);
      const before = state.tradeSetups.length;
      state.tradeSetups = state.tradeSetups.filter((s) => s.id !== id);
      return [{ affectedRows: before - state.tradeSetups.length }, []];
    }

    if (/FROM\s+trade_setups/i.test(text)) {
      let rows = state.tradeSetups;
      if (/WHERE\s+account_id\s*=\s*\?\s+AND\s+segment_name\s*=\s*\?/i.test(text)) {
        const accountId  = toId(params[0]);
        const segmentName = params[1];
        rows = rows.filter((s) => s.account_id === accountId && s.segment_name === segmentName);
        // Editing: exclude the setup being edited (AND id != ?)
        if (/AND\s+id\s*!=\s*\?/i.test(text)) {
          const excludeId = toId(params[2]);
          rows = rows.filter((s) => s.id !== excludeId);
        }
      } else if (/WHERE\s+account_id\s*=\s*\?/i.test(text)) {
        const accountId = toId(params[0]);
        rows = rows.filter((setup) => setup.account_id === accountId);
      } else if (/WHERE\s+id\s*=\s*\?/i.test(text)) {
        const id = toId(params[0]);
        rows = rows.filter((s) => s.id === id);
      }
      // For JOIN queries, attach account info
      if (/JOIN\s+angelone_accounts/i.test(text)) {
        rows = rows.map((s) => {
          const acc = state.angeloneAccounts.find((a) => a.id === s.account_id);
          return { ...s, label: acc?.label || '', client_code: acc?.client_code || '' };
        });
      }
      return result(clone(rows));
    }

    if (/FROM\s+orders/i.test(text)) {
      let rows = state.orders;
      if (/WHERE\s+account_id\s*=\s*\?/i.test(text)) {
        const accountId = toId(params[0]);
        rows = rows.filter((order) => order.account_id === accountId);
      }
      return result(clone(rows));
    }

    if (/FROM\s+strategies/i.test(text)) {
      let rows = state.strategies;
      if (/WHERE\s+account_id\s*=\s*\?/i.test(text)) {
        const accountId = toId(params[0]);
        rows = rows.filter((strategy) => strategy.account_id === accountId);
      }
      return result(clone(rows));
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

async function queryReal(sql, params) {
  return realPool.query(sql, params);
}

async function executeReal(sql, params) {
  return realPool.execute(sql, params);
}

async function getStatus() {
  try {
    await queryReal('SELECT 1');
    return {
      connected: true,
      mode: 'mysql',
    };
  } catch (err) {
    return {
      connected: false,
      mode: 'mock',
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  async query(sql, params) {
    try {
      return await queryReal(sql, params);
    } catch (err) {
      console.warn('[DB] query failed, using mock:', err?.message || err);
      return mockPool.query(sql, params);
    }
  },
  async execute(sql, params) {
    try {
      return await executeReal(sql, params);
    } catch (err) {
      console.warn('[DB] execute failed, using mock:', err?.message || err);
      return mockPool.execute(sql, params);
    }
  },
  async queryReal(sql, params) {
    return queryReal(sql, params);
  },
  async executeReal(sql, params) {
    return executeReal(sql, params);
  },
  async getStatus() {
    return getStatus();
  },
  promise() {
    return this;
  },
};
