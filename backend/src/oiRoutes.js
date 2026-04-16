'use strict';

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const oiSvc   = require('./oiService');

const router = express.Router();

// ── Instruments master — disk-backed cache ───────────────────────────────────
// Stored in <project>/backend/nfo_cache.json so it survives server restarts.
// On startup: load from disk immediately (instant), then refresh in background.
// Background refresh runs every 6 hours so the file never goes stale.

const CACHE_FILE    = path.join(__dirname, '..', 'nfo_cache.json');
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

let nfoCache     = null;   // in-memory copy
let nfoCacheTime = 0;
let nfoCacheFetching = false;

function loadFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return false;
    const { savedAt, data } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    nfoCache     = data;
    nfoCacheTime = savedAt;
    console.log(`[OI] Loaded ${data.length} NFO instruments from disk cache (saved ${new Date(savedAt).toLocaleString()})`);
    return true;
  } catch (e) {
    console.warn('[OI] Disk cache unreadable:', e.message);
    return false;
  }
}

async function fetchAndCache() {
  if (nfoCacheFetching) {
    // Wait for the in-progress fetch to finish
    await new Promise((resolve) => {
      const poll = setInterval(() => { if (!nfoCacheFetching) { clearInterval(poll); resolve(); } }, 300);
    });
    return;
  }
  nfoCacheFetching = true;
  try {
    console.log('[OI] Downloading instruments master from AngelOne…');
    const { data } = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 120_000 }
    );
    const nfo = data.filter((i) => i.exch_seg === 'NFO');
    const now  = Date.now();
    nfoCache     = nfo;
    nfoCacheTime = now;
    // Persist to disk so next startup is instant
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ savedAt: now, data: nfo }));
    console.log(`[OI] Cached ${nfo.length} NFO instruments to disk`);
  } catch (e) {
    console.error('[OI] Download failed:', e.message);
    // Don't wipe existing cache on failure
  } finally {
    nfoCacheFetching = false;
  }
}

async function getNFOInstruments() {
  if (nfoCache) return nfoCache;
  // Cache miss — shouldn't normally happen after startup, but handle it
  await fetchAndCache();
  return nfoCache;
}

// ── Startup: load from disk instantly, then refresh if stale ─────────────────
(function startup() {
  const diskLoaded = loadFromDisk();
  const stale = !diskLoaded || (Date.now() - nfoCacheTime > CACHE_MAX_AGE);
  if (stale) {
    // Fetch in background — doesn't block server startup
    fetchAndCache().catch((e) => console.warn('[OI] Background refresh failed:', e.message));
  }
  // Schedule periodic refresh every 6 hours
  setInterval(() => {
    fetchAndCache().catch((e) => console.warn('[OI] Scheduled refresh failed:', e.message));
  }, CACHE_MAX_AGE);
})();

