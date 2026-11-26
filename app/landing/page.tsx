import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import LandingPage from '@/utils/landing/LandingPage';
import type {Metadata} from 'next';
import {siteUrl,indexable,description} from '@/utils/seo/config';

export const metadata: Metadata = {
  metadataBase:siteUrl,
  title:'PortfolioAI — Build an evidence-backed professional profile',description,
  robots:{index:indexable,follow:indexable},
  ...(siteUrl ? {alternates:{canonical:new URL('/landing',siteUrl).href}} : {}),
  openGraph:{type:'website',siteName:'PortfolioAI',title:'PortfolioAI — Your work, brought together',description,...(siteUrl ? {url:new URL('/landing',siteUrl).href}: {})},
  twitter:{card:'summary_large_image',title:'PortfolioAI — Your work, brought together',description,images:['/landing/opengraph-image']}
};
export default function Page() { return <LandingPage />; }
