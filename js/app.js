const state = {
  user: null,
  profile: null,
  friends: [],
  groups: [],
  currentGroupId: null,
  editingGroupId: null,
  myListIds: [],
  catalog: null,
  movies: new Map(),
  activeMovieId: null,
  activeSection: "home",
  catalogRequest: 0
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const unique = items => [...new Set(items)];
function uniqueMovies(items) {
  return [...new Map((items || []).map(movie => [Number(movie.id), movie])).values()];
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2300);
}

function setStatus(message = "") {
  const status = $("#catalog-status");
  status.textContent = message;
  status.classList.toggle("hidden", !message);
}

function openModal(id) { document.getElementById(id).classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); document.body.style.overflow = ""; }
function openDrawer(id) { document.getElementById(id).classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeDrawer(id) { document.getElementById(id).classList.add("hidden"); document.body.style.overflow = ""; }
function initials(username) { return String(username || "?").slice(0, 2).toUpperCase(); }

function currentGroup() {
  return state.groups.find(group => group.id === state.currentGroupId) || null;
}

function groupMembers() {
  const group = currentGroup();
  return group ? group.members : [state.profile];
}

function availableServices() {
  return unique(groupMembers().flatMap(member => member?.streaming_services || []));
}

function preferredGenres() {
  const counts = {};
  groupMembers().forEach(member => (member?.genre_preferences || []).forEach(genre => counts[genre] = (counts[genre] || 0) + 1));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
}

function rememberMovies(movies) {
  (movies || []).forEach(movie => state.movies.set(Number(movie.id), movie));
}

function movieById(movieId) {
  return state.movies.get(Number(movieId)) || movieCache.get(Number(movieId)) || null;
}

async function refreshBackendState() {
  [state.profile, state.friends, state.groups, state.myListIds] = await Promise.all([
    getMyProfile(), listFriends(), listGroups(), listMyMovieIds()
  ]);

  if (state.currentGroupId && !state.groups.some(group => group.id === state.currentGroupId)) state.currentGroupId = null;
  if (!state.currentGroupId && state.groups.length) state.currentGroupId = state.groups[0].id;

  renderAccountDependentUI();
  subscribeToCurrentGroup();
}

async function bootApp() {
  state.user = await getAuthUser();
  if (!state.user) return showAuth();

  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  await refreshBackendState();
  $("#profile-initial").textContent = state.profile.username[0].toUpperCase();
  await loadCatalog();
  await renderMyList();
}

function showAuth() {
  $("#app-view").classList.add("hidden");
  $("#auth-view").classList.remove("hidden");
}

function renderAccountDependentUI() {
  renderGroupSelector();
  renderGroupSummary();
  renderProfileSettings();
  renderFriends();
  renderGroupsPage();
  if (state.catalog) {
    renderMovieRows();
    renderHero();
  }
}

async function loadCatalog() {
  const request = ++state.catalogRequest;
  setStatus("Loading movies from your group's streaming services…");
  try {
    const catalog = await fetchCatalog(availableServices(), preferredGenres());
    if (request !== state.catalogRequest) return;
    state.catalog = catalog;

    const all = uniqueMovies([
      ...catalog.forYou, ...catalog.popular, ...catalog.newReleases, ...catalog.topRated
    ]);
    all.forEach(movie => {
      if (!movie.genres?.length) movie.genres = (movie.genreIds || []).map(id => catalog.genreMap[String(id)]).filter(Boolean);
    });
    rememberMovies(all);
    renderMovieRows();
    renderHero();
    setStatus("");
  } catch (error) {
    console.error(error);
    setStatus(`Could not load TMDB movies: ${error.message}`);
  }
}

function rowMovies(def) {
  if (!state.catalog) return [];
  let movies;
  if (def.type) movies = state.catalog[def.type] || [];
  else movies = uniqueMovies([...state.catalog.forYou, ...state.catalog.popular, ...state.catalog.topRated, ...state.catalog.newReleases])
    .filter(movie => (movie.genres || []).includes(def.genre));

  return [...movies].sort((a, b) => recommendationScore(b) - recommendationScore(a)).slice(0, 18);
}

function recommendationScore(movie) {
  const prefs = preferredGenres();
  const group = currentGroup();
  const friendPicks = group ? group.members.filter(m => m.username !== state.profile.username && (group.selections[m.username] || []).map(Number).includes(Number(movie.id))).length : 0;
  const genreScore = (movie.genres || []).reduce((sum, genre) => {
    const index = prefs.indexOf(genre);
    return sum + (index >= 0 ? Math.max(1, prefs.length - index) : 0);
  }, 0);
  return genreScore * 2 + friendPicks * 10 + (movie.rating || 0);
}

function renderMovieRows() {
  if (!state.catalog) return;
  $("#movie-rows").innerHTML = CATEGORY_DEFS.map(def => {
    const movies = rowMovies(def);
    if (!movies.length) return "";
    return `<section class="movie-row"><div class="row-heading"><h2>${escapeHTML(def.title)}</h2><span>${escapeHTML(def.subtitle)}</span></div><div class="horizontal-scroller">${movies.map(movieCardHTML).join("")}</div></section>`;
  }).join("");

  $$(".movie-card").forEach(card => card.addEventListener("click", () => openMovie(Number(card.dataset.movieId))));
}

function movieCardHTML(movie) {
  const group = currentGroup();
  const selected = group ? (group.selections[state.profile.username] || []).map(Number).includes(Number(movie.id)) : false;
  const friendCount = group ? group.members.filter(m => m.username !== state.profile.username && (group.selections[m.username] || []).map(Number).includes(Number(movie.id))).length : 0;
  const poster = posterURL(movie);
  const providerText = movie.providers?.length ? movie.providers.map(p => p.name).slice(0, 2).join(", ") : "Streaming";

  return `<button class="movie-card" data-movie-id="${movie.id}">
    <div class="poster-art ${poster ? "has-image" : ""}">
      ${poster ? `<img class="poster-image" src="${poster}" alt="${escapeHTML(movie.title)} poster" loading="lazy">` : ""}
      ${selected ? `<span class="selection-badge">✓</span>` : ""}
      ${friendCount ? `<span class="friend-like-badge">${friendCount} friend${friendCount > 1 ? "s" : ""} picked this</span>` : ""}
      <span class="poster-title">${escapeHTML(movie.title)}</span>
    </div>
    <div class="card-info"><span class="card-title">${escapeHTML(movie.title)}</span><span class="card-subtitle"><span class="card-service">${escapeHTML(providerText)}</span><span>•</span><span>${movie.rating ? movie.rating.toFixed(1) : "New"}</span></span></div>
  </button>`;
}

function renderHero() {
  const movie = rowMovies(CATEGORY_DEFS[0])[0] || state.catalog?.popular?.[0];
  if (!movie) return;
  $("#hero-title").textContent = movie.title;
  $("#hero-description").textContent = movie.description;
  $("#hero-meta").innerHTML = [movie.year, movie.rating ? `${movie.rating.toFixed(1)}/10` : null, (movie.genres || []).slice(0, 3).join(" • ")].filter(Boolean).map(x => `<span>${escapeHTML(x)}</span>`).join("<span>•</span>");
  const backdrop = backdropURL(movie);
  if (backdrop) $("#hero").style.backgroundImage = `linear-gradient(to top, var(--bg) 0%, transparent 31%), linear-gradient(to right, rgba(0,0,0,.86), rgba(0,0,0,.08)), url('${backdrop}')`;
  $("#hero-details-button").onclick = () => openMovie(movie.id);
  $("#hero-select-button").onclick = () => toggleGroupSelection(movie.id);
  updateHeroSelectionButton(movie.id);
}

function updateHeroSelectionButton(movieId) {
  const group = currentGroup();
  const selected = group && (group.selections[state.profile.username] || []).map(Number).includes(Number(movieId));
  $("#hero-select-button").textContent = selected ? "✓ Selected" : "Select for group";
}

async function openMovie(movieId) {
  state.activeMovieId = Number(movieId);
  let movie = movieById(movieId);
  if (!movie) return;
  renderMovieModal(movie, true);
  openModal("movie-modal");

  try {
    movie = await fetchMovieDetails(movieId);
    rememberMovies([movie]);
    renderMovieModal(movie, false);
    renderMovieRows();
  } catch (error) {
    console.error(error);
    $("#modal-service").textContent = "Streaming info unavailable";
  }
}

function renderMovieModal(movie, loadingDetails) {
  $("#modal-title").textContent = movie.title;
  const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : null;
  $("#modal-meta").textContent = [movie.year, runtime, movie.rating ? `${movie.rating.toFixed(1)}/10` : null].filter(Boolean).join(" • ");
  $("#modal-description").textContent = movie.description;
  $("#modal-genres").textContent = (movie.genres || []).join(", ") || "Loading…";
  $("#modal-cast").textContent = movie.cast?.length ? movie.cast.join(", ") : (loadingDetails ? "Loading…" : "Not listed");
  $("#modal-service").textContent = movie.providers?.length ? movie.providers.map(p => p.name).join(", ") : (loadingDetails ? "Checking streaming…" : "No subscription provider listed");
  $("#modal-fit").textContent = fitExplanation(movie);
  const hero = $("#movie-modal-hero");
  const backdrop = backdropURL(movie);
  hero.classList.toggle("has-image", Boolean(backdrop));
  if (backdrop) hero.style.backgroundImage = `linear-gradient(to top, #18181b, transparent 55%), url('${backdrop}')`;
  updateMovieModalButtons();
}

function fitExplanation(movie) {
  const prefs = preferredGenres();
  const matching = (movie.genres || []).filter(g => prefs.includes(g));
  const group = currentGroup();
  const friendCount = group ? group.members.filter(m => m.username !== state.profile.username && (group.selections[m.username] || []).map(Number).includes(Number(movie.id))).length : 0;
  if (friendCount && matching.length) return `${friendCount} friend${friendCount > 1 ? "s" : ""} selected it; ${matching.slice(0, 2).join(" + ")} match the group.`;
  if (friendCount) return `${friendCount} friend${friendCount > 1 ? "s" : ""} already selected it.`;
  if (matching.length) return `${matching.slice(0, 2).join(" + ")} match the group's preferences.`;
  return "A broader recommendation from the group's available catalog.";
}

function updateMovieModalButtons() {
  const id = Number(state.activeMovieId);
  const inList = state.myListIds.map(Number).includes(id);
  const group = currentGroup();
  const selected = group && (group.selections[state.profile.username] || []).map(Number).includes(id);
  $("#modal-list-button").textContent = inList ? "✓ In My List" : "+ My List";
  $("#modal-select-button").disabled = !group;
  $("#modal-select-button").textContent = !group ? "Create or choose a group" : selected ? "✓ Selected for group" : "Select for group";
}

async function toggleMyList(movieId) {
  const id = Number(movieId);
  const exists = state.myListIds.map(Number).includes(id);
  if (exists) { await removeMovieFromMyList(id); state.myListIds = state.myListIds.filter(x => Number(x) !== id); showToast("Removed from My List"); }
  else { await addMovieToMyList(id); state.myListIds.unshift(id); showToast("Added to My List"); }
  updateMovieModalButtons();
  await renderMyList();
}

async function toggleGroupSelection(movieId) {
  const group = currentGroup();
  if (!group) return showToast("Create or choose a group first.");
  const id = Number(movieId);
  const mine = (group.selections[state.profile.username] || []).map(Number);
  if (mine.includes(id)) await removeGroupSelection(group.id, id); else await addGroupSelection(group.id, id);
  await refreshGroupsOnly();
  showToast(mine.includes(id) ? "Removed from group picks" : "Selected for your group");
}

async function refreshGroupsOnly() {
  state.groups = await listGroups();
  renderGroupSelector(); renderGroupSummary(); renderGroupsPage();
  if (state.catalog) { renderMovieRows(); renderHero(); }
  updateMovieModalButtons();
}

function subscribeToCurrentGroup() {
  subscribeToGroupSelections(state.currentGroupId, async () => { await refreshGroupsOnly(); });
}

function renderGroupSelector() {
  $("#group-select").innerHTML = `<option value="">Browsing by myself</option>` + state.groups.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join("");
  $("#group-select").value = state.currentGroupId || "";
}

function renderGroupSummary() {
  const members = groupMembers();
  $("#group-members").innerHTML = members.slice(0, 5).map(m => `<div class="avatar" title="${escapeHTML(m.username)}">${initials(m.username)}</div>`).join("");
  $("#group-member-text").textContent = members.length === 1 ? "Just you" : `${members.length} people: ${members.map(m => m.username).join(", ")}`;
  const services = availableServices();
  $("#group-service-text").textContent = services.length ? `Available across ${services.join(", ")}` : "Add streaming services in your profile";
  const group = currentGroup();
  const count = group ? Object.values(group.selections || {}).reduce((sum, picks) => sum + picks.length, 0) : 0;
  $("#match-button-caption").textContent = count ? `${count} group selections` : "Select movies first";
}

function renderProfileSettings() {
  if (!state.profile) return;
  $("#profile-username").textContent = state.profile.username;
  $("#service-checkboxes").innerHTML = STREAMING_SERVICES.map(service => `<label><input type="checkbox" name="service" value="${escapeHTML(service)}" ${state.profile.streaming_services.includes(service) ? "checked" : ""}>${escapeHTML(service)}</label>`).join("");
  $("#genre-checkboxes").innerHTML = GENRES.map(genre => `<label><input type="checkbox" name="genre" value="${escapeHTML(genre)}" ${state.profile.genre_preferences.includes(genre) ? "checked" : ""}>${escapeHTML(genre)}</label>`).join("");
}

async function saveProfileSettings() {
  state.profile = await updateMyProfile({
    streaming_services: $$("input[name='service']:checked").map(i => i.value),
    genre_preferences: $$("input[name='genre']:checked").map(i => i.value)
  });
  closeDrawer("profile-drawer");
  renderAccountDependentUI();
  await loadCatalog();
  showToast("Preferences saved");
}

function renderFriends() {
  if (!state.profile) return;
  $("#friends-list").innerHTML = state.friends.length ? state.friends.map(friend => `<div class="friend-row"><div class="friend-row-main"><div class="avatar">${initials(friend.username)}</div><div><strong>${escapeHTML(friend.username)}</strong><div class="muted small">${escapeHTML((friend.streaming_services || []).join(", ") || "No services saved")}</div></div></div></div>`).join("") : `<div class="empty-state">Add a friend by username to create a group.</div>`;
}

function renderGroupFriendOptions(selectedIds = []) {
  const selected = new Set(selectedIds);
  $("#group-friend-options").innerHTML = state.friends.length ? state.friends.map(friend => `<label class="check-option"><input type="checkbox" name="group-friend" value="${friend.id}" ${selected.has(friend.id) ? "checked" : ""}><span>${escapeHTML(friend.username)}</span></label>`).join("") : `<div class="empty-state">Add friends first.</div>`;
}

function renderGroupsPage() {
  $("#groups-grid").innerHTML = state.groups.length ? state.groups.map(group => {
    const services = unique(group.members.flatMap(m => m.streaming_services || []));
    const selections = Object.values(group.selections || {}).reduce((sum, p) => sum + p.length, 0);
    const canManage = group.createdBy === state.user.id;
    return `<article class="group-card"><div class="eyebrow">${group.members.length} members</div><h3>${escapeHTML(group.name)}</h3><div class="muted small">${escapeHTML(group.members.map(m => m.username).join(", "))}</div><div class="muted small" style="margin-top:8px;">${escapeHTML(services.join(", "))}</div><div class="group-card-footer"><span class="small">${selections} selections</span><div class="group-card-actions">${canManage ? `<button class="small-button edit-group-button" data-group-id="${group.id}">Edit</button>` : ""}<button class="small-button use-group-button" data-group-id="${group.id}">Open group</button></div></div></article>`;
  }).join("") : `<div class="empty-state">You do not have any groups yet. Add friends, then create a movie-night group.</div>`;

  $$(".use-group-button").forEach(button => button.addEventListener("click", async () => {
    state.currentGroupId = button.dataset.groupId; subscribeToCurrentGroup(); renderAccountDependentUI(); showSection("home"); await loadCatalog();
  }));
  $$(".edit-group-button").forEach(button => button.addEventListener("click", () => openEditGroupModal(button.dataset.groupId)));
}

async function renderMyList() {
  const grid = $("#my-list-grid");
  if (!state.myListIds.length) { grid.innerHTML = `<div class="empty-state">Your list is empty. Open a movie and choose <strong>+ My List</strong>.</div>`; return; }
  const movies = await hydrateMovies(state.myListIds);
  rememberMovies(movies);
  grid.innerHTML = movies.map(movieCardHTML).join("");
  grid.querySelectorAll(".movie-card").forEach(card => card.addEventListener("click", () => openMovie(Number(card.dataset.movieId))));
}

async function findGroupMatch() {
  const group = currentGroup();
  if (!group) { $("#match-result-content").innerHTML = `<h2>Choose a group first</h2><p class="muted">Create a group with friends, then each person can select movies.</p>`; return openModal("match-modal"); }
  const sets = group.members.map(m => new Set((group.selections[m.username] || []).map(Number)));
  const missing = group.members.filter((m, i) => sets[i].size === 0);
  if (missing.length) { $("#match-result-content").innerHTML = `<h2>Not everyone has picked yet</h2><p class="muted">${escapeHTML(missing.map(m => m.username).join(", "))} ${missing.length === 1 ? "needs" : "need"} to select at least one movie.</p>`; return openModal("match-modal"); }

  const unanimous = [...sets[0]].filter(id => sets.every(set => set.has(id)));
  if (unanimous.length) {
    const movies = await hydrateMovies(unanimous); rememberMovies(movies);
    movies.sort((a, b) => finalMatchScore(b, group) - finalMatchScore(a, group));
    return showWinningMatch(movies[0], unanimous.length);
  }

  const counts = {};
  group.members.forEach(m => (group.selections[m.username] || []).forEach(id => counts[Number(id)] = (counts[Number(id)] || 0) + 1));
  const rankedIds = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]);
  const movies = await hydrateMovies(rankedIds.slice(0, 4)); rememberMovies(movies);
  const best = movies.sort((a, b) => (counts[b.id] - counts[a.id]) || (finalMatchScore(b, group) - finalMatchScore(a, group)))[0];
  showNearMatch(best, counts[best?.id] || 0, group.members.length);
}

