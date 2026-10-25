/**
 * TopBar
 * White strip across the top: menu toggle, global search, notification
 * bell and the "REGISTRATION-NO :: NAME" identity block on the right —
 * the same arrangement as the MUJ SLCM portal.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationBell from './NotificationBell.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';
import { HOME_PATH, ROLE_LABELS } from '../../lib/constants.js';

export default function TopBar({ onToggleSidebar, searchPlaceholder, onSearch }) {
  const { profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [term, setTerm] = useState('');
  const menuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  // Debounce so we are not re-querying on every keystroke.
  useEffect(() => {
    if (!onSearch) return undefined;
    const timer = setTimeout(() => onSearch(term), 320);
    return () => clearTimeout(timer);
  }, [term, onSearch]);

  const profilePath = `${HOME_PATH[profile?.role] ?? ''}/profile`;

  return (
    <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-topbar-border bg-topbar px-4 lg:px-6">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="rounded-lg p-2 text-primary hover:bg-surface-container lg:hidden"
        aria-label="Open menu"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>

      {onSearch && (
        <div className="relative hidden max-w-xl flex-1 md:block">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-tertiary"
            aria-hidden="true"
          >
            search
          </span>
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={searchPlaceholder ?? 'Search...'}
            aria-label={searchPlaceholder ?? 'Search'}
            className="w-full rounded-full border border-outline-variant bg-surface-container-low py-2.5 pl-11 pr-5 text-body-sm placeholder:text-tertiary focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15"
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex items-center gap-2.5 rounded-full py-1 pl-3 pr-1 transition-colors hover:bg-surface-container"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <span className="hidden text-right sm:block">
              <span className="block text-label-md leading-tight text-primary">
                {profile?.login_id ? `${profile.login_id} :: ` : ''}
                {profile?.full_name?.toUpperCase()}
              </span>
              <span className="block text-label-sm leading-tight text-tertiary">
                {ROLE_LABELS[profile?.role]}
              </span>
            </span>
            <Avatar path={profile?.avatar_url} name={profile?.full_name} size={38} />
          </button>

          {menuOpen && (
            <div className="animate-scale-in absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-topbar-border bg-surface-container-lowest shadow-dropdown">
              <div className="border-b border-topbar-border px-4 py-3">
                <p className="truncate text-label-md text-on-surface">{profile?.full_name}</p>
                <p className="truncate text-label-sm text-tertiary">{profile?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate(profilePath);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-body-sm hover:bg-surface-container-low"
              >
                <span className="material-symbols-outlined text-[19px] text-on-surface-variant">person</span>
                My profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/change-password');
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-body-sm hover:bg-surface-container-low"
              >
                <span className="material-symbols-outlined text-[19px] text-on-surface-variant">lock_reset</span>
                Change password
              </button>
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2.5 border-t border-topbar-border px-4 py-2.5 text-left text-body-sm text-error hover:bg-error-container/40"
              >
                <span className="material-symbols-outlined text-[19px]">logout</span>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
