# Apple Calendar workout sync

Select **Apple Calendar** in Settings’ connected calendar panel. Once connected, use **Calendar → Sync now** to sync immediately.

1. Connect your COROS account in Training Hub.
2. Enable **iCloud Calendar** for the Apple Account you use on your Apple devices.
3. At [account.apple.com](https://account.apple.com), open **Sign-In and Security → App-Specific Passwords** and generate a password for CorosLink. Your Apple Account needs two-factor authentication. See [Apple’s instructions](https://support.apple.com/102654).
4. Enter your Apple Account email and that app-specific password in CorosLink, then click **Connect Apple Calendar**.
5. Choose an editable iCloud calendar and click **Start syncing**.

No Apple developer account or OAuth app setup is needed. The connection uses iCloud CalDAV and works from CorosLink on macOS, Windows, and Linux. Calendars stored only **On My Mac** are not available through iCloud; choose an iCloud calendar to see your workouts on your other devices. Apple Calendar can also display Google calendars, which can use the separate Google connection.

## What syncs

- Scheduled COROS workouts become all-day events by default, or timed blocks when enabled, for the past 7 days and next 90 days. Events are marked as free time.
- Automatic sync checks every 5 minutes while CorosLink is running. **Sync now** refreshes immediately.
- The Calendar button shows **Synced** when all connected calendars have completed sync without pending CorosLink schedule changes, and **Syncing…** during sync. Schedule changes switch it back to **Sync now**.
- Make workout additions, edits, moves, and removals in CorosLink. This is a one-way sync to iCloud; changes made in Apple Calendar do not update COROS. Timed-event moves and resizes are preserved as described below; workout titles and descriptions remain managed by CorosLink.
- Personal events, manually copied events, workouts from other COROS accounts, and history outside the sync window are preserved. Completed activities are not exported.
- Changing the destination calendar or disconnecting leaves previously synced events in the old calendar.
- Sync pauses when a different COROS account signs in. Sign back in to the linked account, or disconnect and reconnect Apple Calendar to link the new account.

Google and Apple connections are independent. Each has its own destination, automatic-sync preference, last-sync time, and disconnect control. Selecting the same underlying calendar through more than one provider can create separate copies; choose one connection for each destination.

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

## Credentials and failure handling

The app-specific password is sent only to Apple’s HTTPS CalDAV servers. Discovery redirects are restricted to `caldav.icloud.com` and iCloud’s numbered CalDAV hosts. Event operations are restricted to the selected calendar.

Credentials stay in the Electron main process and are encrypted with the operating system’s secure storage before saving locally. They are never returned in connection status. Secure storage is required; Linux’s plaintext fallback is not accepted. The password field clears when connecting.

Disconnecting removes the local credentials and stops pending sync operations. To revoke the app-specific password at Apple too, remove it from your Apple Account’s **App-Specific Passwords** page. A revoked password or changed Apple Account password requires generating a new app-specific password and reconnecting.

Stable event UIDs and conditional creation prevent duplicate workouts after interrupted requests. Updates and deletions use the event’s current ETag. If an event changes during sync, CorosLink reloads it, validates its sync metadata, and retries up to twice with the latest version. Events that already match need no further update, and removals recheck the sync window. Persistent conflicts stop the sync. Removals run only after all source reads and event updates succeed. A failed sync can be retried with **Sync now**.

iCloud rejects CalDAV UID property filters with HTTP 412, so CorosLink reads the calendar’s events and checks workout ownership locally. The calendar collection’s metadata row is skipped; incomplete event rows still stop sync before any writes. A rejected read is reported separately from a conflicting event update.

## Troubleshooting

- **No editable calendars:** create an iCloud calendar, enable iCloud Calendar for the account, or check shared-calendar permissions. Read-only subscriptions and reminder lists are excluded.
- **Sign-in rejected:** confirm the Apple Account email, then generate a fresh app-specific password. Use the generated four-part password, not your primary Apple Account password.
- **Event changed during sync:** CorosLink retries automatically. If the warning persists, let other calendar edits finish, then click **Sync now**.
- **Repeating workout warning:** remove the recurrence from that synced event before retrying. CorosLink exports each scheduled workout as its own event.
- **Keychain error:** unlock your keychain or enable a supported Linux secret store, then restart CorosLink.

## Verification

Run `npm run test:calendar-event-timing` for both providers’ timing behavior, explicit start/end times, legacy settings migration, DST handling, calendar moves/resizes, settings persistence, and the desktop settings UI.

Run `npm run test:apple-calendar`. The isolated tests cover CalDAV discovery, permissions, credential routing, iCalendar escaping and UTF-8 folding, idempotency, moves, deletion boundaries, ETag conflicts, retries, account changes, revoked passwords, cancellation, and partial failures. Run `npm run test:google-calendar` to check the shared code against Google sync too.

The protocol follows [CalDAV (RFC 4791)](https://datatracker.ietf.org/doc/html/rfc4791) and [iCalendar (RFC 5545)](https://datatracker.ietf.org/doc/html/rfc5545). Live iCloud sign-in requires an account and app-specific password; automated tests use fake responses and do not read or modify a real calendar.
