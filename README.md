# MovieMatch — Supabase + TMDB version

MovieMatch is a browser app for finding a movie that everyone in a friend group wants to watch.

This version uses:

- **Supabase Auth** for real email/password accounts
- **Supabase Postgres** for profiles, friends, groups, lists, and selections
- **Supabase Row Level Security (RLS)** to protect user/group data
- **Supabase Realtime** so group selections update across devices
- **Supabase Edge Functions** as the server-side API layer
- **TMDB** for live movie metadata, posters, descriptions, ratings, cast, genres, and watch-provider availability
- **JustWatch data through TMDB** for streaming-provider availability

## Project structure

```text
movie-night-matcher/
├── index.html
├── README.md
├── .gitignore
├── css/
│   └── style.css
├── js/
│   ├── config.js
│   ├── config.example.js
│   ├── data.js
│   ├── backend.js
│   ├── movie-api.js
│   └── app.js
└── supabase/
    ├── schema.sql
    └── functions/
        └── tmdb/
            └── index.ts
```

## 1. Create a Supabase project

Create a new project in Supabase.

In the project dashboard, open **SQL Editor**, create a new query, paste the entire contents of:

```text
supabase/schema.sql
```

and run it.

The schema creates:

- `profiles`
- `friendships`
- `groups`
- `group_members`
- `movie_selections`
- `my_list`
- helper database functions for adding friends and creating/loading groups
- RLS policies
- a Realtime publication for movie selections

## 2. Configure the browser's Supabase connection

In your Supabase project settings, copy the project's:

- Project URL
- Publishable key (or legacy anon key)

Open:

```text
js/config.js
```

and replace:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  WATCH_REGION: "US"
};
```

The publishable/anon key is the browser-facing key. **Do not put a Supabase secret/service-role key in this file.** RLS is what protects the database when the public client key is used.

## 3. Get a TMDB API Read Access Token

Create/sign into a TMDB account, register for API access, and copy your **API Read Access Token**.

Do not put the TMDB token in `config.js`. This project proxies TMDB requests through a server-side Supabase Edge Function.

## 4. Deploy the TMDB Edge Function

Install and authenticate the Supabase CLI, then from the project directory link your Supabase project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Store the TMDB token as an Edge Function secret:

```bash
supabase secrets set TMDB_API_READ_TOKEN=YOUR_TMDB_API_READ_ACCESS_TOKEN
```

Deploy the function:

```bash
supabase functions deploy tmdb
```

The function is located at:

```text
supabase/functions/tmdb/index.ts
```

It supports two operations used by the browser:

```text
catalog
```

Returns popular, highly rated, new, and preference-based movies filtered to the group's streaming services.

```text
details
```

Returns full movie details, cast, and the movie's subscription streaming providers for the configured country.

## 5. Configure Auth

MovieMatch uses email/password authentication.

For local development, set your Supabase Auth Site URL to something such as:

```text
http://localhost:8000
```

By default, Supabase may require new users to confirm their email. If confirmation is enabled, the UI tells the user to check their email after signup.

Each user also chooses a unique MovieMatch username. Friends are added by username rather than by email.

## 6. Run the browser app

From the `movie-night-matcher` directory:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

Do not rely on opening `index.html` directly with a `file://` URL once authentication/API calls are enabled.

## How the live app works

### Accounts

Supabase Auth owns credentials. A trigger automatically creates a row in `profiles` whenever a new Auth user is created.

A profile stores:

```text
username
streaming_services[]
genre_preferences[]
```

Passwords are never stored in your application tables or in browser `localStorage`.

### Friends

The user enters another MovieMatch username. The `add_friend_by_username` database function creates the friendship in both directions.

This MVP treats adding someone as an immediate mutual friendship. A future version could replace this with pending friend requests and accept/reject actions.

### Groups

`create_group_with_members` creates a group containing the current user and selected friends. Group creators can later rename the group, change its members, or delete it; these operations use the owner-checked `update_group_with_members` and `delete_group` functions.

The browser loads group member profiles, which lets it calculate the union of everyone's streaming services and combine everyone's genre preferences.

### Movie discovery

The browser calls the `tmdb` Edge Function instead of TMDB directly.

The Edge Function:

1. Looks up TMDB provider IDs for the user's country.
2. Maps MovieMatch services such as `Netflix`, `Disney+`, and `Prime Video` to TMDB watch providers.
3. Calls TMDB `/discover/movie` with those providers.
4. Returns several catalog sets to the browser.
5. Keeps the TMDB API token on the server.

### Streaming availability

When a user opens a movie, the app requests its TMDB details plus watch-provider data.

The modal then displays the subscription providers reported for the configured region. Watch-provider data returned by TMDB is powered by JustWatch, so the UI includes JustWatch attribution in the footer.

### Recommendations

The browser scores catalog movies using:

- genres preferred by the current group
- how many friends already selected the movie
- TMDB rating

This makes the first rows more likely to contain movies that fit multiple people in the group.

### Group matching

Every selection is stored as:

```text
(group_id, user_id, movie_id)
```

When **Find our match** is pressed, the app calculates the intersection of every member's selected movie IDs.

If there is one shared movie, it wins.

If there are multiple shared movies, MovieMatch scores them using the group's genre preferences and TMDB rating.

If there is no unanimous choice yet, it shows the movie selected by the largest number of people as the current closest match.

### Realtime

`movie_selections` is enabled for Supabase Realtime. The browser subscribes to changes for the active group and reloads the group state when another member adds or removes a selection.

## Security notes

The browser contains only the Supabase publishable/anon key. The TMDB credential is stored as an Edge Function secret.

The database has Row Level Security enabled. In particular:

- users can update only their own profile
- personal My Lists are private
- movie selections can only be read by members of that group
- a user can add/delete only their own group selections
- groups and group membership are readable only by members

The MVP allows any authenticated account to read basic MovieMatch profile fields so usernames can be discovered. For a larger production app, move username lookup behind a restricted RPC/search endpoint and expose only the minimum public profile fields.

## Production improvements

Good next additions are:

1. Friend requests with accept/reject instead of automatic friendship.
2. Group invitations and membership acceptance.
3. Pagination/infinite scrolling for TMDB catalog results.
4. A server-side recommendation endpoint if the ranking model becomes more complex.
5. Region selection per account instead of a single `WATCH_REGION` setting.
6. Provider-specific deep links where licensing/terms permit them.
7. Caching TMDB catalog/detail responses to reduce API traffic.
8. Automated database migrations rather than running one SQL file manually.
