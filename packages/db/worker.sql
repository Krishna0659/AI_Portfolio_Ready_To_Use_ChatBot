CREATE OR REPLACE FUNCTION public.worker_tenants() RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT w.id FROM public.workspaces w JOIN public.memberships m ON m.tenant_id=w.id AND m.user_id=w.owner_id WHERE w.active AND m.active AND m.role='owner' ORDER BY w.id;
$$;
CREATE OR REPLACE FUNCTION public.worker_claim(tenant uuid,authenticated_github boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.jobs; source public.sources; token uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.worker_tenants() t WHERE t=tenant) THEN RETURN NULL; END IF;
 UPDATE public.jobs SET status=CASE WHEN attempt>=5 THEN 'failed' ELSE 'queued' END,error='Worker interrupted. Retry scheduled or attempt limit reached.',lease=NULL,lease_until=NULL,available_at=now()+least(300,5*power(2,least(attempt,6)))*interval '1 second' WHERE tenant_id=tenant AND status='running' AND lease_until<now();
 SELECT j.* INTO job FROM public.jobs j JOIN public.sources s ON s.id=j.source_id AND s.tenant_id=j.tenant_id WHERE j.tenant_id=tenant AND j.status='queued' AND j.attempt<5 AND j.available_at<=now() AND s.status='active' AND (s.kind<>'github' OR authenticated_github OR NOT EXISTS(SELECT 1 FROM public.fetch_cooldowns WHERE host='api.github.com' AND retry_at>now())) ORDER BY j.available_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 token=gen_random_uuid();
 UPDATE public.jobs SET status='running',attempt=attempt+1,lease=token,lease_until=now()+interval '60 seconds' WHERE id=job.id AND tenant_id=tenant RETURNING * INTO job;
 SELECT * INTO source FROM public.sources WHERE id=job.source_id AND tenant_id=tenant;
 RETURN to_jsonb(job)||jsonb_build_object('kind',source.kind,'locator',source.locator);
END $$;
CREATE OR REPLACE FUNCTION public.worker_heartbeat(tenant uuid,job_id uuid,token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.jobs SET lease_until=now()+interval '60 seconds' WHERE tenant_id=tenant AND id=job_id AND lease=token AND status='running' AND lease_until>now();
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.worker_complete(tenant uuid,job_id uuid,token uuid,evidence text,evidence_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source_id_value uuid;
BEGIN
 IF length(evidence)>200000 OR evidence_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 SELECT s.id INTO source_id_value FROM public.sources s JOIN public.jobs j ON j.source_id=s.id AND j.tenant_id=s.tenant_id WHERE j.id=job_id AND j.tenant_id=tenant AND s.status='active' FOR KEY SHARE OF s;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.jobs WHERE tenant_id=tenant AND id=job_id AND lease=token AND status='running' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.snapshots(id,tenant_id,source_id,job_id,text,content_hash) VALUES(gen_random_uuid(),tenant,source_id_value,job_id,evidence,evidence_hash);
 UPDATE public.jobs SET status='succeeded',lease=NULL,lease_until=NULL,error=NULL WHERE tenant_id=tenant AND id=job_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.worker_fail(tenant uuid,job_id uuid,token uuid,message text,retry_time timestamptz,cooldown_time timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tries integer;
BEGIN
 SELECT attempt INTO tries FROM public.jobs WHERE tenant_id=tenant AND id=job_id AND lease=token AND status='running' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF tries>=5 THEN retry_time=NULL; END IF;
 UPDATE public.jobs SET status=CASE WHEN retry_time IS NULL THEN 'failed' ELSE 'queued' END,error=left(message,250),lease=NULL,lease_until=NULL,available_at=coalesce(retry_time,available_at) WHERE tenant_id=tenant AND id=job_id;
 IF cooldown_time IS NOT NULL THEN INSERT INTO public.fetch_cooldowns(host,retry_at) VALUES('api.github.com',cooldown_time) ON CONFLICT(host) DO UPDATE SET retry_at=greatest(public.fetch_cooldowns.retry_at,excluded.retry_at); END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.worker_ack_mock(tenant uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.events SET status='mock_succeeded' WHERE tenant_id=tenant AND status='pending' AND mode='mock';
$$;
REVOKE ALL ON FUNCTION public.worker_tenants(),public.worker_claim(uuid,boolean),public.worker_heartbeat(uuid,uuid,uuid),public.worker_complete(uuid,uuid,uuid,text,text),public.worker_fail(uuid,uuid,uuid,text,timestamptz,timestamptz),public.worker_ack_mock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_tenants(),public.worker_claim(uuid,boolean),public.worker_heartbeat(uuid,uuid,uuid),public.worker_complete(uuid,uuid,uuid,text,text),public.worker_fail(uuid,uuid,uuid,text,timestamptz,timestamptz),public.worker_ack_mock(uuid) TO portfolio_worker;