// ── GET /api/oi/instruments?search=NIFTY&limit=30 ────────────────────────────
router.get('/instruments', async (req, res) => {
  try {
    const search = (req.query.search || '').trim().toUpperCase();
    const limit  = Math.min(parseInt(req.query.limit) || 30, 100);

    if (!search || search.length < 2) {
      return res.status(400).json({ error: 'search must be at least 2 characters' });
    }

    const instruments = await getNFOInstruments();

    const results = instruments
      .filter((i) => i.symbol.toUpperCase().includes(search) || i.name.toUpperCase().includes(search))
      .slice(0, limit)
      .map((i) => ({
        token:          i.token,
        symbol:         i.symbol,
        name:           i.name,
        expiry:         i.expiry,
        strike:         i.strike,
        lotsize:        i.lotsize,
        instrumenttype: i.instrumenttype,
        exchange:       i.exch_seg,
        tick_size:      i.tick_size,
      }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/oi/subscribe ────────────────────────────────────────────────────
// Body: { accountId: number, tokens: string[], exchangeType?: number }
router.post('/subscribe', async (req, res) => {
  try {
    const { accountId, tokens, exchangeType = 2 } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (!Array.isArray(tokens) || tokens.length === 0)
      return res.status(400).json({ error: 'tokens array required' });

    const account = await oiSvc.getAccount(accountId);
    if (!account) return res.status(400).json({ error: 'Account not found or not connected' });

    const ok = oiSvc.subscribe(accountId, account, tokens, exchangeType);
    if (ok === false) {
      return res.status(401).json({ error: 'AngelOne session expired. Please reconnect the account on the Accounts page.' });
    }
    res.json({ message: `Subscribed ${tokens.length} tokens for account ${accountId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/oi/unsubscribe ────────────────────────────────────────────────
// Body: { accountId, tokens, exchangeType }
router.delete('/unsubscribe', (req, res) => {
  const { accountId, tokens, exchangeType = 2 } = req.body;
  if (!accountId || !tokens) return res.status(400).json({ error: 'accountId and tokens required' });
  oiSvc.unsubscribeTokens(accountId, tokens, exchangeType);
  res.json({ message: 'Unsubscribed' });
});

// ── GET /api/oi/snapshot?accountId=X ─────────────────────────────────────────
router.get('/snapshot', (req, res) => {
  const accountId = parseInt(req.query.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  res.json(oiSvc.getStore(accountId));
});

// ── GET /api/oi/stream?accountId=X ───────────────────────────────────────────
// Server-Sent Events stream. Frontend uses EventSource to receive live ticks.
router.get('/stream', (req, res) => {
  const accountId = parseInt(req.query.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });

  // SSE headers
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });
  res.flushHeaders();

  // Helper to write SSE frames
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Send current snapshot immediately
  send('connected', { accountId });
  const snapshot = oiSvc.getStore(accountId);
  if (Object.keys(snapshot).length > 0) send('snapshot', snapshot);

  oiSvc.addSseClient(accountId);

  const emitter = oiSvc.getEmitter(accountId);

  const onTick         = (tick) => send('tick', tick);
  const onWsError      = (msg)  => send('wserror', { message: msg });
  const onDisconnected = ()     => send('disconnected', {});

  emitter.on('tick',         onTick);
  emitter.on('wserror',      onWsError);
  emitter.on('disconnected', onDisconnected);

  // Keep-alive comment every 20s
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(keepalive);
    emitter.off('tick',         onTick);
    emitter.off('wserror',      onWsError);
    emitter.off('disconnected', onDisconnected);
    oiSvc.removeSseClient(accountId);
  });
});

// ── DELETE /api/oi/disconnect ─────────────────────────────────────────────────
router.delete('/disconnect', (req, res) => {
  const accountId = parseInt(req.body?.accountId || req.query.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  oiSvc.disconnect(accountId);
  res.json({ message: `Disconnected account ${accountId}` });
});

// ── GET /api/oi/expiries?name=NIFTY ──────────────────────────────────────────
// Returns sorted list of unique expiry dates for a given underlying name.
router.get('/expiries', async (req, res) => {
  try {
    const name = (req.query.name || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'name required' });

    const instruments = await getNFOInstruments();

    // Parse DDMMMYYYY into a sortable Date (e.g. "13APR2026" → 2026-04-13)
    const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
    const parseExpiry = (s) => {
      const d = parseInt(s.slice(0, 2), 10);
      const m = MONTHS[s.slice(2, 5)];
      const y = parseInt(s.slice(5), 10);
      return new Date(y, m, d);
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiries = [
      ...new Set(
        instruments
          .filter((i) =>
            i.name.toUpperCase() === name &&
            (i.instrumenttype === 'OPTIDX' || i.instrumenttype === 'FUTIDX' ||
             i.instrumenttype === 'OPTSTK' || i.instrumenttype === 'FUTSTK')
          )
          .map((i) => i.expiry)
          .filter(Boolean)
      ),
    ]
      .filter((e) => parseExpiry(e) >= today)
      .sort((a, b) => parseExpiry(a) - parseExpiry(b));
    res.json(expiries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/oi/option-chain?name=NIFTY&expiry=25APR2026 ────────────────────
// Returns all CE + PE tokens for a given underlying & expiry, grouped by strike.
router.get('/option-chain', async (req, res) => {
  try {
    const name   = (req.query.name   || '').trim().toUpperCase();
    const expiry = (req.query.expiry || '').trim().toUpperCase();
    if (!name || !expiry) return res.status(400).json({ error: 'name and expiry required' });

    const instruments = await getNFOInstruments();

    const chain = {};

    instruments
      .filter((i) =>
        i.name.toUpperCase() === name &&
        String(i.expiry).toUpperCase() === expiry &&
        (i.instrumenttype === 'OPTIDX' || i.instrumenttype === 'OPTSTK')
      )
      .forEach((i) => {
        // Instruments master stores strike in paise (× 100) — divide to get actual price
        const strike = parseFloat(i.strike) / 100;
        if (!strike) return;
        if (!chain[strike]) chain[strike] = { strike };
        const side = i.symbol.endsWith('CE') ? 'CE' : i.symbol.endsWith('PE') ? 'PE' : null;
        if (!side) return;
        chain[strike][side] = { token: i.token, symbol: i.symbol, lotsize: i.lotsize };
      });

    // Also include futures token for this expiry
    const futInst = instruments.find((i) =>
      i.name.toUpperCase() === name &&
      String(i.expiry).toUpperCase() === expiry &&
      (i.instrumenttype === 'FUTIDX' || i.instrumenttype === 'FUTSTK')
    );

    const strikes = Object.values(chain).sort((a, b) => a.strike - b.strike);
    res.json({ strikes, future: futInst ? { token: futInst.token, symbol: futInst.symbol } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
