'use client';
import {useEffect,useRef,useState} from 'react';
import './chat.css';

type Answer={status:string;answer:string;profile_version:number;citations:{chunk_id:string;section:string}[]};
export default function ProfileChat({csrf,enabled,version,greeting}:{csrf:string;enabled:boolean;version:string;greeting:string}){
 const [question,setQuestion]=useState(''),[reply,setReply]=useState<Answer|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{controller.current?.abort();setReply(null);setError('');setBusy(false);return()=>controller.current?.abort();},[version,enabled]);
 async function ask(event:React.FormEvent){
  event.preventDefault();if(busy||!enabled)return;
  const request=new AbortController();controller.current=request;setBusy(true);setError('');setReply(null);
  try{
   const response=await fetch('/api/v1/chat',{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify({question})});
   const result=await response.json();if(!response.ok)throw Error(result.error??'Could not check your knowledge base. Please retry.');
   if(!request.signal.aborted)setReply(result);
  }catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:'Could not check your knowledge base. Please retry.');}
  finally{if(controller.current===request)setBusy(false);}
 }
 return <section className="panel profile-chat" aria-labelledby="profile-chat-title">
  <div className="section-heading"><h2 id="profile-chat-title">Ask your website</h2><span className="badge">Private chat</span></div>
  <p>{enabled?(greeting==='Ask about my work'?'Ask about this website':greeting):'Enable RAG in Settings, then review and approve your content with publishing selected. Chat becomes available when synchronization finishes.'}</p>
  <form onSubmit={ask}>
   <label htmlFor="profile-question">Your question</label>
   <textarea id="profile-question" rows={3} maxLength={1000} required value={question} onChange={e=>setQuestion(e.target.value)} disabled={!enabled||busy} placeholder="What does this website offer?"/>
   <button className="primary" disabled={!enabled||busy||!question.trim()}>{busy?'Checking your knowledge base…':'Ask question'}</button>
  </form>
  <div aria-live="polite" aria-busy={busy}>
   {error&&<p className="message error" role="alert">{error}</p>}
   {reply&&<div className="profile-answer"><p>{reply.answer}</p>{reply.citations.length>0&&<><h3>Sources · approved version {reply.profile_version}</h3><ul>{reply.citations.map(c=><li key={c.chunk_id}>{c.section}</li>)}</ul></>}</div>}
  </div>
  <p className="hint">Answers use your published, approved content. Missing information is reported explicitly. Draft edits are not included.</p>
 </section>;
}
