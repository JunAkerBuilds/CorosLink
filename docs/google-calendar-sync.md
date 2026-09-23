# Google Calendar sync

Open **Settings → Google Calendar**. Connect your COROS account in Training Hub first. Once connected, use **Calendar → Sync now** to sync immediately.

The Calendar button shows **Synced** when all connected calendars have completed sync without pending CorosLink schedule changes. It shows **Syncing…** during sync and returns to **Sync now** after schedule changes or a sync failure.

1. Complete **Google app setup** if this installation has no configured Google OAuth client.
2. Click **Connect Google Calendar** and sign in using your normal browser. Allow calendar access.
3. Choose a calendar you can edit and click **Start syncing**.

Scheduled workouts appear as all-day events by default, or timed blocks when enabled, for the past 7 days and next 90 days. Automatic sync runs every 5 minutes while CorosLink is running; **Sync now** refreshes immediately. Workouts remain marked as free time.

This sync goes from CorosLink to Google Calendar. Add, move, edit, and remove workouts in CorosLink. Changes in Google Calendar do not update COROS. Timed-event moves and resizes are preserved as described below; workout titles and descriptions remain managed by CorosLink. Completed activities and personal Google events are not imported. Only events tagged as this COROS account's CorosLink workouts are changed or removed. Older history is preserved. Switching destination calendars or disconnecting leaves existing events in the previous calendar.

## Edit an event from CorosLink’s calendar

Click a scheduled workout in **Calendar**. In the detail panel, use **Calendar event** to choose **All-day event** or **Timed event**, then set the start time, end time, and time zone. Click **Save event** to save that occurrence and immediately update every connected Google and Apple calendar. No separate Sync now click is needed, even when background automatic sync is off.

The saved time appears on the workout’s calendar card. Moving a workout to another day keeps its chosen time and updates the linked event. Workout detail edits and removals from the calendar also trigger sync. Per-workout choices take priority over provider defaults and are saved separately for each COROS account on this computer. If one provider fails, the local edit remains saved and the error identifies which provider needs a retry.

Saving an event in CorosLink reapplies its chosen times, including after a move in Apple or Google Calendar. Ordinary sync continues to preserve external calendar moves and resizes until the next explicit save or schedule date change.

## Default event settings

Open **Settings → Account settings → Calendar**, choose Apple or Google Calendar, and find **Workout events** after selecting a destination calendar.

- Keep **All-day events** (the default), or select **Timed events**.
- Choose a default start time, end time, and time zone. Defaults are 18:00–19:00 in your computer’s time zone. An end time at or before the start time means the following day.
- Click **Save event preferences and sync**. Workouts without individual event settings are updated in place, without creating duplicates. Apple and Google keep separate preferences.

Timed events use the start and end times you choose. CorosLink does not estimate their duration from workout data.

Move or resize a timed event in Apple or Google Calendar to fit your work shifts. Sync preserves those times, even when you move it to another day. Workout edits and duration changes leave your chosen calendar times unchanged. These calendar edits do not reschedule the workout in COROS.

Changing the event type, start time, end time, or time zone reapplies the defaults to workouts without individual event settings within the sync window. Changing a workout’s scheduled date in CorosLink also reapplies its time. Deleting a workout in CorosLink still removes its linked event, even if that event was moved in the calendar. Existing events remain marked as free time; this feature does not change availability or reminders.

The selected time zone is saved, so travel or changing the computer’s zone does not silently move workouts. Daylight-saving offsets are calculated for each workout date. A start in a missing spring-forward hour moves forward by the gap; a repeated fall-back time uses its first occurrence. Start and end times each use the selected time zone and can cross midnight. If a missing hour would place the end before the start, choose times outside the clock change.

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

Run `npm run test:calendar-event-timing` for both providers’ timing behavior, explicit start/end times, legacy settings migration, DST handling, calendar moves/resizes, settings persistence, and the desktop settings UI.

`npm run test:google-calendar` covers OAuth callbacks, PKCE, cancellation, token refresh, scope denial, account isolation, pagination, workout edits and moves, deletion boundaries, interrupted syncs, and repeat-run idempotency using isolated fake accounts and API responses. Live Google sign-in requires configured OAuth credentials and an account's consent.
