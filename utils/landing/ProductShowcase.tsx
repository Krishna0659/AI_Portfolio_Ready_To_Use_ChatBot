export default function ProductShowcase() {
  return (
    <section className="lp-showcase" aria-labelledby="showcase-heading">
      <div className="lp-section-heading">
        <h2 id="showcase-heading">The details.<br /><em>And the bigger picture.</em></h2>
        <p>See where a detail came from. Decide how it belongs in your profile.</p>
      </div>
      <div className="lp-showcase-grid">
        <figure className="lp-showcase-evidence">
          <div className="lp-sample-sheet">
            <header className="lp-sample-header"><span>Source evidence</span><span>Illustrative sample</span></header>
            <h3>Community garden planner</h3>
            <dl className="lp-sample-meta">
              <div><dt>Source</dt><dd>GitHub README</dd></div>
              <div><dt>Import state</dt><dd>Ready to review</dd></div>
            </dl>
            <blockquote>“A small planning tool that helps volunteers coordinate planting days and share garden tasks.”</blockquote>
            <p className="lp-sample-note">Captured evidence stays separate from the profile draft.</p>
          </div>
          <figcaption><strong>Start with the source.</strong> Read captured evidence before choosing details for your draft. Sample content, not a connected account.</figcaption>
        </figure>
        <figure className="lp-showcase-profile">
          <div className="lp-sample-sheet">
            <header className="lp-sample-header"><span>Profile version</span><span>Illustrative sample</span></header>
            <h3>Alex Morgan</h3>
            <p className="lp-sample-summary">I build practical tools for community projects.</p>
            <dl className="lp-sample-meta">
              <div><dt>Project</dt><dd>Community garden planner</dd></div>
              <div><dt>Status</dt><dd>Approved version</dd></div>
              <div><dt>Export formats</dt><dd>JSON · Markdown</dd></div>
            </dl>
            <p className="lp-sample-note">Approval saves a version. Export is a separate step.</p>
          </div>
          <figcaption><strong>Make it yours.</strong> Review and approve the profile you want to keep. Fictional person and project; this is a layout illustration.</figcaption>
        </figure>
      </div>
    </section>
  );
}
