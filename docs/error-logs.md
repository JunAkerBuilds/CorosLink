# Sharing error logs

After reproducing a problem, open **Settings → Error logs → Copy error report**
and paste the report into your GitHub issue. Include what you were doing and what
you expected to happen. **Preview report** shows the text that will be copied;
**Refresh** loads newer errors, and **Clear logs** deletes the saved history.
Copy fetches the latest report automatically.

Reports contain the app and runtime versions, operating system and architecture,
timestamps, failed operations, and error details including nested network causes.
For watchface network failures, they also include the HTTP method and regional
API endpoint. For example, `watchfaces:login` may show `fetch failed` with an
underlying `ENOTFOUND`, timeout, or certificate error.

Logs stay in the app's data folder at `diagnostics/errors.json`. Nothing is
uploaded automatically. The latest 200 errors are retained for up to seven days,
within a 512 KB limit. Logs survive app restarts. Errors from older versions
retain the app version that recorded them. If disk storage fails, the Settings
panel explains that the current report needs to be copied before closing.

Only error fields are collected: request bodies, headers, IPC arguments, and
arbitrary objects attached to errors are excluded. Common credential fields,
email addresses, URL queries/fragments, and personal file paths are redacted
before saving. Redaction is best effort; the preview lets you review the report
before sharing it.

Capture covers rejected handlers registered in `electron/main.ts`, unhandled
renderer errors/rejections, renderer crashes/load failures, and main-process
fatal errors after diagnostics initialization. Errors caught internally by a
service and returned as ordinary status data are not automatically captured.
The history begins with this feature; earlier failures cannot be recovered.

Validation: `npm run test:diagnostics` checks retention, persistence, failure
handling, and redaction. `npm run test:diagnostics-ui` checks the real Settings
panel, preload, IPC capture, copy, and clear in an isolated Electron profile.
