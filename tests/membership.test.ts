import {fixturePool} from './fixture-db';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../packages/db';
import {authorizedTransaction} from '../packages/domain/authorization';
after(()=>Promise.all([pool.end(),fixturePool.end()]));
test('membership requires active tenant and member, and reserves mutations for owners',async()=>{
 const user=randomUUID(),stranger=randomUUID(),tenant=randomUUID();
 try{
 await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1::uuid,'membership-test',$1::text,'Owner'),($2::uuid,'membership-test',$2::text,'Stranger')",[user,stranger]);
 await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
 const read=()=>authorizedTransaction(tenant,user,false,async()=>true);
 assert.equal(await read(),true);await assert.rejects(authorizedTransaction(tenant,stranger,false,async()=>true),/Workspace not found/);
 await fixturePool.query("UPDATE memberships SET role='viewer' WHERE tenant_id=$1",[tenant]);assert.equal(await read(),true);await assert.rejects(authorizedTransaction(tenant,user,true,async()=>true),/Only the workspace owner/);
 await fixturePool.query('UPDATE memberships SET active=false WHERE tenant_id=$1',[tenant]);await assert.rejects(read(),/Workspace not found/);
 await fixturePool.query("UPDATE memberships SET active=true,role='owner' WHERE tenant_id=$1",[tenant]);await fixturePool.query('UPDATE workspaces SET active=false WHERE id=$1',[tenant]);await assert.rejects(read(),/Workspace not found/);
 assert.equal((await pool.query("SELECT nullif(current_setting('app.user_id',true),'') actor")).rows[0].actor,null);
 }finally{await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);await fixturePool.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])',[[user,stranger]]);}
});
