-- PowerTrade Database Schema
CREATE DATABASE IF NOT EXISTS powertrade;
USE powertrade;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','trader') DEFAULT 'trader',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  symbol VARCHAR(20) NOT NULL,
  side ENUM('BUY','SELL') NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  price DECIMAL(18,8) NOT NULL,
  total DECIMAL(18,8) GENERATED ALWAYS AS (quantity * price) STORED,
  status ENUM('OPEN','FILLED','CANCELLED') DEFAULT 'OPEN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS portfolio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  quantity DECIMAL(18,8) NOT NULL DEFAULT 0,
  avg_price DECIMAL(18,8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (user_id, symbol),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Seed demo data
INSERT IGNORE INTO users (id, name, email, password_hash, role) VALUES
(1, 'Admin', 'admin@powertrade.io', 'hashed', 'admin'),
(2, 'Alice', 'alice@example.com', 'hashed', 'trader'),
(3, 'Bob',   'bob@example.com',   'hashed', 'trader');

INSERT IGNORE INTO trades (user_id, symbol, side, quantity, price, status) VALUES
(2, 'BTC/USD', 'BUY',  0.5,    42150.00, 'FILLED'),
(2, 'ETH/USD', 'BUY',  5.0,     2280.00, 'FILLED'),
(3, 'BTC/USD', 'SELL', 0.25,   42300.00, 'FILLED'),
(2, 'SOL/USD', 'BUY',  100.0,    98.50,  'OPEN'),
(3, 'ETH/USD', 'BUY',  3.0,     2290.00, 'FILLED'),
(2, 'BTC/USD', 'SELL', 0.1,    42500.00, 'OPEN');

INSERT IGNORE INTO portfolio (user_id, symbol, quantity, avg_price) VALUES
(2, 'BTC/USD', 0.4,   42150.00),
(2, 'ETH/USD', 5.0,    2280.00),
(3, 'BTC/USD', 0.75,  41800.00),
(3, 'ETH/USD', 3.0,    2290.00);

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
);

CREATE TABLE IF NOT EXISTS trade_setups (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  account_id           INT NOT NULL,
  segment_name         VARCHAR(100) NOT NULL COMMENT 'e.g., NIFTY, SENSEX, CRUDE OIL, GOLD, etc.',
  instrument_type      VARCHAR(50)  COMMENT 'e.g., INDEX, COMMODITY, FOREX, CRYPTO',
  lot_size             INT NOT NULL DEFAULT 1 COMMENT 'Standard lot size for this segment',
  default_qty          INT NOT NULL DEFAULT 1 COMMENT 'Default quantity to trade',
  max_qty              INT          COMMENT 'Maximum quantity allowed for this segment',
  -- Daily risk limits
  max_trades_per_day   INT          COMMENT 'Maximum number of trades allowed per day',
  max_loss_per_day     DECIMAL(18,2) COMMENT 'Maximum loss limit per day (points or rupees)',
  max_profit_per_day   DECIMAL(18,2) COMMENT 'Daily profit target — stop trading once hit',
  -- Per-trade risk parameters
  stop_loss_points     DECIMAL(18,2) COMMENT 'Per-trade stop loss in points',
  target_points        DECIMAL(18,2) COMMENT 'Per-trade profit target in points',
  trailing_stop_points DECIMAL(18,2) COMMENT 'Trailing stop distance in points (0 = disabled)',
  -- Trading window
  trade_start_time     TIME          COMMENT 'Earliest time to open new trades (e.g., 09:15:00)',
  trade_end_time       TIME          COMMENT 'Latest time to open new trades (e.g., 15:15:00)',
  is_active            TINYINT DEFAULT 1,
  notes                TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY (account_id, segment_name)
);

CREATE TABLE IF NOT EXISTS orders (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NOT NULL,
  setup_id        INT,
  segment_name    VARCHAR(100) NOT NULL,
  side            ENUM('BUY','SELL') NOT NULL,
  quantity        INT NOT NULL,
  price           DECIMAL(18,8),
  order_type      VARCHAR(20) DEFAULT 'MARKET' COMMENT 'MARKET, LIMIT, STOP, etc.',
  status          ENUM('PENDING','ACCEPTED','FILLED','PARTIAL','CANCELLED','REJECTED','FAILED') DEFAULT 'PENDING',
  details         JSON COMMENT 'Order calculation details (lot_size, num_lots, etc.)',
  error_message   TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  executed_at     TIMESTAMP NULL,
  cancelled_at    TIMESTAMP NULL,
  FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (setup_id) REFERENCES trade_setups(id) ON DELETE SET NULL,
  KEY (status),
  KEY (created_at),
  KEY (account_id)
);

CREATE TABLE IF NOT EXISTS strategies (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NOT NULL,
  name            VARCHAR(150) NOT NULL,
  description     TEXT,
  strategy_type   VARCHAR(50) COMMENT 'e.g., MOMENTUM, MEAN_REVERSION, BREAKOUT, SWING, SCALP',
  entry_rules     JSON COMMENT 'Entry conditions and parameters',
  exit_rules      JSON COMMENT 'Exit conditions and parameters',
  risk_management JSON COMMENT 'Stop loss, take profit, position sizing',
  segments        JSON COMMENT 'Array of segment_ids this strategy trades',
  max_daily_loss  DECIMAL(18,8) COMMENT 'Maximum daily loss limit',
  max_position_size INT COMMENT 'Maximum position size for this strategy',
  is_active       TINYINT DEFAULT 1,
  is_running      TINYINT DEFAULT 0 COMMENT 'Whether strategy is currently executing',
  win_rate        DECIMAL(5,2),
  total_trades    INT DEFAULT 0,
  profit_loss     DECIMAL(18,8) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY (account_id, name),
  KEY (is_active),
  KEY (is_running)
);
