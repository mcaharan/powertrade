import { useState, useEffect } from 'react'
import axios from 'axios'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const chartData = [
  { month: 'Jan', volume: 800 },
  { month: 'Feb', volume: 950 },
  { month: 'Mar', volume: 1100 },
  { month: 'Apr', volume: 1400 },
  { month: 'May', volume: 1200 },
  { month: 'Jun', volume: 1700 },
  { month: 'Jul', volume: 1550 },
  { month: 'Aug', volume: 1900 },
  { month: 'Sep', volume: 2100 },
  { month: 'Oct', volume: 1800 },
  { month: 'Nov', volume: 2400 },
  { month: 'Dec', volume: 2800 },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'rgba(10,15,28,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        padding: '12px 18px',
        fontSize: 13,
        color: '#e2e8f0',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{ color: '#64748b', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#38bdf8' }}>${payload[0].value.toLocaleString()}</div>
      </div>
    )
  }
  return null
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [trades, setTrades] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      axios.get('/api/dashboard/stats'),
      axios.get('/api/trades'),
    ])
      .then(([s, t]) => {
        setStats(s.data)
        setTrades(t.data.slice(0, 5))
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="error">Error: {error}</div>
  if (!stats) return <div className="loading">Loading dashboard…</div>

  return (
    <div className="dash-grid">
      {/* ── Row 1: Stat cards (span 2 cols) ── */}
      <div className="span-col-2">
        <div className="stat-grid">
          <div className="stat-card green">
            <div className="label">Portfolio Value</div>
            <div className="value green">${stats.totalVolume.toLocaleString()}</div>
            <div className="sub"><span className="up">↑ 12.5%</span> vs last month</div>
          </div>
          <div className="stat-card blue">
            <div className="label">Total Trades</div>
            <div className="value blue">{stats.totalTrades}</div>
            <div className="sub">All time</div>
          </div>
          <div className="stat-card amber">
            <div className="label">Open Orders</div>
            <div className="value amber">{stats.openOrders}</div>
            <div className="sub">Pending execution</div>
          </div>
          <div className="stat-card purple">
            <div className="label">Active Users</div>
            <div className="value purple">{stats.totalUsers}</div>
            <div className="sub"><span className="up">↑ 2</span> this week</div>
          </div>
        </div>
      </div>

      {/* ── Row 1: Activity feed (right col) ── */}
      <div className="activity-card">
        <div className="card-title">Activity Feed</div>
        {trades.slice(0, 4).map((t, i) => (
          <div className="activity-item" key={t.id || i}>
            <div className={`act-icon ${t.side === 'BUY' ? 'buy' : 'sell'}`}>
              {t.side === 'BUY' ? '↗' : '↘'}
            </div>
            <div className="act-text">
              <div className="act-title">{t.user_name} {t.side.toLowerCase()} {t.symbol}</div>
              <div className="act-time">{Number(t.quantity)} @ ${Number(t.price).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 2: Line chart (span 2 cols) ── */}
      <div className="chart-card span-col-2">
        <div className="chart-header">
          <div className="chart-title">Trading Volume</div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="volumeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="volume" stroke="#38bdf8" strokeWidth={2.5} fill="url(#volumeGrad)" filter="url(#glow)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Row 2: Actions (right col) ── */}
      <div className="actions-card">
        <div className="card-title">Quick Actions</div>
        <button className="action-btn">New Trade <span className="arrow">→</span></button>
        <button className="action-btn">Set Alerts <span className="arrow">→</span></button>
        <button className="action-btn">Export Report <span className="arrow">→</span></button>
        <div style={{ marginTop: 16 }}>
          <div className="promo-card">
            <div className="promo-title">Upgrade to Pro</div>
            <div className="promo-text">Unlock advanced analytics, real-time alerts, and API access.</div>
            <button className="promo-btn">Learn more</button>
          </div>
        </div>
      </div>

      {/* ── Row 3: Transactions table (full width) ── */}
      <div className="table-card" style={{ gridColumn: '1 / -1' }}>
        <div className="table-header">
          <span className="table-title">Transactions</span>
          <div className="table-toolbar">
            <button className="tool-btn">Sort ↕</button>
            <button className="tool-btn">Filter</button>
            <button className="tool-btn">Export CSV</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{t.user_name}</td>
                <td>{t.symbol}</td>
                <td><span className={`badge badge-${t.side.toLowerCase()}`}><span className="dot" /> {t.side}</span></td>
                <td>{Number(t.quantity).toLocaleString()}</td>
                <td>${Number(t.price).toLocaleString()}</td>
                <td><span className={`badge badge-${t.status.toLowerCase()}`}><span className="dot" /> {t.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