function finalMatchScore(movie, group) {
  const prefHits = group.members.reduce((score, member) => score + (movie.genres || []).filter(g => (member.genre_preferences || []).includes(g)).length, 0);
  return prefHits * 4 + (movie.rating || 0) * 2;
}

function matchPosterStyle(movie) {
  const backdrop = backdropURL(movie);
  return backdrop ? `background-image:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,.05)),url('${backdrop}');background-size:cover;background-position:center;` : "";
}

function showWinningMatch(movie, unanimousCount) {
  $("#match-result-content").innerHTML = `<h2>You have a match.</h2><p class="muted">${unanimousCount === 1 ? "This is the only movie everyone selected." : `Everyone selected ${unanimousCount} of the same movies. This one best fits the group.`}</p><div class="match-poster" style="${matchPosterStyle(movie)}"><h2>${escapeHTML(movie.title)}</h2></div><div class="service-pill">${escapeHTML(movie.providers?.map(p => p.name).join(", ") || "Open details for availability")}</div><div class="match-reasons"><div>✓ Every group member selected it</div><div>✓ ${movie.rating ? movie.rating.toFixed(1) : "—"}/10 TMDB rating</div><div>✓ Best preference score among the shared choices</div></div><button class="primary-button full-width" style="margin-top:22px;" id="match-details-button">View movie details</button>`;
  openModal("match-modal");
  $("#match-details-button").onclick = () => { closeModal("match-modal"); openMovie(movie.id); };
}

