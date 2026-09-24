import { THEMES, setTheme, useTheme } from '../../ui/themes.ts';

export function ThemeSection() {
  const theme = useTheme();

  return (
    <section className="settings-section" aria-labelledby="theme-heading">
      <h2 id="theme-heading" className="settings-subtitle">
        Theme
      </h2>
      <p className="field-hint">Applies to this device only, so a wall display and your phone can differ.</p>
      <div className="theme-grid" role="radiogroup" aria-labelledby="theme-heading">
        {THEMES.map((t) => (
          <label key={t.id} className="theme-option">
            <input
              type="radio"
              className="visually-hidden"
              name="theme"
              checked={theme === t.id}
              onChange={() => setTheme(t.id)}
            />
            {/* A tiny board drawn in that theme's own colors. */}
            <span className="theme-swatch" data-theme={t.id} aria-hidden="true">
              <span className="sw-heading" />
              <span className="sw-task sw-now">
                <span />
              </span>
              <span className="sw-task">
                <span />
              </span>
            </span>
            <span className="theme-name">{t.name}</span>
            <span className="theme-hint">{t.hint}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
