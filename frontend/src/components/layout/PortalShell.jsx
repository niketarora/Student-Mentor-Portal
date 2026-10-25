/**
 * PortalShell
 * The frame every signed-in page renders inside. Identical chrome for
 * student, faculty and HOD — only the sidebar menu changes — so the three
 * portals look and behave like one product.
 *
 * activeNav (optional): the menu item to mark when the URL alone would
 * mark the wrong one.
 */

import { useState } from 'react';
import SidebarNavigation from './SidebarNavigation.jsx';
import TopBar from './TopBar.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';

export default function PortalShell({ children, searchPlaceholder, onSearch, activeNav }) {
  const { profile } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SidebarNavigation
        role={profile?.role}
        profile={profile}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
        onNavigate={() => setSidebarOpen(false)}
        activeNav={activeNav}
      />

      <div className="lg:pl-sidebar">
        <TopBar
          onToggleSidebar={() => setSidebarOpen((value) => !value)}
          searchPlaceholder={searchPlaceholder}
          onSearch={onSearch}
        />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
