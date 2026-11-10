'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import './auth.css';

const PrismBackground = dynamic(() => import('./PrismBackground'), { ssr: false });

export default function AuthScreen({ error }: { error?: string }) {
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPaused(preference.matches);
    syncPreference();
    preference.addEventListener('change', syncPreference);
    return () => preference.removeEventListener('change', syncPreference);
  }, []);

  return (
    <main className="auth-screen" aria-labelledby="auth-heading">
      <div className="auth-scenery" aria-hidden="true"><PrismBackground paused={paused} /></div>
      <header className="auth-masthead"><span className="auth-wordmark" aria-label="PortfolioAI">portfolio<em>ai</em></span></header>
      <section className="auth-panel">
        <h1 id="auth-heading">Welcome<br /><em>back.</em></h1>
        <p className="auth-intro">Your work. Your story.<br />A little more you, all in one place.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <a className="auth-google" href="/api/auth/google">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.59A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.35-2.59Z" />
            <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z" />
          </svg>
          Continue with Google
          <svg className="auth-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </a>
        <p className="auth-new">New here? Your story starts here.<br />Use Google to create your account.</p>
      </section>
      <footer className="auth-footer">
        <p>Evidence first. <em>Your word, always.</em></p>
        <button className="auth-motion" type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{paused ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}</svg>
          {paused ? 'Enable motion' : 'Pause motion'}
        </button>
      </footer>
    </main>
  );
}
