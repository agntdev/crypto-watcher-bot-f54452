# Crypto Watcher — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Personal Telegram bot that lets users privately watch crypto tickers and receive alerts on price thresholds or rapid movements. Includes on-demand price checks, optional morning summaries, quiet hours, and owner analytics reports.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Individual crypto watchers
- Lightweight bot owners who monitor usage metrics

## Success criteria

- Users receive accurate price alerts based on their configured rules
- Owner receives daily usage reports with key metrics
- System handles price feed failures with silent retries

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **/price** (command, actor: user, command: /price) — Check current price of a specific ticker or all watchlist coins
- **Add Coin** (button, actor: user, callback: watchlist:add) — Add a new coin to your watchlist with alert rules
- **Manage Alerts** (button, actor: user, callback: watchlist:manage) — View, edit, or remove existing watchlist entries
- **Set Quiet Hours** (button, actor: user, callback: settings:quiet_hours) — Configure time window when alerts are suppressed
- **Morning Summary** (button, actor: user, callback: settings:summary) — Enable/disable and configure daily price summary

## Flows

### Add Coin
_Trigger:_ watchlist:add

1. Show quick buttons for popular coins (BTC, ETH, TON)
2. Prompt for ticker symbol if not using quick buttons
3. Select alert types (threshold or percent-move)
4. Configure threshold values and percent-change parameters
5. Confirm and add to watchlist

_Data touched:_ User profile, Watchlist entry

### Price Check
_Trigger:_ /price

1. Parse ticker parameter or default to all watchlist
2. Fetch current price from feed
3. Calculate percent change from last snapshot
4. Format and return price data

_Data touched:_ Price snapshot, Watchlist entry

### Alert Handling
_Trigger:_ price_threshold_crossed OR percent_move_detected

1. Check if alert is enabled and not in cooldown
2. Check if current time is outside quiet hours
3. Send alert message with details
4. Update last-notified timestamp and set cooldown

_Data touched:_ Watchlist entry, Price snapshot

### Morning Summary
_Trigger:_ scheduled_daily

1. Filter watchlist entries with significant price changes (>1%)
2. Format summary of all qualifying coins
3. Send to user if enabled and not in quiet hours

_Data touched:_ User profile, Price snapshot

### Owner Report
_Trigger:_ scheduled_daily

1. Aggregate total users and active users (last 30d)
2. Identify top alert types by firings
3. Format and send daily report to admin chat

_Data touched:_ User profile, Watchlist entry, Owner metrics

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User profile** _(retention: persistent)_ — User preferences and settings
  - fields: Telegram id, timezone, quiet hours window, morning summary time, cooldown duration
- **Watchlist entry** _(retention: persistent)_ — User's crypto price alerts
  - fields: user id, ticker, alert types, threshold values, percent-change parameters, last-notified timestamp, enabled flag
- **Price snapshot** _(retention: persistent)_ — Last known price data for change calculations
  - fields: ticker, last price, timestamp
- **Owner metrics** _(retention: persistent)_ — Aggregated bot usage statistics
  - fields: total users, active users (30d), top alert rules

## Integrations

- **Telegram** (required) — Bot API messaging
- **Crypto Price Feed** (required) — Fetch current crypto prices
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure admin chat id for reports
- Set default alert cooldown duration
- Adjust morning summary significance threshold
- View daily usage reports

## Notifications

- Price alerts to user's private chat
- Morning summaries to user's private chat
- Daily owner reports to admin chat
- Error notifications for persistent price feed failures

## Permissions & privacy

- All user data is private and not shared
- Watchlists are user-specific and not visible to other users
- Owner reports only show aggregated metrics, not individual user data

## Edge cases

- Price feed returns invalid data
- User requests unknown ticker symbol
- Multiple alert rules trigger simultaneously
- Quiet hours overlap with morning summary time

## Required tests

- Verify price alerts trigger correctly based on configured rules
- Test morning summary only includes significant price changes
- Validate quiet hours suppress alerts during configured window
- Confirm owner reports contain correct aggregated metrics

## Assumptions

- Crypto price feed is reliable and provides USD prices
- Users understand basic crypto ticker symbols
- Owner will monitor and maintain price feed API access
