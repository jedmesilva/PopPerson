import { Router, type IRouter, type Request } from "express";
import { GetAccessLocationResponse } from "@workspace/api-zod";

type IpWhoResponse = {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  timezone?: { id?: string } | string;
};

const router: IRouter = Router();

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function isLocalIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, "");
  const octets = normalized.split(".").map(Number);
  const isPrivate172 =
    octets.length === 4 &&
    octets[0] === 172 &&
    octets[1] >= 16 &&
    octets[1] <= 31;

  return (
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    isPrivate172 ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

function localLocation() {
  return {
    source: "local" as const,
    city: "Local",
    region: "Ambiente de desenvolvimento",
    country: "Local",
    countryCode: "LOCAL",
    timezone: "—",
  };
}

router.get("/access/location", async (req, res): Promise<void> => {
  const ip = getClientIp(req);

  if (ip === "unknown" || isLocalIp(ip)) {
    res.json(GetAccessLocationResponse.parse(localLocation()));
    return;
  }

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      {
        signal: AbortSignal.timeout(3500),
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      req.log.warn({ statusCode: response.status }, "IP geolocation service returned an error");
      res.json(
        GetAccessLocationResponse.parse({
          source: "unavailable",
          city: "Indisponível",
          region: "—",
          country: "—",
          countryCode: "—",
          timezone: "—",
        }),
      );
      return;
    }

    const data = (await response.json()) as IpWhoResponse;
    const timezone =
      typeof data.timezone === "string" ? data.timezone : data.timezone?.id;

    if (!data.success || !data.country) {
      req.log.warn("IP geolocation service could not resolve this address");
      res.json(
        GetAccessLocationResponse.parse({
          source: "unavailable",
          city: "Indisponível",
          region: "—",
          country: "—",
          countryCode: "—",
          timezone: "—",
        }),
      );
      return;
    }

    res.json(
      GetAccessLocationResponse.parse({
        source: "ip",
        city: data.city || "—",
        region: data.region || "—",
        country: data.country,
        countryCode: data.country_code || "—",
        timezone: timezone || "—",
      }),
    );
  } catch (error) {
    req.log.warn({ err: error }, "IP geolocation lookup failed");
    res.json(
      GetAccessLocationResponse.parse({
        source: "unavailable",
        city: "Indisponível",
        region: "—",
        country: "—",
        countryCode: "—",
        timezone: "—",
      }),
    );
  }
});

export default router;