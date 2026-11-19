import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleHealth } from "./health.ts";

const server = createServer((req, res) => {
  if (!handleHealth(req, res)) {
    res.writeHead(404).end();
  }
});
let baseUrl = "";

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("handleHealth", () => {
  it("answers GET /healthz with ok", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("ignores other paths", async () => {
    const res = await fetch(`${baseUrl}/other`);
    expect(res.status).toBe(404);
  });
});
