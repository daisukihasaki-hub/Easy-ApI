const http = require("http");
const https = require("https");

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const NVIDIA_BASE = "integrate.api.nvidia.com";
const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function proxyToNvidia(path, reqBody, res) {
  const bodyStr = JSON.stringify(reqBody);
  const options = {
    hostname: NVIDIA_BASE,
    port: 443,
    path: path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      Accept: reqBody.stream ? "text/event-stream" : "application/json",
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    if (reqBody.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    } else {
      let data = "";
      proxyRes.on("data", (chunk) => (data += chunk));
      proxyRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          sendJSON(res, proxyRes.statusCode, parsed);
        } catch {
          res.writeHead(proxyRes.statusCode, { "Content-Type": "text/plain" });
          res.end(data);
        }
      });
    }
  });

  proxyReq.on("error", (err) => {
    sendJSON(res, 502, { error: { message: err.message, type: "proxy_error" } });
  });

  proxyReq.write(bodyStr);
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }

  const url = req.url;

  if (url === "/" || url === "/health") {
    return sendJSON(res, 200, { status: "ok", message: "NVIDIA NIM Proxy running" });
  }

  if (url === "/v1/models" && req.method === "GET") {
    return sendJSON(res, 200, {
      object: "list",
      data: [
        { id: "meta/llama-3.1-70b-instruct", object: "model", owned_by: "nvidia" },
        { id: "meta/llama-3.1-8b-instruct", object: "model", owned_by: "nvidia" },
        { id: "mistralai/mistral-7b-instruct-v0.3", object: "model", owned_by: "nvidia" },
        { id: "microsoft/phi-3-mini-128k-instruct", object: "model", owned_by: "nvidia" },
        { id: "google/gemma-2-9b-it", object: "model", owned_by: "nvidia" },
      ],
    });
  }

  if (url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.model) parsed.model = DEFAULT_MODEL;
        proxyToNvidia("/v1/chat/completions", parsed, res);
      } catch {
        sendJSON(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error" } });
      }
    });
    return;
  }

  if (url === "/v1/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.model) parsed.model = DEFAULT_MODEL;
        proxyToNvidia("/v1/completions", parsed, res);
      } catch {
        sendJSON(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error" } });
      }
    });
    return;
  }

  sendJSON(res, 404, { error: { message: "Not found", type: "not_found" } });
});

server.listen(PORT, () => {
  console.log(`NVIDIA NIM Proxy running on port ${PORT}`);
});
