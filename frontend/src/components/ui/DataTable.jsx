import { Fragment } from 'react';
import EmptyState from './EmptyState.jsx';

/** Header and body cell must always get the SAME alignment class. */
function alignmentClass(align) {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Simple, accessible data table. Columns declare a render function so
 * cells stay presentational and the table itself stays generic.
 */
export default function DataTable({
  columns, rows, rowKey, emptyState, onRowClick, footer, dense,
  // Return a node to show a detail panel under that row, or null for the
  // rows that are collapsed. The caller owns which is which, so this adds
  // no state here and changes nothing for tables that omit it.
  renderExpanded
}) {
  if (!rows.length) {
    return emptyState ?? <EmptyState title="Nothing to show" description="There are no records here yet." />;
  }

  return (
    <div className="overflow-hidden">
      <div className="custom-scrollbar overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={alignmentClass(column.align)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = renderExpanded ? renderExpanded(row) : null;
              return (
                <Fragment key={rowKey(row)}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`${onRowClick ? 'cursor-pointer' : ''} ${dense ? '[&>td]:py-1.5' : ''}`}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={alignmentClass(column.align)}>
                        {column.render ? column.render(row) : (row[column.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={columns.length} className="p-0">
                        {expanded}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
