export function SkeletonLine({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="panel space-y-2 p-4">
          <SkeletonLine className="h-3 w-24" />
          <SkeletonLine className="h-7 w-16" />
          <SkeletonLine className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 5 }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-topbar-border bg-surface-container-low px-4 py-3">
        <SkeletonLine className="h-3 w-40" />
      </div>
      <div className="divide-y divide-surface-container">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <SkeletonLine key={columnIndex} className="h-3.5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageLoader({ label = 'Loading...' }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <div className="h-11 w-11 animate-spin rounded-full border-4 border-outline-variant border-t-primary" />
      <p className="text-body-sm text-on-surface-variant">{label}</p>
    </div>
  );
}
