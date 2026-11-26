-- Durable desired state survives workspace deletion so external erasure cannot be lost.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_mode_check;
ALTER TABLE events ADD CONSTRAINT events_mode_check CHECK(mode IN ('disabled','mock','rag'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK(status IN ('blocked_configuration','pending','mock_succeeded','succeeded','superseded'));
ALTER TABLE deletion_requests ADD COLUMN IF NOT EXISTS kb_generation integer;
ALTER TABLE deletion_requests ADD COLUMN IF NOT EXISTS kb_pending boolean NOT NULL DEFAULT false;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS version_sequence integer NOT NULL DEFAULT 0;
UPDATE drafts d SET version_sequence=greatest(d.version_sequence,coalesce((SELECT max(number) FROM versions v WHERE v.tenant_id=d.tenant_id),0));
CREATE TABLE IF NOT EXISTS kb_sync(
 tenant_id uuid PRIMARY KEY, generation integer NOT NULL, operation text NOT NULL CHECK(operation IN ('publish','purge')),
 event_id uuid, version_id uuid, profile_version integer, content jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded')),
 snapshot text, embedding_model text, attempt integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
 last_error text, chat_until timestamptz, chat_token uuid);
ALTER TABLE kb_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_sync FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_sync;
CREATE POLICY tenant_isolation ON kb_sync USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND public.active_membership(tenant_id,nullif(current_setting('app.user_id',true),'')::uuid));
REVOKE ALL ON kb_sync FROM PUBLIC,portfolio_runtime,portfolio_identity,portfolio_worker;
GRANT SELECT ON kb_sync TO portfolio_runtime;

CREATE OR REPLACE FUNCTION enqueue_rag_publish() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.versions; BEGIN
 IF NEW.mode <> 'rag' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.approvals WHERE tenant_id=NEW.tenant_id AND version_id=NEW.version_id AND publish_consent) THEN RAISE EXCEPTION 'Publication consent required'; END IF;
 SELECT * INTO STRICT v FROM public.versions WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id;
 IF EXISTS(SELECT 1 FROM public.kb_sync WHERE tenant_id=NEW.tenant_id AND operation='purge' AND status='pending') THEN RAISE EXCEPTION 'Wait for knowledge deletion to complete'; END IF;
 INSERT INTO public.kb_sync(tenant_id,generation,operation,event_id,version_id,profile_version,content)
 VALUES(NEW.tenant_id,NEW.generation,'publish',NEW.id,v.id,v.number,v.content)
 ON CONFLICT(tenant_id) DO UPDATE SET generation=excluded.generation,operation='publish',event_id=excluded.event_id,
 version_id=excluded.version_id,profile_version=excluded.profile_version,content=excluded.content,status='pending',
 snapshot=NULL,embedding_model=NULL,attempt=0,available_at=now(),lease=NULL,lease_until=NULL,last_error=NULL,chat_until=NULL,chat_token=NULL
 WHERE kb_sync.generation<excluded.generation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stale publication generation'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rag_publication ON events;
CREATE TRIGGER rag_publication AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION enqueue_rag_publish();
REVOKE ALL ON FUNCTION enqueue_rag_publish() FROM PUBLIC;

