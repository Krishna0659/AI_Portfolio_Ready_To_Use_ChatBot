export default function SummaryCards({items}: {items: {label: string; value: number; detail: string; onClick: () => void}[]}) {
  return <div className="summary-cards" aria-label="Workspace summary">{items.map(item => <button type="button" className="summary-card" key={item.label} onClick={item.onClick}>
    <span className="summary-label">{item.label}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 19 19 5 M5 5h14v14"/></svg></span>
    <strong>{item.value}</strong><small>{item.detail}</small>
  </button>)}</div>;
}
