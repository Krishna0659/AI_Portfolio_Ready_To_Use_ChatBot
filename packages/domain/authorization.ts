import type {PoolClient} from 'pg';
import {transaction} from '../db';

export async function requireMembership(db:PoolClient,tenant:string,user:string,ownerOnly:boolean){
 await db.query("SELECT set_config('app.user_id',$1,true)",[user]);
 const membership=await db.query('SELECT m.role FROM memberships m JOIN workspaces w ON w.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.active AND w.active',[tenant,user]);
 if(!membership.rowCount)throw Object.assign(Error('Workspace not found'),{status:404});
 if(ownerOnly&&membership.rows[0].role!=='owner')throw Object.assign(Error('Only the workspace owner can perform this action'),{status:403});
}
export async function authorizedTransaction<T>(tenant:string,user:string,ownerOnly:boolean,fn:(db:PoolClient)=>Promise<T>){
 return transaction(tenant,async db=>{await requireMembership(db,tenant,user,ownerOnly);return fn(db);});
}