function showNearMatch(movie, count, total) {
  $("#match-result-content").innerHTML = `<h2>No unanimous match yet</h2><p class="muted">Nobody picked the exact same movie across the full group yet. This is the closest match.</p>${movie ? `<div class="match-poster" style="${matchPosterStyle(movie)}"><h2>${escapeHTML(movie.title)}</h2></div><div class="match-reasons"><div>Selected by ${count} of ${total} people</div><div>${escapeHTML((movie.genres || []).join(", "))}</div></div>` : ""}<p class="muted small" style="margin-top:18px;">Keep selecting movies until the group has at least one shared choice.</p>`;
  openModal("match-modal");
}

function showSection(section) {
  state.activeSection = section;
  ["home", "my-list", "groups"].forEach(name => $(`#${name}-section`).classList.toggle("hidden", name !== section));
  $$(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.section === section));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (section === "my-list") renderMyList();
}

// UI events
$$(".auth-tab").forEach(button => button.addEventListener("click", () => {
  $$(".auth-tab").forEach(tab => tab.classList.remove("active")); button.classList.add("active");
  $("#login-form").classList.toggle("hidden", button.dataset.authTab !== "login");
  $("#signup-form").classList.toggle("hidden", button.dataset.authTab !== "signup");
}));

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#login-message").textContent = "";
  try { await signInAccount($("#login-email").value, $("#login-password").value); await bootApp(); }
  catch (error) { $("#login-message").textContent = error.message; }
});

