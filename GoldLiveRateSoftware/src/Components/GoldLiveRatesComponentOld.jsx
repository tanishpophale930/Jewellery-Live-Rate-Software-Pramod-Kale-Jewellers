import React, { useEffect, useRef, useState } from 'react'
import "tailwindcss";

/**
 * GoldLiveRatesComponent
 *
 * Props:
 *  - logoSrc?: string
 *  - shopName?: string
 *  - defaultRefreshSeconds?: number
 *  - trustedYear?: string | number
 *
 * NOTE: Ensure Tailwind CSS is configured in your project (or use the CDN for a quick preview).
 */
export default function GoldLiveRatesComponentOld({
  logoSrc,
  shopName,
  defaultRefreshSeconds
}) {
  const ENDPOINT =
    "https://bcast.sagarjewellers.co.in:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/sagar?_=1761132425086"

  // state for fetched rate
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  // refresh controls
  const [refreshVal, setRefreshVal] = useState('') // user input numeric
  const [refreshUnit, setRefreshUnit] = useState('seconds') // 'seconds' | 'minutes'
  const [refreshMs, setRefreshMs] = useState(() => (defaultRefreshSeconds ?? 60) * 1000)

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

  // main fetch function (signal optional)
  async function fetchRate(signal) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(ENDPOINT, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const text = await res.text()
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const targetLine = lines.find(l =>
        /GOLD NAGPUR 99\.5 RTGS \(Rate 50 gm\)/i.test(l)
      )

      if (!targetLine) throw new Error('Target product line not found in response')

      // robust parsing: (kept from original)
      let extracted = null
      const cols = targetLine.split(/\t+/).map(c => c.trim()).filter(Boolean)
      const dashColIndex = cols.findIndex(c => /^[-—]$/.test(c))

      if (dashColIndex !== -1 && cols.length > dashColIndex + 1) {
        const afterCols = cols.slice(dashColIndex + 1)
        const afterText = afterCols.join(' ')
        const m = afterText.match(/\d+(?:\.\d+)?/)
        if (m) extracted = m[0]
      }

      if (!extracted) {
        const dashPos = targetLine.indexOf('-')
        if (dashPos !== -1) {
          const after = targetLine.slice(dashPos + 1)
          const m = after.match(/\d+(?:\.\d+)?/)
          if (m) extracted = m[0]
        }
      }

      if (!extracted) {
        const allNums = targetLine.match(/\d+(?:\.\d+)?/g) || []
        if (allNums.length) {
          extracted = allNums.reduce((a, b) =>
            parseFloat(b) > parseFloat(a) ? b : a
          , allNums[0])
        }
      }

      if (!extracted) throw new Error('Could not parse numeric rate from product line')

      const numeric = Number(extracted)
      setRate(Number.isFinite(numeric) ? numeric : null)
      setLastUpdate(new Date())
      setLoading(false)

      // schedule next run using current refreshMs
      scheduleNextFetch(refreshMs)
    } catch (err) {
      if (err?.name === 'AbortError') return
      setError(err?.message ?? String(err))
      setLoading(false)
      // still schedule retry after refreshMs so UI recovers
      scheduleNextFetch(refreshMs)
    }
  }

  // build derived table values from base (24K)
  function buildTable(base) {
    if (!base || !Number.isFinite(base)) return null
    const b = Number(base)
    const row24 = b
    const row22 = (row24 + 5250) / 1.1
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

  // format integer with commas (round to nearest integer)
  function fmtInt(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return '—'
    const n = Math.round(Number(val))
    return n.toLocaleString('en-IN')
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
    }
    const ms = refreshUnit === 'minutes' ? v * 60_000 : v * 1000
    setRefreshMs(ms)

    // abort any active fetch and restart immediately with new interval
    if (controllerRef.current) controllerRef.current.abort()
    controllerRef.current = new AbortController()

    clearSchedules()
    fetchRate(controllerRef.current.signal)
  }

  // mount: start first fetch and ensure cleanup on unmount
  useEffect(() => {
    controllerRef.current = new AbortController()
    fetchRate(controllerRef.current.signal)

    return () => {
      if (controllerRef.current) controllerRef.current.abort()
      clearSchedules()
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

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-gray-950 text-amber-100 p-6 flex items-start justify-center">
      {/* Outer container with subtle star/dust-like overlay feel can be added later */}
      <div className="w-full max-w-5xl">
        {/* Top bar: dark with gold gradient strip */}
        <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }}>
          <div
            className="px-6 py-5 flex items-center justify-between"
            style={{
              background: 'linear-gradient(90deg, rgba(30,12,12,1) 0%, rgba(44,10,10,1) 10%, rgba(20,12,8,1) 40%)'
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 flex items-center justify-center rounded-lg bg-gradient-to-br from-amber-600 via-yellow-400 to-amber-300 shadow-inner">
                {logoSrc ? (
                  <img src={logoSrc} alt="logo" className="w-12 h-12 object-contain" />
                ) : (
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="2" width="20" height="20" rx="4" fill="#FFD97A" />
                    <path d="M6 12c1.5-3 6-3 7.5 0 1.5-3 6-3 7.5 0" stroke="#8B2B0B" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              <div>
                <div className="text-2xl font-extrabold tracking-tight text-amber-50 drop-shadow-sm">{shopName}</div>
                {/* <div className="text-sm text-amber-200/80">Trusted since {trustedYear} · Live gold rates</div> */}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-3 py-2 flex items-center gap-3 shadow">
                <label className="text-xs text-amber-200/80">Refresh</label>
                <input
                  value={refreshVal}
                  onChange={e => setRefreshVal(e.target.value)}
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

              <div className="text-xs text-amber-200/70">
                Next in: <span className="font-semibold text-amber-100">{remaining}s</span>
              </div>
            </div>
          </div>

          {/* Main section: prominent rate & quick info */}
          <div className="p-6 bg-gradient-to-br from-gray-900 to-gray-800">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="md:col-span-2 bg-gradient-to-r from-amber-700 via-amber-400 to-amber-200 rounded-2xl p-5 shadow-lg ring-1 ring-amber-900/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-900/80 font-semibold">24K (base)</div>
                    <div className="mt-2 flex items-baseline gap-4">
                      <div className="text-5xl font-extrabold text-rose-900 drop-shadow-sm">{loading ? '—' : fmtInt(rate)}</div>
                      <div className="text-sm font-medium text-rose-800">INR</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${error ? 'bg-red-600 text-white' : 'bg-amber-900 text-amber-100'}`}>
                      {loading ? 'Loading' : (error ? 'Error' : 'Live')}
                    </div>

                    <div className="mt-2 text-xs text-gray-900/70">
                      <div className="font-medium">Updated</div>
                      <div className="mt-1 text-xs">{lastUpdate ? lastUpdate.toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 shadow-inner text-amber-200">
                <div className="text-sm font-semibold text-amber-100">Quick Info</div>
                <div className="mt-2 text-xs">{error ? <span className="text-red-400">{error}</span> : 'Auto-updates enabled'}</div>
                <div className="mt-2 text-xs">Default refresh: {Math.round(defaultRefreshSeconds)}s</div>
                <div className="mt-3 text-xs italic text-amber-200/80">Set seconds or minutes and click <span className="font-semibold">Apply</span>.</div>
              </div>
            </div>

            {/* Table card */}
            <div className="mt-6 bg-gray-900/60 border border-gray-800 rounded-2xl p-4 shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-4 py-3 text-amber-300 font-semibold">Carat</th>
                      <th className="px-4 py-3 text-amber-300 font-semibold">Rate of 10 gm</th>
                      <th className="px-4 py-3 text-amber-300 font-semibold">Rate of 1 gm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows ? (
                      tableRows.map((r) => (
                        <tr key={r.carat} className="hover:bg-gray-800/60 transition-colors">
                          <td className="px-4 py-3 font-medium text-amber-100">{r.carat}</td>
                          <td className="px-4 py-3 text-amber-50">{fmtInt(r.rate)}</td>
                          <td className="px-4 py-3 text-amber-200">{fmtInt(r.ratePer10)}</td>
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
            <div className="mt-6 flex items-center justify-between text-xs text-amber-200/70">
              <div>Rates provided for informational purposes only.</div>
              <div>Last updated: <span className="font-medium">{lastUpdate ? lastUpdate.toLocaleString() : '—'}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
