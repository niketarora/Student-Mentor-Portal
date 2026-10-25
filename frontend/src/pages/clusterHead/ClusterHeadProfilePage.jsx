/**
 * The profile screen is identical for every role — contact details, photo,
 * password — so the Cluster Head re-exports it exactly as HodProfilePage
 * does rather than growing a fourth copy that would drift.
 */
export { default } from '../faculty/FacultyProfilePage.jsx';
