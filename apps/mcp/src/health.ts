import type { IncomingMessage, ServerResponse } from "node:http";

/** Liveness endpoint used by Compose health checks and the proxies (NFR-10). */
export function handleHealth(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" || req.url !== "/healthz") {
    return false;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ok");
  return true;
}
