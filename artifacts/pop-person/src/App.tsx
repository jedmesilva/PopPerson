import PopPersonCanvas from './PopPersonCanvas';
import LegalPage from './LegalPage';
import NotFoundPage from './NotFoundPage';

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/privacy') return <LegalPage kind="privacy" locale="en" />;
  if (path === '/privacidade') return <LegalPage kind="privacy" locale="pt" />;
  if (path === '/terms') return <LegalPage kind="terms" locale="en" />;
  if (path === '/termos-de-servico') return <LegalPage kind="terms" locale="pt" />;

  if (path === '/') return <PopPersonCanvas />;

  return <NotFoundPage />;
}

export default App;