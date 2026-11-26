import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import LandingPage from '@/utils/landing/LandingPage';
import type {Metadata} from 'next';
import {siteUrl,indexable,description} from '@/utils/seo/config';

export const metadata: Metadata = {
  metadataBase:siteUrl,
  title:'SiteSage — Turn website content into grounded answers',description,
  robots:{index:indexable,follow:indexable},
  ...(siteUrl ? {alternates:{canonical:new URL('/landing',siteUrl).href}} : {}),
  openGraph:{type:'website',siteName:'SiteSage',title:'SiteSage — Your website, ready to answer',description,...(siteUrl ? {url:new URL('/landing',siteUrl).href}: {})},
  twitter:{card:'summary_large_image',title:'SiteSage — Your website, ready to answer',description,images:['/landing/opengraph-image']}
};
export default function Page() { return <LandingPage />; }
