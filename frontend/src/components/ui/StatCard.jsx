const TONES = {
  primary: { chip: 'bg-primary-fixed text-primary', trendUp: 'text-success' },
  success: { chip: 'bg-success-container text-on-success-container' },
  warning: { chip: 'bg-warning-container text-on-warning-container' },
  error: { chip: 'bg-error-container text-on-error-container' },
  info: { chip: 'bg-info-container text-on-info-container' },
  secondary: { chip: 'bg-primary-fixed text-secondary' },
  slate: { chip: 'bg-surface-container-high text-on-surface-variant' }
};

export default function StatCard({ label, value, caption, icon, tone = 'primary', trend, onClick }) {
  const style = TONES[tone] ?? TONES.primary;
  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`panel w-full p-5 text-left ${onClick ? 'transition-shadow hover:shadow-raised' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${style.chip}`}>
          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
            {icon ?? 'insights'}
          </span>
        </span>
        {trend != null && trend !== 0 && (
          <span
            className={`chip ${trend > 0 ? 'bg-success-container text-on-success-container' : 'bg-error-container text-on-error-container'}`}
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              {trend > 0 ? 'trending_up' : 'trending_down'}
            </span>
            {trend > 0 ? '+' : ''}
            {trend}
          </span>
        )}
      </div>

      <p className="mt-4 text-headline-md leading-none text-on-surface">{value}</p>
      <p className="mt-2 text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</p>
      {caption && <p className="mt-1 text-label-sm text-tertiary">{caption}</p>}
    </Element>
  );
}
