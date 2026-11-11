import {NextResponse} from 'next/server';
import {session,mutation} from '../../../../packages/domain/auth';
import {passkeyOptions,finishPasskey} from '../../../../packages/domain/passkeys';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';
export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{action:string}>}){
 try{
  const actor=await session();if(!actor)return NextResponse.json({error:'Sign in first.'},{status:401});
  mutation(req,actor);
  const {action}=await params;
  if(action==='register-options'||action==='verify-options')return NextResponse.json(await passkeyOptions(actor,action==='register-options'?'register':'verify'),{headers:{'Cache-Control':'no-store'}});
  if(action!=='register'&&action!=='verify')return NextResponse.json({error:'Not found'},{status:404});
  const reader=req.body?.getReader();if(!reader)throw Error('Missing response');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>65536){await reader.cancel();return NextResponse.json({error:'Response too large'},{status:413});}chunks.push(item.value);}
  const response=JSON.parse(Buffer.concat(chunks).toString()) as RegistrationResponseJSON|AuthenticationResponseJSON;
  await finishPasskey(actor,action,response);
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){const error=e as Error&{status?:number};return NextResponse.json({error:error.status?error.message:'Verification failed. Please start again.'},{status:error.status??400,headers:{'Cache-Control':'no-store'}});}
}
