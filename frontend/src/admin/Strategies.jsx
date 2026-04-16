import { useState, useCallback } from 'react'
import './admin.css'

// ── Shared config (imported by AutoTrade) ──────────────────────────────────────
export const SIGNAL_CONFIG_KEY = 'pt_oi_signal_config'

export const DEFAULT_SIGNAL_CONFIG = {
  // OI change thresholds (%)
  ceOiDecline:   1.0,
  peOiIncrease:  1.0,
  peOiDecline:   1.0,
  ceOiIncrease:  1.0,
  pcrBullishMin: 1.0,
  pcrBearishMax: 0.7,
  srWindow:      10,

  // Which conditions MUST be met for signal to fire
  ceBuyConds: { priceBreak: true, ceOiDecline: true, peOiIncrease: true, bullishPcr: true },
  peBuyConds: { priceBreak: true, peOiDecline: true, ceOiIncrease: true, bearishPcr: true  },

  // Strike to trade when signal fires
  strikeType: 'ITM1',  // 'ATM' | 'ITM1' | 'ITM2' | 'ITM3'
}

export function loadSignalConfig() {
  try {
    const raw = localStorage.getItem(SIGNAL_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_SIGNAL_CONFIG }
    const saved = JSON.parse(raw)
    return {
      ...DEFAULT_SIGNAL_CONFIG,
      ...saved,
      ceBuyConds: { ...DEFAULT_SIGNAL_CONFIG.ceBuyConds, ...saved.ceBuyConds },
      peBuyConds: { ...DEFAULT_SIGNAL_CONFIG.peBuyConds, ...saved.peBuyConds },
    }
  } catch {
    return { ...DEFAULT_SIGNAL_CONFIG }
  }
}

function save(cfg) {
  localStorage.setItem(SIGNAL_CONFIG_KEY, JSON.stringify(cfg))
}

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '10px 14px', borderRadius: 8, marginBottom: 6,
      background: checked ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${checked ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.07)'}`,
      cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#86efac' : '#94a3b8' }}>
          {label}
        </div>
        {hint && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{hint}</div>}
      </div>
      {/* pill toggle */}
      <div style={{
        width: 40, height: 22, borderRadius: 11, flexShrink: 0,
        background: checked ? '#22c55e' : 'rgba(255,255,255,0.12)',
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          left: checked ? 21 : 3,
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', margin: 0 }} />
      </div>
    </label>
  )
}

