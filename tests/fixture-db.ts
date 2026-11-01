import pg from 'pg';
import '../packages/db';
// Privileged connection only for constructing/removing disposable test identities.
export const fixturePool=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:2});
