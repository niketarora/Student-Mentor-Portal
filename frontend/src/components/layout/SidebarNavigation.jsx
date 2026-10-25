/**
 * SidebarNavigation
 * The SSMP Nexus left rail: white background, brand block at the top,
 * an orange pill marking the current page, and a user card with Sign Out
 * pinned to the bottom.
 *
 * One component for every portal; only the item list differs, which
 * comes from NAVIGATION in lib/constants.js. An item with children (the
 * HOD's Uploads) is a group that opens into a sub-list.
 */

import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import mujLogo from '../../assets/manipal-university-jaipur-logo.png';
import { NAVIGATION, ROLE_LABELS } from '../../lib/constants.js';
import Avatar from '../ui/Avatar.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';

const ROLE_SUBTITLE = {
  student: 'Student Portal',
  faculty: 'Faculty Mentor',
  hod: 'Head of Department',
  cluster_head: 'Cluster Head',
  admin: 'Administrator'
};

/**
 * A page can name the item to mark (activeNav) when its URL alone says
 * the wrong one: a query opened from Raised to HOD lives under
 * /hod/queries/:id, which would otherwise light up All Queries.
 */
function NavItem({ item, onNavigate, nested = false, activeNav }) {
  const className = (active) => `sidebar-link ${nested ? 'pl-9' : ''} ${active ? 'sidebar-link-active' : ''}`;
  const content = (
    <>
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </>
  );
  if (activeNav) {
    const active = item.to === activeNav;
    return (
      <Link to={item.to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={className(active)}>
        {content}
      </Link>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => className(isActive)}>
      {content}
    </NavLink>
  );
}

/**
 * A heading that opens into its own list. Every page mounts its own
 * shell, so the group starts open whenever the current page is one of
 * its own and closed otherwise; the heading folds it either way. Folded
 * over the current page, the heading itself carries the active pill.
 */
function NavGroup({ group, onNavigate, activeNav }) {
  const { pathname } = useLocation();
  const inside = pathname === group.base || pathname.startsWith(`${group.base}/`);
  const [expanded, setExpanded] = useState(inside);
  const listId = `nav-group-${group.base.replace(/[^a-z0-9]+/gi, '-')}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={listId}
        className={`sidebar-link w-full ${inside && !expanded ? 'sidebar-link-active' : ''} ${inside && expanded ? 'text-primary' : ''}`}
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
          {group.icon}
        </span>
        <span>{group.label}</span>
        <span
          className={`material-symbols-outlined ml-auto text-[18px] transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>
      {expanded && (
        <ul id={listId} className="mt-1 space-y-1">
          {group.children.map((child) => (
            <li key={child.to}>
              <NavItem item={child} onNavigate={onNavigate} nested activeNav={activeNav} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function SidebarNavigation({ role, profile, isOpen, onToggle, onNavigate, activeNav }) {
  const { signOut } = useAuth();
  // `when` lets an item appear only for some users — e.g. Group Queries,
  // which only the star mentee can see.
  const items = (NAVIGATION[role] ?? []).filter((item) => (item.when ? item.when(profile) : true));

  return (
    <>
      {/* Mobile scrim */}
      {isOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onToggle}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand block */}
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <img
              src={mujLogo}
              alt="Manipal University Jaipur"
              className="h-9 w-auto max-w-[150px] object-contain"
            />
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container lg:hidden"
              aria-label="Close menu"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <p className="mt-4 text-headline-sm leading-tight text-primary">SMP Portal</p>
          <p className="text-label-sm uppercase tracking-[0.12em] text-tertiary">
            {ROLE_SUBTITLE[role] ?? 'Portal'}
          </p>
        </div>

        <nav className="custom-scrollbar flex-1 overflow-y-auto px-3 pb-4" aria-label="Main menu">
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.to ?? item.base}>
                {item.children ? (
                  <NavGroup group={item} onNavigate={onNavigate} activeNav={activeNav} />
                ) : (
                  <NavItem item={item} onNavigate={onNavigate} activeNav={activeNav} />
                )}
              </li>
            ))}
          </ul>
        </nav>

        {/* User card */}
        <div className="border-t border-sidebar-border p-3">
          <div className="rounded-xl bg-surface-container-low p-3">
            <div className="flex items-center gap-3">
              <Avatar path={profile?.avatar_url} name={profile?.full_name} size={38} />
              <span className="min-w-0">
                <span className="block truncate text-label-md text-on-surface">{profile?.full_name}</span>
                <span className="block truncate text-label-sm uppercase tracking-wide text-tertiary">
                  {ROLE_LABELS[role] ?? 'User'}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-label-md text-error transition-colors hover:bg-error-container/50"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">logout</span>
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
