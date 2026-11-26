import type {MetadataRoute} from 'next';
import {siteUrl,indexable} from '@/utils/seo/config';
export default function robots(): MetadataRoute.Robots {
  return indexable ? {rules:{userAgent:'*',allow:'/',disallow:['/api/','/settings']},sitemap:new URL('/sitemap.xml',siteUrl).href} : {rules:{userAgent:'*',disallow:'/'}};
}
