import { NavLink, useNavigate } from 'react-router-dom'
import './admin.css'

const mainLinks = [
  { to: '/admin',           label: 'Dashboard',  icon: '📊', end: true },
]

const mgmtLinks = [
  { to: '/admin/accounts',     label: 'Accounts',    icon: '🔗' },
  { to: '/admin/trade-setups', label: 'Trade Setups', icon: '⚙️' },
  { to: '/admin/auto-trade',   label: 'Auto Trade',   icon: '🤖' },
  { to: '/admin/strategies',   label: 'Strategies',  icon: '📋' },
  { to: '/admin/oi',           label: 'Open Interest', icon: '📈' },
  // removed: position-order, open-current-orders
]

export default function Sidebar() {
  const navigate = useNavigate()

  function handleLogout() {
    localStorage.removeItem('pt_auth')
    navigate('/login', { replace: true })
  }
  return (
    <aside className="admin-sidebar">
      <div className="brand">
        <div className="logo">⚡</div>
        PowerTrade
      </div>
      <nav>
        <div className="section-label">Overview</div>
        <ul>
          {mainLinks.map(({ to, label, icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{icon}</span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="section-label">Management</div>
        <ul>
          {mgmtLinks.map(({ to, label, icon }) => (
            <li key={to}>
              <NavLink to={to} className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{icon}</span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-footer">
        <div className="avatar">A</div>
        <div className="user-info">
          <div className="user-name">Admin</div>
          <div className="user-role">Administrator</div>
        </div>
        <button className="logout-btn" onClick={handleLogout}>Log out</button>
      </div>
    </aside>
  )
}
