const QUERY_STATUS_STYLES = {
  Open: { className: 'bg-error-container text-on-error-container', icon: 'radio_button_checked' },
  'In Progress': { className: 'bg-warning-container text-on-warning-container', icon: 'autorenew' },
  Resolved: { className: 'bg-success-container text-on-success-container', icon: 'task_alt' }
};

const RESOLUTION_STYLES = {
  pending_confirmation: { label: 'Awaiting confirmation', className: 'bg-info-container text-on-info-container', icon: 'hourglass_top' },
  confirmed: { label: 'Confirmed by student', className: 'bg-success-container text-on-success-container', icon: 'verified' },
  reopened: { label: 'Reopened by student', className: 'bg-error-container text-on-error-container', icon: 'replay' }
};

const PRIORITY_STYLES = {
  Low: 'bg-surface-container-high text-on-surface-variant',
  Medium: 'bg-info-container text-on-info-container',
  High: 'bg-warning-container text-on-warning-container',
  Urgent: 'bg-error-container text-on-error-container'
};

/**
 * Current categories first, then the three legacy values kept so queries
 * raised before migration 0026 still render with their own colour rather
 * than falling through to the neutral default.
 */
const CATEGORY_STYLES = {
  Academics: 'bg-primary-fixed text-on-primary-fixed',
  Examination: 'bg-[#ffe2d6] text-on-secondary-container',
  Behavioural: 'bg-info-container text-on-info-container',
  Administrative: 'bg-warning-container text-on-warning-container',
  Others: 'bg-surface-container-high text-on-surface-variant',

  Academic: 'bg-primary-fixed text-on-primary-fixed',
  'ERP/Tech': 'bg-[#ffe2d6] text-on-secondary-container',
  Infrastructure: 'bg-surface-container-high text-on-surface-variant'
};

/** Faculty Mentor or Senior Mentor: whom the student sent the query to (0042). */
export function MentorKindBadge({ kind }) {
  const senior = kind === 'senior';
  return (
    <span className={`chip whitespace-nowrap ${senior ? 'bg-[#ede4ff] text-[#4c2a85]' : 'bg-primary-fixed text-on-primary-fixed'}`}>
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{senior ? 'workspace_premium' : 'badge'}</span>
      {senior ? 'Senior Mentor' : 'Faculty Mentor'}
    </span>
  );
}

/** Escalated to HOD / Raised to faculty mentor, when they apply (0042). */
export function EscalationBadges({ query }) {
  if (!query) return null;
  return (
    <>
      {query.referred_to_faculty && (
        <span className="chip whitespace-nowrap bg-info-container text-on-info-container">
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">move_up</span>
          Raised to faculty mentor
        </span>
      )}
      {query.escalated_to_hod && (
        <span className="chip whitespace-nowrap bg-warning-container text-on-warning-container">
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">flag</span>
          Escalated to HOD
        </span>
      )}
    </>
  );
}

/** Raised by faculty / Raised by senior (0042). */
export function RaisedByBadge({ kind }) {
  const senior = kind === 'senior';
  return (
    <span className={`chip whitespace-nowrap ${senior ? 'bg-[#ede4ff] text-[#4c2a85]' : 'bg-primary-fixed text-on-primary-fixed'}`}>
      {senior ? 'Raised by senior' : 'Raised by faculty'}
    </span>
  );
}

export function QueryStatusBadge({ status }) {
  const style = QUERY_STATUS_STYLES[status] ?? QUERY_STATUS_STYLES.Open;
  return (
    <span className={`chip ${style.className}`}>
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{style.icon}</span>
      {status}
    </span>
  );
}

export function ResolutionBadge({ resolutionStatus }) {
  const style = RESOLUTION_STYLES[resolutionStatus];
  if (!style) return null;
  return (
    <span className={`chip ${style.className}`}>
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  return <span className={`chip ${PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.Medium}`}>{priority}</span>;
}

export function CategoryBadge({ category }) {
  return <span className={`chip ${CATEGORY_STYLES[category] ?? CATEGORY_STYLES.Others}`}>{category}</span>;
}

export function EmploymentBadge({ status }) {
  const map = {
    active: 'bg-success-container text-on-success-container',
    on_leave: 'bg-warning-container text-on-warning-container',
    departed: 'bg-error-container text-on-error-container'
  };
  const labels = { active: 'Active', on_leave: 'On leave', departed: 'Departed' };
  return <span className={`chip ${map[status] ?? map.active}`}>{labels[status] ?? status}</span>;
}
