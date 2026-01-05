import React, { useEffect, useRef, useState } from "react";
import "tailwindcss";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import JewelleryPricingTable from "./JewelleryPricingTable";

/**
 * GoldLiveRatesComponent
 *
 * Props:
 *  - logoSrc?: string
 *  - shopName?: string
 *  - shopImageSrc?: string
 *  - defaultRefreshSeconds?: number
 */
export default function GoldLiveRatesComponent({
  logoSrc,
  shopName = "",
  shopImageSrc = null,
  shopSalutation = null,
  defaultRefreshSeconds = 5,
}) {
  const ENDPOINT =
    "https://bcast.sagarjewellers.co.in:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/sagar?_=1761132425086";

  // ------------------ LocalStorage keys ------------------
  const LS_MAKING_KEY = "gold_makingVal";
  const LS_REFRESH_VAL_KEY = "gold_refreshVal";
  const LS_REFRESH_UNIT_KEY = "gold_refreshUnit";
  // NEW: last-rate quick cache
  const LS_LAST_RATE_KEY = "gold_last_rate_v1";
  // ------------------------------------------------------

  // state for fetched rate
  //   const [rate, setRate] = useState(null);
  //   const [loading, setLoading] = useState(true);
  //   const [initialized, setInitialized] = useState(false);
  //   const [error, setError] = useState(null);
  //   const [lastUpdate, setLastUpdate] = useState(null);

  // ---------- try to synchronously restore last cached rate so first render has a value ----------
  let __cached_last_rate = null;
  try {
    const raw = localStorage.getItem(LS_LAST_RATE_KEY);
    __cached_last_rate = raw ? JSON.parse(raw) : null;
  } catch (e) {
    __cached_last_rate = null;
  }

  const [rate, setRate] = useState(
    __cached_last_rate && Number.isFinite(__cached_last_rate.rate)
      ? Number(__cached_last_rate.rate)
      : null
  );
  const [lastUpdate, setLastUpdate] = useState(
    __cached_last_rate && Number.isFinite(__cached_last_rate.ts)
      ? new Date(Number(__cached_last_rate.ts))
      : null
  );

  // loading should be false if we have a cached value so UI won't show "—"
  const [loading, setLoading] = useState(__cached_last_rate ? false : true);

  // keep both a ref and state for 'initialized' so checks are synchronous inside fetchRate
  const initializedRef = useRef(Boolean(__cached_last_rate));
  const [initialized, setInitialized] = useState(Boolean(__cached_last_rate));

  const [error, setError] = useState(null);

  const [silverRate, setSilverRate] = useState(null);
  const [spotGoldRate, setSpotGoldRate] = useState(null);
  const [blinkGoldCoinDir, setBlinkGoldCoinDir] = useState(null);
  const [blinkDollarDir, setBlinfkDollarDir] = useState(null);

  // --- NEW: dollar state ---
  const [dollarRate, setDollarRate] = useState(null);
  const dollarControllerRef = useRef(null);
  const dollarIntervalRef = useRef(null);
  const prevGoldCoinRef = useRef(null);
  const prevDollarRef = useRef(null);
  const DOLLAR_POLL_MS = 10000; // 10 seconds polling

  // ---------- NEW: live/connection indicator state & refs ----------
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const previousRateRef = useRef(null);
  const liveTimeoutRef = useRef(null);
  const stalenessIntervalRef = useRef(null);
  const blinkTimeoutGoldCoinRef = useRef(null);
  const blinkTimeoutDollarRef = useRef(null);
  const LIVE_DISPLAY_MS = 3000; // how long to show "Live" after a change (kept, but status now relies on lastChange)
  // ------------------------------------------------------------------

  // NEW: show/hide making input when clicking the logo
  const [showMaking, setShowMaking] = useState(false);

  // helper functions (kept unchanged)
  function extractNumericFromToken(token) {
    const m = token.match(/-?\d+(?:\.\d+)?/);
    return m ? m[0] : null;
  }
  function firstNumericAfterLabel(line, productRegex) {
    const m = line.match(productRegex);
    if (!m) return null;
    const after = line.slice(m.index + m[0].length);
    const tabCols = after
      .split(/\t+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (tabCols.length) {
      for (let i = 0; i < tabCols.length; i++) {
        const col = tabCols[i];
        if (col === "-" || /^[-—]+$/.test(col)) continue;
        const num = extractNumericFromToken(col);
        if (num) return num;
      }
    }
    const wsCols = after
      .split(/\s{2,}|\s+\t*/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const col of wsCols) {
      if (col === "-" || /^[-—]+$/.test(col)) continue;
      const num = extractNumericFromToken(col);
      if (num) return num;
    }
    const fallback = after.match(/\d+(?:\.\d+)?/);
    return fallback ? fallback[0] : null;
  }

  // refresh controls
  const [refreshVal, setRefreshVal] = useState("");
  const [refreshUnit, setRefreshUnit] = useState("seconds");
  const [refreshMs, setRefreshMs] = useState(
    () => (defaultRefreshSeconds ?? 5) * 1000
  );

  // Making input
  const [makingVal, setMakingVal] = useState("5250");

  // countdown
  const [remaining, setRemaining] = useState(Math.ceil(refreshMs / 1000));

  const timeoutRef = useRef(null);
  const countdownRef = useRef(null);
  const controllerRef = useRef(null);

  // ---------- NEW: chart state ----------
  const [chartData, setChartData] = useState([]);
  const MAX_POINTS = 120;
  // ----------------------------------------------------

  // Chart persistence
  const LS_CHART_KEY = "gold_chart_points_v2";
  const MAX_STORE_POINTS = 20000;
  const [selectedRange, setSelectedRange] = useState("1D");
  const displayedData = React.useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    if (selectedRange === "ALL") return chartData;
    const now = Date.now();
    const ms = rangeToMs(selectedRange);
    const threshold = now - ms;
    return chartData.filter((p) => p && p.ts && p.ts >= threshold);
  }, [chartData, selectedRange]);
  function rangeToMs(range) {
    if (range === "1D") return 24 * 60 * 60 * 1000;
    if (range === "1M") return 30 * 24 * 60 * 60 * 1000;
    if (range === "1Y") return 365 * 24 * 60 * 60 * 1000;
    return Infinity;
  }
  function compressForStorage(arr) {
    if (!Array.isArray(arr)) return [];
    if (arr.length <= MAX_STORE_POINTS) return arr;
    return arr.slice(arr.length - MAX_STORE_POINTS);
  }

  // ---------- NEW: blinking feature state & refs ----------
  const BLINK_MS = 900;
  // blink direction: 'up' | 'down' | null
  const [blinkRateDir, setBlinkRateDir] = useState(null);
  const [blinkSilverDir, setBlinkSilverDir] = useState(null);
  const [blinkSpotDir, setBlinkSpotDir] = useState(null);
  const [blink22Dir, setBlink22Dir] = useState(null);
  const [blink20Dir, setBlink20Dir] = useState(null);
  const [blink18Dir, setBlink18Dir] = useState(null);
  const [blink16Dir, setBlink16Dir] = useState(null);

  const prevSilverRef = useRef(null);
  const prevSpotRef = useRef(null);
  const prev22Ref = useRef(null);
  const prev20Ref = useRef(null);
  const prev18Ref = useRef(null);
  const prev16Ref = useRef(null);

  const blinkTimeoutRateRef = useRef(null);
  const blinkTimeoutSilverRef = useRef(null);
  const blinkTimeoutSpotRef = useRef(null);
  const blinkTimeout22Ref = useRef(null);
  const blinkTimeout20Ref = useRef(null);
  const blinkTimeout18Ref = useRef(null);
  const blinkTimeout16Ref = useRef(null);

  // ------------------------------------------------------

  // ---------- NEW: last-change tracker for Live/Stable logic ----------
  // If none of the monitored values change for this duration -> Stable
  const CHANGE_STABLE_MS = 60 * 60 * 1000; // 1 hour
  const lastChangeRef = useRef(null);
  const stableTimeoutRef = useRef(null);
  // -------------------------------------------------------------------

  function clearSchedules() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  function startCountdown(ms) {
    setRemaining(Math.ceil(ms / 1000));
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function scheduleNextFetch(ms) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      fetchRate(controllerRef.current?.signal);
    }, ms);
    startCountdown(ms);
  }

  // helper used elsewhere for blink (kept)
  const triggerBlink = (prevVal, curVal, setBlinkFn, timeoutRefLocal) => {
    if (!Number.isFinite(prevVal) || !Number.isFinite(curVal)) return;
    if (curVal > prevVal) {
      setBlinkFn("up");
      if (timeoutRefLocal.current) clearTimeout(timeoutRefLocal.current);
      timeoutRefLocal.current = setTimeout(() => setBlinkFn(null), BLINK_MS);
    } else if (curVal < prevVal) {
      setBlinkFn("down");
      if (timeoutRefLocal.current) clearTimeout(timeoutRefLocal.current);
      timeoutRefLocal.current = setTimeout(() => setBlinkFn(null), BLINK_MS);
    }
  };

  async function fetchRate(signal, nextMs = null) {
    if (!initializedRef.current) {
      setLoading(true);
    } else {
      setLoading(false);
    }
    setError(null);

    try {
      const res = await fetch(ENDPOINT, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const goldLine = lines.find((l) =>
        /GOLD NAGPUR 99\.5 RTGS \(Rate 50 gm\)/i.test(l)
      );
      if (!goldLine)
        throw new Error("Target product line not found in response");

      // preserved robust logic for gold
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

      // ---------- NEW: determine if any monitored value changed ----------
      const prevGold = previousRateRef.current;
      // SILVER (try exact label then fallback)
      let silverNum = null;
      const silverLineExact = lines.find((l) => /SILVER NAGPUR RTGS/i.test(l));
      if (silverLineExact) {
        const val = firstNumericAfterLabel(
          silverLineExact,
          /SILVER NAGPUR RTGS/i
        );
        silverNum = val ? Number(val) : null;
      } else {
        const silverLineAny = lines.find((l) => /\bSILVER\b/i.test(l));
        if (silverLineAny) {
          const m = silverLineAny.match(/\d+(?:\.\d+)?/);
          silverNum = m ? Number(m[0]) : null;
        }
      }

      // SPOT GOLD
      let spotNum = null;
      const spotLineExact = lines.find((l) => /SPOT\s*GOLD/i.test(l));
      if (spotLineExact) {
        const val = firstNumericAfterLabel(spotLineExact, /SPOT\s*GOLD/i);
        spotNum = val ? Number(val) : null;
      } else {
        const spotLineAny = lines.find((l) => /\bSPOT\b/i.test(l));
        if (spotLineAny) {
          const m = spotLineAny.match(/\d+(?:\.\d+)?/);
          spotNum = m ? Number(m[0]) : null;
        }
      }

      // Compare with previous refs to decide whether something actually *changed*
      let anyValueChanged = false;
      if (
        Number.isFinite(numericGold) &&
        Number.isFinite(prevGold) &&
        Number(numericGold) !== Number(prevGold)
      ) {
        anyValueChanged = true;
      }
      if (
        Number.isFinite(silverNum) &&
        Number.isFinite(prevSilverRef.current) &&
        Number(silverNum) !== Number(prevSilverRef.current)
      ) {
        anyValueChanged = true;
      }
      if (
        Number.isFinite(spotNum) &&
        Number.isFinite(prevSpotRef.current) &&
        Number(spotNum) !== Number(prevSpotRef.current)
      ) {
        anyValueChanged = true;
      }
      // dollar is updated in fetchDollar; it will update lastChangeRef there

      // If anything changed, update lastChangeRef and make status Live and schedule stable after 1 hour of inactivity
      if (anyValueChanged) {
        lastChangeRef.current = Date.now();
        // immediate visual feedback
        setConnectionStatus("live");

        if (stableTimeoutRef.current) {
          clearTimeout(stableTimeoutRef.current);
          stableTimeoutRef.current = null;
        }
        stableTimeoutRef.current = setTimeout(() => {
          // after 1 hour of no change, mark stable (if not offline)
          setConnectionStatus((prev) =>
            prev === "offline" ? "offline" : "stable"
          );
          stableTimeoutRef.current = null;
        }, CHANGE_STABLE_MS);
      }

      // ---------- NEW: blinking logic for main gold rate (24K 10gm) ----------
      const prev = prevGold;
      if (Number.isFinite(numericGold) && Number.isFinite(prev)) {
        if (Number(numericGold) > Number(prev)) {
          setBlinkRateDir("up");
          if (blinkTimeoutRateRef.current)
            clearTimeout(blinkTimeoutRateRef.current);
          blinkTimeoutRateRef.current = setTimeout(
            () => setBlinkRateDir(null),
            BLINK_MS
          );
        } else if (Number(numericGold) < Number(prev)) {
          setBlinkRateDir("down");
          if (blinkTimeoutRateRef.current)
            clearTimeout(blinkTimeoutRateRef.current);
          blinkTimeoutRateRef.current = setTimeout(
            () => setBlinkRateDir(null),
            BLINK_MS
          );
        }
      }

      // -----------------------------------------------------------------------------

      const isNumeric = Number.isFinite(numericGold);
      setRate(isNumeric ? numericGold : null);
      setLastUpdate(new Date());
      if (isNumeric) {
        // persist quick cache so next page load shows immediate value
        try {
          localStorage.setItem(
            LS_LAST_RATE_KEY,
            JSON.stringify({ rate: numericGold, ts: Date.now() })
          );
        } catch (e) {
          /* ignore storage errors */
        }
      }

      if (Number.isFinite(numericGold)) {
        const point = {
          time: new Date().toLocaleTimeString(),
          rate: numericGold,
          ts: Date.now(),
        };
        setChartData((prev) => {
          const next = [...prev, point];
          if (next.length > MAX_POINTS) next.shift();
          return next;
        });
      }

      // connection status: don't forcibly set stable here; staleness logic and lastChangeRef control it
      previousRateRef.current = numericGold;

      if (!initialized) {
        initializedRef.current = true;
        setInitialized(true);
        setLoading(false);
      }

      // ---------- NEW: blinking for derived carats (10 gm) ----------
      if (Number.isFinite(numericGold)) {
        // compute derived 10gm values (current)
        const new22 = (numericGold + makingNumber) / 1.1; // 22K 10gm
        const new20 = numericGold / 1.1; // 20K 10gm
        const new18 = (0.95 * numericGold) / 1.1; // 18K 10gm
        const new16 = (0.85 * numericGold) / 1.1; // 16K 10gm

        // IMPORTANT: use the earlier saved `prev` (previous 24K value), not previousRateRef.current
        const prevGoldLocal = prev;
        const prev22 = Number.isFinite(prevGoldLocal)
          ? (prevGoldLocal + makingNumber) / 1.1
          : null;
        const prev20 = Number.isFinite(prevGoldLocal)
          ? prevGoldLocal / 1.1
          : null;
        const prev18 = Number.isFinite(prevGoldLocal)
          ? (0.95 * prevGoldLocal) / 1.1
          : null;
        const prev16 = Number.isFinite(prevGoldLocal)
          ? (0.85 * prevGoldLocal) / 1.1
          : null;

        const triggerBlinkLocal = (
          prevVal,
          curVal,
          setBlink,
          timeoutRefLocal
        ) => {
          if (!Number.isFinite(prevVal)) return;
          if (curVal > prevVal) {
            setBlink("up");
            if (timeoutRefLocal.current) clearTimeout(timeoutRefLocal.current);
            timeoutRefLocal.current = setTimeout(
              () => setBlink(null),
              BLINK_MS
            );
          } else if (curVal < prevVal) {
            setBlink("down");
            if (timeoutRefLocal.current) clearTimeout(timeoutRefLocal.current);
            timeoutRefLocal.current = setTimeout(
              () => setBlink(null),
              BLINK_MS
            );
          }
        };

        triggerBlinkLocal(prev22, new22, setBlink22Dir, blinkTimeout22Ref);
        triggerBlinkLocal(prev20, new20, setBlink20Dir, blinkTimeout20Ref);
        triggerBlinkLocal(prev18, new18, setBlink18Dir, blinkTimeout18Ref);
        triggerBlinkLocal(prev16, new16, setBlink16Dir, blinkTimeout16Ref);

        prev22Ref.current = Number.isFinite(new22) ? new22 : prev22Ref.current;
        prev20Ref.current = Number.isFinite(new20) ? new20 : prev20Ref.current;
        prev18Ref.current = Number.isFinite(new18) ? new18 : prev18Ref.current;
        prev16Ref.current = Number.isFinite(new16) ? new16 : prev16Ref.current;
      }

      // ---------- NEW: blinking for Gold Coin ----------
      const newGoldCoin = Number.isFinite(numericGold)
        ? numericGold / 10 + 100
        : null;
      const prevGoldCoin = Number.isFinite(prev) ? prev / 10 + 100 : null;
      triggerBlink(
        prevGoldCoin,
        newGoldCoin,
        setBlinkGoldCoinDir,
        blinkTimeoutGoldCoinRef
      );
      prevGoldCoinRef.current = Number.isFinite(newGoldCoin)
        ? newGoldCoin
        : prevGoldCoinRef.current;

      // ----- SILVER (use silverNum computed earlier) -----
      const prevSilver = prevSilverRef.current;
      if (Number.isFinite(silverNum) && Number.isFinite(prevSilver)) {
        if (silverNum > prevSilver) {
          setBlinkSilverDir("up");
          if (blinkTimeoutSilverRef.current)
            clearTimeout(blinkTimeoutSilverRef.current);
          blinkTimeoutSilverRef.current = setTimeout(
            () => setBlinkSilverDir(null),
            BLINK_MS
          );
        } else if (silverNum < prevSilver) {
          setBlinkSilverDir("down");
          if (blinkTimeoutSilverRef.current)
            clearTimeout(blinkTimeoutSilverRef.current);
          blinkTimeoutSilverRef.current = setTimeout(
            () => setBlinkSilverDir(null),
            BLINK_MS
          );
        }
      }
      prevSilverRef.current = Number.isFinite(silverNum)
        ? silverNum
        : prevSilverRef.current;
      setSilverRate(Number.isFinite(silverNum) ? silverNum : null);

      // ----- SPOT GOLD (already computed) -----
      const prevSpot = prevSpotRef.current;
      if (Number.isFinite(spotNum) && Number.isFinite(prevSpot)) {
        if (spotNum > prevSpot) {
          setBlinkSpotDir("up");
          if (blinkTimeoutSpotRef.current)
            clearTimeout(blinkTimeoutSpotRef.current);
          blinkTimeoutSpotRef.current = setTimeout(
            () => setBlinkSpotDir(null),
            BLINK_MS
          );
        } else if (spotNum < prevSpot) {
          setBlinkSpotDir("down");
          if (blinkTimeoutSpotRef.current)
            clearTimeout(blinkTimeoutSpotRef.current);
          blinkTimeoutSpotRef.current = setTimeout(
            () => setBlinkSpotDir(null),
            BLINK_MS
          );
        }
      }
      prevSpotRef.current = Number.isFinite(spotNum)
        ? spotNum
        : prevSpotRef.current;
      setSpotGoldRate(Number.isFinite(spotNum) ? spotNum : null);

      setLoading(false);

      const msToUse = nextMs ?? refreshMs;
      scheduleNextFetch(msToUse);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err?.message ?? String(err));
      if (!initialized) setLoading(false);
      setConnectionStatus("offline");
      scheduleNextFetch(refreshMs);
    }
  }

  // --- NEW: fetch dollar (unchanged endpoint flow) ---
  async function fetchDollar(signal) {
    try {
      const tryEndpoint = async (url) => {
        const r = await fetch(url, { signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      };
      let j = null;
      try {
        j = await tryEndpoint(
          "https://api.exchangerate.host/latest?base=USD&symbols=INR"
        );
        const val = j && j.rates && j.rates.INR ? Number(j.rates.INR) : null;
        if (Number.isFinite(val)) {
          const prevDollar = prevDollarRef.current;
          if (
            Number.isFinite(prevDollar) &&
            Number.isFinite(val) &&
            Number(val) !== Number(prevDollar)
          ) {
            // dollar actually changed -> update lastChangeRef and show live status
            lastChangeRef.current = Date.now();
            setConnectionStatus("live");
            if (stableTimeoutRef.current) {
              clearTimeout(stableTimeoutRef.current);
              stableTimeoutRef.current = null;
            }
            stableTimeoutRef.current = setTimeout(() => {
              setConnectionStatus((prev) =>
                prev === "offline" ? "offline" : "stable"
              );
              stableTimeoutRef.current = null;
            }, CHANGE_STABLE_MS);
            // blink handling
            if (val > prevDollar) {
              setBlinkDollarDir("up");
              if (blinkTimeoutDollarRef.current)
                clearTimeout(blinkTimeoutDollarRef.current);
              blinkTimeoutDollarRef.current = setTimeout(
                () => setBlinkDollarDir(null),
                BLINK_MS
              );
            } else if (val < prevDollar) {
              setBlinkDollarDir("down");
              if (blinkTimeoutDollarRef.current)
                clearTimeout(blinkTimeoutDollarRef.current);
              blinkTimeoutDollarRef.current = setTimeout(
                () => setBlinkDollarDir(null),
                BLINK_MS
              );
            }
          }
          prevDollarRef.current = Number.isFinite(val)
            ? val
            : prevDollarRef.current;
          setDollarRate(val);
          return;
        }
      } catch (e) {}
      try {
        const j2 = await tryEndpoint("https://open.er-api.com/v6/latest/USD");
        const val2 =
          j2 && j2.rates && j2.rates.INR ? Number(j2.rates.INR) : null;
        if (Number.isFinite(val2)) {
          const prevDollar = prevDollarRef.current;
          if (
            Number.isFinite(prevDollar) &&
            Number.isFinite(val2) &&
            Number(val2) !== Number(prevDollar)
          ) {
            lastChangeRef.current = Date.now();
            setConnectionStatus("live");
            if (stableTimeoutRef.current) {
              clearTimeout(stableTimeoutRef.current);
              stableTimeoutRef.current = null;
            }
            stableTimeoutRef.current = setTimeout(() => {
              setConnectionStatus((prev) =>
                prev === "offline" ? "offline" : "stable"
              );
              stableTimeoutRef.current = null;
            }, CHANGE_STABLE_MS);
            if (val2 > prevDollar) {
              setBlinkDollarDir("up");
              if (blinkTimeoutDollarRef.current)
                clearTimeout(blinkTimeoutDollarRef.current);
              blinkTimeoutDollarRef.current = setTimeout(
                () => setBlinkDollarDir(null),
                BLINK_MS
              );
            } else if (val2 < prevDollar) {
              setBlinkDollarDir("down");
              if (blinkTimeoutDollarRef.current)
                clearTimeout(blinkTimeoutDollarRef.current);
              blinkTimeoutDollarRef.current = setTimeout(
                () => setBlinkDollarDir(null),
                BLINK_MS
              );
            }
          }
          prevDollarRef.current = Number.isFinite(val2)
            ? val2
            : prevDollarRef.current;
          setDollarRate(val2);
          return;
        }
      } catch (e) {
        setDollarRate(null);
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      setDollarRate(null);
    }
  }


  // makingNumber
  const makingNumber = (function () {
    const n = Number(makingVal);
    if (Number.isFinite(n) && n >= 0) return n;
    return 5250;
  })();

  // build derived table values (unchanged)
  function buildTable(base) {
    if (!base || !Number.isFinite(base)) return null;
    const b = Number(base);
    const row24 = b;
    const row22 = (row24 + makingNumber) / 1.1;
    const row20 = row24 / 1.1;
    const row18 = (0.95 * row24) / 1.1;
    const row16 = (0.85 * row24) / 1.1;

    const rows = [
      { carat: "24K", rate: row24 },
      { carat: "22K", rate: row22 },
      { carat: "20K", rate: row20 },
      { carat: "18K", rate: row18 },
      { carat: "16K", rate: row16 },
    ];

    return rows.map((r) => ({ ...r, ratePer10: r.rate / 10 }));
  }


  // derived rates
  const rate22K10gm = rate ? (rate + makingNumber) / 1.1 : null;
  const rate20K10gm = rate ? rate / 1.1 : null;
  const rate18K10gm = rate ? (0.95 * rate) / 1.1 : null;
  const rate16K10gm = rate ? (0.85 * rate) / 1.1 : null;
  const goldcoin = Number.isFinite(rate) ? rate / 10 + 100 : null;

  // format utilities (unchanged)
  function fmtInt(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return "—";
    const n = Math.round(Number(val));
    return n.toLocaleString("en-IN");
  }
  function fmtDecimal(val, decimals = 2) {
    if (val === null || val === undefined || Number.isNaN(val)) return "—";
    const n = Number(val);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  const tableRows = buildTable(rate);

  // applyRefresh unchanged
  function applyRefresh() {
    let v = Number(refreshVal);
    if (!Number.isFinite(v) || v <= 0) {
      v = defaultRefreshSeconds ?? 5;
      setRefreshVal("");
      setRefreshUnit("seconds");
      localStorage.removeItem(LS_REFRESH_VAL_KEY);
      localStorage.removeItem(LS_REFRESH_UNIT_KEY);
    } else {
      localStorage.setItem(LS_REFRESH_VAL_KEY, String(refreshVal));
      localStorage.setItem(LS_REFRESH_UNIT_KEY, refreshUnit);
    }
    const ms = refreshUnit === "minutes" ? v * 60_000 : v * 1000;
    setRefreshMs(ms);
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();
    clearSchedules();
    fetchRate(controllerRef.current.signal, ms);
  }

  // mount (unchanged aside from blink refs initialization + cleanup of stableTimeout)
  useEffect(() => {
    try {
      const storedMaking = localStorage.getItem(LS_MAKING_KEY);
      if (storedMaking !== null) {
        const parsed = Number(storedMaking);
        if (Number.isFinite(parsed) && parsed >= 0) {
          setMakingVal(String(parsed));
        } else {
          localStorage.removeItem(LS_MAKING_KEY);
          setMakingVal("");
        }
      }

      const sv = localStorage.getItem(LS_REFRESH_VAL_KEY);
      const su = localStorage.getItem(LS_REFRESH_UNIT_KEY);
      let initialMs = (defaultRefreshSeconds ?? 5) * 1000;
      if (sv !== null) {
        const parsed = Number(sv);
        const unit = su || "seconds";
        if (Number.isFinite(parsed) && parsed > 0) {
          setRefreshVal(String(sv));
          setRefreshUnit(unit);
          initialMs = unit === "minutes" ? parsed * 60_000 : parsed * 1000;
          setRefreshMs(initialMs);
        }
      }

      const raw = localStorage.getItem(LS_CHART_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          const valid = parsed
            .filter(
              (p) => p && typeof p.ts === "number" && Number.isFinite(p.rate)
            )
            .map((p) => ({
              time: p.time || new Date(p.ts).toLocaleTimeString(),
              rate: Number(p.rate),
              ts: Number(p.ts),
            }));
          setChartData((prev) => {
            const merged = [...(valid || []), ...(prev || [])];
            const byTs = Array.from(
              new Map(merged.map((x) => [x.ts, x])).values()
            ).sort((a, b) => a.ts - b.ts);
            return byTs.slice(Math.max(0, byTs.length - MAX_POINTS));
          });
        }
      }

      // ---------- RESTORE: last quick-cached rate so UI shows immediate value ----------
      try {
        const lastRaw = localStorage.getItem(LS_LAST_RATE_KEY);
        if (lastRaw) {
          const parsed = JSON.parse(lastRaw);
          if (parsed && Number.isFinite(parsed.rate)) {
            // show the cached rate immediately (may be slightly stale)
            setRate(Number(parsed.rate));
            previousRateRef.current = Number(parsed.rate);
            // restore timestamp if available, else use now
            setLastUpdate(parsed.ts ? new Date(Number(parsed.ts)) : new Date());
            // mark initialized so fetchRate won't set loading=true on first fetch
            setInitialized(true);
            setLoading(false);
          }
        }
      } catch (e) {
        // ignore any parse/storage errors
      }

      controllerRef.current = new AbortController();
      fetchRate(controllerRef.current.signal, initialMs);

      dollarControllerRef.current = new AbortController();
      fetchDollar(dollarControllerRef.current.signal);
      if (dollarIntervalRef.current) clearInterval(dollarIntervalRef.current);
      dollarIntervalRef.current = setInterval(() => {
        if (dollarControllerRef.current) dollarControllerRef.current.abort();
        dollarControllerRef.current = new AbortController();
        fetchDollar(dollarControllerRef.current.signal);
      }, DOLLAR_POLL_MS);

      return () => {
        if (controllerRef.current) controllerRef.current.abort();
        clearSchedules();

        if (dollarControllerRef.current) dollarControllerRef.current.abort();
        if (dollarIntervalRef.current) {
          clearInterval(dollarIntervalRef.current);
          dollarIntervalRef.current = null;
        }

        if (liveTimeoutRef.current) {
          clearTimeout(liveTimeoutRef.current);
          liveTimeoutRef.current = null;
        }
        if (stalenessIntervalRef.current) {
          clearInterval(stalenessIntervalRef.current);
          stalenessIntervalRef.current = null;
        }

        // clear blink timers
        if (blinkTimeoutRateRef.current)
          clearTimeout(blinkTimeoutRateRef.current);
        if (blinkTimeout22Ref.current) clearTimeout(blinkTimeout22Ref.current);
        if (blinkTimeout20Ref.current) clearTimeout(blinkTimeout20Ref.current);
        if (blinkTimeout18Ref.current) clearTimeout(blinkTimeout18Ref.current);
        if (blinkTimeout16Ref.current) clearTimeout(blinkTimeout16Ref.current);

        if (blinkTimeoutSilverRef.current)
          clearTimeout(blinkTimeoutSilverRef.current);
        if (blinkTimeoutSpotRef.current)
          clearTimeout(blinkTimeoutSpotRef.current);

        if (blinkTimeoutGoldCoinRef.current)
          clearTimeout(blinkTimeoutGoldCoinRef.current);
        if (blinkTimeoutDollarRef.current)
          clearTimeout(blinkTimeoutDollarRef.current);

        // clear stable timeout
        if (stableTimeoutRef.current) {
          clearTimeout(stableTimeoutRef.current);
          stableTimeoutRef.current = null;
        }
      };
    } catch (e) {
      controllerRef.current = new AbortController();
      fetchRate(controllerRef.current.signal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // if refreshMs changes externally (unchanged)
  useEffect(() => {
    if (!lastUpdate) return;
    clearSchedules();
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();
    fetchRate(controllerRef.current.signal);
  }, [refreshMs]);

  // staleness checker (reworked): decide Offline vs Live vs Stable
  useEffect(() => {
    if (stalenessIntervalRef.current) {
      clearInterval(stalenessIntervalRef.current);
      stalenessIntervalRef.current = null;
    }

    stalenessIntervalRef.current = setInterval(() => {
      if (!lastUpdate) return;
      const age = Date.now() - lastUpdate.getTime();
      const offlineThreshold = Math.max(refreshMs * 2, 30000);
      // if no recent successful fetch => offline
      if (age > offlineThreshold) {
        setConnectionStatus("offline");
        return;
      }

      // If there was a change within CHANGE_STABLE_MS -> live
      const lastCh = lastChangeRef.current;
      if (lastCh && Date.now() - lastCh <= CHANGE_STABLE_MS) {
        setConnectionStatus("live");
      } else {
        // if no changes within the hour -> stable
        setConnectionStatus((prev) =>
          prev === "offline" ? "offline" : "stable"
        );
      }
    }, 2000);

    return () => {
      if (stalenessIntervalRef.current) {
        clearInterval(stalenessIntervalRef.current);
        stalenessIntervalRef.current = null;
      }
    };
  }, [lastUpdate, refreshMs]);

  // persist makingVal unchanged
  useEffect(() => {
    try {
      const trimmed = (makingVal ?? "").toString().trim();
      if (trimmed === "") {
        localStorage.removeItem(LS_MAKING_KEY);
        return;
      }
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) {
        localStorage.setItem(LS_MAKING_KEY, String(n));
        if (String(n) !== makingVal) {
          setMakingVal(String(n));
        }
      } else {
        localStorage.removeItem(LS_MAKING_KEY);
      }
    } catch (e) {}
  }, [makingVal]);

  // persist chartData unchanged
  useEffect(() => {
    try {
      if (!chartData || chartData.length === 0) return;
      const toStore = compressForStorage(
        chartData.map((p) => ({ ts: p.ts, rate: p.rate, time: p.time }))
      );
      localStorage.setItem(LS_CHART_KEY, JSON.stringify(toStore));
    } catch (e) {}
  }, [chartData]);

  // ---------- Small presentational subcomponents ----------
  const RightCard = ({ children }) => (
    <div className="w-full max-w-xl md:max-w-lg bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 rounded-2xl p-3 shadow-lg ring-1 ring-amber-900/30">
      <div className="bg-white/95 rounded-xl p-4 flex flex-col items-center justify-center min-h-[113px]">
        {children}
      </div>
    </div>
  );

  const RightSingleStack = ({
    title = "",
    bigValue = null,
    loading = false,
    blink = null,
  }) => {
    // treat as loading only if value is not a finite number
    const isLoading = !Number.isFinite(bigValue);
    const blinkClass =
      blink === "up" ? "blink-up" : blink === "down" ? "blink-down" : "";
    return (
      <div className="w-full flex items-center justify-center">
        <RightCard>
          <div className="w-full flex flex-col items-center">
            <div className="text-xl text-gray-800 font-bold">{title}</div>
            <div className="mt-2 text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm">
              {isLoading ? (
                "—"
              ) : (
                <span className={blinkClass}>{fmtInt(bigValue)}</span>
              )}
            </div>
          </div>
        </RightCard>
      </div>
    );
  };

  const RightDualStack = ({
    topTitle = "",
    topValue = null,
    bottomTitle = "",
    bottomValue = null,
    loading = false,
  }) => (
    <div className="md:col-span-1 flex items-center justify-center">
      <div className="w-full max-w-xs space-y-3">
        <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-300 rounded-2xl p-3 shadow ring-1 ring-amber-900/30">
          <div className="bg-white/95 rounded-lg p-3 flex flex-col items-center justify-center">
            <div className="text-xs text-gray-800 font-semibold">
              {topTitle}
            </div>
            <div className="mt-2 text-3xl md:text-4xl font-extrabold text-rose-900">
              {loading ? "—" : fmtInt(topValue)}
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-2xl p-3 shadow ring-1 ring-amber-900/20">
          <div className="bg-white/95 rounded-lg p-3 flex flex-col items-center justify-center">
            <div className="text-xs text-gray-800 font-semibold">
              {bottomTitle}
            </div>
            <div className="mt-2 text-2xl md:text-3xl font-bold text-rose-800">
              {loading ? "—" : fmtInt(bottomValue)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // RightVerticalSilver: show silver 1kg and 10gm & 1gm — add blink span to 1kg value
  const RightVerticalSilver = ({ loading = false, rate1kg = null }) => {
    const tenGm = rate1kg ? (rate1kg / 100) * 1.03 : null;
    const oneGm = rate1kg ? (rate1kg / 1000) * 1.03 : null;

    const silverBlinkClass =
      blinkSilverDir === "up"
        ? "blink-up"
        : blinkSilverDir === "down"
        ? "blink-down"
        : "";
    const isLoading = !Number.isFinite(rate1kg);

    return (
      <RightCard>
        <div className="w-full flex flex-col items-center">
          <div className="text-2xl text-gray-800 font-bold">Silver</div>

          <div className="mt-3 w-full space-y-6">
            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 ring-1 ring-amber-900/10">
              <div className="text-lg text-gray-800 font-bold">
                1 gm <span className="text-sm font-medium">(+GST 3%)</span>
              </div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {isLoading ? (
                  "—"
                ) : (
                  <span className={silverBlinkClass}>{fmtInt(oneGm)}</span>
                )}
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 ring-1 ring-amber-900/20">
              <div className="text-lg text-gray-800 font-bold">
                10 gm <span className="text-sm font-medium">(+GST 3%)</span>
              </div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {isLoading ? (
                  "—"
                ) : (
                  <span className={silverBlinkClass}>{fmtInt(tenGm)}</span>
                )}
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-300 via-amber-300 to-amber-200 rounded-lg p-3 shadow-inner ring-1 ring-amber-900/20">
              <div className="text-lg text-gray-800 font-bold">1 KG</div>
              <div className="mt-1 text-2xl md:text-3xl font-extrabold text-rose-900">
                {isLoading ? (
                  "—"
                ) : (
                  <span className={silverBlinkClass}>{fmtInt(rate1kg)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </RightCard>
    );
  };

  // RightHalf used by RightDoubleStack — add optional blink prop support
  const RightHalf = ({
    title = "",
    bigValue = null,
    loading = false,
    blink = null,
  }) => {
    // rely only on whether bigValue is a finite number
    const isLoading = !Number.isFinite(bigValue);
    const blinkClass =
      blink === "up" ? "blink-up" : blink === "down" ? "blink-down" : "";
    return (
      <div className="w-full flex flex-col items-center justify-center">
        <div className="text-xl text-gray-800 font-bold">{title}</div>
        <div className="mt-2 text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm">
          {isLoading ? (
            "—"
          ) : (
            <span className={blinkClass}>{fmtInt(bigValue)}</span>
          )}
        </div>
      </div>
    );
  };

  // RightDoubleStack: pass blink to left/right halves if provided
  const RightDoubleStack2 = ({ left = {}, right = {}, showDivider = true }) => {
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
  function StatusIndicator({ status }) {
    let dotClasses = "w-3 h-3 rounded-full inline-block mr-2 shrink-0";
    let label = "";
    if (status === "live") {
      dotClasses += " bg-emerald-400 animate-pulse";
      label = "Live";
    } else if (status === "stable") {
      dotClasses += " bg-amber-400";
      label = "Stable";
    } else if (status === "offline") {
      dotClasses += " bg-red-500";
      label = "Offline";
    } else {
      dotClasses += " bg-gray-400";
      label = "Connecting";
    }
    return (
      <div className="flex items-center text-xs text-amber-100/90">
        <span className={dotClasses} aria-hidden="true" />
        <span className="font-medium text-sm md:text-lg">{label}</span>
      </div>
    );
  }

  // compute blink classes for main rate and spot
  const mainRateBlinkClass =
    blinkRateDir === "up"
      ? "blink-up"
      : blinkRateDir === "down"
      ? "blink-down"
      : "";
  const spotBlink = blinkSpotDir; // passed to RightHalf

  return (
    <div className="min-h-screen bg-gray-500 text-amber-100 p-1 flex items-start justify-center">
      {/* Inline CSS for blink animations — only these classes are added; layout untouched */}
      <style>{`
        .blink-up {
          animation: blinkUp ${BLINK_MS}ms ease-in-out;
        }
        .blink-down {
          animation: blinkDown ${BLINK_MS}ms ease-in-out;
        }
        @keyframes blinkUp {
          0% { color: inherit; transform: none; }
          20% { color: #16a34a; transform: scale(1.04); }
          60% { color: #16a34a; transform: scale(1.02); }
          100% { color: inherit; transform: none; }
        }
        @keyframes blinkDown {
          0% { color: inherit; transform: none; }
          20% { color: #FF0000}
          60% { color: #FF0000}
          100% { color: inherit; transform: none; }
        }
      `}</style>

      <div className="w-full max-w-5xl">
        <div
          className="rounded-3xl overflow-hidden shadow-2xl"
          style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.6)" }}
        >
          <div
            className="px-6 py-3 flex items-center justify-between flex-wrap"
            style={{
              background:
                "linear-gradient(90deg, rgb(125, 0, 34), rgb(125, 0, 34), rgb(210, 25, 80))",
            }}
          >
            <div className="flex items-center gap-3 md:gap-6 flex-1 min-w-0">
              <div
                className="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-lg cursor-pointer overflow-hidden"
                onClick={() => setShowMaking((prev) => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowMaking((prev) => !prev);
                  }
                }}
                title="Toggle Making input"
                aria-pressed={showMaking}
              >
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt="logo"
                    className="w-full h-full object-contain max-w-full max-h-full"
                  />
                ) : (
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect
                      x="2"
                      y="2"
                      width="20"
                      height="20"
                      rx="4"
                      fill="#FFD97A"
                    />
                    <path
                      d="M6 12c1.5-3 6-3 7.5 0 1.5-3 6-3 7.5 0"
                      stroke="#8B2B0B"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              <div className="flex flex-col truncate">
                <div>
                  {shopImageSrc ? (
                    <img
                      src={shopImageSrc}
                      alt={shopName}
                      className="h-8 md:h-12 w-full max-w-[160px] md:max-w-[540px] object-contain"
                      style={{ maxWidth: "540px" }}
                    />
                  ) : (
                    <div className="text-xl md:text-2xl font-bold font-aparajita truncate ">
                      {shopName}
                    </div>
                  )}
                </div>

                <div>
                  {shopSalutation ? (
                    <img
                      src={shopSalutation}
                      alt={shopName}
                      className="h-5 md:h-6 w-full max-w-[240px] object-contain"
                      style={{ maxWidth: "240px" }}
                    />
                  ) : (
                    <div className="text-sm md:text-xl font-bold font-aparajita truncate ">
                      {shopName}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end md:items-center gap-1">
                <StatusIndicator status={connectionStatus} />
                <div className="text-xs text-amber-100/70 pl-2 md:pl-5">
                  Next in:{" "}
                  <span className="font-semibold text-amber-100">
                    {remaining}s
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 pt-4 bg-gradient-to-br from-gray-900 to-gray-800">
            <div className="grid grid-cols-1 md:grid-cols-3 items-start gap-4 max-w-full mx-1 mt-1">
              <div className="md:col-span-2 space-y-4">
                {/* 24K  */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        {" "}
                        <span className="font-bold text-2xl">24K</span> (99.5)
                        (1 gm)
                      </div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span className={mainRateBlinkClass}>
                              {fmtInt(rate / 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        10 gm
                      </div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            // only the number blinks
                            <span className={mainRateBlinkClass}>
                              {fmtInt(rate)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 22K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        {" "}
                        <span className="font-bold text-2xl">22K</span> (91.6)
                        (1 gm)
                      </div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink22Dir === "up"
                                  ? "blink-up"
                                  : blink22Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate22K10gm / 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        10 gm
                      </div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink22Dir === "up"
                                  ? "blink-up"
                                  : blink22Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate22K10gm)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 20K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        {" "}
                        <span className="font-bold text-2xl">20K</span> (83.3)
                        (1 gm)
                      </div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink20Dir === "up"
                                  ? "blink-up"
                                  : blink20Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate20K10gm / 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        10 gm
                      </div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink20Dir === "up"
                                  ? "blink-up"
                                  : blink20Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate20K10gm)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 18K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        {" "}
                        <span className="font-bold text-2xl">18K</span> (75.0)
                        (1 gm)
                      </div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink18Dir === "up"
                                  ? "blink-up"
                                  : blink18Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate18K10gm / 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        10 gm
                      </div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink18Dir === "up"
                                  ? "blink-up"
                                  : blink18Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate18K10gm)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 16K */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-400 to-amber-400 rounded-2xl p-2.5 shadow-lg ring-1 ring-amber-900/30">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-2 px-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        {" "}
                        <span className="font-bold text-2xl">16K</span> (66.7)
                        (1 gm)
                      </div>
                      <div className="mt-1">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink16Dir === "up"
                                  ? "blink-up"
                                  : blink16Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate16K10gm / 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/2 bg-white/95 rounded-xl p-3 flex flex-col justify-center min-h-14 md:min-h-20">
                      <div className="text-md text-gray-800 font-semibold leading-tight">
                        10 gm
                      </div>
                      <div className="mt-2">
                        <div className="text-4xl md:text-5xl font-extrabold text-rose-900 drop-shadow-sm leading-tight">
                          {loading ? (
                            "—"
                          ) : (
                            <span
                              className={
                                blink16Dir === "up"
                                  ? "blink-up"
                                  : blink16Dir === "down"
                                  ? "blink-down"
                                  : ""
                              }
                            >
                              {fmtInt(rate16K10gm)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT */}
              <div className="md:col-span-1 flex flex-col items-center justify-start gap-3.5">
                <RightVerticalSilver loading={loading} rate1kg={silverRate} />
                <RightSingleStack
                  title="Gold Coin"
                  bigValue={goldcoin}
                  loading={loading}
                  blink={blinkGoldCoinDir}
                />
                <RightDoubleStack2
                  left={{
                    title: "Spot Gold",
                    bigValue: spotGoldRate,
                    loading: !Number.isFinite(spotGoldRate),
                    blink: blinkSpotDir,
                  }}
                  right={{
                    title: "Dollar",
                    bigValue: dollarRate,
                    loading: !Number.isFinite(dollarRate),
                    blink: blinkDollarDir,
                  }}
                  showDivider={true}
                />
              </div>
            </div>

            <JewelleryPricingTable makingVal={makingVal} />

            {/* Chart */}
            <div className="mt-6 bg-gray-900/60 border border-amber-800 rounded-2xl p-4 shadow-lg">
              <div className="text-amber-200 font-bold mb-3 flex items-center justify-between">
                <div>
                  Live Gold Rate Plotting (last {displayedData.length} points)
                </div>
                <div className="flex items-center gap-2">
                  {["1D", "1M", "1Y", "ALL"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setSelectedRange(r)}
                      className={
                        "text-xs px-2 py-1 rounded-md font-semibold " +
                        (selectedRange === r
                          ? "bg-rose-600 text-white"
                          : "bg-gray-800/40 text-amber-200/80")
                      }
                      aria-pressed={selectedRange === r}
                    >
                      {r === "ALL" ? "All" : r}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={displayedData}
                    margin={{ top: 6, right: 12, left: 0, bottom: 6 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" minTickGap={20} />
                    <YAxis
                      domain={[
                        (dataMin) =>
                          dataMin ? Math.floor(dataMin * 0.995) : "auto",
                        (dataMax) =>
                          dataMax ? Math.ceil(dataMax * 1.005) : "auto",
                      ]}
                    />
                    <Tooltip
                      formatter={(value) => [fmtInt(value), "Rate"]}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="#ff6b6b"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Table card */}
            <div className="mt-6 bg-gray-900/60 border border-amber-800 rounded-2xl p-4 shadow-lg">
              <div className="overflow-x-auto rounded-sm">
                <table className="w-full table-auto text-md font-semibold border-collapse border border-amber-700">
                  <thead>
                    <tr className="text-left text-lg bg-gray-900/60">
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">
                        Carat
                      </th>
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">
                        Rate of 10 gm
                      </th>
                      <th className="px-4 py-3 text-amber-300 font-bold border-b border-amber-700">
                        Rate of 1 gm
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows
                      ? tableRows.map((r) => (
                          <tr
                            key={r.carat}
                            className="hover:bg-gray-800/60 transition-colors"
                          >
                            <td className="px-4 py-3 font-medium text-amber-100 border-b border-amber-800">
                              {r.carat}
                            </td>
                            <td className="px-4 py-3 text-amber-50 border-b border-amber-800">
                              {fmtInt(r.rate)}
                            </td>
                            <td className="px-4 py-3 text-amber-200 border-b border-amber-800">
                              {fmtInt(r.ratePer10)}
                            </td>
                          </tr>
                        ))
                      : ["24K", "22K", "20K", "18K", "16K"].map((k) => (
                          <tr key={k} className="animate-pulse">
                            <td className="px-4 py-3 bg-gray-800/40 rounded-md">
                              {k}
                            </td>
                            <td className="px-4 py-3 bg-gray-800/40">&nbsp;</td>
                            <td className="px-4 py-3 bg-gray-800/40">&nbsp;</td>
                          </tr>
                        ))}
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
                  onChange={(e) => setRefreshVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyRefresh();
                    }
                  }}
                  className="w-16 text-right text-sm px-2 py-1 rounded-md bg-gray-950 border border-amber-800 text-amber-100"
                  placeholder={String(defaultRefreshSeconds)}
                  inputMode="numeric"
                />
                <select
                  value={refreshUnit}
                  onChange={(e) => setRefreshUnit(e.target.value)}
                  className="text-sm px-2 py-1 rounded-md bg-gray-950 border border-amber-800 text-amber-100"
                >
                  <option value="seconds">sec</option>
                  <option value="minutes">min</option>
                </select>
                <button
                  onClick={applyRefresh}
                  className="ml-2 bg-rose-600 hover:bg-rose-700 text-white text-sm px-3 py-1 rounded-md shadow"
                >
                  Apply
                </button>
              </div>

              {showMaking && (
                <div className="flex items-center gap-2 w-full md:w-auto justify-end md:justify-center">
                  <label className="text-md font-semibold text-amber-200/80">
                    Making
                  </label>
                  <input
                    value={makingVal}
                    onChange={(e) => setMakingVal(e.target.value)}
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
  );
}
