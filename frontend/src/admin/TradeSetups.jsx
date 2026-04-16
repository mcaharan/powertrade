import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './admin.css'

export default function TradeSetups() {
  const [allSetups, setAllSetups] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [form, setForm] = useState({
    segment_name: '',
    instrument_type: '',
    lot_size: 1,
    default_qty: 1,
    max_qty: '',
    max_trades_per_day: '',
    max_loss_per_day: '',
    max_profit_per_day: '',
    stop_loss_points: '',
    target_points: '',
    trailing_stop_points: '',
    trade_start_time: '09:15',
    trade_end_time: '15:30',
    notes: '',
  })

  // Common instruments for quick selection
  const commonSegments = [
    { name: 'NIFTY 50', type: 'INDEX', lot: 1 },
    { name: 'SENSEX', type: 'INDEX', lot: 1 },
    { name: 'BANK NIFTY', type: 'INDEX', lot: 1 },
    { name: 'CRUDE OIL', type: 'COMMODITY', lot: 100 },
    { name: 'GOLD', type: 'COMMODITY', lot: 100 },
    { name: 'SILVER', type: 'COMMODITY', lot: 1 },
    { name: 'NATURAL GAS', type: 'COMMODITY', lot: 10000 },
    { name: 'EUR/USD', type: 'FOREX', lot: 1 },
    { name: 'GBP/USD', type: 'FOREX', lot: 1 },
  ]

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/angelone/accounts')
      setAccounts(data.filter((a) => a.connected))
      // Do not auto-select an account; default view should be 'All'
    } catch (err) {
      flash('Failed to load accounts', 'error')
    }
  }, [])

  const loadSetups = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/trade-setups')
      setAllSetups(data)
    } catch (err) {
      flash('Failed to load trade setups', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAccounts()
    loadSetups()
  }, [loadAccounts, loadSetups])

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'number' ? value : value,
    }))
  }

  const resetForm = () => {
    setForm({
      segment_name: '',
      instrument_type: '',
      lot_size: 1,
      default_qty: 1,
      max_qty: '',
      max_trades_per_day: '',
      max_loss_per_day: '',
      max_profit_per_day: '',
      stop_loss_points: '',
      target_points: '',
      trailing_stop_points: '',
      trade_start_time: '09:15',
      trade_end_time: '15:30',
      notes: '',
    })
    setEditingId(null)
  }

  const handleQuickSelect = (segment) => {
    setForm((prev) => ({
      ...prev,
      segment_name: segment.name,
      instrument_type: segment.type,
      lot_size: segment.lot,
    }))
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!selectedAccount) {
      flash('Please select an account', 'error')
      return
    }
    if (!form.segment_name.trim()) {
      flash('Segment name is required', 'error')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        segment_name: form.segment_name.trim().toUpperCase(),
        instrument_type: form.instrument_type || null,
        lot_size: form.lot_size ? parseInt(form.lot_size) : 1,
        default_qty: form.default_qty ? parseInt(form.default_qty) : 1,
        max_qty: form.max_qty ? parseInt(form.max_qty) : null,
        max_trades_per_day: form.max_trades_per_day ? parseInt(form.max_trades_per_day) : null,
        max_loss_per_day: form.max_loss_per_day ? parseFloat(form.max_loss_per_day) : null,
        max_profit_per_day: form.max_profit_per_day ? parseFloat(form.max_profit_per_day) : null,
        stop_loss_points: form.stop_loss_points ? parseFloat(form.stop_loss_points) : null,
        target_points: form.target_points ? parseFloat(form.target_points) : null,
        trailing_stop_points: form.trailing_stop_points ? parseFloat(form.trailing_stop_points) : null,
        trade_start_time: form.trade_start_time || null,
        trade_end_time: form.trade_end_time || null,
        notes: form.notes || null,
      }

      if (editingId) {
        await axios.put(`/api/trade-setups/${editingId}`, payload)
        flash('Trade setup updated')
      } else {
        await axios.post(`/api/trade-setups/account/${selectedAccount}`, payload)
        flash('Trade setup added')
      }

      resetForm()
      loadSetups()
    } catch (err) {
      flash(err.response?.data?.error || 'Operation failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (setup) => {
    setForm({
      segment_name: setup.segment_name,
      instrument_type: setup.instrument_type || '',
      lot_size: setup.lot_size,
      default_qty: setup.default_qty,
      max_qty: setup.max_qty || '',
      max_trades_per_day: setup.max_trades_per_day ?? '',
      max_loss_per_day: setup.max_loss_per_day ?? '',
      max_profit_per_day: setup.max_profit_per_day ?? '',
      stop_loss_points: setup.stop_loss_points ?? '',
      target_points: setup.target_points ?? '',
      trailing_stop_points: setup.trailing_stop_points ?? '',
      trade_start_time: setup.trade_start_time ? setup.trade_start_time.slice(0, 5) : '09:15',
      trade_end_time: setup.trade_end_time ? setup.trade_end_time.slice(0, 5) : '15:30',
      notes: setup.notes || '',
    })
    setEditingId(setup.id)
    setSelectedAccount(setup.account_id)
  }

  const handleToggleActive = async (setup) => {
    try {
      await axios.put(`/api/trade-setups/${setup.id}`, {
        is_active: setup.is_active ? 0 : 1,
      })
      flash(setup.is_active ? 'Setup disabled' : 'Setup enabled')
      loadSetups()
    } catch (err) {
      flash('Failed to update status', 'error')
    }
  }

  const handleDelete = async (id, segmentName) => {
    if (!window.confirm(`Delete trade setup "${segmentName}"?`)) return

    try {
      await axios.delete(`/api/trade-setups/${id}`)
      flash('Trade setup deleted')
      if (editingId === id) resetForm()
      loadSetups()
    } catch (err) {
      flash(err.response?.data?.error || 'Delete failed', 'error')
    }
  }

  const accountName = (id) => accounts.find((a) => a.id === id)?.label || 'Unknown'
  const filteredSetups = selectedAccount
    ? allSetups.filter((s) => s.account_id === selectedAccount)
    : allSetups

  const totalSetups = allSetups.length
  const activeSetups = allSetups.filter((s) => s.is_active).length

  const [showForm, setShowForm] = useState(false)

  const startEdit = (setup) => {
    handleEdit(setup)
    setShowForm(true)
  }

  const cancelForm = () => {
    resetForm()
    setShowForm(false)
  }

  const typeColors = {
    INDEX:     { bg: 'rgba(56,189,248,0.12)',  color: '#38bdf8'  },
    COMMODITY: { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b'  },
    FOREX:     { bg: 'rgba(16,185,129,0.12)',  color: '#10b981'  },
    CRYPTO:    { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa'  },
    STOCK:     { bg: 'rgba(236,72,153,0.12)',  color: '#ec4899'  },
    OTHER:     { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8'  },
  }

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 1.5rem', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 38, height: 38, borderRadius: 12,
              background: 'linear-gradient(135deg, #ec4899 60%, #d946ef 100%)',
              boxShadow: '0 2px 16px rgba(236,72,153,0.12)', color: '#fff', fontSize: 20,
            }}>⚙️</span>
            Trade Setups
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
            Configure segment &amp; lot settings per trading account
          </p>
        </div>
        <button
          onClick={() => { setShowForm((s) => !s); if (editingId) resetForm() }}
          style={{
            background: showForm ? 'rgba(236,72,153,0.22)' : 'rgba(236,72,153,0.12)',
            color: '#ec4899', fontWeight: 700, fontSize: 14,
            border: '1px solid rgba(236,72,153,0.3)', padding: '9px 22px',
            borderRadius: 10, cursor: 'pointer', flexShrink: 0,
          }}>
          {showForm ? '✕ Cancel' : '＋ Add Setup'}
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, margin: '1.8rem 0' }}>
        <div className="stat-card blue" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(236,72,153,0.13)', borderRadius: 10, padding: 8 }}>⚙️</span>
          <div>
            <div className="stat-label">Total Setups</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{totalSetups}</div>
          </div>
        </div>
        <div className="stat-card green" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(16,185,129,0.13)', borderRadius: 10, padding: 8 }}>●</span>
          <div>
            <div className="stat-label">Active</div>
            <div className="stat-value" style={{ fontSize: 22, color: '#10b981' }}>{activeSetups}</div>
          </div>
        </div>
        <div className="stat-card amber" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(245,158,11,0.13)', borderRadius: 10, padding: 8 }}>○</span>
          <div>
            <div className="stat-label">Inactive</div>
            <div className="stat-value" style={{ fontSize: 22, color: '#f59e0b' }}>{totalSetups - activeSetups}</div>
          </div>
        </div>
        <div className="stat-card blue" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(99,102,241,0.13)', borderRadius: 10, padding: 8 }}>👥</span>
          <div>
            <div className="stat-label">Accounts</div>
            <div className="stat-value" style={{ fontSize: 22, color: '#a78bfa' }}>{accounts.length}</div>
          </div>
        </div>
      </div>

      {/* ── Flash message ── */}
      {msg && <div className={`angel-msg angel-msg--${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {/* ── Add / Edit form (collapsible) ── */}
      {(showForm || editingId) && (
        <div className="glass-card" style={{ marginBottom: '2rem', boxShadow: '0 6px 32px rgba(236,72,153,0.08)' }}>
          <h2 className="section-title" style={{ marginBottom: '1.2rem', fontSize: 17, color: '#ec4899', fontWeight: 700 }}>
            {editingId ? '✏️ Edit Setup' : '➕ Add Setup'}
          </h2>
          {accounts.length === 0 ? (
            <p style={{ color: '#a5b4fc', margin: 0 }}>No connected accounts available. Please connect an account first.</p>
          ) : (
            <>
              <div style={{ marginBottom: '1.2rem' }}>
                <label className="angel-label">Select Account</label>
                <select className="angel-input" value={selectedAccount || ''} onChange={(e) => { setSelectedAccount(parseInt(e.target.value)); if (editingId) resetForm() }} style={{ cursor: 'pointer' }}>
                  <option value="">Choose an account…</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>{acc.label} ({acc.client_code})</option>
                  ))}
                </select>
              </div>

              {selectedAccount && !editingId && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <label className="angel-label">Quick Select Common Segments</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {commonSegments.map((seg) => (
                      <button key={seg.name} type="button" onClick={() => handleQuickSelect(seg)}
                        style={{
                          padding: '6px 14px', borderRadius: 20,
                          border: '1px solid rgba(236,72,153,0.3)',
                          background: form.segment_name === seg.name ? 'rgba(236,72,153,0.22)' : 'rgba(236,72,153,0.08)',
                          color: '#ec4899', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                        {seg.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleAdd} autoComplete="off">
                <div className="angel-form-grid">
                  <div>
                    <label className="angel-label">Segment Name *</label>
                    <input className="angel-input" name="segment_name" value={form.segment_name} onChange={handleChange} placeholder="e.g., NIFTY 50" required />
                  </div>
                  <div>
                    <label className="angel-label">Instrument Type</label>
                    <select className="angel-input" name="instrument_type" value={form.instrument_type} onChange={handleChange} style={{ cursor: 'pointer' }}>
                      <option value="">Select type…</option>
                      <option value="INDEX">Index</option>
                      <option value="COMMODITY">Commodity</option>
                      <option value="FOREX">Forex</option>
                      <option value="CRYPTO">Crypto</option>
                      <option value="STOCK">Stock</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="angel-label">Lot Size *</label>
                    <input className="angel-input" type="number" name="lot_size" value={form.lot_size} onChange={handleChange} min="1" required />
                  </div>
                  <div>
                    <label className="angel-label">Default Qty *</label>
                    <input className="angel-input" type="number" name="default_qty" value={form.default_qty} onChange={handleChange} min="1" required />
                  </div>
                  <div>
                    <label className="angel-label">Max Qty (optional)</label>
                    <input className="angel-input" type="number" name="max_qty" value={form.max_qty} onChange={handleChange} min="1" />
                  </div>
                </div>

                {/* Daily Limits */}
                <div style={{ marginTop: '1.2rem', padding: '1rem', borderRadius: 10, background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.1)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📅 Daily Limits &amp; Trading Hours</div>
                  <div className="angel-form-grid">
                    <div>
                      <label className="angel-label">Max Trades / Day</label>
                      <input className="angel-input" type="number" name="max_trades_per_day" value={form.max_trades_per_day} onChange={handleChange} min="1" placeholder="e.g. 5" />
                    </div>
                    <div>
                      <label className="angel-label">Max Loss / Day (pts)</label>
                      <input className="angel-input" type="number" name="max_loss_per_day" value={form.max_loss_per_day} onChange={handleChange} min="0" step="0.5" placeholder="e.g. 200" />
                    </div>
                    <div>
                      <label className="angel-label">Max Profit / Day (pts)</label>
                      <input className="angel-input" type="number" name="max_profit_per_day" value={form.max_profit_per_day} onChange={handleChange} min="0" step="0.5" placeholder="e.g. 500" />
                    </div>
                    <div>
                      <label className="angel-label">Trade Start Time</label>
                      <input className="angel-input" type="time" name="trade_start_time" value={form.trade_start_time} onChange={handleChange} />
                    </div>
                    <div>
                      <label className="angel-label">Trade End Time</label>
                      <input className="angel-input" type="time" name="trade_end_time" value={form.trade_end_time} onChange={handleChange} />
                    </div>
                  </div>
                </div>

                {/* Per-Trade Risk */}
                <div style={{ marginTop: '0.8rem', padding: '1rem', borderRadius: 10, background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.11)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🎯 Per-Trade Risk Parameters</div>
                  <div className="angel-form-grid">
                    <div>
                      <label className="angel-label">Stop Loss (pts)</label>
                      <input className="angel-input" type="number" name="stop_loss_points" value={form.stop_loss_points} onChange={handleChange} min="0" step="0.5" placeholder="e.g. 25" />
                    </div>
                    <div>
                      <label className="angel-label">Target (pts)</label>
                      <input className="angel-input" type="number" name="target_points" value={form.target_points} onChange={handleChange} min="0" step="0.5" placeholder="e.g. 50" />
                    </div>
                    <div>
                      <label className="angel-label">Trailing Stop (pts)</label>
                      <input className="angel-input" type="number" name="trailing_stop_points" value={form.trailing_stop_points} onChange={handleChange} min="0" step="0.5" placeholder="e.g. 15" />
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '0.8rem' }}>
                  <label className="angel-label">Notes (optional)</label>
                  <textarea className="angel-input" name="notes" value={form.notes} onChange={handleChange} placeholder="Add any notes about this setup…" rows="2" style={{ resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="angel-submit" type="submit" disabled={submitting || !selectedAccount}
                    style={{ marginTop: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.03em', boxShadow: '0 2px 16px rgba(236,72,153,0.10)' }}>
                    {submitting ? (editingId ? 'Updating…' : 'Adding…') : (editingId ? '✓ Update Setup' : '＋ Add Setup')}
                  </button>
                  <button type="button" onClick={cancelForm}
                    style={{ padding: '0.75rem 1.5rem', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#a5b4fc', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* ── Account filter pills ── */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginRight: 4 }}>FILTER:</span>
          <button onClick={() => setSelectedAccount(null)}
            style={{
              padding: '5px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${!selectedAccount ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.1)'}`,
              background: !selectedAccount ? 'rgba(236,72,153,0.15)' : 'rgba(255,255,255,0.03)',
              color: !selectedAccount ? '#ec4899' : '#64748b',
            }}>
            All ({allSetups.length})
          </button>
          {accounts.map((acc) => {
            const count = allSetups.filter((s) => s.account_id === acc.id).length
            const active = selectedAccount === acc.id
            return (
              <button key={acc.id} onClick={() => setSelectedAccount(acc.id)}
                style={{
                  padding: '5px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${active ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  background: active ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#38bdf8' : '#64748b',
                }}>
                {acc.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* ── Setup cards ── */}
      {loading && <p style={{ color: 'rgba(255,255,255,0.5)' }}>Loading…</p>}

      {!loading && filteredSetups.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', color: '#64748b', padding: '3rem 1rem' }}>
          {selectedAccount ? 'No setups for this account.' : 'No trade setups yet.'}{' '}
          <button onClick={() => setShowForm(true)} style={{ background: 'none', border: 'none', color: '#ec4899', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
            ＋ Add one
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 16 }}>
        {filteredSetups.map((setup) => {
          const tc = typeColors[setup.instrument_type] || typeColors.OTHER
          return (
            <div key={setup.id} className="glass-card" style={{
              padding: 0, overflow: 'hidden',
              opacity: setup.is_active ? 1 : 0.65,
              boxShadow: setup.is_active ? '0 2px 20px rgba(236,72,153,0.07)' : 'none',
              transition: 'opacity 0.2s',
            }}>
              {/* Card header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '14px 16px 10px', gap: 8,
                background: setup.is_active ? 'rgba(236,72,153,0.04)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {setup.segment_name}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {setup.instrument_type && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: tc.bg, color: tc.color }}>
                        {setup.instrument_type}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#64748b' }}>{accountName(setup.account_id)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => handleToggleActive(setup)}
                  style={{
                    flexShrink: 0, padding: '4px 12px', borderRadius: 20, border: 'none',
                    background: setup.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.13)',
                    color: setup.is_active ? '#10b981' : '#9ca3af',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>
                  {setup.is_active ? '● Active' : '○ Inactive'}
                </button>
              </div>

              {/* Stats row — qty */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {[
                  { label: 'Lot Size',    value: setup.lot_size,          color: '#38bdf8' },
                  { label: 'Default Qty', value: setup.default_qty,       color: '#10b981' },
                  { label: 'Max Qty',     value: setup.max_qty || '—',    color: '#f59e0b' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: '10px 14px', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color, fontFamily: 'monospace' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Stats row — risk */}
              {(setup.stop_loss_points || setup.target_points || setup.max_trades_per_day) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(245,158,11,0.03)' }}>
                  {[
                    { label: 'SL pts',      value: setup.stop_loss_points  ?? '—', color: '#f87171' },
                    { label: 'Target pts',  value: setup.target_points     ?? '—', color: '#34d399' },
                    { label: 'Max Trades',  value: setup.max_trades_per_day ?? '—', color: '#a78bfa' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '8px 14px', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ fontWeight: 700, fontSize: 14, color, fontFamily: 'monospace' }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Stats row — daily limits */}
              {(setup.max_loss_per_day || setup.max_profit_per_day || setup.trade_start_time) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(56,189,248,0.02)' }}>
                  {[
                    { label: 'Max Loss/Day',   value: setup.max_loss_per_day   != null ? setup.max_loss_per_day   : '—', color: '#f87171' },
                    { label: 'Max Profit/Day', value: setup.max_profit_per_day != null ? setup.max_profit_per_day : '—', color: '#34d399' },
                    { label: 'Hours',
                      value: (setup.trade_start_time && setup.trade_end_time)
                        ? `${setup.trade_start_time.slice(0,5)}–${setup.trade_end_time.slice(0,5)}`
                        : '—',
                      color: '#38bdf8' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '8px 14px', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color, fontFamily: 'monospace' }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {setup.notes && (
                <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                  {setup.notes}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px' }}>
                <button type="button" onClick={() => startEdit(setup)}
                  style={{ flex: 1, fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '6px 0', background: 'rgba(56,189,248,0.13)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.22)', cursor: 'pointer' }}>
                  ✏️ Edit
                </button>
                <button type="button" onClick={() => handleDelete(setup.id, setup.segment_name)}
                  style={{ flex: 1, fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '6px 0', background: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer' }}>
                  🗑 Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
