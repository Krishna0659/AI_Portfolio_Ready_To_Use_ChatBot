import {cookies} from 'next/headers';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {pool} from '../db';
import {emptyProfile} from '../contracts/profile';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export const cookieName=process.env.APP_ORIGIN?.startsWith('https:')?'__Host-portfolio_session':'portfolio_local_session';
export async function login(issuer:string,subject:string,name:string,authenticatedAt:Date|null=null){
 const jar=await cookies(),previous=jar.get(cookieName)?.value;const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
 const db=await pool.connect();try{await db.query('BEGIN');
 const account=await db.query('INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id',[randomUUID(),issuer,subject,name]);const user=account.rows[0].id;
 const workspace=await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET name=workspaces.name RETURNING id',[randomUUID(),user]);const tenant=workspace.rows[0].id;
 await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);await db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2) ON CONFLICT DO NOTHING',[tenant,emptyProfile]);
 if(previous)await db.query('DELETE FROM sessions WHERE token_hash=$1 AND user_id=$2',[digest(previous),user]);
 await db.query('INSERT INTO sessions(token_hash,user_id,csrf,authenticated_at) VALUES($1,$2,$3,$4)',[digest(token),user,csrf,issuer==='local-development'?new Date():authenticatedAt]);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 jar.set(cookieName,token,{httpOnly:true,secure:cookieName.startsWith('__Host-'),sameSite:'lax',path:'/',maxAge:604800});
}
export async function session(){const token=(await cookies()).get(cookieName)?.value;if(!token)return null;const result=await pool.query("UPDATE sessions s SET last_seen_at=now(),expires_at=least(now()+interval '12 hours',s.absolute_expires_at) FROM accounts a,workspaces w WHERE a.id=s.user_id AND w.owner_id=s.user_id AND s.token_hash=$1 AND s.expires_at>now() AND s.absolute_expires_at>now() RETURNING s.*,w.id tenant_id,a.name,a.issuer",[digest(token)]);return result.rows[0]??null;}
export function mutation(request:Request,s:{csrf:string}){if(request.headers.get('origin')!==process.env.APP_ORIGIN||request.headers.get('x-csrf-token')!==s.csrf)throw Object.assign(Error('Refresh this page before trying again'),{status:403});}
