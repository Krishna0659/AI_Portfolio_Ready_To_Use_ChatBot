'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import './auth.css';

const PrismBackground=dynamic(()=>import('./PrismBackground'),{ssr:false});

export default function AuthScreen({ error }: { error?: string }) {
  const [paused,setPaused]=useState(true);
  useEffect(()=>{const preference=matchMedia('(prefers-reduced-motion: reduce)');const sync=()=>setPaused(preference.matches);sync();preference.addEventListener('change',sync);return()=>preference.removeEventListener('change',sync);},[]);
  return <main className="auth-screen" aria-labelledby="auth-heading">
    <div className="auth-scenery" aria-hidden="true"><PrismBackground paused={paused}/></div>
    <header className="auth-masthead"><a className="auth-wordmark" href="/landing" aria-label="SiteSage home"><span className="auth-brand-mark" aria-hidden="true">s</span>SiteSage</a></header>
    <div className="auth-content"><div className="auth-story"><h1 id="auth-heading">Your website.<br/><em>Ready to answer.</em></h1><p>Bring your content together.<br/>Give every question a better starting point.</p></div>
    <section className="auth-panel" aria-labelledby="auth-signin">
      <h2 id="auth-signin">Welcome to SiteSage</h2>
      <p className="auth-intro">One workspace for your website, documents and the answers within them.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <a className="auth-google" href="/api/auth/google">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.59A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.35-2.59Z" />
            <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z" />
          </svg>
        Continue with Google
      </a>
      <p className="auth-new">Sign in or create an account with Google.</p>
      <div className="auth-note"><strong>You choose what becomes knowledge.</strong><p>Imported content is only used for answers after you review and approve it.</p></div>
    </section></div>
    <footer className="auth-footer"><span>Your sources. Your approval.</span><div className="auth-footer-actions"><a href="/landing">Explore SiteSage</a><button className="auth-motion" type="button" aria-pressed={paused} onClick={()=>setPaused(!paused)}><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{paused?<path d="m5 3 8 5-8 5V3Z"/>:<path d="M4 3h3v10H4zm5 0h3v10H9z"/>}</svg>{paused?'Enable motion':'Pause motion'}</button></div></footer>
  </main>;
}
