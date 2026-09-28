import { useState } from "react";

type CellProps = {
  position: number;
  name: string;
  color: string;
  mode?: "fan" | "hate";
  value?: string;
  layout?: "position" | "horizontal" | "vertical" | "stacked";
};

const colors = {
  page: "#0a0a0a",
  panel: "#171717",
  surface: "#262626",
  border: "#3b3b3b",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  accent: "#6366f1",
  accentText: "#c7d2fe",
  fan: "#14b8a6",
  hate: "#f43f5e",
} as const;

function PositionBadge({ position }: { position: number }) {
  return <span className="position-badge">#{position}</span>;
}

function ActionBadge({ mode = "fan", value = "+12" }: Pick<CellProps, "mode" | "value">) {
  return (
    <span className={`action-badge ${mode}`}>
      {mode === "fan" ? "Fã" : "Hater"} {value}
    </span>
  );
}

function Cell({ position, name, color, mode = "fan", value = "+12", layout = "horizontal" }: CellProps) {
  return (
    <div className={`cell-demo ${layout}`}>
      <div className="cell-circle" style={{ background: color }}>
        <span>{name}</span>
      </div>
      <div className="cell-overlays">
        <PositionBadge position={position} />
        {layout !== "position" && <ActionBadge mode={mode} value={value} />}
      </div>
      {layout === "stacked" && (
        <div className="stacked-actions">
          <ActionBadge mode="fan" value="+12" />
          <ActionBadge mode="hate" value="−12" />
        </div>
      )}
    </div>
  );
}

