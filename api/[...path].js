const BACKEND_BASE = "http://178.104.182.81:8082";

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join("/") : "";
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${BACKEND_BASE}/api/${path}${search}`;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (["host", "connection", "content-length"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const text = await backendRes.text();
    res.status(backendRes.status);
    const contentType = backendRes.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.send(text);
  } catch (err) {
    res.status(502).json({ message: "Backendga ulanib bo'lmadi", error: String(err) });
  }
}