$("#signup-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#signup-message").textContent = "";
  try {
    const data = await signUpAccount({ username: $("#signup-username").value, email: $("#signup-email").value, password: $("#signup-password").value });
    if (data.session) await bootApp(); else $("#signup-message").textContent = "Account created. Check your email to confirm it, then log in.";
  } catch (error) { $("#signup-message").textContent = error.message; }
});

$("#group-select").addEventListener("change", async event => { state.currentGroupId = event.target.value || null; subscribeToCurrentGroup(); renderAccountDependentUI(); await loadCatalog(); });
$("#profile-button").addEventListener("click", () => { renderProfileSettings(); openDrawer("profile-drawer"); });
$("#friends-button").addEventListener("click", () => { renderFriends(); openDrawer("friends-drawer"); });
$("#refresh-button").addEventListener("click", loadCatalog);
$("#save-profile-button").addEventListener("click", saveProfileSettings);
$("#logout-button").addEventListener("click", async () => { await signOutAccount(); state.user = null; state.profile = null; state.groups = []; state.currentGroupId = null; showAuth(); });

$("#add-friend-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#friend-message").textContent = "";
  try { await addFriendByUsername($("#friend-username").value); state.friends = await listFriends(); renderFriends(); renderGroupFriendOptions(); event.target.reset(); showToast("Friend added"); }
  catch (error) { $("#friend-message").textContent = error.message; }
});

