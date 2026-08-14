let db = null;
let selectionChannel = null;

function backendConfigured() {
  const cfg = window.APP_CONFIG || {};
  return Boolean(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    !cfg.SUPABASE_URL.startsWith("YOUR_") &&
    !cfg.SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_")
  );
}

function initBackend() {
  if (!backendConfigured()) return false;
  db = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
  );
  return true;
}

async function signUpAccount({ username, email, password }) {
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { data: { username: username.trim().toLowerCase() } }
  });
  if (error) throw error;
  return data;
}

async function signInAccount(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOutAccount() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

async function getAuthUser() {
  const { data, error } = await db.auth.getUser();
  if (error) return null;
  return data.user || null;
}

async function getMyProfile() {
  const user = await getAuthUser();
  if (!user) return null;
  const { data, error } = await db.from("profiles").select("*").eq("id", user.id).single();
  if (error) throw error;
  return data;
}

async function updateMyProfile({ streaming_services, genre_preferences }) {
  const user = await getAuthUser();
  const { data, error } = await db
    .from("profiles")
    .update({ streaming_services, genre_preferences, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listFriends() {
  const { data, error } = await db.rpc("get_my_friends");
  if (error) throw error;
  return data || [];
}

async function addFriendByUsername(username) {
  const { data, error } = await db.rpc("add_friend_by_username", {
    friend_username: username.trim().toLowerCase()
  });
  if (error) throw error;
  return data;
}

async function listGroups() {
  const { data, error } = await db.rpc("get_my_groups");
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.group_id,
    name: row.group_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    members: row.members || [],
    selections: row.selections || {}
  }));
}

async function createBackendGroup(name, memberIds) {
  const { data, error } = await db.rpc("create_group_with_members", {
    group_name: name.trim(),
    member_ids: memberIds
  });
  if (error) throw error;
  return data;
}

async function updateBackendGroup(groupId, name, memberIds) {
  const { error } = await db.rpc("update_group_with_members", {
    target_group: groupId,
    group_name: name.trim(),
    member_ids: memberIds
  });
  if (error) throw error;
}

async function deleteBackendGroup(groupId) {
  const { error } = await db.rpc("delete_group", { target_group: groupId });
  if (error) throw error;
}

async function listMyMovieIds() {
  const { data, error } = await db.from("my_list").select("movie_id").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(row => Number(row.movie_id));
}

async function addMovieToMyList(movieId) {
  const user = await getAuthUser();
  const { error } = await db.from("my_list").insert({ user_id: user.id, movie_id: Number(movieId) });
  if (error && error.code !== "23505") throw error;
}

async function removeMovieFromMyList(movieId) {
  const user = await getAuthUser();
  const { error } = await db.from("my_list").delete().eq("user_id", user.id).eq("movie_id", Number(movieId));
  if (error) throw error;
}

async function addGroupSelection(groupId, movieId) {
  const user = await getAuthUser();
  const { error } = await db.from("movie_selections").insert({
    group_id: groupId,
    user_id: user.id,
    movie_id: Number(movieId)
  });
  if (error && error.code !== "23505") throw error;
}

async function removeGroupSelection(groupId, movieId) {
  const user = await getAuthUser();
  const { error } = await db.from("movie_selections").delete()
    .eq("group_id", groupId).eq("user_id", user.id).eq("movie_id", Number(movieId));
  if (error) throw error;
}

function subscribeToGroupSelections(groupId, callback) {
  if (selectionChannel) db.removeChannel(selectionChannel);
  if (!groupId) return;

  selectionChannel = db.channel(`group-selections-${groupId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "movie_selections",
      filter: `group_id=eq.${groupId}`
    }, callback)
    .subscribe();
}

async function invokeTmdb(body) {
  const { data, error } = await db.functions.invoke("tmdb", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
