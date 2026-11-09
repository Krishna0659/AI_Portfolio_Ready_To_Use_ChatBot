import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
process.loadEnvFile('.env.local');
if(!process.env.IDENTITY_DATABASE_URL)throw Error('Configure IDENTITY_DATABASE_URL before migrating');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
await db.query('BEGIN');
await db.query(await readFile('packages/db/schema.sql','utf8'));
// The runtime role is distinct from the migration owner so FORCE RLS applies.
const password=process.env.RUNTIME_DB_PASSWORD!;
if(!/^[a-f0-9]{48}$/.test(password))throw Error('Invalid runtime password');
await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='portfolio_runtime') THEN CREATE ROLE portfolio_runtime LOGIN PASSWORD '${password}'; END IF; END $$`);
await db.query('GRANT USAGE ON SCHEMA public TO portfolio_runtime');
await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO portfolio_runtime');
await db.query('REVOKE UPDATE ON versions,approvals FROM portfolio_runtime');
await db.query(await readFile('packages/db/identity.sql','utf8'));
if(process.env.IDENTITY_DATABASE_URL){
 const identityUrl=new URL(process.env.IDENTITY_DATABASE_URL),secret=identityUrl.password;
 if(identityUrl.username!=='portfolio_identity'||!/^[a-f0-9]{48}$/.test(secret))throw Error('Invalid identity role configuration');
 await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='portfolio_identity') THEN CREATE ROLE portfolio_identity LOGIN PASSWORD '${secret}'; END IF; END $$`);
 await db.query('GRANT USAGE ON SCHEMA public TO portfolio_identity');
 await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON accounts,sessions,auth_flows,workspaces,memberships,deletion_requests,object_deletions TO portfolio_identity');
 await db.query('GRANT INSERT ON drafts TO portfolio_identity');
 await db.query('GRANT SELECT(tenant_id) ON drafts TO portfolio_identity');
 await db.query('GRANT SELECT(locator,kind) ON sources TO portfolio_identity');
 await db.query('GRANT EXECUTE ON FUNCTION public.session_recent(text,uuid) TO portfolio_identity');
 await db.query('REVOKE ALL ON accounts,sessions,auth_flows FROM portfolio_runtime');
 await db.query('REVOKE INSERT,UPDATE,DELETE ON workspaces,memberships FROM portfolio_runtime');
}
await db.query(await readFile('packages/db/tenancy.sql','utf8'));
if(process.env.WORKER_DATABASE_URL){
 const url=new URL(process.env.WORKER_DATABASE_URL),secret=url.password;
 if(url.username!=='portfolio_worker'||!/^[a-f0-9]{48}$/.test(secret))throw Error('Invalid worker role configuration');
 await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='portfolio_worker') THEN CREATE ROLE portfolio_worker LOGIN PASSWORD '${secret}'; END IF; END $$`);
 await db.query('GRANT USAGE ON SCHEMA public TO portfolio_worker');
 await db.query('GRANT SELECT,UPDATE,DELETE ON deletion_requests,object_deletions TO portfolio_worker');
 await db.query(await readFile('packages/db/worker.sql','utf8'));
}
await db.query('COMMIT');await db.end();console.log('Schema and runtime roles ready');
