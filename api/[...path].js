// Vercel Serverless Function — barcha /api/* so'rovlarini backendga
// xom (raw) baytlar holida, hech narsani o'zgartirmasdan uzatadi.
// Bu usul JSON so'rovlar uchun ham, fayl yuklash (multipart/form-data)
// uchun ham ishonchli ishlaydi.

export const config = {
  api: {
    bodyParser: false,
  },
};

const BACKEND_BASE = "https://call-system.duckdns.org";

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join("/") : "";
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${BACKEND_BASE}/api/${path}${search}`;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (["host", "connection", "content-length"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }

  let bodyBuffer;
  if (!["GET", "HEAD"].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodyBuffer = Buffer.concat(chunks);
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyBuffer,
    });

    const arrayBuffer = await backendRes.arrayBuffer();
    res.status(backendRes.status);
    const contentType = backendRes.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).json({ message: "Backendga ulanib bo'lmadi", error: String(err) });
  }
}
