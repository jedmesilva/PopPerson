import { ArrowLeft, Home, SearchX } from "lucide-react";

export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#090909",
        color: "#f5f5f5",
        fontFamily: "Inter, system-ui, sans-serif",
        display: "grid",
        placeItems: "center",
        padding: "28px 20px",
      }}
    >
      <section
        aria-labelledby="not-found-title"
        style={{
          width: "min(100%, 560px)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <a
          href="/"
          style={{
            color: "#f5f5f5",
            textDecoration: "none",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            fontSize: "18px",
            marginBottom: "58px",
          }}
        >
          InstaPop
        </a>

        <div
          aria-hidden="true"
          style={{
            width: "128px",
            height: "128px",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            marginBottom: "30px",
            background: "linear-gradient(145deg, #ec4899 0%, #8b5cf6 52%, #06b6d4 100%)",
            boxShadow: "0 0 0 12px rgba(139, 92, 246, 0.08), 0 24px 70px rgba(139, 92, 246, 0.2)",
          }}
        >
          <div
            style={{
              width: "112px",
              height: "112px",
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "#141414",
            }}
          >
            <SearchX size={38} strokeWidth={1.6} color="#c4b5fd" />
          </div>
        </div>

        <p
          style={{
            color: "#818cf8",
            fontSize: "12px",
            fontWeight: 800,
            letterSpacing: "0.14em",
            margin: "0 0 12px",
          }}
        >
          ERRO 404
        </p>
        <h1
          id="not-found-title"
          style={{
            fontSize: "clamp(30px, 6vw, 48px)",
            lineHeight: 1.05,
            letterSpacing: "-0.045em",
            margin: "0 0 16px",
          }}
        >
          Essa página saiu do radar
        </h1>
        <p
          style={{
            color: "#a3a3a3",
            fontSize: "15px",
            lineHeight: 1.7,
            maxWidth: "440px",
            margin: "0 0 32px",
          }}
        >
          O endereço que você acessou não existe ou não está disponível. Volte para o mapa de popularidade e continue explorando.
        </p>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "11px 16px",
              borderRadius: "10px",
              background: "#f5f5f5",
              color: "#111111",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 800,
            }}
          >
            <Home size={15} />
            Voltar ao início
          </a>
          <button
            type="button"
            onClick={() => window.history.back()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 15px",
              borderRadius: "10px",
              border: "1px solid #333333",
              background: "#1c1c1c",
              color: "#d4d4d4",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={15} />
            Página anterior
          </button>
        </div>
      </section>
    </main>
  );
}