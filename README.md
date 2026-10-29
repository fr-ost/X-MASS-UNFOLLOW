# X (Twitter) Mass Unfollow Tool – Free & Unlimited

Free & unlimited X (Twitter) mass unfollow tool. Bulk unfollow, clean your
following list, and remove non-followers with ease.

A product of **Unique Labs**. Developed by
**[Shahriar Ahmed](https://www.shahriarahmed.net)**.

**[Get it on the Chrome Web Store](https://chromewebstore.google.com/detail/x-twitter-mass-unfollow-t/igpjmagghnibmjkkdcgpjgpkfkpiglnl)**

## Features

- **One-click scan.** Reads your whole following list and marks who follows you back. Read-only.
- **Unfollow non-followers** in one click, or **unfollow everyone**.
- **Review and pick.** Full dashboard with search, filters (no photo, few posts, few followers, follow-spam, verified, private), sorting, multi-select and CSV export.
- **Whitelist.** Accounts on it are never unfollowed, in any mode. One tap on the shield in the review table.
- **Keep rules.** Keep verified accounts, private accounts, big accounts, or anyone whose name/bio matches a keyword.
- **Import a list.** Unfollow exactly the accounts in a CSV or a pasted list.
- **Not blue & Inactive tabs.** Right on the Following page after a scan, two extra ways to pick who goes: **Non-blue verified** (no Premium blue check) and **Inactive** (30d+, 90d+, 180d+, 1y+; sort most or least inactive first; shows "Last active: N days ago"). Accounts whose activity can't be read are never guessed - they're listed separately. Selection and unfollowing use the same system as everywhere else.
- **Safe pacing.** Safe / Balanced / Fast presets or custom numbers: random gaps, regular breaks, and a rolling 24-hour limit that continues automatically.
- **Backs off by itself.** If X says to slow down, the run rests and continues. If X asks you to verify your account, it stops and waits for you.
- **Works in the background.** Switch tabs, close the popup, minimise the window: the run keeps going.
- **Who unfollowed me.** After each scan the extension reads your followers and compares them with the previous read: the **Followers** page lists everyone who unfollowed you (with the dates between the two checks), your new followers, and the people you don't follow back. A partial read from X is never compared, so nobody is listed by mistake. Accounts with more than 20,000 followers are checked when you press Check now.
- **Follow back & undo.** Follow back new followers or anyone you don't follow back, and re-follow people you unfollowed by mistake from History. Follows use the same safe pacing and count towards the daily limit.
- **History.** Everyone it unfollowed or followed, with CSV export.
- **Grace period.** A Keep rule for accounts you followed in the last N days, so new follows have time to follow you back.
- **More filters & saved groups.** Followers range, follow ratio, account age, bio keywords (contains / doesn't contain) and writing system. Save any selection as a named group and pick it again from the Group menu.
- **Growth chart.** Following and followers over time (30 days, 90 days, all), from your scans.
- **Desktop notifications** (optional): when a run reaches the daily limit, finishes or needs you, and when people unfollow you. Chrome asks for permission the first time you switch them on.
- **Multiple X accounts.** Each X account keeps its own scan, whitelist, history, groups and daily count; sign in to X as another account and its data loads automatically (never in the middle of a run).
- **7 languages.** English, Español, Português (Brasil), हिन्दी, Bahasa Indonesia, Türkçe and العربية (right-to-left). Follows the browser language or the choice in Settings.
- **Light & dark mode.** Follows your system, or flip it with the sun/moon button.
- **GrowX.** A link to GrowX (organic X growth) in the sidebar, overview and popup - the natural next step after a clean-up.
- **Private.** Your following list, whitelist and history stay in your browser. Only anonymous usage stats (install/active/uninstall + country, no IP, no X account) are sent, and you can turn them off in Settings. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
- **Free forever.** No paid tier. A Donate page (crypto, with QR codes) and a Report-a-bug link are built in.
- **Emergency stop:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>.

## How it works

```
popup / dashboard  ──commands──▶  background.js (the engine)
                                     │  state, pacing, rests, retries,
                                     │  all in chrome.storage
                                     ▼
                         content/*.js in any x.com tab
                         (one request at a time, on request)
                                     │
                                     ▼
                     x.com - the same endpoints X's website uses
```

- **The engine lives in the service worker**, not in the page. A page script dies when its tab is hidden, frozen, reloaded or navigated, which is what made earlier versions stop after 20-30 accounts. The worker drives the run step by step and keeps all state in storage, so a killed worker or a reloaded tab picks up exactly where it left off.
- **Reading the list** uses X's own GraphQL `Following` timeline, page by page, with X's per-account "follows you" flag. The query id, feature flags, GET-vs-POST and the `x-client-transaction-id` header are all worked out at runtime from X's own app (`content/txid.js`, `content/xapi.js`). If X rejects that, the engine falls back to scrolling the Following page.
- **Unfollowing** sends the same `friendships/destroy` request X's Unfollow button sends. If X rejects direct requests, the engine switches to **profile mode**: it opens each profile in a background tab and presses Unfollow there.

## Project layout

| Path | What it is |
| --- | --- |
| `manifest.json` | Manifest V3 |
| `background.js` | The engine: scan, unfollow queue, pacing, tabs, badge, migration from v6 |
| `shared/config.js` | Storage keys, speed presets, settings normalisation, Keep rules |
| `content/txid.js` | `x-client-transaction-id` generator (port of the MIT-licensed x-client-transaction-id project) |
| `content/xapi.js` | X API client: query discovery, self-healing GraphQL reads, last-post lookup, unfollow |
| `content/dom.js` | Fallbacks: profile-page unfollow, Following-page scroll scan |
| `content/content.js` | Message router in x.com tabs |
| `popup.*` | Toolbar popup |
| `dashboard.*` | Full dashboard (also the Settings page) |
| `shared/telemetry.js` | Anonymous usage signal (install/active/uninstall + country); off switch in Settings |
| `shared/i18n.js` | Translations: language choice, plurals, right-to-left, translating the static HTML |
| `shared/i18n/*.js` | One dictionary per language (the English text is the key) |
| `_locales/` | Store name and description per language |
| `tools/i18n-extract.mjs` | Lists every interface string (writes `tools/i18n-strings.json`; not shipped) |
| `ui/` | Shared design system (light/dark tokens), theme loader, helpers, logo |
| `ui/donate/` | Token logos and donation QR codes |
| `design/` | Icon source + renderer, QR builder, store-graphics builder (not shipped) |
| `store/` | Chrome Web Store screenshots and promo tiles (not shipped) |
| `STORE_LISTING.md` | Store title, summary, SEO description, privacy-tab answers |
| `tests/e2e/` | End-to-end tests against a mock x.com (see its README) |
| `tracker/` | Optional Cloudflare Worker for anonymous usage stats + a private dashboard (not shipped in the extension; see its README) |

## Building the store package

Zip the extension files without `tests/`, the docs, or git data:

```sh
zip -r x-mass-unfollow-7.3.2.zip manifest.json background.js \
  popup.html popup.css popup.js dashboard.html dashboard.css dashboard.js \
  options.html options.js privacy.html icon16.png icon32.png icon48.png icon128.png \
  _locales content shared ui -x "*.DS_Store"
```

## Translations

Every interface string is English in the code and goes through `t()` / `tn()`
(pages) or `T()` / `TN()` (worker); static HTML is translated on load. To add
or change a string:

```sh
export PLAYWRIGHT=/path/to/node_modules/playwright
node tests/i18n_check.mjs     # re-lists the strings, then checks every language
```

It fails on any string a language is missing, a lost `{placeholder}`, changed
markup or a bad plural form. Add the translation to each `shared/i18n/<lang>.js`
(plurals are objects keyed by `Intl.PluralRules` category: `one`, `few`,
`many`, `other`...).

## Rebuilding the graphics

```sh
export PLAYWRIGHT=/path/to/node_modules/playwright
node design/build-icons.mjs        # icon16/32/48/128.png + ui/logo.svg
python3 design/build-qr.py         # donation QR codes (verified by decoding)
node design/store-assets.mjs       # store/ screenshots and promo tiles
```

## Support

Report a bug or ask a question on Telegram: [@igfrostt](https://t.me/igfrostt)
