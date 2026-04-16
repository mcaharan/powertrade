import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import './admin.css'

export default function AdminLayout() {
  const [period, setPeriod] = useState('5d')

  return (
    <div className="admin-root">
      <Sidebar />
      <main className="admin-main">
        <div className="topbar">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Search transactions..." />
          </div>
          <div className="time-filters">
            {['5d', '15d', '60d'].map((p) => (
              <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="mode-toggle">
            <span className="dot" />
            Live Trading
          </div>
        </div>
        <div className="page-content">
          <Outlet />
        </div>
        <div className="status-bar">
          <span className="check">✓ Connected to exchange</span>
          <span>Last sync: just now</span>
        </div>
      </main>
    </div>
  )
}
