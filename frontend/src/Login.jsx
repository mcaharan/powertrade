import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function attemptLogin(p) {
    if (p === '1109') {
      localStorage.setItem('pt_auth', '1')
      navigate('/admin', { replace: true })
      return true
    }
    setError('Incorrect PIN')
    setPin('')
    setTimeout(() => setError(''), 1400)
    return false
  }

  function submit(e) {
    if (e && e.preventDefault) e.preventDefault()
    attemptLogin(pin)
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">⚡</div>
        <div className="login-title">PowerTrade</div>
        <div className="login-sub">Enter your 4‑digit PIN to unlock</div>
        {/* hidden input captures keyboard digits while visual UI uses dots and keypad */}
        <HiddenInput setPin={setPin} pin={pin} attemptLogin={attemptLogin} />
        {error && <div className="login-error">{error}</div>}

        <div className="pin-dots" aria-hidden>
          {[0,1,2,3].map((i) => (
            <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
          ))}
        </div>

        <div className="keypad">
          {['1','2','3','4','5','6','7','8','9','0'].map((k) => (
            <button
              key={k}
              type="button"
              className="key"
              onClick={() => {
                if (pin.length >= 4) return
                const v = (pin + k).slice(0,4)
                setPin(v)
                if (v.length === 4) attemptLogin(v)
              }}
            >{k}</button>
          ))}
          <button type="button" className="key key-action" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
        </div>
      </form>
    </div>
  )
}

function HiddenInput({ setPin, pin, attemptLogin }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.focus()
  }, [])

  return (
    <input
      ref={ref}
      className="hidden-input"
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      value={pin}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9]/g, '')
        setPin(v)
        if (v.length === 4) attemptLogin(v)
      }}
      aria-hidden={false}
    />
  )
}
