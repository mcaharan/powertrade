import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Portfolio() {
  const [holdings, setHoldings] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/portfolio')
      .then((r) => setHoldings(r.data))
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="error">Error: {error}</div>
  if (!holdings.length) return <div className="loading">Loading portfolio…</div>

  const totalValue = holdings.reduce((sum, h) => sum + Number(h.quantity) * Number(h.avg_price), 0)

  return (
    <div>
      <div className="page-title">Portfolio</div>
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card green">
          <div className="label">Total Holdings Value</div>
          <div className="value green">${totalValue.toLocaleString()}</div>
        </div>
        <div className="stat-card blue">
          <div className="label">Positions</div>
          <div className="value blue">{holdings.length}</div>
        </div>
      </div>
      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Holdings</span>
          <div className="table-toolbar">
            <button className="tool-btn">Refresh</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Symbol</th>
              <th>Quantity</th>
              <th>Avg Price</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id}>
                <td>{h.user_name}</td>
                <td>{h.symbol}</td>
                <td>{Number(h.quantity).toLocaleString()}</td>
                <td>${Number(h.avg_price).toLocaleString()}</td>
                <td>${(Number(h.quantity) * Number(h.avg_price)).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