function openCreateGroupModal() {
  state.editingGroupId = null;
  $("#create-group-form").reset();
  $("#group-modal-eyebrow").textContent = "New movie night";
  $("#group-modal-title").textContent = "Create a group";
  $("#group-submit-button").textContent = "Create group";
  $("#delete-group-button").classList.add("hidden");
  renderGroupFriendOptions();
  openModal("group-modal");
}

function openEditGroupModal(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group || group.createdBy !== state.user.id) return;
  state.editingGroupId = group.id;
  $("#create-group-form").reset();
  $("#group-modal-eyebrow").textContent = "Group settings";
  $("#group-modal-title").textContent = "Edit group";
  $("#group-submit-button").textContent = "Save changes";
  $("#delete-group-button").classList.remove("hidden");
  $("#group-name").value = group.name;
  renderGroupFriendOptions(group.members.filter(member => member.id !== state.user.id).map(member => member.id));
  openModal("group-modal");
}
$("#create-group-button").addEventListener("click", openCreateGroupModal);
$("#create-group-button-2").addEventListener("click", openCreateGroupModal);
$("#create-group-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const memberIds = $$("input[name='group-friend']:checked").map(i => i.value);
    const editing = state.editingGroupId;
    if (editing) await updateBackendGroup(editing, $("#group-name").value, memberIds);
    else state.currentGroupId = await createBackendGroup($("#group-name").value, memberIds);
    state.groups = await listGroups(); closeModal("group-modal"); state.editingGroupId = null; subscribeToCurrentGroup(); renderAccountDependentUI();
    if (!editing) showSection("home");
    await loadCatalog(); showToast(editing ? "Group updated" : "Group created");
  } catch (error) { showToast(error.message); }
});

