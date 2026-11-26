import Dashboard from '../workspace';

export const metadata = {
  title: 'SiteSage — Settings',
  description: 'Manage your website chat preferences, passkeys, and account settings.'
};

export default function SettingsPage() {
  return <Dashboard initialTab="Settings" />;
}
