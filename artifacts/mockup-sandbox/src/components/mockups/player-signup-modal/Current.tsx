import { useState } from "react";
import { Pencil, X } from "lucide-react";
import "./_group.css";

export function Current() {
  const [editing, setEditing] = useState(false);
  return (
    <main style={{ minHeight: "100vh", background: "var(--app-bg)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.68)" }} />
      <section style={{ position: "relative", width: "100%", maxWidth: 400, maxHeight: "88vh", overflowY: "auto", background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 12px 36px rgba(0,0,0,.45)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <strong style={{ fontSize: 19, letterSpacing: "-.02em" }}>Obter minha célula</strong>
            <span style={{ color: "var(--app-muted)", fontSize: 12, lineHeight: 1.4 }}>Informe sua localidade e escolha uma categoria para obter sua célula.</span>
          </div>
          <button aria-label="Fechar" style={{ width: 26, height: 26, border: 0, borderRadius: 999, background: "#262626", color: "var(--app-muted)" }}><X size={13} /></button>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: "var(--app-control)", border: "1px solid var(--app-border)" }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, display: "grid", placeItems: "center", background: "#333", fontSize: 18, fontWeight: 800 }}>J</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <strong style={{ fontSize: 15 }}>Jedme Silva</strong>
            <span style={{ color: "var(--app-muted)", fontSize: 12 }}>@jedmesilva</span>
          </div>
        </div>

        <div style={{ padding: 12, borderRadius: 12, background: "var(--app-surface-raised)", border: "1px solid var(--app-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <strong style={{ display: "block", fontSize: 13 }}>Sua localidade</strong>
              <span style={{ color: "var(--app-faint)", fontSize: 11 }}>Localidade do seu perfil de player</span>
            </div>
            <button onClick={() => setEditing(!editing)} aria-label="Editar localidade" style={{ width: 30, height: 30, border: "1px solid #484848", borderRadius: 999, background: "#333", color: "var(--app-text)" }}><Pencil size={14} /></button>
          </div>
          {editing ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <input defaultValue="São Paulo" placeholder="Cidade" style={inputStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input defaultValue="SP" placeholder="Estado" style={inputStyle} />
                <input defaultValue="Brasil" placeholder="País" style={inputStyle} />
              </div>
              <button onClick={() => setEditing(false)} style={secondaryButtonStyle}>Salvar localidade</button>
            </div>
          ) : (
            <div style={{ marginTop: 10, minHeight: 38, padding: "9px 10px", borderRadius: 9, background: "var(--app-control)", fontSize: 12 }}>São Paulo, SP — Brasil</div>
          )}
        </div>

        <label style={{ display: "grid", gap: 7 }}>
          <strong style={{ fontSize: 13 }}>Escolha sua categoria</strong>
          <select style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "#262626", color: "var(--app-text)", border: "1px solid #444" }}>
            <option>Creator</option>
            <option>Marca</option>
          </select>
        </label>

        <footer style={{ display: "flex", gap: 10 }}>
          <button style={{ ...secondaryButtonStyle, flex: 1, borderRadius: 999 }}>Cancelar</button>
          <button style={{ flex: 1, padding: 11, borderRadius: 999, border: 0, background: "var(--app-text)", color: "#0a0a0a", fontWeight: 800 }}>Obter minha célula</button>
        </footer>
      </section>
    </main>
  );
}

const inputStyle = { width: "100%", padding: "10px 11px", borderRadius: 9, background: "var(--app-control)", color: "var(--app-text)", border: "1px solid #484848", outline: "none" };
const secondaryButtonStyle = { padding: "8px 11px", borderRadius: 8, background: "#333", color: "var(--app-text)", border: "1px solid #484848", fontSize: 11, fontWeight: 700 };