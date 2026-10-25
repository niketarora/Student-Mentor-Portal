/**
 * EscalationHistory
 * Who raised a query to whom, and why (query_escalations, migration
 * 0042). Shown to the people handling the query; the student's read of
 * the table returns nothing, so for them this renders nothing.
 */

import Panel from '../ui/Panel.jsx';
import { RaisedByBadge } from '../ui/StatusBadge.jsx';
import { formatDateTime } from '../../lib/formatters.js';

export default function EscalationHistory({ escalations, className = '' }) {
  if (!escalations?.length) return null;
  return (
    <Panel tab="Raised for help" tabIcon="flag" className={className}>
      <ol className="space-y-4">
        {escalations.map((item) => (
          <li key={item.id} className="text-body-sm">
            <div className="flex flex-wrap items-center gap-2">
              <RaisedByBadge kind={item.raised_by_kind} />
              <span className="text-label-sm text-tertiary">{formatDateTime(item.created_at)}</span>
            </div>
            <p className="mt-1.5 text-on-surface">
              <strong>{item.raised_by_person?.full_name ?? 'Someone'}</strong>
              {item.raised_by_kind === 'senior' ? ' (senior mentor)' : ''} raised it to{' '}
              {item.raised_to === 'hod' ? 'the HOD' : "the student's faculty mentor"}.
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded bg-surface-container-low px-3 py-2 text-on-surface-variant">
              {item.reason || 'No reason given.'}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
