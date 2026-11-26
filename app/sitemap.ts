import type {MetadataRoute} from 'next';
import {siteUrl,indexable} from '@/utils/seo/config';
export default function sitemap(): MetadataRoute.Sitemap {
  return indexable ? [{url:new URL('/landing',siteUrl).href}] : [];
}
