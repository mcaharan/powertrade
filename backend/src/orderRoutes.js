const express = require('express');
const router = express.Router();
const db = require('./db');
const axios = require('axios');

const ANGEL_BASE_URL = 'https://apiconnect.angelone.in';

function buildAngelHeaders(account) {
  return {
    'Content-Type':     'application/json',
    Accept:             'application/json',
    Authorization:      `Bearer ${account.jwt_token}`,
    'X-PrivateKey':     account.api_key,
    'X-UserType':       'USER',
    'X-SourceID':       'WEB',
    'X-ClientLocalIP':  process.env.ANGEL_CLIENT_LOCAL_IP  || '127.0.0.1',
    'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
    'X-MACAddress':     process.env.ANGEL_MAC_ADDRESS      || '00:00:00:00:00:00',
  };
}

async function placeAngelOrder(account, { symbol, token, exchange, transactionType, orderType, productType, quantity, price }) {
  const body = {
    variety:         'NORMAL',
    tradingsymbol:   symbol,
    symboltoken:     String(token),
    transactiontype: transactionType.toUpperCase(),
    exchange:        exchange || 'NFO',
    ordertype:       (orderType || 'MARKET').toUpperCase(),
    producttype:     productType || 'INTRADAY',
    duration:        'DAY',
    price:           (orderType || 'MARKET').toUpperCase() === 'LIMIT' ? String(price || 0) : '0',
    squareoff:       '0',
    stoploss:        '0',
    quantity:        String(quantity),
  };
  const { data } = await axios.post(
    `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`,
    body,
    { headers: buildAngelHeaders(account) }
  );
  return data;
}

function parseDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mapAngelOrderStatus(status) {
  const s = String(status || '').toUpperCase();
  if (!s) return null;
  if (s.includes('REJECT')) return 'REJECTED';
  if (s.includes('CANCEL')) return 'CANCELLED';
  if (s.includes('COMPLETE') || s.includes('FILLED') || s.includes('EXECUT')) return 'FILLED';
  if (s.includes('PARTIAL')) return 'PARTIAL';
  if (s.includes('OPEN') || s.includes('PEND') || s.includes('TRIGGER')) return 'ACCEPTED';
  return null;
}

async function fetchAngelOrderBook(account) {
  const url = `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/getOrderBook`;
  try {
    const { data } = await axios.get(url, { headers: buildAngelHeaders(account) });
    return data;
  } catch (err) {
    // Some deployments require POST for this route; fallback gracefully.
    const { data } = await axios.post(url, {}, { headers: buildAngelHeaders(account) });
    return data;
  }
}

async function fetchAngelPositions(account) {
  const candidates = [
    { method: 'get', path: '/rest/secure/angelbroking/order/v1/getPosition' },
    { method: 'post', path: '/rest/secure/angelbroking/order/v1/getPosition', body: {} },
    { method: 'get', path: '/rest/secure/angelbroking/portfolio/v1/getPosition' },
    { method: 'post', path: '/rest/secure/angelbroking/portfolio/v1/getPosition', body: {} },
    { method: 'get', path: '/rest/secure/angelbroking/order/v1/getPositions' },
    { method: 'post', path: '/rest/secure/angelbroking/order/v1/getPositions', body: {} },
  ];

  for (const c of candidates) {
    try {
      const url = `${ANGEL_BASE_URL}${c.path}`;
      const response = c.method === 'get'
        ? await axios.get(url, { headers: buildAngelHeaders(account) })
        : await axios.post(url, c.body || {}, { headers: buildAngelHeaders(account) });

      const payload = response.data;
      if (!payload || payload.status === false) continue;

      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.data?.positions)) return payload.data.positions;
      return [];
    } catch {
      // Try next candidate endpoint.
    }
  }

  throw new Error('Unable to fetch live positions from AngelOne');
}

function hasAnyOpenLivePosition(positions) {
  return (positions || []).some((p) => {
    const netQty = Math.abs(Number(p.netqty ?? p.netQty ?? p.buyqty ?? 0));
    return Number.isFinite(netQty) && netQty > 0;
  });
}

