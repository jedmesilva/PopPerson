import PopPersonCanvas from './PopPersonCanvas';
import LegalPage from './LegalPage';

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/privacy') return <LegalPage kind="privacy" locale="en" />;
  if (path === '/privacidade') return <LegalPage kind="privacy" locale="pt" />;
  if (path === '/terms') return <LegalPage kind="terms" locale="en" />;
  if (path === '/termos-de-servico') return <LegalPage kind="terms" locale="pt" />;

  return <PopPersonCanvas />;
}

export default App;