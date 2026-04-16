import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './admin.css'

// ─── helpers ─────────────────────────────────────────────────────────────────

const FUNDS_LABELS = {
  net:                    { label: 'Net Balance',       group: 'available', highlight: true },
  availablecash:          { label: 'Available Cash',    group: 'available', highlight: true },
  availableintradaypayin: { label: 'Intraday Pay-in',   group: 'available' },
  availablelimitmargin:   { label: 'Limit Margin',      group: 'available' },
  collateral:             { label: 'Collateral',        group: 'available' },
  m2munrealized:          { label: 'M2M Unrealized',    group: 'm2m' },
  m2mrealized:            { label: 'M2M Realized',      group: 'm2m' },
  utiliseddebits:         { label: 'Utilised Debits',   group: 'utilised', highlight: true },
  utilisedspan:           { label: 'SPAN Margin',       group: 'utilised' },
  utilisedoptionpremium:  { label: 'Option Premium',    group: 'utilised' },
  utilisedholdingsales:   { label: 'Holding Sales',     group: 'utilised' },
  utilisedexposure:       { label: 'Exposure Margin',   group: 'utilised' },
  utilisedturnover:       { label: 'Turnover',          group: 'utilised' },
  utilisedpayout:         { label: 'Payout',            group: 'utilised' },
}

const GROUP_META = {
  available: { title: 'Available Funds', color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.18)' },
  m2m:       { title: 'Mark-to-Market',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.18)' },
  utilised:  { title: 'Utilised Margin', color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.18)' },
}

function fmt(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return String(val)
  return `₹${n.toFixed(2)}`
}

const unwrap = (d) => {
  if (!d) return null
  if (Array.isArray(d?.data)) return d.data[0] ?? null
  if (d?.data && typeof d.data === 'object') return d.data
  return d
}

const safe = (res) => (res.status === 'fulfilled' ? res.value?.data : null)

// ─── FundsMarginView ──────────────────────────────────────────────────────────

