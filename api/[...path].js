const targetBaseUrl = "http://muyang-tool.noteach.com.cn/api";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function requestBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return undefined;
}

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(25_000),
      });
      if (response.status < 500 || attempt === 2) return response;
      lastError = new Error(`upstream_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
    await sleep(350 + attempt * 650);
  }
  throw lastError;
}

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join("/") : "";
  const query = { ...req.query };
  delete query.path;
  const search = new URLSearchParams(query).toString();
  const targetUrl = `${targetBaseUrl}/${path}${search ? `?${search}` : ""}`;

  try {
    const upstream = await fetchWithRetry(targetUrl, {
      method: req.method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "X-Forwarded-Host": req.headers.host || "cmuyang23333.top",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : requestBody(req),
    });
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (error) {
    res.status(502).json({
      error: "core_proxy_failed",
      message: error instanceof Error ? error.message : "Core proxy failed.",
    });
  }
}
