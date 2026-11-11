import {NextResponse} from 'next/server';
import * as oidc from 'openid-client';
import {cookies} from 'next/headers';
import {identityPool as pool} from '../../../../packages/db';
import {appendFile,mkdir} from 'node:fs/promises';
import {authDiagnostic,authErrorMessage} from '../../../../packages/domain/auth-errors';
import {sealFlow,openFlow,verifyGoogleCallback} from '../../../../packages/domain/oidc-flow';
import {login,session,mutation,cookieName,digest} from '../../../../packages/domain/auth';
import {completeGoogleReauth} from '../../../../packages/domain/google-reauth';
export const runtime='nodejs';
async function config(){if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)throw Error('Google sign-in needs configuration');const c=await oidc.discovery(new URL('https://accounts.google.com'),process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET);return c;}
export async function GET(req:Request,{params}:{params:Promise<{action:string}>}){const {action}=await params;let stage='discovery';try{
 if(action==='google'||action==='google-reauth'){
  const current=action==='google-reauth'?await session():null;
  if(action==='google-reauth'&&!current)return NextResponse.json({error:'Sign in first.'},{status:401});
  const reauth=current?{user:current.user_id,session:current.token_hash}:undefined;
  const c=await config(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
  await pool.query('DELETE FROM auth_flows WHERE expires_at<=now()');
  await pool.query('INSERT INTO auth_flows(state,verifier,nonce) VALUES($1,$2,$3)',[state,sealFlow({verifier,nonce,reauth},state),'sealed-v1']);
  (await cookies()).set('oidc_state',state,{httpOnly:true,sameSite:'lax',secure:process.env.APP_ORIGIN?.startsWith('https:'),path:'/',maxAge:600});
  return NextResponse.redirect(oidc.buildAuthorizationUrl(c,{redirect_uri:process.env.APP_ORIGIN+'/api/auth/callback',scope:'openid email profile',prompt:'select_account',...(reauth?{max_age:'300'}:{}),claims:JSON.stringify({id_token:{auth_time:{essential:true}}}),state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'}));
 }
 if(action==='callback'){
  stage='state';const url=new URL(req.url),state=url.searchParams.get('state');
  if(!state||state!==(await cookies()).get('oidc_state')?.value)throw Error('Invalid login state');
  stage='flow';const result=await pool.query('DELETE FROM auth_flows WHERE state=$1 AND expires_at>now() RETURNING *',[state]);
  if(!result.rows.length)throw Error('Login expired');
  const f=openFlow(result.rows[0].verifier,state);stage='discovery';const c=await config();stage='provider';
  const identity=await verifyGoogleCallback(c,new URL(process.env.APP_ORIGIN+url.pathname+url.search),f,state);stage='account';
  if(f.reauth)await completeGoogleReauth(f.reauth,await session(),identity);
  else await login(identity.issuer,identity.subject,identity.name,identity.authenticatedAt);
  (await cookies()).delete('oidc_state');return NextResponse.redirect(new URL('/',process.env.APP_ORIGIN));
 }
 return NextResponse.json({error:'Not found'},{status:404});
 }catch(error){const diagnostic=authDiagnostic(stage,error);await mkdir('.local',{recursive:true});await appendFile('.local/auth-diagnostics.jsonl',JSON.stringify(diagnostic)+'\n').catch(()=>{});return NextResponse.json({error:authErrorMessage(stage),reference:diagnostic.reference},{status:400,headers:{'Cache-Control':'no-store'}});}}
export async function POST(req:Request,{params}:{params:Promise<{action:string}>}){const {action}=await params;if(req.headers.get('origin')!==process.env.APP_ORIGIN)return NextResponse.json({error:'Origin rejected'},{status:403});
 if(action==='local')return NextResponse.json({error:'Use Google to sign in.'},{status:410});
 if(action==='logout'){const s=await session();if(s){try{mutation(req,s);}catch{return NextResponse.json({error:'Request rejected'},{status:403});}await pool.query('DELETE FROM sessions WHERE token_hash=$1',[s.token_hash]);}(await cookies()).delete(cookieName);return NextResponse.json({ok:true});}return NextResponse.json({error:'Unavailable'},{status:404});}
