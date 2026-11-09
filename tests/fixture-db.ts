import pg from 'pg';
import {transaction as scopedTransaction} from '../packages/db';
// Privileged connection only for constructing/removing disposable test identities.
export const fixturePool=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:2});
export async function transaction<T>(tenant:string,fn:(db:pg.PoolClient)=>Promise<T>){
 const actor=(await fixturePool.query('SELECT owner_id FROM workspaces WHERE id=$1',[tenant])).rows[0]?.owner_id;
 return scopedTransaction(tenant,async db=>{if(actor)await db.query("SELECT set_config('app.user_id',$1,true)",[actor]);return fn(db);});
}
