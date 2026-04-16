import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { loadSignalConfig } from './Strategies'
import './admin.css'

// ── Constants ──────────────────────────────────────────────────────────────────
const UNDERLYING      = 'NIFTY'
const SPOT_TOKEN      = '26000'
const SNAPSHOT_MS     = 30_000          // record OI snapshot every 30 s
const WINDOW_MS       = 5 * 60_000     // compare vs ~5 minutes ago
const HISTORY_MAX_MS  = 20 * 60_000    // keep 20 min of history

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

// depth=0 → ATM, depth=1 → ITM1, etc.
function calcITMStrike(chain, priceNow, side, depth) {
  if (!priceNow || !chain.length) return null
  if (depth === 0) return null // caller uses atmStrike
  if (side === 'CE') {
    // ITM CE = strike below current price; sort desc, pick depth-th
    const cands = chain.filter(s => s.strike < priceNow && s.CE).sort((a, b) => b.strike - a.strike)
    return cands[depth - 1]?.strike ?? null
  } else {
    // ITM PE = strike above current price; sort asc, pick depth-th
    const cands = chain.filter(s => s.strike > priceNow && s.PE).sort((a, b) => a.strike - b.strike)
    return cands[depth - 1]?.strike ?? null
  }
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
  const [expiry, setExpiry]             = useState('')
  const [chain, setChain]               = useState([])
  const [futToken, setFutToken]         = useState(null)
  const [status, setStatus]             = useState('idle')
  const [streaming, setStreaming]       = useState(false)
  const [loadingChain, setLoadingChain] = useState(false)
  const [tradeSetup, setTradeSetup]     = useState(null)
  const [, forceRender]                 = useState(0)

  const oiRef        = useRef({})   // token → { ltp, oi }
  const oiHistoryRef = useRef([])   // [{ ts, ce, pe }, ...] rolling window
  const chainRef     = useRef([])
  const futRef       = useRef(null)
  const esRef        = useRef(null)
  const autoStarted  = useRef(false)

  useEffect(() => { chainRef.current = chain },    [chain])
  useEffect(() => { futRef.current   = futToken }, [futToken])

  // ── 500ms tick: re-render + record OI snapshot every 30 s ────────────────
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

  // ── Trade setup (NIFTY) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!accountId) return
    axios.get(`/api/trade-setups/account/${accountId}`)
      .then(({ data }) => {
        const setup = data.find(s =>
          s.segment_name?.toUpperCase().includes('NIFTY') ||
          s.instrument_type?.toUpperCase().includes('NIFTY')
        ) || data[0] || null
        setTradeSetup(setup)
      })
      .catch(() => {})
  }, [accountId])

  // ── Expiry ────────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`/api/oi/expiries?name=${UNDERLYING}`)
      .then(({ data }) => setExpiry(data?.[0] || ''))
      .catch(() => {})
  }, [])

  // ── Option chain ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!expiry) return
    setChain([]); setFutToken(null)
    oiRef.current        = {}
    oiHistoryRef.current = []
    autoStarted.current  = false
    setLoadingChain(true)
    axios.get(`/api/oi/option-chain?name=${UNDERLYING}&expiry=${expiry}`)
      .then(({ data }) => {
        setChain(data.strikes || [])
        setFutToken(data.future?.token || null)
      })
      .catch(() => {})
      .finally(() => setLoadingChain(false))
  }, [expiry])

  // ── Reset on account change ───────────────────────────────────────────────
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
      await axios.post('/api/oi/subscribe', { accountId, tokens, exchangeType: 2 })
    } catch { setStatus('error'); return false }

    try {
      await axios.post('/api/oi/subscribe', { accountId, tokens: [SPOT_TOKEN], exchangeType: 1 })
    } catch {}

    const es = new EventSource(`/api/oi/stream?accountId=${accountId}`)
    esRef.current = es

    es.addEventListener('connected', () => setStatus('live'))
    es.addEventListener('snapshot',  (e) => {
      try {
        oiRef.current = JSON.parse(e.data)
        forceRender(n => n + 1)
      } catch {}
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
  }, [accountId])

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

  // ── Live computation ──────────────────────────────────────────────────────
  const cfg = loadSignalConfig()
  const oi  = oiRef.current

  const spotLTP  = oi[SPOT_TOKEN]?.ltp || null
  const futLTP   = futToken ? oi[futToken]?.ltp || null : null
  const priceNow = spotLTP || futLTP || null

  // ATM
  let atmStrike = null
  if (priceNow && chain.length) {
    atmStrike = chain.reduce((b, s) =>
      Math.abs(s.strike - priceNow) < Math.abs(b.strike - priceNow) ? s : b,
      chain[0],
    ).strike
  }

  // Totals
  let totalCE = 0, totalPE = 0
  chain.forEach(s => {
    totalCE += oi[s.CE?.token]?.oi || 0
    totalPE += oi[s.PE?.token]?.oi || 0
  })

  // Rolling-window OI change
  const now     = Date.now()
  const history = oiHistoryRef.current
  const refEntry = history.find(e => now - e.ts >= WINDOW_MS) || history[0] || null
  const callChgPct = refEntry?.ce > 0 ? (totalCE - refEntry.ce) / refEntry.ce : 0
  const putChgPct  = refEntry?.pe > 0 ? (totalPE - refEntry.pe) / refEntry.pe : 0
  const winLabel   = refEntry ? windowLabel(refEntry.ts) : 'building…'

  // S/R: max CE OI strike in ±srWindow = resistance wall; max PE OI = support wall
  // priceAboveRes fires when price crosses ABOVE the CE wall; priceBelowSup when below PE wall
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

  // Condition values
  const ceDecThresh   = cfg.ceOiDecline  / 100
  const peIncThresh   = cfg.peOiIncrease / 100
  const peDecThresh   = cfg.peOiDecline  / 100
  const ceIncThresh   = cfg.ceOiIncrease / 100

  const priceAboveRes = Boolean(resistance && priceNow != null && priceNow > resistance)
  const priceBelowSup = Boolean(support    && priceNow != null && priceNow < support)
  const ceOiDown      = refEntry != null && callChgPct <= -ceDecThresh
  const peOiUp        = refEntry != null && putChgPct  >=  peIncThresh
  const peOiDown      = refEntry != null && putChgPct  <= -peDecThresh
  const ceOiUp        = refEntry != null && callChgPct >=  ceIncThresh
  const bullishPcr    = pcr > cfg.pcrBullishMin
  const bearishPcr    = pcr > 0 && pcr < cfg.pcrBearishMax

  // Respect per-condition toggles from Strategies page
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

  // ITM strike based on strikeType config
  const itmDepth      = cfg.strikeType === 'ATM' ? 0 : parseInt(cfg.strikeType.replace('ITM', '')) || 1
  const ceTradeStrike = itmDepth === 0 ? atmStrike : (calcITMStrike(chain, priceNow, 'CE', itmDepth) ?? atmStrike)
  const peTradeStrike = itmDepth === 0 ? atmStrike : (calcITMStrike(chain, priceNow, 'PE', itmDepth) ?? atmStrike)

  // Trade setup info
  const lotSize    = tradeSetup?.lot_size    || null
  const defaultQty = tradeSetup?.default_qty || null
  const totalQty   = lotSize && defaultQty ? lotSize * defaultQty : null

  // Colours
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

  // Active condition counts
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
          <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontSize: 13, fontWeight: 700 }}>NIFTY</span>
          {expiry && <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(165,180,252,0.1)', color: '#a5b4fc', fontSize: 13, fontWeight: 600 }}>{expiry}</span>}
          <span style={{ padding: '5px 16px', borderRadius: 20, background: `${ST_COLOR[status]}22`, color: ST_COLOR[status], fontSize: 13, fontWeight: 700 }}>
            {ST_LABEL[status]}
          </span>
          {refEntry && (
            <span style={{ fontSize: 12, color: '#475569' }}>OI {winLabel}</span>
          )}
          {tradeSetup && (
            <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>
              Setup: {tradeSetup.segment_name}
              {lotSize ? ` · Lot ${lotSize}` : ''}
              {defaultQty ? ` × ${defaultQty}` : ''}
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="angel-btn" onClick={() => { autoStarted.current = false; startStream() }}
              disabled={!accountId || loadingChain || !chain.length}>Start</button>
            <button className="angel-btn" onClick={stopStream} disabled={!streaming}>Stop</button>
          </div>
        </div>
      </div>

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
                <div style={{ fontSize: 16, fontWeight: 700, color: signalColor, marginBottom: 6 }}>
                  {signal === 'CE BUY'
                    ? `Buy ${cfg.strikeType} CE · Strike ${ceTradeStrike ?? '—'}`
                    : `Buy ${cfg.strikeType} PE · Strike ${peTradeStrike ?? '—'}`}
                </div>
                {totalQty && (
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    Lot size {lotSize} × {defaultQty} lot{defaultQty !== 1 ? 's' : ''} = <strong style={{ color: '#e2e8f0' }}>{totalQty} qty</strong>
                    {tradeSetup?.segment_name && <span style={{ marginLeft: 8, color: '#475569' }}>({tradeSetup.segment_name})</span>}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
                Waiting for enabled conditions to be met…
              </div>
            )}
          </div>

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

            {/* CE BUY */}
            <div className="glass-card" style={{
              border: ceBuyReady ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.07)',
              boxShadow: ceBuyReady ? '0 0 24px rgba(34,197,94,0.12)' : 'none',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>CE BUY</span>
                {ceBuyReady
                  ? <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.2)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.5)' }}>READY</span>
                  : <span style={{ fontSize: 11, color: '#334155' }}>{winLabel}</span>
                }
              </div>
              <CondRow enabled={cfg.ceBuyConds.priceBreak}   ok={priceAboveRes} label="Price above resistance"        value={`${priceStr} / ${resistance ?? '—'}`} />
              <CondRow enabled={cfg.ceBuyConds.ceOiDecline}  ok={ceOiDown}      label={`CE OI ↓ ≥ ${cfg.ceOiDecline}%`}  value={pct(callChgPct)} />
              <CondRow enabled={cfg.ceBuyConds.peOiIncrease} ok={peOiUp}        label={`PE OI ↑ ≥ ${cfg.peOiIncrease}%`} value={pct(putChgPct)} />
              <CondRow enabled={cfg.ceBuyConds.bullishPcr}   ok={bullishPcr}    label={`PCR > ${cfg.pcrBullishMin}`}      value={pcr > 0 ? pcr.toFixed(2) : '—'} />
              <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                {ceBuyEnabledCount} condition{ceBuyEnabledCount !== 1 ? 's' : ''} active · {cfg.strikeType} CE on signal
              </div>
            </div>

            {/* PE BUY */}
            <div className="glass-card" style={{
              border: peBuyReady ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.07)',
              boxShadow: peBuyReady ? '0 0 24px rgba(239,68,68,0.12)' : 'none',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>PE BUY</span>
                {peBuyReady
                  ? <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.5)' }}>READY</span>
                  : <span style={{ fontSize: 11, color: '#334155' }}>{winLabel}</span>
                }
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

          {/* OI window info strip */}
          <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ color: pcrColor, fontWeight: 700 }}>PCR {pcr > 0 ? pcr.toFixed(2) : '—'} — {pcrLabel}</span>
            <span style={{ color: '#475569' }}>S {support ?? '—'} · R {resistance ?? '—'}</span>
            <span style={{ color: '#475569' }}>{history.length ? `${history.length} OI snapshots · ${winLabel}` : 'Building OI history…'}</span>
          </div>
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