function FundsMarginView({ data }) {
  if (!data) return <div style={{ color: '#94a3b8', fontSize: 14 }}>No data available.</div>
  const flat = typeof data === 'object' && !Array.isArray(data)
    ? (data.data ?? data) : data

  const groups = { available: [], m2m: [], utilised: [], unknown: [] }
  Object.entries(flat).forEach(([key, value]) => {
    const info = FUNDS_LABELS[key]
    if (info) {
      groups[info.group]?.push({ key, label: info.label, value, highlight: !!info.highlight })
    } else if (typeof value !== 'object') {
      groups.unknown.push({ key, value })
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(GROUP_META).map(([groupKey, { title, color, bg, border }]) => {
        const rows = groups[groupKey]
        if (!rows || rows.length === 0) return null
        return (
          <div key={groupKey} style={{ borderRadius: 12, background: bg, border: `1px solid ${border}`, overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color, borderBottom: `1px solid ${border}` }}>
              {title}
            </div>
            {rows.map(({ key, label, value, highlight }) => {
              const dv = (value === null || value === undefined || value === '') ? '—' : fmt(value)
              const isZero = parseFloat(value) === 0
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: highlight ? '11px 16px' : '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: highlight ? `${color}10` : 'transparent' }}>
                  <span style={{ fontSize: highlight ? 14 : 13, fontWeight: highlight ? 700 : 500, color: highlight ? '#e2e8f0' : '#94a3b8' }}>{label}</span>
                  <span style={{ fontSize: highlight ? 16 : 13, fontWeight: highlight ? 800 : 600, color: dv === '—' || isZero ? '#475569' : color, fontFamily: 'monospace' }}>{dv}</span>
                </div>
              )
            })}
          </div>
        )
      })}
      {groups.unknown.length > 0 && (
        <div style={{ borderRadius: 12, background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.15)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', borderBottom: '1px solid rgba(100,116,139,0.15)' }}>Other</div>
          {groups.unknown.map(({ key, value }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid rgba(100,116,139,0.08)' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>{key}</span>
              <span style={{ fontSize: 13, color: '#64748b', fontFamily: 'monospace' }}>{value === null ? '—' : String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── StatBlock ─────────────────────────────────────────────────────────────────

function StatBlock({ label, icon, value }) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span>{icon}</span> {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{value}</div>
    </div>
  )
}

// ─── AccountCard ───────────────────────────────────────────────────────────────

function AccountCard({ acc, onConnect, onDisconnect, onDelete, onViewToken, onFlash, navigate }) {
  const [details, setDetails] = useState({ loading: false, loaded: false })
  const [expandedType, setExpandedType] = useState(null)
  const [fundsCache, setFundsCache] = useState({})
  const [fundsLoading, setFundsLoading] = useState({})
    const [checkStatus, setCheckStatus] = useState({ loading: false, ok: null, message: null, at: null })

    // Load persisted check status from localStorage for this account
    useEffect(() => {
      try {
        const key = `angel_check_${acc.id}`
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw)
          // Ensure structure
          if (parsed && typeof parsed === 'object') setCheckStatus(parsed)
        }
      } catch (e) {
        // ignore
      }
    }, [acc.id])

  useEffect(() => {
    if (acc.connected) loadDetails()
  }, [acc.id, acc.connected]) // eslint-disable-line

  const loadDetails = async (force = false) => {
    if (!force && details.loaded) return
    setDetails((d) => ({ ...d, loading: true }))
    const [tok, funds, margin, strats] = await Promise.allSettled([
      axios.get(`/api/angelone/token/${acc.id}`),
      axios.get(`/api/angelone/funds/${acc.id}`),
      axios.get(`/api/angelone/margin/${acc.id}`),
      axios.get(`/api/strategies/account/${acc.id}`),
    ])
    const stratsData = strats.status === 'fulfilled' ? strats.value?.data : []
    const profit = Array.isArray(stratsData)
      ? stratsData.reduce((s, x) => s + Number(x.profit_loss || 0), 0) : 0
    setDetails({
      loading: false,
      loaded: true,
      token: safe(tok),
      funds: unwrap(safe(funds)),
      margin: unwrap(safe(margin)),
      profit,
    })
  }

  const toggleExpand = async (type) => {
    if (expandedType === type) { setExpandedType(null); return }
    const cacheKey = `${type}:${acc.id}`
    if (!fundsCache[cacheKey]) {
      setFundsLoading((s) => ({ ...s, [cacheKey]: true }))
      try {
        const url = type === 'funds' ? `/api/angelone/funds/${acc.id}` : `/api/angelone/margin/${acc.id}`
        const { data } = await axios.get(url)
        setFundsCache((c) => ({ ...c, [cacheKey]: data }))
      } catch (err) {
        onFlash(err.response?.data?.error || `Failed to fetch ${type}`, 'error')
      } finally {
        setFundsLoading((s) => ({ ...s, [cacheKey]: false }))
      }
    }
    setExpandedType(type)
  }

  const btn = (bg, color, border) => ({
    fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '5px 13px',
    background: bg, color, border: `1px solid ${border}`,
    cursor: 'pointer', lineHeight: 1.5,
  })

  const checkConnection = async () => {
    const key = `angel_check_${acc.id}`
    const startState = { loading: true, ok: null, message: null, at: new Date() }
    setCheckStatus(startState)
    try {
      const { data } = await axios.get(`/api/angelone/check/${acc.id}`)
      const result = data.connected
        ? { loading: false, ok: true, message: data.message || 'Connected', at: new Date() }
        : { loading: false, ok: false, message: data.message || data.error || 'Not connected', at: new Date() }
      setCheckStatus(result)
      try { localStorage.setItem(key, JSON.stringify(result)) } catch (e) {}
      onFlash(`${acc.label}: ${result.message || (result.ok ? 'Connected' : 'Not connected')}`, result.ok ? 'success' : 'error')
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Check failed'
      const failState = { loading: false, ok: false, message: msg, at: new Date() }
      setCheckStatus(failState)
      try { localStorage.setItem(key, JSON.stringify(failState)) } catch (e) {}
      onFlash(`${acc.label}: ${msg}`, 'error')
    }
  }

  const profitColor = details.profit > 0 ? '#10b981' : details.profit < 0 ? '#ef4444' : '#a5b4fc'

  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── Header row ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 12, padding: '14px 20px', flexWrap: 'wrap',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: acc.connected ? 'rgba(34,197,94,0.03)' : 'rgba(245,158,11,0.03)',
      }}>
        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>{acc.label}</span>
          <code style={{ fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>{acc.client_code}</code>
          <span
            style={{
              fontSize: 12, padding: '2px 10px', borderRadius: 6, fontWeight: 700,
              background: acc.connected ? 'rgba(34,197,94,0.13)' : 'rgba(245,158,11,0.13)',
              color: acc.connected ? '#22c55e' : '#f59e0b',
            }}>
            <span style={{ marginRight: 5, fontSize: 8, verticalAlign: 'middle', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: acc.connected ? '#22c55e' : '#f59e0b', boxShadow: `0 0 6px ${acc.connected ? '#22c55e' : '#f59e0b'}` }} />
            {acc.connected ? 'Connected' : 'Disconnected'}
          </span>
          {acc.connected_at && (
            <span style={{ fontSize: 11, color: '#475569' }}>
              {new Date(acc.connected_at).toLocaleString()}
            </span>
          )}
          {checkStatus.ok !== null && (
            <span style={{ fontSize: 11, marginLeft: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 8,
                background: checkStatus.ok ? 'rgba(16,185,129,0.12)' : 'rgba(248,113,113,0.10)',
                color: checkStatus.ok ? '#10b981' : '#f87171', fontWeight: 700, fontSize: 12
              }} title={checkStatus.message || ''}>
                {checkStatus.loading ? 'Checking…' : (checkStatus.ok ? '✓ OK' : '✕ Failed')}
                {checkStatus.at ? <span style={{ fontWeight: 600, color: '#94a3b8', marginLeft: 6, fontSize: 11 }}>{new Date(checkStatus.at).toLocaleTimeString()}</span> : null}
              </span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          {acc.connected ? (
            <button style={btn('rgba(239,68,68,0.13)', '#ef4444', 'rgba(239,68,68,0.22)')} onClick={() => onDisconnect(acc.id)}>Disconnect</button>
          ) : (
            <button style={btn('rgba(34,197,94,0.13)', '#22c55e', 'rgba(34,197,94,0.22)')} onClick={() => onConnect(acc.id)}>Connect</button>
          )}
          <button style={btn('rgba(56,189,248,0.13)', '#38bdf8', 'rgba(56,189,248,0.22)')} onClick={() => onViewToken(acc.id)}>🔑 Token</button>
          <button
            style={btn(
              expandedType === 'funds' ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.13)',
              '#3b82f6', 'rgba(59,130,246,0.24)',
            )}
            onClick={() => toggleExpand('funds')}>
            💰 Funds {expandedType === 'funds' ? '▲' : '▼'}
          </button>
          <button
            style={btn(
              expandedType === 'margin' ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.13)',
              '#f59e0b', 'rgba(245,158,11,0.24)',
            )}
            onClick={() => toggleExpand('margin')}>
            📊 Margin {expandedType === 'margin' ? '▲' : '▼'}
          </button>
          {acc.connected && (
            <button
              style={btn('rgba(167,139,250,0.13)', '#a78bfa', 'rgba(167,139,250,0.22)')}
              onClick={() => navigate(`/admin/accounts/${acc.id}`)}>
              Profile →
            </button>
          )}
          {acc.connected && (
            <button
              style={btn('rgba(56,189,248,0.08)', '#64748b', 'rgba(56,189,248,0.15)')}
                onClick={() => loadDetails(true)}
              title="Refresh stats">
              ⟳
            </button>
          )}
            <button style={btn('rgba(248,113,113,0.13)', '#f87171', 'rgba(248,113,113,0.22)')} onClick={() => onDelete(acc.id)}>Delete</button>
        </div>
      </div>

      {/* ── Live stats (connected accounts) ── */}
      {acc.connected && details.loading && (
        <div style={{ padding: '12px 20px', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading stats…</div>
      )}
      {acc.connected && details.loaded && !details.loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <StatBlock
            label="JWT Token" icon="🔑"
            value={details.token?.jwt_token
              ? <span style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', color: '#38bdf8' }}>{details.token.jwt_token.slice(0, 22)}…</span>
              : <span style={{ color: '#475569' }}>—</span>}
          />
          <StatBlock label="Available Cash" icon="💰" value={<span style={{ color: '#10b981' }}>{fmt(details.funds?.availablecash ?? details.funds?.net)}</span>} />
          <StatBlock label="Net Balance" icon="🏦" value={<span style={{ color: '#10b981' }}>{fmt(details.funds?.net)}</span>} />
          <StatBlock label="Margin (Net)" icon="📊" value={<span style={{ color: '#f59e0b' }}>{fmt(details.margin?.net ?? details.margin?.availablecash)}</span>} />
          <StatBlock label="Utilised Debits" icon="⬇️" value={<span style={{ color: '#f87171' }}>{fmt(details.margin?.utiliseddebits)}</span>} />
          <StatBlock
            label="Strategy Profit" icon="📈"
            value={<span style={{ color: profitColor, fontWeight: 800 }}>{fmt(details.profit)}</span>}
          />
        </div>
      )}

      {/* ── Inline expand panel ── */}
      {expandedType && (
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.12)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {expandedType === 'funds' ? '💰 Funds Detail' : '📊 Margin Detail'} — {acc.label}
          </div>
          {fundsLoading[`${expandedType}:${acc.id}`]
            ? <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading {expandedType}…</div>
            : <FundsMarginView data={fundsCache[`${expandedType}:${acc.id}`]} />
          }
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Accounts() {
  const [accounts, setAccounts]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [msg, setMsg]               = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [showAdd, setShowAdd]       = useState(false)
  const [dataModal, setDataModal]   = useState({ open: false, title: '', payload: null })
  const [form, setForm]             = useState({ label: '', client_code: '', password: '', totp_secret: '', api_key: '' })
  const navigate = useNavigate()

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

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const handleAdd = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await axios.post('/api/angelone/accounts', form)
      setForm({ label: '', client_code: '', password: '', totp_secret: '', api_key: '' })
      flash('Account added successfully')
      setShowAdd(false)
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

  const handleViewToken = async (id) => {
    try {
      const { data } = await axios.get(`/api/angelone/token/${id}`)
      if (!data.jwt_token && !data.feed_token) {
        flash('No token available — connect first.', 'error')
        return
      }
      setDataModal({
        open: true,
        title: 'Token Details',
        payload: { jwt_token: data.jwt_token || '(none)', feed_token: data.feed_token || '(none)', connected: data.connected },
      })
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to fetch token', 'error')
    }
  }

  const closeModal = () => setDataModal({ open: false, title: '', payload: null })

  const total     = accounts.length
  const connected = accounts.filter((a) => a.connected).length

  return (
    <div className="page-container" style={{ maxWidth: 1040, margin: '0 auto', padding: '2.5rem 1.5rem', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, minWidth: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 38, height: 38, borderRadius: 12,
              background: 'linear-gradient(135deg,#38bdf8 60%,#6366f1 100%)',
              boxShadow: '0 2px 16px rgba(56,189,248,0.12)', color: '#fff', fontSize: 20,
            }}>🔗</span>
            Accounts
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
            Manage and monitor AngelOne broker accounts · Token · Funds · Margin · Profit
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleConnectAll}
            disabled={!total}
            style={{
              background: 'linear-gradient(90deg,#38bdf8 0%,#6366f1 100%)',
              color: '#fff', fontWeight: 700, fontSize: 14, border: 'none',
              padding: '9px 22px', borderRadius: 10, cursor: total ? 'pointer' : 'not-allowed',
              opacity: total ? 1 : 0.5, boxShadow: '0 2px 12px rgba(56,189,248,0.13)',
            }}>
            ⚡ Connect All
          </button>
          <button
            onClick={() => setShowAdd((s) => !s)}
            style={{
              background: showAdd ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.12)',
              color: '#a5b4fc', fontWeight: 700, fontSize: 14,
              border: '1px solid rgba(99,102,241,0.3)', padding: '9px 22px', borderRadius: 10, cursor: 'pointer',
            }}>
            {showAdd ? '✕ Cancel' : '＋ Add Account'}
          </button>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, margin: '1.8rem 0' }}>
        <div className="stat-card blue" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(56,189,248,0.13)', borderRadius: 10, padding: 8 }}>🔗</span>
          <div>
            <div className="stat-label">Total</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{total}</div>
          </div>
        </div>
        <div className="stat-card green" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(34,197,94,0.13)', borderRadius: 10, padding: 8 }}>●</span>
          <div>
            <div className="stat-label">Connected</div>
            <div className="stat-value" style={{ fontSize: 22, color: '#22c55e' }}>{connected}</div>
          </div>
        </div>
        <div className="stat-card amber" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
          <span style={{ fontSize: 20, background: 'rgba(245,158,11,0.13)', borderRadius: 10, padding: 8 }}>○</span>
          <div>
            <div className="stat-label">Disconnected</div>
            <div className="stat-value" style={{ fontSize: 22, color: '#f59e0b' }}>{total - connected}</div>
          </div>
        </div>
      </div>

      {/* ── Flash message ── */}
      {msg && <div className={`angel-msg angel-msg--${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {/* ── Add account form (collapsible) ── */}
      {showAdd && (
        <div className="glass-card" style={{ marginBottom: '2rem', boxShadow: '0 6px 32px rgba(56,189,248,0.08)' }}>
          <h2 className="section-title" style={{ marginBottom: '1.2rem', fontSize: 17, color: '#a5b4fc', fontWeight: 700 }}>➕ Add Account</h2>
          <form onSubmit={handleAdd} autoComplete="off">
            <div className="angel-form-grid">
              <div>
                <label className="angel-label">Label</label>
                <input className="angel-input" name="label" value={form.label} onChange={handleChange} placeholder="e.g. Main Account" required />
              </div>
              <div>
                <label className="angel-label">Client Code</label>
                <input className="angel-input" name="client_code" value={form.client_code} onChange={handleChange} placeholder="AngelOne client ID" required />
              </div>
              <div>
                <label className="angel-label">Password</label>
                <input className="angel-input" type="password" name="password" value={form.password} onChange={handleChange} placeholder="Trading password" required />
              </div>
              <div>
                <label className="angel-label">TOTP Secret (base32)</label>
                <input className="angel-input" name="totp_secret" value={form.totp_secret} onChange={handleChange} placeholder="Base32 TOTP secret" required />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="angel-label">API Key</label>
                <input className="angel-input" name="api_key" value={form.api_key} onChange={handleChange} placeholder="SmartAPI private key" required />
              </div>
            </div>
            <button className="angel-submit" type="submit" disabled={submitting} style={{ marginTop: 10, fontSize: 16, fontWeight: 700, letterSpacing: '0.03em', boxShadow: '0 2px 16px rgba(56,189,248,0.10)' }}>
              {submitting ? 'Adding…' : <><span style={{ fontSize: 18, marginRight: 6 }}>＋</span>Add Account</>}
            </button>
          </form>
        </div>
      )}

      {/* ── Account list ── */}
      {loading && <p style={{ color: 'rgba(255,255,255,0.5)' }}>Loading accounts…</p>}

      {!loading && accounts.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', color: '#64748b', padding: '3rem 1rem' }}>
          No accounts yet. Click <strong style={{ color: '#a5b4fc' }}>＋ Add Account</strong> above to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {accounts.map((acc) => (
          <AccountCard
            key={acc.id}
            acc={acc}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onDelete={handleDelete}
            onViewToken={handleViewToken}
            onFlash={flash}
            navigate={navigate}
          />
        ))}
      </div>

      {/* ── Token modal ── */}
      {dataModal.open && (
        <div className="angel-modal-overlay" onClick={closeModal}>
          <div className="angel-modal-card" style={{ maxWidth: 560, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="angel-modal-header">
              <h3>{dataModal.title}</h3>
              <button className="angel-modal-close" onClick={closeModal}>Close</button>
            </div>
            <div className="angel-modal-content">
              {dataModal.payload && typeof dataModal.payload === 'object'
                ? Object.entries(dataModal.payload).map(([key, value]) => (
                    <div className="angel-modal-row" key={key}>
                      <span className="angel-modal-key">{key}</span>
                      <span className="angel-modal-value" style={{ wordBreak: 'break-all' }}>
                        {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
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
