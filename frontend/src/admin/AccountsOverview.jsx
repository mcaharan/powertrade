import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const fmt = (v) => {
  if (v === null || v === undefined) return '—'
  const n = parseFloat(v)
  if (isNaN(n)) return String(v)
  return `₹${n.toFixed(2)}`
}

// Unwrap AngelOne responses that may come as {status, data: [{...}]} or flat
const unwrap = (d) => {
  if (!d) return null
  if (Array.isArray(d?.data)) return d.data[0] ?? null
  if (d?.data && typeof d.data === 'object') return d.data
  return d
}

const safe = (res) => (res.status === 'fulfilled' ? res.value?.data : null)

export default function AccountsOverview() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [details, setDetails] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    axios.get('/api/angelone/accounts').then((r) => {
      if (!mounted) return
      const connected = r.data.filter((a) => a.connected)
      setAccounts(connected)
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { mounted = false }
  }, [])

  const loadAccountDetails = async (acc, force = false) => {
    const key = acc.id
    // Skip if already loading or loaded (unless forced refresh)
    if (!force && details[key] && !details[key].loading) return
    setDetails((d) => ({ ...d, [key]: { loading: true } }))
    const [tok, funds, margin, strats] = await Promise.allSettled([
      axios.get(`/api/angelone/token/${acc.id}`),
      axios.get(`/api/angelone/funds/${acc.id}`),
      axios.get(`/api/angelone/margin/${acc.id}`),
      axios.get(`/api/strategies/account/${acc.id}`),
    ])
    const stratsData = strats.status === 'fulfilled' ? strats.value?.data : []
    const profit = Array.isArray(stratsData) ? stratsData.reduce((s, x) => s + Number(x.profit_loss || 0), 0) : 0
    setDetails((d) => ({
      ...d,
      [key]: {
        loading: false,
        token: safe(tok),
        funds: unwrap(safe(funds)),
        margin: unwrap(safe(margin)),
        profit,
      },
    }))
  }

  if (loading) return <div className="loading">Loading accounts…</div>

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #38bdf8 60%, #6366f1 100%)',
            color: '#fff', fontSize: 20,
          }}>👥</span>
          Accounts Overview
        </h1>
        <p className="page-subtitle" style={{ color: '#a5b4fc', fontWeight: 500 }}>
          Token · Funds · Margin · Profit — per connected account
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {accounts.length === 0 && (
          <div style={{ color: '#a5b4fc' }}>No connected accounts.</div>
        )}

        {accounts.map((acc) => {
          const det = details[acc.id]
          return (
            <AccountCard
              key={acc.id}
              acc={acc}
              det={det}
              onLoad={() => loadAccountDetails(acc)}
              onRefresh={() => loadAccountDetails(acc, true)}
              onProfile={() => navigate(`/admin/accounts/${acc.id}`)}
              fmt={fmt}
            />
          )
        })}
      </div>
    </div>
  )
}

function AccountCard({ acc, det, onLoad, onRefresh, onProfile, fmt }) {
  useEffect(() => { onLoad() }, [acc.id]) // eslint-disable-line

  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(56,189,248,0.04)',
      }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>{acc.label}</span>
          <code style={{ marginLeft: 10, fontSize: 13, color: '#38bdf8' }}>{acc.client_code}</code>
          <span style={{ marginLeft: 12, fontSize: 12, padding: '2px 10px', borderRadius: 6, background: 'rgba(34,197,94,0.13)', color: '#22c55e', fontWeight: 700 }}>
            ● Connected
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="angel-btn-connect" onClick={onRefresh} style={{ fontWeight: 700, fontSize: 12 }}>⟳ Refresh</button>
          <button className="angel-btn-connect" onClick={onProfile} style={{ fontWeight: 700, fontSize: 12, background: 'rgba(167,139,250,0.13)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.22)' }}>
            View Profile →
          </button>
        </div>
      </div>

      {/* Stats blocks */}
      {det?.loading && (
        <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading details…</div>
      )}

      {det && !det.loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0 }}>
          {/* Token */}
          <StatBlock
            label="JWT Token"
            color="#38bdf8"
            icon="🔑"
            value={det.token?.jwt_token
              ? <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{det.token.jwt_token.slice(0, 24)}…</span>
              : '—'}
          />

          {/* Funds */}
          <StatBlock
            label="Available Cash"
            color="#10b981"
            icon="💰"
            value={fmt(det.funds?.availablecash ?? det.funds?.net ?? null)}
          />
          <StatBlock
            label="Net Balance"
            color="#10b981"
            icon="🏦"
            value={fmt(det.funds?.net ?? null)}
          />

          {/* Margin */}
          <StatBlock
            label="Margin (Net)"
            color="#f59e0b"
            icon="📊"
            value={fmt(det.margin?.net ?? det.margin?.availablecash ?? null)}
          />
          <StatBlock
            label="Utilised Debits"
            color="#f87171"
            icon="⬇️"
            value={fmt(det.margin?.utiliseddebits ?? null)}
          />

          {/* Profit */}
          <StatBlock
            label="Strategy Profit"
            color={det.profit > 0 ? '#10b981' : det.profit < 0 ? '#ef4444' : '#a5b4fc'}
            icon="📈"
            value={<span style={{ color: det.profit > 0 ? '#10b981' : det.profit < 0 ? '#ef4444' : '#a5b4fc', fontWeight: 800 }}>{fmt(det.profit)}</span>}
          />
        </div>
      )}
    </div>
  )
}

function StatBlock({ label, color, icon, value }) {
  return (
    <div style={{
      padding: '14px 18px',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span>{icon}</span> {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{value}</div>
    </div>
  )
}
