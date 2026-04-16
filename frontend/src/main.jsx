import { Component, StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin/admin.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

const Login = lazy(() => import('./Login.jsx'))
const AdminLayout = lazy(() => import('./admin/AdminLayout.jsx'))
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'))
const Accounts = lazy(() => import('./admin/Accounts.jsx'))
const TradeSetups = lazy(() => import('./admin/TradeSetups.jsx'))
const Strategies = lazy(() => import('./admin/Strategies.jsx'))
const OI = lazy(() => import('./admin/OI.jsx'))
const AccountProfile = lazy(() => import('./admin/AccountProfile.jsx'))
const AutoTrade = lazy(() => import('./admin/AutoTrade.jsx'))

function getAuthValue() {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('pt_auth')
  } catch {
    return null
  }
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#c9d1d9',
        background: '#060910',
        fontSize: 16,
      }}
    >
      Loading PowerTrade...
    </div>
  )
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('PowerTrade render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#060910',
            color: '#e2e8f0',
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              border: '1px solid rgba(248,113,113,0.24)',
              borderRadius: 16,
              background: 'rgba(15,23,42,0.9)',
              boxShadow: '0 20px 80px rgba(0,0,0,0.35)',
              padding: 24,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>PowerTrade failed to render</div>
            <div style={{ color: '#94a3b8', marginBottom: 16 }}>
              A client-side error stopped the app before it could render.
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#fca5a5',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function HomeRedirect() {
  return <Navigate to={getAuthValue() === '1' ? '/admin' : '/login'} replace />
}

function ProtectedRoute({ children }) {
  const auth = getAuthValue()
  return auth === '1' ? children : <Navigate to="/login" replace />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="angelone" element={<Accounts />} />
              <Route path="trade-setups" element={<TradeSetups />} />
              <Route path="auto-trade" element={<AutoTrade />} />
              <Route path="strategies" element={<Strategies />} />
              <Route path="oi" element={<OI />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="accounts/:id" element={<AccountProfile />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
