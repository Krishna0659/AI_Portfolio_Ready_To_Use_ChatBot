const pages = ['Overview', 'Sources', 'Review', 'Versions', 'Settings'];
const paths = [
  'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  'M3 7h7l2-3h9v16H3z M7 12h10 M7 16h7',
  'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
  'M4 5h16v4H4z M6 9v12h12V9 M9 14h6',
  'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
];

export default function WorkspaceSidebar({active, name, sourceCount, dirty, busy, onNavigate, onSignOut}: {
  active: string; name: string; sourceCount: number; dirty: boolean; busy: boolean;
  onNavigate: (page: string) => void; onSignOut: () => void;
}) {
  return <aside className="sidebar">
    <button className="brand" type="button" onClick={() => onNavigate('Overview')} aria-label="PortfolioAI overview"><span className="brand-mark">p</span>portfolio<span className="brand-ai">ai</span></button>
    <div className="workspace-name">Your workspace<small title={name}>{name}</small></div>
    <nav aria-label="Workspace">{pages.map((page, i) => <button key={page} type="button" className={active === page ? 'active' : ''} aria-current={active === page ? 'page' : undefined} onClick={() => onNavigate(page)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[i]}/></svg>
      {page}{page === 'Sources' && <span>{sourceCount}</span>}{page === 'Review' && dirty && <span className="dot" aria-label="Unsaved changes"/>}
    </button>)}</nav>
    <div className="sidebar-bottom"><div className="privacy-note"><strong>Your story. Your say.</strong><small>Review every fact before approving. Your profile stays private.</small></div><button type="button" disabled={busy} onClick={onSignOut}>Sign out <span aria-hidden="true">↗</span></button></div>
  </aside>;
}
