// Tests for the Gemini review script. Run with: node --test .github/scripts/gemini-review.test.mts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import {
  EXCLUDED_PATHS,
  errorMessage,
  extractText,
  fitCommentLimit,
  type GeminiResponse,
  generateReview,
  isNonCodeChange,
  NoAnswerError,
  oneLine,
  ServiceUnavailableError,
  withNotice,
} from "./gemini-review.mts";

const OK_BODY: GeminiResponse = {
  candidates: [{ content: { parts: [{ text: "Fine." }] }, finishReason: "STOP" }],
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function options(overrides: { deadline?: number } = {}) {
  const sleeps: number[] = [];
  return {
    sleeps,
    opts: {
      apiKey: "test-key",
      model: "test-model",
      prompt: "diff",
      deadline: overrides.deadline ?? Date.now() + 60 * 60_000,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    },
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe("oneLine / errorMessage", () => {
  it("collapses whitespace", () => {
    assert.equal(oneLine("a\n  b\tc\n"), "a b c");
  });

  it("extracts status and message from a Google error body", () => {
    const body = JSON.stringify({ error: { status: "UNAVAILABLE", message: "high\ndemand" } });
    assert.equal(errorMessage(body), "UNAVAILABLE: high demand");
  });

  it("falls back to the raw text for non-JSON bodies", () => {
    assert.equal(errorMessage("<html>\nBad Gateway</html>"), "<html> Bad Gateway</html>");
  });
});

describe("extractText", () => {
  it("returns the visible text and skips thought parts", () => {
    const text = extractText({
      candidates: [
        {
          content: { parts: [{ text: "thinking…", thought: true }, { text: "Review" }] },
          finishReason: "STOP",
        },
      ],
    });
    assert.equal(text, "Review");
  });

  it("notes when the answer hit the output limit", () => {
    const text = extractText({
      candidates: [{ content: { parts: [{ text: "Partial" }] }, finishReason: "MAX_TOKENS" }],
    });
    assert.match(text, /cut off at the output limit/);
  });

  it("raises NoAnswerError for a blocked prompt", () => {
    assert.throws(() => extractText({ promptFeedback: { blockReason: "SAFETY" } }), NoAnswerError);
  });

  it("raises NoAnswerError for a safety stop", () => {
    assert.throws(() => extractText({ candidates: [{ finishReason: "SAFETY" }] }), NoAnswerError);
  });

  it("raises NoAnswerError when the output limit was used up without text", () => {
    assert.throws(
      () =>
        extractText({
          candidates: [
            { content: { parts: [{ text: "…", thought: true }] }, finishReason: "MAX_TOKENS" },
          ],
        }),
      NoAnswerError,
    );
  });

  it("raises a plain error for an empty answer", () => {
    assert.throws(
      () => extractText({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }),
      (error: unknown) => error instanceof Error && !(error instanceof NoAnswerError),
    );
  });
});

describe("generateReview", () => {
  it("sends the key as header, never in the URL", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => json(200, OK_BODY));
    const { opts } = options();
    await generateReview(opts);
    const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.doesNotMatch(String(url), /test-key/);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers["x-goog-api-key"], "test-key");
  });

  it("retries on 503 and honours Retry-After", async () => {
    const responses = [
      json(503, { error: { status: "UNAVAILABLE", message: "busy" } }, { "retry-after": "7" }),
      json(200, OK_BODY),
    ];
    mock.method(globalThis, "fetch", async () => responses.shift());
    const { opts, sleeps } = options();
    const result = await generateReview(opts);
    assert.deepEqual(result, OK_BODY);
    assert.deepEqual(sleeps, [7000]);
  });

  it("retries on network errors and timeouts", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 1) {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      return json(200, OK_BODY);
    });
    const { opts, sleeps } = options();
    await generateReview(opts);
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [20_000]);
  });

  it("retries when reading the response body fails", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 1) {
        const broken = new ReadableStream({
          start(controller) {
            controller.error(new TypeError("terminated"));
          },
        });
        return new Response(broken, { status: 200 });
      }
      return json(200, OK_BODY);
    });
    const { opts } = options();
    assert.deepEqual(await generateReview(opts), OK_BODY);
    assert.equal(calls, 2);
  });

  it("retries when a 200 response has a broken JSON body", async () => {
    const responses = [new Response('{"candidates": [', { status: 200 }), json(200, OK_BODY)];
    mock.method(globalThis, "fetch", async () => responses.shift());
    const { opts } = options();
    assert.deepEqual(await generateReview(opts), OK_BODY);
  });

  it("gives up with ServiceUnavailableError after the maximum attempts", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      json(503, { error: { status: "UNAVAILABLE", message: "busy" } }),
    );
    const { opts, sleeps } = options();
    await assert.rejects(generateReview(opts), ServiceUnavailableError);
    assert.equal(fetchMock.mock.callCount(), 5);
    assert.deepEqual(sleeps, [20_000, 40_000, 60_000, 90_000]);
  });

  it("stops retrying when the time budget would be exceeded", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      json(429, { error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }),
    );
    const { opts } = options({ deadline: Date.now() + 45_000 });
    await assert.rejects(generateReview(opts), ServiceUnavailableError);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("fails without retry on a client error such as an invalid key", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      json(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }),
    );
    const { opts } = options();
    await assert.rejects(
      generateReview(opts),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof ServiceUnavailableError) &&
        error.message.includes("API key not valid"),
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("lists available models when the model does not exist", async () => {
    mock.method(globalThis, "fetch", async (url: string | URL) =>
      String(url).includes(":generateContent")
        ? json(404, { error: { status: "NOT_FOUND", message: "not found" } })
        : json(200, {
            models: [
              { name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] },
              { name: "models/embedder", supportedGenerationMethods: ["embedContent"] },
            ],
          }),
    );
    const { opts } = options();
    await assert.rejects(generateReview(opts), /one of: gemini-a$/);
  });
});

