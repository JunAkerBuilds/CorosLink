# Music integrations setup

Setup steps for the optional music sources in **Media**. Everything here is stored locally; see the README's privacy section.

## Spotify Developer setup

Create a free Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), then add this redirect URI exactly:

```text
https://127.0.0.1:4567/callback
```

Paste the app's Client ID and Client Secret into the Spotify Sync view. The app opens a local OAuth login window and stores the resulting token locally in SQLite.

Playlist sync reads the authenticated user's playlists and only enables playlists that Spotify allows the user to read — currently playlists the user owns or collaborates on. Each track is searched on YouTube as `<artist> <track> official audio`, downloaded as an MP3, and saved as `Artist - Track Name.mp3`.

## YouTube Playlists setup

Create an OAuth 2.0 Client ID in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Desktop app or Web application), enable the **YouTube Data API v3**, then add this redirect URI exactly:

```text
http://127.0.0.1:4568
```

Paste the Client ID and Client Secret into the YouTube Playlists view, then connect. The app opens a local OAuth login window and stores tokens locally in SQLite.

## YouTube Music setup

Install Python 3.10+ and ytmusicapi:

```sh
python3 -m pip install ytmusicapi
```

Open [music.youtube.com](https://music.youtube.com/library) while signed in, open DevTools (F12), go to the **Network** tab, filter for `browse`, right-click a **POST** request, and choose **Copy → Copy as cURL**. Paste the command into CorosLink and connect. Headers must include `cookie` and `x-goog-authuser`. They expire when you sign out of YouTube Music in your browser — re-paste if syncing stops.

## Apple Music setup

Open [music.apple.com](https://music.apple.com) while signed in, open DevTools (F12), go to the **Network** tab, filter for `amp-api`, right-click any request, and choose **Copy → Copy as cURL**. Paste into CorosLink and connect. The `authorization` bearer token is required; include `media-user-token` for personal library playlists. Tokens expire often — re-paste if fetching stops working.

Apple Music streams are DRM-protected. CorosLink reads playlist metadata from Apple and resolves each track via YouTube search for download (same approach as Spotify sync).

