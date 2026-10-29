# Privacy & security

Paylocity Timesheet Filler runs entirely in your browser. It has no server, no analytics and no accounts.
This page says exactly what it touches so you can check it against the code instead of taking our word for it.

## What it can access
- **Two sites only:** `https://corp.go.paylocity.com/*` (the time card) and `https://2000access.paylocity.com/*`
  (the sign-in page, so it can click "Single Sign-On" for you). Nothing else, so it cannot read other tabs,
  your browsing history or any other site.
- **Permissions in `manifest.json`:** `storage` (keep your settings on your machine), `scripting` (run the
  time-card calls inside the time-card tab) and the two site permissions above. It does **not** ask for `tabs`,
  `history`, `cookies`, `webRequest`, `downloads` or "all sites".

## What it does with your data
- **Your session token.** The time card calls its own API with a Bearer token. `capture.js` copies that token
  (and an `x-gateway-group` header) from the page's own requests into a variable in that page's memory, so the
  extension can make the same calls you could make by hand. It is never written to storage, never logged and
  never sent anywhere except back to `corp.go.paylocity.com`.
- **What it reads from the API:** your company/employee id, your cost center list and your default cost centers.
  What it writes: the entries you submit, and the deletions you ask for. Nothing else.
- **What it stores (on your computer, in `chrome.storage.local`):** your settings, your default template,
  favorite cost centers, the cost center list, the last state of the popup and, if you use Management, the
  table of employee names and splits. None of this is sent anywhere.
- **Manager links** contain only cost center names, percentages and an optional month label, inside the part of
  the URL after `#` (which browsers never send to a server). They contain no personal data and no token.

## What it does not do
- No requests to any server other than Paylocity's own API for your own account.
- No analytics, telemetry, ads, remote code, `eval`, or third-party libraries. There is no build step and no
  minification: the files in this folder are the code that runs.

## Check it yourself (about two minutes)
From this folder:

```bash
# every network-capable call in the extension (expect exactly one fetch, in background.js, same-origin)
grep -n "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket\|importScripts\|eval(\|new Function" *.js

# every URL in the code (expect only corp.go.paylocity.com / 2000access.paylocity.com)
grep -n "https\?://" *.js *.json

# everything it saves
grep -n "storage\.\(local\|session\)\.set" *.js
```

The only code that touches the token is `capture.js` and `apiInPage` in `background.js`.

## Updating
Install from a tagged release of this repository and read the diff before moving to a newer tag.
