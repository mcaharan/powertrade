/**
 * oiService.js
 * Manages live OI data via AngelOne WebSocket Streaming 2.0.
 *
 * Binary Snap-Quote packet layout (little-endian):
 *  [0]     1B  Subscription mode (3 = Snap Quote)
 *  [1]     1B  Exchange type
 *  [2-26] 25B  Token (null-terminated UTF-8)
 *  [27-34] 8B  Sequence number (int64)
 *  [35-42] 8B  Exchange timestamp (int64, epoch ms)
 *  [43-50] 8B  LTP in paise (int64) → divide by 100 for ₹
 *  [51-58] 8B  Last traded qty (int64)
 *  [59-66] 8B  Avg traded price in paise (int64)
 *  [67-74] 8B  Volume (int64)
 *  [75-82] 8B  Total buy qty (double)
 *  [83-90] 8B  Total sell qty (double)
 *  [91-98] 8B  Open in paise (int64)
 *  [99-106] 8B  High in paise (int64)
 *  [107-114] 8B Low in paise (int64)
 *  [115-122] 8B Close in paise (int64)
 *  [123-130] 8B Last traded timestamp (int64)
 *  [131-138] 8B Open Interest (int64)  ← the key field
 *  [139-146] 8B OI change % (double, dummy/garbage per docs)
 *  [147-346] 200B Best Five data
 *  [347-354] 8B Upper circuit in paise
 *  [355-362] 8B Lower circuit in paise
 *  [363-370] 8B 52W high in paise
 *  [371-378] 8B 52W low in paise
 */

'use strict';

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const db = require('./db');

const MAX_TOKENS_PER_SUBSCRIBE = 50;

// ── In-memory stores ─────────────────────────────────────────────────────────
const oiStore          = {};   // accountId -> token -> parsed data
const wsMap            = {};   // accountId -> WebSocket instance
const emitterMap       = {};   // accountId -> EventEmitter
const sseCount         = {};   // accountId -> number of active SSE clients
const disconnectTimers = {};   // accountId -> pending disconnect timer
const authFailedAccounts = new Set(); // accounts whose JWT is expired/invalid (HTTP 401)

function getEmitter(accountId) {
  if (!emitterMap[accountId]) {
    emitterMap[accountId] = new EventEmitter();
    emitterMap[accountId].setMaxListeners(50);
  }
  return emitterMap[accountId];
}

// ── Binary packet parser ─────────────────────────────────────────────────────
function parsePacket(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (buf.length < 51) return null;

  const mode         = buf.readUInt8(0);
  const exchangeType = buf.readUInt8(1);

  // Token is a null-terminated string in bytes 2–26
  let tokenEnd = 2;
  while (tokenEnd < 27 && buf[tokenEnd] !== 0) tokenEnd++;
  const token = buf.slice(2, tokenEnd).toString('utf8').trim();
  if (!token) return null;

  const exchangeTs = Number(buf.readBigInt64LE(35));
  const ltp        = Number(buf.readBigInt64LE(43)) / 100;

  if (mode < 3 || buf.length < 139) {
    return { mode, exchangeType, token, ltp, exchangeTs };
  }

  const volume = Number(buf.readBigInt64LE(67));
  const open   = Number(buf.readBigInt64LE(91))  / 100;
  const high   = Number(buf.readBigInt64LE(99))  / 100;
  const low    = Number(buf.readBigInt64LE(107)) / 100;
  const close  = Number(buf.readBigInt64LE(115)) / 100;
  const oi     = Number(buf.readBigInt64LE(131));

  const upperCircuit = buf.length >= 355 ? Number(buf.readBigInt64LE(347)) / 100 : 0;
  const lowerCircuit = buf.length >= 363 ? Number(buf.readBigInt64LE(355)) / 100 : 0;

  return { mode, exchangeType, token, ltp, exchangeTs, volume, open, high, low, close, oi, upperCircuit, lowerCircuit };
}

// ── Account fetch ─────────────────────────────────────────────────────────────
async function getAccount(accountId) {
  const [[row]] = await db.query(
    'SELECT id, client_code, jwt_token, feed_token, api_key FROM angelone_accounts WHERE id = ? AND connected = 1',
    [accountId]
  );
  return row || null;
}

// ── Subscribe tokens ──────────────────────────────────────────────────────────
function chunkTokens(tokens, size = MAX_TOKENS_PER_SUBSCRIBE) {
  const chunks = [];
  for (let i = 0; i < tokens.length; i += size) {
    chunks.push(tokens.slice(i, i + size));
  }
  return chunks;
}

function sendSubscription(ws, tokenList, exchangeType, action = 1) {
  if (ws.readyState !== WebSocket.OPEN) return;

  const chunks = chunkTokens(tokenList);
  chunks.forEach((tokens, idx) => {
    const payload = JSON.stringify({
      correlationID: `oi_${Date.now()}_${idx}`,
      action,
      params: { mode: 3, tokenList: [{ exchangeType, tokens }] },
    });
    ws.send(payload);
  });
}

