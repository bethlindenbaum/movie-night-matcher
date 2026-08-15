const movieCache = new Map();
const detailCache = new Map();

function normalizeMovie(raw) {
  if (!raw) return null;
  const movie = {
    id: Number(raw.id),
    title: raw.title || raw.original_title || "Untitled",
    year: raw.release_date ? Number(raw.release_date.slice(0, 4)) : null,
    releaseDate: raw.release_date || "",
    rating: Number(raw.vote_average || 0),
    voteCount: Number(raw.vote_count || 0),
    description: raw.overview || "No description is available yet.",
    genreIds: raw.genre_ids || (raw.genres || []).map(g => g.id),
    genres: (raw.genres || []).map(g => typeof g === "string" ? g : g.name),
    posterPath: raw.poster_path || null,
    backdropPath: raw.backdrop_path || null,
    runtime: raw.runtime || null,
    maturity: raw.maturity || null,
    cast: raw.cast || [],
    providers: raw.providers || [],
    providerLink: raw.providerLink || null
  };
  movieCache.set(movie.id, { ...(movieCache.get(movie.id) || {}), ...movie });
  return movieCache.get(movie.id);
}

function posterURL(movie, size = "w500") {
  return movie?.posterPath ? `${TMDB_IMAGE_BASE}/${size}${movie.posterPath}` : null;
}

function backdropURL(movie, size = "w1280") {
  return movie?.backdropPath ? `${TMDB_IMAGE_BASE}/${size}${movie.backdropPath}` : null;
}

async function fetchCatalog(services, preferredGenres) {
  const data = await invokeTmdb({
    action: "catalog",
    services,
    preferredGenres,
    region: window.APP_CONFIG.WATCH_REGION || "US"
  });

  const normalizeList = list => (list || []).map(normalizeMovie).filter(Boolean);
  return {
    genreMap: data.genreMap || {},
    popular: normalizeList(data.popular),
    topRated: normalizeList(data.topRated),
    newReleases: normalizeList(data.newReleases),
    forYou: normalizeList(data.forYou)
  };
}

async function fetchGenresCatalog(services) {
  const data = await invokeTmdb({
    action: "genres",
    services,
    region: window.APP_CONFIG.WATCH_REGION || "US"
  });
  return (data.genres || []).map(genre => ({
    name: genre.name,
    movies: (genre.movies || []).map(normalizeMovie).filter(Boolean).map(movie => {
      if (!movie.genres.length) movie.genres = (movie.genreIds || []).map(id => data.genreMap?.[String(id)]).filter(Boolean);
      return movie;
    })
  }));
}

async function fetchGenreMovies(genre, services, page = 1) {
  const data = await invokeTmdb({
    action: "genre",
    genre,
    services,
    page,
    region: window.APP_CONFIG.WATCH_REGION || "US"
  });
  return {
    movies: (data.movies || []).map(normalizeMovie).filter(Boolean).map(movie => {
      if (!movie.genres.length) movie.genres = (movie.genreIds || []).map(id => data.genreMap?.[String(id)]).filter(Boolean);
      return movie;
    }),
    page: Number(data.page || page),
    totalPages: Number(data.totalPages || 1)
  };
}

async function fetchMovieDetails(movieId) {
  const id = Number(movieId);
  if (detailCache.has(id)) return detailCache.get(id);
  const data = await invokeTmdb({
    action: "details",
    movieId: id,
    region: window.APP_CONFIG.WATCH_REGION || "US"
  });
  const movie = normalizeMovie(data.movie);
  detailCache.set(id, movie);
  return movie;
}

async function hydrateMovies(movieIds) {
  const uniqueIds = [...new Set(movieIds.map(Number))];
  const results = await Promise.all(uniqueIds.map(async id => {
    if (movieCache.has(id)) return movieCache.get(id);
    try { return await fetchMovieDetails(id); } catch { return null; }
  }));
  return results.filter(Boolean);
}
