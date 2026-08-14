const STREAMING_SERVICES = ["Netflix","Hulu","Disney+","Max","Prime Video","Apple TV+","Paramount+","Peacock"];
const GENRES = ["Action","Adventure","Animation","Comedy","Crime","Documentary","Drama","Family","Fantasy","History","Horror","Music","Mystery","Romance","Science Fiction","Thriller","War","Western"];
const CATEGORY_DEFS = [
  { title: "Top Picks for Your Group", subtitle: "Ranked using everyone's preferences", type: "forYou" },
  { title: "Popular Tonight", subtitle: "Popular movies on your services", type: "popular" },
  { title: "New Releases", subtitle: "Recent movies available to your group", type: "newReleases" },
  { title: "Critically Loved", subtitle: "Highly rated choices", type: "topRated" },
  { title: "Comedies", subtitle: "Easy crowd-pleasers", genre: "Comedy" },
  { title: "Thrillers", subtitle: "High-stakes movie night", genre: "Thriller" },
  { title: "Sci-Fi Worlds", subtitle: "Big ideas and bigger worlds", genre: "Science Fiction" },
  { title: "Mysteries", subtitle: "Something to figure out together", genre: "Mystery" },
  { title: "Drama", subtitle: "Character-driven picks", genre: "Drama" },
  { title: "Horror After Dark", subtitle: "Best with the lights off", genre: "Horror" }
];
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
