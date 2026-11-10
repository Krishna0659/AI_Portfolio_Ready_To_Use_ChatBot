import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import ThemeToggle from '../utils/ThemeToggle';
export const metadata={title:'PortfolioAI — Profile workspace',description:'Build a profile from evidence you review and approve.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<ThemeToggle/></body></html>;}
