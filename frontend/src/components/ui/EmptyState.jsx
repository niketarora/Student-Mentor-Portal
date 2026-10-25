export default function EmptyState({ icon = 'inbox', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-container">
        <span className="material-symbols-outlined text-[26px] text-tertiary" aria-hidden="true">{icon}</span>
      </span>
      <h3 className="mt-4 text-headline-sm text-on-surface">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-body-sm text-on-surface-variant">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
