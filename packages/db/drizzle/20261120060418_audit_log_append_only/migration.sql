-- Append-only, tamper-evident audit log (requirements FR-41, ADR-0004). Hand-written: drizzle-kit does not
-- manage functions or triggers.
--
-- Each tenant (and the platform, tenant_id null) has its own hash chain:
--   hash = sha256(prev_hash || canonical row)
-- chain_seq numbers the chain under an advisory lock, so concurrent inserts cannot fork it; ids are not used for
-- ordering because they are assigned before the lock. Time enters the hash as microseconds since the epoch, so the
-- hash does not depend on the session time zone.
-- Limits: the owner (superuser) can still disable triggers; changes and deletions inside a chain are then
-- detected by commucal_verify_audit_chain(), removing the newest entries is not.

CREATE OR REPLACE FUNCTION commucal_audit_chain_hash(
  p_prev_hash bytea,
  p_tenant_id uuid,
  p_chain_seq bigint,
  p_actor_user_id uuid,
  p_actor_label text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_data jsonb,
  p_created_at timestamptz
) RETURNS bytea
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
  AS $$
    SELECT sha256(
      coalesce(p_prev_hash, ''::bytea)
      || convert_to(
        jsonb_build_array(
          p_tenant_id, p_chain_seq, p_actor_user_id, p_actor_label, p_action,
          p_entity_type, p_entity_id, p_data, (extract(epoch FROM p_created_at) * 1000000)::bigint
        )::text,
        'UTF8'
      )
    )
  $$;
--> statement-breakpoint

-- Runs as the owner (SECURITY DEFINER) so it can read the previous entry regardless of row-level security.
CREATE OR REPLACE FUNCTION commucal_audit_log_before_insert() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  previous_seq bigint;
  previous_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('commucal_audit:' || coalesce(NEW.tenant_id::text, 'platform'), 0)
  );
  SELECT chain_seq, hash INTO previous_seq, previous_hash
    FROM public.audit_log
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    ORDER BY chain_seq DESC
    LIMIT 1;
  NEW.chain_seq := coalesce(previous_seq, 0) + 1;
  NEW.prev_hash := previous_hash;
  -- The database sets the time; a value from the caller is ignored.
  NEW.created_at := clock_timestamp();
  NEW.hash := commucal_audit_chain_hash(
    NEW.prev_hash, NEW.tenant_id, NEW.chain_seq, NEW.actor_user_id, NEW.actor_label, NEW.action,
    NEW.entity_type, NEW.entity_id, NEW.data, NEW.created_at
  );
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commucal_audit_log_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION commucal_audit_log_before_insert();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION commucal_audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION commucal_audit_log_reject_change();
--> statement-breakpoint

-- Checks one chain (p_tenant_id null = platform chain). Returns the number of checked entries and the chain_seq of
-- the first entry that does not match, or null if the chain is intact (requirements FR-43).
CREATE OR REPLACE FUNCTION commucal_verify_audit_chain(p_tenant_id uuid)
  RETURNS TABLE (checked bigint, first_broken_seq bigint)
  LANGUAGE plpgsql STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  entry record;
  expected_seq bigint := 0;
  expected_prev bytea := NULL;
BEGIN
  checked := 0;
  first_broken_seq := NULL;
  FOR entry IN
    SELECT * FROM public.audit_log
    WHERE tenant_id IS NOT DISTINCT FROM p_tenant_id
    ORDER BY chain_seq
  LOOP
    checked := checked + 1;
    expected_seq := expected_seq + 1;
    IF entry.chain_seq <> expected_seq
      OR entry.prev_hash IS DISTINCT FROM expected_prev
      OR entry.hash <> commucal_audit_chain_hash(
        entry.prev_hash, entry.tenant_id, entry.chain_seq, entry.actor_user_id, entry.actor_label,
        entry.action, entry.entity_type, entry.entity_id, entry.data, entry.created_at
      )
    THEN
      first_broken_seq := entry.chain_seq;
      RETURN NEXT;
      RETURN;
    END IF;
    expected_prev := entry.hash;
  END LOOP;
  RETURN NEXT;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commucal_verify_audit_chain(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commucal_verify_audit_chain(uuid) TO commucal_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO commucal_app, commucal_worker;