// ── Number field ───────────────────────────────────────────────────────────────
function NumField({ label, hint, value, onChange, min, max, step = 0.1, unit = '%' }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
      gap: 16, padding: '10px 14px', borderRadius: 8, marginBottom: 6,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{
            width: 78, padding: '5px 10px', borderRadius: 8, textAlign: 'right',
            background: 'rgba(15,20,40,0.7)', border: '1px solid rgba(165,180,252,0.25)',
            color: '#a5b4fc', fontSize: 14, fontWeight: 700, outline: 'none',
          }} />
        {unit && <span style={{ fontSize: 12, color: '#475569' }}>{unit}</span>}
      </div>
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHead({ color, dot, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}`, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Strategies() {
  const [cfg, setCfg] = useState(loadSignalConfig)
  const [saved, setSaved] = useState(false)

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1800) }

  const set = useCallback((key, val) => {
    setCfg(prev => { const n = { ...prev, [key]: val }; save(n); return n })
    flash()
  }, [])

  const setCeBuyCond = useCallback((key, val) => {
    setCfg(prev => {
      const n = { ...prev, ceBuyConds: { ...prev.ceBuyConds, [key]: val } }
      save(n); return n
    })
    flash()
  }, [])

  const setPeBuyCond = useCallback((key, val) => {
    setCfg(prev => {
      const n = { ...prev, peBuyConds: { ...prev.peBuyConds, [key]: val } }
      save(n); return n
    })
    flash()
  }, [])

  const reset = () => {
    const d = { ...DEFAULT_SIGNAL_CONFIG }
    setCfg(d); save(d); flash()
  }

  const ceBuyCount = Object.values(cfg.ceBuyConds).filter(Boolean).length
  const peBuyCount = Object.values(cfg.peBuyConds).filter(Boolean).length

  return (
    <div className="page-container" style={{ maxWidth: 700, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 12,
            background: 'linear-gradient(135deg, #a78bfa 60%, #38bdf8 100%)',
            color: '#fff', fontSize: 18,
          }}>⚙</span>
          Signal Configuration
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4, color: '#a5b4fc', fontWeight: 500 }}>
          Choose which conditions trigger CE / PE signals · changes apply instantly
        </p>
      </div>

      {/* ── CE BUY conditions ── */}
      <div className="glass-card" style={{ marginTop: '1.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionHead color="#22c55e" dot="#22c55e" title="CE BUY — Active Conditions" />
          <span style={{ fontSize: 12, color: '#475569' }}>{ceBuyCount} of 4 required</span>
        </div>

        <Toggle checked={cfg.ceBuyConds.priceBreak}   onChange={v => setCeBuyCond('priceBreak',   v)}
          label="Price above resistance"     hint="Current price must be above max CE OI strike" />
        <Toggle checked={cfg.ceBuyConds.ceOiDecline}  onChange={v => setCeBuyCond('ceOiDecline',  v)}
          label={`CE OI declining ≥ ${cfg.ceOiDecline}%`} hint="Call OI falling = short covering = bullish" />
        <Toggle checked={cfg.ceBuyConds.peOiIncrease} onChange={v => setCeBuyCond('peOiIncrease', v)}
          label={`PE OI increasing ≥ ${cfg.peOiIncrease}%`} hint="Put writers adding = bullish" />
        <Toggle checked={cfg.ceBuyConds.bullishPcr}   onChange={v => setCeBuyCond('bullishPcr',   v)}
          label={`PCR > ${cfg.pcrBullishMin} (bullish)`}    hint="High PCR = market bullish sentiment" />
      </div>

      {/* ── PE BUY conditions ── */}
      <div className="glass-card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionHead color="#ef4444" dot="#ef4444" title="PE BUY — Active Conditions" />
          <span style={{ fontSize: 12, color: '#475569' }}>{peBuyCount} of 4 required</span>
        </div>

        <Toggle checked={cfg.peBuyConds.priceBreak}   onChange={v => setPeBuyCond('priceBreak',   v)}
          label="Price below support"        hint="Current price must be below max PE OI strike" />
        <Toggle checked={cfg.peBuyConds.peOiDecline}  onChange={v => setPeBuyCond('peOiDecline',  v)}
          label={`PE OI declining ≥ ${cfg.peOiDecline}%`} hint="Put OI falling = put covering = bearish" />
        <Toggle checked={cfg.peBuyConds.ceOiIncrease} onChange={v => setPeBuyCond('ceOiIncrease', v)}
          label={`CE OI increasing ≥ ${cfg.ceOiIncrease}%`} hint="Call writers adding = bearish" />
        <Toggle checked={cfg.peBuyConds.bearishPcr}   onChange={v => setPeBuyCond('bearishPcr',   v)}
          label={`PCR < ${cfg.pcrBearishMax} (bearish)`}    hint="Low PCR = market bearish sentiment" />
      </div>

      {/* ── Strike selection ── */}
      <div className="glass-card" style={{ marginTop: 14 }}>
        <SectionHead color="#a5b4fc" dot="#a5b4fc" title="Strike to Trade on Signal" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { value: 'ATM',  label: 'ATM',   desc: 'At-the-money' },
            { value: 'ITM1', label: 'ITM 1', desc: '1 strike ITM' },
            { value: 'ITM2', label: 'ITM 2', desc: '2 strikes ITM' },
            { value: 'ITM3', label: 'ITM 3', desc: '3 strikes ITM' },
          ].map(({ value, label, desc }) => {
            const active = cfg.strikeType === value
            return (
              <button key={value} onClick={() => set('strikeType', value)} style={{
                padding: '12px 8px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                background: active ? 'rgba(165,180,252,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(165,180,252,0.5)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'all 0.2s',
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: active ? '#a5b4fc' : '#475569' }}>{label}</div>
                <div style={{ fontSize: 11, color: active ? '#7c3aed' : '#334155', marginTop: 3 }}>{desc}</div>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
          ITM CE = strike below current price · ITM PE = strike above current price
        </div>
      </div>

      {/* ── Thresholds ── */}
      <div className="glass-card" style={{ marginTop: 14 }}>
        <SectionHead color="#94a3b8" dot="#64748b" title="Thresholds" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <NumField label="CE OI decline"   value={cfg.ceOiDecline}   onChange={v => set('ceOiDecline',   v)} min={0.1} max={20} />
          <NumField label="PE OI increase"  value={cfg.peOiIncrease}  onChange={v => set('peOiIncrease',  v)} min={0.1} max={20} />
          <NumField label="PE OI decline"   value={cfg.peOiDecline}   onChange={v => set('peOiDecline',   v)} min={0.1} max={20} />
          <NumField label="CE OI increase"  value={cfg.ceOiIncrease}  onChange={v => set('ceOiIncrease',  v)} min={0.1} max={20} />
          <NumField label="PCR bullish min" value={cfg.pcrBullishMin} onChange={v => set('pcrBullishMin', v)} min={0.1} max={5} unit="" />
          <NumField label="PCR bearish max" value={cfg.pcrBearishMax} onChange={v => set('pcrBearishMax', v)} min={0.1} max={5} unit="" />
          <div style={{ gridColumn: '1/-1' }}>
            <NumField label="S/R window" hint="±N strikes around ATM"
              value={cfg.srWindow} onChange={v => set('srWindow', Math.max(3, Math.round(v)))}
              min={3} max={40} step={1} unit="strikes" />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
        <button className="angel-btn" onClick={reset}>Reset to defaults</button>
        {saved && <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  )
}
