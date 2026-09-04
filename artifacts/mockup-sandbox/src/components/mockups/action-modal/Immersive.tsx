import { useState, type CSSProperties } from "react";
import "./_group.css";

const levels = [
  ["😐", "Incomodado", 1],
  ["🙄", "Aborrecido", 10],
  ["😒", "Irritado", 25],
  ["😠", "Contrariado", 50],
  ["😤", "Bravo", 100],
  ["😡", "Hostil", 175],
  ["🤬", "Furioso", 275],
  ["👿", "Revoltado", 425],
  ["💥", "Possesso", 650],
  ["🖕", "Enojado", 1000],
] as const;

export function Immersive() {
  const [selected, setSelected] = useState(6);
  const [mode, setMode] = useState<"hate" | "fan">("hate");
  const level = levels[selected];
  const isFan = mode === "fan";
  const accent = isFan ? "#45d9a3" : "#ff5c55";
  const photo = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=900&q=85";

  return (
    <main className="immersive-stage">
      <section className="immersive-modal" style={{ "--accent": accent } as CSSProperties} aria-label="Ação imersiva">
        <img className="hero-person" src={photo} alt="Retrato de Fernanda Nunes" />
        <div className="hero-shade" />

        <header className="hero-heading">
          <div>
            <span className="eyebrow">Você é {isFan ? "fã" : "hater"} de</span>
            <h1>Fernanda Nunes?</h1>
          </div>
          <button className="close-button glass" aria-label="Fechar">×</button>
        </header>

        <div className="mode-switch glass" role="group" aria-label="Tipo de ação">
          <button className={!isFan ? "switch-option active" : "switch-option"} onClick={() => setMode("hate")}>👎 Hater</button>
          <button className={isFan ? "switch-option active fan" : "switch-option"} onClick={() => setMode("fan")}>❤️ Fã</button>
        </div>

        <div className="immersive-controls">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Nível de {isFan ? "fã" : "hate"}</span>
              <strong>{level[0]} {level[1]}</strong>
            </div>
            <span className="level-price">{level[2]}x</span>
          </div>

          <div className="level-track" role="group" aria-label="Escolha um nível">
            {levels.map((item, index) => (
              <button
                key={item[1]}
                className={index === selected ? "track-level selected" : index < selected ? "track-level passed" : "track-level"}
                onClick={() => setSelected(index)}
                aria-label={`${item[1]} ${item[2]}x`}
              >
                <span>{item[0]}</span>
              </button>
            ))}
          </div>

          <input
            className="immersive-range"
            style={{ accentColor: accent }}
            aria-label="Intensidade"
            type="range"
            min="0"
            max="9"
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          />

          <div className="action-footer">
            <div>
              <span>Custo total</span>
              <strong>R$ {level[2].toFixed(2).replace(".", ",")}</strong>
            </div>
            <button className="immersive-send" style={{ background: accent }}>
              {isFan ? "Enviar carinho" : "Enviar hate"} <span>→</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}