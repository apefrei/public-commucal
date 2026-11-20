// Append-only, tamper-evident audit log against PostgreSQL 18 with the real migrations (FR-40, FR-41, ADR-0004).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "./audit.ts";
import { auditLog } from "./schema/index.ts";
import { withTenant } from "./tenant-context.ts";
import { createTestDatabase, type TestDatabase } from "./testing/test-database.ts";

let db: TestDatabase;
const tenants = { a: "", b: "", tamper: "" };

interface ChainRow {
  chain_seq: string;
  prev_hash: Buffer | null;
  hash: Buffer;
  created_at: Date;
  action: string;
}

async function chain(tenantId: string | null): Promise<ChainRow[]> {
  const result = await db.admin.query<ChainRow>(
    "select chain_seq, prev_hash, hash, created_at, action from audit_log where tenant_id is not distinct from $1 order by chain_seq",
    [tenantId],
  );
  return result.rows;
}

async function verify(
  tenantId: string | null,
): Promise<{ checked: string; first_broken_seq: string | null }> {
  const result = await db.admin.query<{ checked: string; first_broken_seq: string | null }>(
    "select * from commucal_verify_audit_chain($1)",
    [tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("verify returned no row");
  }
  return row;
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause ?? error;
    return (cause as { code?: string }).code;
  }
}

async function createTenant(slug: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "insert into tenant (slug, name) values ($1, $1) returning id",
    [slug],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("tenant insert returned no id");
  }
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  tenants.a = await createTenant("audit-a");
  tenants.b = await createTenant("audit-b");
  tenants.tamper = await createTenant("audit-tamper");
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("hash chain", () => {
  it("numbers and links entries per tenant", async () => {
    const app = db.as("commucal_app");
    for (const action of ["calendar.create", "event.create", "event.delete"]) {
      await withTenant(app, { tenantId: tenants.a }, (tx) =>
        recordAudit(tx, { tenantId: tenants.a, actorLabel: "test", action }),
      );
    }
    await withTenant(app, { tenantId: tenants.b }, (tx) =>
      recordAudit(tx, { tenantId: tenants.b, actorLabel: "test", action: "calendar.create" }),
    );

    const rowsA = await chain(tenants.a);
    expect(rowsA.map((row) => row.chain_seq)).toEqual(["1", "2", "3"]);
    expect(rowsA[0]?.prev_hash).toBeNull();
    expect(rowsA[1]?.prev_hash).toEqual(rowsA[0]?.hash);
    expect(rowsA[2]?.prev_hash).toEqual(rowsA[1]?.hash);
    expect(rowsA.every((row) => row.hash.length === 32)).toBe(true);

    const rowsB = await chain(tenants.b);
    expect(rowsB.map((row) => row.chain_seq)).toEqual(["1"]);
    expect(await verify(tenants.a)).toEqual({ checked: "3", first_broken_seq: null });
    expect(await verify(tenants.b)).toEqual({ checked: "1", first_broken_seq: null });
  });

  it("ignores chain number, hash and time supplied by the caller", async () => {
    const pool = db.poolAs("commucal_app");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenants.b]);
      await client.query(
        "insert into audit_log (tenant_id, action, chain_seq, hash, prev_hash, created_at) values ($1, 'forged', 999, '\\xdeadbeef', '\\xdeadbeef', '2000-01-01T00:00:00Z')",
        [tenants.b],
      );
      await client.query("commit");
    } finally {
      client.release();
    }
    const forged = (await chain(tenants.b)).find((row) => row.action === "forged");
    expect(forged?.chain_seq).toBe("2");
    expect(forged?.created_at.getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(await verify(tenants.b)).toEqual({ checked: "2", first_broken_seq: null });
  });

  it("keeps the chain consistent under concurrent inserts", async () => {
    const tenantId = await createTenant("audit-concurrent");
    const app = db.as("commucal_app");
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        withTenant(app, { tenantId }, (tx) =>
          recordAudit(tx, { tenantId, actorLabel: "test", action: `concurrent.${index}` }),
        ),
      ),
    );
    const rows = await chain(tenantId);
    expect(rows.map((row) => Number(row.chain_seq))).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(await verify(tenantId)).toEqual({ checked: "20", first_broken_seq: null });
  });

  it("does not depend on the session time zone", async () => {
    const client = await db.admin.connect();
    try {
      await client.query("set time zone 'Pacific/Auckland'");
      const result = await client.query("select * from commucal_verify_audit_chain($1)", [
        tenants.a,
      ]);
      expect(result.rows[0]).toEqual({ checked: "3", first_broken_seq: null });
    } finally {
      await client.query("reset time zone");
      client.release();
    }
  });

  it("forms a separate platform chain for entries without tenant", async () => {
    await recordAudit(db.as("commucal_app"), {
      tenantId: null,
      actorLabel: "test",
      action: "auth.login_failed",
    });
    expect((await chain(null)).map((row) => row.chain_seq)).toEqual(["1"]);
    expect(await verify(null)).toEqual({ checked: "1", first_broken_seq: null });
  });
});