$("#delete-group-button").addEventListener("click", async () => {
  const group = state.groups.find(item => item.id === state.editingGroupId);
  if (!group || !window.confirm(`Delete “${group.name}”? This cannot be undone.`)) return;
  try {
    await deleteBackendGroup(group.id);
    if (state.currentGroupId === group.id) state.currentGroupId = null;
    state.editingGroupId = null;
    state.groups = await listGroups();
    if (!state.currentGroupId && state.groups.length) state.currentGroupId = state.groups[0].id;
    closeModal("group-modal"); subscribeToCurrentGroup(); renderAccountDependentUI(); await loadCatalog(); showToast("Group deleted");
  } catch (error) { showToast(error.message); }
});

$("#find-match-button").addEventListener("click", findGroupMatch);
$("#modal-list-button").addEventListener("click", () => toggleMyList(state.activeMovieId));
$("#modal-select-button").addEventListener("click", () => toggleGroupSelection(state.activeMovieId));
$$("[data-close-modal]").forEach(el => el.addEventListener("click", () => closeModal(el.dataset.closeModal)));
$$("[data-close-drawer]").forEach(el => el.addEventListener("click", () => closeDrawer(el.dataset.closeDrawer)));
$$(".nav-link").forEach(button => button.addEventListener("click", () => showSection(button.dataset.section)));
$("#home-link").addEventListener("click", event => { event.preventDefault(); showSection("home"); });
document.addEventListener("keydown", event => { if (event.key === "Escape") { ["movie-modal","group-modal","match-modal"].forEach(closeModal); state.editingGroupId = null; ["profile-drawer","friends-drawer"].forEach(closeDrawer); } });

(async function start() {
  if (!initBackend()) {
    $("#config-warning").classList.remove("hidden");
    $("#config-warning").innerHTML = "Backend configuration is missing. Fill in <strong>js/config.js</strong> after creating your Supabase project; then run <strong>supabase/schema.sql</strong> and deploy the TMDB Edge Function.";
    $$("#login-form button, #signup-form button").forEach(button => button.disabled = true);
    return;
  }
  try { await bootApp(); } catch (error) { console.error(error); showAuth(); $("#login-message").textContent = error.message; }
})();
