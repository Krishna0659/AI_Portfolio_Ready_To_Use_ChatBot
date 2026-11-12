CREATE TABLE IF NOT EXISTS accounts(id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, name text NOT NULL, UNIQUE(issuer,subject));
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES accounts, csrf text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours');
CREATE TABLE IF NOT EXISTS auth_flows(state text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes');
CREATE TABLE IF NOT EXISTS fetch_cooldowns(host text PRIMARY KEY,retry_at timestamptz NOT NULL);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authenticated_at timestamptz;
CREATE TABLE IF NOT EXISTS deletion_requests(id uuid PRIMARY KEY,receipt_hash text UNIQUE NOT NULL,tenant_id uuid NOT NULL,user_id uuid NOT NULL,source_id uuid,scope text NOT NULL CHECK(scope IN ('source','account')),status text NOT NULL CHECK(status IN ('pending','completed')),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE TABLE IF NOT EXISTS object_deletions(id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES deletion_requests,object_key text UNIQUE NOT NULL CHECK(object_key ~ '^[0-9a-f-]{36}\.(docx|pdf|txt|md)$'),attempt integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease uuid,lease_until timestamptz,last_error text);
CREATE INDEX IF NOT EXISTS pending_object_cleanup ON object_deletions(available_at);
CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES accounts UNIQUE,name text NOT NULL DEFAULT 'Personal workspace');
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS memberships(tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES accounts,role text NOT NULL CHECK(role IN ('owner','editor','viewer')),active boolean NOT NULL DEFAULT true,PRIMARY KEY(tenant_id,user_id));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_owner ON memberships(tenant_id) WHERE role='owner' AND active;
INSERT INTO memberships(tenant_id,user_id,role) SELECT id,owner_id,'owner' FROM workspaces ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION provision_owner_membership() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN INSERT INTO public.memberships(tenant_id,user_id,role) VALUES(NEW.id,NEW.owner_id,'owner'); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS workspace_owner_membership ON workspaces;
CREATE TRIGGER workspace_owner_membership AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION provision_owner_membership();
CREATE TABLE IF NOT EXISTS drafts(tenant_id uuid PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE, revision integer NOT NULL DEFAULT 1,content jsonb NOT NULL, current_version uuid, generation integer NOT NULL DEFAULT 0,settings jsonb NOT NULL DEFAULT '{"theme":"light","greeting":"Ask about my work","position":"bottom_right","integration":"disabled"}');
CREATE TABLE IF NOT EXISTS sources(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('web','github','upload')),label text NOT NULL,locator text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','detached')),consented_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,source_id uuid NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),attempt integer NOT NULL DEFAULT 0,lease uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),error text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,source_id) REFERENCES sources(tenant_id,id) ON DELETE CASCADE,UNIQUE(tenant_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS one_job_per_source ON jobs(source_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS snapshots(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,source_id uuid NOT NULL,job_id uuid NOT NULL,text text NOT NULL,content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,source_id) REFERENCES sources(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id) ON DELETE CASCADE,UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS versions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,number integer NOT NULL,content jsonb NOT NULL,content_hash text NOT NULL,markdown text NOT NULL,draft_revision integer NOT NULL,base_version_id uuid REFERENCES versions(id) ON DELETE SET NULL,approved_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,number), UNIQUE(tenant_id,id));
ALTER TABLE versions ADD COLUMN IF NOT EXISTS base_version_id uuid REFERENCES versions(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS approvals(tenant_id uuid NOT NULL,version_id uuid PRIMARY KEY,draft_revision integer NOT NULL DEFAULT 1,content_hash text NOT NULL,actor_id uuid NOT NULL REFERENCES accounts,partial_ack boolean NOT NULL DEFAULT false,publish_consent boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS partial_ack boolean NOT NULL DEFAULT false;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS publish_consent boolean NOT NULL DEFAULT false;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS version_evidence(tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,version_id uuid NOT NULL,fact_id uuid NOT NULL,snapshot_id uuid NOT NULL,source_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,version_id,fact_id,snapshot_id),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,snapshot_id) REFERENCES snapshots(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,source_id) REFERENCES sources(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS events(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,version_id uuid,generation integer NOT NULL,mode text NOT NULL CHECK(mode IN ('disabled','mock')),status text NOT NULL CHECK(status IN ('blocked_configuration','pending','mock_succeeded','superseded')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,generation),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS idempotency(tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(tenant_id,key));
CREATE TABLE IF NOT EXISTS exports(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,version_id uuid NOT NULL,format text NOT NULL CHECK(format IN ('json','markdown')),requested_by uuid NOT NULL REFERENCES accounts,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE);
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['drafts','sources','jobs','snapshots','versions','approvals','version_evidence','events','audit','idempotency','exports'] LOOP
EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN
EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
END IF; END LOOP; END $$;
CREATE OR REPLACE FUNCTION immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Approved versions cannot be edited'; END $$;
DROP TRIGGER IF EXISTS protect_version ON versions;
CREATE TRIGGER protect_version BEFORE UPDATE ON versions FOR EACH ROW EXECUTE FUNCTION immutable_version();
CREATE OR REPLACE FUNCTION immutable_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Approved records cannot be edited'; END $$;
DROP TRIGGER IF EXISTS protect_approval ON approvals;
CREATE TRIGGER protect_approval BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION immutable_approval();
CREATE OR REPLACE FUNCTION immutable_version_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Version evidence cannot be edited'; END $$;
DROP TRIGGER IF EXISTS protect_version_evidence ON version_evidence;
CREATE TRIGGER protect_version_evidence BEFORE UPDATE ON version_evidence FOR EACH ROW EXECUTE FUNCTION immutable_version_evidence();
CREATE OR REPLACE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit log entries are immutable and cannot be updated';
  ELSIF TG_OP = 'DELETE' THEN
    IF current_user = 'portfolio_runtime' THEN
      RAISE EXCEPTION 'Audit log is append-only and cannot be deleted by runtime';
    END IF;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS protect_audit ON audit;
CREATE TRIGGER protect_audit BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION protect_audit_log();
