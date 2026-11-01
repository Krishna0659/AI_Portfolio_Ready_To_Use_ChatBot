CREATE OR REPLACE FUNCTION public.session_recent(token text,actor uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.sessions WHERE token_hash=token AND user_id=actor
 AND expires_at>now() AND absolute_expires_at>now() AND created_at>now()-interval '10 minutes'
 AND authenticated_at>now()-interval '10 minutes' AND authenticated_at<=now()+interval '1 minute');
$$;
REVOKE ALL ON FUNCTION public.session_recent(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_recent(text,uuid) TO portfolio_runtime;
