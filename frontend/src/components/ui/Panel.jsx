/**
 * Panel — the white card used for every block in all three portals.
 *
 * The `tab` / `tabIcon` props are unchanged from the previous design so no
 * page needed editing; they now render as the soft-peach section header
 * strip from the SSMP Nexus design rather than a folder tab.
 */
/**
 * `bodyClassName` has NO default on purpose. `??` only falls back on
 * null/undefined, so a default of '' would swallow the fallback and leave
 * every panel that omits the prop with no padding at all. Omitted means
 * "give me the standard p-5"; an explicit '' means "no padding", which is
 * what the table and list panels pass.
 */
export default function Panel({ tab, tabIcon, title, actions, children, className = '', bodyClassName }) {
  const heading = tab || title;

  return (
    <section className={className}>
      <div className="panel">
        {heading && (
          <header className="panel-header">
            {tabIcon && (
              <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">
                {tabIcon}
              </span>
            )}
            <h2 className="panel-header-title">{heading}</h2>
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
          </header>
        )}
        <div className={bodyClassName ?? 'p-5'}>{children}</div>
      </div>
    </section>
  );
}