describe("EXCLUDED_PATHS", () => {
  it("excludes lock files, snapshots and SVGs in the root and in subdirectories", () => {
    const dir = mkdtempSync(join(tmpdir(), "gemini-review-"));
    try {
      const files = [
        "pnpm-lock.yaml",
        "package-lock.json",
        "logo.svg",
        "apps/web/package-lock.json",
        "apps/web/__snapshots__/a.snap",
        "apps/web/src/page.tsx",
        "README.md",
      ];
      for (const file of files) {
        mkdirSync(join(dir, file, ".."), { recursive: true });
        writeFileSync(join(dir, file), "x\n");
      }
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["add", "-A"], { cwd: dir });
      const listed = execFileSync("git", ["ls-files", "--", ".", ...EXCLUDED_PATHS], {
        cwd: dir,
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      assert.deepEqual(listed.sort(), ["README.md", "apps/web/src/page.tsx"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withNotice", () => {
  const review = [
    "<!-- commucal:gemini-review -->",
    "## 🤖 Gemini second-opinion review",
    "**Verdict:** fine",
  ].join("\n\n");

  it("creates a comment with only the notice when there is no review yet", () => {
    const body = withNotice(undefined, "Commit `abc` was not reviewed");
    assert.match(body, /^<!-- commucal:gemini-review -->/);
    assert.match(body, /> ⚠️ Commit `abc` was not reviewed/);
  });

  it("puts the notice above an existing review and keeps the review", () => {
    const body = withNotice(review, "Commit `abc` was not reviewed");
    assert.ok(body.indexOf("⚠️ Commit `abc`") < body.indexOf("**Verdict:** fine"));
    assert.match(body, /\*\*Verdict:\*\* fine/);
  });

  it("replaces an earlier notice instead of stacking notices", () => {
    const once = withNotice(review, "Commit `abc` was not reviewed");
    const twice = withNotice(once, "Commit `def` was not reviewed");
    assert.doesNotMatch(twice, /abc/);
    assert.equal(twice.match(/<!-- commucal:notice -->/g)?.length, 1);
    assert.match(twice, /\*\*Verdict:\*\* fine/);
  });
});

describe("fitCommentLimit", () => {
  it("keeps short bodies unchanged", () => {
    assert.equal(fitCommentLimit("short", 100), "short");
  });

  it("shortens long bodies to the limit and says so", () => {
    const body = fitCommentLimit(`<!-- marker -->${"x".repeat(500)}`, 200);
    assert.equal(body.length, 200);
    assert.match(body, /^<!-- marker -->/);
    assert.match(body, /Shortened to fit GitHub's comment size limit/);
  });
});

describe("isNonCodeChange", () => {
  it("is true for documentation-only changes", () => {
    assert.equal(
      isNonCodeChange(["docs/requirements.md", "README.md", ".claude/rules/security.md"]),
      true,
    );
  });

  it("is false as soon as code or configuration changes", () => {
    assert.equal(isNonCodeChange(["docs/adr/0011.md", "apps/web/src/page.tsx"]), false);
    assert.equal(isNonCodeChange([".github/workflows/ci.yml"]), false);
  });

  it("is false for an empty list", () => {
    assert.equal(isNonCodeChange([]), false);
  });
});
