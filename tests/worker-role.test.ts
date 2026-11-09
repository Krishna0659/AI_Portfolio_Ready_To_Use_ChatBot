import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {workerPool,pool,identityPool} from '../packages/db';
after(()=>Promise.all([workerPool.end(),pool.end(),identityPool.end()]));
test('worker cannot directly alter jobs or read profile and identity tables',async()=>{
 assert.equal((await workerPool.query('SELECT current_user role')).rows[0].role,'portfolio_worker');
 for(const table of ['accounts','sessions','auth_flows','drafts','versions','sources','jobs','snapshots'])await assert.rejects(workerPool.query(`SELECT * FROM ${table}`),/permission denied/);
 await assert.rejects(workerPool.query("UPDATE jobs SET status='succeeded' WHERE false"),/permission denied/);
 await assert.rejects(pool.query('SELECT worker_tenants()'),/permission denied/);
 await assert.rejects(identityPool.query('SELECT worker_tenants()'),/permission denied/);
});