function subscribe(accountId, account, tokenList, exchangeType = 2) {
  if (authFailedAccounts.has(accountId)) {
    // JWT is expired — refuse to create a new doomed WS connection
    getEmitter(accountId).emit('autherror', 'AngelOne session expired. Please reconnect the account on the Accounts page.');
    return false;
  }

  if (!oiStore[accountId]) oiStore[accountId] = {};

  const existing = wsMap[accountId];

  // Already open — send subscription immediately
  if (existing && existing.readyState === WebSocket.OPEN) {
    sendSubscription(existing, tokenList, exchangeType, 1);
    return;
  }

  // Still connecting — queue the subscription; it will be flushed on open
  if (existing && existing.readyState === WebSocket.CONNECTING) {
    if (!existing._pendingSubs) existing._pendingSubs = [];
    existing._pendingSubs.push({ tokenList, exchangeType });
    return;
  }

  const ws = new WebSocket('wss://smartapisocket.angelone.in/smart-stream', {
    headers: {
      Authorization:    account.jwt_token,
      'x-api-key':      account.api_key,
      'x-client-code':  account.client_code,
      'x-feed-token':   account.feed_token,
    },
  });

  wsMap[accountId] = ws;

  ws.on('open', () => {
    console.log(`[OI-WS] Connected account=${accountId}`);
    // Send primary subscription
    sendSubscription(ws, tokenList, exchangeType, 1);
    // Flush any subscriptions that arrived while we were connecting
    if (ws._pendingSubs) {
      ws._pendingSubs.forEach((s) => sendSubscription(ws, s.tokenList, s.exchangeType, 1));
      ws._pendingSubs = null;
    }
    ws._hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 25_000);
  });

  ws.on('message', (raw, isBinary) => {
    if (!isBinary) {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
      if (text && text !== 'pong' && text !== 'ping') {
        try {
          const meta = JSON.parse(text);
          if (meta?.message) {
            getEmitter(accountId).emit('wserror', meta.message);
          }
        } catch {
          // Non-JSON text frame; ignore.
        }
      }
      return;
    }

    let d;
    try {
      d = parsePacket(raw);
    } catch (err) {
      getEmitter(accountId).emit('wserror', `Tick parse failed: ${err.message}`);
      return;
    }

    if (!d || !d.token) return;

    if (!oiStore[accountId]) oiStore[accountId] = {};

    const prev = oiStore[accountId][d.token];
    oiStore[accountId][d.token] = {
      ...d,
      prevOi: prev?.oi ?? null,
      updatedAt: Date.now(),
    };
    getEmitter(accountId).emit('tick', { token: d.token, ...oiStore[accountId][d.token] });
  });

  ws.on('error', (err) => {
    const msg = err.message || '';
    const is401 = msg.includes('401') || msg.toLowerCase().includes('unauthorized');
    if (is401) {
      ws._authFailed = true;
      authFailedAccounts.add(accountId);
      console.error(`[OI-WS] Auth failure (401) account=${accountId} — JWT expired, blocking auto-reconnect`);
      getEmitter(accountId).emit('autherror', 'AngelOne session expired. Please reconnect the account on the Accounts page.');
    } else {
      console.error(`[OI-WS] Error account=${accountId}:`, msg);
      getEmitter(accountId).emit('wserror', msg);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[OI-WS] Closed account=${accountId} code=${code}`);
    clearInterval(ws._hb);
    delete wsMap[accountId];
    if (!ws._authFailed) {
      getEmitter(accountId).emit('disconnected');
    }
    // If auth-failed, skip 'disconnected' so the frontend auto-start doesn't retry
  });
}

function unsubscribeTokens(accountId, tokenList, exchangeType = 2) {
  const ws = wsMap[accountId];
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  sendSubscription(ws, tokenList, exchangeType, 0);
  tokenList.forEach((t) => {
    if (oiStore[accountId]) delete oiStore[accountId][t];
  });
}

function disconnect(accountId) {
  const ws = wsMap[accountId];
  if (!ws) return;
  clearInterval(ws._hb);
  ws.close();
  delete wsMap[accountId];
  delete oiStore[accountId];
}

// ── SSE client bookkeeping ────────────────────────────────────────────────────
function addSseClient(accountId) {
  sseCount[accountId] = (sseCount[accountId] || 0) + 1;
  // Cancel any pending disconnect caused by the previous SSE closing
  clearTimeout(disconnectTimers[accountId]);
  delete disconnectTimers[accountId];
}

function removeSseClient(accountId) {
  sseCount[accountId] = Math.max(0, (sseCount[accountId] || 1) - 1);
  if (sseCount[accountId] === 0) {
    // Debounce: wait 2s before disconnecting — allows expiry/underlying changes
    // to reopen a new SSE+subscribe before teardown occurs
    disconnectTimers[accountId] = setTimeout(() => {
      delete disconnectTimers[accountId];
      if ((sseCount[accountId] || 0) === 0) disconnect(accountId);
    }, 2000);
  }
}

function getStore(accountId) {
  return oiStore[accountId] || {};
}

/** Call this after a successful re-login so the account can stream again. */
function clearAuthFailed(accountId) {
  authFailedAccounts.delete(accountId);
}

module.exports = {
  subscribe,
  unsubscribeTokens,
  disconnect,
  getStore,
  getEmitter,
  getAccount,
  addSseClient,
  removeSseClient,
  clearAuthFailed,
};
