import Dashboard from '../workspace';

export const metadata = {
  title: 'PortfolioAI — Settings',
  description: 'Manage your profile preferences, passkeys, and account settings.'
};

export default function SettingsPage() {
  return <Dashboard initialTab="Settings" />;
}
