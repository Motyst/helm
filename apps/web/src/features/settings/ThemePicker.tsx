import { SceneArt } from '../../ui/Scenery.tsx';
import { useId } from 'react';
import { THEMES, setPanel, setScenery, setTheme, usePanel, useScenery, useTheme } from '../../ui/themes.ts';

export function ThemeSection() {
  const theme = useTheme();
  const scenery = useScenery();
  const panel = usePanel();
  const panelId = useId();

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
              {scenery && <SceneArt theme={t.id} />}
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
      <label className="choice">
        <input type="checkbox" checked={scenery} onChange={(e) => setScenery(e.target.checked)} />
        <span>
          <strong>Show the landscape</strong>
          <span className="choice-hint">A woodblock-style picture of the theme along the bottom of the screen.</span>
        </span>
      </label>
      <div className="field panel-strength">
        <label htmlFor={panelId}>Board panels</label>
        <div className="panel-slider">
          <span aria-hidden="true">Subtle</span>
          <input
            id={panelId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={panel}
            aria-valuetext={`${panel}%`}
            onChange={(e) => setPanel(Number(e.target.value))}
          />
          <span aria-hidden="true">Bold</span>
        </div>
        <p className="field-hint">How strongly each project’s panel stands out from the page.</p>
      </div>
    </section>
  );
}
