/**
 * usePortalPaths
 * The signed-in user's link prefixes for the screens that are served in
 * more than one portal. See lib/portalPaths.js.
 */

import { useAuth } from '../context/AuthProvider.jsx';
import { departmentBase, uploadsBase } from '../lib/portalPaths.js';

export function usePortalPaths() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  return {
    role,
    departmentBase: departmentBase(role),
    uploadsBase: uploadsBase(role),
    // The cluster head's upload screens, opened from the HOD portal: no
    // subject list, subjects read from the attendance files instead.
    isHodUploads: role === 'hod',
    isAdmin: role === 'admin'
  };
}