async function syncOrderStatusesWithAngel(baseOrders) {
  const target = (baseOrders || []).filter((o) => {
    const d = parseDetails(o.details);
    return ['PENDING', 'ACCEPTED', 'PARTIAL'].includes(String(o.status || '').toUpperCase())
      && String(d.trade_mode || 'REAL').toUpperCase() === 'REAL'
      && !!d.angel_order_id;
  });
  if (!target.length) return;

  const byAccount = target.reduce((acc, o) => {
    if (!acc[o.account_id]) acc[o.account_id] = [];
    acc[o.account_id].push(o);
    return acc;
  }, {});

  for (const accountId of Object.keys(byAccount)) {
    const [accRows] = await db.query(
      'SELECT id, api_key, jwt_token FROM angelone_accounts WHERE id = ? AND connected = 1',
      [accountId]
    );
    if (!accRows.length) continue;
    const account = accRows[0];

    let orderBook;
    try {
      orderBook = await fetchAngelOrderBook(account);
    } catch {
      continue;
    }

    if (!orderBook?.status || !Array.isArray(orderBook?.data)) continue;
    const byAngelId = new Map(orderBook.data.map((x) => [String(x.orderid), x]));

    for (const local of byAccount[accountId]) {
      const details = parseDetails(local.details);
      const angelId = String(details.angel_order_id || '');
      if (!angelId) continue;
      const remote = byAngelId.get(angelId);
      if (!remote) continue;

      const next = mapAngelOrderStatus(remote.orderstatus || remote.status);
      if (!next || next === local.status) continue;

      const rejectionReason = remote.text || remote.rejectionreason || remote.statusmessage || null;
      await db.query(
        'UPDATE orders SET status = ?, error_message = ? WHERE id = ?',
        [next, next === 'REJECTED' ? rejectionReason : local.error_message, local.id]
      );
    }
  }
}

