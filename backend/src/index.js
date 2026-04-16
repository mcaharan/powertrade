const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const angeloneRoutes = require('./angeloneRoutes');
const tradeSetupRoutes = require('./tradeSetupRoutes');
const orderRoutes = require('./orderRoutes');
const strategyRoutes = require('./strategyRoutes');
const oiRoutes        = require('./oiRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/api/angelone', angeloneRoutes);
app.use('/api/trade-setups', tradeSetupRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/oi',         oiRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'OK', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', database: 'disconnected', error: err.message });
  }
});

// ── Dashboard stats ──────────────────────────────────────────
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [[{ totalUsers }]] = await db.query('SELECT COUNT(*) AS totalUsers FROM users');
    const [[{ totalTrades }]] = await db.query('SELECT COUNT(*) AS totalTrades FROM trades');
    const [[{ openOrders }]] = await db.query("SELECT COUNT(*) AS openOrders FROM trades WHERE status='OPEN'");
    const [[{ totalVolume }]] = await db.query(
      'SELECT COALESCE(SUM(quantity * price), 0) AS totalVolume FROM trades WHERE status="FILLED"'
    );
    res.json({ totalUsers, totalTrades, openOrders, totalVolume: Number(totalVolume) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Trades ───────────────────────────────────────────────────
app.get('/api/trades', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, u.name AS user_name
       FROM trades t LEFT JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Portfolio ────────────────────────────────────────────────
app.get('/api/portfolio', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.name AS user_name
       FROM portfolio p LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.symbol`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS angelone_accounts (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      label         VARCHAR(100)  NOT NULL,
      client_code   VARCHAR(50)   NOT NULL UNIQUE,
      password_enc  VARCHAR(255)  NOT NULL,
      totp_secret   VARCHAR(255)  NOT NULL,
      api_key       VARCHAR(255)  NOT NULL,
      jwt_token     TEXT,
      refresh_token TEXT,
      feed_token    TEXT,
      connected     TINYINT       NOT NULL DEFAULT 0,
      connected_at  TIMESTAMP     NULL,
      created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS trade_setups (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      account_id           INT NOT NULL,
      segment_name         VARCHAR(100) NOT NULL,
      instrument_type      VARCHAR(50),
      lot_size             INT NOT NULL DEFAULT 1,
      default_qty          INT NOT NULL DEFAULT 1,
      max_qty              INT,
      max_trades_per_day   INT,
      max_loss_per_day     DECIMAL(18,2),
      max_profit_per_day   DECIMAL(18,2),
      stop_loss_points     DECIMAL(18,2),
      target_points        DECIMAL(18,2),
      trailing_stop_points DECIMAL(18,2),
      trade_start_time     TIME,
      trade_end_time       TIME,
      is_active            TINYINT DEFAULT 1,
      notes                TEXT,
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_account_segment (account_id, segment_name)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      account_id      INT NOT NULL,
      setup_id        INT,
      segment_name    VARCHAR(100) NOT NULL,
      side            ENUM('BUY','SELL') NOT NULL,
      quantity        INT NOT NULL,
      price           DECIMAL(18,8),
      order_type      VARCHAR(20) DEFAULT 'MARKET',
      status          ENUM('PENDING','ACCEPTED','FILLED','PARTIAL','CANCELLED','REJECTED','FAILED') DEFAULT 'PENDING',
      details         JSON,
      error_message   TEXT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      executed_at     TIMESTAMP NULL,
      cancelled_at    TIMESTAMP NULL,
      FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (setup_id) REFERENCES trade_setups(id) ON DELETE SET NULL,
      KEY idx_orders_status (status),
      KEY idx_orders_created_at (created_at),
      KEY idx_orders_account_id (account_id)
    )
  `);
}
initDB().catch(console.error);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
