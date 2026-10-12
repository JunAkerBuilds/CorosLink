# Music integrations setup

Setup steps for the optional music sources in **Media**. Everything here is stored locally; see the README's privacy section.

## Spotify Developer setup

Create a free Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), then add this redirect URI exactly:

```text
https://127.0.0.1:4567/callback
```

Paste the app's Client ID into the Spotify Sync view; no Client Secret is needed. The app signs in with the Authorization Code + PKCE flow in a local login window and stores the resulting token locally in SQLite.

Apps set up before PKCE keep the same redirect URI; after upgrading, sign in to Spotify once more (the Client Secret is no longer used).

Playlist sync reads the authenticated user's playlists. A personal Spotify app in Development Mode can only read playlists the user owns or collaborates on, so playlists the user only follows show as locked.

**Unlock followed playlists** (optional) signs in once more as Spotify's own desktop client, the identity librespot, Spotifast, ncspot and spotify-player use (redirect `http://127.0.0.1:8898/login`, nothing to register). CorosLink uses that token only to read the songs of playlists the personal app is refused, through Spotify's internal client endpoints (`spclient`) as librespot does; the public Web API rate-limits that identity, so it is never called there. Spotify does not officially support third-party apps using this identity and may block it at any time; if it stops working, copy the playlist into your own account instead. Each track is searched on YouTube as `<artist> <track> official audio`, downloaded as an MP3, and saved as `Artist - Track Name.mp3`.

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

## Optional Wi-Fi sending to the watch

Connect and authenticate the watch over Bluetooth, then open **Media → Library**. Select downloaded tracks and click **Send selected over Wi-Fi**, or use **Send all over Wi-Fi** for the library (up to 20 tracks per batch). No file picker or additional download is needed. **Choose other MP3s** opens a picker for files outside the library. USB stays the default watch-library view. The Wi-Fi options appear only while Bluetooth is connected and currently support macOS system Bluetooth with the tested PACE Pro W332 firmware 3.2008.0.

Keep the Mac and watch on the same Wi-Fi network and choose up to 20 local MP3 files (512 MB per file, 1 GB per batch). CorosLink serves private temporary copies of those files; source files stay unchanged. The watch downloads them through its podcast downloader, so they appear in **Podcasts**. The Bluetooth music list and delete controls operate on the watch’s separate local music library. Wi-Fi sending does not change the library’s USB “Synced” status. Library deletion and other transfer controls wait until the Wi-Fi transfer and settings restoration finish.

A current encrypted download-settings backup for the same watch is required before the first transfer. This preserves the watch’s COROS service settings while its download hosts are temporarily redirected. CorosLink stores the imported backup using macOS secure storage, restores the exact packet after success, cancellation or failure, and keeps a recovery journal until the watch acknowledges restoration. If interrupted, reconnect the same watch; restoration runs before another transfer. Progress, cancellation and a manual restore action are available in the optional view.

The connected test watch has a freshly captured backup. For another watch, **Import settings backup** accepts a CorosLink encrypted `.enc` capture created within the last 24 hours on the same Mac and application storage key. Complete settings readback and an automatic capture workflow are not yet available. Refresh the backup after changing the COROS account, region or watch download settings. Physical downloading and appearance in Podcasts have been verified; audio playback is still awaiting confirmation.

