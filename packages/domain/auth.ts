import {cookies} from 'next/headers';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {pool,transaction} from '../db';
import {emptyProfile} from '../contracts/profile';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export const cookieName=process.env.APP_ORIGIN?.startsWith('https:')?'__Host-portfolio_session':'portfolio_local_session';
export async function login(issuer:string,subject:string,name:string){
 const account=await pool.query('INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id',[randomUUID(),issuer,subject,name]);const user=account.rows[0].id;
 const workspace=await pool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET name=workspaces.name RETURNING id',[randomUUID(),user]);const tenant=workspace.rows[0].id;
 await transaction(tenant,db=>db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2) ON CONFLICT DO NOTHING',[tenant,emptyProfile]));
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');await pool.query('INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,$3)',[digest(token),user,csrf]);
 (await cookies()).set(cookieName,token,{httpOnly:true,secure:cookieName.startsWith('__Host-'),sameSite:'lax',path:'/',maxAge:43200});
}
export async function session(){const token=(await cookies()).get(cookieName)?.value;if(!token)return null;const result=await pool.query('SELECT s.*,w.id tenant_id,a.name FROM sessions s JOIN accounts a ON a.id=s.user_id JOIN workspaces w ON w.owner_id=s.user_id WHERE token_hash=$1 AND expires_at>now()',[digest(token)]);return result.rows[0]??null;}
export function mutation(request:Request,s:{csrf:string}){if(request.headers.get('origin')!==process.env.APP_ORIGIN||request.headers.get('x-csrf-token')!==s.csrf)throw Object.assign(Error('Refresh this page before trying again'),{status:403});}
