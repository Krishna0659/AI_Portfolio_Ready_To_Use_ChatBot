/**
 * Phase 5 — Operational health endpoint.
 * Returns 200 with database connectivity status.
 * Used for readiness checks before hosting deployment.
 */
import {NextResponse} from 'next/server';
import {pool} from '../../../packages/db/index';
export const runtime='nodejs';
export async function GET(){
 try{
  const start=Date.now();
  await pool.query('SELECT 1');
  const latencyMs=Date.now()-start;
  return NextResponse.json({ok:true,db:'connected',latencyMs},{
   headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}
  });
 }catch(e){
  return NextResponse.json({ok:false,db:'error',error:(e as Error).message??'db unreachable'},{
   status:503,
   headers:{'Cache-Control':'no-store','Retry-After':'5','X-Robots-Tag':'noindex'}
  });
 }
}

