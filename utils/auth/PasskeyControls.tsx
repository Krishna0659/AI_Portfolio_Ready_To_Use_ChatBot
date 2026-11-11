'use client';
import {useState} from 'react';
import {startRegistration,startAuthentication} from '@simplewebauthn/browser';

export default function PasskeyControls({csrf,disabled=false}:{csrf:string;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function request(action:string,body?:unknown){
  const response=await fetch('/api/passkeys/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body??{})});
  const data=await response.json();if(!response.ok)throw Error(data.error);return data;
 }
 async function run(purpose:'register'|'verify'){
  setBusy(true);setError('');setMessage('');
  try{
   const optionsJSON=await request(purpose+'-options');
   const response=purpose==='register'?await startRegistration({optionsJSON}):await startAuthentication({optionsJSON});
   await request(purpose,response);
   setMessage(purpose==='register'?'Passkey added. Verify with it before deleting data.':'Identity verified for five minutes. You can now confirm the sensitive action.');
  }catch(e){setError(e instanceof Error?e.message:'Verification did not complete. Try again.');}finally{setBusy(false);}
 }
 return <section className="account-deletion" aria-label="Identity verification"><h2>Verify your identity</h2><p>Use Windows Hello, a security key or a compatible phone to confirm sensitive actions. Google remains your sign-in method.</p><p>Before adding a passkey, verify with the same Google account. Save any draft changes first.</p><div className="version-actions"><a className="button" aria-disabled={disabled||busy} href={disabled||busy?undefined:'/api/auth/google-reauth'}>Verify with Google</a><button disabled={disabled||busy} onClick={()=>run('register')}>Add a passkey</button><button disabled={disabled||busy} onClick={()=>run('verify')}>Verify with passkey</button></div>{busy&&<p role="status">Follow your browser’s verification prompt…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
