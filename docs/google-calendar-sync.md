# Google Calendar sync

Open **Calendar → Calendar sync** or **Settings → Google Calendar**. Connect your COROS account in Training Hub first.

1. Complete **Google app setup** if this installation has no configured Google OAuth client.
2. Click **Connect Google Calendar** and sign in using your normal browser. Allow calendar access.
3. Choose a calendar you can edit and click **Start syncing**.

Scheduled workouts appear as all-day events for the past 7 days and next 90 days. Automatic sync runs every 5 minutes while CorosLink is running; **Sync now** refreshes immediately. Workouts are marked as free time because COROS provides a scheduled date without a start time.

This sync goes from CorosLink to Google Calendar. Add, move, edit, and remove workouts in CorosLink. Changes in Google Calendar do not update COROS and may be replaced on the next sync. Completed activities and personal Google events are not imported. Only events tagged as this COROS account's CorosLink workouts are changed or removed. Older history is preserved. Switching destination calendars or disconnecting leaves existing events in the previous calendar.

## OAuth setup

Use a dedicated Google OAuth client for Calendar so disconnecting its grant does not affect another integration.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen. For an app in testing, add the Google accounts that will connect as test users.
4. Create an OAuth client with application type **Desktop app**. Paste its client ID and client secret (if Google provides one) into **Google app setup** in CorosLink.
5. Save and connect. Desktop OAuth uses a random port on `127.0.0.1`, state validation, and PKCE. The app opens the system browser; no fixed redirect port needs to be configured for a Desktop client.

See Google's [desktop OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app) and [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth).

For managed development installations, the main process also accepts `COROSLINK_GOOGLE_CALENDAR_CLIENT_ID` and `COROSLINK_GOOGLE_CALENDAR_CLIENT_SECRET` environment variables. Saved app setup takes precedence. No OAuth credentials are committed to this repository or automatically provisioned by this feature. Public distribution with a shared OAuth client requires the publisher to configure Google's consent screen and complete any required verification.

The requested scopes identify the Google email address, list available calendars, and manage calendar events. Credentials and refresh tokens remain in the Electron main process and are encrypted using Electron `safeStorage`. Connections require working secure storage; Linux's `basic_text` fallback is rejected. Access tokens refresh automatically. Revoked access requires reconnecting; accounts in Google's testing mode may require reconnecting periodically.

## Troubleshooting

- **No calendars available:** connect an account with owner or writer access to a calendar, then use **Choose a calendar** again.
- **Access denied:** enable the Calendar API, grant the requested scopes, check the OAuth test-user list, and confirm that your Google Workspace administrator permits the app.
- **COROS account changed:** sign back in to the linked account, or reconnect Google Calendar to explicitly link the new account.
- **Secure storage unavailable:** unlock your keychain or enable a supported Linux secret store and restart CorosLink.
- **Disconnected while offline:** local tokens are removed immediately. If revocation could not reach Google, remove the app from [Google Account connections](https://myaccount.google.com/connections).
- **Partial sync:** retry with **Sync now**. Stable event IDs prevent duplicate inserts after interrupted responses; removals run only after source reads and updates succeed.

## Verification

`npm run test:google-calendar` covers OAuth callbacks, PKCE, cancellation, token refresh, scope denial, account isolation, pagination, workout edits and moves, deletion boundaries, interrupted syncs, and repeat-run idempotency using isolated fake accounts and API responses. Live Google sign-in requires configured OAuth credentials and an account's consent.
