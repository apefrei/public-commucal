import type { EmailJob } from "@commucal/db";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmailJob } from "./handler.ts";
import { renderEmail } from "./templates.ts";
import { type EmailTransport, mailpitTransport, transportFromEnv } from "./transport.ts";

const silent = pino({ level: "silent" });

function capture(): EmailTransport & { sent: unknown[] } {
  const sent: unknown[] = [];
  return { name: "capture", sent, send: async (email) => void sent.push(email) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email templates", () => {
  it("renders each template with its link", () => {
    const jobs: EmailJob[] = [
      { template: "password_reset", to: "a@example.ch", url: "https://commucal.ch/r/1" },
      {
        template: "invitation",
        to: "a@example.ch",
        url: "https://commucal.ch/einladung/2",
        tenantName: "Gemeinde Musterdorf",
        role: "contributor",
      },
      { template: "mfa_reset", to: "a@example.ch", url: "https://commucal.ch/anmelden" },
      { template: "account_setup", to: "a@example.ch", url: "https://commucal.ch/r/3" },
    ];
    for (const job of jobs) {
      const email = renderEmail(job);
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.text).toContain(job.url);
    }
    expect(renderEmail(jobs[1] as EmailJob).text).toContain(
      "«Gemeinde Musterdorf» auf CommuCal als Redaktor/in",
    );
  });
});

describe("sendEmailJob", () => {
  it("sends a valid job with an idempotency key derived from the job id", async () => {
    const transport = capture();
    await sendEmailJob(
      {
        id: "job-1",
        data: { template: "password_reset", to: "a@example.ch", url: "https://x.ch/r" },
      },
      transport,
      silent,
    );
    expect(transport.sent).toEqual([
      expect.objectContaining({ to: "a@example.ch", idempotencyKey: "email-job-1" }),
    ]);
  });

  it("rejects an invalid payload without sending", async () => {
    const transport = capture();
    await expect(
      sendEmailJob(
        { id: "job-2", data: { template: "password_reset", to: "nope" } },
        transport,
        silent,
      ),
    ).rejects.toThrow();
    expect(transport.sent).toEqual([]);
  });
});

describe("transports", () => {
  it("posts to Mailpit's send API and fails on an HTTP error", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = mailpitTransport("http://mailpit:8025", "CommuCal <noreply@commucal.ch>");
    await transport.send({ to: "a@example.ch", subject: "S", text: "T", idempotencyKey: "k" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://mailpit:8025/api/v1/send");
    expect(JSON.parse(String(init.body))).toMatchObject({
      From: { Email: "noreply@commucal.ch", Name: "CommuCal" },
      To: [{ Email: "a@example.ch" }],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(
      transport.send({ to: "a@example.ch", subject: "S", text: "T", idempotencyKey: "k" }),
    ).rejects.toThrow("HTTP 500");
  });

  it("chooses Resend over Mailpit and refuses to run without either", () => {
    const from = "noreply@commucal.ch";
    expect(
      transportFromEnv({ MAIL_FROM: from, RESEND_API_KEY: "re_x", MAILPIT_URL: "http://m" }).name,
    ).toBe("resend");
    expect(transportFromEnv({ MAIL_FROM: from, MAILPIT_URL: "http://m" }).name).toBe("mailpit");
    expect(() => transportFromEnv({ MAIL_FROM: from })).toThrow();
    expect(() => transportFromEnv({ MAILPIT_URL: "http://m" })).toThrow("MAIL_FROM");
  });
});
