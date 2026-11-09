import Canyon404 from '@/components/errors/canyon404';

export const metadata = {title: '404 — Page not found | PortfolioAI'};

export default function NotFound() {
  return <Canyon404 errorCode="404" />;
}
