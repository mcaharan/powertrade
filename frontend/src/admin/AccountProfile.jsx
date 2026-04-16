import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

const fmt = (v) => {
  if (v === null || v === undefined) return '—'
  const n = parseFloat(v)
  if (isNaN(n)) return String(v)
  return `₹${n.toFixed(2)}`
}

// Unwrap AngelOne response envelope: {status, data: [{...}]} → {...}
const unwrap = (d) => {
  if (!d) return null
  if (Array.isArray(d?.data)) return d.data[0] ?? null
  if (d?.data && typeof d.data === 'object') return d.data
  return d
}

const safe = (r) => (r.status === 'fulfilled' ? r.value?.data : null)

const FUNDS_ROWS = [
  { key: 'net',                    label: 'Net Balance',        color: '#10b981' },
  { key: 'availablecash',          label: 'Available Cash',     color: '#10b981' },
  { key: 'availableintradaypayin', label: 'Intraday Pay-in',    color: '#38bdf8' },
  { key: 'availablelimitmargin',   label: 'Limit Margin',       color: '#38bdf8' },
  { key: 'collateral',             label: 'Collateral',         color: '#a78bfa' },
  { key: 'm2munrealized',          label: 'M2M Unrealized',     color: '#f59e0b' },
  { key: 'm2mrealized',            label: 'M2M Realized',       color: '#f59e0b' },
  { key: 'utiliseddebits',         label: 'Utilised Debits',    color: '#f87171' },
  { key: 'utilisedspan',           label: 'SPAN Margin',        color: '#f87171' },
  { key: 'utilisedoptionpremium',  label: 'Option Premium',     color: '#f87171' },
  { key: 'utilisedholdingsales',   label: 'Holding Sales',      color: '#f87171' },
  { key: 'utilisedexposure',       label: 'Exposure Margin',    color: '#f87171' },
  { key: 'utilisedturnover',       label: 'Turnover',           color: '#f87171' },
  { key: 'utilisedpayout',         label: 'Payout',             color: '#f87171' },
]

const PROFILE_ROWS = [
  { key: 'name',            label: 'Name' },
  { key: 'email',           label: 'Email' },
  { key: 'mobileno',        label: 'Mobile' },
  { key: 'panno',           label: 'PAN' },
  { key: 'clientcode',      label: 'Client Code' },
  { key: 'exchanges',       label: 'Exchanges' },
  { key: 'brokerid',        label: 'Broker ID' },
]

function Section({ title, color = '#a5b4fc', children }) {
  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{
        padding: '10px 18px',
        background: `${color}12`,
        borderBottom: `1px solid ${color}22`,
        fontSize: 12, fontWeight: 700, letterSpacing: '0.07em',
        textTransform: 'uppercase', color,
      }}>{title}</div>
      <div style={{ padding: '12px 18px' }}>{children}</div>
    </div>
  )
}

function KVRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#64748b', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, color: color || '#e2e8f0', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right', maxWidth: '60%' }}>{String(value ?? '—')}</span>
    </div>
  )
}

