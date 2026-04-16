const express = require('express');
const router = express.Router();
const db = require('./db');

// ── Helper: Get account and validate connection ──────────────────
async function getConnectedAccount(accountId) {
  const [rows] = await db.query(
    'SELECT id, label, client_code, connected FROM angelone_accounts WHERE id = ? AND connected = 1',
    [accountId]
  );
  if (!rows.length) throw new Error('Account not found or not connected');
  return rows[0];
}

// ── GET all strategies for an account ────────────────────────────
router.get('/account/:accountId', async (req, res) => {
  try {
    await getConnectedAccount(req.params.accountId);
    const [strategies] = await db.query(
      `SELECT id, name, description, strategy_type, is_active, is_running, 
              win_rate, total_trades, profit_loss, created_at, updated_at
       FROM strategies 
       WHERE account_id = ? 
       ORDER BY created_at DESC`,
      [req.params.accountId]
    );
    res.json(strategies);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET single strategy details ──────────────────────────────────
router.get('/:strategyId', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Strategy not found' });
    
    const strategy = rows[0];
    if (strategy.entry_rules) strategy.entry_rules = JSON.parse(strategy.entry_rules);
    if (strategy.exit_rules) strategy.exit_rules = JSON.parse(strategy.exit_rules);
    if (strategy.risk_management) strategy.risk_management = JSON.parse(strategy.risk_management);
    if (strategy.segments) strategy.segments = JSON.parse(strategy.segments);
    
    res.json(strategy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE new strategy ────────────────────────────────────────
router.post('/account/:accountId', async (req, res) => {
  try {
    await getConnectedAccount(req.params.accountId);
    const { 
      name, description, strategy_type, entry_rules, exit_rules, 
      risk_management, segments, max_daily_loss, max_position_size, notes 
    } = req.body;

    if (!name || !strategy_type) {
      return res.status(400).json({
        error: 'Required fields: name, strategy_type'
      });
    }

    // Check for duplicate strategy name
    const [existing] = await db.query(
      'SELECT id FROM strategies WHERE account_id = ? AND name = ?',
      [req.params.accountId, name]
    );
    if (existing.length) {
      return res.status(400).json({
        error: `Strategy "${name}" already exists for this account`
      });
    }

    const [result] = await db.query(
      `INSERT INTO strategies 
       (account_id, name, description, strategy_type, entry_rules, exit_rules, 
        risk_management, segments, max_daily_loss, max_position_size, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.accountId,
        name,
        description || null,
        strategy_type,
        entry_rules ? JSON.stringify(entry_rules) : null,
        exit_rules ? JSON.stringify(exit_rules) : null,
        risk_management ? JSON.stringify(risk_management) : null,
        segments ? JSON.stringify(segments) : null,
        max_daily_loss || null,
        max_position_size || null,
        notes || null,
      ]
    );

    const [newStrategy] = await db.query(
      'SELECT * FROM strategies WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({
      message: 'Strategy created',
      strategy: newStrategy[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE strategy ────────────────────────────────────────────
router.put('/:strategyId', async (req, res) => {
  try {
    const { 
      name, description, strategy_type, entry_rules, exit_rules, 
      risk_management, segments, max_daily_loss, max_position_size, 
      is_active, notes 
    } = req.body;

    const [current] = await db.query(
      'SELECT account_id, name FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    if (!current.length) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Check for duplicate name if renaming
    if (name && name !== current[0].name) {
      const [existing] = await db.query(
        'SELECT id FROM strategies WHERE account_id = ? AND name = ? AND id != ?',
        [current[0].account_id, name, req.params.strategyId]
      );
      if (existing.length) {
        return res.status(400).json({
          error: `Strategy "${name}" already exists for this account`
        });
      }
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description || null);
    }
    if (strategy_type !== undefined) {
      updates.push('strategy_type = ?');
      values.push(strategy_type);
    }
    if (entry_rules !== undefined) {
      updates.push('entry_rules = ?');
      values.push(entry_rules ? JSON.stringify(entry_rules) : null);
    }
    if (exit_rules !== undefined) {
      updates.push('exit_rules = ?');
      values.push(exit_rules ? JSON.stringify(exit_rules) : null);
    }
    if (risk_management !== undefined) {
      updates.push('risk_management = ?');
      values.push(risk_management ? JSON.stringify(risk_management) : null);
    }
    if (segments !== undefined) {
      updates.push('segments = ?');
      values.push(segments ? JSON.stringify(segments) : null);
    }
    if (max_daily_loss !== undefined) {
      updates.push('max_daily_loss = ?');
      values.push(max_daily_loss || null);
    }
    if (max_position_size !== undefined) {
      updates.push('max_position_size = ?');
      values.push(max_position_size || null);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes || null);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.strategyId);
    await db.query(
      `UPDATE strategies SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    const [updated] = await db.query(
      'SELECT * FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    res.json({
      message: 'Strategy updated',
      strategy: updated[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE strategy ────────────────────────────────────────────
router.delete('/:strategyId', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT name FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategyName = rows[0].name;
    await db.query('DELETE FROM strategies WHERE id = ?', [req.params.strategyId]);

    res.json({
      message: `Strategy "${strategyName}" deleted`,
      strategyId: req.params.strategyId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE all strategies for an account ─────────────────────────
router.delete('/account/:accountId', async (req, res) => {
  try {
    await getConnectedAccount(req.params.accountId);

    const [result] = await db.query(
      'DELETE FROM strategies WHERE account_id = ?',
      [req.params.accountId]
    );

    res.json({
      message: `Deleted ${result.affectedRows} strategies for account ${req.params.accountId}`,
      deleted: result.affectedRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START/STOP strategy ────────────────────────────────────────
router.put('/:strategyId/toggle', async (req, res) => {
  try {
    const [strategy] = await db.query(
      'SELECT is_running FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    if (!strategy.length) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const newState = strategy[0].is_running ? 0 : 1;
    await db.query(
      'UPDATE strategies SET is_running = ? WHERE id = ?',
      [newState, req.params.strategyId]
    );

    const [updated] = await db.query(
      'SELECT * FROM strategies WHERE id = ?',
      [req.params.strategyId]
    );
    res.json({
      message: newState ? 'Strategy started' : 'Strategy stopped',
      strategy: updated[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET all strategies (bulk view) ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [strategies] = await db.query(
      `SELECT s.*, aa.label as account_label, aa.client_code
       FROM strategies s
       JOIN angelone_accounts aa ON s.account_id = aa.id
       ORDER BY aa.label ASC, s.name ASC`
    );
    res.json(strategies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
