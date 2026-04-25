# Anonim Voice/Text Telegram Bot (grammY)

A Telegram bot that accepts user text and voice messages, then asks how to post each one:

- `anonim`
- `yourself`

After user selection, the bot sends the message to your configured channel.

## Setup

1. Install dependencies:
   - `npm install`
2. Create `.env` from `.env.example`
3. Set:
   - `BOT_TOKEN` (from BotFather)
   - `TARGET_CHANNEL_ID` (channel username like `@mychannel` or numeric channel id)
4. No manual ffmpeg install is required (bundled via npm dependency).

## Run

- `npm start`

## Important Telegram Settings

- Add the bot to your channel as an admin with permission to post messages.
- Users should chat with the bot in private.
- For numeric channel id, prefer `-100...` format. The bot also auto-fixes common `100...` input.

## Behavior

- For each incoming **text** or **voice** message:
  - Bot shows two buttons: `anonim` or `yourself`
  - `anonim`: message is sent without sender identity
  - `yourself`: sender identity is included in the channel post
- Voice messages are converted to a helium-style sound before posting to the channel.
