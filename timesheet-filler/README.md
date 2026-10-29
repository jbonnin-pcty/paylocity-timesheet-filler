# Paylocity Timesheet Filler

Chrome (MV3) extension that fills several days of the Paylocity time card at once, split across cost
centers. You work with names; the extension handles the ids and sends the same request the time card does.

## Install
`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder
(`chrome-extension/timesheet-filler`, the one containing `manifest.json`).

## Privacy
It only has access to `corp.go.paylocity.com` and the sign-in page, stores everything locally, and makes no
network calls except the time card's own API for your own account. See [PRIVACY.md](PRIVACY.md) for exactly what it
touches and how to verify that in two minutes. It doesn't need the "read your browsing history" permission.

## Use
- Click a day to mark it as a work day. Turn on *Select a range*, click the first and last day, and every weekday in between is added (the toggle then switches itself off). Ranges work with right-click too: the button you finish the range with decides the kind (left = work, right = vacation). A range replaces what is on those days, so the usual flow works: fill the month with work first, then right-click-range your vacation over it (with Half day ticked only half of each day is replaced).
- Half-day marks show as a diagonal split: work on the top-left, vacation on the bottom-right, so one day can hold half of each (turn on *Half day* before clicking).
- Right-click a day to mark it as vacation/holiday (cost center "Admin - VacHol" by default, change it in ⚙;
  8h, or 4h when *Half day* is on).
- Choose how many cost centers you worked on and type or pick each one (the list is loaded from your
  time card the first time you open the popup; reload it in settings). Star a cost center to pin it to the top of the list. With exactly 2 a slider appears (step editable, default 5%); with 3+ you type percentages.
  The split applies to the total hours of all selected days: days are filled in date order, so one day can be
  split between two cost centers.
- **Submit** works in the tab you're on and only navigates to the time card if you aren't already there
  (clicking *Single Sign-On* if needed and waiting while you sign in). It first deletes whatever the time card
  already holds on the marked days and on the weekends/bank holidays between them (so nothing doubles up), then sends the new entries and refreshes the page.

## How it works
The page's own scripts talk to `/api-gw/...` with a Bearer token. `capture.js` copies that token (and the
`x-gateway-group` header) from the page's own requests, and the extension calls the same API from inside the
page, so nothing leaves your browser except requests to Paylocity.

- **Loading cost centers** (first time you open the popup, or *Reload cost centers* in settings):
  `security/v1/userinfo` (your company and employee ids) → `employeeSearches` (your policy) →
  `policies/{id}/costCenters` (which levels the time card shows) → `costCenterAssignments` (the options at
  those levels, and your defaults for the other levels). Names are shown as `code - name`, like the time card.
- **Submitting:** first `POST .../timeEntryRemovalRequests` for the days' existing entries, then one entry per day, `PATCH companyAssociations/{co}/timeEntryDurations`, with
  `costCenterIds` = your defaults for the other levels plus the chosen cost center, in level order (exactly what
  the time card sends). Names are resolved first, so a typo stops the run with nothing saved.
- If the tab was open before the extension was installed or updated, it is reloaded once so the capture script
  can run. A stale token (401) triggers one reload and retry before anything is saved.

## Limits
- Built for duration-based time cards ("Add time" asks for date, # of hours and cost center).
- Only the cost center levels shown by your company's policy are chosen; other levels use your defaults. With
  several shown levels you pick one option, and the other shown levels also use your defaults.
- This uses the time card's internal API, which Paylocity can change without notice.
- Submitting replaces *everything* on the marked days and on the weekends/bank holidays between them, including
  entries that didn't come from this tool.

## Settings
Week start (Monday or Sunday), the vacation cost center, an optional note, reloading the cost center list,
and a default template (cost centers, split, half day) that is applied on **Clear selection** and when you
next open the popup after saving.

## Sharing a split (managers)
Settings → **Management** (collapsed by default) holds a table of direct reports: Slack name, number of
cost centers, and a cost center + % per column. **Copy for Slack** produces one line per person, sorted
by first name: `@Name - <link text>` where the link text is the split, e.g. `CommunityRTB 65%, Citrus 35%`. The link is the time card URL plus `#tsf=…` (the split, base64-encoded;
the part after `#` is never sent to the server).

When someone opens their link, a banner on the time card shows the split and offers **Apply**, which also
clears the popup's selection and marks every workday of the current month as work (holidays are blacked out, so
they are skipped; vacation is added by hand afterwards) (it warns when a cost center isn't in their list). The split is kept while they sign in, so
the banner still appears after the SSO redirect. People can also paste a link under Settings → Default
template → **Load**.

Slack channel (optional): paste a channel link (right-click the channel in Slack → Copy link) and
**Copy & open channel** copies the message and opens that channel for you to paste. Sending straight from
the extension isn't done on purpose: it would need a Slack app (incoming webhook or token) approved by a
workspace admin, and plain `@Name` text posted that way doesn't notify anyone.

After **Apply** in the banner the popup opens with the template applied and the calendar on the
current month (this uses `chrome.action.openPopup`; if the browser refuses, the banner asks you to
click the toolbar icon).

## Hours check
Submit is blocked when a month's work + vacation hours exceed its workdays (Monday–Friday, minus bank
holidays) × 8h (selecting weekend days is what usually pushes a month over). Settings → Safety check turns it off.

## Bank holidays
Czech bank holidays are computed (including Easter) and shown blacked out: they can't be clicked, are skipped
by range selection, and don't count as workdays for the hours check. Runs of holidays are one legend line
under the calendar (e.g. `24-26th: Christmas`). Settings → Calendar → Bank holidays: None turns this off.

## Deleting entries
**Delete existing entries on N selected days** (under Submit) removes everything the time card holds on the
marked days (work and vacation entries; a duration day is a clock-in/clock-out pair). It takes two clicks:
the first arms the button for five seconds, the second sends one `POST .../timeEntryRemovalRequests` per
batch of days (whole days per request), then refreshes the page. Holiday pay lines are not time entries and are
left alone. This deletes *all* time entries on those days, including ones that didn't come from this tool.
**Delete month** (next to it, also two clicks) deletes every entry in the month shown in the calendar,
weekends and holidays included.
To leave a clean slate, the Delete button also clears every weekend day and bank holiday between the first and
last marked day, even though range selection skips them. Submit does the same before saving.