describe("append-only", () => {
  it("rejects update, delete and truncate for the app role", async () => {
    const pool = db.poolAs("commucal_app");
    expect(await errorCode(pool.query("update audit_log set action = 'x'"))).toBe("42501");
    expect(await errorCode(pool.query("delete from audit_log"))).toBe("42501");
    expect(await errorCode(pool.query("truncate audit_log"))).toBe("42501");
  });

  it("rejects update, delete and truncate even for the owner", async () => {
    for (const statement of [
      "update audit_log set action = 'x'",
      "delete from audit_log",
      "truncate audit_log",
    ]) {
      await expect(db.admin.query(statement)).rejects.toThrow("audit_log is append-only");
    }
  });
});

describe("tenant isolation", () => {
  it("shows only the own tenant's entries", async () => {
    const rows = await withTenant(db.as("commucal_app"), { tenantId: tenants.a }, (tx) =>
      tx.select({ tenantId: auditLog.tenantId }).from(auditLog),
    );
    expect(rows.length).toBe(3);
    expect(rows.every((row) => row.tenantId === tenants.a)).toBe(true);
  });

  it("hides platform entries from tenant users", async () => {
    const rows = await withTenant(db.as("commucal_app"), { tenantId: tenants.a }, (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog),
    );
    expect(rows.map((row) => row.action)).not.toContain("auth.login_failed");
  });

  it("rejects entries for another tenant", async () => {
    const code = await errorCode(
      withTenant(db.as("commucal_app"), { tenantId: tenants.a }, (tx) =>
        recordAudit(tx, { tenantId: tenants.b, actorLabel: "test", action: "forged" }),
      ),
    );
    expect(code).toBe("42501");
  });

  it("lets only the worker run the chain verification", async () => {
    const worker = await db
      .poolAs("commucal_worker")
      .query("select * from commucal_verify_audit_chain($1)", [tenants.a]);
    expect(worker.rows[0]).toEqual({ checked: "3", first_broken_seq: null });
    expect(
      await errorCode(
        db
          .poolAs("commucal_app")
          .query("select * from commucal_verify_audit_chain($1)", [tenants.a]),
      ),
    ).toBe("42501");
  });
});

describe("tamper evidence", () => {
  it("detects a changed entry after the owner bypassed the triggers", async () => {
    const tenantId = tenants.tamper;
    for (const action of ["one", "two", "three"]) {
      await withTenant(db.as("commucal_app"), { tenantId }, (tx) =>
        recordAudit(tx, { tenantId, actorLabel: "test", action }),
      );
    }
    expect(await verify(tenantId)).toEqual({ checked: "3", first_broken_seq: null });

    await db.admin.query("alter table audit_log disable trigger audit_log_no_update_delete");
    try {
      await db.admin.query(
        "update audit_log set data = '{\"changed\": true}' where tenant_id = $1 and chain_seq = 2",
        [tenantId],
      );
      expect(await verify(tenantId)).toEqual({ checked: "2", first_broken_seq: "2" });

      await db.admin.query("delete from audit_log where tenant_id = $1 and chain_seq = 2", [
        tenantId,
      ]);
      expect(await verify(tenantId)).toEqual({ checked: "2", first_broken_seq: "3" });
    } finally {
      await db.admin.query("alter table audit_log enable trigger audit_log_no_update_delete");
    }
  });
});
