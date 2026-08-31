import { Router, type IRouter, type Request } from "express";
import { GetAccessLocationResponse, SearchCitiesResponse } from "@workspace/api-zod";
import { accessEventsTable, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type IpWhoResponse = {
  success?: boolean;
  city?: string;
  region?: string;
  region_code?: string;
  country?: string;
  country_code?: string;
  timezone?: { id?: string } | string;
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    id?: number;
    name?: string;
    admin1?: string;
    admin2?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  }>;
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
    regionCode: "LOCAL",
    country: "Local",
    countryCode: "LOCAL",
    timezone: "—",
  };
}

function unavailableLocation() {
  return {
    source: "unavailable" as const,
    city: "Indisponível",
    region: "—",
    regionCode: "—",
    country: "—",
    countryCode: "—",
    timezone: "—",
  };
}

export async function resolveAccessLocation(req: Request) {
  const ip = getClientIp(req);

  if (ip === "unknown" || isLocalIp(ip)) {
    return localLocation();
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
      return unavailableLocation();
    }

    const data = (await response.json()) as IpWhoResponse;
    const timezone =
      typeof data.timezone === "string" ? data.timezone : data.timezone?.id;

    if (!data.success || !data.country) {
      req.log.warn("IP geolocation service could not resolve this address");
      return unavailableLocation();
    }

    return {
      source: "ip" as const,
      city: data.city || "—",
      region: data.region || "—",
      regionCode: data.region_code || "—",
      country: data.country,
      countryCode: data.country_code || "—",
      timezone: timezone || "—",
    };
  } catch (error) {
    req.log.warn({ err: error }, "IP geolocation lookup failed");
    return unavailableLocation();
  }
}

async function recordAccessEvent(req: Request, location: Awaited<ReturnType<typeof resolveAccessLocation>>) {
  const ip = getClientIp(req);
  await db.insert(accessEventsTable).values({
    sessionId: req.res?.locals?.anonymousSessionId ?? null,
    ipAddress: ip === "unknown" ? null : ip,
    userAgent: req.get("user-agent") ?? null,
    city: location.city,
    region: location.region,
    country: location.country,
    countryCode: location.countryCode,
    timezone: location.timezone,
    locationSource: location.source,
    requestPath: req.originalUrl?.split("?")[0] ?? req.path,
  });

  const authenticatedUserId = req.res?.locals?.authenticatedUser?.id;
  if (authenticatedUserId) {
    await db
      .update(usersTable)
      .set({
        lastAccessCity: location.city,
        lastAccessRegion: location.region,
        lastAccessCountry: location.country,
        lastAccessCountryCode: location.countryCode,
        lastAccessTimezone: location.timezone,
        lastAccessLocationSource: location.source,
        lastAccessLocationAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, authenticatedUserId));
  }
}

router.get("/access/location", async (req, res): Promise<void> => {
  const location = await resolveAccessLocation(req);

  try {
    await recordAccessEvent(req, location);
  } catch (error) {
    req.log.error({ err: error }, "Could not record access location");
    res.status(500).json({ error: "Não foi possível registrar a origem do acesso." });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.json(GetAccessLocationResponse.parse(location));
});

router.get("/access/location/search", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2 || query.length > 80) {
    res.status(400).json({ error: "Digite entre 2 e 80 caracteres para buscar uma cidade." });
    return;
  }

  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=pt&format=json`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      req.log.warn({ statusCode: response.status }, "City geocoding service returned an error");
      res.status(502).json({ error: "Não foi possível buscar cidades agora." });
      return;
    }

    const data = (await response.json()) as OpenMeteoGeocodingResponse;
    const results = (data.results ?? [])
      .filter((result) =>
        result.id &&
        result.name &&
        result.country &&
        result.country_code &&
        Number.isFinite(result.latitude) &&
        Number.isFinite(result.longitude),
      )
      .map((result) => ({
        id: String(result.id),
        city: result.name as string,
        region: result.admin1 || result.admin2 || result.country as string,
        country: result.country as string,
        countryCode: (result.country_code as string).toUpperCase(),
        latitude: result.latitude as number,
        longitude: result.longitude as number,
      }));

    res.set("Cache-Control", "public, max-age=300");
    res.json(SearchCitiesResponse.parse({ results }));
  } catch (error) {
    req.log.warn({ err: error }, "City geocoding lookup failed");
    res.status(502).json({ error: "Não foi possível buscar cidades agora." });
  }
});

export default router;