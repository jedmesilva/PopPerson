import { useEffect } from "react";

type LegalKind = "privacy" | "terms";
type LegalLocale = "pt" | "en";

const CONTACT_EMAIL = "contato.instapop@gmail.com";
const LEGAL_NAME = "InstaPop Ltda";

const routeFor = (kind: LegalKind, locale: LegalLocale) => {
  if (locale === "pt") {
    return kind === "privacy" ? "/privacidade" : "/termos-de-servico";
  }
  return kind === "privacy" ? "/privacy" : "/terms";
};

const copy = {
  pt: {
    privacy: {
      title: "Política de Privacidade",
      intro:
        "Esta política explica como o InstaPop trata informações quando você acessa a plataforma ou entra com sua conta do X.",
      sections: [
        {
          title: "1. Quem somos",
          paragraphs: [
            `${LEGAL_NAME} é responsável pelo InstaPop. Para dúvidas, solicitações de acesso ou exclusão de dados, escreva para ${CONTACT_EMAIL}.`,
          ],
        },
        {
          title: "2. Informações que recebemos",
          paragraphs: [
            "Quando você acessa o InstaPop, podemos registrar o endereço IP aproximado, user-agent, cidade, região, país, fuso horário, caminho acessado e horário do acesso. A localização é estimada por endereço IP e pode não ser exata.",
            "Quando você entra com o X, recebemos os dados públicos disponibilizados pela API do X, como identificador da conta, nome de usuário, nome, localização pública e imagem de perfil. Se você autorizar a permissão correspondente, também poderemos receber o email confirmado da conta.",
          ],
        },
        {
          title: "3. Como usamos as informações",
          paragraphs: [
            "Usamos essas informações para autenticar sua conta, manter sua sessão, exibir seu perfil, aplicar filtros de localização, proteger a plataforma contra abuso, entender o funcionamento do serviço e responder a solicitações de suporte.",
          ],
        },
        {
          title: "4. Compartilhamento e serviços externos",
          paragraphs: [
            "Usamos provedores de hospedagem, banco de dados e infraestrutura para operar o InstaPop. A localização aproximada por IP pode ser consultada em um serviço externo de geolocalização. O login depende da plataforma X e também está sujeito às políticas do X.",
            "Não vendemos informações pessoais. Compartilhamos dados somente quando necessário para operar o serviço, cumprir uma obrigação legal, proteger direitos ou com sua autorização.",
          ],
        },
        {
          title: "5. Cookies, sessões e segurança",
          paragraphs: [
            "Usamos cookies técnicos para manter a sessão anônima, concluir o login do X e proteger o fluxo de autenticação. Tokens de sessão são armazenados de forma protegida no servidor. Nenhum método de transmissão ou armazenamento é completamente seguro, mas adotamos medidas razoáveis para proteger as informações.",
          ],
        },
        {
          title: "6. Retenção e seus direitos",
          paragraphs: [
            "Mantemos as informações pelo tempo necessário para prestar o serviço, manter a segurança, cumprir obrigações legais e resolver disputas. Você pode solicitar acesso, correção ou exclusão dos dados pessoais associados à sua conta pelo email de contato.",
            "Para desconectar o InstaPop do X, você também pode revogar o acesso nas configurações da sua conta do X. A revogação não elimina automaticamente registros que precisemos manter por razões legais ou de segurança.",
          ],
        },
        {
          title: "7. Alterações",
          paragraphs: [
            "Podemos atualizar esta política para refletir mudanças no produto ou na legislação. A versão publicada nesta URL será sempre a versão vigente.",
          ],
        },
      ],
    },
    terms: {
      title: "Termos de Serviço",
      intro:
        "Estes termos definem as regras para uso do InstaPop. Ao acessar a plataforma, você concorda com estas condições.",
      sections: [
        {
          title: "1. O serviço",
          paragraphs: [
            "O InstaPop é uma plataforma interativa de popularidade que permite visualizar pessoas, marcas ou criadores e realizar ações disponíveis no produto. Recursos, valores, limites e disponibilidade podem mudar ao longo do tempo.",
          ],
        },
        {
          title: "2. Conta e login com X",
          paragraphs: [
            "Você é responsável por manter o controle da sua conta do X e por autorizar somente o acesso que deseja conceder ao InstaPop. As informações de perfil recebidas do X são tratadas conforme a Política de Privacidade e as políticas do próprio X.",
          ],
        },
        {
          title: "3. Uso permitido",
          paragraphs: [
            "Você deve usar o InstaPop de forma legal, honesta e compatível com estes termos. Não é permitido tentar obter acesso não autorizado, interferir no funcionamento da plataforma, abusar de automações, explorar falhas, enviar código malicioso ou usar o serviço para violar direitos de terceiros.",
          ],
        },
        {
          title: "4. Conteúdo e responsabilidade",
          paragraphs: [
            "Você é responsável pelas informações e ações realizadas com sua conta. O InstaPop não garante que dados de terceiros, estimativas de popularidade ou informações obtidas de serviços externos estejam sempre completos, atuais ou livres de erros.",
          ],
        },
        {
          title: "5. Disponibilidade e alterações",
          paragraphs: [
            "O serviço é fornecido conforme sua disponibilidade. Podemos corrigir, suspender ou encerrar recursos, contas ou acessos quando necessário para segurança, manutenção, cumprimento legal ou proteção da plataforma.",
          ],
        },
        {
          title: "6. Propriedade intelectual",
          paragraphs: [
            `A interface, o nome, a marca e os elementos próprios do InstaPop pertencem a ${LEGAL_NAME} ou aos respectivos licenciadores. Marcas, nomes e conteúdos de terceiros permanecem de propriedade de seus titulares.`,
          ],
        },
        {
          title: "7. Contato e alterações",
          paragraphs: [
            `Para dúvidas sobre estes termos, escreva para ${CONTACT_EMAIL}. Podemos atualizar os termos quando necessário; a versão publicada nesta URL será a versão vigente.`,
          ],
        },
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy Policy",
      intro:
        "This policy explains how InstaPop handles information when you access the platform or sign in with your X account.",
      sections: [
        {
          title: "1. Who we are",
          paragraphs: [
            `${LEGAL_NAME} is responsible for InstaPop. For questions or requests to access or delete data, email ${CONTACT_EMAIL}.`,
          ],
        },
        {
          title: "2. Information we receive",
          paragraphs: [
            "When you access InstaPop, we may record your approximate IP address, user agent, city, region, country, time zone, accessed path, and access time. IP-based location is approximate and may not be accurate.",
            "When you sign in with X, we receive public profile information made available through the X API, such as account identifier, username, name, public location, and profile image. If you grant the relevant permission, we may also receive the confirmed email address associated with your account.",
          ],
        },
        {
          title: "3. How we use information",
          paragraphs: [
            "We use this information to authenticate your account, maintain your session, display your profile, apply location filters, protect the platform from abuse, understand service performance, and respond to support requests.",
          ],
        },
        {
          title: "4. Sharing and external services",
          paragraphs: [
            "We use hosting, database, and infrastructure providers to operate InstaPop. Approximate IP location may be checked through an external geolocation service. Sign-in depends on X and is also subject to X policies.",
            "We do not sell personal information. We share information only as needed to operate the service, comply with law, protect rights, or with your authorization.",
          ],
        },
        {
          title: "5. Cookies, sessions, and security",
          paragraphs: [
            "We use technical cookies to maintain anonymous sessions, complete X sign-in, and protect the authentication flow. Session tokens are stored securely on the server. No transmission or storage method is completely secure, but we use reasonable safeguards to protect information.",
          ],
        },
        {
          title: "6. Retention and your rights",
          paragraphs: [
            "We retain information for as long as necessary to provide the service, maintain security, comply with legal obligations, and resolve disputes. You may request access, correction, or deletion of personal data associated with your account by emailing us.",
            "To disconnect InstaPop from X, you may also revoke access in your X account settings. Revocation does not automatically delete records that we need to retain for legal or security reasons.",
          ],
        },
        {
          title: "7. Changes",
          paragraphs: [
            "We may update this policy to reflect product or legal changes. The version published at this URL is the current version.",
          ],
        },
      ],
    },
    terms: {
      title: "Terms of Service",
      intro:
        "These terms define the rules for using InstaPop. By accessing the platform, you agree to these conditions.",
      sections: [
        {
          title: "1. The service",
          paragraphs: [
            "InstaPop is an interactive popularity platform that lets users view people, brands, or creators and perform actions available in the product. Features, prices, limits, and availability may change over time.",
          ],
        },
        {
          title: "2. Account and X sign-in",
          paragraphs: [
            "You are responsible for maintaining control of your X account and authorizing only the access you want to grant to InstaPop. Profile information received from X is handled according to the Privacy Policy and X policies.",
          ],
        },
        {
          title: "3. Acceptable use",
          paragraphs: [
            "You must use InstaPop lawfully, honestly, and consistently with these terms. You may not seek unauthorized access, interfere with the platform, abuse automation, exploit vulnerabilities, send malicious code, or use the service to violate another person's rights.",
          ],
        },
        {
          title: "4. Content and responsibility",
          paragraphs: [
            "You are responsible for information and actions performed through your account. InstaPop does not guarantee that third-party data, popularity estimates, or information from external services will always be complete, current, or error-free.",
          ],
        },
        {
          title: "5. Availability and changes",
          paragraphs: [
            "The service is provided as available. We may correct, suspend, or discontinue features, accounts, or access when necessary for security, maintenance, legal compliance, or platform protection.",
          ],
        },
        {
          title: "6. Intellectual property",
          paragraphs: [
            `The interface, name, brand, and original InstaPop elements belong to ${LEGAL_NAME} or their respective licensors. Third-party names, marks, and content remain the property of their owners.`,
          ],
        },
        {
          title: "7. Contact and changes",
          paragraphs: [
            `For questions about these terms, email ${CONTACT_EMAIL}. We may update these terms when necessary; the version published at this URL is the current version.`,
          ],
        },
      ],
    },
  },
} as const;

export default function LegalPage({
  kind,
  locale,
}: {
  kind: LegalKind;
  locale: LegalLocale;
}) {
  const content = copy[locale][kind];
  const otherLocale = locale === "pt" ? "en" : "pt";
  const otherLocaleLabel = locale === "pt" ? "English" : "Português";

  useEffect(() => {
    document.title = `${content.title} — InstaPop`;
  }, [content.title]);

  return (
    <main
      style={{
        minHeight: "100vh",
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
        WebkitOverflowScrolling: "touch",
        background: "#090909",
        color: "#f5f5f5",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "28px 20px 56px",
      }}
    >
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "44px",
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
            }}
          >
            InstaPop
          </a>
          <nav aria-label={locale === "pt" ? "Navegação legal" : "Legal navigation"} style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href={routeFor(kind, otherLocale)} style={linkStyle}>
              {otherLocaleLabel}
            </a>
            <a href={routeFor(kind === "privacy" ? "terms" : "privacy", locale)} style={linkStyle}>
              {copy[locale][kind === "privacy" ? "terms" : "privacy"].title}
            </a>
          </nav>
        </header>

        <article
          style={{
            background: "#141414",
            border: "1px solid #2b2b2b",
            borderRadius: "18px",
            padding: "clamp(24px, 5vw, 56px)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.24)",
          }}
        >
          <p style={{ color: "#818cf8", fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 14px" }}>
            InstaPop
          </p>
          <h1 style={{ fontSize: "clamp(30px, 5vw, 48px)", lineHeight: 1.05, letterSpacing: "-0.04em", margin: "0 0 18px" }}>
            {content.title}
          </h1>
          <p style={{ color: "#b3b3b3", fontSize: "16px", lineHeight: 1.7, maxWidth: "680px", margin: "0 0 42px" }}>
            {content.intro}
          </p>

          <div style={{ display: "grid", gap: "30px" }}>
            {content.sections.map((section) => (
              <section key={section.title}>
                <h2 style={{ color: "#f5f5f5", fontSize: "18px", lineHeight: 1.3, margin: "0 0 10px" }}>
                  {section.title}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} style={{ color: "#c4c4c4", fontSize: "14px", lineHeight: 1.75, margin: "0 0 10px" }}>
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <footer style={{ borderTop: "1px solid #2b2b2b", marginTop: "42px", paddingTop: "22px", color: "#737373", fontSize: "12px", lineHeight: 1.6 }}>
            {locale === "pt" ? "Última atualização: 1 de setembro de 2026." : "Last updated: September 1, 2026."}
            <br />
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ ...linkStyle, display: "inline-block", marginTop: "6px" }}>
              {CONTACT_EMAIL}
            </a>
          </footer>
        </article>
      </div>
    </main>
  );
}

const linkStyle = {
  color: "#a5b4fc",
  fontSize: "12px",
  fontWeight: 700,
  textDecoration: "none",
};