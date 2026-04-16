import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './admin.css'

export default function Orders() {
  const [accounts, setAccounts] = useState([])
  const [setups, setSetups] = useState([])
  const [orders, setOrders] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [selectedSetup, setSelectedSetup] = useState(null)
  const [orderModal, setOrderModal] = useState(false)
  const [selectedDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })

  const [form, setForm] = useState({
    quantity: '',
    side: 'BUY',
    price: '',
    order_type: 'MARKET',
  })

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  // Load accounts
  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/angelone/accounts')
      const connected = data.filter((a) => a.connected)
      setAccounts(connected)
      if (connected.length > 0 && !selectedAccount) {
        setSelectedAccount(connected[0].id)
      }
    } catch {
      flash('Failed to load accounts', 'error')
    }
  }, [selectedAccount])

  // Load setups for selected account
  const loadSetups = useCallback(async () => {
    if (!selectedAccount) return
    try {
      const { data } = await axios.get(`/api/trade-setups/account/${selectedAccount}`)
      setSetups(data)
      if (data.length > 0 && !selectedSetup) {
        setSelectedSetup(data[0].id)
      }
    } catch {
      flash('Failed to load setups', 'error')
    }
  }, [selectedAccount, selectedSetup])

  // Load orders
  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    try {
      const { data } = await axios.get('/api/orders?sync=1')
      setOrders(data)
    } catch {
      if (!silent) flash('Failed to load orders', 'error')
    }
  }, [])

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/orders/stats/summary')
      setStats(data)
    } catch {
      // Silent fail for stats
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadAccounts(), loadOrders(), loadStats()]).finally(() => setLoading(false))
  }, [loadAccounts, loadOrders, loadStats])

  useEffect(() => {
    const timer = setInterval(() => {
      loadOrders({ silent: true })
      loadStats()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadOrders, loadStats])

  useEffect(() => {
    loadSetups()
  }, [loadSetups])

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'number' ? (value ? parseFloat(value) : '') : value,
    }))
  }

  const currentSetup = setups.find((s) => s.id === selectedSetup)

  const todayStr = new Date().toISOString().slice(0, 10)

  function FilterLabel() {
    const label = selectedDate ? (selectedDate === todayStr ? `Today (${selectedDate})` : selectedDate) : 'All dates'
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#c7d2fe' }}>Showing:</span>
        <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', color: '#a5b4fc' }}>
          {label}
        </span>
      </div>
    )
  }

  const handlePlaceOrder = async (e) => {
    e.preventDefault()
    if (!selectedAccount || !selectedSetup) {
      flash('Please select account and setup', 'error')
      return
    }
    if (!form.quantity || form.quantity <= 0) {
      flash('Quantity must be greater than 0', 'error')
      return
    }

    setSubmitting(true)
    try {
      const { data } = await axios.post('/api/orders/execute', {
        account_id: selectedAccount,
        setup_id: selectedSetup,
        quantity: parseInt(form.quantity),
        side: form.side.toUpperCase(),
        price: form.price ? parseFloat(form.price) : null,
        order_type: form.order_type,
      })

      flash(`Order placed! ID: ${data.order_id}`, 'success')
      setForm({ quantity: '', side: 'BUY', price: '', order_type: 'MARKET' })
      setOrderModal(false)
      await loadOrders()
      await loadStats()
    } catch (err) {
      flash(err.response?.data?.error || 'Order placement failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelOrder = async (orderId) => {
    if (!window.confirm('Cancel this order?')) return
    try {
      await axios.put(`/api/orders/${orderId}/cancel`)
      flash('Order cancelled', 'success')
      await loadOrders()
      await loadStats()
    } catch (err) {
      flash(err.response?.data?.error || 'Cancel failed', 'error')
    }
  }

  const accountLabel = (id) => accounts.find((a) => a.id === id)?.label || 'Unknown'
  const setupLabel = (id) => setups.find((s) => s.id === id)?.segment_name || 'Unknown'

  const getStatusColor = (status) => {
    const colors = {
      PENDING: '#f59e0b',
      ACCEPTED: '#10b981',
      FILLED: '#3b82f6',
      PARTIAL: '#ec4899',
      CANCELLED: '#6b7280',
      REJECTED: '#ef4444',
      FAILED: '#dc2626',
    }
    return colors[status] || '#9ca3af'
  }

  const isPaperTrade = (order) => {
    const raw = order?.details
    if (!raw) return false
    if (typeof raw === 'object') {
      return String(raw.trade_mode || '').toUpperCase() === 'PAPER'
    }
    try {
      const parsed = JSON.parse(raw)
      return String(parsed.trade_mode || '').toUpperCase() === 'PAPER'
    } catch {
      return false
    }
  }

  const accountOrders = selectedAccount
    ? orders.filter((o) => o.account_id === selectedAccount)
    : orders

  // Filter by selected date (default: today). If `selectedDate` is falsy, show all dates.
  const filteredByDate = accountOrders.filter((o) => {
    if (!selectedDate) return true
    try {
      const orderDate = new Date(o.created_at).toISOString().slice(0, 10)
      return orderDate === selectedDate
    } catch (err) {
      return false
    }
  })

  // Strict today-only view
  const displayOrders = filteredByDate

  const openStatuses = ['PENDING', 'ACCEPTED', 'PARTIAL']
  const openOrders = (selectedAccount ? orders.filter((o) => o.account_id === selectedAccount) : orders)
    .filter((o) => openStatuses.includes(String(o.status || '').toUpperCase()))

  const activePaperOrders = (selectedAccount ? orders.filter((o) => o.account_id === selectedAccount) : orders)
    .filter((o) => openStatuses.includes(String(o.status || '').toUpperCase()))
    .filter((o) => isPaperTrade(o))

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #10b981 60%, #059669 100%)',
            boxShadow: '0 2px 16px rgba(16,185,129,0.12)', color: '#fff', fontSize: 20
          }}>📈</span>
          Place Order
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
          Execute trades based on your segment setups
        </p>
      </div>

      {/* Stat cards */}
      <div style={{
        display: 'flex',
        gap: 22,
        margin: '2.2rem 0 1.7rem',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      }}>
        {[
          { label: 'Pending', value: stats.pending, color: '#f59e0b' },
          { label: 'Accepted', value: stats.accepted, color: '#10b981' },
          { label: 'Filled', value: stats.filled, color: '#3b82f6' },
          { label: 'Cancelled', value: stats.cancelled, color: '#9ca3af' },
          { label: 'Failed', value: stats.failed, color: '#ef4444' },
        ].map((stat) => (
          <div key={stat.label} className="stat-card blue" style={{ minWidth: 150, flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 220 }}>
            <span style={{ fontSize: 20, color: stat.color, background: `${stat.color}20`, borderRadius: 10, padding: 7 }}>
              ●
            </span>
            <div>
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value" style={{ fontSize: 22, color: stat.color }}>{stat.value || 0}</div>
            </div>
          </div>
        ))}
      </div>

      {msg && <div className={`angel-msg angel-msg--${msg.type}`}>{msg.text}</div>}

      {/* Order form */}
      <div className="glass-card" style={{ marginBottom: '2.2rem', boxShadow: '0 6px 32px rgba(16,185,129,0.08)' }}>
        <h2 className="section-title" style={{ marginBottom: '1.2rem', fontSize: 17, color: '#a5b4fc', fontWeight: 700 }}>
          Place New Order
        </h2>

        {accounts.length === 0 ? (
          <p style={{ color: '#a5b4fc', margin: 0 }}>No connected accounts. Connect an account first.</p>
        ) : (
          <form onSubmit={handlePlaceOrder}>
            <div className="angel-form-grid">
              <div>
                <label className="angel-label">Account *</label>
                <select
                  className="angel-input"
                  value={selectedAccount || ''}
                  onChange={(e) => {
                    setSelectedAccount(parseInt(e.target.value))
                    setSelectedSetup(null)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">Select account...</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="angel-label">Trade Setup *</label>
                <select
                  className="angel-input"
                  value={selectedSetup || ''}
                  onChange={(e) => setSelectedSetup(parseInt(e.target.value))}
                  disabled={!selectedAccount || setups.length === 0}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">Select setup...</option>
                  {setups.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.segment_name} (Lot: {s.lot_size}, Qty: {s.default_qty})
                    </option>
                  ))}
                </select>
              </div>

              {currentSetup && (
                <>
                  <div style={{ gridColumn: 'span 2', padding: '12px 16px', background: 'rgba(16,185,129,0.1)', borderRadius: 10, border: '1px solid rgba(16,185,129,0.22)' }}>
                    <div style={{ fontSize: 13, color: '#a5b4fc', marginBottom: 8 }}>
                      📊 <strong>Setup Details:</strong> Type: {currentSetup.instrument_type}, Lot: {currentSetup.lot_size}, 
                      Default Qty: {currentSetup.default_qty}, 
                      {currentSetup.max_qty ? ` Max: ${currentSetup.max_qty}` : ' No Max'}
                    </div>
                    {currentSetup.notes && (
                      <div style={{ fontSize: 12, color: '#10b981' }}>📝 {currentSetup.notes}</div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="angel-label">Side *</label>
                <select
                  className="angel-input"
                  name="side"
                  value={form.side}
                  onChange={handleChange}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="BUY">🟢 BUY</option>
                  <option value="SELL">🔴 SELL</option>
                </select>
              </div>

              <div>
                <label className="angel-label">Quantity *</label>
                <input
                  className="angel-input"
                  type="number"
                  name="quantity"
                  value={form.quantity}
                  onChange={handleChange}
                  placeholder={currentSetup ? `Default: ${currentSetup.default_qty}` : 'Enter quantity'}
                  min="1"
                  required
                />
              </div>

              <div>
                <label className="angel-label">Order Type</label>
                <select
                  className="angel-input"
                  name="order_type"
                  value={form.order_type}
                  onChange={handleChange}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="STOP">STOP</option>
                </select>
              </div>

              <div>
                <label className="angel-label">Price (if LIMIT/STOP)</label>
                <input
                  className="angel-input"
                  type="number"
                  name="price"
                  value={form.price}
                  onChange={handleChange}
                  placeholder="Enter price"
                  step="0.01"
                />
              </div>
            </div>

            <button
              className="angel-submit"
              type="submit"
              disabled={submitting || !selectedAccount || !selectedSetup}
              style={{ marginTop: 10, fontSize: 16, fontWeight: 700, letterSpacing: '0.03em', boxShadow: '0 2px 16px rgba(16,185,129,0.10)' }}
            >
              {submitting ? (
                '⏳ Placing Order...'
              ) : (
                <>
                  <span style={{ fontSize: 18, marginRight: 6 }}>🚀</span>
                  {form.side === 'BUY' ? 'Buy' : 'Sell'} {currentSetup?.segment_name || 'Order'}
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Orders table */}
      <div className="table-card" style={{ marginTop: 24, boxShadow: '0 2px 18px rgba(56,189,248,0.08)' }}>
        <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="table-title" style={{ fontWeight: 700, fontSize: 16, color: '#a5b4fc' }}>
            Active Paper Trades ({activePaperOrders.length}) {selectedAccount && `(${accountLabel(selectedAccount)})`}
          </span>
        </div>
        <div className="angel-table-scroll">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Account</th>
                <th>Segment</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {activePaperOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    No active paper trades
                  </td>
                </tr>
              ) : (
                activePaperOrders.map((order) => (
                  <tr key={`paper-active-${order.id}`}>
                    <td style={{ fontWeight: 600, color: '#38bdf8' }}>#{order.id}</td>
                    <td>{accountLabel(order.account_id)}</td>
                    <td style={{ fontWeight: 600 }}>{order.segment_name}</td>
                    <td style={{ color: order.side === 'BUY' ? '#10b981' : '#ef4444', fontWeight: 700 }}>{order.side}</td>
                    <td style={{ color: '#38bdf8', fontWeight: 600 }}>{order.quantity}</td>
                    <td>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: `${getStatusColor(order.status)}20`,
                        color: getStatusColor(order.status),
                        fontSize: 11,
                        fontWeight: 700,
                      }}>
                        {order.status}
                      </span>
                    </td>
                    <td style={{ color: '#a5b4fc', fontSize: '0.9em' }}>{new Date(order.created_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open / Current Orders */}
      <div className="table-card" style={{ marginTop: 24, boxShadow: '0 2px 18px rgba(16,185,129,0.07)' }}>
        <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="table-title" style={{ fontWeight: 700, fontSize: 16, color: '#a5b4fc' }}>
            Open / Current Orders ({openOrders.length}) {selectedAccount && `(${accountLabel(selectedAccount)})`}
          </span>
        </div>

        <div className="angel-table-scroll">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Account</th>
                <th>Segment</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {openOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    No open orders
                  </td>
                </tr>
              ) : (
                openOrders.map((order) => (
                  <tr key={`open-${order.id}`} style={{ transition: 'background 0.18s' }}>
                    <td style={{ fontWeight: 600, color: '#38bdf8' }}>#{order.id}</td>
                    <td>{accountLabel(order.account_id)}</td>
                    <td style={{ fontWeight: 600 }}>{order.segment_name}</td>
                    <td>
                      <span style={{
                        fontWeight: 700,
                        color: order.side === 'BUY' ? '#10b981' : '#ef4444',
                        fontSize: 12,
                      }}>
                        {order.side === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                      </span>
                    </td>
                    <td style={{ color: '#38bdf8', fontWeight: 600 }}>{order.quantity}</td>
                    <td style={{ color: '#a5b4fc' }}>{order.price ? `₹${order.price}` : '—'}</td>
                    <td style={{ fontSize: 12, color: '#ec4899' }}>{order.order_type}</td>
                    <td>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: `${getStatusColor(order.status)}20`,
                        color: getStatusColor(order.status),
                        fontSize: 11,
                        fontWeight: 700,
                      }}>
                        {order.status}
                      </span>
                    </td>
                    <td style={{ color: '#a5b4fc', fontSize: '0.9em' }}>{new Date(order.created_at).toLocaleString()}</td>
                    <td>
                      {['PENDING', 'ACCEPTED'].includes(order.status) && (
                        <button
                          type="button"
                          onClick={() => handleCancelOrder(order.id)}
                          style={{
                            fontWeight: 700, fontSize: 11, borderRadius: 6, padding: '4px 10px',
                            background: 'rgba(239,68,68,0.13)', color: '#ef4444',
                            border: '1px solid rgba(239,68,68,0.22)', cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card" style={{ marginTop: 32, boxShadow: '0 2px 18px rgba(16,185,129,0.07)' }}>
        <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="table-title" style={{ fontWeight: 700, fontSize: 16, color: '#a5b4fc' }}>
              Today's Orders {selectedAccount && `(${accountLabel(selectedAccount)})`}
            </span>
            <FilterLabel />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#a5b4fc', fontSize: 13 }}>Showing: Today</span>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(255,255,255,0.5)', padding: '1rem' }}>Loading…</p>
        ) : (
          <div className="angel-table-scroll">
            {displayOrders.length === 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: '#fef3c7', fontSize: 13 }}>
                  No orders for today.
                </div>
                <div />
              </div>
            )}
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Account</th>
                  <th>Segment</th>
                  <th>Side</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                      {selectedAccount ? 'No orders for this account/date' : 'No orders yet'}
                    </td>
                  </tr>
                ) : (
                  displayOrders.map((order) => (
                    <tr key={order.id} style={{ transition: 'background 0.18s' }}>
                      <td style={{ fontWeight: 600, color: '#38bdf8' }}>#{order.id}</td>
                      <td>{accountLabel(order.account_id)}</td>
                      <td style={{ fontWeight: 600 }}>{order.segment_name}</td>
                      <td>
                        <span style={{
                          fontWeight: 700,
                          color: order.side === 'BUY' ? '#10b981' : '#ef4444',
                          fontSize: 12,
                        }}>
                          {order.side === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                        </span>
                      </td>
                      <td style={{ color: '#38bdf8', fontWeight: 600 }}>{order.quantity}</td>
                      <td style={{ color: '#a5b4fc' }}>{order.price ? `₹${order.price}` : '—'}</td>
                      <td style={{ fontSize: 12, color: '#ec4899' }}>{order.order_type}</td>
                      <td>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          background: `${getStatusColor(order.status)}20`,
                          color: getStatusColor(order.status),
                          fontSize: 11,
                          fontWeight: 700,
                        }}>
                          {order.status}
                        </span>
                      </td>
                      <td style={{ color: '#a5b4fc', fontSize: '0.9em' }}>
                        {new Date(order.created_at).toLocaleString()}
                      </td>
                      <td>
                        {['PENDING', 'ACCEPTED'].includes(order.status) && (
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(order.id)}
                            style={{
                              fontWeight: 700, fontSize: 11, borderRadius: 6, padding: '4px 10px',
                              background: 'rgba(239,68,68,0.13)', color: '#ef4444',
                              border: '1px solid rgba(239,68,68,0.22)', cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
