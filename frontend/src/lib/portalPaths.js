/**
 * portalPaths
 * Where a shared screen's links should point, given who is looking.
 *
 * Since migration 0039 the department screens (queries, faculty,
 * students, at-risk, reports, jobs) are served twice: under /hod for a
 * HOD, who sees the faculty mapped to them, and under /admin for the
 * administrator, who sees the whole department. The cluster head's upload
 * screens are likewise served twice: under /cluster-head, and under
 * /hod/uploads inside the HOD portal.
 *
 * A page never hard-codes either prefix; it asks here (or through
 * usePortalPaths, which reads the role from the signed-in profile).
 */

/** /hod or /admin: the department screens of this role's portal. */
export function departmentBase(role) {
  return role === 'admin' ? '/admin' : '/hod';
}

/** /cluster-head, or /hod/uploads for a HOD (and anyone else upload-capable). */
export function uploadsBase(role) {
  return role === 'cluster_head' ? '/cluster-head' : '/hod/uploads';
}
