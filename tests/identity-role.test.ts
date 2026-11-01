import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {pool,identityPool} from '../packages/db';
after(()=>Promise.all([pool.end(),identityPool.end()]));
test('web cannot read login secrets or alter memberships; identity cannot read profile content',{skip:!process.env.IDENTITY_DATABASE_URL},async()=>{
 for(const table of ['accounts','sessions','auth_flows'])await assert.rejects(pool.query(`SELECT * FROM ${table}`),/permission denied/);
 await assert.rejects(pool.query('UPDATE memberships SET active=false WHERE false'),/permission denied/);
 await assert.rejects(identityPool.query('SELECT content FROM drafts'),/permission denied/);
 await assert.rejects(identityPool.query('SELECT text FROM snapshots'),/permission denied/);
 const role=(await identityPool.query('SELECT current_user name')).rows[0];assert.equal(role.name,'portfolio_identity');
 assert.equal((await pool.query('SELECT session_recent($1,$2) recent',['not-a-session','00000000-0000-0000-0000-000000000000'])).rows[0].recent,false);
});
