import { useState } from "react";
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

export function Current() {
  const [selected, setSelected] = useState(4);
  const level = levels[selected];

  return (
    <main className="current-stage">
      <section className="current-modal" aria-label="Modal atual de ação">
        <header className="current-heading">
          <h1>Qual é o seu nível de hate de Fernanda Nunes?</h1>
          <button className="close-button" aria-label="Fechar">×</button>
        </header>

        <div className="selected-person">
          <div className="person-thumb">FN</div>
          <div>
            <span>Pessoa selecionada</span>
            <strong>Fernanda Nunes</strong>
          </div>
        </div>

        <div className="picker-card">
          <div className="picker-topline">
            <span className="mode-label">Nível de hate</span>
            <span className="multiplier">{level[2]}x</span>
          </div>
          <div className="current-level-icon">{level[0]}</div>
          <strong>{level[1]}</strong>
          <div className="level-dots" role="group" aria-label="Níveis de hate">
            {levels.map((item, index) => (
              <button
                key={item[1]}
                className={index === selected ? "level-dot active" : "level-dot"}
                onClick={() => setSelected(index)}
                aria-label={`${item[1]} ${item[2]}x`}
              >
                {item[0]}
              </button>
            ))}
          </div>
          <input
            aria-label="Intensidade"
            type="range"
            min="0"
            max="9"
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
          <span className="range-caption">Arraste para ajustar a intensidade</span>
        </div>

        <div className="current-price">
          <div>
            <span>Custo total da ação</span>
            <strong>{level[1]}</strong>
          </div>
          <b>R$ {(level[2] * 1).toFixed(2).replace(".", ",")}</b>
        </div>

        <button className="send-button">Enviar agora</button>
      </section>
    </main>
  );
}