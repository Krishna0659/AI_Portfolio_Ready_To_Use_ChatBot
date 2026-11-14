'use client';
import {useState} from 'react';
import {startRegistration,startAuthentication} from '@simplewebauthn/browser';

export default function PasskeyControls({csrf,disabled=false,standalone=false,className}:{csrf:string;disabled?:boolean;standalone?:boolean;className?:string}){
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
 const containerClass=className??(standalone?'passkey-section':'account-deletion');
 return <section className={containerClass} aria-labelledby="passkey-heading" aria-busy={busy}>
  <h2 id="passkey-heading">Verify your identity</h2>
  <p>Use Windows Hello, a security key or a compatible phone to confirm sensitive actions. Google remains your sign-in method.</p>
  <p>Choose Verify with Google using the same account, then return to Settings and add a passkey within five minutes. This confirms account access; Google may not ask for your password. Save any draft changes first.</p>
  <div className="version-actions" role="group" aria-label="Identity verification actions">
    <a className="button" aria-disabled={disabled||busy} tabIndex={disabled||busy?-1:0} href={disabled||busy?undefined:'/api/auth/google-reauth'}>Verify with Google</a>
    <button type="button" disabled={disabled||busy} onClick={()=>run('register')}>Add a passkey</button>
    <button type="button" disabled={disabled||busy} onClick={()=>run('verify')}>Verify with passkey</button>
  </div>
  {busy&&<div className="message" role="status" aria-live="polite">Follow your browser’s verification prompt…</div>}
  {message&&<div className="message" role="status" aria-live="polite">{message}</div>}
  {error&&<div className="message error" role="alert" aria-live="assertive">{error}</div>}
 </section>;
}
