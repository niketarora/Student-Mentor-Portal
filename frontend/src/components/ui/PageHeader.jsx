export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="mb-1 text-label-sm text-tertiary">
            {breadcrumb}
          </nav>
        )}
        <h1 className="text-headline-md text-on-surface">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-body-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
