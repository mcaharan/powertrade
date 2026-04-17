import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { loadSignalConfig } from './Strategies'
import './admin.css'

// ── Constants ──────────────────────────────────────────────────────────────────
const SNAPSHOT_MS     = 30_000
const WINDOW_MS       = 5 * 60_000
const HISTORY_MAX_MS  = 20 * 60_000
const AUTO_PAPER_KEY  = 'pt_auto_paper'
const POSITIONS_KEY   = 'pt_positions'
const TRADELOG_KEY    = 'pt_tradelog'
const MAX_LOG         = 8

const INDEX_CONFIG = {
  NIFTY:  { spotToken: '26000', spotExchangeType: 1, optionExchangeType: 2 },
  SENSEX: { spotToken: '1',     spotExchangeType: 3, optionExchangeType: 7 },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtL(n) {
  if (!n) return '0'
  if (n >= 1_00_00_000) return (n / 1_00_00_000).toFixed(2) + ' Cr'
  if (n >= 1_00_000)    return (n / 1_00_000).toFixed(2) + ' L'
  return Number(n).toLocaleString('en-IN')
}

function pct(v) {
  if (v == null || v === 0) return '0.00%'
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}

function windowLabel(refTs) {
  if (!refTs) return ''
  const s = Math.round((Date.now() - refTs) / 1000)
  return s >= 60 ? `vs ${Math.round(s / 60)}m ago` : `vs ${s}s ago`
}

function calcITMStrike(chain, priceNow, side, depth) {
  if (!priceNow || !chain.length) return null
  if (depth === 0) return null
  if (side === 'CE') {
    const cands = chain.filter(s => s.strike < priceNow && s.CE).sort((a, b) => b.strike - a.strike)
    return cands[depth - 1]?.strike ?? null
  } else {
    const cands = chain.filter(s => s.strike > priceNow && s.PE).sort((a, b) => a.strike - b.strike)
    return cands[depth - 1]?.strike ?? null
  }
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Condition row ──────────────────────────────────────────────────────────────
function CondRow({ ok, label, value, enabled = true }) {
  if (!enabled) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '9px 14px', borderRadius: 8, marginBottom: 6,
        background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)',
        opacity: 0.32,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ flexShrink: 0, width: 9, height: 9, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: 13, color: '#475569', textDecoration: 'line-through' }}>{label}</span>
        </div>
        <span style={{ fontSize: 11, color: '#334155', padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)' }}>off</span>
      </div>
    )
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, padding: '9px 14px', borderRadius: 8, marginBottom: 6,
      background:  ok ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.03)',
      border:      `1px solid ${ok ? 'rgba(34,197,94,0.60)' : 'rgba(255,255,255,0.07)'}`,
      boxShadow:   ok ? '0 0 16px rgba(34,197,94,0.25)' : 'none',
      transition:  'background 0.25s, border-color 0.25s, box-shadow 0.25s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{
          flexShrink: 0, width: 9, height: 9, borderRadius: '50%',
          background: ok ? '#22c55e' : 'rgba(255,255,255,0.15)',
          boxShadow:  ok ? '0 0 6px #22c55e' : 'none',
        }} />
        <span style={{ fontSize: 13, fontWeight: ok ? 600 : 400, color: ok ? '#86efac' : '#94a3b8' }}>
          {label}
        </span>
      </div>
      {value != null && (
        <span style={{
          fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: ok ? '#4ade80' : '#64748b',
          background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
          padding: '2px 8px', borderRadius: 6, minWidth: 70, textAlign: 'right',
        }}>
          {value}
        </span>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AutoTrade() {
  const [accountId, setAccountId]       = useState(null)
  const [executionSegment, setExecutionSegment] = useState('NIFTY')
  const [expiry, setExpiry]             = useState('')
  const [chain, setChain]               = useState([])
  const [futToken, setFutToken]         = useState(null)
  const [status, setStatus]             = useState('idle')
  const [streaming, setStreaming]       = useState(false)
  const [loadingChain, setLoadingChain] = useState(false)
  const [tradeSetup, setTradeSetup]     = useState(null)
  const [, forceRender]                 = useState(0)

  // Signals are always computed from NIFTY OI.
  const underlying = 'NIFTY'
  const { spotToken, spotExchangeType, optionExchangeType } = INDEX_CONFIG[underlying]

  // Paper trade state
  const [tradeLots, setTradeLots]             = useState(1)
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [tradeResult, setTradeResult]         = useState(null)
  const [tradeLog, setTradeLog]               = useState(() => {
    try { return JSON.parse(localStorage.getItem(TRADELOG_KEY) || '[]') } catch { return [] }
  })
  const [positions, setPositions]             = useState(() => {
    try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) || '[]') } catch { return [] }
  })   // open paper positions
  const [autoPaper, setAutoPaper]             = useState(() => {
    try { return localStorage.getItem(AUTO_PAPER_KEY) === '1' } catch { return false }
  })

  const oiRef         = useRef({})
  const oiHistoryRef  = useRef([])
  const chainRef      = useRef([])
  const futRef        = useRef(null)
  const esRef         = useRef(null)
  const autoStarted   = useRef(false)
  const prevSignalRef = useRef('NO TRADE')
  const autoPaperRef  = useRef(autoPaper)
  const submittingRef = useRef(false)
  const tradeFnRef    = useRef(null)

  useEffect(() => { chainRef.current = chain },    [chain])
  useEffect(() => { futRef.current   = futToken }, [futToken])
  useEffect(() => {
    autoPaperRef.current = autoPaper
    try { localStorage.setItem(AUTO_PAPER_KEY, autoPaper ? '1' : '0') } catch {}
  }, [autoPaper])

  useEffect(() => {
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)) } catch {}
  }, [positions])

  useEffect(() => {
    try { localStorage.setItem(TRADELOG_KEY, JSON.stringify(tradeLog)) } catch {}
  }, [tradeLog])

  // ── 500ms tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now  = Date.now()
      const hist = oiHistoryRef.current
      const last = hist.length ? hist[hist.length - 1].ts : 0

      if (now - last >= SNAPSHOT_MS) {
        let ce = 0, pe = 0
        chainRef.current.forEach(s => {
          ce += oiRef.current[s.CE?.token]?.oi || 0
          pe += oiRef.current[s.PE?.token]?.oi || 0
        })
        if (ce > 0) {
          hist.push({ ts: now, ce, pe })
          while (hist.length > 1 && now - hist[0].ts > HISTORY_MAX_MS) hist.shift()
        }
      }

      // Auto-paper: fire when signal transitions NO TRADE → BUY
      if (autoPaperRef.current && !submittingRef.current) {
        const curr = tradeFnRef.current?.signal ?? 'NO TRADE'
        const prev = prevSignalRef.current
        if (prev === 'NO TRADE' && curr !== 'NO TRADE') {
          tradeFnRef.current?.fire()
        }
        prevSignalRef.current = curr
      }

      forceRender(n => n + 1)
    }, 500)
    return () => clearInterval(id)
  }, [])

  // ── Account ───────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/angelone/accounts')
      .then(({ data }) => {
        const conn = data.filter(a => a.connected)
        if (conn.length) setAccountId(conn[0].id)
      }).catch(() => {})
  }, [])

  // ── Trade setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accountId) return
    axios.get(`/api/trade-setups/account/${accountId}`)
      .then(({ data }) => {
        // Setup follows execution segment choice, but signal remains NIFTY-based.
        const match = data.find(s =>
          s.segment_name?.toUpperCase().includes(executionSegment.toUpperCase())
        ) || data[0] || null
        setTradeSetup(match)
      })
      .catch(() => {})
  }, [accountId, executionSegment])

  // ── Sync tradeLots from setup default_qty ─────────────────────────────────
  useEffect(() => {
    if (tradeSetup?.default_qty > 0) setTradeLots(Number(tradeSetup.default_qty))
  }, [tradeSetup])

  // ── Reset on OI base index change ─────────────────────────────────────────
  useEffect(() => {
    esRef.current?.close(); esRef.current = null
    autoStarted.current  = false
    oiRef.current        = {}
    oiHistoryRef.current = []
    setStreaming(false); setStatus('idle')
    setChain([]); setFutToken(null); setExpiry('')
  }, [underlying])

  // ── Expiry ────────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`/api/oi/expiries?name=${underlying}`)
      .then(({ data }) => setExpiry(data?.[0] || ''))
      .catch(() => {})
  }, [underlying])

  // ── Option chain ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!expiry) return
    setChain([]); setFutToken(null)
    oiRef.current        = {}
    oiHistoryRef.current = []
    autoStarted.current  = false
    setLoadingChain(true)
    axios.get(`/api/oi/option-chain?name=${underlying}&expiry=${expiry}`)
      .then(({ data }) => {
        setChain(data.strikes || [])
        setFutToken(data.future?.token || null)
      })
      .catch(() => {})
      .finally(() => setLoadingChain(false))
  }, [expiry, underlying])

  // ── Reset on account change ─────────────────────────────────────────────
  useEffect(() => {
    autoStarted.current  = false
    oiRef.current        = {}
    oiHistoryRef.current = []
    setStreaming(false); setStatus('idle')
  }, [accountId])

  // ── Stream ────────────────────────────────────────────────────────────────
  const startStream = useCallback(async () => {
    if (!accountId) return false
    const c = chainRef.current
    if (!c.length) return false

    const tokens = []
    c.forEach(s => {
      if (s.CE) tokens.push(s.CE.token)
      if (s.PE) tokens.push(s.PE.token)
    })
    if (futRef.current) tokens.push(futRef.current)
    if (!tokens.length) return false

    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStatus('connecting')

    try {
      await axios.post('/api/oi/subscribe', { accountId, tokens, exchangeType: optionExchangeType })
    } catch { setStatus('error'); return false }

    try {
      await axios.post('/api/oi/subscribe', { accountId, tokens: [spotToken], exchangeType: spotExchangeType })
    } catch {}

    const es = new EventSource(`/api/oi/stream?accountId=${accountId}`)
    esRef.current = es

    es.addEventListener('connected', () => setStatus('live'))
    es.addEventListener('snapshot',  (e) => {
      try { oiRef.current = JSON.parse(e.data); forceRender(n => n + 1) } catch {}
    })
    es.addEventListener('tick', (e) => {
      try {
        const t = JSON.parse(e.data)
        oiRef.current = { ...oiRef.current, [t.token]: t }
      } catch {}
    })
    es.addEventListener('autherror',    () => { setStatus('error'); setStreaming(false) })
    es.addEventListener('wserror',      () => { setStatus('error'); setStreaming(false) })
    es.addEventListener('disconnected', () => { setStatus('idle');  setStreaming(false) })
    es.onerror = () => setStatus(p => p === 'live' ? 'connecting' : p)

    setStreaming(true)
    return true
  }, [accountId, spotToken, spotExchangeType, optionExchangeType])

  const stopStream = () => {
    esRef.current?.close(); esRef.current = null
    autoStarted.current  = false
    oiHistoryRef.current = []
    setStreaming(false); setStatus('idle')
  }

  useEffect(() => {
    if (autoStarted.current || !accountId || !chain.length || streaming) return
    autoStarted.current = true
    startStream().then(ok => { if (!ok) autoStarted.current = false })
  }, [accountId, chain, streaming, startStream])

  useEffect(() => () => esRef.current?.close(), [])

  // ── Square off a position ─────────────────────────────────────────────────
  const squareOff = useCallback((posId) => {
    setPositions(prev => prev.map(p => {
      if (p.id !== posId || p.status !== 'open') return p
      const exitPrice = oiRef.current[p.token]?.ltp || p.buyPrice
      return { ...p, status: 'closed', exitPrice, exitTime: Date.now() }
    }))
  }, [])

  const squareOffAll = useCallback(() => {
    setPositions(prev => prev.map(p => {
      if (p.status !== 'open') return p
      const exitPrice = oiRef.current[p.token]?.ltp || p.buyPrice
      return { ...p, status: 'closed', exitPrice, exitTime: Date.now() }
    }))
  }, [])

  // ── Paper trade ───────────────────────────────────────────────────────────
  const placePaperTrade = useCallback(async (sig, option, strikeUsed, currentAtmStrike) => {
    if (!accountId || !option || submittingRef.current) return
    submittingRef.current = true
    setTradeSubmitting(true)
    try {
      const { data } = await axios.post('/api/orders/signal-trade', {
        accountId,
        setupId:     tradeSetup?.id || null,
        signal:      sig,
        symbol:      option.symbol,
        token:       option.token,
        exchange:    'NFO',
        side:        'BUY',
        lots:        tradeLots,
        productType: 'INTRADAY',
        orderType:   'MARKET',
        tradeMode:   'PAPER',
        price:       oiRef.current[option.token]?.ltp || 0,
        atmStrike:   currentAtmStrike,
        underlying,
        expiry,
      })
      const buyPrice = oiRef.current[option.token]?.ltp || 0
      const lotSize  = tradeSetup?.lot_size  || 1
      const qty      = lotSize * tradeLots
      const posId    = Date.now()
      const entry = {
        ts: posId, sig, symbol: option.symbol, strike: strikeUsed,
        lots: tradeLots, qty, buyPrice, orderId: data.paper_order_id || data.order_id, ok: true,
      }
      // Add to open positions
      setPositions(prev => [...prev, {
        id: posId, sig, symbol: option.symbol, token: option.token,
        strike: strikeUsed, side: sig === 'CE BUY' ? 'CE' : 'PE',
        lots: tradeLots, qty, buyPrice, entryTime: posId, status: 'open',
        exitPrice: null, exitTime: null,
        slPoints: tradeSetup?.stop_loss_points ? Number(tradeSetup.stop_loss_points) : null,
        tgtPoints: tradeSetup?.target_points ? Number(tradeSetup.target_points) : null,
      }])
      setTradeLog(prev => [entry, ...prev].slice(0, MAX_LOG))
      setTradeResult({ ok: true, msg: `Paper order placed · ${option.symbol} · ${tradeLots} lot${tradeLots !== 1 ? 's' : ''} @ ₹${buyPrice.toFixed(2)}`, ts: Date.now() })
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Order failed'
      const buyPrice = oiRef.current[option.token]?.ltp || 0
      const lotSize  = tradeSetup?.lot_size  || 1
      const qty      = lotSize * tradeLots
      const entry = { ts: Date.now(), sig, symbol: option.symbol, strike: strikeUsed, lots: tradeLots, qty, buyPrice, ok: false, msg }
      setTradeLog(prev => [entry, ...prev].slice(0, MAX_LOG))
      setTradeResult({ ok: false, msg, ts: Date.now() })
    } finally {
      submittingRef.current = false
      setTradeSubmitting(false)
      setTimeout(() => setTradeResult(null), 5000)
    }
  }, [accountId, tradeSetup, tradeLots, expiry])

  // ── Live computation ──────────────────────────────────────────────────────
  const cfg = loadSignalConfig()
  const oi  = oiRef.current

  const spotLTP  = oi[spotToken]?.ltp || null
  const futLTP   = futToken ? oi[futToken]?.ltp || null : null
  const priceNow = spotLTP || futLTP || null

  let atmStrike = null
  if (priceNow && chain.length) {
    atmStrike = chain.reduce((b, s) =>
      Math.abs(s.strike - priceNow) < Math.abs(b.strike - priceNow) ? s : b,
      chain[0],
    ).strike
  }

  let totalCE = 0, totalPE = 0
  chain.forEach(s => {
    totalCE += oi[s.CE?.token]?.oi || 0
    totalPE += oi[s.PE?.token]?.oi || 0
  })

  const nowTs    = Date.now()
  const history  = oiHistoryRef.current
  const refEntry = history.find(e => nowTs - e.ts >= WINDOW_MS) || history[0] || null
  const callChgPct = refEntry?.ce > 0 ? (totalCE - refEntry.ce) / refEntry.ce : 0
  const putChgPct  = refEntry?.pe > 0 ? (totalPE - refEntry.pe) / refEntry.pe : 0
  const winLabel   = refEntry ? windowLabel(refEntry.ts) : 'building…'

  const atmIdx = atmStrike ? chain.findIndex(s => s.strike === atmStrike) : -1
  const srRows = atmIdx !== -1
    ? chain.slice(Math.max(0, atmIdx - cfg.srWindow), atmIdx + cfg.srWindow + 1)
    : chain

  let maxCE = -1, maxPE = -1, resistance = null, support = null
  srRows.forEach(s => {
    const ceOI = oi[s.CE?.token]?.oi || 0
    const peOI = oi[s.PE?.token]?.oi || 0
    if (ceOI > maxCE) { maxCE = ceOI; resistance = s.strike }
    if (peOI > maxPE) { maxPE = peOI; support    = s.strike }
  })

  const pcr = totalCE > 0 ? totalPE / totalCE : 0

  const ceDecThresh = cfg.ceOiDecline  / 100
  const peIncThresh = cfg.peOiIncrease / 100
  const peDecThresh = cfg.peOiDecline  / 100
  const ceIncThresh = cfg.ceOiIncrease / 100

  const priceAboveRes = Boolean(resistance && priceNow != null && priceNow > resistance)
  const priceBelowSup = Boolean(support    && priceNow != null && priceNow < support)
  const ceOiDown      = refEntry != null && callChgPct <= -ceDecThresh
  const peOiUp        = refEntry != null && putChgPct  >=  peIncThresh
  const peOiDown      = refEntry != null && putChgPct  <= -peDecThresh
  const ceOiUp        = refEntry != null && callChgPct >=  ceIncThresh
  const bullishPcr    = pcr > cfg.pcrBullishMin
  const bearishPcr    = pcr > 0 && pcr < cfg.pcrBearishMax

  const ceBuyChecks = [
    !cfg.ceBuyConds.priceBreak   || priceAboveRes,
    !cfg.ceBuyConds.ceOiDecline  || ceOiDown,
    !cfg.ceBuyConds.peOiIncrease || peOiUp,
    !cfg.ceBuyConds.bullishPcr   || bullishPcr,
  ]
  const peBuyChecks = [
    !cfg.peBuyConds.priceBreak   || priceBelowSup,
    !cfg.peBuyConds.peOiDecline  || peOiDown,
    !cfg.peBuyConds.ceOiIncrease || ceOiUp,
    !cfg.peBuyConds.bearishPcr   || bearishPcr,
  ]
  const ceBuyReady = Object.values(cfg.ceBuyConds).some(Boolean) && ceBuyChecks.every(Boolean)
  const peBuyReady = Object.values(cfg.peBuyConds).some(Boolean) && peBuyChecks.every(Boolean)
  const signal     = ceBuyReady ? 'CE BUY' : peBuyReady ? 'PE BUY' : 'NO TRADE'

  const itmDepth      = cfg.strikeType === 'ATM' ? 0 : parseInt(cfg.strikeType.replace('ITM', '')) || 1
  const ceTradeStrike = itmDepth === 0 ? atmStrike : (calcITMStrike(chain, priceNow, 'CE', itmDepth) ?? atmStrike)
  const peTradeStrike = itmDepth === 0 ? atmStrike : (calcITMStrike(chain, priceNow, 'PE', itmDepth) ?? atmStrike)

  const tradeStrike = signal === 'CE BUY' ? ceTradeStrike : signal === 'PE BUY' ? peTradeStrike : null
  const tradeOption = tradeStrike != null
    ? chain.find(s => s.strike === tradeStrike)?.[signal === 'CE BUY' ? 'CE' : 'PE'] || null
    : null

  tradeFnRef.current = {
    signal,
    fire: () => {
      if (tradeOption) placePaperTrade(signal, tradeOption, tradeStrike, atmStrike)
    },
  }

  const lotSize    = tradeSetup?.lot_size    ? Number(tradeSetup.lot_size)    : null
  const slPoints   = tradeSetup?.stop_loss_points ? Number(tradeSetup.stop_loss_points) : null
  const tgtPoints  = tradeSetup?.target_points    ? Number(tradeSetup.target_points)    : null
  const totalQty   = lotSize ? lotSize * tradeLots : null

  const signalColor = signal === 'CE BUY' ? '#22c55e' : signal === 'PE BUY' ? '#ef4444' : '#475569'
  const pcrColor    = pcr === 0 ? '#475569' : pcr > cfg.pcrBullishMin ? '#22c55e' : pcr < cfg.pcrBearishMax ? '#ef4444' : '#f59e0b'
  const pcrLabel    = pcr === 0 ? '—' : pcr > cfg.pcrBullishMin ? 'Bullish' : pcr < cfg.pcrBearishMax ? 'Bearish' : 'Neutral'

  const ST_COLOR = { idle: '#9ca3af', connecting: '#f59e0b', live: '#22c55e', error: '#ef4444' }
  const ST_LABEL = { idle: 'Idle', connecting: 'Connecting…', live: '● Live', error: 'Error' }
  const priceStr = priceNow ? `₹${priceNow.toLocaleString('en-IN')}` : '—'

  const ceArrow = callChgPct > 0.001 ? '↑' : callChgPct < -0.001 ? '↓' : '→'
  const peArrow = putChgPct  > 0.001 ? '↑' : putChgPct  < -0.001 ? '↓' : '→'
  const ceColor = callChgPct < -0.001 ? '#ef4444' : callChgPct > 0.001 ? '#22c55e' : '#64748b'
  const peColor = putChgPct  > 0.001  ? '#22c55e' : putChgPct  < -0.001 ? '#ef4444' : '#64748b'

  const ceBuyEnabledCount = Object.values(cfg.ceBuyConds).filter(Boolean).length
  const peBuyEnabledCount = Object.values(cfg.peBuyConds).filter(Boolean).length

  return (
    <div className="page-container" style={{ maxWidth: 880, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #22c55e 60%, #38bdf8 100%)',
            color: '#fff', fontSize: 20,
          }}>⚡</span>
          Auto Trade Signal
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
          PCR + OI + Price Action — NIFTY Current Week
        </p>
      </div>

      {/* Status bar */}
      <div className="glass-card" style={{ marginTop: '1.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontSize: 13, fontWeight: 700 }}>{underlying}</span>
          {expiry && <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(165,180,252,0.1)', color: '#a5b4fc', fontSize: 13, fontWeight: 600 }}>{expiry}</span>}
          <span style={{ padding: '5px 16px', borderRadius: 20, background: `${ST_COLOR[status]}22`, color: ST_COLOR[status], fontSize: 13, fontWeight: 700 }}>
            {ST_LABEL[status]}
          </span>
          {refEntry && <span style={{ fontSize: 12, color: '#475569' }}>OI {winLabel}</span>}
          {tradeSetup && (
            <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>
              Setup: {tradeSetup.segment_name}
              {lotSize ? ` · Lot ${lotSize}` : ''}
              {tradeSetup.default_qty ? ` × ${tradeSetup.default_qty} lots` : ''}
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="angel-btn" onClick={() => { autoStarted.current = false; startStream() }}
              disabled={!accountId || loadingChain || !chain.length}>Start</button>
            <button className="angel-btn" onClick={stopStream} disabled={!streaming}>Stop</button>
          </div>
        </div>
      </div>
      {/* ── Current Positions ──────────────────────────────────────────────── */}
      {positions.length > 0 && (() => {
        const openPositions   = positions.filter(p => p.status === 'open')
        const closedPositions = positions.filter(p => p.status === 'closed')
        const totalOpenPnL    = openPositions.reduce((sum, p) => {
          const ltp = oi[p.token]?.ltp || p.buyPrice
          return sum + (ltp - p.buyPrice) * p.qty
        }, 0)
        const totalClosedPnL  = closedPositions.reduce((sum, p) =>
          sum + ((p.exitPrice || p.buyPrice) - p.buyPrice) * p.qty, 0)
        const totalPnL        = totalOpenPnL + totalClosedPnL
        const pnlPos          = totalPnL >= 0

        return (
          <div className="glass-card" style={{
            marginTop: '1.4rem',
            border: openPositions.length > 0
              ? `1px solid rgba(56,189,248,0.3)`
              : '1px solid rgba(255,255,255,0.07)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>📊 Current Positions</span>
                {openPositions.length > 0 && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontWeight: 700 }}>
                    {openPositions.length} Open
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Total P&L summary */}
                <span style={{ fontSize: 13, fontWeight: 700, color: pnlPos ? '#4ade80' : '#f87171' }}>
                  Total P&amp;L: {pnlPos ? '+' : ''}₹{totalPnL.toFixed(2)}
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#475569', marginLeft: 6 }}>
                    (Open {totalOpenPnL >= 0 ? '+' : ''}₹{totalOpenPnL.toFixed(2)} · Closed {totalClosedPnL >= 0 ? '+' : ''}₹{totalClosedPnL.toFixed(2)})
                  </span>
                </span>
                {openPositions.length > 0 && (
                  <button onClick={squareOffAll} style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 7,
                    border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)',
                    color: '#f87171', cursor: 'pointer', fontWeight: 600,
                  }}>Square Off All</button>
                )}
                <button onClick={() => setPositions([])} style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                  color: '#475569', cursor: 'pointer',
                }}>Clear</button>
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Symbol', 'Side', 'Strike', 'Entry Time', 'Buy Price', 'LTP', 'Chg', 'Lots', 'Qty', 'SL', 'Target', 'Unreal P&L', 'Status', ''].map((h, i) => (
                      <th key={i} style={{
                        padding: '5px 10px', fontWeight: 600, fontSize: 11, color: '#475569',
                        textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap',
                        textAlign: i >= 4 ? 'right' : 'left',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...positions].reverse().map((p, i) => {
                    const ltp       = p.status === 'open'
                      ? (oi[p.token]?.ltp || p.buyPrice)
                      : (p.exitPrice || p.buyPrice)
                    const chg       = ltp - p.buyPrice
                    const chgPct    = p.buyPrice > 0 ? (chg / p.buyPrice) * 100 : 0
                    const pnl       = chg * p.qty
                    const isPos     = pnl >= 0
                    const isOpen    = p.status === 'open'
                    const durSecs   = Math.floor(((isOpen ? Date.now() : p.exitTime) - p.entryTime) / 1000)
                    const durLabel  = durSecs < 60
                      ? `${durSecs}s`
                      : durSecs < 3600
                      ? `${Math.floor(durSecs / 60)}m ${durSecs % 60}s`
                      : `${Math.floor(durSecs / 3600)}h ${Math.floor((durSecs % 3600) / 60)}m`

                    return (
                      <tr key={p.id} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isOpen
                          ? (i % 2 === 0 ? 'rgba(56,189,248,0.04)' : 'rgba(56,189,248,0.02)')
                          : 'rgba(255,255,255,0.01)',
                        opacity: isOpen ? 1 : 0.55,
                      }}>
                        <td style={{ padding: '9px 10px', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{p.symbol}</td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11,
                            background: p.side === 'CE' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
                            color: p.side === 'CE' ? '#4ade80' : '#f87171',
                          }}>{p.side}</span>
                        </td>
                        <td style={{ padding: '9px 10px', color: '#94a3b8' }}>{p.strike}</td>
                        <td style={{ padding: '9px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {fmtTime(p.entryTime)}
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#334155' }}>({durLabel})</span>
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                          ₹{p.buyPrice.toFixed(2)}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: isOpen ? '#e2e8f0' : '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                          ₹{ltp.toFixed(2)}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600, color: isPos ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {isPos ? '+' : ''}{chg.toFixed(2)} ({isPos ? '+' : ''}{chgPct.toFixed(1)}%)
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{p.lots}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{p.qty}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                          {p.slPoints ? p.slPoints : '—'}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
                          {p.tgtPoints ? p.tgtPoints : '—'}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                          color: isPos ? '#4ade80' : '#f87171' }}>
                          {isPos ? '+' : ''}₹{pnl.toFixed(2)}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          {isOpen
                            ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontWeight: 700 }}>OPEN</span>
                            : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: '#475569' }}>CLOSED</span>
                          }
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                          {isOpen && (
                            <button onClick={() => squareOff(p.id)} style={{
                              fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 600,
                              border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.09)',
                              color: '#f87171', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}>Sq Off</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
      {loadingChain && <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280', fontSize: 14 }}>Loading option chain…</div>}

      {!loadingChain && chain.length > 0 && (
        <>
          {/* Signal banner */}
          <div style={{
            marginTop: '1.8rem', borderRadius: 20, padding: '2rem', textAlign: 'center',
            background: `linear-gradient(135deg, ${signalColor}18 0%, rgba(255,255,255,0.02) 100%)`,
            border: `2px solid ${signalColor}55`,
          }}>
            <div style={{ fontSize: 12, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Signal</div>
            <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: 3, color: signalColor, textShadow: `0 0 50px ${signalColor}88`, lineHeight: 1 }}>
              {signal}
            </div>

            {signal !== 'NO TRADE' ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: signalColor, marginBottom: 10 }}>
                  {signal === 'CE BUY'
                    ? `Buy ${cfg.strikeType} CE · Strike ${ceTradeStrike ?? '—'}`
                    : `Buy ${cfg.strikeType} PE · Strike ${peTradeStrike ?? '—'}`}
                </div>
                {totalQty && (
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                    Lot size {lotSize} × {tradeLots} lot{tradeLots !== 1 ? 's' : ''} = <strong style={{ color: '#e2e8f0' }}>{totalQty} qty</strong>
                    {tradeSetup?.segment_name && <span style={{ marginLeft: 8, color: '#475569' }}>({tradeSetup.segment_name})</span>}
                  </div>
                )}

                {/* Lots + Paper Trade button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => setTradeLots(l => Math.max(1, l - 1))} style={{
                      width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 16, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>−</button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', minWidth: 60, textAlign: 'center' }}>
                      {tradeLots} lot{tradeLots !== 1 ? 's' : ''}
                    </span>
                    <button onClick={() => setTradeLots(l => l + 1)} style={{
                      width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 16, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>+</button>
                  </div>

                  <button
                    onClick={() => tradeOption && placePaperTrade(signal, tradeOption, tradeStrike, atmStrike)}
                    disabled={tradeSubmitting || !tradeOption}
                    style={{
                      padding: '9px 26px', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer',
                      background: tradeSubmitting ? 'rgba(255,255,255,0.05)' : `linear-gradient(135deg, ${signalColor}88, ${signalColor}44)`,
                      border: `1px solid ${signalColor}66`,
                      color: tradeSubmitting ? '#475569' : signalColor,
                      transition: 'all 0.2s',
                    }}>
                    {tradeSubmitting ? 'Placing…' : '📝 Paper Trade'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
                Waiting for enabled conditions to be met…
              </div>
            )}
          </div>

          {/* Manual Paper Trade removed per request */}

          {/* Auto-paper toggle + execution segment selector */}
          <div className="glass-card" style={{ marginTop: 10, padding: '12px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: autoPaper ? '#86efac' : '#94a3b8' }}>Auto Paper Trade</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  Signal uses NIFTY OI only. Execution segment follows your selection.
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', gap: 6, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {['NIFTY', 'SENSEX'].map(idx => (
                    <button key={idx} onClick={() => setExecutionSegment(idx)} style={{
                      padding: '6px 12px', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
                      background: executionSegment === idx ? 'rgba(99,102,241,0.18)' : 'transparent',
                      color: executionSegment === idx ? '#a5b4fc' : '#94a3b8',
                    }}>{idx}</button>
                  ))}
                </div>

                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <div style={{
                    width: 44, height: 24, borderRadius: 12, transition: 'background 0.2s',
                    background: autoPaper ? '#22c55e' : 'rgba(255,255,255,0.12)', position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', top: 4, width: 16, height: 16, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s', left: autoPaper ? 24 : 4,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    }} />
                    <input type="checkbox" checked={autoPaper} onChange={e => setAutoPaper(e.target.checked)}
                      style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', margin: 0 }} />
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Trade result flash */}
          {tradeResult && (
            <div style={{
              marginTop: 10, padding: '10px 16px', borderRadius: 10,
              background: tradeResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${tradeResult.ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: tradeResult.ok ? '#4ade80' : '#f87171' }}>
                {tradeResult.ok ? '✓' : '✗'} {tradeResult.msg}
              </span>
              <button onClick={() => setTradeResult(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 }}>
            <div className="glass-card" style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>PCR</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: pcrColor }}>{pcr > 0 ? pcr.toFixed(2) : '—'}</div>
              <div style={{ fontSize: 12, color: pcrColor, marginTop: 4 }}>{pcrLabel}</div>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>Price</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>{priceStr}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>ATM {atmStrike ?? '—'}</div>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>CE OI</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981' }}>{fmtL(totalCE)}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: ceColor, marginTop: 4 }}>{ceArrow} {pct(callChgPct)}</div>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>PE OI</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{fmtL(totalPE)}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: peColor, marginTop: 4 }}>{peArrow} {pct(putChgPct)}</div>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div className="glass-card" style={{
              border: ceBuyReady ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.07)',
              boxShadow: ceBuyReady ? '0 0 24px rgba(34,197,94,0.12)' : 'none',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>CE BUY</span>
                {ceBuyReady
                  ? <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.2)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.5)' }}>READY</span>
                  : <span style={{ fontSize: 11, color: '#334155' }}>{winLabel}</span>}
              </div>
              <CondRow enabled={cfg.ceBuyConds.priceBreak}   ok={priceAboveRes} label="Price above resistance"        value={`${priceStr} / ${resistance ?? '—'}`} />
              <CondRow enabled={cfg.ceBuyConds.ceOiDecline}  ok={ceOiDown}      label={`CE OI ↓ ≥ ${cfg.ceOiDecline}%`}  value={pct(callChgPct)} />
              <CondRow enabled={cfg.ceBuyConds.peOiIncrease} ok={peOiUp}        label={`PE OI ↑ ≥ ${cfg.peOiIncrease}%`} value={pct(putChgPct)} />
              <CondRow enabled={cfg.ceBuyConds.bullishPcr}   ok={bullishPcr}    label={`PCR > ${cfg.pcrBullishMin}`}      value={pcr > 0 ? pcr.toFixed(2) : '—'} />
              <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                {ceBuyEnabledCount} condition{ceBuyEnabledCount !== 1 ? 's' : ''} active · {cfg.strikeType} CE on signal
              </div>
            </div>

            <div className="glass-card" style={{
              border: peBuyReady ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.07)',
              boxShadow: peBuyReady ? '0 0 24px rgba(239,68,68,0.12)' : 'none',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>PE BUY</span>
                {peBuyReady
                  ? <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.5)' }}>READY</span>
                  : <span style={{ fontSize: 11, color: '#334155' }}>{winLabel}</span>}
              </div>
              <CondRow enabled={cfg.peBuyConds.priceBreak}   ok={priceBelowSup} label="Price below support"          value={`${priceStr} / ${support ?? '—'}`} />
              <CondRow enabled={cfg.peBuyConds.peOiDecline}  ok={peOiDown}      label={`PE OI ↓ ≥ ${cfg.peOiDecline}%`}  value={pct(putChgPct)} />
              <CondRow enabled={cfg.peBuyConds.ceOiIncrease} ok={ceOiUp}        label={`CE OI ↑ ≥ ${cfg.ceOiIncrease}%`} value={pct(callChgPct)} />
              <CondRow enabled={cfg.peBuyConds.bearishPcr}   ok={bearishPcr}    label={`PCR < ${cfg.pcrBearishMax}`}      value={pcr > 0 ? pcr.toFixed(2) : '—'} />
              <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                {peBuyEnabledCount} condition{peBuyEnabledCount !== 1 ? 's' : ''} active · {cfg.strikeType} PE on signal
              </div>
            </div>
          </div>

          {/* OI info strip */}
          <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ color: pcrColor, fontWeight: 700 }}>PCR {pcr > 0 ? pcr.toFixed(2) : '—'} — {pcrLabel}</span>
            <span style={{ color: '#475569' }}>S {support ?? '—'} · R {resistance ?? '—'}</span>
            <span style={{ color: '#475569' }}>{history.length ? `${history.length} OI snapshots · ${winLabel}` : 'Building OI history…'}</span>
          </div>

          {/* Trade log */}
          {tradeLog.length > 0 && (
            <div className="glass-card" style={{ marginTop: 14, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>📋 Paper Trade Log</span>
                <button onClick={() => setTradeLog([])} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 12 }}>Clear</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      {['', 'Time', 'Side', 'Symbol', 'Strike', 'Buy Price', 'Lots', 'Qty', 'Note'].map((h, i) => (
                        <th key={i} style={{
                          padding: '5px 10px', textAlign: i >= 5 ? 'right' : 'left',
                          fontWeight: 600, fontSize: 11, color: '#475569',
                          textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tradeLog.map((entry, i) => (
                      <tr key={i} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                      }}>
                        <td style={{ padding: '8px 10px', width: 14 }}>
                          <span style={{ color: entry.ok ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                            {entry.ok ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {fmtTime(entry.ts)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11,
                            background: entry.sig === 'CE BUY' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
                            color: entry.sig === 'CE BUY' ? '#4ade80' : '#f87171',
                          }}>{entry.sig}</span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {entry.symbol}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                          {entry.strike ?? '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {entry.buyPrice ? `₹${entry.buyPrice.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>
                          {entry.lots}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>
                          {entry.qty ?? '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: entry.ok ? '#475569' : '#f87171', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.ok
                            ? (entry.orderId ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.orderId}</span> : '')
                            : entry.msg}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loadingChain && chain.length === 0 && expiry && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#475569', fontSize: 14 }}>
          Waiting for option chain data…
        </div>
      )}
    </div>
  )
}
