// Job queue privileges (ADR-0004, ADR-0006): web sends, the worker processes, nobody else touches jobs, and
// queues are defined by the owner only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createQueueProducer,
  createQueueWorker,
  EMAIL_QUEUE,
  type EmailJob,
  enqueueEmail,
  installQueues,
} from "./queue.ts";
import { createTestDatabase, type TestDatabase } from "./testing/test-database.ts";

let db: TestDatabase;
const job: EmailJob = {
  template: "password_reset",
  to: "user@example.ch",
  url: "https://commucal.ch/reset-password/abc",
};

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  db = await createTestDatabase({ queues: true });
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("job queue", () => {
  it("installs idempotently", async () => {
    await installQueues(db.url);
    const queues = await db.admin.query("select name from pgboss.queue order by name");
    expect(queues.rows).toEqual([{ name: EMAIL_QUEUE }]);
  });

  it("lets web send and the worker process an email job", async () => {
    const producer = createQueueProducer(db.urlAs("commucal_app"));
    const worker = createQueueWorker(db.urlAs("commucal_worker"));
    const errors: string[] = [];
    for (const boss of [producer, worker]) {
      boss.on("error", (error: Error) => errors.push(error.message));
    }
    await producer.start();
    await worker.start();
    try {
      const received = new Promise<unknown>((resolve) => {
        void worker.work(EMAIL_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([next]) => {
          resolve(next?.data);
        });
      });
      await enqueueEmail(producer, job);
      expect(await received).toEqual(job);
    } finally {
      await producer.stop({ graceful: false });
      await worker.stop({ graceful: false });
    }
    expect(errors).toEqual([]);
  });

  it("rejects an invalid email job before it reaches the queue", async () => {
    const producer = createQueueProducer(db.urlAs("commucal_app"));
    await producer.start();
    try {
      await expect(
        enqueueEmail(producer, { ...job, url: "javascript:alert(1)" } as EmailJob),
      ).rejects.toThrow();
      await expect(
        enqueueEmail(producer, { ...job, template: "unknown" } as unknown as EmailJob),
      ).rejects.toThrow();
    } finally {
      await producer.stop({ graceful: false });
    }
  });

  it("does not let web change jobs, or anyone but the owner define queues", async () => {
    const app = db.poolAs("commucal_app");
    expect(await errorCode(app.query("update pgboss.job set state = 'completed'"))).toBe("42501");
    expect(await errorCode(app.query("delete from pgboss.job"))).toBe("42501");
    for (const role of ["commucal_app", "commucal_worker"] as const) {
      expect(
        await errorCode(db.poolAs(role).query(`select pgboss.create_queue('evil', '{}'::jsonb)`)),
        role,
      ).toBe("42501");
    }
  });

  it("keeps MCP and auth roles away from the queue", async () => {
    for (const role of ["commucal_mcp", "commucal_auth"] as const) {
      expect(await errorCode(db.poolAs(role).query("select * from pgboss.job")), role).toBe(
        "42501",
      );
    }
  });
});
