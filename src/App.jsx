import { useState, useEffect, useCallback } from "react";

const todayStr = () => new Date().toISOString().split("T")[0];
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(y, m - 1).toLocaleString("id-ID", { month: "long", year: "numeric" });
};

const GAS_URL_KEY = "stokharian_gas_v4";

// ── Fetch GAS via URL params (GET) ─────────────────────────
// Google Apps Script /exec supports fetch from browser dengan
// mode: "cors" — tapi hanya kalau response header diset.
// Karena GAS tidak bisa set Access-Control-Allow-Origin,
// kita pakai workaround: fetch as "no-cors" untuk POST (fire-and-forget),
// dan untuk GET kita pakai fetch normal karena GAS /exec
// sebenarnya mengembalikan CORS header untuk GET requests.
async function gasGet(url, params) {
  const fullUrl = url + "?" + new URLSearchParams(params).toString();
  const res = await fetch(fullUrl, {
    method: "GET",
    redirect: "follow",
  });
  const text = await res.text();
  return JSON.parse(text);
}

async function gasPost(url, body) {
  // Gunakan fetch dengan mode cors — GAS /exec handle POST
  const res = await fetch(url, {
    method: "POST",
    redirect: "follow",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return JSON.parse(text);
}

export default function App() {
  const [scriptUrl, setScriptUrl] = useState(() => localStorage.getItem(GAS_URL_KEY) || "");
  const [setupMode, setSetupMode] = useState(!localStorage.getItem(GAS_URL_KEY));
  const [tempUrl, setTempUrl] = useState("");
  const [pingStatus, setPingStatus] = useState("idle");
  const [pingError, setPingError] = useState("");

  const [tab, setTab] = useState("input");
  const [barang, setBarang] = useState([]);
  const [transaksi, setTransaksi] = useState([]);
  const [loadingBarang, setLoadingBarang] = useState(false);
  const [loadingTrx, setLoadingTrx] = useState(false);

  const [form, setForm] = useState({ itemId: "", jumlah: "", catatan: "", tanggal: todayStr() });
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveMsg, setSaveMsg] = useState("");

  const [rekapMonth, setRekapMonth] = useState(todayStr().slice(0, 7));

  // ── Loaders ───────────────────────────────────────────────
  const loadBarang = useCallback(async (url) => {
    const u = url || scriptUrl;
    if (!u) return;
    setLoadingBarang(true);
    try {
      const d = await gasGet(u, { action: "getBarang" });
      if (d.ok && d.barang) setBarang(d.barang);
      else console.error("getBarang:", d.error);
    } catch (e) { console.error("loadBarang:", e.message); }
    finally { setLoadingBarang(false); }
  }, [scriptUrl]);

  const loadTransaksi = useCallback(async (bulan, url) => {
    const u = url || scriptUrl;
    if (!u) return;
    setLoadingTrx(true);
    try {
      const d = await gasGet(u, { action: "getTransaksi", bulan });
      if (d.ok && d.transaksi) setTransaksi(d.transaksi);
    } catch (e) { console.error("loadTransaksi:", e.message); }
    finally { setLoadingTrx(false); }
  }, [scriptUrl]);

  useEffect(() => {
    if (scriptUrl && !setupMode) {
      loadBarang();
      loadTransaksi(todayStr().slice(0, 7));
    }
  }, [scriptUrl, setupMode]);

  useEffect(() => {
    if (!setupMode && scriptUrl) {
      if (tab === "rekap") loadTransaksi(rekapMonth);
      if (tab === "input") loadBarang();
    }
  }, [tab, rekapMonth]);

  // ── Connect ───────────────────────────────────────────────
  const handleConnect = async () => {
    const url = tempUrl.trim().replace(/\/+$/, "");
    if (!url.includes("script.google.com") || !url.endsWith("/exec")) {
      setPingStatus("fail");
      setPingError("URL harus dari script.google.com dan diakhiri /exec");
      return;
    }
    setPingStatus("checking");
    setPingError("");
    try {
      const d = await gasGet(url, { action: "ping" });
      if (d.ok) {
        setPingStatus("ok");
        localStorage.setItem(GAS_URL_KEY, url);
        setScriptUrl(url);
        setTimeout(() => setSetupMode(false), 700);
      } else {
        setPingStatus("fail");
        setPingError("Server error: " + (d.error || "unknown"));
      }
    } catch (e) {
      setPingStatus("fail");
      setPingError("Gagal: " + e.message + ". Coba buka URL langsung di browser dulu.");
    }
  };

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.itemId || !form.jumlah || Number(form.jumlah) <= 0) return;
    setSaveStatus("saving");
    try {
      const d = await gasPost(scriptUrl, {
        action: "addTransaksi",
        itemId: form.itemId,
        jumlah: parseFloat(form.jumlah),
        tanggal: form.tanggal,
        catatan: form.catatan,
      });
      if (d.ok) {
        setSaveStatus("saved");
        setForm({ itemId: "", jumlah: "", catatan: "", tanggal: todayStr() });
        await loadTransaksi(form.tanggal.slice(0, 7));
        setTimeout(() => setSaveStatus("idle"), 2500);
      } else {
        setSaveStatus("error");
        setSaveMsg(d.error || "Gagal simpan");
        setTimeout(() => setSaveStatus("idle"), 3500);
      }
    } catch (e) {
      setSaveStatus("error");
      setSaveMsg("Koneksi gagal — " + e.message);
      setTimeout(() => setSaveStatus("idle"), 3500);
    }
  };

  const handleDelete = async (id) => {
    try {
      await gasPost(scriptUrl, { action: "deleteTransaksi", id });
      setTransaksi(t => t.filter(x => x.id !== id));
    } catch {}
  };

  const todayEntries = transaksi.filter(e => e.tanggal === todayStr());
  const rekapEntries = transaksi.filter(e => e.tanggal?.startsWith(rekapMonth));
  const months = [...new Set(transaksi.map(e => e.tanggal?.slice(0, 7)))].filter(Boolean).sort().reverse();
  const rekapByItem = rekapEntries.reduce((acc, e) => {
    if (!acc[e.nama]) acc[e.nama] = { nama: e.nama, satuan: e.satuan, total: 0, count: 0 };
    acc[e.nama].total += Number(e.jumlah);
    acc[e.nama].count++;
    return acc;
  }, {});

  // ════════════════════════════════════════════════════════
  // SETUP
  // ════════════════════════════════════════════════════════
  if (setupMode) {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f4f4", fontFamily: "'Barlow', sans-serif" }}>
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800;900&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet" />
        <div style={{ background: "#CC2200", padding: "28px 20px 24px", color: "#fff" }}>
          <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 28, fontWeight: 900, letterSpacing: 1 }}>STOK HARIAN</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>Hubungkan ke Google Sheets</div>
        </div>

        <div style={{ padding: "20px 16px", maxWidth: 480, margin: "0 auto" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "18px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#111", marginBottom: 6 }}>Paste URL Google Apps Script:</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 12, lineHeight: 1.6 }}>
              URL harus dari <b>script.google.com</b> dan diakhiri <b>/exec</b><br />
              Pastikan sudah deploy dengan <b>Who has access: Anyone</b>
            </div>
            <input
              value={tempUrl}
              onChange={e => { setTempUrl(e.target.value); setPingStatus("idle"); setPingError(""); }}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
              placeholder="https://script.google.com/macros/s/.../exec"
              style={{
                width: "100%", padding: "13px 14px", borderRadius: 10, boxSizing: "border-box",
                border: `2px solid ${pingStatus === "fail" ? "#CC2200" : pingStatus === "ok" ? "#22aa55" : "#e0e0e0"}`,
                fontSize: 13, fontFamily: "'Barlow'", outline: "none"
              }}
            />

            {pingStatus === "fail" && (
              <div style={{ marginTop: 10, background: "#FFF3F3", borderRadius: 8, padding: "12px", fontSize: 12 }}>
                <div style={{ color: "#CC2200", fontWeight: 800, marginBottom: 6 }}>✕ Tidak bisa connect</div>
                {pingError && <div style={{ color: "#CC2200", marginBottom: 8 }}>{pingError}</div>}
                <div style={{ color: "#888", lineHeight: 1.8 }}>
                  Checklist:<br />
                  ☐ URL diakhiri <b>/exec</b> (bukan /dev)<br />
                  ☐ Who has access: <b>Anyone</b><br />
                  ☐ Sudah klik <b>Authorize</b><br />
                  ☐ Deploy ulang → <b>New deployment</b> (bukan manage existing)<br />
                  ☐ Test manual: buka URL + <b>?action=ping</b> di browser, harus muncul &#123;"ok":true&#125;
                </div>
              </div>
            )}

            {pingStatus === "ok" && (
              <div style={{ marginTop: 8, color: "#22aa55", fontWeight: 800, fontSize: 13 }}>✓ Berhasil! Mengalihkan...</div>
            )}

            <button onClick={handleConnect} disabled={pingStatus === "checking" || !tempUrl.trim()}
              style={{
                marginTop: 12, width: "100%", padding: "15px", borderRadius: 10, border: "none",
                background: pingStatus === "checking" ? "#ccc" : "#CC2200",
                color: "#fff", fontWeight: 900, fontSize: 15, cursor: pingStatus === "checking" ? "not-allowed" : "pointer",
                fontFamily: "'Barlow Condensed'", letterSpacing: 1
              }}>
              {pingStatus === "checking" ? "MENGECEK..." : "HUBUNGKAN →"}
            </button>
          </div>

          {scriptUrl && (
            <button onClick={() => setSetupMode(false)}
              style={{ marginTop: 10, width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #ddd", background: "transparent", color: "#bbb", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Barlow'" }}>
              ← Kembali ke app
            </button>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // MAIN APP
  // ════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f4", fontFamily: "'Barlow', sans-serif", paddingBottom: 48 }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800;900&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "#CC2200", color: "#fff", position: "sticky", top: 0, zIndex: 20, boxShadow: "0 2px 10px rgba(204,34,0,0.25)" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "14px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>STOK HARIAN</div>
            <button onClick={() => { setSetupMode(true); setTempUrl(scriptUrl); setPingStatus("idle"); setPingError(""); }}
              style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "'Barlow'", fontWeight: 700 }}>
              ⚙ URL
            </button>
          </div>
          <div style={{ display: "flex", marginTop: 12 }}>
            {[["input", "INPUT"], ["rekap", "REKAP"]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, padding: "11px 0", border: "none", background: "transparent", cursor: "pointer",
                fontFamily: "'Barlow Condensed'", fontSize: 15, fontWeight: 800, letterSpacing: 1,
                color: tab === key ? "#fff" : "rgba(255,255,255,0.45)",
                borderBottom: tab === key ? "3px solid #fff" : "3px solid transparent",
                transition: "all 0.15s"
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 14px" }}>

        {/* ══════ INPUT ══════ */}
        {tab === "input" && (
          <>
            <div style={{ fontSize: 11, color: "#bbb", fontWeight: 800, letterSpacing: 1, marginBottom: 16 }}>
              {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}
            </div>

            <div style={card}>
              <div style={lbl}>PILIH BARANG</div>
              {loadingBarang ? (
                <div style={ghost}>Memuat daftar barang...</div>
              ) : barang.length === 0 ? (
                <div style={{ padding: "14px", background: "#FFF3F3", borderRadius: 10, border: "1px solid #FFCCCC" }}>
                  <div style={{ fontWeight: 800, color: "#CC2200", fontSize: 13 }}>⚠ Daftar barang kosong</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Tambah barang di Google Sheets → sheet "Barang", lalu tekan Refresh.</div>
                </div>
              ) : (
                <select value={form.itemId} onChange={e => setForm(f => ({ ...f, itemId: e.target.value }))} style={sel}>
                  <option value="">— Pilih barang —</option>
                  {barang.map(b => <option key={b.id} value={b.id}>{b.nama} ({b.satuan})</option>)}
                </select>
              )}
              <button onClick={() => loadBarang()} style={refreshBtn}>
                {loadingBarang ? "MEMUAT..." : "↻ REFRESH DAFTAR BARANG"}
              </button>

              <div style={{ marginTop: 18 }}>
                <div style={lbl}>
                  JUMLAH {form.itemId && <span style={{ color: "#CC2200" }}>({barang.find(b => b.id === form.itemId)?.satuan})</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setForm(f => ({ ...f, jumlah: String(Math.max(0, Number(f.jumlah || 0) - 1) || "") })) }
                    style={qBtn}>−</button>
                  <input type="number" inputMode="decimal" value={form.jumlah}
                    onChange={e => setForm(f => ({ ...f, jumlah: e.target.value }))}
                    placeholder="0"
                    style={{ ...inp, flex: 1, textAlign: "center", fontSize: 28, fontWeight: 900, padding: "14px 8px" }} />
                  <button onClick={() => setForm(f => ({ ...f, jumlah: String(Number(f.jumlah || 0) + 1) }))}
                    style={{ ...qBtn, background: "#CC2200", color: "#fff", border: "none" }}>＋</button>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={lbl}>TANGGAL</div>
                <input type="date" value={form.tanggal} onChange={e => setForm(f => ({ ...f, tanggal: e.target.value }))} style={inp} />
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={lbl}>CATATAN <span style={{ color: "#ccc", fontWeight: 500, textTransform: "none" }}>(opsional)</span></div>
                <input value={form.catatan} onChange={e => setForm(f => ({ ...f, catatan: e.target.value }))}
                  placeholder="cth: titip driver, stok mingguan..." style={inp} />
              </div>

              <button onClick={handleSubmit}
                disabled={saveStatus === "saving" || !form.itemId || !form.jumlah || Number(form.jumlah) <= 0}
                style={{
                  marginTop: 18, width: "100%", padding: "16px", borderRadius: 10, border: "none",
                  background: saveStatus === "saved" ? "#1a8a3a" : saveStatus === "error" ? "#991100" : (!form.itemId || !form.jumlah) ? "#ddd" : "#CC2200",
                  color: (!form.itemId || !form.jumlah) ? "#aaa" : "#fff",
                  fontWeight: 900, fontSize: 16, cursor: (!form.itemId || !form.jumlah) ? "not-allowed" : "pointer",
                  fontFamily: "'Barlow Condensed'", letterSpacing: 1.5, transition: "all 0.2s"
                }}>
                {saveStatus === "saving" ? "MENYIMPAN..." : saveStatus === "saved" ? "✓ TERSIMPAN DI SHEETS!" : saveStatus === "error" ? "✕ " + saveMsg : "SIMPAN"}
              </button>
            </div>

            {todayEntries.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={secHdr}>MASUK HARI INI — {todayEntries.length} ITEM</div>
                {[...todayEntries].reverse().map(e => (
                  <div key={e.id} style={row}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: "#111" }}>{e.nama}</div>
                        <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>{e.catatan || "—"}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ background: "#CC2200", color: "#fff", borderRadius: 8, padding: "5px 12px", fontWeight: 900, fontSize: 15, fontFamily: "'Barlow Condensed'" }}>
                          {e.jumlah} {e.satuan}
                        </div>
                        <button onClick={() => handleDelete(e.id)}
                          style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══════ REKAP ══════ */}
        {tab === "rekap" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <select value={rekapMonth} onChange={e => setRekapMonth(e.target.value)} style={{ ...sel, flex: 1 }}>
                {[todayStr().slice(0, 7), ...months.filter(m => m !== todayStr().slice(0, 7))]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <button onClick={() => loadTransaksi(rekapMonth)}
                style={{ padding: "0 16px", borderRadius: 10, border: "2px solid #e0e0e0", background: "#fff", color: "#CC2200", fontWeight: 900, cursor: "pointer", fontSize: 18 }}>↻</button>
            </div>

            {loadingTrx ? (
              <div style={ghost}>Memuat rekap...</div>
            ) : (
              <>
                <div style={{ background: "#CC2200", borderRadius: 14, padding: "20px", marginBottom: 16, color: "#fff", boxShadow: "0 4px 16px rgba(204,34,0,0.2)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, letterSpacing: 1 }}>TOTAL TRANSAKSI MASUK</div>
                  <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 52, fontWeight: 900, lineHeight: 1, marginTop: 2 }}>{rekapEntries.length}</div>
                  <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>{Object.keys(rekapByItem).length} jenis barang · {monthLabel(rekapMonth)}</div>
                </div>

                {Object.values(rekapByItem).length === 0 ? (
                  <div style={{ textAlign: "center", color: "#ccc", padding: "40px 0", fontSize: 14, fontWeight: 600 }}>Belum ada data bulan ini</div>
                ) : (
                  <>
                    <div style={secHdr}>RINGKASAN PER BARANG</div>
                    {Object.values(rekapByItem).sort((a, b) => b.total - a.total).map(item => (
                      <div key={item.nama} style={row}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 15, color: "#111" }}>{item.nama}</div>
                            <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>{item.count}× masuk</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 26, fontWeight: 900, color: "#CC2200", lineHeight: 1 }}>{item.total}</div>
                            <div style={{ fontSize: 11, color: "#bbb" }}>{item.satuan}</div>
                          </div>
                        </div>
                      </div>
                    ))}

                    <div style={{ marginTop: 20 }}>
                      <div style={secHdr}>SEMUA TRANSAKSI</div>
                      {[...rekapEntries].reverse().map(e => (
                        <div key={e.id} style={{ ...row, padding: "10px 14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{e.nama}</div>
                              <div style={{ fontSize: 11, color: "#bbb" }}>{e.tanggal}{e.catatan ? " · " + e.catatan : ""}</div>
                            </div>
                            <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 16, color: "#CC2200" }}>{e.jumlah} {e.satuan}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const card = { background: "#fff", borderRadius: 14, padding: "18px 16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" };
const row = { background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inp = { width: "100%", padding: "13px 14px", borderRadius: 10, border: "2px solid #efefef", fontSize: 15, fontWeight: 600, fontFamily: "'Barlow'", outline: "none", boxSizing: "border-box", color: "#111", background: "#fafafa" };
const sel = { width: "100%", padding: "13px 14px", borderRadius: 10, border: "2px solid #efefef", fontSize: 14, fontWeight: 600, fontFamily: "'Barlow'", outline: "none", boxSizing: "border-box", color: "#111", background: "#fafafa", cursor: "pointer" };
const lbl = { fontSize: 11, fontWeight: 800, color: "#bbb", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 7 };
const secHdr = { fontSize: 11, fontWeight: 800, color: "#bbb", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 };
const ghost = { background: "#f0f0f0", borderRadius: 10, padding: "16px", color: "#bbb", fontSize: 13, fontWeight: 600, textAlign: "center" };
const qBtn = { width: 52, height: 52, borderRadius: 10, border: "2px solid #efefef", background: "#fff", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "'Barlow'", color: "#333", flexShrink: 0 };
const refreshBtn = { marginTop: 8, width: "100%", padding: "9px", borderRadius: 8, border: "2px solid #efefef", background: "transparent", color: "#aaa", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "'Barlow'", letterSpacing: 1 };
