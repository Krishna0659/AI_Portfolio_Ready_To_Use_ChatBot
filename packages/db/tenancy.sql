CREATE OR REPLACE FUNCTION public.active_membership(tenant uuid,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.workspaces w ON w.id=m.tenant_id WHERE m.tenant_id=tenant AND m.user_id=actor AND m.active AND w.active);
$$;
REVOKE ALL ON FUNCTION public.active_membership(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_membership(uuid,uuid) TO portfolio_runtime,portfolio_identity;
CREATE OR REPLACE FUNCTION public.owner_membership(tenant uuid,actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.workspaces w ON w.id=m.tenant_id WHERE m.tenant_id=tenant AND m.user_id=actor AND m.role='owner' AND m.active AND w.active);
$$;
REVOKE ALL ON FUNCTION public.owner_membership(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_membership(uuid,uuid) TO portfolio_runtime,portfolio_identity;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['drafts','sources','jobs','snapshots','versions','approvals','events','audit','idempotency'] LOOP
EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I',t);
EXECUTE format('DROP POLICY IF EXISTS tenant_write ON %I',t);
EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND public.active_membership(tenant_id,nullif(current_setting(''app.user_id'',true),'''')::uuid))',t);
EXECUTE format('CREATE POLICY tenant_write ON %I FOR ALL USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND public.owner_membership(tenant_id,nullif(current_setting(''app.user_id'',true),'''')::uuid)) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND public.owner_membership(tenant_id,nullif(current_setting(''app.user_id'',true),'''')::uuid))',t);
END LOOP; END $$;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_visibility ON memberships;
CREATE POLICY membership_visibility ON memberships USING (current_user='portfolio_identity' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid)) WITH CHECK (current_user='portfolio_identity');
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_visibility ON workspaces;
CREATE POLICY workspace_visibility ON workspaces USING (current_user='portfolio_identity' OR (id=nullif(current_setting('app.tenant_id',true),'')::uuid AND public.active_membership(id,nullif(current_setting('app.user_id',true),'')::uuid))) WITH CHECK (current_user='portfolio_identity');
