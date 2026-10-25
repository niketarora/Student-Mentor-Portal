import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider.jsx';
import { HOME_PATH } from '../lib/constants.js';

export default function NotFoundPage() {
  const { profile } = useAuth();
  const home = HOME_PATH[profile?.role] ?? '/login';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="text-display-lg text-primary">404</p>
      <h1 className="mt-2 text-headline-md text-on-surface">Page not found</h1>
      <p className="mt-2 max-w-sm text-body-sm text-on-surface-variant">
        The page you are looking for does not exist, or you do not have access to it.
      </p>
      <Link to={home} className="btn-primary mt-6">
        Back to my dashboard
      </Link>
    </div>
  );
}
