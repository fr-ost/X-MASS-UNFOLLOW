# Privacy Policy - X (Twitter) Mass Unfollow Tool – Free & Unlimited

_Last updated: 29 October 2026 (version 7.3.2)_

This policy explains, in plain language, what the X Mass Unfollow browser
extension does with information.

## What the extension does

The extension helps you find accounts on X (formerly Twitter) that don't
follow you back and unfollow them, see who unfollowed you, and follow accounts
back. It works inside your own browser, using the X session you are already
signed into. It never asks for your password, never signs in on your behalf,
and never sends your X account data to the developer or to any other third
party.

To read your following and followers lists and to unfollow or follow accounts,
the extension sends requests **only to X itself** (x.com, and abs.twimg.com for
X's own app files) - the same requests X's website makes when you use it.

## Information stored on your device

The following is stored in your browser's local extension storage only. It is
never transmitted to the developer:

- **Your settings** - speed, daily limit, Keep rules, language, notifications on/off.
- **Your whitelist** - handles you never want unfollowed.
- **Your last scan** - the accounts you follow and whether they follow you back.
- **Your followers** - the list from your last followers check, and the changes found between checks (who unfollowed you, new followers, with dates), so the next check can be compared.
- **First-seen dates** - when each account you follow first appeared in a scan, for the "followed in the last N days" Keep rule.
- **Scan totals over time** - following and followers counts per scan, for the growth chart.
- **Saved groups** - selections you named.
- **Last-active results** - when each account you follow last posted (read from X in your own session), so it isn't read twice.
- **Your history** - accounts the extension unfollowed or followed, and when.
- **A daily counter** - timestamps of recent follows and unfollows, to enforce your daily limit.
- **Your review-prompt answer** - whether you reviewed the extension or dismissed the prompt, so it isn't shown again.

If you use more than one X account, each account's scan, whitelist, history,
groups and counters are kept separately, so they never mix.

You can delete all of it at any time from **Dashboard -> Settings -> Delete
all extension data**, or by removing the extension.

## Anonymous usage statistics

To understand how many people use the extension and to catch bugs, the
extension sends a small, **anonymous** signal to the developer's own server:

- a **random install ID** - generated on your device, not derived from you or
  your computer, and reset whenever you clear extension data;
- the **extension version**;
- an **install** event, a once-a-day **active** ping, and an **uninstall** event;
- with the daily ping, an **aggregate count** of how many follow and unfollow
  actions happened in the last 24 hours (just a number);
- **coarse country**, derived on the server from the network request. The IP
  address itself is **not stored**.

This signal **never** includes your IP address, your X/Twitter username or
account, your following list, your whitelist, or your history. It cannot be
used to identify you, and it is never sold or shared for advertising.

You can turn it off at any time in **Dashboard -> Settings -> Privacy ->
Anonymous usage stats**. When it is off, nothing is sent and the uninstall
signal is removed.

## Permissions and why they are needed

- **x.com, twitter.com** - to read your following and followers lists and to unfollow or follow accounts in your own signed-in session.
- **abs.twimg.com** - to read X's own app files, which describe how X's website talks to X.
- **storage, unlimitedStorage** - to keep your settings, scan and history on your device (large following lists need more than the default space).
- **alarms** - to schedule the next unfollow, breaks and daily-limit pauses.
- **scripting** - to start working in an x.com tab that was already open, without making you reload it.
- **notifications** (optional) - asked for only if you turn on desktop notifications in Settings. Notifications are shown on your computer by the extension; nothing is sent anywhere.

## Children

The extension is not directed at children under 13 and does not knowingly
collect information from anyone.

## Changes

If what the extension stores or shares ever changes, this page and the Chrome
Web Store listing will be updated to match. The date at the top shows the
current version.

## Contact

Telegram: [@igfrostt](https://t.me/igfrostt)