async function syncAngelOrderBookForAccount(account) {
  const [localRows] = await db.query(
    'SELECT id, account_id, status, error_message, details FROM orders WHERE account_id = ? ORDER BY id DESC LIMIT 5000',
    [account.id]
  );

  const localByAngelId = new Map();
  for (const row of localRows) {
    const d = parseDetails(row.details);
    const angelId = String(d.angel_order_id || '');
    if (angelId) localByAngelId.set(angelId, row);
  }

  const orderBook = await fetchAngelOrderBook(account);
  if (!orderBook?.status || !Array.isArray(orderBook?.data)) {
    return { accountId: account.id, inserted: 0, updated: 0, skipped: 0, totalRemote: 0, ok: false, error: orderBook?.message || 'Order book unavailable' };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const remote of orderBook.data) {
    const angelId = String(remote.orderid || remote.order_id || '');
    if (!angelId) { skipped += 1; continue; }

    const mappedStatus = mapAngelOrderStatus(remote.orderstatus || remote.status) || 'ACCEPTED';
    const side = ['BUY', 'SELL'].includes(String(remote.transactiontype || remote.side || '').toUpperCase())
      ? String(remote.transactiontype || remote.side).toUpperCase()
      : 'BUY';
    const qty = Math.max(1, parseInt(remote.quantity || remote.filledshares || remote.disclosedquantity || 1) || 1);
    const priceNum = parseFloat(remote.price || remote.averageprice || 0);
    const price = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null;
    const orderType = String(remote.ordertype || remote.orderType || 'MARKET').toUpperCase();
    const symbol = remote.tradingsymbol || remote.symbol || null;
    const segment = remote.exchange || 'ANGEL_SYNC';
    const rejectionReason = remote.text || remote.rejectionreason || remote.statusmessage || null;

    const existing = localByAngelId.get(angelId);
    if (existing) {
      const oldDetails = parseDetails(existing.details);
      const merged = {
        ...oldDetails,
        angel_order_id: angelId,
        symbol: oldDetails.symbol || symbol,
        token: oldDetails.token || (remote.symboltoken ? String(remote.symboltoken) : undefined),
        trade_mode: oldDetails.trade_mode || 'REAL',
        angel_status_raw: remote.orderstatus || remote.status || null,
        angel_last_sync_at: new Date().toISOString(),
      };

      const nextStatus = mappedStatus || existing.status;
      const nextError = nextStatus === 'REJECTED' ? rejectionReason : existing.error_message;

      await db.query(
        'UPDATE orders SET status = ?, error_message = ?, details = ? WHERE id = ?',
        [nextStatus, nextError, JSON.stringify(merged), existing.id]
      );
      updated += 1;
      continue;
    }

    const details = {
      angel_order_id: angelId,
      symbol,
      token: remote.symboltoken ? String(remote.symboltoken) : null,
      trade_mode: 'REAL',
      angel_status_raw: remote.orderstatus || remote.status || null,
      angel_last_sync_at: new Date().toISOString(),
    };

    await db.query(
      `INSERT INTO orders (account_id, setup_id, segment_name, side, quantity, price, order_type, status, details, error_message)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        segment,
        side,
        qty,
        price,
        orderType,
        mappedStatus,
        JSON.stringify(details),
        mappedStatus === 'REJECTED' ? rejectionReason : null,
      ]
    );
    inserted += 1;
  }

  return {
    accountId: account.id,
    inserted,
    updated,
    skipped,
    totalRemote: orderBook.data.length,
    ok: true,
  };
}

// ── Helper: Get account details ──────────────────────────────────
async function getConnectedAccount(accountId) {
  const [rows] = await db.query(
    'SELECT id, label, client_code, api_key, jwt_token FROM angelone_accounts WHERE id = ? AND connected = 1',
    [accountId]
  );
  if (!rows.length) throw new Error('Account not found or not connected');
  return rows[0];
}

// ── Helper: Get trade setup ──────────────────────────────────────
async function getTradeSetup(setupId) {
  const [rows] = await db.query(
    'SELECT * FROM trade_setups WHERE id = ?',
    [setupId]
  );
  if (!rows.length) throw new Error('Trade setup not found');
  return rows[0];
}

// ── Helper: Validate order against setup ────────────────────────
// Enforces: active flag, max_qty, trading window, max_trades_per_day.
// Note: max_loss_per_day / max_profit_per_day require P&L tracking and are
// left as TODOs for future enforcement.
async function validateOrderAgainstSetup(setupId, quantity, accountId) {
  const setup = await getTradeSetup(setupId);

  if (!setup.is_active) {
    throw new Error(`Setup "${setup.segment_name}" is inactive`);
  }

  if (setup.max_qty && quantity > setup.max_qty) {
    throw new Error(
      `Order quantity ${quantity} exceeds max allowed ${setup.max_qty} for ${setup.segment_name}`
    );
  }

  // Enforce trading window if configured (TIME fields)
  if (setup.trade_start_time && setup.trade_end_time) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const cur = `${hh}:${mm}:${ss}`;

    // Simple string compare works for HH:MM:SS in same day when start < end
    if (setup.trade_start_time <= setup.trade_end_time) {
      if (!(cur >= setup.trade_start_time && cur <= setup.trade_end_time)) {
        throw new Error(`Current time ${cur} is outside trading window ${setup.trade_start_time}–${setup.trade_end_time}`);
      }
    } else {
      // Window wraps past midnight (rare for NSE but handle generically)
      if (!(cur >= setup.trade_start_time || cur <= setup.trade_end_time)) {
        throw new Error(`Current time ${cur} is outside trading window ${setup.trade_start_time}–${setup.trade_end_time}`);
      }
    }
  }

  // Enforce max trades per day for this setup+account
  if (setup.max_trades_per_day && accountId) {
    const [[{ cnt }]] = await db.query(
      `SELECT COUNT(*) as cnt FROM orders WHERE setup_id = ? AND account_id = ? AND DATE(created_at) = CURDATE()`,
      [setupId, accountId]
    );
    if (Number(cnt) >= Number(setup.max_trades_per_day)) {
      throw new Error(`Max trades/day limit reached (${setup.max_trades_per_day}) for setup ${setup.segment_name}`);
    }
  }

  return setup;
}

// ── Helper: Calculate order details ──────────────────────────────
function calculateOrderDetails(setup, quantity) {
  const actualLotSize = setup.lot_size || 1;
  const numLots = Math.ceil(quantity / actualLotSize);
  const totalQuantity = numLots * actualLotSize;
  
  return {
    segment: setup.segment_name,
    instrument_type: setup.instrument_type,
    lot_size: actualLotSize,
    quantity_requested: quantity,
    num_lots: numLots,
    quantity_final: totalQuantity,
    notes: setup.notes,
  };
}

// ── POST: Execute trade order using setup ────────────────────────
router.post('/execute', async (req, res) => {
  try {
    const { account_id, setup_id, quantity, side, price, order_type } = req.body;
    
    if (!account_id || !setup_id || !quantity || !side) {
      return res.status(400).json({
        error: 'Required fields: account_id, setup_id, quantity, side (BUY/SELL)'
      });
    }
    
    if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
      return res.status(400).json({ error: 'Side must be BUY or SELL' });
    }

    // Validate order against setup
    const setup = await validateOrderAgainstSetup(setup_id, quantity, account_id);
    const account = await getConnectedAccount(account_id);
    const orderDetails = calculateOrderDetails(setup, quantity);

    // Create order record in database
    const [result] = await db.query(
      `INSERT INTO orders 
       (account_id, setup_id, segment_name, side, quantity, price, order_type, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        account_id,
        setup_id,
        setup.segment_name,
        side.toUpperCase(),
        orderDetails.quantity_final,
        price || null,
        order_type || 'MARKET',
        JSON.stringify(orderDetails)
      ]
    );

    const orderId = result.insertId;

    // Attempt to place order via AngelOne API (asynchronous)
    setImmediate(async () => {
      try {
        // This would integrate with AngelOne SmartAPI
        // For now, mark as accepted
        await db.query(
          'UPDATE orders SET status = ?, executed_at = NOW() WHERE id = ?',
          ['ACCEPTED', orderId]
        );
      } catch (err) {
        await db.query(
          'UPDATE orders SET status = ?, error_message = ? WHERE id = ?',
          ['FAILED', err.message, orderId]
        );
      }
    });

    const [newOrder] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);

    res.status(201).json({
      message: 'Order submitted successfully',
      order_id: orderId,
      account: account.label,
      setup: orderDetails,
      order: newOrder[0],
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST: Execute option trade from OI signal ────────────────────
// Body: { accountId, setupId, signal, symbol, token, exchange,
//         side, lots, productType, orderType, price,
//         atmStrike, underlying, expiry }
router.post('/signal-trade', async (req, res) => {
  try {
    const {
      accountId, setupId, signal,
      symbol, token, exchange,
      side, lots,
      tradeMode,
      productType, orderType, price,
      atmStrike, underlying, expiry,
    } = req.body;

    if (!accountId || !setupId)
      return res.status(400).json({ error: 'accountId and setupId are required' });
    if (!symbol || !token)
      return res.status(400).json({ error: 'symbol and token are required' });
    if (!side || !['BUY', 'SELL'].includes(String(side).toUpperCase()))
      return res.status(400).json({ error: 'side must be BUY or SELL' });

    const lotsCount        = Math.max(1, parseInt(lots) || 1);
    const tradeSide        = String(side).toUpperCase();
    const effectiveOrderType = (orderType || 'MARKET').toUpperCase();
    const effectiveTradeMode = String(tradeMode || 'REAL').toUpperCase();
    if (!['REAL', 'PAPER'].includes(effectiveTradeMode)) {
      return res.status(400).json({ error: 'tradeMode must be REAL or PAPER' });
    }

    const account = await getConnectedAccount(accountId);

    // Safety gate: allow only one active REAL entry order per account at a time.
    // Auto-exit orders must bypass this check so SL/target exits can still execute.
    // PAPER orders should not block either PAPER placement or subsequent REAL execution.
    const isAutoExitSignal = String(signal || '').startsWith('AUTO_EXIT_');
    if (!isAutoExitSignal && effectiveTradeMode === 'REAL') {
      const [activeRows] = await db.query(
        `SELECT id, status FROM orders
         WHERE account_id = ?
           AND status IN ('PENDING','ACCEPTED','PARTIAL','OPEN')
           AND (
             JSON_UNQUOTE(JSON_EXTRACT(details, '$.trade_mode')) IS NULL
             OR JSON_UNQUOTE(JSON_EXTRACT(details, '$.trade_mode')) <> 'PAPER'
           )
         ORDER BY id DESC
         LIMIT 1`,
        [accountId]
      );

      if (activeRows.length) {
        return res.status(409).json({
          error: `Active order already running (order #${activeRows[0].id}, ${activeRows[0].status}). Complete or close it before placing another trade.`,
          open_order_id: activeRows[0].id,
          open_order_status: activeRows[0].status,
        });
      }

      // Hard gate: do not allow a new REAL entry while any live position is open on broker side.
      const livePositions = await fetchAngelPositions(account);
      if (hasAnyOpenLivePosition(livePositions)) {
        return res.status(409).json({
          error: 'Live position already open. Exit current position before placing next trade.',
          open_live_position: true,
        });
      }
    }

    // Validate against trade setup (trading window, max_qty, max_trades_per_day)
    const setup   = await validateOrderAgainstSetup(setupId, lotsCount, accountId);
    const finalQty = lotsCount * (setup.lot_size || 1);

    const details = {
      signal:        signal || null,
      underlying:    underlying || null,
      expiry:        expiry || null,
      atmStrike:     atmStrike || null,
      trade_mode:    effectiveTradeMode,
      symbol,
      token,
      lots:          lotsCount,
      lot_size:      setup.lot_size || 1,
      quantity_final: finalQty,
      productType:   productType || 'INTRADAY',
      orderType:     effectiveOrderType,
    };

    // Insert PENDING order record
    const [result] = await db.query(
      `INSERT INTO orders (account_id, setup_id, segment_name, side, quantity, price, order_type, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        accountId, setupId, setup.segment_name, tradeSide, finalQty,
        effectiveOrderType === 'LIMIT' ? (price || null) : null,
        effectiveOrderType, JSON.stringify(details),
      ]
    );
    const orderId = result.insertId;

    // Paper mode: simulate order acceptance without calling AngelOne.
    if (effectiveTradeMode === 'PAPER') {
      const paperOrderId = `PAPER-${orderId}`;
      await db.query(
        `UPDATE orders SET status='ACCEPTED', executed_at=NOW(), details=? WHERE id=?`,
        [JSON.stringify({ ...details, paper_order_id: paperOrderId }), orderId]
      );

      const [[paperOrder]] = await db.query('SELECT * FROM orders WHERE id=?', [orderId]);
      return res.status(201).json({
        message:        'Paper trade executed (simulated)',
        order_id:       orderId,
        paper_order_id: paperOrderId,
        symbol,
        side:           tradeSide,
        quantity:       finalQty,
        signal,
        trade_mode:     effectiveTradeMode,
        order:          paperOrder,
      });
    }

    // Place order on AngelOne SmartAPI
    let angelResp;
    try {
      angelResp = await placeAngelOrder(account, {
        symbol,
        token,
        exchange:        exchange || 'NFO',
        transactionType: tradeSide,
        orderType:       effectiveOrderType,
        productType:     productType || 'INTRADAY',
        quantity:        finalQty,
        price:           effectiveOrderType === 'LIMIT' ? price : null,
      });
    } catch (apiErr) {
      const errMsg = apiErr.response?.data?.message || apiErr.message;
      await db.query('UPDATE orders SET status=?, error_message=? WHERE id=?', ['FAILED', errMsg, orderId]);
      return res.status(400).json({ error: errMsg, order_id: orderId });
    }

    if (!angelResp?.status) {
      const errMsg = angelResp?.message || 'AngelOne rejected the order';
      await db.query('UPDATE orders SET status=?, error_message=? WHERE id=?', ['REJECTED', errMsg, orderId]);
      return res.status(400).json({ error: errMsg, order_id: orderId, angel_response: angelResp });
    }

    const angelOrderId = angelResp?.data?.orderid || null;
    await db.query(
      `UPDATE orders SET status='ACCEPTED', executed_at=NOW(), details=? WHERE id=?`,
      [JSON.stringify({ ...details, angel_order_id: angelOrderId }), orderId]
    );

    const [[newOrder]] = await db.query('SELECT * FROM orders WHERE id=?', [orderId]);
    res.status(201).json({
      message:        'Order placed on AngelOne',
      order_id:       orderId,
      angel_order_id: angelOrderId,
      symbol,
      side:           tradeSide,
      quantity:       finalQty,
      signal,
      trade_mode:     effectiveTradeMode,
      order:          newOrder,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET: Get all orders ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let [orders] = await db.query(
      `SELECT o.*, a.label as account_label,
              ts.segment_name, ts.stop_loss_points, ts.target_points, ts.trailing_stop_points
       FROM orders o
       JOIN angelone_accounts a ON o.account_id = a.id
       LEFT JOIN trade_setups ts ON o.setup_id = ts.id
       ORDER BY o.created_at DESC`
    );

    if (String(req.query.sync || '0') === '1') {
      await syncOrderStatusesWithAngel(orders.slice(0, 50));
      [orders] = await db.query(
        `SELECT o.*, a.label as account_label,
                ts.segment_name, ts.stop_loss_points, ts.target_points, ts.trailing_stop_points
         FROM orders o
         JOIN angelone_accounts a ON o.account_id = a.id
         LEFT JOIN trade_setups ts ON o.setup_id = ts.id
         ORDER BY o.created_at DESC`
      );
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET: Get orders for account ──────────────────────────────────
router.get('/account/:accountId', async (req, res) => {
  try {
    let [orders] = await db.query(
      `SELECT o.*, ts.segment_name, ts.lot_size, ts.instrument_type,
              ts.stop_loss_points, ts.target_points, ts.trailing_stop_points
       FROM orders o
       LEFT JOIN trade_setups ts ON o.setup_id = ts.id
       WHERE o.account_id = ?
       ORDER BY o.created_at DESC`,
      [req.params.accountId]
    );

    if (String(req.query.sync || '0') === '1') {
      await syncOrderStatusesWithAngel(orders.slice(0, 50));
      [orders] = await db.query(
        `SELECT o.*, ts.segment_name, ts.lot_size, ts.instrument_type,
                ts.stop_loss_points, ts.target_points, ts.trailing_stop_points
         FROM orders o
         LEFT JOIN trade_setups ts ON o.setup_id = ts.id
         WHERE o.account_id = ?
         ORDER BY o.created_at DESC`,
        [req.params.accountId]
      );
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST: Sync all Angel One orders into local DB ───────────────────────────
// Body: { accountId?: number }
router.post('/sync-angel', async (req, res) => {
  try {
    const requested = req.body?.accountId ? parseInt(req.body.accountId) : null;
    let accounts;

    if (requested) {
      const [rows] = await db.query(
        'SELECT id, label, client_code, api_key, jwt_token FROM angelone_accounts WHERE id = ? AND connected = 1',
        [requested]
      );
      accounts = rows;
    } else {
      const [rows] = await db.query(
        'SELECT id, label, client_code, api_key, jwt_token FROM angelone_accounts WHERE connected = 1'
      );
      accounts = rows;
    }

    if (!accounts.length) {
      return res.status(400).json({ error: 'No connected Angel One account found for sync' });
    }

    const results = [];
    for (const account of accounts) {
      try {
        const r = await syncAngelOrderBookForAccount(account);
        results.push({ accountId: account.id, label: account.label, ...r });
      } catch (err) {
        results.push({ accountId: account.id, label: account.label, ok: false, error: err.message, inserted: 0, updated: 0, skipped: 0, totalRemote: 0 });
      }
    }

    const summary = results.reduce((acc, r) => {
      acc.accounts += 1;
      acc.inserted += Number(r.inserted || 0);
      acc.updated += Number(r.updated || 0);
      acc.skipped += Number(r.skipped || 0);
      return acc;
    }, { accounts: 0, inserted: 0, updated: 0, skipped: 0 });

    res.json({ message: 'Angel order sync completed', summary, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET: Get order details ───────────────────────────────────────
router.get('/:orderId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*, a.label as account_label, ts.segment_name, ts.lot_size
       FROM orders o
       JOIN angelone_accounts a ON o.account_id = a.id
       LEFT JOIN trade_setups ts ON o.setup_id = ts.id
       WHERE o.id = ?`,
      [req.params.orderId]
    );
    
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    
    const order = rows[0];
    if (order.details && typeof order.details === 'string') {
      order.details = JSON.parse(order.details);
    }
    
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT: Cancel order ────────────────────────────────────────────
router.put('/:orderId/cancel', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT status FROM orders WHERE id = ?',
      [req.params.orderId]
    );
    
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    
    if (!['PENDING', 'ACCEPTED'].includes(rows[0].status)) {
      return res.status(400).json({ 
        error: `Cannot cancel order with status: ${rows[0].status}` 
      });
    }

    await db.query(
      'UPDATE orders SET status = ?, cancelled_at = NOW() WHERE id = ?',
      ['CANCELLED', req.params.orderId]
    );

    const [updated] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    res.json({ message: 'Order cancelled', order: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET: Get order stats ─────────────────────────────────────────
router.get('/stats/summary', async (req, res) => {
  try {
    const [[{ pending }]] = await db.query("SELECT COUNT(*) as pending FROM orders WHERE status='PENDING'");
    const [[{ accepted }]] = await db.query("SELECT COUNT(*) as accepted FROM orders WHERE status='ACCEPTED'");
    const [[{ filled }]] = await db.query("SELECT COUNT(*) as filled FROM orders WHERE status='FILLED'");
    const [[{ cancelled }]] = await db.query("SELECT COUNT(*) as cancelled FROM orders WHERE status='CANCELLED'");
    const [[{ failed }]] = await db.query("SELECT COUNT(*) as failed FROM orders WHERE status='FAILED'");
    const [[{ total }]] = await db.query("SELECT COUNT(*) as total FROM orders");

    res.json({
      pending: Number(pending),
      accepted: Number(accepted),
      filled: Number(filled),
      cancelled: Number(cancelled),
      failed: Number(failed),
      total: Number(total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
