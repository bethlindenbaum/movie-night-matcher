const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_TOKEN = Deno.env.get("TMDB_API_READ_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVICE_ALIASES: Record<string, string[]> = {
  "Netflix": ["netflix"],
  "Hulu": ["hulu"],
  "Disney+": ["disney plus", "disney+"],
  "Max": ["max"],
  "Prime Video": ["amazon prime video", "prime video"],
  "Apple TV+": ["apple tv plus", "apple tv+"],
  "Paramount+": ["paramount plus", "paramount+"],
  "Peacock": ["peacock premium", "peacock"]
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function tmdb(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  if (!TMDB_TOKEN) throw new Error("TMDB_API_READ_TOKEN is not configured in Edge Function secrets.");
  const url = new URL(`${TMDB_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}: ${await response.text()}`);
  return await response.json();
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+ ]/g, "").trim();
}

async function getLookups(region: string) {
  const [providers, genres] = await Promise.all([
    tmdb("/watch/providers/movie", { watch_region: region, language: "en-US" }),
    tmdb("/genre/movie/list", { language: "en-US" })
  ]);
  return { providers: providers.results || [], genres: genres.genres || [] };
}

function providerIdsForServices(services: string[], providers: any[]) {
  const ids: number[] = [];
  for (const service of services || []) {
    const aliases = (SERVICE_ALIASES[service] || [service]).map(normalizeName);
    const exact = providers.find((provider: any) => aliases.includes(normalizeName(provider.provider_name || "")));
    const match = exact || providers.find((provider: any) => {
      const name = normalizeName(provider.provider_name || "");
      return aliases.some(alias => name.includes(alias));
    });
    if (match) ids.push(match.provider_id);
  }
  return [...new Set(ids)];
}

function genreIdsForNames(names: string[], genres: any[]) {
  const wanted = new Set((names || []).map(normalizeName));
  return genres.filter((g: any) => wanted.has(normalizeName(g.name))).map((g: any) => g.id);
}

function cleanResults(payload: any) {
  return (payload.results || []).filter((m: any) => !m.adult && m.poster_path).slice(0, 20);
}

async function catalog(services: string[], preferredGenres: string[], region: string) {
  const { providers, genres } = await getLookups(region);
  const providerIds = providerIdsForServices(services, providers);
  const preferredGenreIds = genreIdsForNames(preferredGenres, genres);

  const common: Record<string, string | number | boolean | undefined> = {
    language: "en-US",
    include_adult: false,
    include_video: false,
    watch_region: region,
    with_watch_monetization_types: "flatrate",
    with_watch_providers: providerIds.length ? providerIds.join("|") : undefined
  };

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  const date = (d: Date) => d.toISOString().slice(0, 10);

  const [popular, topRated, newReleases, forYou] = await Promise.all([
    tmdb("/discover/movie", { ...common, sort_by: "popularity.desc", "vote_count.gte": 100 }),
    tmdb("/discover/movie", { ...common, sort_by: "vote_average.desc", "vote_count.gte": 500 }),
    tmdb("/discover/movie", { ...common, sort_by: "primary_release_date.desc", "primary_release_date.gte": date(oneYearAgo), "primary_release_date.lte": date(now) }),
    tmdb("/discover/movie", { ...common, sort_by: "popularity.desc", "vote_count.gte": 75, with_genres: preferredGenreIds.length ? preferredGenreIds.join("|") : undefined })
  ]);

  return {
    popular: cleanResults(popular),
    topRated: cleanResults(topRated),
    newReleases: cleanResults(newReleases),
    forYou: cleanResults(forYou),
    genreMap: Object.fromEntries(genres.map((g: any) => [String(g.id), g.name]))
  };
}

async function details(movieId: number, region: string) {
  const movie = await tmdb(`/movie/${movieId}`, {
    language: "en-US",
    append_to_response: "credits,watch/providers"
  });

  const regionProviders = movie["watch/providers"]?.results?.[region] || {};
  const providers = (regionProviders.flatrate || []).map((p: any) => ({
    id: p.provider_id,
    name: p.provider_name,
    logoPath: p.logo_path
  }));

  return {
    movie: {
      ...movie,
      cast: (movie.credits?.cast || []).slice(0, 6).map((person: any) => person.name),
      providers,
      providerLink: regionProviders.link || null
    }
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const body = await req.json();
    const region = String(body.region || "US").toUpperCase();
    if (body.action === "catalog") return json(await catalog(body.services || [], body.preferredGenres || [], region));
    if (body.action === "details") return json(await details(Number(body.movieId), region));
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown backend error" }, 500);
  }
});
