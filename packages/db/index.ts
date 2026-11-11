import pg from 'pg';
import {existsSync} from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
// This milestone has local-only auth/storage boundaries; fail closed outside loopback.
const origin=new URL(process.env.APP_ORIGIN??'http://localhost:3000');
if(!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('This implementation is local-only. Complete the release gates before enabling a non-local origin.');
const globalDb=globalThis as unknown as {pool:pg.Pool;identityPool:pg.Pool;workerPool:pg.Pool};
export const pool=globalDb.pool??=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
if(!process.env.IDENTITY_DATABASE_URL)throw Error('IDENTITY_DATABASE_URL must be configured separately from workspace access');
export const identityPool=globalDb.identityPool??=new pg.Pool({connectionString:process.env.IDENTITY_DATABASE_URL,max:4});
if(!process.env.WORKER_DATABASE_URL)throw Error('WORKER_DATABASE_URL must be configured separately from workspace access');
export const workerPool=globalDb.workerPool??=new pg.Pool({connectionString:process.env.WORKER_DATABASE_URL,max:4});
export async function identityTransaction<T>(tenant:string,fn:(db:pg.PoolClient)=>Promise<T>){const db=await identityPool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export async function transaction<T>(tenant:string,fn:(db:pg.PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
