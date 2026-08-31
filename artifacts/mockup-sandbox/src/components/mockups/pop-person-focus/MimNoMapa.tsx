import { useState } from "react";
import { LocateFixed, MapPin, Scan, ChevronRight } from "lucide-react";

const styles = `
  .mm-scene { min-height: 360px; width: 100%; box-sizing: border-box; padding: 16px; background: #0d1018; color: #eef0ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  .mm-shell { position: relative; height: 328px; overflow: hidden; border: 1px solid rgba(137, 143, 201, .2); border-radius: 16px; background: #111621; box-shadow: 0 18px 45px rgba(0,0,0,.28); }
  .mm-grid { position: absolute; inset: 0; opacity: .5; background-image: linear-gradient(rgba(133,141,190,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(133,141,190,.06) 1px, transparent 1px); background-size: 31px 31px; }
  .mm-river { position: absolute; left: 25%; top: -20%; width: 22%; height: 150%; transform: rotate(31deg); background: rgba(94,129,157,.08); border-left: 1px solid rgba(126,169,202,.13); border-right: 1px solid rgba(126,169,202,.13); }
  .mm-header { position: absolute; left: 18px; top: 16px; z-index: 2; }
  .mm-kicker { color: #8c90bb; font-family: "Space Mono", monospace; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; }
  .mm-title { margin: 5px 0 0; color: #f2f1ff; font-size: 18px; font-weight: 800; letter-spacing: -.04em; }
  .mm-note { position: absolute; left: 18px; top: 68px; z-index: 2; max-width: 176px; color: #727a94; font-size: 10px; line-height: 1.45; }
  .mm-circle { position: absolute; display: grid; place-items: center; border-radius: 50%; color: #f8f8ff; font-size: 10px; font-weight: 750; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14), 0 8px 18px rgba(0,0,0,.18); }
  .mm-main { width: 91px; height: 91px; left: 38%; top: 24%; background: #4c4d83; }
  .mm-left { width: 60px; height: 60px; left: 18%; top: 51%; background: #35656d; }
  .mm-right { width: 68px; height: 68px; left: 65%; top: 49%; background: #805e5e; }
  .mm-user { width: 42px; height: 42px; left: 49%; top: 42%; z-index: 3; border: 2px solid #c3c2ff; background: #7377e5; box-shadow: 0 0 0 5px rgba(115,119,229,.16), 0 8px 18px rgba(0,0,0,.24); }
  .mm-user::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #fff; transform: translateY(-5px); }
  .mm-user::after { content: ""; position: absolute; width: 18px; height: 9px; bottom: 8px; border-radius: 12px 12px 7px 7px; background: #fff; }
  .mm-anchor { position: absolute; left: calc(49% + 21px); top: calc(42% + 40px); z-index: 3; width: 1px; height: 20px; border-left: 1px dashed rgba(195,194,255,.72); }
  .mm-controls { position: absolute; right: 14px; bottom: 14px; z-index: 4; display: flex; align-items: end; gap: 9px; }
  .mm-context { min-width: 174px; min-height: 65px; display: grid; grid-template-columns: 30px 1fr 17px; align-items: center; gap: 9px; padding: 9px 11px; border: 1px solid rgba(143,145,246,.62); border-radius: 13px; background: rgba(37,38,76,.96); color: #fff; text-align: left; cursor: pointer; box-shadow: 0 10px 22px rgba(0,0,0,.3); }
  .mm-context:hover { border-color: #c6c5ff; background: #45458b; transform: translateY(-2px); }
  .mm-context:focus-visible, .mm-recenter:focus-visible { outline: 2px solid #c1c1ff; outline-offset: 3px; }
  .mm-avatar { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.48); border-radius: 50%; background: #7879df; font-size: 12px; font-weight: 800; }
  .mm-context-copy { display: flex; flex-direction: column; gap: 3px; }
  .mm-context-title { font-size: 12px; font-weight: 800; line-height: 1.1; }
  .mm-context-subtitle { color: #c6c6f3; font-size: 9px; line-height: 1.15; }
  .mm-context:active .mm-avatar { transform: scale(.94); }
  .mm-recenter { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(187,191,255,.25); border-radius: 50%; background: rgba(13,16,27,.86); color: #aeb2cf; cursor: pointer; }
  .mm-recenter:hover { color: #f1f1ff; border-color: rgba(187,191,255,.55); background: #242746; }
  .mm-toast { position: absolute; right: 14px; bottom: 88px; z-index: 5; padding: 7px 10px; border: 1px solid rgba(175,184,255,.38); border-radius: 8px; background: rgba(37,38,80,.95); color: #dedfff; font-size: 10px; }
  .mm-legend { position: absolute; left: 18px; bottom: 16px; z-index: 2; color: #747b9a; font-size: 10px; letter-spacing: .02em; }
  @media (max-width: 420px) { .mm-scene { padding: 10px; } .mm-shell { height: 340px; } .mm-context { min-width: 152px; } .mm-note { max-width: 145px; } }
`;

export function MimNoMapa() {
  const [focused, setFocused] = useState(false);

  return (
    <main className="mm-scene">
      <style>{styles}</style>
      <section className="mm-shell" aria-label="Prévia MimNoMapa no canvas Pop Person">
        <div className="mm-grid" />
        <div className="mm-river" />
        <header className="mm-header">
          <div className="mm-kicker">pop person / sua posição</div>
          <h1 className="mm-title" data-testid="text-pop-person-brand">No mapa, agora.</h1>
        </header>
        <p className="mm-note">Pertencimento em primeiro plano: um pequeno marcador transforma o comando em contexto.</p>
        <div className="mm-circle mm-main" data-testid="circle-cluster-main">32 pessoas</div>
        <div className="mm-circle mm-left" data-testid="circle-cluster-left">18</div>
        <div className="mm-circle mm-right" data-testid="circle-cluster-right">11</div>
        <div className="mm-circle mm-user" aria-label="Camila no mapa" data-testid="circle-player-camila" />
        <div className="mm-anchor" aria-hidden="true" />
        <span className="mm-legend" data-testid="text-variant-legend">C · MIM NO MAPA · estado {focused ? "visto" : "idle"}</span>
        {focused && <div className="mm-toast" role="status" data-testid="status-focus-player">Você está aqui: Camila</div>}
        <div className="mm-controls">
          <button className="mm-context" type="button" onClick={() => setFocused(true)} aria-label="Encontrar e centralizar o perfil de Camila no mapa" title="Ver Camila no mapa" data-testid="button-focus-player">
            <span className="mm-avatar" aria-hidden="true">C</span>
            <span className="mm-context-copy"><strong className="mm-context-title">Você está aqui</strong><span className="mm-context-subtitle">Ver Camila no mapa</span></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button className="mm-recenter" type="button" onClick={() => setFocused(false)} aria-label="Recentrar o mapa" title="Recentrar mapa" data-testid="button-recenter">
            <LocateFixed size={17} aria-hidden="true" />
          </button>
        </div>
        <Scan size={14} color="#8389ab" style={{ position: "absolute", right: 75, bottom: 28, opacity: .28 }} aria-hidden="true" />
        <MapPin size={12} color="#c4c3ff" style={{ position: "absolute", left: "calc(49% + 15px)", top: "calc(42% + 9px)", opacity: .9 }} aria-hidden="true" />
      </section>
    </main>
  );
}
