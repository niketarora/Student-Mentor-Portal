import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthProvider.jsx';
import { ToastProvider } from './context/ToastProvider.jsx';
import { NotificationProvider } from './context/NotificationProvider.jsx';
import AppRouter from './routes/AppRouter.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <NotificationProvider>
              <AppRouter />
            </NotificationProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
