import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './admin.css'

const isFundsOrMargin = (title) =>
  title === 'Funds' || title === 'Margin / RMS'

const FUNDS_LABELS = {
  net:                    { label: 'Net Balance',       group: 'available', highlight: true },
  availablecash:          { label: 'Available Cash',    group: 'available' },
  availableintradaypayin: { label: 'Intraday Pay-in',   group: 'available' },
  availablelimitmargin:   { label: 'Limit Margin',      group: 'available' },
  collateral:             { label: 'Collateral',        group: 'available' },
  m2munrealized:          { label: 'M2M Unrealized',    group: 'm2m' },
  m2mrealized:            { label: 'M2M Realized',      group: 'm2m' },
  utiliseddebits:         { label: 'Utilised Debits',   group: 'utilised' },
  utilisedspan:           { label: 'SPAN Margin',       group: 'utilised' },
  utilisedoptionpremium:  { label: 'Option Premium',    group: 'utilised' },
  utilisedholdingsales:   { label: 'Holding Sales',     group: 'utilised' },
  utilisedexposure:       { label: 'Exposure Margin',   group: 'utilised' },
  utilisedturnover:       { label: 'Turnover',          group: 'utilised' },
  utilisedpayout:         { label: 'Payout',            group: 'utilised' },
}

