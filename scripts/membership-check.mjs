import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();const fixture=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await fixture.connect();
const user=randomUUID(),tenant=randomUUID(),token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
const headers={cookie:`portfolio_local_session=${token}`,origin:'http://localhost:3000','x-csrf-token':csrf,'content-type':'application/json'};
try{
 await fixture.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'membership-api',$2,'Disposable fixture')",[user,user]);await fixture.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenant]);await db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[tenant,{schemaVersion:1,displayName:'',headline:'',sections:[]}]);await fixture.query('INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),user,csrf]);
 const read=()=>fetch('http://localhost:3000/api/v1/workspace',{headers});assert.equal((await read()).status,200);
 await fixture.query("UPDATE memberships SET role='viewer' WHERE tenant_id=$1",[tenant]);assert.equal((await read()).status,200);
 const mutation=await fetch('http://localhost:3000/api/v1/settings',{method:'POST',headers,body:JSON.stringify({theme:'light',greeting:'Fixture',position:'bottom_right',integration:'disabled'})});assert.equal(mutation.status,403);
 await fixture.query('UPDATE memberships SET active=false WHERE tenant_id=$1',[tenant]);assert.equal((await read()).status,401);
 await fixture.query("UPDATE memberships SET active=true,role='owner' WHERE tenant_id=$1",[tenant]);await fixture.query('UPDATE workspaces SET active=false WHERE id=$1',[tenant]);assert.equal((await read()).status,401);
 console.log('API checks passed: active owner access, viewer read-only access, revoked membership and disabled workspace rejection.');
}finally{await fixture.query('DELETE FROM sessions WHERE user_id=$1',[user]);await fixture.query('DELETE FROM workspaces WHERE id=$1',[tenant]);await fixture.query('DELETE FROM accounts WHERE id=$1',[user]);await db.end();await fixture.end();}
