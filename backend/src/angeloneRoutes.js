const express = require('express');
const router = express.Router();
const speakeasy = require('speakeasy');
const axios = require('axios');
const db = require('./db');
const oiSvc = require('./oiService');

const ANGEL_BASE_URL = 'https://apiconnect.angelone.in';

function getAngelClientMetaHeaders() {
  return {
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
    'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
    'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
  };
}

function getAngelHeaders(account) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${account.jwt_token}`,
    'X-PrivateKey': account.api_key,
    ...getAngelClientMetaHeaders(),
  };
}

async function getConnectedAccount(id) {
  const [[account]] = await db.query('SELECT * FROM angelone_accounts WHERE id = ?', [id]);
  if (!account) return { error: 'Account not found', status: 404 };
  if (!account.connected || !account.jwt_token) {
    return { error: 'Account is not connected. Connect first.', status: 400 };
  }
  return { account };
}

async function callAngelWithFallback(account, candidates) {
  let lastError;
  const attempted = [];
  for (const candidate of candidates) {
    try {
      attempted.push(`${candidate.method.toUpperCase()} ${candidate.path}`);
      const response = await axios({
        method: candidate.method,
        url: `${ANGEL_BASE_URL}${candidate.path}`,
        headers: getAngelHeaders(account),
        data: candidate.body,
      });
      const payload = response.data;

      // Occasionally SmartAPI edge/WAF returns an HTML rejection page with 200.
      if (typeof payload === 'string' && payload.toLowerCase().includes('<html')) {
        const supportId = parseAngelHtmlRejectSupportId(payload);
        const supportIdText = supportId ? ` Support ID: ${supportId}.` : '';
        const htmlError = new Error(
          `AngelOne gateway rejected the secure API request.${supportIdText} ` +
          'Profile can still work while Funds/Margin endpoints are blocked for this account/IP on AngelOne side. ' +
          'Raise a SmartAPI support ticket with this support ID, client code, and API key.'
        );
        htmlError.attempted = attempted;
        lastError = htmlError;
        continue;
      }

      // Some SmartAPI endpoints return HTTP 200 with status=false; keep trying fallbacks.
      if (payload && payload.status === false) {
        const businessError = new Error(payload.message || 'AngelOne API returned status=false');
        businessError.attempted = attempted;
        businessError.payload = payload;
        lastError = businessError;
        continue;
      }

      return { payload, attempted };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    lastError.attempted = attempted;
  }
  throw lastError;
}

function normalizeAngelError(err, fallbackMessage) {
  const message = (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallbackMessage
  );
  const attempts = Array.isArray(err?.attempted) && err.attempted.length
    ? ` Tried: ${err.attempted.join(' | ')}`
    : '';
  return `${message}${attempts}`;
}

function parseAngelHtmlRejectSupportId(htmlText) {
  const text = String(htmlText || '');
  const match = text.match(/support ID is:\s*([0-9]+)/i);
  return match ? match[1] : null;
}

function shouldRefreshSession(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('token') ||
    text.includes('session') ||
    text.includes('jwt') ||
    text.includes('expired') ||
    text.includes('invalid') ||
    text.includes('login')
  );
}

async function refreshAngelSession(account) {
  const loginData = await angelLogin(account);
  if (!loginData?.status || !loginData?.data?.jwtToken) {
    throw new Error(loginData?.message || 'Unable to refresh AngelOne session');
  }

  const { jwtToken, refreshToken, feedToken } = loginData.data;
  await db.query(
    `UPDATE angelone_accounts
     SET jwt_token = ?, refresh_token = ?, feed_token = ?, connected = 1, connected_at = NOW()
     WHERE id = ?`,
    [jwtToken, refreshToken, feedToken, account.id]
  );

  account.jwt_token = jwtToken;
  account.refresh_token = refreshToken;
  account.feed_token = feedToken;
}

async function fetchSecureWithRelogin(account, candidates) {
  const first = await callAngelWithFallback(account, candidates);
  if (!first?.payload || first.payload.status !== false) {
    return first.payload;
  }

  const apiMessage = first.payload.message || '';
  if (!shouldRefreshSession(apiMessage)) {
    return first.payload;
  }

  await refreshAngelSession(account);
  const second = await callAngelWithFallback(account, candidates);
  return second.payload;
}

// POST /api/angelone/disconnect/:id — disconnect an account (clear tokens, set connected=0)
router.post('/disconnect/:id', async (req, res) => {
  try {
    const [[account]] = await db.query('SELECT * FROM angelone_accounts WHERE id = ?', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await db.query(
      `UPDATE angelone_accounts SET jwt_token=NULL, refresh_token=NULL, feed_token=NULL, connected=0, connected_at=NULL WHERE id=?`,
      [account.id]
    );
    res.json({ message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/angelone/token/:id — get JWT/feed token for an account
router.get('/token/:id', async (req, res) => {
  try {
    const [[account]] = await db.query('SELECT jwt_token, feed_token, connected FROM angelone_accounts WHERE id = ?', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ jwt_token: account.jwt_token, feed_token: account.feed_token, connected: !!account.connected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/angelone/check/:id — lightweight connectivity & token health check
router.get('/check/:id', async (req, res) => {
  try {
    const [[account]] = await db.query('SELECT id, label, client_code, connected, jwt_token, refresh_token, feed_token, connected_at FROM angelone_accounts WHERE id = ?', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Quick: if not marked connected or missing jwt_token, report disconnected
    if (!account.connected || !account.jwt_token) {
      return res.json({ connected: false, message: 'Account not connected', account: { id: account.id, label: account.label } });
    }

    // Attempt a profile call (will refresh session transparently when needed)
    try {
      const payload = await fetchSecureWithRelogin(account, [
        { method: 'get', path: '/rest/secure/angelbroking/user/v1/getProfile' },
        { method: 'post', path: '/rest/secure/angelbroking/user/v1/getProfile', body: { refreshToken: account.refresh_token } },
      ]);

      if (payload && payload.status === false) {
        return res.status(400).json({ connected: false, message: payload.message || 'AngelOne returned error', details: payload });
      }

      return res.json({ connected: true, message: 'Connected and API reachable', account: { id: account.id, label: account.label, connected_at: account.connected_at }, profile: payload });
    } catch (err) {
      return res.status(500).json({ connected: false, error: normalizeAngelError(err, 'Failed to verify AngelOne connectivity') });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/angelone/profile/:id — fetch user profile for a connected account
router.get('/profile/:id', async (req, res) => {
  try {
    const result = await getConnectedAccount(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const data = await fetchSecureWithRelogin(result.account, [
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getProfile' },
      {
        method: 'post',
        path: '/rest/secure/angelbroking/user/v1/getProfile',
        body: { refreshToken: result.account.refresh_token },
      },
    ]);

    if (data && data.status === false) {
      return res.status(400).json({ error: data.message || 'Failed to fetch profile' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: normalizeAngelError(err, 'Failed to fetch profile') });
  }
});

// GET /api/angelone/margin/:id — fetch RMS/margin details for a connected account
router.get('/margin/:id', async (req, res) => {
  try {
    const result = await getConnectedAccount(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const data = await fetchSecureWithRelogin(result.account, [
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getRMS' },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getRMS', body: {} },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getRMS', body: { mode: 'FULL' } },
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getFundMarginBalance' },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getFundMarginBalance', body: {} },
    ]);

    if (data && data.status === false) {
      return res.status(400).json({ error: data.message || 'Failed to fetch margin details' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: normalizeAngelError(err, 'Failed to fetch margin details') });
  }
});

// GET /api/angelone/funds/:id — fetch funds details for a connected account
router.get('/funds/:id', async (req, res) => {
  try {
    const result = await getConnectedAccount(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const data = await fetchSecureWithRelogin(result.account, [
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getFunds' },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getFunds', body: {} },
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getFundMarginBalance' },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getFundMarginBalance', body: {} },
      { method: 'get', path: '/rest/secure/angelbroking/user/v1/getRMS' },
      { method: 'post', path: '/rest/secure/angelbroking/user/v1/getRMS', body: {} },
    ]);

    if (data && data.status === false) {
      return res.status(400).json({ error: data.message || 'Failed to fetch funds details' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: normalizeAngelError(err, 'Failed to fetch funds details') });
  }
});

// GET /api/angelone/positions/:id — fetch live positions for a connected account
router.get('/positions/:id', async (req, res) => {
  try {
    const result = await getConnectedAccount(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const data = await fetchSecureWithRelogin(result.account, [
      { method: 'get', path: '/rest/secure/angelbroking/order/v1/getPosition' },
      { method: 'post', path: '/rest/secure/angelbroking/order/v1/getPosition', body: {} },
      { method: 'get', path: '/rest/secure/angelbroking/portfolio/v1/getPosition' },
      { method: 'post', path: '/rest/secure/angelbroking/portfolio/v1/getPosition', body: {} },
      { method: 'get', path: '/rest/secure/angelbroking/order/v1/getPositions' },
      { method: 'post', path: '/rest/secure/angelbroking/order/v1/getPositions', body: {} },
    ]);

    if (data && data.status === false) {
      return res.status(400).json({ error: data.message || 'Failed to fetch positions' });
    }

    const items = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.data?.positions)
        ? data.data.positions
        : [];

    res.json({
      status: true,
      message: data?.message || 'SUCCESS',
      data: items,
      raw: data,
    });
  } catch (err) {
    res.status(500).json({ error: normalizeAngelError(err, 'Failed to fetch positions') });
  }
});

// ── Internal helper: login one account against AngelOne API ─────────────────
async function angelLogin(account) {
  const totp = speakeasy.totp({ secret: account.totp_secret, encoding: 'base32' });
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-PrivateKey': account.api_key,
    ...getAngelClientMetaHeaders(),
  };
  const body = {
    clientcode: account.client_code,
    password: account.password_enc,
    totp,
  };
  const resp = await axios.post(
    'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword',
    body,
    { headers }
  );
  return resp.data; // { status, message, data: { jwtToken, refreshToken, feedToken } }
}

// GET /api/angelone/accounts — list accounts (never expose password / totp_secret)
router.get('/accounts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, label, client_code, api_key, connected, connected_at, created_at
       FROM angelone_accounts ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/angelone/accounts — add a new account
router.post('/accounts', async (req, res) => {
  const { label, client_code, password, totp_secret, api_key } = req.body;
  if (!label || !client_code || !password || !totp_secret || !api_key) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const [result] = await db.query(
      `INSERT INTO angelone_accounts (label, client_code, password_enc, totp_secret, api_key)
       VALUES (?, ?, ?, ?, ?)`,
      [label, client_code, password, totp_secret, api_key]
    );
    res.json({ id: result.insertId, message: 'Account added' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Client code already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/angelone/accounts/:id — remove an account
router.delete('/accounts/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM angelone_accounts WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/angelone/connect/:id — connect a single account
router.post('/connect/:id', async (req, res) => {
  try {
    const [[account]] = await db.query(
      'SELECT * FROM angelone_accounts WHERE id = ?',
      [req.params.id]
    );
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const data = await angelLogin(account);
    if (!data.status) return res.status(400).json({ error: data.message });

    const { jwtToken, refreshToken, feedToken } = data.data;
    await db.query(
      `UPDATE angelone_accounts
       SET jwt_token = ?, refresh_token = ?, feed_token = ?, connected = 1, connected_at = NOW()
       WHERE id = ?`,
      [jwtToken, refreshToken, feedToken, account.id]
    );
    // Clear any auth-failed flag so OI streaming can resume immediately
    oiSvc.clearAuthFailed(account.id);
    res.json({ message: 'Connected', jwtToken, feedToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/angelone/connect-all — connect all accounts in parallel
router.post('/connect-all', async (req, res) => {
  try {
    const [accounts] = await db.query('SELECT * FROM angelone_accounts');
    if (!accounts.length) return res.json([]);

    const results = await Promise.allSettled(
      accounts.map(async (acc) => {
        const data = await angelLogin(acc);
        if (!data.status) throw new Error(data.message);
        const { jwtToken, refreshToken, feedToken } = data.data;
        await db.query(
          `UPDATE angelone_accounts
           SET jwt_token = ?, refresh_token = ?, feed_token = ?, connected = 1, connected_at = NOW()
           WHERE id = ?`,
          [jwtToken, refreshToken, feedToken, acc.id]
        );
        oiSvc.clearAuthFailed(acc.id);
        return { id: acc.id, label: acc.label, status: 'connected' };
      })
    );

    const summary = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { id: accounts[i].id, label: accounts[i].label, status: 'connected' }
        : { id: accounts[i].id, label: accounts[i].label, status: 'failed', reason: r.reason?.message }
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
