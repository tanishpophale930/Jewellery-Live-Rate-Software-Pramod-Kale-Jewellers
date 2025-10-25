import React, { useEffect, useRef, useState } from 'react'
import "tailwindcss";

/**
 * GoldLiveRatesComponent
 *
 * Props:
 *  - logoSrc?: string
 *  - shopName?: string         // fallback text if shopImageSrc not provided
 *  - shopImageSrc?: string     // new: image URL to show instead of shopName text
 *  - defaultRefreshSeconds?: number
 */
export default function GoldLiveRatesComponent({
  logoSrc,
  shopName = "Sagar Jewellers",
  shopImageSrc = null,
  shopSalutation = null,
  defaultRefreshSeconds = 60
}) {
  const ENDPOINT =
    "https://bcast.sagarjewellers.co.in:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/sagar?_=1761132425086"

  // ------------------ LocalStorage keys ------------------
  const LS_MAKING_KEY = 'gold_makingVal'
  const LS_REFRESH_VAL_KEY = 'gold_refreshVal'
  const LS_REFRESH_UNIT_KEY = 'gold_refreshUnit'
  // ------------------------------------------------------

  // state for fetched rate
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [silverRate, setSilverRate] = useState(null);
  const [spotGoldRate, setSpotGoldRate] = useState(null);

  // --- NEW: dollar state ---
  const [dollarRate, setDollarRate] = useState(null)
  const dollarControllerRef = useRef(null)
  const dollarIntervalRef = useRef(null)
  const DOLLAR_POLL_MS = 10000 // 10 seconds polling (change if you want faster/slower)

  // ---------- NEW: live/connection indicator state & refs ----------
  // connectionStatus: 'connecting' | 'live' | 'stable' | 'offline'
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const previousRateRef = useRef(null)
  const liveTimeoutRef = useRef(null)
  const stalenessIntervalRef = useRef(null)
  const LIVE_DISPLAY_MS = 3000 // how long to show "Live" after a change
  // ------------------------------------------------------------------

  // NEW: show/hide making input when clicking the logo
  const [showMaking, setShowMaking] = useState(false)

  // helper: return first numeric match (string) inside token, or null
  function extractNumericFromToken(token) {
    const m = token.match(/-?\d+(?:\.\d+)?/)
    return m ? m[0] : null
  }

  // helper: find the first numeric token after matching productRegex in the line
  function firstNumericAfterLabel(line, productRegex) {
    const m = line.match(productRegex)
    if (!m) return null

    // text after the matched product label
    const after = line.slice(m.index + m[0].length)

    // prefer splitting by tabs (most structured responses use tabs)
    const tabCols = after.split(/\t+/).map(c => c.trim()).filter(Boolean)
    if (tabCols.length) {
      // look through columns left-to-right, skipping a single '-' column
      for (let i = 0; i < tabCols.length; i++) {
        const col = tabCols[i]
        if (col === '-' || /^[-—]+$/.test(col)) continue
        const num = extractNumericFromToken(col)
        if (num) return num
        // sometimes the numeric sits inside subsequent columns — continue scanning
      }
    }

    // fallback: split by whitespace groups (handles cases without tabs)
    const wsCols = after.split(/\s{2,}|\s+\t*/).map(c => c.trim()).filter(Boolean)
    for (const col of wsCols) {
      if (col === '-' || /^[-—]+$/.test(col)) continue
      const num = extractNumericFromToken(col)
      if (num) return num
    }

    // final fallback: first numeric anywhere after the match
    const fallback = after.match(/\d+(?:\.\d+)?/)
    return fallback ? fallback[0] : null
  }

  // refresh controls
  const [refreshVal, setRefreshVal] = useState('') // user input numeric
  const [refreshUnit, setRefreshUnit] = useState('seconds') // 'seconds' | 'minutes'
  const [refreshMs, setRefreshMs] = useState(() => (defaultRefreshSeconds ?? 15) * 1000)

  // NEW: Making input state (user-supplied making charge; default 5250 when empty/invalid)
  const [makingVal, setMakingVal] = useState('') // text input; used instead of 5250 when valid

  // countdown (seconds remaining until next refresh)
  const [remaining, setRemaining] = useState(Math.ceil(refreshMs / 1000))

  const timeoutRef = useRef(null)
  const countdownRef = useRef(null)
  const controllerRef = useRef(null)

  // helper: clear scheduled timeout + countdown
  function clearSchedules() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }

  function startCountdown(ms) {
    setRemaining(Math.ceil(ms / 1000))
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          countdownRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }


  // schedule next fetch using timeout so that refresh interval can change dynamically
  function scheduleNextFetch(ms) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      // call fetchRate with the current controller signal
      fetchRate(controllerRef.current?.signal)
    }, ms)
    startCountdown(ms)
  }

  // main fetch function (signal optional). Accepts optional nextMs to control scheduling immediately
  async function fetchRate(signal, nextMs = null) {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(ENDPOINT, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const text = await res.text()
      const lines = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)

      // ----- GOLD (existing robust parsing preserved) -----
      const goldLine = lines.find(l =>
        /GOLD NAGPUR 99\.5 RTGS \(Rate 50 gm\)/i.test(l)
      )
      if (!goldLine) throw new Error('Target product line not found in response')

      // preserved robust logic for gold
      let extracted = null
      const cols = goldLine.split(/\t+/).map(c => c.trim()).filter(Boolean)
      const dashColIndex = cols.findIndex(c => /^[-—]$/.test(c))

      if (dashColIndex !== -1 && cols.length > dashColIndex + 1) {
        const afterCols = cols.slice(dashColIndex + 1)
        const afterText = afterCols.join(' ')
        const m = afterText.match(/\d+(?:\.\d+)?/)
        if (m) extracted = m[0]
      }

      if (!extracted) {
        const dashPos = goldLine.indexOf('-')
        if (dashPos !== -1) {
          const after = goldLine.slice(dashPos + 1)
          const m = after.match(/\d+(?:\.\d+)?/)
          if (m) extracted = m[0]
        }
      }

      if (!extracted) {
        const allNums = goldLine.match(/\d+(?:\.\d+)?/g) || []
        if (allNums.length) {
          extracted = allNums.reduce((a, b) =>
            parseFloat(b) > parseFloat(a) ? b : a
          , allNums[0])
        }
      }

      if (!extracted) throw new Error('Could not parse numeric rate from GOLD line')

      const numericGold = Number(extracted)
      setRate(Number.isFinite(numericGold) ? numericGold : null)
      setLastUpdate(new Date())

      // ---------- NEW: update connection status based on change ----------
      // if previous exists and differs -> show 'live' briefly
      const prev = previousRateRef.current
      if (Number.isFinite(numericGold) && (prev === null || !Number.isFinite(prev))) {
        // first valid value: mark stable
        setConnectionStatus('stable')
      } else if (Number.isFinite(numericGold) && Number.isFinite(prev) && Number(numericGold) !== Number(prev)) {
        // value changed -> Live
        setConnectionStatus('live')
        if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current)
        liveTimeoutRef.current = setTimeout(() => {
          setConnectionStatus('stable')
          liveTimeoutRef.current = null
        }, LIVE_DISPLAY_MS)
      } else {
        // value didn't change -> stable (connected)
        setConnectionStatus('stable')
      }
      previousRateRef.current = numericGold
      // ------------------------------------------------------------------

      // ----- SILVER (first numeric immediately after product label) -----
      const silverLine = lines.find(l => /SILVER NAGPUR RTGS/i.test(l))
      if (silverLine) {
        const val = firstNumericAfterLabel(silverLine, /SILVER NAGPUR RTGS/i)
        const num = val ? Number(val) : null
        setSilverRate(Number.isFinite(num) ? num : null)
      } else {
        setSilverRate(null)
      }

      // ----- SPOT GOLD (first numeric immediately after product label) -----
      const spotLine = lines.find(l => /SPOT\s*GOLD/i.test(l))
      if (spotLine) {
        const val = firstNumericAfterLabel(spotLine, /SPOT\s*GOLD/i)
        const num = val ? Number(val) : null
        setSpotGoldRate(Number.isFinite(num) ? num : null)
      } else {
        setSpotGoldRate(null)
      }

      setLoading(false)

      // schedule next run using provided nextMs or current refreshMs
      const msToUse = nextMs ?? refreshMs
      scheduleNextFetch(msToUse)
    } catch (err) {
      if (err?.name === 'AbortError') return
      setError(err?.message ?? String(err))
      setLoading(false)
      // mark offline on error
      setConnectionStatus('offline')
      // still schedule retry so UI recovers; use current refreshMs
      scheduleNextFetch(refreshMs)
    }
  }

  // --- NEW: fetch dollar from a free API (USD -> INR) ---
  async function fetchDollar(signal) {
    try {
      // primary free endpoint
      const tryEndpoint = async (url) => {
        const r = await fetch(url, { signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }

      // try primary
      let j = null
      try {
        j = await tryEndpoint('https://api.exchangerate.host/latest?base=USD&symbols=INR')
        const val = j && j.rates && j.rates.INR ? Number(j.rates.INR) : null
        if (Number.isFinite(val)) {
          setDollarRate(val)
          return
        }
        // else fallthrough to fallback
      } catch (e) {
        // try fallback below
      }

      // fallback free endpoint
      try {
        const j2 = await tryEndpoint('https://open.er-api.com/v6/latest/USD')
        const val2 = j2 && j2.rates && j2.rates.INR ? Number(j2.rates.INR) : null
        setDollarRate(Number.isFinite(val2) ? val2 : null)
      } catch (e) {
        // on complete failure keep null (UI will show dash)
        setDollarRate(null)
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
      setDollarRate(null)
    }
  }


  // build derived table values from base (24K)
  function buildTable(base) {
    if (!base || !Number.isFinite(base)) return null
    const b = Number(base)
    const row24 = b
    // use makingNumber (computed below) for 22K calculation
    const row22 = (row24 + makingNumber) / 1.1
    const row20 = row24 / 1.1
    const row18 = (0.95 * row24) / 1.1
    const row16 = (0.85 * row24) / 1.1

    const rows = [
      { carat: '24K', rate: row24 },
      { carat: '22K', rate: row22 },
      { carat: '20K', rate: row20 },
      { carat: '18K', rate: row18 },
      { carat: '16K', rate: row16 }
    ]

    return rows.map(r => ({ ...r, ratePer10: r.rate / 10 }))
  }

  // NEW: compute makingNumber from makingVal (fallback 5250)
  const makingNumber = (function () {
    const n = Number(makingVal)
    if (Number.isFinite(n) && n >= 0) return n
    return 5250
  })()

  // derived rates for quick display (moved after makingNumber)
  const rate22K10gm = rate ? (rate + makingNumber) / 1.1 : null
  const rate20K10gm = rate ? rate / 1.1 : null
  const rate18K10gm = rate ? (0.95 * rate) / 1.1 : null
  const rate16K10gm = rate ? (0.85 * rate) / 1.1 : null
  const goldcoin = Number.isFinite(rate) ? (rate/10) + 100 : null;


  // format integer with commas (round to nearest integer)
  function fmtInt(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return '—'
    const n = Math.round(Number(val))
    return n.toLocaleString('en-IN')
  }


  function fmtDecimal(val, decimals = 2) {
    if (val === null || val === undefined || Number.isNaN(val)) return '—'
    const n = Number(val)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })
  }

  const tableRows = buildTable(rate)

  // handle apply button: compute ms from user input and restart cycle
  function applyRefresh() {
    let v = Number(refreshVal)
    if (!Number.isFinite(v) || v <= 0) {
      // reset to default
      v = defaultRefreshSeconds ?? 60
      setRefreshVal('')
      setRefreshUnit('seconds')
      // remove stored value because user applied default
      localStorage.removeItem(LS_REFRESH_VAL_KEY)
      localStorage.removeItem(LS_REFRESH_UNIT_KEY)
    } else {
      // persist the applied refresh inputs
      localStorage.setItem(LS_REFRESH_VAL_KEY, String(refreshVal))
      localStorage.setItem(LS_REFRESH_UNIT_KEY, refreshUnit)
    }

    const ms = refreshUnit === 'minutes' ? v * 60_000 : v * 1000
    setRefreshMs(ms)

    // abort any active fetch and restart immediately with new interval
    if (controllerRef.current) controllerRef.current.abort()
    controllerRef.current = new AbortController()

    clearSchedules()
    // call fetchRate and pass ms explicitly so scheduling uses the applied value immediately
    fetchRate(controllerRef.current.signal, ms)
  }

  // mount: read persisted inputs and start first fetch and ensure cleanup on unmount
  // mount: read persisted inputs and start first fetch and ensure cleanup on unmount
  useEffect(() => {
    // read persisted making + refresh values BEFORE starting fetch so initial scheduling uses them
    try {
      const storedMaking = localStorage.getItem(LS_MAKING_KEY)
      if (storedMaking !== null) {
        // parse and validate the stored value — avoid storing invalid zeros etc.
        const parsed = Number(storedMaking)
        if (Number.isFinite(parsed) && parsed >= 0) {
          // normalize to string of the numeric value (no extra whitespace)
          setMakingVal(String(parsed))
        } else {
          localStorage.removeItem(LS_MAKING_KEY)
          setMakingVal('')
        }
      }

      const sv = localStorage.getItem(LS_REFRESH_VAL_KEY)
      const su = localStorage.getItem(LS_REFRESH_UNIT_KEY)
      let initialMs = (defaultRefreshSeconds ?? 60) * 1000
      if (sv !== null) {
        const parsed = Number(sv)
        const unit = su || 'seconds'
        if (Number.isFinite(parsed) && parsed > 0) {
          setRefreshVal(String(sv))
          setRefreshUnit(unit)
          initialMs = unit === 'minutes' ? parsed * 60_000 : parsed * 1000
          setRefreshMs(initialMs)
        }
      }

      controllerRef.current = new AbortController()
      // pass initialMs to ensure fetchRate uses the persisted interval when scheduling
      fetchRate(controllerRef.current.signal, initialMs)

      // start dollar polling (immediate + interval)
      dollarControllerRef.current = new AbortController()
      fetchDollar(dollarControllerRef.current.signal)
      if (dollarIntervalRef.current) clearInterval(dollarIntervalRef.current)
      dollarIntervalRef.current = setInterval(() => {
        if (dollarControllerRef.current) dollarControllerRef.current.abort()
        dollarControllerRef.current = new AbortController()
        fetchDollar(dollarControllerRef.current.signal)
      }, DOLLAR_POLL_MS)

      return () => {
        if (controllerRef.current) controllerRef.current.abort()
        clearSchedules()

        if (dollarControllerRef.current) dollarControllerRef.current.abort()
        if (dollarIntervalRef.current) {
          clearInterval(dollarIntervalRef.current)
          dollarIntervalRef.current = null
        }

        if (liveTimeoutRef.current) {
          clearTimeout(liveTimeoutRef.current)
          liveTimeoutRef.current = null
        }
        if (stalenessIntervalRef.current) {
          clearInterval(stalenessIntervalRef.current)
          stalenessIntervalRef.current = null
        }
      }
    } catch (e) {
      // if anything goes wrong while reading storage, still proceed with defaults
      controllerRef.current = new AbortController()
      fetchRate(controllerRef.current.signal)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // if refreshMs changes externally (e.g., via prop change), restart schedules
  useEffect(() => {
    // when refreshMs changes while we have lastUpdate, reschedule from now
    if (!lastUpdate) return
    clearSchedules()
    // abort ongoing fetch to ensure fresh start
    if (controllerRef.current) controllerRef.current.abort()
    controllerRef.current = new AbortController()
    fetchRate(controllerRef.current.signal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs])

  // ---------- NEW: staleness checker ----------
  // marks offline if last update becomes older than threshold (2*refresh or 30s)
  useEffect(() => {
    if (stalenessIntervalRef.current) {
      clearInterval(stalenessIntervalRef.current)
      stalenessIntervalRef.current = null
    }

    stalenessIntervalRef.current = setInterval(() => {
      if (!lastUpdate) return
      const age = Date.now() - lastUpdate.getTime()
      const threshold = Math.max(refreshMs * 2, 30000)
      if (age > threshold) {
        setConnectionStatus('offline')
      } else {
        // if it was offline but now updated recently, set back to stable
        setConnectionStatus(prev => (prev === 'offline' ? 'stable' : prev))
      }
    }, 2000)

    return () => {
      if (stalenessIntervalRef.current) {
        clearInterval(stalenessIntervalRef.current)
        stalenessIntervalRef.current = null
      }
    }
  }, [lastUpdate, refreshMs])
  // ------------------------------------------------


  // persist makingVal to localStorage whenever user types a valid number (or clear it when invalid)
  // persist makingVal to localStorage whenever user types a valid number (or clear it when invalid)
  useEffect(() => {
    try {
      const trimmed = (makingVal ?? '').toString().trim()
      if (trimmed === '') {
        // empty input -> remove stored value (component will fall back to 5250)
        localStorage.removeItem(LS_MAKING_KEY)
        return
      }

      const n = Number(trimmed)
      if (Number.isFinite(n) && n >= 0) {
        // normalize stored value to canonical numeric string (prevents '0123' or ' 123 ' issues)
        localStorage.setItem(LS_MAKING_KEY, String(n))
        // if user typed '00123' or with spaces, normalize UI as well so stored value and input match
        if (String(n) !== makingVal) {
          setMakingVal(String(n))
        }
      } else {
        // invalid number -> remove stored value
        localStorage.removeItem(LS_MAKING_KEY)
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [makingVal])


  // ---------- Small presentational subcomponents ----------
  // NOTE: changed sizing: keep original on small screens, increase on md+ to match wider right width
  const RightCard = ({ children }) => (
    <div className="w-full max-w-xl md:max-w-lg bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 rounded-2xl p-3 shadow-lg ring-1 ring-amber-900/30">
      <div className="bg-white/95 rounded-xl p-4 flex flex-col items-center justify-center min-h-[113px]">
        {children}
      </div>
    </div>
  )

    const RightSingleStack = ({ title = '', bigValue = null, loading = false }) => (
    <div className="w-full flex items-center justify-center">
      <RightCard>
        <div className="w-full flex flex-col items-center">
          <div className="text-xl text-gray-800 font-bold">{title}</div>
          <div className="mt-2 text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm">
            {loading ? '—' : fmtInt(bigValue)}
          </div>
        </div>
      </RightCard>
    </div>
  )

  // Right Dual Stack exactly as 24K and all
  const RightDualStack = ({ topTitle = '', topValue = null, bottomTitle = '', bottomValue = null, loading = false }) => (
    <div className="md:col-span-1 flex items-center justify-center">
      <div className="w-full max-w-xs space-y-3">
        <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-300 rounded-2xl p-3 shadow ring-1 ring-amber-900/30">
          <div className="bg-white/95 rounded-lg p-3 flex flex-col items-center justify-center">
            <div className="text-xs text-gray-800 font-semibold">{topTitle}</div>
            <div className="mt-2 text-3xl md:text-4xl font-extrabold text-rose-900">
              {loading ? '—' : fmtInt(topValue)}
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-2xl p-3 shadow ring-1 ring-amber-900/20">
          <div className="bg-white/95 rounded-lg p-3 flex flex-col items-center justify-center">
            <div className="text-xs text-gray-800 font-semibold">{bottomTitle}</div>
            <div className="mt-2 text-2xl md:text-3xl font-bold text-rose-800">
              {loading ? '—' : fmtInt(bottomValue)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // NEW: vertical right-side Silver stack — using RightCard for identical sizing
  const RightVerticalSilver = ({ loading = false, rate1kg = null }) => {
    const tenGm = rate1kg ? (rate1kg / 100) * 1.03 : null
    const oneGm = rate1kg ? (rate1kg / 1000) * 1.03 : null

    return (
      <RightCard>
        <div className="w-full flex flex-col items-center">
          <div className="text-2xl text-gray-800 font-bold">Silver</div>

          <div className="mt-3 w-full space-y-6">
            
            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 ring-1 ring-amber-900/10">
              <div className="text-lg text-gray-800 font-bold">1 gm <span className='text-sm font-medium'>(+GST 3%)</span></div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {loading ? '—' : fmtInt(oneGm)}
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 ring-1 ring-amber-900/20">
              <div className="text-lg text-gray-800 font-bold">10 gm <span className='text-sm font-medium'>(+GST 3%)</span></div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {loading ? '—' : fmtInt(tenGm)}
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 shadow-inner ring-1 ring-amber-900/20">
              <div className="text-lg text-gray-800 font-bold">1 KG</div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {loading ? '—' : fmtInt(silverRate)}
              </div>
            </div>
          </div>
        </div>
      </RightCard>
    )
  }


  /** Single half unit used inside the split card (matches the inner layout of RightSingleStack) */
  const RightHalf = ({ title = '', bigValue = null, loading = false }) => {
    // accept real boolean or string, and also treat non-finite bigValue as loading
    const isLoading = loading === true || loading === 'true' || !Number.isFinite(bigValue)

    return (
      <div className="w-full flex flex-col items-center justify-center">
        <div className="text-xl text-gray-800 font-bold">{title}</div>
        <div className="mt-2 text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm">
          {isLoading ? '—' : fmtInt(bigValue)}
        </div>
      </div>
    )
  }



  //   **
  //  * New: RightDoubleStack in Gold Coin Single Stack
  //  * left and right are objects: { title, bigValue, loading }
  //  * showDivider: optional boolean to show/hide vertical divider
  //  *
  //  * Outer wrapper uses the exact same classes as RightSingleStack/RightCard,
  //  * inner white container keeps the same min-h so overall height is identical.
  //  */
    const RightDoubleStack = ({ left = {}, right = {}, showDivider = true }) => {
      return (
        <div className="w-full max-w-xl md:max-w-lg bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
          <div className="bg-white/95 rounded-xl p-3 flex flex-row items-stretch min-h-[114px]">
            <div className="flex-1 flex items-center justify-center">
              <RightHalf {...left} />
            </div>

            {showDivider && <div className="w-px bg-gray-200 mx-5 my-2" />}

            <div className="flex-1 flex items-center justify-center">
              <RightHalf {...right} />
            </div>
          </div>
        </div>
      );
    };

  // ---------- UI ----------
  // small helper to render status dot + label without changing spacing too much
  function StatusIndicator({ status }) {
    // status: 'connecting' | 'live' | 'stable' | 'offline'
    let dotClasses = "w-3 h-3 rounded-full inline-block mr-2 shrink-0"
    let label = ''
    
    
    if (status === 'live') {
      dotClasses += " bg-emerald-400 animate-pulse"
      label = "Live"
    } else if (status === 'stable') {
      dotClasses += " bg-amber-400"
      label = "Stable"
    } else if (status === 'offline') {
      dotClasses += " bg-red-500"
      label = "Offline"
    } else {
      dotClasses += " bg-gray-400"
      label = "Connecting"
    }

    return (
      <div className="flex items-center text-xs text-amber-100/90">
        <span className={dotClasses} aria-hidden="true" />
        <span className="font-medium text-sm md:text-lg">{label}</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-500 text-amber-100 p-1 flex items-start justify-center">
      <div className="w-full max-w-5xl">
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }}>
          <div
            className="px-6 py-3 flex items-center justify-between flex-wrap"
            style={{
              background: 'linear-gradient(90deg, rgb(125, 0, 34), rgb(125, 0, 34), rgb(210, 25, 80))'
            }}
          >
            <div className="flex items-center gap-3 md:gap-6 flex-1 min-w-0">
              <div
                className="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-lg cursor-pointer overflow-hidden"
                onClick={() => setShowMaking(prev => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowMaking(prev => !prev) } }}
                title="Toggle Making input"
                aria-pressed={showMaking}
              >
                {logoSrc ? (
                  <img src={logoSrc} alt="logo" className="w-full h-full object-contain max-w-full max-h-full" />
                ) : (
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="2" width="20" height="20" rx="4" fill="#FFD97A" />
                    <path d="M6 12c1.5-3 6-3 7.5 0 1.5-3 6-3 7.5 0" stroke="#8B2B0B" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              

              <div className='flex flex-col truncate'>
                <div>
                  {shopImageSrc ? (
                    // image shown in place of shopName text (keeps spacing consistent)
                    <img
                      src={shopImageSrc}
                      alt={shopName}
                      className="h-8 md:h-12 w-full max-w-[160px] md:max-w-[540px] object-contain"
                      style={{ maxWidth: '540px' }}
                    />

                  ) : (
                    <div className="text-xl md:text-2xl font-bold font-aparajita truncate ">{shopName}</div>
                  )}
                </div>

                <div>
                  {shopSalutation ? (
                    // image shown in place of shopName text (keeps spacing consistent)
                    <img
                      src={shopSalutation}
                      alt={shopName}
                      className="h-5 md:h-6 w-full max-w-[240px] object-contain"
                      style={{ maxWidth: '240px' }}
                    />
                  ) : (
                    <div className="text-sm md:text-xl font-bold font-aparajita truncate ">{shopName}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">

              {/* ---------- NEW: status indicator placed beside the existing "Next in" (keeps gap intact) ---------- */}
              <div className="flex flex-col items-end md:items-center gap-1">
                <StatusIndicator status={connectionStatus} />
                <div className="text-xs text-amber-100/70 pl-2 md:pl-5">
                  Next in: <span className="font-semibold text-amber-100">{remaining}s</span>
                </div>
              </div>
              {/* --------------------------------------------------------------------------------------------------- */}
            </div>
          </div>

          <div className="p-6 pt-4 bg-gradient-to-br from-gray-900 to-gray-800">

            {/* WRAPPER: left stacked 24K/22K/20K/18K/16K and right vertical Silver + GoldCoin stacked */}
            <div className="grid grid-cols-1 md:grid-cols-3 items-start gap-4 max-w-full mx-1 mt-1">
              {/* LEFT: stacked 24K, 22K, 20K, 18K, 16K */}
              <div className="md:col-span-2 space-y-4">
                {/* ... (left column unchanged) */}
                {/* 24K  */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight"> <span className='font-bold text-2xl'>24K</span> (99.5) (1 gm)</div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate / 10)}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">10 gm</div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 22K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight"> <span className='font-bold text-2xl'>22K</span> (91.6) (1 gm)</div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate22K10gm / 10)}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">10 gm</div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate22K10gm)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 20K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight"> <span className='font-bold text-2xl'>20K</span> (83.3) (1 gm)</div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate20K10gm / 10)}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">10 gm</div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate20K10gm)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 18K (moved under 20K to align directly below it) */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight"> <span className='font-bold text-2xl'>18K</span> (75.0) (1 gm)</div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate18K10gm / 10)}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">10 gm</div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate18K10gm)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 16K (moved under 18K to keep left column consistent) */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight"> <span className='font-bold text-2xl'>16K</span> (66.7) (1 gm)</div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate16K10gm / 10)}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">10 gm</div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? '—' : fmtInt(rate16K10gm)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT: column that holds Silver and Gold Coin stacked with identical width */}
              <div className="md:col-span-1 flex flex-col items-center justify-start gap-3.5">
                <RightVerticalSilver loading={loading} rate1kg={silverRate} />
                <RightSingleStack title='Gold Coin' bigValue={goldcoin} loading={loading} />
                <RightDoubleStack
                  left={{ title: 'Spot Gold', bigValue: spotGoldRate, loading: !Number.isFinite(spotGoldRate) }}
                  right={{ title: 'Dollar', bigValue: dollarRate, loading: (dollarRate) }}
                  showDivider={true}
                />

              </div>
            </div>

            {/* Table card */}
            <div className="mt-6 bg-gray-900/60 border border-amber-800 rounded-2xl p-4 shadow-lg">
              <div className="overflow-x-auto rounded-sm">
                <table className="w-full table-auto text-md font-semibold border-collapse border border-amber-700">
                  <thead>
                    <tr className="text-left text-lg bg-gray-900/60">
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Carat</th>
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Rate of 10 gm</th>
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Rate of 1 gm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows ? (
                      tableRows.map((r) => (
                        <tr key={r.carat} className="hover:bg-gray-800/60 transition-colors">
                          <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">{r.carat}</td>
                          <td className="px-4 py-3 text-amber-50 border-b border-amber-800">{fmtInt(r.rate)}</td>
                          <td className="px-4 py-3 text-amber-200 border-b border-amber-800">{fmtInt(r.ratePer10)}</td>
                        </tr>
                      ))
                    ) : (
                      ["24K","22K","20K","18K","16K"].map(k => (
                        <tr key={k} className="animate-pulse">
                          <td className="px-4 py-3 bg-gray-800/40 rounded-md">{k}</td>
                          <td className="px-4 py-3 bg-gray-800/40">&nbsp;</td>
                          <td className="px-4 py-3 bg-gray-800/40">&nbsp;</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between flex-wrap gap-3 text-md text-amber-200/70">
              <div className="bg-gray-900/60 border border-amber-800 rounded-xl px-3 py-2 flex items-center gap-3 shadow w-full md:w-auto">
                <label className="text-xs text-amber-200/80">Refresh</label>
                <input
                  value={refreshVal}
                  onChange={e => setRefreshVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyRefresh() } }}
                  className="w-16 text-right text-sm px-2 py-1 rounded-md bg-gray-950 border border-amber-800 text-amber-100"
                  placeholder={String(defaultRefreshSeconds)}
                  inputMode="numeric"
                />
                <select value={refreshUnit} onChange={e => setRefreshUnit(e.target.value)} className="text-sm px-2 py-1 rounded-md bg-gray-950 border border-amber-800 text-amber-100">
                  <option value="seconds">sec</option>
                  <option value="minutes">min</option>
                </select>
                <button onClick={applyRefresh} className="ml-2 bg-rose-600 hover:bg-rose-700 text-white text-sm px-3 py-1 rounded-md shadow">Apply</button>
              </div>

              {/* NEW: Responsive Making input alignment */}
              {showMaking && (
                <div className="flex items-center gap-2 w-full md:w-auto justify-end md:justify-center">
                  <label className="text-md font-semibold text-amber-200/80">Making</label>
                  <input
                    value={makingVal}
                    onChange={e => setMakingVal(e.target.value)}
                    className="w-20 text-right text-sm px-2 py-1 rounded-md bg-gray-950 border border-amber-800 text-amber-100"
                    placeholder="5250"
                    inputMode="numeric"
                    aria-label="Making charge"
                  />
                </div>
              )}


              <div className="w-full md:w-auto text-right text-sm md:text-base md:text-right">
                Last updated:{" "}
                <span className="font-medium">
                  {lastUpdate ? lastUpdate.toLocaleString() : "—"}
                </span>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
