import { useState } from "react";
import { Pencil, X } from "lucide-react";
import "./_group.css";

export function Integrated() {
  const [editing, setEditing] = useState(false);
  return (
    <main style={{ minHeight: "100vh", background: "var(--app-bg)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.68)" }} />
      <section style={{ position: "relative", width: "100%", maxWidth: 360, background: "var(--app-surface)", border: "1px solid #292929", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 8px 28px rgba(0,0,0,.42)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 18, letterSpacing: "-.02em" }}>Obter minha célula</strong>
            <span style={{ display: "block", marginTop: 4, color: "var(--app-muted)", fontSize: 12, lineHeight: 1.4 }}>Escolha sua localidade e categoria.</span>
          </div>
          <button aria-label="Fechar" style={{ width: 26, height: 26, flexShrink: 0, border: 0, borderRadius: 999, background: "#262626", color: "var(--app-muted)" }}><X size={13} /></button>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 999, display: "grid", placeItems: "center", background: "#333", fontSize: 15, fontWeight: 800 }}>J</div>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Jedme Silva</strong>
            <span style={{ color: "var(--app-muted)", fontSize: 11 }}>@jedmesilva</span>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #292929", paddingTop: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ display: "block", color: "var(--app-faint)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>Localidade</span>
              <strong style={{ display: "block", marginTop: 4, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>São Paulo, SP — Brasil</strong>
            </div>
            <button onClick={() => setEditing(!editing)} aria-label="Editar localidade" style={{ width: 28, height: 28, flexShrink: 0, border: "1px solid #3b3b3b", borderRadius: 8, background: "transparent", color: "var(--app-muted)" }}><Pencil size={13} /></button>
          </div>
          {editing && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <input defaultValue="São Paulo" placeholder="Cidade" style={inputStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input defaultValue="SP" placeholder="Estado" style={inputStyle} />
                <input defaultValue="Brasil" placeholder="País" style={inputStyle} />
              </div>
              <button onClick={() => setEditing(false)} style={secondaryButtonStyle}>Salvar localidade</button>
            </div>
          )}
        </div>

        <label style={{ display: "grid", gap: 7 }}>
          <span style={{ color: "var(--app-faint)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>Categoria</span>
          <select style={{ width: "100%", padding: "10px 11px", borderRadius: 9, background: "#262626", color: "var(--app-text)", border: "1px solid #3b3b3b" }}>
            <option>Creator</option>
            <option>Marca</option>
          </select>
        </label>

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 2 }}>
          <button style={{ padding: "10px 16px", borderRadius: 999, border: 0, background: "var(--app-text)", color: "#0a0a0a", fontWeight: 800, fontSize: 12 }}>Obter minha célula</button>
        </footer>
      </section>
    </main>
  );
}

const inputStyle = { width: "100%", padding: "10px 11px", borderRadius: 9, background: "var(--app-control)", color: "var(--app-text)", border: "1px solid #484848", outline: "none" };
const secondaryButtonStyle = { padding: "8px 11px", borderRadius: 8, background: "#333", color: "var(--app-text)", border: "1px solid #484848", fontSize: 11, fontWeight: 700 };