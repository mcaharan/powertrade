import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Trades() {
  const [trades, setTrades] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/trades')
      .then((r) => setTrades(r.data))
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="error">Error: {error}</div>
  if (!trades.length) return <div className="loading">Loading trades…</div>

  return (
    <div>
      <div className="page-title">Trades</div>
      <div className="table-card">
        <div className="table-header">
          <span className="table-title">All Trades</span>
          <div className="table-toolbar">
            <button className="tool-btn">Sort ↕</button>
            <button className="tool-btn">Filter</button>
            <button className="tool-btn">Export CSV</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.user_name}</td>
                <td>{t.symbol}</td>
                <td><span className={`badge badge-${t.side.toLowerCase()}`}><span className="dot" /> {t.side}</span></td>
                <td>{Number(t.quantity).toLocaleString()}</td>
                <td>${Number(t.price).toLocaleString()}</td>
                <td>${Number(t.total).toLocaleString()}</td>
                <td><span className={`badge badge-${t.status.toLowerCase()}`}><span className="dot" /> {t.status}</span></td>
                <td>{new Date(t.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
