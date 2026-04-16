const express = require('express');
const router = express.Router();
const db = require('./db');

// ── Helper: Get account and validate connection ──────────────────
async function getConnectedAccount(accountId) {
  const [rows] = await db.query(
    'SELECT id, label, client_code, connected FROM angelone_accounts WHERE id = ?',
    [accountId]
  );
  if (!rows.length) throw new Error('Account not found');
  if (!rows[0].connected) throw new Error('Account not connected');
  return rows[0];
}

// ── GET all trade setups for an account ──────────────────────────
router.get('/account/:accountId', async (req, res) => {
  try {
    await getConnectedAccount(req.params.accountId);
    const [setups] = await db.query(
      `SELECT id, account_id, segment_name, instrument_type, lot_size,
              default_qty, max_qty,
              max_trades_per_day, max_loss_per_day, max_profit_per_day,
              stop_loss_points, target_points, trailing_stop_points,
              trade_start_time, trade_end_time,
              is_active, notes, created_at, updated_at
       FROM trade_setups
       WHERE account_id = ?
       ORDER BY segment_name ASC`,
      [req.params.accountId]
    );
    res.json(setups);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET single trade setup ───────────────────────────────────────
router.get('/:setupId', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM trade_setups WHERE id = ?',
      [req.params.setupId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Setup not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE new trade setup ───────────────────────────────────────
router.post('/account/:accountId', async (req, res) => {
  try {
    await getConnectedAccount(req.params.accountId);
    const {
      segment_name, instrument_type, lot_size, default_qty, max_qty,
      max_trades_per_day, max_loss_per_day, max_profit_per_day,
      stop_loss_points, target_points, trailing_stop_points,
      trade_start_time, trade_end_time, notes,
    } = req.body;

    if (!segment_name || !lot_size || !default_qty) {
      return res.status(400).json({
        error: 'Required fields: segment_name, lot_size, default_qty'
      });
    }

    // Check for duplicate segment
    const [existing] = await db.query(
      'SELECT id FROM trade_setups WHERE account_id = ? AND segment_name = ?',
      [req.params.accountId, segment_name]
    );
    if (existing.length) {
      return res.status(400).json({
        error: `Segment "${segment_name}" already exists for this account`
      });
    }

    const [result] = await db.query(
      `INSERT INTO trade_setups
       (account_id, segment_name, instrument_type, lot_size, default_qty, max_qty,
        max_trades_per_day, max_loss_per_day, max_profit_per_day,
        stop_loss_points, target_points, trailing_stop_points,
        trade_start_time, trade_end_time, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.accountId,
        segment_name,
        instrument_type || null,
        lot_size,
        default_qty,
        max_qty || null,
        max_trades_per_day || null,
        max_loss_per_day || null,
        max_profit_per_day || null,
        stop_loss_points || null,
        target_points || null,
        trailing_stop_points || null,
        trade_start_time || null,
        trade_end_time || null,
        notes || null,
      ]
    );

    const [newSetup] = await db.query(
      'SELECT * FROM trade_setups WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({
      message: 'Trade setup created',
      setup: newSetup[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE trade setup ───────────────────────────────────────────
router.put('/:setupId', async (req, res) => {
  try {
    const {
      segment_name, instrument_type, lot_size, default_qty, max_qty,
      max_trades_per_day, max_loss_per_day, max_profit_per_day,
      stop_loss_points, target_points, trailing_stop_points,
      trade_start_time, trade_end_time,
      is_active, notes,
    } = req.body;

    // Get current setup to validate account
    const [current] = await db.query(
      'SELECT account_id FROM trade_setups WHERE id = ?',
      [req.params.setupId]
    );
    if (!current.length) {
      return res.status(404).json({ error: 'Setup not found' });
    }

    // Check for duplicate segment if renaming
    if (segment_name) {
      const [existing] = await db.query(
        'SELECT id FROM trade_setups WHERE account_id = ? AND segment_name = ? AND id != ?',
        [current[0].account_id, segment_name, req.params.setupId]
      );
      if (existing.length) {
        return res.status(400).json({
          error: `Segment "${segment_name}" already exists for this account`
        });
      }
    }

    const updates = [];
    const values = [];

    if (segment_name !== undefined) {
      updates.push('segment_name = ?');
      values.push(segment_name);
    }
    if (instrument_type !== undefined) {
      updates.push('instrument_type = ?');
      values.push(instrument_type || null);
    }
    if (lot_size !== undefined) {
      updates.push('lot_size = ?');
      values.push(lot_size);
    }
    if (default_qty !== undefined) {
      updates.push('default_qty = ?');
      values.push(default_qty);
    }
    if (max_qty !== undefined) {
      updates.push('max_qty = ?');
      values.push(max_qty || null);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes || null);
    }
    if (max_trades_per_day !== undefined) {
      updates.push('max_trades_per_day = ?');
      values.push(max_trades_per_day || null);
    }
    if (max_loss_per_day !== undefined) {
      updates.push('max_loss_per_day = ?');
      values.push(max_loss_per_day || null);
    }
    if (max_profit_per_day !== undefined) {
      updates.push('max_profit_per_day = ?');
      values.push(max_profit_per_day || null);
    }
    if (stop_loss_points !== undefined) {
      updates.push('stop_loss_points = ?');
      values.push(stop_loss_points || null);
    }
    if (target_points !== undefined) {
      updates.push('target_points = ?');
      values.push(target_points || null);
    }
    if (trailing_stop_points !== undefined) {
      updates.push('trailing_stop_points = ?');
      values.push(trailing_stop_points || null);
    }
    if (trade_start_time !== undefined) {
      updates.push('trade_start_time = ?');
      values.push(trade_start_time || null);
    }
    if (trade_end_time !== undefined) {
      updates.push('trade_end_time = ?');
      values.push(trade_end_time || null);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.setupId);
    await db.query(
      `UPDATE trade_setups SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    const [updated] = await db.query(
      'SELECT * FROM trade_setups WHERE id = ?',
      [req.params.setupId]
    );
    res.json({
      message: 'Trade setup updated',
      setup: updated[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE trade setup ───────────────────────────────────────────
router.delete('/:setupId', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT segment_name FROM trade_setups WHERE id = ?',
      [req.params.setupId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Setup not found' });
    }

    const segmentName = rows[0].segment_name;
    await db.query('DELETE FROM trade_setups WHERE id = ?', [req.params.setupId]);

    res.json({
      message: `Trade setup "${segmentName}" deleted`,
      setupId: req.params.setupId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BULK: Get setups with account info ───────────────────────────
router.get('/', async (req, res) => {
  try {
    const [setups] = await db.query(
      `SELECT ts.*, aa.label, aa.client_code
       FROM trade_setups ts
       JOIN angelone_accounts aa ON ts.account_id = aa.id
       ORDER BY aa.label ASC, ts.segment_name ASC`
    );
    res.json(setups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
