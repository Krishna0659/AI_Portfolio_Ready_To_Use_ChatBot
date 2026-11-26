/** Deployment opts in explicitly; local workspaces never advertise a fake origin. */
export function publicSiteUrl(): URL | undefined {
  const value = process.env.SITE_URL;
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('SITE_URL must be a public HTTPS origin');
  return url;
}
export const siteUrl = publicSiteUrl();
export const indexable = Boolean(siteUrl && process.env.SEO_INDEXABLE === 'true');
export const description = 'Build a professional profile from your website, GitHub and documents. Review the evidence, approve your profile and export it with PortfolioAI.';