CREATE OR REPLACE FUNCTION queue_kb_erasure(request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.deletion_requests; next_generation integer; BEGIN
 SELECT * INTO STRICT d FROM public.deletion_requests WHERE id=request AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
 -- Serialize against approval, including account erasure which uses the identity role.
 PERFORM 1 FROM public.drafts WHERE tenant_id=d.tenant_id FOR UPDATE;
 SELECT greatest(k.generation,coalesce(p.generation,0))+1 INTO next_generation FROM public.kb_sync k LEFT JOIN public.drafts p USING(tenant_id) WHERE k.tenant_id=d.tenant_id FOR UPDATE OF k;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.kb_sync SET generation=next_generation,operation='purge',event_id=NULL,version_id=NULL,profile_version=NULL,
 content=NULL,status='pending',snapshot=NULL,embedding_model=NULL,attempt=0,available_at=now(),lease=NULL,lease_until=NULL,last_error=NULL,chat_until=NULL,chat_token=NULL WHERE tenant_id=d.tenant_id;
 UPDATE public.drafts SET generation=next_generation WHERE tenant_id=d.tenant_id;
 UPDATE public.events SET status='superseded' WHERE tenant_id=d.tenant_id AND mode='rag';
 UPDATE public.deletion_requests SET kb_pending=true,kb_generation=next_generation,status='pending',completed_at=NULL WHERE id=request;
END $$;
REVOKE ALL ON FUNCTION queue_kb_erasure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_kb_erasure(uuid) TO portfolio_runtime,portfolio_identity;

CREATE OR REPLACE FUNCTION worker_claim_kb(token uuid) RETURNS SETOF public.kb_sync LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid; BEGIN
 SELECT tenant_id INTO target FROM public.kb_sync WHERE status='pending' AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY (operation='purge') DESC,available_at FOR UPDATE SKIP LOCKED LIMIT 1;
 RETURN QUERY UPDATE public.kb_sync SET lease=token,lease_until=now()+interval '4 minutes',attempt=attempt+1 WHERE tenant_id=target RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION worker_finish_kb(tenant uuid,gen integer,token uuid,receipt jsonb,failed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.kb_sync; BEGIN
 SELECT * INTO job FROM public.kb_sync WHERE tenant_id=tenant AND generation=gen AND lease=token FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF failed THEN
 UPDATE public.kb_sync SET lease=NULL,lease_until=NULL,last_error='delivery_failed',available_at=now()+least(3600,power(2,least(attempt,10))*5)*interval '1 second' WHERE tenant_id=tenant;
 RETURN; END IF;
 IF job.operation='publish' AND (coalesce(receipt->>'snapshot','') !~ '^[a-f0-9]{64}$' OR receipt->>'embedding_model' IS DISTINCT FROM 'sentence-transformers/all-MiniLM-L6-v2') THEN RAISE EXCEPTION 'Invalid indexing receipt'; END IF;
 IF job.operation='purge' AND receipt->>'purged' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Invalid purge receipt'; END IF;
 UPDATE public.kb_sync SET status='succeeded',content=NULL,snapshot=receipt->>'snapshot',embedding_model=receipt->>'embedding_model',lease=NULL,lease_until=NULL,last_error=NULL WHERE tenant_id=tenant;
 IF job.operation='publish' THEN UPDATE public.events SET status='succeeded' WHERE id=job.event_id AND status='pending';
 ELSE UPDATE public.deletion_requests SET kb_pending=false WHERE tenant_id=tenant AND kb_generation<=gen; END IF;
END $$;
CREATE OR REPLACE FUNCTION worker_complete_erasures() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid; BEGIN
 FOR u IN SELECT DISTINCT user_id FROM public.deletion_requests WHERE status='pending' LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text,0));
 UPDATE public.deletion_requests d SET status='completed',completed_at=now() WHERE d.user_id=u AND d.status='pending' AND NOT d.kb_pending
 AND NOT EXISTS(SELECT 1 FROM public.object_deletions o WHERE o.request_id=d.id)
 AND (d.scope='source' OR (NOT EXISTS(SELECT 1 FROM public.deletion_requests other WHERE other.user_id=u AND other.kb_pending)
 AND NOT EXISTS(SELECT 1 FROM public.object_deletions o JOIN public.deletion_requests other ON other.id=o.request_id WHERE other.user_id=u)));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION worker_claim_kb(uuid),worker_finish_kb(uuid,integer,uuid,jsonb,boolean),worker_complete_erasures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_claim_kb(uuid),worker_finish_kb(uuid,integer,uuid,jsonb,boolean),worker_complete_erasures() TO portfolio_worker;

-- One in-flight generation per workspace, across website processes.
CREATE OR REPLACE FUNCTION claim_kb_chat(token uuid) RETURNS SETOF public.kb_sync LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.kb_sync k SET chat_until=now()+interval '3 minutes',chat_token=token
 WHERE k.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND k.status='succeeded' AND k.operation='publish'
 AND (k.chat_until IS NULL OR k.chat_until<now())
 AND EXISTS(SELECT 1 FROM public.drafts d JOIN public.versions v ON v.id=k.version_id JOIN public.events e ON e.id=k.event_id
 WHERE d.tenant_id=k.tenant_id AND d.current_version=v.id AND d.generation=k.generation AND d.settings->>'integration'='rag' AND e.status='succeeded')
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=k.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.active)
 RETURNING k.*;
$$;
CREATE OR REPLACE FUNCTION release_kb_chat(token uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.kb_sync SET chat_until=NULL,chat_token=NULL WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND chat_token=token;
$$;
REVOKE ALL ON FUNCTION claim_kb_chat(uuid),release_kb_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_kb_chat(uuid),release_kb_chat(uuid) TO portfolio_runtime;
