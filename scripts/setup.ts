import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
process.loadEnvFile('.env.local');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
await db.query(await readFile('packages/db/schema.sql','utf8'));
// The runtime role is distinct from the migration owner so FORCE RLS applies.
const password=process.env.RUNTIME_DB_PASSWORD!;
if(!/^[a-f0-9]{48}$/.test(password))throw Error('Invalid runtime password');
await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='portfolio_runtime') THEN CREATE ROLE portfolio_runtime LOGIN PASSWORD '${password}'; END IF; END $$`);
await db.query('GRANT USAGE ON SCHEMA public TO portfolio_runtime');
await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO portfolio_runtime');
await db.query('REVOKE UPDATE ON versions,approvals FROM portfolio_runtime');
await db.end();console.log('Schema and runtime role ready');
