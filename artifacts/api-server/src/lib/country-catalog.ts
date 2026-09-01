import { db, countriesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const COUNTRY_SOURCE_URL = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";

type CountrySourceRecord = {
  cca2?: string;
  cca3?: string;
  name?: {
    common?: string;
    official?: string;
    native?: Record<string, { common?: string; official?: string }>;
  };
  translations?: Record<string, { common?: string; official?: string }>;
};

const extraAliases: Record<string, string[]> = {
  BR: ["Brazil"],
  US: ["EUA", "USA", "US", "United States of America", "Estados Unidos da América"],
  GB: ["UK", "United Kingdom", "Great Britain", "Grã-Bretanha"],
};

function normalizeCountryValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildCountryRow(record: CountrySourceRecord) {
  const code2 = record.cca2?.trim().toUpperCase();
  const code3 = record.cca3?.trim().toUpperCase();
  const nameEnglish = record.name?.common?.trim();
  const portugueseTranslation = record.translations?.por?.common;
  const portugueseNative = record.name?.native?.por?.common;
  const name = (portugueseTranslation || portugueseNative || nameEnglish)?.trim();

  if (!code2 || !code3 || !name || !nameEnglish) return null;

  const aliases = new Set<string>([
    code2,
    code3,
    name,
    nameEnglish,
    record.name?.official || "",
    record.name?.native?.eng?.common || "",
    record.name?.native?.eng?.official || "",
    record.name?.native?.por?.official || "",
    ...Object.values(record.translations || {}).flatMap((translation) => [
      translation.common || "",
      translation.official || "",
    ]),
    ...(extraAliases[code2] || []),
  ]);

  return {
    code2,
    code3,
    name,
    nameEnglish,
    aliases: Array.from(aliases).map((alias) => alias.trim()).filter(Boolean),
  };
}

export async function initializeCountryCatalog(): Promise<void> {
  const existing = await db.select({ code2: countriesTable.code2 }).from(countriesTable);
  if (existing.length >= 240) return;

  const response = await fetch(COUNTRY_SOURCE_URL, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Country catalog source returned HTTP ${response.status}`);
  }

  const source = (await response.json()) as CountrySourceRecord[];
  const rows = source.map(buildCountryRow).filter((row): row is NonNullable<ReturnType<typeof buildCountryRow>> => Boolean(row));
  if (rows.length < 240) {
    throw new Error(`Country catalog source returned only ${rows.length} valid countries`);
  }

  await db
    .insert(countriesTable)
    .values(rows)
    .onConflictDoUpdate({
      target: countriesTable.code2,
      set: {
        code3: sql`excluded.code3`,
        name: sql`excluded.name`,
        nameEnglish: sql`excluded.name_english`,
        aliases: sql`excluded.aliases`,
        updatedAt: new Date(),
      },
    });
}

export { normalizeCountryValue };