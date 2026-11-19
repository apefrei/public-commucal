import { createServer } from "node:http";
import { pino } from "pino";
import { handleHealth } from "./health.ts";

const logger = pino({ name: "mcp" });
const port = Number(process.env.PORT ?? 3001);

// MCP tools and resources follow in WP-1.8 (ADR-0005); until then only the health endpoint exists.
const server = createServer((req, res) => {
  if (handleHealth(req, res)) {
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  logger.info({ port }, "mcp server listening");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
