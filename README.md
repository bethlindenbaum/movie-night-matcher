# MovieMatch

MovieMatch is a full-stack movie discovery and group-matching website that helps friends find something everyone wants to watch. Users can browse live movie recommendations, save movies, select choices for a group, and find the strongest match based on everyone's picks and preferences.

## Live website

**[Open MovieMatch](https://bethlindenbaum.github.io/movie-night-matcher/)**

MovieMatch is published with GitHub Pages, so visitors can use the website directly at the link above. Running a localhost server is not required to visit or use the deployed site.

## What I built

- Email/password accounts and user profiles with Supabase Auth
- Friend connections based on unique MovieMatch usernames
- Movie-night groups that creators can create, rename, edit, and delete
- Group membership controls for adding and removing friends
- Personalized recommendations based on the current group's genre preferences and streaming services
- Live movie data, artwork, ratings, cast, and availability from TMDB
- A Netflix-style genre browser with a featured recommendation and scrollable movie rows
- Full genre pages with responsive card grids, infinite scrolling, browser Back/Forward support, and a jump-to-top button
- Personal watchlists through **My List**
- Group movie selections and a matching algorithm that finds unanimous or closest choices
- Realtime group-selection updates across devices
- Row Level Security and owner-checked database functions for protected account and group data

## Technology

- **Supabase Auth** for real email/password accounts
- **Supabase Postgres** for profiles, friends, groups, lists, and selections
- **Supabase Row Level Security (RLS)** to protect user/group data
- **Supabase Realtime** so group selections update across devices
- **Supabase Edge Functions** as the server-side API layer
- **TMDB** for live movie metadata, posters, descriptions, ratings, cast, genres, and watch-provider availability
- **JustWatch data through TMDB** for streaming-provider availability
- **GitHub Pages** for hosting the browser application

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

## Running your own deployment

The public website is already available at the link above. The following steps are only needed when creating a separate deployment with your own Supabase project and TMDB credentials.

### 1. Create a Supabase project

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
- helper database functions for adding friends and creating, loading, editing, and deleting groups
- RLS policies
- a Realtime publication for movie selections

### 2. Configure the browser's Supabase connection

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

### 3. Get a TMDB API Read Access Token

Create/sign into a TMDB account, register for API access, and copy your **API Read Access Token**.

Do not put the TMDB token in `config.js`. This project proxies TMDB requests through a server-side Supabase Edge Function.

### 4. Deploy the TMDB Edge Function

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

It supports four operations used by the browser:

```text
catalog
```

Returns popular, highly rated, new, and preference-based movies filtered to the group's streaming services.

```text
genres
genre
```

Returns the genre overview rows and paginated movies for an individual genre.

```text
details
```

Returns full movie details, cast, and the movie's subscription streaming providers for the configured country.

### 5. Configure Auth

MovieMatch uses email/password authentication.

For the published project, set the Supabase Auth Site URL to:

```text
https://bethlindenbaum.github.io/movie-night-matcher/
```

If you create your own GitHub Pages deployment, replace this with that deployment's full URL. Add the same address to Supabase's allowed redirect URLs when email confirmation or authentication redirects are enabled.

By default, Supabase may require new users to confirm their email. If confirmation is enabled, the UI tells the user to check their email after signup.

Each user also chooses a unique MovieMatch username. Friends are added by username rather than by email.

### 6. Publish the browser app

This repository is hosted as a static site with GitHub Pages. In the repository's GitHub settings:

1. Open **Settings → Pages**.
2. Select the branch and folder that contain `index.html`.
3. Save the Pages configuration.
4. Push future website changes to that branch to update the deployed site.

For this project, the deployed address is [bethlindenbaum.github.io/movie-night-matcher](https://bethlindenbaum.github.io/movie-night-matcher/).

## How MovieMatch works

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

### Genre browsing

The **Genres** page presents a featured recommendation followed by a horizontally scrollable row for every TMDB movie genre. Selecting **View all** opens a responsive grid for that genre.

Genre grids request additional TMDB result pages automatically as the user approaches the bottom. Internal pages are connected to browser history, so the browser's Back and Forward buttons work as expected. A floating jump-to-top button makes long result sets easier to navigate.

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
- only a group's creator can rename it, change its members, or delete it

The MVP allows any authenticated account to read basic MovieMatch profile fields so usernames can be discovered. For a larger production app, move username lookup behind a restricted RPC/search endpoint and expose only the minimum public profile fields.

## Production improvements

Good next additions are:

1. Friend requests with accept/reject instead of automatic friendship.
2. Group invitations and membership acceptance.
3. A server-side recommendation endpoint if the ranking model becomes more complex.
4. Region selection per account instead of a single `WATCH_REGION` setting.
5. Provider-specific deep links where licensing/terms permit them.
6. Caching TMDB catalog/detail responses to reduce API traffic.
7. Automated database migrations rather than running one SQL file manually.
