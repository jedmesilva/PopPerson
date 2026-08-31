import { useState } from "react";
import { LocateFixed, Navigation, Crosshair } from "lucide-react";

const styles = `
  .ml-scene { min-height: 360px; width: 100%; box-sizing: border-box; padding: 16px; background: #0d1019; color: #eef0ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  .ml-shell { position: relative; height: 328px; overflow: hidden; border: 1px solid rgba(137, 143, 201, .2); border-radius: 16px; background: #111521; box-shadow: 0 18px 45px rgba(0,0,0,.28); }
  .ml-grid { position: absolute; inset: 0; opacity: .55; background-image: linear-gradient(rgba(133,141,190,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(133,141,190,.07) 1px, transparent 1px); background-size: 34px 34px; }
  .ml-glow { position: absolute; width: 230px; height: 230px; left: 31%; top: 2%; border-radius: 50%; background: radial-gradient(circle, rgba(78,78,145,.2), transparent 67%); }
  .ml-topbar { position: absolute; left: 18px; top: 16px; z-index: 2; display: flex; align-items: center; gap: 9px; }
  .ml-brand { color: #f0efff; font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
  .ml-live { display: inline-flex; align-items: center; gap: 5px; color: #a2a7be; font-size: 10px; }
  .ml-live i { width: 5px; height: 5px; border-radius: 50%; background: #79d6b3; box-shadow: 0 0 0 3px rgba(121,214,179,.1); }
  .ml-legend { position: absolute; left: 18px; bottom: 16px; z-index: 2; color: #747b9a; font-size: 10px; letter-spacing: .02em; }
  .ml-cluster { position: absolute; border-radius: 999px; display: grid; place-items: center; color: #f4f5ff; font-size: 11px; font-weight: 700; box-shadow: inset 0 0 0 1px rgba(255,255,255,.15), 0 7px 18px rgba(0,0,0,.16); }
  .ml-one { width: 94px; height: 94px; left: 34%; top: 25%; background: #4c4d83; }
  .ml-two { width: 66px; height: 66px; left: 18%; top: 48%; background: #2f6b70; }
  .ml-three { width: 52px; height: 52px; left: 58%; top: 49%; background: #8b6258; }
  .ml-four { width: 34px; height: 34px; left: 68%; top: 22%; background: #65705b; font-size: 9px; }
  .ml-player { width: 38px; height: 38px; left: 49%; top: 43%; z-index: 3; border: 2px solid #b9b8ff; background: #7377e5; box-shadow: 0 0 0 5px rgba(115,119,229,.16), 0 8px 20px rgba(0,0,0,.28); }
  .ml-player::after { content: ""; position: absolute; inset: 7px; border: 1px solid rgba(255,255,255,.55); border-radius: 50%; }
  .ml-controls { position: absolute; right: 14px; bottom: 14px; z-index: 4; display: flex; align-items: center; gap: 8px; }
  .ml-control { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(187,191,255,.25); border-radius: 50%; background: rgba(13,16,27,.86); color: #aeb2cf; cursor: pointer; box-shadow: 0 8px 18px rgba(0,0,0,.22); }
  .ml-control:hover { color: #f1f1ff; border-color: rgba(187,191,255,.55); background: #242746; }
  .ml-control:focus-visible, .ml-action:focus-visible { outline: 2px solid #aeb2ff; outline-offset: 3px; }
  .ml-action { min-height: 42px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px 0 10px; border: 1px solid rgba(143,145,246,.72); border-radius: 999px; background: rgba(44,43,93,.95); color: #f1f0ff; font-size: 12px; font-weight: 750; letter-spacing: .01em; cursor: pointer; box-shadow: 0 8px 18px rgba(0,0,0,.25); }
  .ml-action:hover { background: #5554aa; border-color: #c3c2ff; transform: translateY(-1px); }
  .ml-action svg { color: #c4c3ff; }
  .ml-toast { position: absolute; right: 14px; bottom: 68px; z-index: 5; padding: 7px 10px; border: 1px solid rgba(137,220,190,.34); border-radius: 8px; background: rgba(19,37,39,.92); color: #afe3ce; font-size: 10px; }
  .ml-caption { position: absolute; left: 18px; top: 49px; z-index: 2; max-width: 190px; color: #676e8a; font-size: 10px; line-height: 1.4; }
  @media (max-width: 420px) { .ml-scene { padding: 10px; } .ml-shell { height: 340px; } .ml-caption { max-width: 150px; } }
`;

export function MeuLugar() {
  const [focused, setFocused] = useState(false);

  return (
    <main className="ml-scene">
      <style>{styles}</style>
      <section className="ml-shell" aria-label="Prévia MeuLugar no canvas Pop Person">
        <div className="ml-grid" />
        <div className="ml-glow" />
        <header className="ml-topbar">
          <span className="ml-brand" data-testid="text-pop-person-brand">pop person</span>
          <span className="ml-live"><i /> mapa ao vivo</span>
        </header>
        <p className="ml-caption">Ação enxuta, encostada no controle de recentralizar.</p>
        <div className="ml-cluster ml-one" data-testid="circle-cluster-main">32 pessoas</div>
        <div className="ml-cluster ml-two" data-testid="circle-cluster-north">18 pessoas</div>
        <div className="ml-cluster ml-three" data-testid="circle-cluster-east">11 pessoas</div>
        <div className="ml-cluster ml-four" data-testid="circle-cluster-south">6</div>
        <div className="ml-cluster ml-player" aria-label="Camila no mapa" data-testid="circle-player-camila" />
        <span className="ml-legend" data-testid="text-variant-legend">A · MEU LUGAR · estado {focused ? "centralizado" : "idle"}</span>
        {focused && <div className="ml-toast" role="status" data-testid="status-focus-player">Mapa centralizado em Camila</div>}
        <div className="ml-controls">
          <button className="ml-action" type="button" onClick={() => setFocused(true)} aria-label="Encontrar e centralizar o perfil de Camila no mapa" title="Encontrar meu lugar no mapa" data-testid="button-focus-player">
            <Navigation size={15} strokeWidth={2.4} aria-hidden="true" />
            <span>Meu lugar</span>
          </button>
          <button className="ml-control" type="button" onClick={() => setFocused(false)} aria-label="Recentrar o mapa" title="Recentrar mapa" data-testid="button-recenter">
            <LocateFixed size={17} aria-hidden="true" />
          </button>
        </div>
        <Crosshair size={15} color="#858bad" style={{ position: "absolute", right: 70, bottom: 30, opacity: .25 }} aria-hidden="true" />
      </section>
    </main>
  );
}