export default function AccountProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState(null)

  const load = async () => {
    setRefreshing(true)
    const [tok, prof, funds, margin, strats] = await Promise.allSettled([
      axios.get(`/api/angelone/token/${id}`),
      axios.get(`/api/angelone/profile/${id}`),
      axios.get(`/api/angelone/funds/${id}`),
      axios.get(`/api/angelone/margin/${id}`),
      axios.get(`/api/strategies/account/${id}`),
    ])
    const stratsData = strats.status === 'fulfilled' ? (strats.value?.data ?? []) : []
    const profit = Array.isArray(stratsData) ? stratsData.reduce((s, x) => s + Number(x.profit_loss || 0), 0) : 0
    setData({
      token:      safe(tok),
      profile:    unwrap(safe(prof)),
      funds:      unwrap(safe(funds)),
      margin:     unwrap(safe(margin)),
      profit,
      strategies: stratsData,
    })
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#a5b4fc', fontSize: 16 }}>
      Loading account details…
    </div>
  )

  if (!data) return <div className="error">Failed to load account details</div>

  const { token, profile, funds, margin, profit, strategies } = data

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 1.5rem', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#e2e8f0' }}>
            {profile?.name || `Account #${id}`}
          </h1>
          <div style={{ marginTop: 4, color: '#64748b', fontSize: 14 }}>
            {profile?.clientcode && <code style={{ color: '#38bdf8' }}>{profile.clientcode}</code>}
            {profile?.email && <span style={{ marginLeft: 12, wordBreak: 'break-all' }}>{profile.email}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="angel-btn-connect" onClick={() => navigate(-1)}>← Back</button>
          <button className="angel-btn-connect" onClick={load} disabled={refreshing}
            style={{ background: 'rgba(56,189,248,0.13)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.22)' }}>
            {refreshing ? 'Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Top summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 }}>
        {[
          { label: 'Net Balance', val: fmt(funds?.net), color: '#10b981', icon: '🏦' },
          { label: 'Available Cash', val: fmt(funds?.availablecash), color: '#10b981', icon: '💰' },
          { label: 'Margin (Net)', val: fmt(margin?.net ?? margin?.availablecash), color: '#f59e0b', icon: '📊' },
          { label: 'Utilised Debits', val: fmt(margin?.utiliseddebits), color: '#f87171', icon: '⬇️' },
          { label: 'Strategy Profit', val: fmt(profit), color: profit > 0 ? '#10b981' : profit < 0 ? '#ef4444' : '#a5b4fc', icon: '📈' },
        ].map(({ label, val, color, icon }) => (
          <div key={label} className="glass-card" style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
        <div>
          {/* Token */}
          <Section title="Token" color="#38bdf8">
            <KVRow label="JWT Token" value={token?.jwt_token ? `${token.jwt_token.slice(0, 30)}…` : '—'} color="#38bdf8" />
            <KVRow label="Feed Token" value={token?.feed_token ?? '—'} color="#6366f1" />
            <KVRow label="Connected" value={token?.connected ? 'Yes' : 'No'} />
          </Section>

          {/* Funds */}
          <Section title="Funds" color="#10b981">
            {FUNDS_ROWS.filter(({ key }) => funds?.[key] !== undefined && funds?.[key] !== null).map(({ key, label, color }) => (
              <KVRow key={key} label={label} value={fmt(funds[key])} color={color} />
            ))}
            {!funds && <div style={{ color: '#64748b', fontSize: 13 }}>Funds data unavailable</div>}
          </Section>

          {/* Margin */}
          <Section title="Margin / RMS" color="#f59e0b">
            {FUNDS_ROWS.filter(({ key }) => margin?.[key] !== undefined && margin?.[key] !== null).map(({ key, label, color }) => (
              <KVRow key={key} label={label} value={fmt(margin[key])} color={color} />
            ))}
            {!margin && <div style={{ color: '#64748b', fontSize: 13 }}>Margin data unavailable</div>}
          </Section>

          {/* Strategies */}
          <Section title="Strategies" color="#a78bfa">
            {strategies.length === 0
              ? <div style={{ color: '#64748b', fontSize: 13 }}>No strategies for this account</div>
              : (
                <div style={{ overflowX: 'auto' }}><table className="data-table" style={{ fontSize: 13, minWidth: 360 }}>
                  <thead>
                    <tr><th>Name</th><th>Type</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
                  </thead>
                  <tbody>
                    {strategies.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 700 }}>{s.name}</td>
                        <td style={{ color: '#ec4899' }}>{s.strategy_type}</td>
                        <td>{s.total_trades || 0}</td>
                        <td>{s.win_rate ? `${s.win_rate}%` : '—'}</td>
                        <td style={{ fontWeight: 700, color: s.profit_loss > 0 ? '#10b981' : s.profit_loss < 0 ? '#ef4444' : '#a5b4fc' }}>{fmt(s.profit_loss)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )
            }
          </Section>
        </div>

        {/* Right column: profile */}
        <div>
          <Section title="Profile" color="#6366f1">
            {PROFILE_ROWS.map(({ key, label }) => {
              let val = profile?.[key]
              if (Array.isArray(val)) val = val.join(', ')
              return <KVRow key={key} label={label} value={val} />
            })}
            {!profile && <div style={{ color: '#64748b', fontSize: 13 }}>Profile data unavailable</div>}
          </Section>
        </div>
      </div>
    </div>
  )
}
