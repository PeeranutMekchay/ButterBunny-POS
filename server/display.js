// Customer-facing display (/display): the cashier's screen sends what the customer should see
// (items, total, the QR to scan, thank-you) and the display tablet/second monitor follows live.
const STATION_RE = /^[a-z0-9-]{1,12}$/i;
const states = new Map(), watchers = new Map();

const station = s => { const v = String(s || "1"); if (!STATION_RE.test(v)) throw Object.assign(new Error("ชื่อเครื่องไม่ถูกต้อง"), { status: 400 }); return v.toLowerCase(); };

function setState(st, state) {
  const k = station(st), msg = { ...(state && typeof state === "object" ? state : { mode: "idle" }), at: Date.now() };
  states.set(k, msg);
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of watchers.get(k) || []) res.write(data);
}
function watch(req, res) {
  const k = station(req.params.station);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`retry: 2000\ndata: ${JSON.stringify(states.get(k) || { mode: "idle" })}\n\n`);
  if (!watchers.has(k)) watchers.set(k, new Set());
  watchers.get(k).add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); watchers.get(k)?.delete(res); });
}
const watching = st => (watchers.get(station(st)) || new Set()).size;

module.exports = { setState, watch, watching };
