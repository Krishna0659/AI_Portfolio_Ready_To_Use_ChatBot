CREATE TABLE IF NOT EXISTS accounts(id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, name text NOT NULL, UNIQUE(issuer,subject));
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES accounts, csrf text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours');
CREATE TABLE IF NOT EXISTS auth_flows(state text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes');
CREATE TABLE IF NOT EXISTS fetch_cooldowns(host text PRIMARY KEY,retry_at timestamptz NOT NULL);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS deletion_requests(id uuid PRIMARY KEY,receipt_hash text UNIQUE NOT NULL,tenant_id uuid NOT NULL,user_id uuid NOT NULL,source_id uuid,scope text NOT NULL CHECK(scope IN ('source','account')),status text NOT NULL CHECK(status IN ('pending','completed')),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE TABLE IF NOT EXISTS object_deletions(id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES deletion_requests,object_key text UNIQUE NOT NULL CHECK(object_key ~ '^[0-9a-f-]{36}\.(docx|pdf|txt|md)$'),attempt integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease uuid,lease_until timestamptz,last_error text);
CREATE INDEX IF NOT EXISTS pending_object_cleanup ON object_deletions(available_at);
CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES accounts UNIQUE,name text NOT NULL DEFAULT 'Personal workspace');
CREATE TABLE IF NOT EXISTS drafts(tenant_id uuid PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE, revision integer NOT NULL DEFAULT 1,content jsonb NOT NULL, current_version uuid, generation integer NOT NULL DEFAULT 0,settings jsonb NOT NULL DEFAULT '{"theme":"light","greeting":"Ask about my work","position":"bottom_right","integration":"disabled"}');
CREATE TABLE IF NOT EXISTS sources(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('web','github','upload')),label text NOT NULL,locator text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','detached')),consented_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,source_id uuid NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),attempt integer NOT NULL DEFAULT 0,lease uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),error text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,source_id) REFERENCES sources(tenant_id,id) ON DELETE CASCADE,UNIQUE(tenant_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS one_job_per_source ON jobs(source_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS snapshots(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,source_id uuid NOT NULL,job_id uuid NOT NULL,text text NOT NULL,content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,source_id) REFERENCES sources(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id) ON DELETE CASCADE,UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS versions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,number integer NOT NULL,content jsonb NOT NULL,content_hash text NOT NULL,markdown text NOT NULL,draft_revision integer NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,number), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS approvals(tenant_id uuid NOT NULL,version_id uuid PRIMARY KEY,content_hash text NOT NULL,actor_id uuid NOT NULL REFERENCES accounts,FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS events(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,version_id uuid,generation integer NOT NULL,mode text NOT NULL CHECK(mode IN ('disabled','mock')),status text NOT NULL CHECK(status IN ('blocked_configuration','pending','mock_succeeded','superseded')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,generation),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS idempotency(tenant_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(tenant_id,key));
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['drafts','sources','jobs','snapshots','versions','approvals','events','audit','idempotency'] LOOP
EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN
EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
END IF; END LOOP; END $$;
CREATE OR REPLACE FUNCTION immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Approved versions cannot be edited'; END $$;
DROP TRIGGER IF EXISTS protect_version ON versions;
CREATE TRIGGER protect_version BEFORE UPDATE ON versions FOR EACH ROW EXECUTE FUNCTION immutable_version();