export function Exploration() {
  const [activeMode, setActiveMode] = useState<"fan" | "hate">("fan");
  const activeValue = activeMode === "fan" ? "+12" : "−12";

  return (
    <main className="exploration">
      <header className="exploration-header">
        <div>
          <span className="eyebrow">InstaPop · microinteração</span>
          <h1>Como mostrar o impacto de uma ação?</h1>
          <p>
            A posição continua fixa. O valor da ação aparece por pouco tempo e sai sem alterar o mapa.
          </p>
        </div>
        <div className="legend">
          <span><i className="dot fan-dot" />Fã</span>
          <span><i className="dot hate-dot" />Hater</span>
        </div>
      </header>

      <section className="comparison-grid" aria-label="Comparação de badges">
        <article className="comparison-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Estado base</span>
              <h2>Só posição</h2>
            </div>
            <span className="state-chip">Permanente</span>
          </div>
          <Cell position={1} name="Fernanda" color="#ec4899" layout="position" />
          <p className="card-note">O ranking permanece visível mesmo sem ação ativa.</p>
        </article>

        <article className="comparison-card recommended">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Opção sugerida</span>
              <h2>Horizontal</h2>
            </div>
            <span className="state-chip accent">Recomendada</span>
          </div>
          <Cell
            position={1}
            name="Fernanda"
            color="#ec4899"
            mode={activeMode}
            value={activeValue}
            layout="horizontal"
          />
          <div className="mode-switch" role="group" aria-label="Tipo de ação">
            <button className={activeMode === "fan" ? "active fan" : ""} onClick={() => setActiveMode("fan")}>Fã +12</button>
            <button className={activeMode === "hate" ? "active hate" : ""} onClick={() => setActiveMode("hate")}>Hater −12</button>
          </div>
          <p className="card-note">A ação temporária fica ao lado da posição, sem criar uma coluna.</p>
        </article>

        <article className="comparison-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Alternativa</span>
              <h2>Vertical</h2>
            </div>
            <span className="state-chip">Mais alta</span>
          </div>
          <Cell position={1} name="Fernanda" color="#ec4899" mode="fan" layout="vertical" />
          <p className="card-note">É legível, mas aumenta a altura visual acima da célula.</p>
        </article>

        <article className="comparison-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Alta frequência</span>
              <h2>Dois hits próximos</h2>
            </div>
            <span className="state-chip">Temporário</span>
          </div>
          <Cell position={1} name="Fernanda" color="#ec4899" layout="stacked" />
          <p className="card-note">Exibe até dois eventos recentes; os mais antigos desaparecem primeiro.</p>
        </article>
      </section>

      <footer className="exploration-footer">
        <span className="pulse" />
        O texto de ação dura cerca de 1 segundo; apenas o badge de posição permanece.
      </footer>

      <style>{`
        :root {
          color-scheme: dark;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: ${colors.page}; }
        button { font: inherit; }
        .exploration {
          min-height: 100vh;
          padding: 38px 42px 30px;
          color: ${colors.text};
          background: ${colors.page};
        }
        .exploration-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          max-width: 1100px;
          margin: 0 auto 28px;
        }
        .eyebrow, .card-kicker {
          display: block;
          color: ${colors.muted};
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .12em;
          line-height: 1;
          text-transform: uppercase;
        }
        h1, h2, p { margin: 0; }
        h1 {
          margin-top: 10px;
          font-size: 26px;
          letter-spacing: -.035em;
          line-height: 1.05;
        }
        .exploration-header p {
          max-width: 620px;
          margin-top: 10px;
          color: ${colors.muted};
          font-size: 13px;
          line-height: 1.45;
        }
        .legend {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 0 0 auto;
          padding: 9px 12px;
          color: ${colors.muted};
          background: ${colors.surface};
          border: 1px solid ${colors.border};
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }
        .legend span { display: inline-flex; align-items: center; gap: 6px; }
        .dot { width: 7px; height: 7px; display: block; border-radius: 50%; }
        .fan-dot { background: ${colors.fan}; }
        .hate-dot { background: ${colors.hate}; }
        .comparison-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          max-width: 1100px;
          margin: 0 auto;
        }
        .comparison-card {
          min-height: 292px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          background: ${colors.panel};
          border: 1px solid ${colors.border};
          border-radius: 14px;
        }
        .comparison-card.recommended {
          border-color: ${colors.accent};
          box-shadow: inset 0 0 0 1px ${colors.accent};
        }
        .card-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        h2 {
          margin-top: 7px;
          color: ${colors.text};
          font-size: 16px;
          letter-spacing: -.02em;
        }
        .state-chip {
          padding: 5px 8px;
          color: ${colors.muted};
          background: ${colors.surface};
          border: 1px solid ${colors.border};
          border-radius: 999px;
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }
        .state-chip.accent {
          color: ${colors.accentText};
          background: #292b50;
          border-color: ${colors.accent};
        }
        .cell-demo {
          position: relative;
          min-height: 150px;
          display: grid;
          place-items: center;
          margin: 14px 0 12px;
        }
        .cell-circle {
          width: 118px;
          height: 118px;
          display: grid;
          place-items: center;
          color: #fff;
          border-radius: 50%;
          font-size: 13px;
          font-weight: 800;
        }
        .cell-overlays {
          position: absolute;
          top: 9px;
          left: calc(50% + 42px);
          display: flex;
          align-items: center;
          gap: 7px;
          transform: translateX(-2px);
        }
        .position-badge, .action-badge {
          min-height: 27px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          line-height: 1;
          white-space: nowrap;
        }
        .position-badge {
          color: ${colors.accentText};
          background: ${colors.surface};
          border: 1px solid ${colors.accent};
        }
        .action-badge {
          color: ${colors.text};
          background: ${colors.surface};
          border: 1px solid ${colors.border};
        }
        .action-badge.fan { border-color: ${colors.fan}; }
        .action-badge.hate { border-color: ${colors.hate}; }
        .cell-demo.position .cell-overlays { left: calc(50% + 42px); }
        .cell-demo.vertical .cell-overlays {
          top: 7px;
          left: 50%;
          flex-direction: column;
          gap: 5px;
          transform: translateX(17px);
        }
        .cell-demo.stacked .cell-overlays {
          top: 7px;
          left: calc(50% + 40px);
        }
        .stacked-actions {
          position: absolute;
          top: 42px;
          left: calc(50% + 40px);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
        }
        .stacked-actions .action-badge { min-height: 24px; font-size: 11px; }
        .mode-switch {
          display: flex;
          align-self: center;
          gap: 4px;
          margin: -2px 0 10px;
          padding: 3px;
          background: ${colors.surface};
          border: 1px solid ${colors.border};
          border-radius: 999px;
        }
        .mode-switch button {
          padding: 5px 9px;
          color: ${colors.muted};
          background: transparent;
          border: 0;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
        }
        .mode-switch button.active {
          color: ${colors.text};
          background: ${colors.accent};
        }
        .mode-switch button.active.hate { background: ${colors.hate}; }
        .card-note {
          margin-top: auto;
          color: ${colors.muted};
          font-size: 11px;
          line-height: 1.4;
        }
        .exploration-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          max-width: 1100px;
          margin: 22px auto 0;
          color: ${colors.muted};
          font-size: 11px;
        }
        .pulse {
          width: 7px;
          height: 7px;
          display: block;
          background: ${colors.accent};
          border-radius: 50%;
        }
        @media (max-width: 760px) {
          .exploration { padding: 24px 16px; }
          .exploration-header { align-items: flex-start; flex-direction: column; }
          .comparison-grid { grid-template-columns: 1fr; }
          .comparison-card { min-height: 270px; }
        }
      `}</style>
    </main>
  );
}