const GROUP_META = {
  available: { title: 'Available Funds', color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
  m2m:       { title: 'Mark-to-Market',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  utilised:  { title: 'Utilised Margin', color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
}

function fmt(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return String(val)
  return `₹${n.toFixed(2)}`
}

function FundsMarginView({ data }) {
  // Flatten nested data if API wraps it
  const flat = data && typeof data === 'object' && !Array.isArray(data)
    ? (data.data ?? data)
    : data || {}

  // Group known fields
  const groups = { available: [], m2m: [], utilised: [] }
  const unknown = []

  Object.entries(flat).forEach(([key, value]) => {
    const meta = FUNDS_LABELS[key.toLowerCase()]
    if (meta) {
      groups[meta.group].push({ key, label: meta.label, value, highlight: !!meta.highlight })
    } else {
      unknown.push({ key, value })
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {Object.entries(groups).map(([groupKey, rows]) => {
        if (rows.length === 0) return null
        const { title, color, bg } = GROUP_META[groupKey]
        return (
          <div key={groupKey} style={{ borderRadius: 12, background: bg, border: `1px solid ${color}22`, overflow: 'hidden' }}>
            <div style={{
              padding: '8px 16px', background: `${color}18`,
              borderBottom: `1px solid ${color}22`,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color,
            }}>
              {title}
            </div>
            {rows.map(({ key, label, value, highlight }) => {
              const displayVal = fmt(value)
              const isZero = displayVal === '₹0.00'
              return (
                <div key={key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: highlight ? '12px 16px' : '9px 16px',
                  borderBottom: `1px solid ${color}11`,
                  background: highlight ? `${color}10` : 'transparent',
                }}>
                  <span style={{ fontSize: highlight ? 14 : 13, fontWeight: highlight ? 700 : 500, color: highlight ? '#e2e8f0' : '#94a3b8' }}>
                    {label}
                  </span>
                  <span style={{
                    fontSize: highlight ? 16 : 13,
                    fontWeight: highlight ? 800 : 600,
                    color: displayVal === '—' || isZero ? '#475569' : color,
                    fontFamily: 'monospace',
                  }}>
                    {displayVal}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
      {unknown.length > 0 && (
        <div style={{ borderRadius: 12, background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.15)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', borderBottom: '1px solid rgba(100,116,139,0.15)' }}>
            Other
          </div>
          {unknown.map(({ key, value }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid rgba(100,116,139,0.08)' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>{key}</span>
              <span style={{ fontSize: 13, color: '#64748b', fontFamily: 'monospace' }}>
                {value === null ? '—' : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AngelOneAccounts() {
  const [accounts, setAccounts]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState(null)       // { text, type: 'success'|'error' }
  const [submitting, setSubmitting] = useState(false)
  const [dataModal, setDataModal] = useState({ open: false, title: '', payload: null })
  const [expandedAccount, setExpandedAccount] = useState(null)
  const [fundsCache, setFundsCache] = useState({})
  const [fundsLoading, setFundsLoading] = useState({})
  const [form, setForm] = useState({
    label: '', client_code: '', password: '', totp_secret: '', api_key: '',
  })

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/angelone/accounts')
      setAccounts(data)
    } catch {
      flash('Failed to load accounts', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const handleAdd = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await axios.post('/api/angelone/accounts', form)
      setForm({ label: '', client_code: '', password: '', totp_secret: '', api_key: '' })
      flash('Account added successfully')
      loadAccounts()
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to add account', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConnect = async (id) => {
    try {
      await axios.post(`/api/angelone/connect/${id}`)
      flash('Account connected')
      await loadAccounts()
    } catch (err) {
      flash(err.response?.data?.error || 'Connect failed', 'error')
    }
  }

  const handleDisconnect = async (id) => {
    try {
      await axios.post(`/api/angelone/disconnect/${id}`)
      flash('Account disconnected')
      loadAccounts()
      // Log out user after disconnect
      localStorage.removeItem('pt_auth')
      window.location.href = '/login'
    } catch (err) {
      flash(err.response?.data?.error || 'Disconnect failed', 'error')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this account?')) return
    try {
      await axios.delete(`/api/angelone/accounts/${id}`)
      flash('Account removed')
      loadAccounts()
    } catch (err) {
      flash(err.response?.data?.error || 'Delete failed', 'error')
    }
  }



  // Connect All handler (restored)
  const handleConnectAll = async () => {
    try {
      const { data } = await axios.post('/api/angelone/connect-all')
      const ok   = data.filter((r) => r.status === 'connected').length
      const fail = data.filter((r) => r.status === 'failed').length
      flash(`Connected: ${ok}  Failed: ${fail}`, fail > 0 ? 'error' : 'success')
      loadAccounts()
    } catch (err) {
      flash(err.response?.data?.error || 'Connect All failed', 'error')
    }
  }

  // View token handler
  const handleViewToken = async (id) => {
    try {
      const { data } = await axios.get(`/api/angelone/token/${id}`)
      if (!data.jwt_token && !data.feed_token) {
        flash('No token available. Connect first.', 'error')
        return
      }
      setDataModal({
        open: true,
        title: 'Token Details',
        payload: {
          jwt_token: data.jwt_token || '(none)',
          feed_token: data.feed_token || '(none)',
          connected: data.connected,
        },
      })
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to fetch token', 'error')
    }
  }

  const openDataModal = (title, payload) => {
    setDataModal({ open: true, title, payload })
  }

  const closeDataModal = () => {
    setDataModal({ open: false, title: '', payload: null })
  }

  const handleViewProfile = async (id) => {
    try {
      const { data } = await axios.get(`/api/angelone/profile/${id}`)
      openDataModal('Profile', data)
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to fetch profile', 'error')
    }
  }

  // Toggle inline funds/margin view for an account (fetches once and caches)
  const toggleFundsFor = async (id, type = 'funds') => {
    // If already expanded the same account, collapse it
    if (expandedAccount && expandedAccount.id === id && expandedAccount.type === type) {
      setExpandedAccount(null)
      return
    }

    // Use cache if available
    const cacheKey = `${type}:${id}`
    if (fundsCache[cacheKey]) {
      setExpandedAccount({ id, type })
      return
    }

    // Fetch and cache
    setFundsLoading((s) => ({ ...s, [cacheKey]: true }))
    try {
      const url = type === 'funds' ? `/api/angelone/funds/${id}` : `/api/angelone/margin/${id}`
      const { data } = await axios.get(url)
      setFundsCache((c) => ({ ...c, [cacheKey]: data }))
      setExpandedAccount({ id, type })
    } catch (err) {
      flash(err.response?.data?.error || `Failed to fetch ${type} details`, 'error')
    } finally {
      setFundsLoading((s) => ({ ...s, [cacheKey]: false }))
    }
  }

  const total     = accounts.length
  const connected = accounts.filter((a) => a.connected).length

  const maskKey = (key) => key ? `****${String(key).slice(-4)}` : '—'

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #38bdf8 60%, #6366f1 100%)',
            boxShadow: '0 2px 16px rgba(56,189,248,0.12)', color: '#fff', fontSize: 20
          }}>🔗</span>
          AngelOne Accounts
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
          Manage broker accounts and connect via SmartAPI
        </p>
      </div>

      {/* Stat cards - horizontal row */}
      <div style={{
        display: 'flex',
        gap: 22,
        margin: '2.2rem 0 1.7rem',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      }}>
        <div className="stat-card blue" style={{ minWidth: 180, flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 16, maxWidth: 320 }}>
          <span style={{ fontSize: 22, color: '#38bdf8', background: 'rgba(56,189,248,0.13)', borderRadius: 10, padding: 7, marginRight: 2 }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20"><path fill="#38bdf8" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14.5A6.5 6.5 0 1110 3.5a6.5 6.5 0 010 13z"/></svg>
          </span>
          <div>
            <div className="stat-label">Total</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{total}</div>
          </div>
        </div>
        <div className="stat-card green" style={{ minWidth: 180, flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 16, maxWidth: 320 }}>
          <span style={{ fontSize: 22, color: '#22c55e', background: 'rgba(34,197,94,0.13)', borderRadius: 10, padding: 7, marginRight: 2 }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#22c55e" strokeWidth="2" fill="none"/><circle cx="10" cy="10" r="5" fill="#22c55e"/></svg>
          </span>
          <div>
            <div className="stat-label">Connected</div>
            <div className="stat-value" style={{ color: '#22c55e', fontSize: 22 }}>{connected}</div>
          </div>
        </div>
        <div className="stat-card amber" style={{ minWidth: 180, flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 16, maxWidth: 320 }}>
          <span style={{ fontSize: 22, color: '#f59e0b', background: 'rgba(245,158,11,0.13)', borderRadius: 10, padding: 7, marginRight: 2 }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#f59e0b" strokeWidth="2" fill="none"/><circle cx="10" cy="10" r="5" fill="#f59e0b"/></svg>
          </span>
          <div>
            <div className="stat-label">Disconnected</div>
            <div className="stat-value" style={{ color: '#f59e0b', fontSize: 22 }}>{total - connected}</div>
          </div>
        </div>
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`angel-msg angel-msg--${msg.type}`}>{msg.text}</div>
      )}

      {/* Add account form */}
      <div className="glass-card" style={{ marginBottom: '2.2rem', boxShadow: '0 6px 32px rgba(56,189,248,0.08)' }}>
        <h2 className="section-title" style={{ marginBottom: '1.2rem', fontSize: 17, color: '#a5b4fc', fontWeight: 700 }}>Add Account</h2>
        <form onSubmit={handleAdd} autoComplete="off">
          <div className="angel-form-grid">
            <div>
              <label className="angel-label">Label</label>
              <input
                className="angel-input"
                name="label"
                value={form.label}
                onChange={handleChange}
                placeholder="e.g. Main Account"
                required
              />
            </div>
            <div>
              <label className="angel-label">Client Code</label>
              <input
                className="angel-input"
                name="client_code"
                value={form.client_code}
                onChange={handleChange}
                placeholder="AngelOne client ID"
                required
              />
            </div>
            <div>
              <label className="angel-label">Password</label>
              <input
                className="angel-input"
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Trading password"
                required
              />
            </div>
            <div>
              <label className="angel-label">TOTP Secret (base32)</label>
              <input
                className="angel-input"
                name="totp_secret"
                value={form.totp_secret}
                onChange={handleChange}
                placeholder="Base32 TOTP secret"
                required
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="angel-label">API Key</label>
              <input
                className="angel-input"
                name="api_key"
                value={form.api_key}
                onChange={handleChange}
                placeholder="SmartAPI private key"
                required
              />
            </div>
          </div>
          <button className="angel-submit" type="submit" disabled={submitting} style={{ marginTop: 10, fontSize: 16, fontWeight: 700, letterSpacing: '0.03em', boxShadow: '0 2px 16px rgba(56,189,248,0.10)' }}>
            {submitting ? 'Adding…' : <><span style={{fontSize:18,marginRight:6}}>＋</span>Add Account</>}
          </button>
        </form>
      </div>

      {/* Accounts table */}
      <div className="table-card" style={{ marginTop: 32, boxShadow: '0 2px 18px rgba(56,189,248,0.07)' }}>
        <div className="table-header" style={{ position: 'relative' }}>
          <span className="table-title" style={{ fontWeight: 700, fontSize: 16, color: '#a5b4fc' }}>All Accounts</span>
          <button
            className="angel-connect-all"
            style={{
              position: 'absolute', right: 24, top: 18, zIndex: 2,
              background: 'linear-gradient(90deg, #38bdf8 0%, #6366f1 100%)',
              color: '#fff', fontWeight: 700, fontSize: 14, boxShadow: '0 2px 12px rgba(56,189,248,0.13)',
              border: 'none', padding: '8px 22px', borderRadius: 10
            }}
            onClick={handleConnectAll} disabled={!total}
          >
            <span style={{ fontSize: 17, marginRight: 7 }}>⚡</span>Connect All
          </button>
        </div>
        {loading ? (
          <p style={{ color: 'rgba(255,255,255,0.5)', padding: '1rem' }}>Loading…</p>
        ) : (
          <div className="angel-table-scroll">
          <table className="data-table" style={{ fontSize: 14 }}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Client Code</th>
                <th>API Key</th>
                <th>Status</th>
                <th>Connected At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    No accounts added yet
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
                  <>
                  <tr key={acc.id} style={{ transition: 'background 0.18s', background: acc.connected ? 'rgba(34,197,94,0.04)' : undefined }}>
                    <td style={{ fontWeight: 600 }}>{acc.label}</td>
                    <td><code style={{ fontSize: '0.95em', color: '#38bdf8', fontWeight: 600 }}>{acc.client_code}</code></td>
                    <td><code style={{ fontSize: '0.95em', color: '#a5b4fc' }}>{maskKey(acc.api_key)}</code></td>
                    <td>
                      <span className={`badge ${acc.connected ? 'badge-filled' : 'badge-open'}`} style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.01em', padding: '4px 14px' }}>
                        <span className="dot" style={{ background: acc.connected ? '#22c55e' : '#f59e0b', boxShadow: `0 0 8px ${acc.connected ? '#22c55e' : '#f59e0b'}` }} />
                        {acc.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </td>
                    <td style={{ color: '#a5b4fc', fontSize: '0.93em', fontWeight: 500 }}>
                      {acc.connected_at
                        ? new Date(acc.connected_at).toLocaleString()
                        : '—'}
                    </td>
                    <td>
                      <div className="angel-actions-wrap">
                        {acc.connected ? (
                          <button
                            className="angel-btn-connect"
                            style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(239,68,68,0.13)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)' }}
                            onClick={() => handleDisconnect(acc.id)}
                            disabled={submitting}
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            className="angel-btn-connect"
                            style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(34,197,94,0.13)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.22)' }}
                            onClick={() => handleConnect(acc.id)}
                            disabled={submitting}
                          >
                            Connect
                          </button>
                        )}
                        <button
                          className="angel-btn-connect"
                          style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(56,189,248,0.13)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.22)' }}
                          onClick={() => handleViewToken(acc.id)}
                        >
                          View Token
                        </button>
                        {/* Profile button removed per UX request */}
                        <button
                          className="angel-btn-connect"
                          style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(245,158,11,0.13)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.24)' }}
                          onClick={() => toggleFundsFor(acc.id, 'margin')}
                        >
                          Margin
                        </button>
                        <button
                          className="angel-btn-connect"
                          style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(59,130,246,0.13)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.24)' }}
                          onClick={() => toggleFundsFor(acc.id, 'funds')}
                        >
                          Funds
                        </button>
                        <button
                          className="angel-btn-delete"
                          style={{ fontWeight: 700, fontSize: 13, borderRadius: 8, padding: '6px 16px', background: 'rgba(248,113,113,0.13)', color: '#f87171', border: '1px solid rgba(248,113,113,0.22)' }}
                          onClick={() => handleDelete(acc.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedAccount && expandedAccount.id === acc.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ padding: 14 }}>
                          {fundsLoading[`${expandedAccount.type}:${acc.id}`] ? (
                            <div style={{ color: 'rgba(255,255,255,0.6)' }}>Loading {expandedAccount.type}…</div>
                          ) : (
                            <FundsMarginView data={fundsCache[`${expandedAccount.type}:${acc.id}`]} />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {dataModal.open && (
        <div className="angel-modal-overlay" onClick={closeDataModal}>
          <div className="angel-modal-card" style={{ maxWidth: 560, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="angel-modal-header">
              <h3>{dataModal.title}</h3>
              <button className="angel-modal-close" onClick={closeDataModal}>Close</button>
            </div>
            <div className="angel-modal-content">
              {isFundsOrMargin(dataModal.title) && dataModal.payload
                ? <FundsMarginView data={dataModal.payload} />
                : dataModal.payload && typeof dataModal.payload === 'object'
                  ? Object.entries(dataModal.payload).map(([key, value]) => (
                      <div className="angel-modal-row" key={key}>
                        <span className="angel-modal-key">{key}</span>
                        <span className="angel-modal-value">
                          {typeof value === 'object' && value !== null
                            ? JSON.stringify(value)
                            : String(value)}
                        </span>
                      </div>
                    ))
                  : <pre className="angel-modal-pre">{String(dataModal.payload ?? '')}</pre>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
