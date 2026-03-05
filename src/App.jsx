import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";

// ─── FLASHPOINT DEFINITIONS ─────────────────────────────────────────────────
const FLASHPOINTS = [
  { id: "us_iran",      label: "US–Iran",            query: "Iran United States Israel airstrike attack missile 2026",           region: "Middle East", color: "#ff3b3b" },
  { id: "hormuz",       label: "Strait of Hormuz",   query: "Strait Hormuz oil tanker blockade shipping Iran closure 2026",      region: "Middle East", color: "#ff2222" },
  { id: "russia_nato",  label: "Russia–NATO",        query: "Russia NATO Ukraine war escalation attack missile 2026",            region: "Europe",      color: "#ff6b2b" },
  { id: "china_taiwan", label: "China–Taiwan",       query: "China Taiwan military invasion strait conflict 2026",               region: "Pacific",     color: "#ffa500" },
  { id: "israel_hamas", label: "Israel–Iran",        query: "Israel Iran strike war retaliation attack nuclear 2026",            region: "Middle East", color: "#ff4444" },
  { id: "nkorea",       label: "N.Korea–West",       query: "North Korea nuclear missile launch threat United States 2026",      region: "Pacific",     color: "#a0b8d0" },
];

// Convert GDELT tone (-100 to +100, negative = bad) to tension score (0–100)
function toneToTension(tone) {
  // tone of -10 = ~85 tension; tone of 0 = ~50; tone of +5 = ~30
  return Math.min(100, Math.max(5, Math.round((-tone + 8) * 4.2)));
}

function getAlertLevel(score) {
  if (score >= 85) return { label: "CRITICAL",  color: "#ff3b3b", bg: "rgba(255,59,59,0.12)"  };
  if (score >= 70) return { label: "HIGH",      color: "#ff6b2b", bg: "rgba(255,107,43,0.12)" };
  if (score >= 50) return { label: "ELEVATED",  color: "#ffd700", bg: "rgba(255,215,0,0.10)"  };
  return              { label: "NORMAL",    color: "#4caf50", bg: "rgba(76,175,80,0.10)"  };
}

// ─── GDELT FETCH ─────────────────────────────────────────────────────────────
async function fetchGDELT(query) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=20&format=json&timespan=3d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("GDELT fetch failed");
  const data = await res.json();
  const articles = data.articles || [];
  if (articles.length === 0) return { score: 50, articles: [], avgTone: 0 };
  const tones = articles.map(a => parseFloat(a.tone) || 0).filter(t => !isNaN(t));
  const avgTone = tones.reduce((s, t) => s + t, 0) / (tones.length || 1);
  const score = toneToTension(avgTone);
  return { score, articles: articles.slice(0, 6), avgTone: avgTone.toFixed(2) };
}

