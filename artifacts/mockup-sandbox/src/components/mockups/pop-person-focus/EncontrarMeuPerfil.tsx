import { useState } from "react";
import { LocateFixed, ScanSearch, ArrowUpRight } from "lucide-react";

const styles = `
  .ep-scene { min-height: 360px; width: 100%; box-sizing: border-box; padding: 16px; background: #0e1119; color: #eef0ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  .ep-shell { position: relative; height: 328px; overflow: hidden; border: 1px solid rgba(137, 143, 201, .2); border-radius: 16px; background: #121620; box-shadow: 0 18px 45px rgba(0,0,0,.28); }
  .ep-grid { position: absolute; inset: 0; opacity: .5; background-image: linear-gradient(rgba(133,141,190,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(133,141,190,.06) 1px, transparent 1px); background-size: 28px 28px; }
  .ep-orbit { position: absolute; border: 1px solid rgba(145,147,220,.12); border-radius: 50%; }
  .ep-orbit-a { width: 225px; height: 115px; left: 22%; top: 24%; transform: rotate(-17deg); }
  .ep-orbit-b { width: 310px; height: 170px; left: 12%; top: 12%; transform: rotate(22deg); }
  .ep-header { position: absolute; inset: 16px 18px auto; z-index: 2; display: flex; justify-content: space-between; align-items: center; }
  .ep-heading { margin: 0; color: #f4f3ff; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .ep-counter { padding: 5px 8px; border: 1px solid rgba(160,164,220,.18); border-radius: 6px; color: #8f96b3; font-family: "Space Mono", monospace; font-size: 9px; }
  .ep-copy { position: absolute; left: 18px; top: 49px; z-index: 2; max-width: 190px; color: #6d748c; font-size: 10px; line-height: 1.45; }
  .ep-circle { position: absolute; display: grid; place-items: center; border-radius: 50%; color: #f7f7ff; font-size: 10px; font-weight: 750; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14), 0 8px 18px rgba(0,0,0,.18); }
  .ep-main { width: 90px; height: 90px; left: 38%; top: 23%; background: #4c4d83; }
  .ep-left { width: 58px; height: 58px; left: 18%; top: 50%; background: #37666f; }
  .ep-right { width: 72px; height: 72px; left: 63%; top: 47%; background: #805e5e; }
  .ep-user { width: 40px; height: 40px; left: 49%; top: 42%; border: 2px solid #bab9ff; background: #7377e5; box-shadow: 0 0 0 5px rgba(115,119,229,.16), 0 8px 18px rgba(0,0,0,.24); }
  .ep-user::before { content: "C"; color: #fff; font-size: 13px; }
  .ep-controls { position: absolute; right: 14px; bottom: 14px; z-index: 4; display: flex; align-items: end; gap: 9px; }
  .ep-focus { min-height: 54px; display: inline-flex; align-items: center; gap: 10px; padding: 8px 14px 8px 12px; border: 1px solid rgba(172,173,255,.8); border-radius: 11px; background: #5a59ad; color: #fff; cursor: pointer; box-shadow: 0 10px 22px rgba(0,0,0,.3); text-align: left; }
  .ep-focus:hover { background: #6968c2; border-color: #d0cfff; transform: translateY(-2px); }
  .ep-focus:focus-visible, .ep-recenter:focus-visible { outline: 2px solid #c1c1ff; outline-offset: 3px; }
  .ep-focus-icon { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.28); border-radius: 8px; background: rgba(20,20,58,.3); }
  .ep-focus-copy { display: flex; flex-direction: column; gap: 2px; }
  .ep-focus-title { font-size: 12px; font-weight: 800; line-height: 1.1; }
  .ep-focus-subtitle { color: #d5d5ff; font-size: 9px; line-height: 1.2; }
  .ep-recenter { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(187,191,255,.25); border-radius: 50%; background: rgba(13,16,27,.86); color: #aeb2cf; cursor: pointer; }
  .ep-recenter:hover { color: #f1f1ff; border-color: rgba(187,191,255,.55); background: #242746; }
  .ep-toast { position: absolute; right: 14px; bottom: 78px; z-index: 5; padding: 7px 10px; border: 1px solid rgba(181,180,255,.38); border-radius: 8px; background: rgba(42,41,91,.94); color: #dbdbff; font-size: 10px; }
  .ep-legend { position: absolute; left: 18px; bottom: 16px; z-index: 2; color: #747b9a; font-size: 10px; letter-spacing: .02em; }
  @media (max-width: 420px) { .ep-scene { padding: 10px; } .ep-shell { height: 340px; } .ep-copy { max-width: 145px; } .ep-focus-subtitle { display: none; } }
`;

export function EncontrarMeuPerfil() {
  const [focused, setFocused] = useState(false);

  return (
    <main className="ep-scene">
      <style>{styles}</style>
      <section className="ep-shell" aria-label="Prévia EncontrarMeuPerfil no canvas Pop Person">
        <div className="ep-grid" />
        <div className="ep-orbit ep-orbit-a" />
        <div className="ep-orbit ep-orbit-b" />
        <header className="ep-header">
          <h1 className="ep-heading" data-testid="text-pop-person-brand">pop person</h1>
          <span className="ep-counter" data-testid="text-canvas-count">68 círculos visíveis</span>
        </header>
        <p className="ep-copy">Clareza literal para quem acabou de chegar: a ação diz exatamente o que vai acontecer.</p>
        <div className="ep-circle ep-main" data-testid="circle-cluster-main">32 pessoas</div>
        <div className="ep-circle ep-left" data-testid="circle-cluster-left">18</div>
        <div className="ep-circle ep-right" data-testid="circle-cluster-right">11</div>
        <div className="ep-circle ep-user" aria-label="Camila no mapa" data-testid="circle-player-camila" />
        <span className="ep-legend" data-testid="text-variant-legend">B · ENCONTRAR MEU PERFIL · estado {focused ? "focado" : "idle"}</span>
        {focused && <div className="ep-toast" role="status" data-testid="status-focus-player">Encontrando Camila no mapa</div>}
        <div className="ep-controls">
          <button className="ep-focus" type="button" onClick={() => setFocused(true)} aria-label="Encontrar e centralizar o perfil de Camila no mapa" title="Encontrar meu perfil" data-testid="button-focus-player">
            <span className="ep-focus-icon"><ScanSearch size={16} aria-hidden="true" /></span>
            <span className="ep-focus-copy"><strong className="ep-focus-title">Encontrar meu perfil</strong><span className="ep-focus-subtitle">Centralizar Camila no mapa</span></span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
          <button className="ep-recenter" type="button" onClick={() => setFocused(false)} aria-label="Recentrar o mapa" title="Recentrar mapa" data-testid="button-recenter">
            <LocateFixed size={17} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
