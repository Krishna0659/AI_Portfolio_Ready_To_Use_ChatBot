import {fixturePool} from './fixture-db';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../packages/db';
import {emptyProfile} from '../packages/contracts/profile';
test('runtime RLS rejects foreign reads and writes and resets pooled context',async()=>{
 const a=randomUUID(),b=randomUUID(),ua=randomUUID(),ub=randomUUID();
 try{
 await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1::uuid,'test',$1::text,'A'),($2::uuid,'test',$2::text,'B')",[ua,ub]);await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$4)',[a,ua,b,ub]);
 await transaction(a,db=>db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[a,emptyProfile]));await transaction(b,db=>db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[b,emptyProfile]));
 assert.equal((await transaction(a,db=>db.query('SELECT * FROM drafts WHERE tenant_id=$1',[b]))).rowCount,0);
 await assert.rejects(transaction(a,db=>db.query('INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,\'web\',\'test\',\'https://example.com\')',[randomUUID(),b])));
 assert.equal((await pool.query('SELECT * FROM drafts')).rowCount,0);
 }finally{await fixturePool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])',[[a,b]]);await fixturePool.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])',[[ua,ub]]);await pool.end();await fixturePool.end();}
});