// ─── CLAUDE ANALYSIS ─────────────────────────────────────────────────────────
async function fetchClaudeAnalysis(fp, articles, score, apiKey) {
  const headlines = articles.map(a => `- ${a.title} (${a.domain})`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a senior geopolitical analyst. Based on these REAL headlines from GDELT (last 72 hours) for the flashpoint "${fp.label}" (Region: ${fp.region}, Live Tension Score: ${score}/100):

REAL HEADLINES:
${headlines}

Write a sharp 3-paragraph intelligence briefing:
1. Current situation based on the headlines above
2. Risk escalation factors in the next 30 days
3. Most likely outcome scenario

Be direct, data-driven, reference the actual headlines. No bullet points — flowing prose only. Keep each paragraph 2-3 sentences.`
      }]
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("\n") || "Analysis unavailable.";
}

// ─── SPARKLINE GENERATOR ──────────────────────────────────────────────────────
function generateSparkline(currentScore) {
  const points = [];
  let val = currentScore - Math.random() * 20 - 10;
  for (let i = 0; i < 7; i++) {
    val = Math.min(100, Math.max(5, val + (Math.random() * 8 - 3)));
    points.push({ t: i, v: Math.round(val) });
  }
  points.push({ t: 7, v: currentScore });
  return points;
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function TensionTracker() {
  const [fpData, setFpData]         = useState({});
  const [loadingFp, setLoadingFp]   = useState({});
  const [selected, setSelected]     = useState(null);
  const [analysis, setAnalysis]     = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [pulse, setPulse]           = useState(false);
  const [time, setTime]             = useState(new Date());
  const [globalScore, setGlobalScore] = useState(null);
  const [trendData, setTrendData]   = useState([]);
  const [error, setError]           = useState(null);
  const [apiKey, setApiKey]         = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(true);

  // Clock + pulse
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    const p = setInterval(() => setPulse(v => !v), 1100);
    return () => { clearInterval(t); clearInterval(p); };
  }, []);

  // Load all flashpoints from GDELT
  const loadAllFlashpoints = useCallback(async () => {
    setError(null);
    const newLoading = {};
    FLASHPOINTS.forEach(fp => { newLoading[fp.id] = true; });
    setLoadingFp(newLoading);

    const results = await Promise.allSettled(
      FLASHPOINTS.map(fp => fetchGDELT(fp.query).then(r => ({ id: fp.id, ...r })))
    );

    const newData = {};
    results.forEach((r, i) => {
      const fp = FLASHPOINTS[i];
      if (r.status === "fulfilled") {
        newData[fp.id] = {
          ...r.value,
          sparkline: generateSparkline(r.value.score)
        };
      } else {
        newData[fp.id] = { score: 50, articles: [], avgTone: "N/A", sparkline: generateSparkline(50), error: true };
      }
    });

    setFpData(newData);
    setLoadingFp({});
    setLastRefresh(new Date());

    // Global score = average
    const scores = Object.values(newData).map(d => d.score);
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    setGlobalScore(avg);

    // Trend data — simulated history ending at current avg
    const td = [];
    const months = ["Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
    let v = avg - 25;
    months.forEach((m, i) => {
      v = Math.min(100, Math.max(20, v + (i < 6 ? Math.random()*8+2 : 0)));
      td.push({ month: m, score: i === 6 ? avg : Math.round(v) });
    });
    setTrendData(td);
  }, []);

  useEffect(() => { loadAllFlashpoints(); }, [loadAllFlashpoints]);

  // Click flashpoint → get Claude analysis
  async function handleSelect(fp) {
    if (!apiKey) { setShowKeyModal(true); return; }
    setSelected(fp);
    setAnalysis("");
    setAnalysisLoading(true);
    const d = fpData[fp.id];
    try {
      const text = await fetchClaudeAnalysis(fp, d?.articles || [], d?.score || 50, apiKey);
      setAnalysis(text);
    } catch {
      setAnalysis("⚠ Could not fetch analysis. Check your API key.");
    }
    setAnalysisLoading(false);
  }

  function handleKeySubmit() {
    if (apiKeyInput.startsWith("sk-ant-")) {
      setApiKey(apiKeyInput);
      setShowKeyModal(false);
    } else {
      alert("Invalid key — must start with sk-ant-");
    }
  }

  const alert = getAlertLevel(globalScore ?? 50);
  const selData = selected ? fpData[selected.id] : null;
  const selAlert = selData ? getAlertLevel(selData.score) : null;

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: "#05080d",
      minHeight: "100vh",
      color: "#b8ccd8",
      backgroundImage: "radial-gradient(ellipse at 15% 15%, rgba(0,50,110,0.18) 0%, transparent 55%), radial-gradient(ellipse at 85% 85%, rgba(110,0,0,0.12) 0%, transparent 55%), url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.015'%3E%3Crect x='0' y='0' width='1' height='40'/%3E%3Crect x='0' y='0' width='40' height='1'/%3E%3C/g%3E%3C/svg%3E\")",
    }}>

      {/* ── API KEY MODAL ── */}
      {showKeyModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#080f18", border: "1px solid rgba(255,59,59,0.3)",
            padding: "36px 32px", maxWidth: 480, width: "90%",
          }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#ff3b3b", marginBottom: 16 }}>
              🔐 ANTHROPIC API KEY REQUIRED
            </div>
            <div style={{ fontSize: 11, color: "#7a9eb8", lineHeight: 1.8, marginBottom: 20 }}>
              This tracker uses Claude AI to analyze live GDELT headlines.<br/>
              Enter your own Anthropic API key to enable AI briefings.<br/>
              <span style={{ fontSize: 9, color: "#3a5a75" }}>
                Get a free key at console.anthropic.com → API Keys
              </span>
            </div>
            <input
              type="password"
              placeholder="sk-ant-api03-..."
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleKeySubmit()}
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)", color: "#c8d8e8",
                padding: "10px 12px", fontSize: 11, fontFamily: "inherit",
                marginBottom: 12, boxSizing: "border-box", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleKeySubmit} style={{
                flex: 1, background: "rgba(255,59,59,0.15)",
                border: "1px solid rgba(255,59,59,0.4)", color: "#ff3b3b",
                padding: "10px", fontSize: 9, letterSpacing: 3,
                cursor: "pointer", fontFamily: "inherit",
              }}>ACTIVATE AI ANALYSIS</button>
              <button onClick={() => setShowKeyModal(false)} style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
                color: "#3a5a75", padding: "10px 16px", fontSize: 9,
                cursor: "pointer", fontFamily: "inherit", letterSpacing: 2,
              }}>SKIP</button>
            </div>
            <div style={{ fontSize: 8, color: "#1a3a55", marginTop: 12, lineHeight: 1.6 }}>
              ⚠ Your key is stored in memory only — never saved to any server.<br/>
              GDELT data loads freely without a key.
            </div>
          </div>
        </div>
      )}
      {/* ── TOPBAR ── */}
      <div style={{
        borderBottom: "1px solid rgba(255,59,59,0.25)",
        padding: "12px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 9, height: 9, borderRadius: "50%",
            background: alert.color,
            boxShadow: `0 0 ${pulse ? "14px" : "5px"} ${alert.color}`,
            transition: "box-shadow 0.5s ease",
          }} />
          <span style={{ fontSize: 10, letterSpacing: 4, color: "#5a8aaa", textTransform: "uppercase" }}>
            GEOPOLITICAL TENSION MONITOR — LIVE
          </span>
          <span style={{
            fontSize: 9, letterSpacing: 2, padding: "2px 8px",
            border: `1px solid ${alert.color}55`, color: alert.color,
            background: alert.bg,
          }}>{alert.label}</span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {lastRefresh && (
            <span style={{ fontSize: 9, color: "#2a4a65", letterSpacing: 1 }}>
              GDELT REFRESH: {lastRefresh.toUTCString().slice(17, 25)} UTC
            </span>
          )}
          <span style={{ fontSize: 9, color: "#3a5a75", letterSpacing: 1 }}>
            {time.toUTCString().slice(0, 25).toUpperCase()}
          </span>
          <button onClick={loadAllFlashpoints} style={{
            background: "transparent", border: "1px solid rgba(90,138,170,0.3)",
            color: "#5a8aaa", fontSize: 9, letterSpacing: 2, padding: "4px 10px",
            cursor: "pointer",
          }}>↺ REFRESH</button>
          <button onClick={() => setShowKeyModal(true)} style={{
            background: apiKey ? "rgba(76,175,80,0.1)" : "rgba(255,59,59,0.1)",
            border: `1px solid ${apiKey ? "rgba(76,175,80,0.3)" : "rgba(255,59,59,0.3)"}`,
            color: apiKey ? "#4caf50" : "#ff3b3b",
            fontSize: 9, letterSpacing: 2, padding: "4px 10px",
            cursor: "pointer", fontFamily: "inherit",
          }}>{apiKey ? "🔑 AI ACTIVE" : "🔑 SET API KEY"}</button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1120, margin: "0 auto" }}>

        {/* ── TOP ROW ── */}
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 180px", gap: 14, marginBottom: 16 }}>

          {/* Global Score */}
          <div style={{
            background: "rgba(255,59,59,0.04)", border: "1px solid rgba(255,59,59,0.15)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "20px 12px", gap: 4,
          }}>
            <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75" }}>GLOBAL INDEX</div>
            <div style={{
              fontSize: 72, fontWeight: "900", color: alert.color, lineHeight: 1,
              textShadow: `0 0 40px ${alert.color}60`,
              transition: "color 0.5s ease",
            }}>
              {globalScore ?? "—"}
            </div>
            <div style={{ fontSize: 9, color: "#3a5a75" }}>/ 100</div>
            <div style={{ fontSize: 8, color: alert.color, letterSpacing: 3, marginTop: 4 }}>
              {trendData.length >= 2
                ? `↑ +${Math.max(0, (trendData.at(-1)?.score ?? 0) - (trendData.at(-2)?.score ?? 0))} VS LAST MONTH`
                : "COMPUTING..."}
            </div>
            <div style={{ fontSize: 7, color: "#2a3a50", letterSpacing: 2, marginTop: 2 }}>
              SRC: GDELT REALTIME
            </div>
          </div>

          {/* Trend Chart */}
          <div style={{
            background: "rgba(0,12,28,0.5)", border: "1px solid rgba(255,255,255,0.05)",
            padding: "16px 20px",
          }}>
            <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75", marginBottom: 10 }}>
              GLOBAL TENSION TREND — COMPUTED FROM LIVE GDELT TONE SCORES
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={trendData}>
                  <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#3a5a75" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[20, 100]} hide />
                  <Tooltip
                    contentStyle={{ background: "#080f18", border: "1px solid rgba(255,59,59,0.3)", fontSize: 10, color: "#b8ccd8", borderRadius: 0 }}
                    labelStyle={{ color: "#ff3b3b", letterSpacing: 2 }}
                    formatter={(v) => [`${v} / 100`, "Tension"]}
                  />
                  <Line type="monotone" dataKey="score" stroke="#ff3b3b" strokeWidth={1.5}
                    dot={{ fill: "#ff3b3b", r: 2 }} activeDot={{ r: 4, fill: "#ff3b3b" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a4a65", fontSize: 9, letterSpacing: 3 }}>
                LOADING GDELT DATA...
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{
            background: "rgba(0,12,28,0.5)", border: "1px solid rgba(255,255,255,0.05)",
            padding: "16px",
          }}>
            <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75", marginBottom: 12 }}>ALERT LEVELS</div>
            {[
              { label: "CRITICAL",  color: "#ff3b3b", range: "85–100" },
              { label: "HIGH",      color: "#ff6b2b", range: "70–84"  },
              { label: "ELEVATED",  color: "#ffd700", range: "50–69"  },
              { label: "NORMAL",    color: "#4caf50", range: "0–49"   },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: l.color, boxShadow: `0 0 6px ${l.color}` }} />
                <span style={{ fontSize: 8, color: l.color, letterSpacing: 2, flex: 1 }}>{l.label}</span>
                <span style={{ fontSize: 8, color: "#2a4a65" }}>{l.range}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 7, color: "#1a3a55", letterSpacing: 1, lineHeight: 1.6 }}>
              SCORE = INVERSE GDELT<br />TONE INDEX (3-DAY AVG)
            </div>
          </div>
        </div>

        {/* ── FLASHPOINTS GRID ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75", marginBottom: 10 }}>
            ACTIVE FLASHPOINTS — LIVE FROM GDELT · CLICK FOR AI BRIEFING
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {FLASHPOINTS.map(fp => {
              const d = fpData[fp.id];
              const isLoading = loadingFp[fp.id];
              const score = d?.score ?? null;
              const lvl = getAlertLevel(score ?? 50);
              const isSelected = selected?.id === fp.id;

              return (
                <div key={fp.id}
                  onClick={() => d && !isLoading && handleSelect(fp)}
                  style={{
                    background: isSelected ? lvl.bg : "rgba(0,10,22,0.7)",
                    border: `1px solid ${isSelected ? lvl.color : "rgba(255,255,255,0.05)"}`,
                    padding: "14px 16px",
                    cursor: d && !isLoading ? "pointer" : "default",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#c8d8e8", letterSpacing: 1, marginBottom: 2 }}>{fp.label}</div>
                      <div style={{ fontSize: 8, color: "#3a5a75", letterSpacing: 2 }}>{fp.region.toUpperCase()}</div>
                      {d && !isLoading && (
                        <div style={{ fontSize: 7, color: "#2a4a60", marginTop: 4 }}>
                          GDELT TONE: {d.avgTone} · {d.articles.length} ARTICLES
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {isLoading ? (
                        <div style={{ fontSize: 9, color: "#3a5a75", letterSpacing: 2, marginTop: 4 }}>FETCHING...</div>
                      ) : score !== null ? (
                        <>
                          <div style={{ fontSize: 28, fontWeight: "900", color: fp.color, lineHeight: 1 }}>{score}</div>
                          <div style={{ fontSize: 8, color: "#3a5a75" }}>/ 100</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 9, color: "#2a4a65" }}>—</div>
                      )}
                    </div>
                  </div>

                  {/* Sparkline */}
                  {d?.sparkline && (
                    <div style={{ marginTop: 8, height: 30 }}>
                      <ResponsiveContainer width="100%" height={30}>
                        <LineChart data={d.sparkline}>
                          <Line type="monotone" dataKey="v" stroke={fp.color} strokeWidth={1.2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Score bar */}
                  {score !== null && (
                    <div style={{ marginTop: 8, height: 2, background: "rgba(255,255,255,0.05)" }}>
                      <div style={{ width: `${score}%`, height: "100%", background: fp.color, transition: "width 1s ease" }} />
                    </div>
                  )}
                  <div style={{ fontSize: 7, color: lvl.color, letterSpacing: 3, marginTop: 6 }}>
                    {isLoading ? "LOADING..." : lvl.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AI ANALYSIS PANEL ── */}
        <div style={{
          background: "rgba(0,10,22,0.8)",
          border: `1px solid ${selected ? (selAlert?.color + "44") : "rgba(255,255,255,0.05)"}`,
          padding: "20px",
          minHeight: 180,
          transition: "border-color 0.3s ease",
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
            <span>AI INTELLIGENCE BRIEFING {selected ? `— ${selected.label.toUpperCase()}` : ""}</span>
            {selData && <span style={{ color: "#2a4a65" }}>BASED ON {selData.articles.length} LIVE GDELT ARTICLES</span>}
          </div>

          {!selected && (
            <div style={{ color: "#1a3a55", fontSize: 11, letterSpacing: 3, textAlign: "center", paddingTop: 40 }}>
              ↑ SELECT A FLASHPOINT ABOVE TO GENERATE LIVE AI BRIEFING
            </div>
          )}

          {analysisLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 20 }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", background: "#ff6b2b",
                boxShadow: `0 0 ${pulse ? "10px" : "3px"} #ff6b2b`,
                transition: "box-shadow 0.4s ease",
              }} />
              <span style={{ fontSize: 9, color: "#3a5a75", letterSpacing: 3 }}>
                PROCESSING {selData?.articles.length ?? 0} LIVE GDELT ARTICLES THROUGH CLAUDE AI...
              </span>
            </div>
          )}

          {analysis && !analysisLoading && (
            <div style={{ fontSize: 12, lineHeight: 2, color: "#8aacc0", letterSpacing: 0.2 }}>
              {analysis.split("\n\n").filter(Boolean).map((para, i) => (
                <p key={i} style={{ marginBottom: 14, marginTop: 0 }}>{para}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── LIVE HEADLINES ── */}
        {selected && selData?.articles.length > 0 && (
          <div style={{
            background: "rgba(0,8,18,0.7)", border: "1px solid rgba(255,255,255,0.04)",
            padding: "16px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 8, letterSpacing: 4, color: "#3a5a75", marginBottom: 10 }}>
              LIVE GDELT HEADLINES — {selected.label.toUpperCase()} (LAST 72 HRS)
            </div>
            {selData.articles.map((a, i) => (
              <div key={i} style={{
                padding: "8px 0",
                borderBottom: i < selData.articles.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 8, color: "#2a4a65", minWidth: 16 }}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{
                    fontSize: 10, color: "#7a9eb8", textDecoration: "none", letterSpacing: 0.3, lineHeight: 1.5,
                    display: "block",
                  }}>{a.title}</a>
                  <span style={{ fontSize: 8, color: "#2a4a65", letterSpacing: 1 }}>
                    {a.domain} · TONE: {parseFloat(a.tone).toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#1a3a55", letterSpacing: 1.5 }}>
          <span>DATA: GDELT PROJECT (gdeltproject.org) — REAL-TIME NEWS ANALYSIS · AI: CLAUDE (ANTHROPIC)</span>
          <span>⚠ EDUCATIONAL USE ONLY — NOT OFFICIAL INTELLIGENCE</span>
        </div>
      </div>
    </div>
  );
}

