import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import './admin.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'MIDCPNIFTY', 'FINNIFTY']

// Known NSE/BSE spot index tokens — subscribed with exchangeType 1 (NSE) or 3 (BSE)
const SPOT_TOKENS = {
  NIFTY:      { token: '26000', exchangeType: 1 },
  BANKNIFTY:  { token: '26009', exchangeType: 1 },
  MIDCPNIFTY: { token: '26074', exchangeType: 1 },
  FINNIFTY:   { token: '26037', exchangeType: 1 },
}

const STATUS_COLORS = {
  idle:       { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Idle' },
  connecting: { bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b', label: 'Connecting…' },
  live:       { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e', label: '● Live' },
  error:      { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', label: 'Error' },
}

const PENDING_LIVE_TRADE_TTL_MS = 2 * 60 * 1000
const PCR_NEUTRAL = 1
const BULLISH_PCR_MIN = 1
const BEARISH_PCR_MAX = 0.7

function signalToOptionType(signal, reverseMode = false) {
  if (!signal || signal === 'NO TRADE') return null
  let baseSide = null
  if (signal.includes('CE BUY') || signal.includes('BULLISH')) baseSide = 'CE'
  if (signal.includes('PE BUY') || signal.includes('BEARISH')) baseSide = 'PE'
  if (!baseSide) return null
  if (!reverseMode) return baseSide
  return baseSide === 'CE' ? 'PE' : 'CE'
}

function fmtL(n) {
  if (!n) return '0'
  if (n >= 1_00_00_000) return (n / 1_00_00_000).toFixed(2) + ' Cr'
  if (n >= 1_00_000)    return (n / 1_00_000).toFixed(2) + ' L'
  return Number(n).toLocaleString('en-IN')
}

function isPendingTradeExpired(pendingTrade) {
  if (!pendingTrade?.expiresAt) return true
  const expiresAt = new Date(pendingTrade.expiresAt).getTime()
  return !Number.isFinite(expiresAt) || Date.now() >= expiresAt
}

function formatPendingTradeExpiry(pendingTrade) {
  if (!pendingTrade?.expiresAt) return '-'
  const expiresAt = new Date(pendingTrade.expiresAt)
  return Number.isNaN(expiresAt.getTime()) ? '-' : expiresAt.toLocaleTimeString()
}

// Custom tooltip for Recharts
function OITooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const ce = payload.find((p) => p.dataKey === 'callOI')
  const pe = payload.find((p) => p.dataKey === 'putOI')
  return (
    <div style={{
      background: '#1a1d2e', border: '1px solid rgba(165,180,252,0.18)',
      borderRadius: 10, padding: '10px 16px', fontSize: 13, lineHeight: 1.8,
    }}>
      <div style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: 4 }}>Strike ₹{label}</div>
      {ce && <div style={{ color: '#10b981' }}>CE OI: <strong>{fmtL(ce.value)}</strong></div>}
      {pe && <div style={{ color: '#ef4444' }}>PE OI: <strong>{fmtL(pe.value)}</strong></div>}
      {ce && pe && (
        <div style={{ color: '#f59e0b', marginTop: 4 }}>
          Strike PCR: <strong>{ce.value > 0 ? (pe.value / ce.value).toFixed(2) : '—'}</strong>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function OI() {
  const [accounts, setAccounts]       = useState([])
  const [accountId, setAccountId]     = useState(null)
  const [underlying, setUnderlying]   = useState('NIFTY')
  const [expiries, setExpiries]       = useState([])
  const [expiry, setExpiry]           = useState('')
  const [chain, setChain]             = useState([])      // [{strike, CE:{token,symbol}, PE:{token,symbol}}]
  const [futToken, setFutToken]       = useState(null)
  const [oiData, setOiData]           = useState({})      // token -> tick
  const [streaming, setStreaming]     = useState(false)
  const [status, setStatus]           = useState('idle')
  const [msg, setMsg]                 = useState(null)
  const [loadingChain, setLoadingChain] = useState(false)
  const [visibleRange, setVisibleRange] = useState(20)    // strikes to show around ATM
  const [srWindowSize, setSrWindowSize] = useState(20)   // window to compute SR around ATM
  const [tieBreaker, setTieBreaker] = useState('maxOI')  // 'maxOI' or 'nearestATM'
  const [bandThreshold, setBandThreshold] = useState(0.5) // fraction for cumulative OI bands
  const esRef                         = useRef(null)
  const [showBands, setShowBands]     = useState(true)
  const [showSR, setShowSR]           = useState(true)
  const prevPriceRef                  = useRef(null)
  const prevCallOiRef                 = useRef(null)
  const prevPutOiRef                  = useRef(null)
  const prevAtmCePremRef              = useRef(null)
  const autoStartedRef                = useRef(false)    // guard against double auto-start

  // ── Signal Trade state ────────────────────────────────────────────────────
  const [tradeSetups, setTradeSetups]             = useState([])
  const [tradeSetupId, setTradeSetupId]           = useState(null)
  const [tradeLots, setTradeLots]                 = useState(1)
  const [tradeProductType, setTradeProductType]   = useState('INTRADAY')
  const [tradeOrderType, setTradeOrderType]       = useState('MARKET')
  const [reverseMode, setReverseMode]             = useState(() => {
    try { return localStorage.getItem('pt_reverse_mode') === '1' } catch { return false }
  })
  const [tradePrice, setTradePrice]               = useState('')
  const [tradeStrike, setTradeStrike]             = useState(null)   // null = use ATM
  const [tradeSubmitting, setTradeSubmitting]     = useState(false)
  const [tradeResult, setTradeResult]             = useState(null)

  // ── Auto-trade state ──────────────────────────────────────────────────────
  const [autoTradeEnabled, setAutoTradeEnabled]   = useState(() => {
    try {
      const v = localStorage.getItem('pt_auto_trade_enabled')
      if (v === null) return true // default ON for auto paper-trade
      return v === '1'
    } catch {
      return true
    }
  })
  const [autoLiveEnabled, setAutoLiveEnabled]     = useState(() => {
    try {
      const v = localStorage.getItem('pt_auto_live_enabled')
      if (v === null) return false // keep live OFF by default for safety
      return v === '1'
    } catch {
      return false
    }
  })
  const [autoMaxTrades, setAutoMaxTrades]         = useState(3)      // max trades this session
  const [autoTradeLog, setAutoTradeLog]           = useState([])     // history of auto-trades
  const [pendingAutoLiveTrade, setPendingAutoLiveTrade] = useState(() => {
    try {
      const raw = localStorage.getItem('pt_pending_auto_live_trade')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (isPendingTradeExpired(parsed)) {
        localStorage.removeItem('pt_pending_auto_live_trade')
        return null
      }
      return parsed
    } catch {
      return null
    }
  })
  const autoTradeCountRef                         = useRef(0)        // trades fired this session
  const prevSignalRef                             = useRef('NO TRADE') // last signal value
  const autoTradeInFlightRef                      = useRef(false)    // debounce concurrent fires
  const autoLiveInFlightRef                       = useRef(false)
  const [autoTradeCount, setAutoTradeCount]       = useState(0)      // mirror of ref — drives UI re-render
  

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 5000)
  }

  useEffect(() => {
    flash('Auto-trade mode is ON (paper-first). Enable Live Execute only when you are ready.', 'success')
  }, [])

  const clearPendingLiveTrade = (pendingTrade, options = {}) => {
    const {
      status = 'Cleared',
      error = null,
      keepResult = false,
      resultOk = false,
      resultMsg = null,
    } = options

    if (!pendingTrade) {
      setPendingAutoLiveTrade(null)
      return
    }

    setPendingAutoLiveTrade(null)

    if (pendingTrade.logId) {
      setAutoTradeLog((prev) => prev.map((entry) => (
        entry.id === pendingTrade.logId
          ? { ...entry, status, error }
          : entry
      )))
    }

    if (!keepResult && pendingTrade.source === 'MANUAL' && resultMsg) {
      setTradeResult({ ok: resultOk, msg: resultMsg })
    }
  }

  // Load connected accounts
  useEffect(() => {
    let cancelled = false

    const loadAccounts = async () => {
      try {
        const { data } = await axios.get('/api/angelone/accounts')
        const conn = data.filter((a) => a.connected)
        if (cancelled) return
        setAccounts(conn)
        if (!conn.length) {
          setAccountId(null)
          return
        }

        // Prefer an account that already has at least one active setup.
        let preferredId = conn[0].id
        for (const acc of conn) {
          try {
            const { data: setups } = await axios.get(`/api/trade-setups/account/${acc.id}`)
            const active = (setups || []).filter((s) => s.is_active)
            if (active.length > 0) {
              preferredId = acc.id
              break
            }
          } catch {
            // Ignore setup fetch errors per account and keep probing others.
          }
        }

        if (!cancelled) setAccountId(preferredId)
      } catch {
        if (!cancelled) flash('Failed to load accounts', 'error')
      }
    }

    loadAccounts()
    return () => { cancelled = true }
  }, [])

  const [loadingExpiries, setLoadingExpiries] = useState(false)

  const loadExpiries = useCallback((name) => {
    setLoadingExpiries(true)
    setExpiries([])
    setExpiry('')
    setChain([])
    setOiData({})
    axios.get(`/api/oi/expiries?name=${name}`, { timeout: 90_000 })
      .then(({ data }) => {
        setExpiries(data)
        // Auto-select the current week's expiry: nearest upcoming expiry >= today
        const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 }
        const parseExp = (s) => new Date(parseInt(s.slice(5)), MONTHS[s.slice(2,5)], parseInt(s.slice(0,2)))
        const todayMs = new Date().setHours(0,0,0,0)
        const nearest = data.find((e) => parseExp(e) >= todayMs) || data[0] || ''
        setExpiry(nearest)
      })
      .catch((err) => {
        const msg = err.response?.data?.error || err.message || 'Failed to load expiries'
        flash(`${msg} — retrying…`, 'error')
        setTimeout(() => loadExpiries(name), 4000)
      })
      .finally(() => setLoadingExpiries(false))
  }, [])

  // Reset + load expiries whenever underlying changes
  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStreaming(false)
    setStatus('idle')
    autoStartedRef.current = false
    loadExpiries(underlying)
  }, [underlying, loadExpiries])

  // Load option chain when expiry changes; reset auto-start guard
  useEffect(() => {
    if (!underlying || !expiry) return
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStreaming(false)
    setStatus('idle')
    setOiData({})
    setChain([])       // clear tokens so auto-start doesn't fire with stale chain
    setFutToken(null)
    autoStartedRef.current = false
    setLoadingChain(true)
    axios.get(`/api/oi/option-chain?name=${underlying}&expiry=${expiry}`)
      .then(({ data }) => {
        setChain(data.strikes || [])
        setFutToken(data.future?.token || null)
      })
      .catch(() => flash('Failed to load option chain', 'error'))
      .finally(() => setLoadingChain(false))
  }, [underlying, expiry])

  // If account changes, allow auto-start to run again for the new account.
  useEffect(() => {
    autoStartedRef.current = false
    setOiData({})
    setStreaming(false)
    setStatus('idle')
  }, [accountId])

  // Load trade setups when account or underlying changes
  useEffect(() => {
    if (!accountId) { setTradeSetups([]); setTradeSetupId(null); return }
    axios.get(`/api/trade-setups/account/${accountId}`)
      .then(({ data }) => {
        const active = data.filter((s) => s.is_active)
        setTradeSetups(active)
        // Auto-select a setup whose segment_name contains the underlying name
        const match = active.find((s) =>
          s.segment_name.toUpperCase().replace(/\s/g, '').includes(underlying.toUpperCase())
        ) || active[0] || null
        setTradeSetupId(match?.id ?? null)
        setTradeLots(match?.default_qty ?? 1)
        setTradeResult(null)
      })
      .catch(() => {})
  }, [accountId, underlying])

  const allTokens = useMemo(() => {
    const tokens = []
    chain.forEach((s) => {
      if (s.CE) tokens.push(s.CE.token)
      if (s.PE) tokens.push(s.PE.token)
    })
    if (futToken) tokens.push(futToken)
    return tokens
  }, [chain, futToken])

  const startStream = useCallback(async () => {
    if (!accountId)         { flash('Select an account first', 'error'); return false }
    if (!allTokens.length)  { flash('Load an option chain first', 'error'); return false }

    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    setStatus('connecting')
    try {
      await axios.post('/api/oi/subscribe', { accountId, tokens: allTokens, exchangeType: 2 })
    } catch (err) {
      setStatus('error')
      flash(err.response?.data?.error || 'Subscribe failed', 'error')
      autoStartedRef.current = false
      return false
    }
    // Also subscribe the spot index token (NSE/BSE) for live current price + ATM detection
    const spotInfo = SPOT_TOKENS[underlying]
    if (spotInfo) {
      try {
        await axios.post('/api/oi/subscribe', { accountId, tokens: [spotInfo.token], exchangeType: spotInfo.exchangeType })
      } catch {} // non-critical — ATM will fall back to futures
    }
    const es = new EventSource(`/api/oi/stream?accountId=${accountId}`)
    esRef.current = es
    es.addEventListener('connected', () => setStatus('live'))
    es.addEventListener('snapshot',  (e) => { try { setOiData(JSON.parse(e.data)) } catch {} })
    es.addEventListener('tick', (e) => {
      try {
        const t = JSON.parse(e.data)
        setOiData((prev) => ({ ...prev, [t.token]: t }))
      } catch {}
    })
    es.addEventListener('autherror', (e) => {
      try { flash(JSON.parse(e.data) || 'Session expired', 'error') } catch { flash('AngelOne session expired. Please reconnect the account.', 'error') }
      setStatus('error')
      setStreaming(false)
      // Do NOT reset autoStartedRef — prevents auto-reconnect loop on expired JWT
    })
    es.addEventListener('wserror', (e) => {
      try { flash(JSON.parse(e.data).message || 'Stream error', 'error') } catch {}
      setStatus('error')
      setStreaming(false)
      // Do NOT reset autoStartedRef — prevents auto-reconnect thrash
    })
    es.addEventListener('disconnected', () => {
      setStatus('idle')
      setStreaming(false)
      // Do NOT reset autoStartedRef — user must manually click Start Live or change expiry
    })
    es.onerror = () => setStatus((p) => p === 'live' ? 'connecting' : p)
    setStreaming(true)
    return true
  }, [accountId, allTokens, underlying])

  const stopStream = () => {
    esRef.current?.close(); esRef.current = null
    autoStartedRef.current = false
    setStreaming(false); setStatus('idle')
  }

  // ── Signal Trade execution ─────────────────────────────────────────────────
  const executeTrade = async (tradeOption, signal, lots, setupId, productType, orderType, price) => {
    if (!accountId)  { flash('Select an account', 'error'); return }
    if (!setupId)    { flash('No trade setup selected — add one in Trade Setups', 'error'); return }
    if (!tradeOption){ flash('No option contract found for this strike/signal', 'error'); return }
    if (orderType === 'LIMIT' && !price) { flash('Enter limit price', 'error'); return }
    if (pendingAutoLiveTrade) {
      if (isPendingTradeExpired(pendingAutoLiveTrade)) {
        clearPendingLiveTrade(pendingAutoLiveTrade, {
          status: 'Expired',
          error: 'Pending paper trade expired before live execution',
          resultMsg: 'Pending paper trade expired. Place the manual trade again.',
        })
      } else {
        setTradeResult({ ok: false, msg: 'A paper trade is already waiting for live execution. Execute or clear it first.' })
        flash('A pending paper trade is already waiting for live execution', 'error')
        return
      }
    }
    setTradeSubmitting(true)
    setTradeResult(null)
    try {
      const { data } = await axios.post('/api/orders/signal-trade', {
        accountId,
        setupId,
        signal,
        symbol:      tradeOption.symbol,
        token:       tradeOption.token,
        exchange:    'NFO',
        side:        'BUY',
        lots,
        productType,
        orderType,
        tradeMode:   'PAPER',
        price:       orderType === 'LIMIT' ? parseFloat(price) || null : null,
        atmStrike,
        underlying,
        expiry,
      })
      const refId = data.paper_order_id || data.order_id
      const pendingTrade = {
        source: 'MANUAL',
        accountId,
        setupId,
        signal,
        symbol: tradeOption.symbol,
        token: tradeOption.token,
        exchange: 'NFO',
        side: 'BUY',
        lots,
        productType,
        orderType,
        price: orderType === 'LIMIT' ? parseFloat(price) || null : null,
        atmStrike,
        underlying,
        expiry,
        qty: data.quantity,
        paperOrderId: refId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PENDING_LIVE_TRADE_TTL_MS).toISOString(),
      }

      setPendingAutoLiveTrade(pendingTrade)

      if (autoLiveEnabled) {
        setTradeResult({ ok: true, msg: `✓ Paper order placed — sending live order now. Paper Ref ID: ${refId}` })
        flash(`Paper trade placed: ${tradeOption.symbol} BUY ${data.quantity} @ ${orderType} — sending live order`, 'success')
        await executePendingAutoLiveTrade(pendingTrade)
      } else {
        setTradeResult({ ok: true, msg: `✓ Paper order placed — Ref ID: ${refId}. Expires at ${formatPendingTradeExpiry(pendingTrade)}` })
        flash(`Paper trade placed: ${tradeOption.symbol} BUY ${data.quantity} @ ${orderType}`, 'success')
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Order failed'
      setTradeResult({ ok: false, msg })
      flash(msg, 'error')
    } finally {
      setTradeSubmitting(false)
    }
  }

  const executePendingAutoLiveTrade = async (pendingTrade, logId = null) => {
    if (!pendingTrade || autoLiveInFlightRef.current) return
    if (isPendingTradeExpired(pendingTrade)) {
      clearPendingLiveTrade(pendingTrade, {
        status: 'Expired',
        error: 'Pending paper trade expired before live execution',
        resultMsg: 'Pending paper trade expired. Create a new trade before sending live.',
      })
      flash('Pending paper trade expired. Create a new signal trade before sending live.', 'error')
      return
    }

    autoLiveInFlightRef.current = true
    const liveLogId = logId || pendingTrade.logId || null

    if (liveLogId) {
      setAutoTradeLog((prev) => prev.map((entry) => (
        entry.id === liveLogId
          ? { ...entry, status: 'Sending live…', error: null }
          : entry
      )))
    }

    try {
      const { data } = await axios.post('/api/orders/signal-trade', {
        accountId: pendingTrade.accountId,
        setupId: pendingTrade.setupId,
        signal: pendingTrade.signal,
        symbol: pendingTrade.symbol,
        token: pendingTrade.token,
        exchange: pendingTrade.exchange,
        side: pendingTrade.side,
        lots: pendingTrade.lots,
        productType: pendingTrade.productType,
        orderType: pendingTrade.orderType,
        tradeMode: 'REAL',
        price: pendingTrade.price,
        atmStrike: pendingTrade.atmStrike,
        underlying: pendingTrade.underlying,
        expiry: pendingTrade.expiry,
      })

      const liveRefId = data.angel_order_id || data.order_id
      flash(`Auto Live trade placed: ${pendingTrade.symbol} BUY ${data.quantity}`, 'success')
      clearPendingLiveTrade(pendingTrade, { keepResult: true })
      if (pendingTrade.source === 'MANUAL') {
        setTradeResult({
          ok: true,
          msg: `✓ Paper + Live order placed — Refs: ${pendingTrade.paperOrderId || '-'} / ${liveRefId}`,
        })
      }
      if (liveLogId) {
        setAutoTradeLog((prev) => prev.map((entry) => (
          entry.id === liveLogId
            ? {
                ...entry,
                status: 'Paper + Live placed',
                angelId: pendingTrade.paperOrderId
                  ? `${pendingTrade.paperOrderId} / ${liveRefId}`
                  : liveRefId,
                error: null,
              }
            : entry
        )))
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Live execution failed'
      flash(`Pending live execution failed: ${errMsg}`, 'error')
      if (pendingTrade.source === 'MANUAL') {
        setTradeResult({
          ok: false,
          msg: `Paper order is still pending live execution. ${errMsg}`,
        })
      }
      if (liveLogId) {
        setAutoTradeLog((prev) => prev.map((entry) => (
          entry.id === liveLogId
            ? { ...entry, status: 'Paper ready', error: errMsg }
            : entry
        )))
      }
    } finally {
      autoLiveInFlightRef.current = false
    }
  }

  // ── Auto-start: fire as soon as account + chain are ready ─────────────────
  useEffect(() => {
    if (autoStartedRef.current) return
    if (!accountId || allTokens.length === 0 || streaming) return
    autoStartedRef.current = true
    startStream().then((ok) => {
      if (!ok) autoStartedRef.current = false
    })
  }, [accountId, allTokens, streaming, startStream])

  useEffect(() => () => esRef.current?.close(), [])

  // ── Derived chart data ────────────────────────────────────────────────────
  const atmStrike = useMemo(() => {
    const spotInfo = SPOT_TOKENS[underlying]
    // Prefer spot index price for ATM; fall back to futures
    const refPrice = (spotInfo && oiData[spotInfo.token]?.ltp)
      || (futToken && oiData[futToken]?.ltp)
    if (!refPrice || !chain.length) return null
    const nearest = chain.reduce((best, s) =>
      Math.abs(s.strike - refPrice) < Math.abs(best.strike - refPrice) ? s : best,
      chain[0]
    )
    return nearest.strike
  }, [underlying, futToken, oiData, chain])

  const chartData = useMemo(() => {
    let rows = chain
    // Narrow to visibleRange strikes around ATM
    if (atmStrike) {
      const idx = rows.findIndex((r) => r.strike === atmStrike)
      if (idx !== -1) {
        const half = Math.floor(visibleRange / 2)
        rows = rows.slice(Math.max(0, idx - half), idx + half + 1)
      }
    } else {
      rows = rows.slice(0, visibleRange)
    }
    return rows.map((s) => {
      const ceOI = oiData[s.CE?.token]?.oi || 0
      const peOI = oiData[s.PE?.token]?.oi || 0
      return {
        strike: s.strike,
        callOI: ceOI,
        putOI:  peOI,
        isATM:  s.strike === atmStrike,
      }
    })
  }, [chain, oiData, atmStrike, visibleRange])

  const { totalCallOI, totalPutOI, pcr } = useMemo(() => {
    let ce = 0, pe = 0
    chain.forEach((s) => {
      ce += oiData[s.CE?.token]?.oi || 0
      pe += oiData[s.PE?.token]?.oi || 0
    })
    return { totalCallOI: ce, totalPutOI: pe, pcr: ce > 0 ? (pe / ce) : 0 }
  }, [chain, oiData, atmStrike, srWindowSize, tieBreaker])

  const pcrSentiment = pcr === 0 ? null : pcr > PCR_NEUTRAL ? { label: 'Bullish', color: '#10b981' }
    : pcr < PCR_NEUTRAL ? { label: 'Bearish', color: '#ef4444' }
    : { label: 'Neutral', color: '#f59e0b' }

  const st = STATUS_COLORS[status] || STATUS_COLORS.idle
  const spotInfo = SPOT_TOKENS[underlying]
  const spotLTP  = spotInfo ? oiData[spotInfo.token]?.ltp : null
  const futLTP   = futToken ? oiData[futToken]?.ltp : null

  const oiSR = useMemo(() => {
    if (!chain || !chain.length) return { support: null, resistance: null }
    // Select rows using srWindowSize around ATM (or fallback to first N)
    let rows = chain
    if (atmStrike) {
      const idx = chain.findIndex((s) => s.strike === atmStrike)
      if (idx !== -1) {
        const half = Math.max(6, Math.floor(srWindowSize / 2))
        rows = chain.slice(Math.max(0, idx - half), idx + half + 1)
      }
    } else {
      rows = chain.slice(0, srWindowSize)
    }

    // Compute support/resistance based on tie-breaker
    let support = null, resistance = null
    if (tieBreaker === 'nearestATM' && atmStrike) {
      // pick the strike (put for support / call for resistance) nearest to ATM among top N
      // find top N by OI, then choose nearest to ATM
      const putList = rows.map((s) => ({ strike: s.strike, oi: oiData[s.PE?.token]?.oi || 0 }))
        .sort((a,b) => b.oi - a.oi)
      const callList = rows.map((s) => ({ strike: s.strike, oi: oiData[s.CE?.token]?.oi || 0 }))
        .sort((a,b) => b.oi - a.oi)
      const pickNearest = (list) => {
        if (!list.length) return null
        const top = list.slice(0, Math.max(3, Math.floor(list.length/4)))
        top.sort((a,b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike))
        return top[0].strike
      }
      support = pickNearest(putList)
      resistance = pickNearest(callList)
    } else {
      // default: highest OI within window
      let maxPut = -1, maxCall = -1
      rows.forEach((s) => {
        const putOI = oiData[s.PE?.token]?.oi || 0
        const callOI = oiData[s.CE?.token]?.oi || 0
        if (putOI > maxPut) { maxPut = putOI; support = s.strike }
        if (callOI > maxCall) { maxCall = callOI; resistance = s.strike }
      })
    }
    return { support, resistance }
  }, [chain, oiData])

  // Cumulative OI bands: smallest strike range around ATM that includes >= bandThreshold of total OI
  const oiBands = useMemo(() => {
    if (!chain || !chain.length) return { putBand: null, callBand: null }
    // choose rows near ATM similar to SR selection but wider (use visibleRange)
    let rows = chain
    if (atmStrike) {
      const idx = chain.findIndex((s) => s.strike === atmStrike)
      if (idx !== -1) {
        const half = Math.floor(visibleRange / 2)
        rows = chain.slice(Math.max(0, idx - half), idx + half + 1)
      }
    } else {
      rows = chain.slice(0, visibleRange)
    }

    const putTotals = rows.map((s) => ({ strike: s.strike, oi: oiData[s.PE?.token]?.oi || 0 }))
    const callTotals = rows.map((s) => ({ strike: s.strike, oi: oiData[s.CE?.token]?.oi || 0 }))
    const totalPut = putTotals.reduce((s, r) => s + r.oi, 0)
    const totalCall = callTotals.reduce((s, r) => s + r.oi, 0)
    const thresholdPut = totalPut * bandThreshold
    const thresholdCall = totalCall * bandThreshold

    const computeBand = (arr, totalThresh) => {
      if (totalThresh <= 0) return null
      if (!atmStrike) return null
      const idx = rows.findIndex((s) => s.strike === atmStrike)
      const n = rows.length
      let low = idx, high = idx
      let acc = arr[idx]?.oi || 0
      while ((acc < totalThresh) && (low > 0 || high < n-1)) {
        const left = low > 0 ? arr[low-1].oi : -1
        const right = high < n-1 ? arr[high+1].oi : -1
        if (left >= right) { low = Math.max(0, low-1); acc += arr[low].oi }
        else { high = Math.min(n-1, high+1); acc += arr[high].oi }
      }
      return { lowStrike: rows[low].strike, highStrike: rows[high].strike }
    }

    const putBand = computeBand(putTotals, thresholdPut)
    const callBand = computeBand(callTotals, thresholdCall)
    return { putBand, callBand }
  }, [chain, oiData, atmStrike, visibleRange, bandThreshold])

  // Compute OI totals for put/call bands (for UI display)
  const oiBandTotals = useMemo(() => {
    const res = { put: 0, call: 0 }
    if (!oiBands) return res
    const findIndexByStrike = (s) => chain.findIndex((r) => r.strike === s)
    if (oiBands.putBand) {
      const li = findIndexByStrike(oiBands.putBand.lowStrike)
      const hi = findIndexByStrike(oiBands.putBand.highStrike)
      if (li !== -1 && hi !== -1) {
        for (let i = li; i <= hi; i++) res.put += oiData[chain[i].PE?.token]?.oi || 0
      }
    }
    if (oiBands.callBand) {
      const li = findIndexByStrike(oiBands.callBand.lowStrike)
      const hi = findIndexByStrike(oiBands.callBand.highStrike)
      if (li !== -1 && hi !== -1) {
        for (let i = li; i <= hi; i++) res.call += oiData[chain[i].CE?.token]?.oi || 0
      }
    }
    return res
  }, [oiBands, chain, oiData])

  const atmCallPremium = useMemo(() => {
    if (!atmStrike) return null
    const atmRow = chain.find((s) => s.strike === atmStrike)
    if (!atmRow?.CE?.token) return null
    return oiData[atmRow.CE.token]?.ltp ?? null
  }, [atmStrike, chain, oiData])

  const atmPutPremium = useMemo(() => {
    if (!atmStrike) return null
    const atmRow = chain.find((s) => s.strike === atmStrike)
    if (!atmRow?.PE?.token) return null
    return oiData[atmRow.PE.token]?.ltp ?? null
  }, [atmStrike, chain, oiData])

  // Signal: high-probability setup using PCR + OI + price action
  const oiSignal = useMemo(() => {
    const rows = chartData || []
    const ceZero = rows.reduce((s, r) => s + (r.callOI === 0 ? 1 : 0), 0)
    const peZero = rows.reduce((s, r) => s + (r.putOI === 0 ? 1 : 0), 0)
    const pcrVal = pcr || 0

    const priceNow = spotLTP || futLTP || null
    const prevPrice = prevPriceRef.current
    const prevCallOi = prevCallOiRef.current
    const prevPutOi = prevPutOiRef.current

    const priceBreakResistance = Boolean(
      oiSR?.resistance &&
      priceNow != null &&
      prevPrice != null &&
      prevPrice <= oiSR.resistance &&
      priceNow > oiSR.resistance
    )

    const priceBreakSupport = Boolean(
      oiSR?.support &&
      priceNow != null &&
      prevPrice != null &&
      prevPrice >= oiSR.support &&
      priceNow < oiSR.support
    )

    const callOiDropPct = prevCallOi > 0 ? ((totalCallOI - prevCallOi) / prevCallOi) : 0
    const putOiChangePct = prevPutOi > 0 ? ((totalPutOI - prevPutOi) / prevPutOi) : 0

    const callOiUnwinding = Boolean(prevCallOi != null && callOiDropPct <= -0.01)
    const putOiUnwinding = Boolean(prevPutOi != null && putOiChangePct <= -0.01)
    const putOiIncrease = Boolean(prevPutOi != null && putOiChangePct >= 0.01)
    const callOiIncrease = Boolean(prevCallOi != null && callOiDropPct >= 0.01)

    const bullishPcrOk = pcrVal > BULLISH_PCR_MIN
    const bearishPcrOk = pcrVal < BEARISH_PCR_MAX

    const ceBuyReady = priceBreakResistance && callOiUnwinding && putOiIncrease && bullishPcrOk
    const peBuyReady = priceBreakSupport && putOiUnwinding && callOiIncrease && bearishPcrOk

    let signal = 'NO TRADE'
    if (ceBuyReady) signal = 'CE BUY'
    else if (peBuyReady) signal = 'PE BUY'

    return {
      ceZero,
      peZero,
      pcr: pcrVal,
      signal,
      setup: {
        ceBuyReady,
        peBuyReady,
      },
      signs: {
        priceBreakResistance,
        priceBreakSupport,
        callOiUnwinding,
        putOiIncrease,
        putOiUnwinding,
        callOiIncrease,
        bullishPcrOk,
        bearishPcrOk,
      },
      deltas: {
        callOiChangePct: callOiDropPct,
        putOiChangePct,
      },
    }
  }, [chartData, pcr, spotLTP, futLTP, oiSR, totalCallOI, totalPutOI])

  useEffect(() => {
    const priceNow = spotLTP || futLTP || null
    if (priceNow != null) prevPriceRef.current = priceNow
    prevCallOiRef.current = totalCallOI
    prevPutOiRef.current = totalPutOI
    if (atmCallPremium != null) prevAtmCePremRef.current = atmCallPremium
  }, [spotLTP, futLTP, totalCallOI, totalPutOI, atmCallPremium])

  // Share latest OI signal across pages for auto-trade decision display.
  useEffect(() => {
    const payload = {
      signal: oiSignal.signal,
      underlying,
      expiry,
      atmStrike,
      pcr: oiSignal.pcr,
      setup: oiSignal.setup,
      signs: oiSignal.signs,
      deltas: oiSignal.deltas,
      ts: new Date().toISOString(),
    }
    localStorage.setItem('pt_oi_signal', JSON.stringify(payload))
  }, [oiSignal.signal, oiSignal.pcr, oiSignal.setup, oiSignal.signs, oiSignal.deltas, underlying, expiry, atmStrike])

  // ── Auto-trade: fires when signal changes from NO TRADE to an actionable value ──
  useEffect(() => {
    const signal = oiSignal.signal
    const prev   = prevSignalRef.current

    // Only act on a fresh signal edge: previous was NO TRADE and new is actionable
    const isNewSignal = prev === 'NO TRADE' && signal !== 'NO TRADE'
    prevSignalRef.current = signal

    if (!isNewSignal) return
    if (!autoTradeEnabled) return
    if (!accountId || !tradeSetupId) return
    if (pendingAutoLiveTrade) {
      flash('Auto-trade is waiting on an existing paper trade. Execute or clear the pending live trade first.', 'error')
      return
    }
    if (autoTradeCountRef.current >= autoMaxTrades) {
      flash(`Auto-trade: max trades (${autoMaxTrades}) reached for this session`, 'error')
      return
    }
    if (autoTradeInFlightRef.current) return   // already placing

    // Determine option to buy
    const side          = signalToOptionType(signal, reverseMode)
    if (!side) return
    const effectStrike  = tradeStrike ?? atmStrike
    if (!effectStrike) return
    const row           = chain.find((s) => s.strike === effectStrike)
    const option        = side === 'CE' ? row?.CE : row?.PE
    if (!option) return

    const setup = tradeSetups.find((s) => s.id === tradeSetupId)
    if (!setup) return

    autoTradeInFlightRef.current = true
    autoTradeCountRef.current   += 1
    setAutoTradeCount(autoTradeCountRef.current)

    const logEntry = {
      id:        Date.now(),
      ts:        new Date().toLocaleTimeString(),
      signal,
      symbol:    option.symbol,
      lots:      tradeLots,
      qty:       tradeLots * (setup.lot_size || 1),
      side,
      status:    'Paper placing…',
      angelId:   null,
      error:     null,
    }
    setAutoTradeLog((prev) => [logEntry, ...prev].slice(0, 50))

    axios.post('/api/orders/signal-trade', {
      accountId,
      setupId:     tradeSetupId,
      signal,
      symbol:      option.symbol,
      token:       option.token,
      exchange:    'NFO',
      side:        'BUY',
      lots:        tradeLots,
      productType: tradeProductType,
      orderType:   tradeOrderType,
      tradeMode:   'PAPER',
      price:       tradeOrderType === 'LIMIT' ? parseFloat(tradePrice) || null : null,
      atmStrike:   effectStrike,
      underlying,
      expiry,
    })
      .then(async ({ data }) => {
        const refId = data.paper_order_id || data.order_id
        const pendingTrade = {
          source: 'AUTO',
          accountId,
          setupId: tradeSetupId,
          signal,
          symbol: option.symbol,
          token: option.token,
          exchange: 'NFO',
          side: 'BUY',
          lots: tradeLots,
          productType: tradeProductType,
          orderType: tradeOrderType,
          price: tradeOrderType === 'LIMIT' ? parseFloat(tradePrice) || null : null,
          atmStrike: effectStrike,
          underlying,
          expiry,
          qty: data.quantity,
          paperOrderId: refId,
          logId: logEntry.id,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + PENDING_LIVE_TRADE_TTL_MS).toISOString(),
        }

        setPendingAutoLiveTrade(pendingTrade)

        if (autoLiveEnabled) {
          setAutoTradeLog((prev) => prev.map((e) =>
            e.id === logEntry.id
              ? { ...e, status: 'Paper placed, sending live…', angelId: refId }
              : e
          ))
          flash(`Auto Paper ✓ ${option.symbol} BUY ${data.quantity} — sending live order`, 'success')
          await executePendingAutoLiveTrade(pendingTrade, logEntry.id)
          return
        }

        flash(`Auto Paper ✓ ${option.symbol} BUY ${data.quantity} — turn ON Live Execute to place the real order`, 'success')
        setAutoTradeLog((prev) => prev.map((e) =>
          e.id === logEntry.id
            ? { ...e, status: 'Paper ready', angelId: refId }
            : e
        ))
      })
      .catch((err) => {
        const errMsg = err.response?.data?.error || 'Auto-trade failed'
        flash(`Auto-trade failed: ${errMsg}`, 'error')
        autoTradeCountRef.current = Math.max(0, autoTradeCountRef.current - 1)
        setAutoTradeCount(autoTradeCountRef.current)
        setAutoTradeLog((prev) => prev.map((e) =>
          e.id === logEntry.id ? { ...e, status: 'Failed', error: errMsg } : e
        ))
      })
      .finally(() => { autoTradeInFlightRef.current = false })
  }, [oiSignal.signal, reverseMode, pendingAutoLiveTrade, autoLiveEnabled])  // eslint-disable-line react-hooks/exhaustive-deps

  // Reset auto-trade session count when disabled or underlying/expiry changes
  useEffect(() => {
    autoTradeCountRef.current = 0
    setAutoTradeCount(0)
    prevSignalRef.current = 'NO TRADE'
    autoTradeInFlightRef.current = false
    autoLiveInFlightRef.current = false
  }, [autoTradeEnabled, underlying, expiry])

  useEffect(() => {
    autoLiveInFlightRef.current = false
    setPendingAutoLiveTrade(null)
  }, [underlying, expiry])

  // Persist auto-trade toggle so ON/OFF survives page refresh.
  useEffect(() => {
    try {
      localStorage.setItem('pt_auto_trade_enabled', autoTradeEnabled ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [autoTradeEnabled])

  useEffect(() => {
    try {
      localStorage.setItem('pt_auto_live_enabled', autoLiveEnabled ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [autoLiveEnabled])

  useEffect(() => {
    try {
      if (pendingAutoLiveTrade) localStorage.setItem('pt_pending_auto_live_trade', JSON.stringify(pendingAutoLiveTrade))
      else localStorage.removeItem('pt_pending_auto_live_trade')
    } catch {
      // Ignore storage errors.
    }
  }, [pendingAutoLiveTrade])

  useEffect(() => {
    if (!pendingAutoLiveTrade) return
    if (isPendingTradeExpired(pendingAutoLiveTrade)) {
      clearPendingLiveTrade(pendingAutoLiveTrade, {
        status: 'Expired',
        error: 'Pending paper trade expired before live execution',
        resultMsg: 'Pending paper trade expired. Create a fresh trade to send live.',
      })
      return
    }

    const expiresInMs = new Date(pendingAutoLiveTrade.expiresAt).getTime() - Date.now()
    const timer = setTimeout(() => {
      clearPendingLiveTrade(pendingAutoLiveTrade, {
        status: 'Expired',
        error: 'Pending paper trade expired before live execution',
        resultMsg: 'Pending paper trade expired. Create a fresh trade to send live.',
      })
      flash('Pending paper trade expired and was cleared automatically.', 'error')
    }, Math.max(0, expiresInMs))

    return () => clearTimeout(timer)
  }, [pendingAutoLiveTrade])

  useEffect(() => {
    try {
      localStorage.setItem('pt_reverse_mode', reverseMode ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [reverseMode])

  // ── Signal Trade derived values ────────────────────────────────────────────
  // Determine which option side the signal calls for
  const tradeSide = signalToOptionType(oiSignal.signal, reverseMode)

  const tradeEffectiveStrike = tradeStrike ?? atmStrike
  const tradeOptionRow = tradeEffectiveStrike != null
    ? chain.find((s) => s.strike === tradeEffectiveStrike)
    : null
  const tradeOption = tradeSide === 'CE'
    ? (tradeOptionRow?.CE ?? null)
    : tradeSide === 'PE' ? (tradeOptionRow?.PE ?? null) : null
  const tradeOptionLTP    = tradeOption ? (oiData[tradeOption.token]?.ltp ?? null) : null
  const currentTradeSetup = tradeSetups.find((s) => s.id === tradeSetupId) ?? null
  const tradeTotalQty     = tradeLots * (currentTradeSetup?.lot_size || 1)

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #38bdf8 60%, #818cf8 100%)',
            color: '#fff', fontSize: 20,
          }}>📊</span>
          OI Chart &amp; PCR — Live
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
          Real-time Call / Put Open Interest bar chart with PCR via AngelOne WebSocket 2.0
        </p>
      </div>

      {msg && <div className={`angel-msg angel-msg--${msg.type}`} style={{ marginTop: '1.2rem' }}>{msg.text}</div>}

      {/* ── Controls ── */}
      <div className="glass-card" style={{ marginTop: '1.8rem', marginBottom: '1.8rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>

          {/* Underlying */}
          <div style={{ flex: '0 0 170px' }}>
            <label className="angel-label">Underlying</label>
            <select className="angel-input" value={underlying} onChange={(e) => setUnderlying(e.target.value)} style={{ cursor: 'pointer' }}>
              {UNDERLYINGS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Expiry */}
          <div style={{ flex: '0 0 170px' }}>
            <label className="angel-label">Expiry</label>
            <select className="angel-input" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={!expiries.length} style={{ cursor: 'pointer' }}>
              {loadingExpiries && <option value="">Loading expiries…</option>}
              {!loadingExpiries && expiries.length === 0 && <option value="">No expiries</option>}
              {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Strikes range */}
          <div style={{ flex: '0 0 150px' }}>
            <label className="angel-label">Strikes visible</label>
            <select className="angel-input" value={visibleRange} onChange={(e) => setVisibleRange(parseInt(e.target.value))} style={{ cursor: 'pointer' }}>
              {[10, 14, 20, 30, 40, 60].map((v) => <option key={v} value={v}>{v} strikes</option>)}
            </select>
          </div>

          {/* SR window size */}
          <div style={{ flex: '0 0 170px' }}>
            <label className="angel-label">SR window</label>
            <select className="angel-input" value={srWindowSize} onChange={(e) => setSrWindowSize(parseInt(e.target.value))} style={{ cursor: 'pointer' }}>
              {[10, 14, 20, 30, 40].map((v) => <option key={v} value={v}>{v} strikes</option>)}
            </select>
          </div>

          {/* Tie breaker */}
          <div style={{ flex: '0 0 200px' }}>
            <label className="angel-label">SR tie-breaker</label>
            <select className="angel-input" value={tieBreaker} onChange={(e) => setTieBreaker(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="maxOI">Highest OI</option>
              <option value="nearestATM">Nearest to ATM among top OI</option>
            </select>
          </div>

          {/* Removed: OI band %, Visuals, Export per user request */}

          {/* Status pill */}
          <div style={{ padding: '6px 16px', borderRadius: 20, background: st.bg, color: st.color, fontSize: 13, fontWeight: 700 }}>
            {st.label}
          </div>

          {/* Stream controls */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="angel-btn"
              onClick={() => {
                autoStartedRef.current = false
                startStream()
              }}
              disabled={!accountId || loadingChain || allTokens.length === 0}
            >
              Start Live
            </button>
            <button className="angel-btn" onClick={stopStream} disabled={!streaming}>
              Stop
            </button>
          </div>
        </div>
      </div>

      {/* ── PCR + Stats row ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: '1.8rem' }}>

        {/* PCR big number */}
        <div className="glass-card" style={{ flex: '0 0 200px', textAlign: 'center', padding: '1.4rem 1rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6 }}>PUT CALL RATIO</div>
          <div style={{ fontSize: 44, fontWeight: 800, color: pcrSentiment?.color || '#a5b4fc', lineHeight: 1 }}>
            {pcr > 0 ? pcr.toFixed(2) : '—'}
          </div>
          {pcrSentiment && (
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: pcrSentiment.color,
              background: `${pcrSentiment.color}20`, borderRadius: 20, padding: '3px 14px', display: 'inline-block' }}>
              {pcrSentiment.label}
            </div>
          )}
        </div>

        {/* Signal card */}
        <div className="glass-card" style={{ flex: '0 0 300px', padding: '1.2rem 1.2rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6, textAlign: 'center' }}>SIGNAL</div>
          <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center',
            color: oiSignal.signal === 'CE BUY' ? '#10b981' : oiSignal.signal === 'PE BUY' ? '#ef4444' : '#94a3b8', marginBottom: 10 }}>
            {oiSignal.signal}
          </div>

          {/* ── PE BUY conditions ── */}
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '0.07em', marginBottom: 4 }}>PE BUY CONDITIONS</div>
          {[
            {
              label: 'PE OI ↓ ≥ 1%',
              passed: oiSignal.signs?.putOiUnwinding,
              value: oiSignal.deltas?.putOiChangePct != null
                ? (oiSignal.deltas.putOiChangePct >= 0 ? '+' : '') + (oiSignal.deltas.putOiChangePct * 100).toFixed(2) + '%'
                : '—',
            },
            {
              label: 'CE OI ↑ ≥ 1%',
              passed: oiSignal.signs?.callOiIncrease,
              value: oiSignal.deltas?.callOiChangePct != null
                ? (oiSignal.deltas.callOiChangePct >= 0 ? '+' : '') + (oiSignal.deltas.callOiChangePct * 100).toFixed(2) + '%'
                : '—',
            },
            {
              label: 'PCR < 0.7',
              passed: oiSignal.signs?.bearishPcrOk,
              value: oiSignal.pcr ? oiSignal.pcr.toFixed(2) : '—',
            },
          ].map(({ label, passed, value }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', borderRadius: 7, marginBottom: 3,
              background: passed ? 'rgba(16,185,129,0.13)' : 'rgba(100,116,139,0.08)',
              border: `1px solid ${passed ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.15)'}`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: passed ? '#10b981' : '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: passed ? '#10b981' : '#64748b' }}>{value}</span>
            </div>
          ))}

          {/* ── CE BUY conditions ── */}
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '0.07em', marginTop: 10, marginBottom: 4 }}>CE BUY CONDITIONS</div>
          {[
            {
              label: 'CE OI ↓ ≥ 1%',
              passed: oiSignal.signs?.callOiUnwinding,
              value: oiSignal.deltas?.callOiChangePct != null
                ? (oiSignal.deltas.callOiChangePct >= 0 ? '+' : '') + (oiSignal.deltas.callOiChangePct * 100).toFixed(2) + '%'
                : '—',
            },
            {
              label: 'PE OI ↑ ≥ 1%',
              passed: oiSignal.signs?.putOiIncrease,
              value: oiSignal.deltas?.putOiChangePct != null
                ? (oiSignal.deltas.putOiChangePct >= 0 ? '+' : '') + (oiSignal.deltas.putOiChangePct * 100).toFixed(2) + '%'
                : '—',
            },
            {
              label: 'PCR > 1',
              passed: oiSignal.signs?.bullishPcrOk,
              value: oiSignal.pcr ? oiSignal.pcr.toFixed(2) : '—',
            },
          ].map(({ label, passed, value }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', borderRadius: 7, marginBottom: 3,
              background: passed ? 'rgba(16,185,129,0.13)' : 'rgba(100,116,139,0.08)',
              border: `1px solid ${passed ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.15)'}`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: passed ? '#10b981' : '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: passed ? '#10b981' : '#64748b' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Call OI total */}
        <div className="glass-card" style={{ flex: '1 1 160px', padding: '1.2rem 1.4rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>TOTAL CALL OI</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981', marginTop: 6 }}>{fmtL(totalCallOI)}</div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>CE across all strikes</div>
        </div>

        {/* Put OI total */}
        <div className="glass-card" style={{ flex: '1 1 160px', padding: '1.2rem 1.4rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>TOTAL PUT OI</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444', marginTop: 6 }}>{fmtL(totalPutOI)}</div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>PE across all strikes</div>
        </div>

        {/* Spot price */}
        <div className="glass-card" style={{ flex: '1 1 160px', padding: '1.2rem 1.4rem', border: spotLTP ? '1px solid rgba(56,189,248,0.35)' : undefined }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>{underlying} SPOT</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#38bdf8', marginTop: 6 }}>
            {spotLTP ? `₹${spotLTP.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>ATM: {atmStrike ? `₹${atmStrike}` : '—'}</div>
        </div>

        {/* Futures LTP */}
        {futToken && (
          <div className="glass-card" style={{ flex: '1 1 160px', padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>{underlying} FUT</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#818cf8', marginTop: 6 }}>
              {futLTP ? `₹${futLTP.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>Futures price</div>
          </div>
        )}

        {/* Chain stats */}
        <div className="glass-card" style={{ flex: '1 1 160px', padding: '1.2rem 1.4rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>OPTION CHAIN</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#a78bfa', marginTop: 6 }}>
            {loadingChain ? '…' : chain.length}
          </div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>strikes loaded</div>
        </div>

        {/* Support (from max Put OI) */}
        <div className="glass-card" style={{ flex: '0 0 180px', padding: '1.2rem 1.4rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>SUPPORT</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#06b6d4', marginTop: 6 }}>{oiSR?.support ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
            {oiBands?.putBand ? `Band: ${oiBands.putBand.lowStrike} — ${oiBands.putBand.highStrike}` : 'No band'}
          </div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 6 }}>Highest Put OI strike (within SR window)</div>
        </div>

        {/* Resistance (from max Call OI) */}
        <div className="glass-card" style={{ flex: '0 0 180px', padding: '1.2rem 1.4rem' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: '0.07em' }}>RESISTANCE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444', marginTop: 6 }}>{oiSR?.resistance ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
            {oiBands?.callBand ? `Band: ${oiBands.callBand.lowStrike} — ${oiBands.callBand.highStrike}` : 'No band'}
          </div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 6 }}>Highest Call OI strike (within SR window)</div>
        </div>
      </div>

      {/* ── Paper Trade Panel ── */}
      {atmStrike && (
        <div className="glass-card" style={{ marginBottom: '1.8rem', padding: '1.4rem 1.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.2rem' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>Paper Trade</span>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>ATM {atmStrike} · {underlying} {expiry}</span>
            {tradeResult && (
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700,
                color: tradeResult.ok ? '#10b981' : '#ef4444',
                background: tradeResult.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${tradeResult.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 8, padding: '4px 12px',
              }}>{tradeResult.msg}</span>
            )}
          </div>

          {/* Live ATM price strip */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '1.2rem' }}>
            <div style={{ flex: '1 1 160px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>ATM CE LIVE</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981', marginTop: 2 }}>
                {atmCallPremium != null ? `₹${atmCallPremium.toFixed(2)}` : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {chain.find((s) => s.strike === atmStrike)?.CE?.symbol || ''}
              </div>
            </div>
            <div style={{ flex: '1 1 160px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>ATM PE LIVE</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#ef4444', marginTop: 2 }}>
                {atmPutPremium != null ? `₹${atmPutPremium.toFixed(2)}` : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {chain.find((s) => s.strike === atmStrike)?.PE?.symbol || ''}
              </div>
            </div>
            <div style={{ flex: '1 1 160px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)',
              borderRadius: 10, padding: '10px 16px' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>SIGNAL</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2,
                color: oiSignal.signal === 'CE BUY' ? '#10b981' : oiSignal.signal === 'PE BUY' ? '#ef4444' : '#94a3b8' }}>
                {oiSignal.signal}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>OI + PCR signal</div>
            </div>
          </div>

          {/* Trade controls row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {/* Account select */}
            {accounts.length > 1 && (
              <div style={{ flex: '0 0 180px' }}>
                <label className="angel-label">Account</label>
                <select className="angel-input" value={accountId || ''} onChange={(e) => setAccountId(e.target.value ? parseInt(e.target.value) : null)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.client_code}</option>)}
                </select>
              </div>
            )}

            {/* Setup select */}
            <div style={{ flex: '0 0 200px' }}>
              <label className="angel-label">Trade Setup</label>
              <select className="angel-input" value={tradeSetupId || ''} onChange={(e) => setTradeSetupId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">— select setup —</option>
                {tradeSetups.map((s) => <option key={s.id} value={s.id}>{s.segment_name || s.id}</option>)}
              </select>
            </div>

            {/* Lots */}
            <div style={{ flex: '0 0 100px' }}>
              <label className="angel-label">Lots</label>
              <input className="angel-input" type="number" min="1" max="50" value={tradeLots}
                onChange={(e) => setTradeLots(Math.max(1, parseInt(e.target.value) || 1))} />
            </div>

            {/* Product type */}
            <div style={{ flex: '0 0 140px' }}>
              <label className="angel-label">Product</label>
              <select className="angel-input" value={tradeProductType} onChange={(e) => setTradeProductType(e.target.value)}>
                <option value="INTRADAY">INTRADAY</option>
                <option value="CARRYFORWARD">CARRYFORWARD</option>
              </select>
            </div>

            {/* CE Buy button */}
            <button
              className="angel-btn"
              style={{ flex: '1 1 130px', background: oiSignal.signs?.putOiUnwinding && oiSignal.signs?.callOiIncrease && oiSignal.signs?.bearishPcrOk ? 'rgba(239,68,68,0.85)' : undefined, fontWeight: 700 }}
              disabled={tradeSubmitting || !accountId || !tradeSetupId || !atmStrike}
              onClick={() => {
                const atmRow = chain.find((s) => s.strike === atmStrike)
                executeTrade(atmRow?.PE, 'PE BUY', tradeLots, tradeSetupId, tradeProductType, 'MARKET', null)
              }}
            >
              {tradeSubmitting ? 'Placing…' : `PE BUY${atmPutPremium != null ? ` ₹${atmPutPremium.toFixed(2)}` : ''}`}
            </button>

            <button
              className="angel-btn"
              style={{ flex: '1 1 130px', background: oiSignal.signs?.callOiUnwinding && oiSignal.signs?.putOiIncrease && oiSignal.signs?.bullishPcrOk ? 'rgba(16,185,129,0.85)' : undefined, fontWeight: 700 }}
              disabled={tradeSubmitting || !accountId || !tradeSetupId || !atmStrike}
              onClick={() => {
                const atmRow = chain.find((s) => s.strike === atmStrike)
                executeTrade(atmRow?.CE, 'CE BUY', tradeLots, tradeSetupId, tradeProductType, 'MARKET', null)
              }}
            >
              {tradeSubmitting ? 'Placing…' : `CE BUY${atmCallPremium != null ? ` ₹${atmCallPremium.toFixed(2)}` : ''}`}
            </button>
          </div>

          {/* Pending paper trade banner */}
          {pendingAutoLiveTrade && (
            <div style={{ marginTop: '1rem', padding: '10px 14px', borderRadius: 8,
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>
                ⏳ Pending paper trade: {pendingAutoLiveTrade.symbol} BUY {pendingAutoLiveTrade.qty ?? '?'} lots
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>Expires {formatPendingTradeExpiry(pendingAutoLiveTrade)}</span>
              <button className="angel-btn" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 14px' }}
                onClick={() => clearPendingLiveTrade(pendingAutoLiveTrade, { status: 'Cleared manually' })}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── OI Bar Chart ── */}
      <div className="glass-card" style={{ padding: '1.6rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#a5b4fc' }}>
            Open Interest Chart — {underlying} {expiry}
          </span>
          <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: '#10b981', display: 'inline-block' }} />
              <span style={{ color: '#94a3b8' }}>Call OI (CE)</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: '#ef4444', display: 'inline-block' }} />
              <span style={{ color: '#94a3b8' }}>Put OI (PE)</span>
            </span>
            {atmStrike && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: '#f59e0b', display: 'inline-block' }} />
                <span style={{ color: '#94a3b8' }}>ATM</span>
              </span>
            )}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.25)', fontSize: 15 }}>
            {loadingChain ? 'Loading option chain…' : 'Select underlying + expiry to start live OI'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} barCategoryGap="20%" barGap={2}
              margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
              <XAxis
                dataKey="strike"
                tick={{ fill: '#64748b', fontSize: 11 }}
                angle={-45}
                textAnchor="end"
                interval={0}
                tickFormatter={(v) => `${v}`}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => fmtL(v)}
                width={65}
              />
              <Tooltip content={<OITooltip />} cursor={{ fill: 'rgba(165,180,252,0.06)' }} />
              <Legend wrapperStyle={{ display: 'none' }} />
              {showBands && oiBands?.putBand ? (
                <ReferenceArea x1={oiBands.putBand.lowStrike} x2={oiBands.putBand.highStrike} strokeOpacity={0} fill="#06b6d4" fillOpacity={0.08} />
              ) : null}
              {showBands && oiBands?.callBand ? (
                <ReferenceArea x1={oiBands.callBand.lowStrike} x2={oiBands.callBand.highStrike} strokeOpacity={0} fill="#ef4444" fillOpacity={0.06} />
              ) : null}
              {showSR && oiSR?.support ? (
                <ReferenceLine x={oiSR.support} stroke="#06b6d4" strokeWidth={2} strokeDasharray="3 3"
                  label={{ value: `Support ${oiSR.support}`, position: 'bottom', fill: '#06b6d4', fontSize: 11, fontWeight: 700 }} />
              ) : null}
              {showSR && oiSR?.resistance ? (
                <ReferenceLine x={oiSR.resistance} stroke="#ef4444" strokeWidth={2} strokeDasharray="3 3"
                  label={{ value: `Resistance ${oiSR.resistance}`, position: 'bottom', fill: '#ef4444', fontSize: 11, fontWeight: 700 }} />
              ) : null}
              {atmStrike && (
                <ReferenceLine x={atmStrike} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3"
                  label={{ value: 'ATM', position: 'top', fill: '#f59e0b', fontSize: 11, fontWeight: 700 }} />
              )}
              <Bar dataKey="callOI" name="Call OI" fill="#10b981" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.isATM ? '#34d399' : '#10b981'} />
                ))}
              </Bar>
              <Bar dataKey="putOI" name="Put OI" fill="#ef4444" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.isATM ? '#f87171' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {/* Chart legend for bands and lines */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, background: '#06b6d4', opacity: 0.18, display: 'inline-block' }} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Put OI band</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, background: '#ef4444', opacity: 0.12, display: 'inline-block' }} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Call OI band</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 2, background: '#06b6d4', display: 'inline-block' }} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Support line</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 2, background: '#ef4444', display: 'inline-block' }} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Resistance line</span>
          </div>
        </div>
      </div>

      {/* ── Strike-wise PCR table ── */}
      {chartData.length > 0 && (
        <div className="table-card" style={{ marginTop: '1.8rem' }}>
          <div className="table-header">
            <span className="table-title" style={{ fontWeight: 700, fontSize: 15, color: '#a5b4fc' }}>
              Strike-wise OI Table
            </span>
          </div>
          <div className="angel-table-scroll">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right' }}>Call OI</th>
                  <th style={{ textAlign: 'right' }}>Call Chg</th>
                  <th style={{ textAlign: 'center' }}>Strike</th>
                  <th style={{ textAlign: 'left' }}>Put Chg</th>
                  <th style={{ textAlign: 'left' }}>Put OI</th>
                  <th style={{ textAlign: 'center' }}>PCR</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => {
                  const ceStr = chain.find((s) => s.strike === row.strike)
                  const ceD   = oiData[ceStr?.CE?.token]
                  const peD   = oiData[ceStr?.PE?.token]
                  const ceChg = ceD?.oi != null && ceD?.prevOi != null ? ceD.oi - ceD.prevOi : null
                  const peChg = peD?.oi != null && peD?.prevOi != null ? peD.oi - peD.prevOi : null
                  const sPCR  = row.callOI > 0 ? (row.putOI / row.callOI).toFixed(2) : '—'
                  return (
                    <tr key={row.strike} style={{
                      background: row.isATM ? 'rgba(245,158,11,0.07)' : 'transparent',
                      fontWeight: row.isATM ? 700 : 400,
                    }}>
                      <td style={{ textAlign: 'right', color: '#10b981' }}>{fmtL(row.callOI)}</td>
                      <td style={{ textAlign: 'right', color: ceChg > 0 ? '#10b981' : ceChg < 0 ? '#ef4444' : '#64748b', fontSize: 11 }}>
                        {ceChg != null ? (ceChg > 0 ? '▲' : '▼') + fmtL(Math.abs(ceChg)) : '—'}
                      </td>
                      <td style={{ textAlign: 'center', color: row.isATM ? '#f59e0b' : '#a5b4fc', fontWeight: 700 }}>
                        {row.isATM ? `⬛ ${row.strike}` : row.strike}
                      </td>
                      <td style={{ textAlign: 'left', color: peChg > 0 ? '#ef4444' : peChg < 0 ? '#10b981' : '#64748b', fontSize: 11 }}>
                        {peChg != null ? (peChg > 0 ? '▲' : '▼') + fmtL(Math.abs(peChg)) : '—'}
                      </td>
                      <td style={{ textAlign: 'left', color: '#ef4444' }}>{fmtL(row.putOI)}</td>
                      <td style={{ textAlign: 'center',
                        color: sPCR === '—' ? '#64748b' : parseFloat(sPCR) > PCR_NEUTRAL ? '#10b981' : parseFloat(sPCR) < PCR_NEUTRAL ? '#ef4444' : '#f59e0b',
                        fontWeight: 600 }}>
                        {sPCR}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Signal Trade panel removed per user request */}

      {/* Auto-Trade panel removed per user request */}
    </div>
  )
}
