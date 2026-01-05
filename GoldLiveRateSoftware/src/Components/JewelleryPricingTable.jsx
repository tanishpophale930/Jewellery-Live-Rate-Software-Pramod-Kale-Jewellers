import React, { useState, useEffect, useRef, useCallback } from "react";

// --- Constants & Keys ---
const ENDPOINT = "https://bcast.sagarjewellers.co.in:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/sagar?_=1761132425086";
const LS_LAST_RATE_KEY = "gold_last_rate_v1";
const REFRESH_INTERVAL_MS = 5000; // Force update every 5 seconds
const BLINK_MS = 1000;

function fmtInt(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  const n = Math.round(Number(val));
  return n.toLocaleString("en-IN");
}

function fmtWeight(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  const n = Number(val);
  const hasFraction = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-IN", { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 });
}

function parseGoldRate(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const goldLine = lines.find((l) => /GOLD NAGPUR 99\.5 RTGS \(Rate 50 gm\)/i.test(l));
  if (!goldLine) 
    throw new Error("Target product line not found in response");

  let extracted = null;
  const cols = goldLine
    .split(/\t+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const dashColIndex = cols.findIndex((c) => /^[-—]$/.test(c));

  if (dashColIndex !== -1 && cols.length > dashColIndex + 1) {
    const afterCols = cols.slice(dashColIndex + 1);
    const afterText = afterCols.join(" ");
    const m = afterText.match(/\d+(?:\.\d+)?/);
    if (m) extracted = m[0];
  }

  if (!extracted) {
    const dashPos = goldLine.indexOf("-");
    if (dashPos !== -1) {
      const after = goldLine.slice(dashPos + 1);
      const m = after.match(/\d+(?:\.\d+)?/);
      if (m) extracted = m[0];
    }
  }

  if (!extracted) {
    const allNums = goldLine.match(/\d+(?:\.\d+)?/g) || [];
    if (allNums.length) {
      extracted = allNums.reduce(
        (a, b) => (parseFloat(b) > parseFloat(a) ? b : a),
        allNums[0]
      );
    }
  }

  if (!extracted)
    throw new Error("Could not parse numeric rate from GOLD line");

  const numericGold = Number(extracted);
  return numericGold;
}

export default function JewelleryPricingTable({ makingVal = "5250"}) {
  // --- 1. Load Initial State from Cache ---
  const getCachedData = () => {
    try {
      const lastRaw = localStorage.getItem(LS_LAST_RATE_KEY);
      if (lastRaw) {
        const parsed = JSON.parse(lastRaw);
        if (parsed && Number.isFinite(parsed.rate)) return parsed;
      }
    } catch (e) { return null; }
    return null;
  };

  const cached = getCachedData();

  // --- 2. States ---
  const [rate, setRate] = useState(cached ? Number(cached.rate) : null);
  const [loading, setLoading] = useState(!cached);
  const [initialized, setInitialized] = useState(Boolean(cached));
  const [lastUpdated, setLastUpdated] = useState(cached?.ts ? new Date(Number(cached.ts)) : null);
  
  // Rows state: each row has weight, carat, makingPercent
  const defaultRowCount = 5;
  const nextIdRef = useRef(1);
  const makeEmptyRow = () => ({ id: nextIdRef.current++, weight: "", carat: "22K", makingPercent: "10%" });
  const makeRows = (n) => Array.from({ length: n }, () => makeEmptyRow());

  const [rows, setRows] = useState(() => makeRows(defaultRowCount));

  const [isBlinking, setIsBlinking] = useState(false);
  const [blinkDir, setBlinkDir] = useState(null);

  // --- 3. Refs for Interval Control ---
  const initializedRef = useRef(Boolean(cached));
  const previousRateRef = useRef(cached ? Number(cached.rate) : null);
  const timerRef = useRef(null);
  const controllerRef = useRef(null);
  const blinkTimeoutRef = useRef(null);
  const [carat, setCarat] = useState("22K");

  const caratOptions = ["24K", "22K", "20K", "18K", "16K"];
  const makingPercentOptions = ["3%", "3.50%", "5%", "10%", "12%"];

  // NEW: show/hide making input when clicking the logo
  const [showMaking, setShowMaking] = useState(false);

  // --- 4. Live Calculation (Nagpur Formula) ---
  const getDerivedRates = useCallback(() => {
    if (!rate) return { g10: 0, g1: 0 };
    // derive using the currently-selected global carat
    return deriveForCarat(carat, rate);
  }, [rate, makingVal, carat]);


  // We'll compute per-row rates below using the same logic. Helpers:
  const caratIs24Global = () => false; // unused for per-row logic, kept to avoid breaking old references
  const computeR10BasedOnCarat = (r, mk) => r; // placeholder

  // Per-row derived rates function (uses `carat` per-row)
  const deriveForCarat = (carat, rateValue) => {
    if (!rateValue) return { g10: 0, g1: 0 };
    const makingNumber = Number(makingVal) || 5250;
    let r10 = 0;
    if (carat === "24K") r10 = rateValue;
    else if (carat === "22K") r10 = (rateValue + makingNumber) / 1.1;
    else if (carat === "20K") r10 = rateValue / 1.1;
    else if (carat === "18K") r10 = (0.95 * rateValue) / 1.1;
    else if (carat === "16K") r10 = (0.85 * rateValue) / 1.1;
    return { g10: r10, g1: r10 / 10 };
  };

  const { g1: current1gRate, g10: current10gRate } = getDerivedRates();

  // --- 5. Core Fetch Function ---
  const fetchRate = useCallback(async (signal) => {
    if (!initializedRef.current) setLoading(true);

    try {
      const res = await fetch(`${ENDPOINT}?_=${Date.now()}`, { signal });
      const text = await res.text();
      const newRate = parseGoldRate(text);

      if (newRate) {
        if (previousRateRef.current !== null && newRate !== previousRateRef.current) {
          setBlinkDir(newRate > previousRateRef.current ? "up" : "down");
          setIsBlinking(true);
          
          if (blinkTimeoutRef.current) clearTimeout(blinkTimeoutRef.current);
          blinkTimeoutRef.current = setTimeout(() => {
            setIsBlinking(false);
            setBlinkDir(null);
          }, BLINK_MS);
        }

        setRate(newRate);
        previousRateRef.current = newRate;
        const now = new Date();
        setLastUpdated(now);
        localStorage.setItem(LS_LAST_RATE_KEY, JSON.stringify({ rate: newRate, ts: now.getTime() }));
        setInitialized(true);
        initializedRef.current = true;
      }
    } catch (err) {
      if (err?.name !== "AbortError") console.error("Rate fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // (Optional) you can wire up an interval like in your original code if desired.


    // Improved Enter handler:
  // - If Enter pressed while already on a SELECT: allow default (so arrow keys/Enter work)
  // - If Enter moves focus to a SELECT: focus it and attempt to open the dropdown
  const handleEnterKey = (e) => {
    if (e.key !== "Enter") return;

    // If the currently focused element is a SELECT, let browser handle Enter (open/select)
    const active = document.activeElement;
    if (active && active.tagName === "SELECT") {
      // do nothing — allow arrow keys and Enter to operate the select
      return;
    }

    // Otherwise we will move focus to next control (and open select if that's the next)
    e.preventDefault();

    const table =
      (e.currentTarget && e.currentTarget.closest && e.currentTarget.closest("table")) ||
      document.querySelector("table");
    if (!table) return;

    const focusables = Array.from(
      table.querySelectorAll("tbody input, tbody select, tbody textarea, tbody button")
    ).filter((el) => !el.disabled && !(el.offsetParent === null));

    if (!focusables.length) return;

    // use document.activeElement (safer with React re-renders)
    let idx = focusables.indexOf(document.activeElement);
    if (idx === -1 && e.currentTarget) idx = focusables.indexOf(e.currentTarget);

    const next = focusables[(idx + 1) % focusables.length];
    if (!next) return;

    // Delay allowing React updates to flush, then focus and (if select) open it
    setTimeout(() => {
      try {
        next.focus();

        // If it's an input, select its contents for quick typing
        if (next.tagName === "INPUT" && typeof next.select === "function") next.select();

        // If it's a <select>, attempt to open its dropdown so arrow keys and Enter work immediately.
        if (next.tagName === "SELECT") {
          // Preferred modern API (Chrome 93+/some browsers)
          if (typeof next.showPicker === "function") {
            try { next.showPicker(); } catch (err) { /* ignore if unsupported */ }
          } else {
            // Fallback: dispatch a mouse event which in many browsers opens the dropdown
            const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
            next.dispatchEvent(ev);
            // In some edge-cases, a click() helps:
            try { next.click(); } catch (err) { /* ignore */ }
          }
        }
      } catch (err) {
        // swallow — focusing is best-effort
        // console.debug("focus move failed", err);
      }
    }, 0);
  };




  // --- Rows helpers ---
  const updateRow = (rowIndex, updates) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === rowIndex ? { ...r, ...updates } : r));
      // Auto-add logic: if user entered weight into last row (and non-empty), append a fresh row
      const last = next[next.length - 1];
      if (last && last.weight !== "" && last.weight !== null && last.weight !== undefined) {
        // Append only if last row is non-empty (weight filled)
        next.push(makeEmptyRow());
      }
      return next;
    });
  };

  const addRow = () => setRows((p) => [...p, makeEmptyRow()]);
  const removeRow = (rowIndex) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev; // keep at least 1 row
      const copy = prev.slice();
      copy.splice(rowIndex, 1);
      return copy;
    });
  };

  const resetRows = () => {
    nextIdRef.current += 1000; // bump ids slightly to avoid reusing same ids (optional)
    setRows(makeRows(defaultRowCount));
  };

  // --- Per-row price/GST/making charges calculations ---
  const calculateRowPrice = (row, extraHallmark = 100) => {
    const w = parseFloat(row.weight) || 0;
    const derived = deriveForCarat(row.carat, rate || 0);
    const oneGramRate = derived.g1 || 0;
    if (w === 0 || oneGramRate === 0) return 0;
    const makingPercentNumber = row.makingPercent ? parseFloat((String(row.makingPercent)).replace("%", "")) : 0;
    const m = (w * oneGramRate) * (makingPercentNumber / 100);
    // the original code multiplied final result by 1.03 (maybe some markup); keep same
    return Math.round((w * oneGramRate + m + extraHallmark) * 1.03);
  };

  const calculateRowGST = (row) => {
    const w = parseFloat(row.weight) || 0;
    const derived = deriveForCarat(row.carat, rate || 0);
    const oneGramRate = derived.g1 || 0;
    if (w === 0 || oneGramRate === 0) return 0;
    const makingPercentNumber = row.makingPercent ? parseFloat((String(row.makingPercent)).replace("%", "")) : 0;
    const m = (w * oneGramRate) * (makingPercentNumber / 100);
    return Math.round((w * oneGramRate + m + 100) * 0.03);
  };

  // The original "Making Charges" cell displayed `makingVal * weight`. Keep same behavior (converted to Number).
  const calculateRowMakingCharges = (row) => {
    const w = parseFloat(row.weight) || 0;
    const making = Number(makingVal) || 0;        
    const total = making * w;                    
    const tenPercent = total * 0.10;             
    return Math.round(tenPercent);
  };

  // --- Totals calculation (sums across rows) ---
  // We include rows that have a numeric weight (empty weight is ignored).
  const totalWeight = rows.reduce((sum, r) => {
    const w = parseFloat(r.weight);
    return sum + (isNaN(w) ? 0 : w);
  }, 0);

  const total100 = rows.reduce((sum, r) => sum + calculateRowPrice(r, 100), 0);
  const total150 = rows.reduce((sum, r) => sum + calculateRowPrice(r, 150), 0);
  const totalGST = rows.reduce((sum, r) => sum + calculateRowGST(r), 0);
  const totalMakingCharges = rows.reduce((sum, r) => sum + calculateRowMakingCharges(r), 0);

  // --- Dynamic UI Logic ---
  let blinkClass = "border-neutral-700 bg-neutral-800/50";
  if (isBlinking) {
    blinkClass = blinkDir === "up" 
      ? "bg-green-500/20 border-green-500 animate-pulse" 
      : "bg-red-500/20 border-red-500 animate-pulse";
  }

  return (
    <div className="p-6 mt-8 bg-gray-900/60 text-white rounded-2xl shadow-xl max-w-5xl mx-auto space-y-6 border border-neutral-700">

      {/* Main Rate Card */}
      <div className={`p-5 text-center border rounded-xl transition-all duration-300 ${blinkClass}`}>
        {!initialized && loading ? (
          <p className="animate-pulse text-neutral-400">🔄 Loading Market Rates...</p>
        ) : (
          <div>
            <p className="text-2xl font-bold text-amber-500 uppercase mb-2">Live {carat} Rate</p>
            <div className="flex justify-center space-x-12">
              <div className="text-center">
                <span className="block text-xs text-neutral-400 uppercase">Per 1 Gram</span>
                <span className={`text-3xl font-black transition-colors ${isBlinking ? 'text-white' : 'text-neutral-100'}`}>
                  ₹ {fmtInt(current1gRate)}
                </span>
              </div>
              <div className="text-center">
                <span className="block text-xs text-neutral-400 uppercase">Per 10 Gram</span>
                <span className={`text-3xl font-black transition-colors ${isBlinking ? 'text-white' : 'text-neutral-100'}`}>
                  ₹ {fmtInt(current10gRate)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pricing Table */}
      <div className="mt-6 bg-gray-900/60 border border-amber-800 rounded-2xl p-4 shadow-lg">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-amber-300 font-bold text-lg">Item Price Calculator Table</h3>
          <div className="space-x-2">
            <button onClick={addRow} className="px-3 py-1 bg-neutral-700 rounded">Add Row</button>
            <button onClick={resetRows} className="px-3 py-1 bg-red-700 rounded font-bold active:scale-95">Reset Rows</button>
            <button onClick={() => fetchRate()} className="px-3 py-1 bg-amber-500 text-neutral-900 rounded font-bold active:scale-95">
              {loading ? "Updating..." : "Refresh Rate"}
            </button>
            <button className="px-3 py-1 bg-red-700 rounded font-bold active:scale-95" onClick={() => setShowMaking((prev) => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowMaking((prev) => !prev);
                  }
                  }}
                title="Toggle Making input"
                aria-pressed={showMaking}>
                  Add MC
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-sm">
          <table className="w-full table-auto text-md font-semibold border-collapse border border-amber-700">
            <thead>
              <tr className="text-left text-lg bg-gray-900/60">
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Sr. No</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Weight (gm)</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Carat</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Rate/gm</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Making (%)</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Total (+100 Rs Hallmark)</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Total (+150 Rs Hallmark)</th>
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">GST (3%)</th>
                {showMaking && (
                <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">Making Charges</th>
                )}

              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((row, idx) => {
                const derived = deriveForCarat(row.carat, rate || 0);
                const perGram = derived.g1 || 0;
                const total100 = calculateRowPrice(row, 100);
                const total150 = calculateRowPrice(row, 150);
                const gst = calculateRowGST(row);
                const makingCharges = calculateRowMakingCharges(row);
                return (
                  <tr key={row.id} className="hover:bg-gray-800/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">{idx + 1}</td>

                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        value={row.weight}
                        onChange={(e) => updateRow(idx, { weight: e.target.value })}
                        onKeyDown={handleEnterKey}
                        className="w-16 p-1 rounded-lg bg-neutral-800 border border-neutral-600 outline-none"
                        placeholder="0.00"
                      />
                    </td>

                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">
                      <select value={row.carat}  
                      onChange={(e) => {
                        const v = e.target.value;
                        updateRow(idx, { carat: v });
                        setCarat(v);           // <-- update global displayed carat
                      }}
                      onKeyDown={handleEnterKey}  
                      className="w-16 p-1 rounded bg-neutral-800 border border-neutral-600 text-[15px]">
                        {caratOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>

                    <td className={`px-4 py-3 font-bold transition-colors border-b border-amber-800 ${isBlinking ? 'text-amber-400' : 'text-amber-200'}`}>
                      ₹{fmtInt(perGram)}
                    </td>


                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">
                      <select value={row.makingPercent} onChange={(e) => updateRow(idx, { makingPercent: e.target.value })}
                        onKeyDown={handleEnterKey}    
                        className="w-16 p-1 rounded bg-neutral-800 border border-neutral-600 text-[15px]">
                        <option value="">%</option>
                        {makingPercentOptions.map((mp) => <option key={mp} value={mp}>{mp}</option>)}
                      </select>
                    </td>

                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">₹{fmtInt(total100)}</td>
                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">₹{fmtInt(total150)}</td>
                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">₹{fmtInt(gst)}</td>
                    {showMaking && (
                    <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">₹{fmtInt(makingCharges)}</td>
                    )}

                  </tr>
                );
              })}
            </tbody>

            {/* Totals row: remains at the end even when rows are added */}
            <tfoot>
              <tr className="bg-gray-900/60">
                <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">Total</td>
                <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">{fmtWeight(totalWeight)}</td>
                <td className="px-4 py-3 text-amber-100 border-t border-amber-800">{/* carat column intentionally blank */}</td>
                <td className="px-4 py-3 text-amber-100 border-t border-amber-800">{/* rate/gm not applicable */}—</td>
                <td className="px-4 py-3 text-amber-100 border-t border-amber-800">{/* making % not applicable */}</td>
                <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">₹{fmtInt(total100)}</td>
                <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">₹{fmtInt(total150)}</td>
                <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">₹{fmtInt(totalGST)}</td>
                {showMaking && (
                  <td className="px-4 py-3 font-bold text-amber-100 border-t border-amber-800">₹{fmtInt(totalMakingCharges)}</td>
                )}
              </tr>
            </tfoot>

          </table>
        </div>
      </div>

    </div>
  );
}
