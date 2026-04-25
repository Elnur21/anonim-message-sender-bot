require("dotenv").config();
const { Bot, InlineKeyboard, InputFile } = require("grammy");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const execFileAsync = promisify(execFile);

const BOT_TOKEN = process.env.BOT_TOKEN;
const TARGET_CHANNEL_ID_RAW = process.env.TARGET_CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map((id) => parseInt(id, 10))
  : [];

if (!BOT_TOKEN || !TARGET_CHANNEL_ID_RAW) {
  throw new Error(
    "Missing BOT_TOKEN or TARGET_CHANNEL_ID in environment variables.",
  );
}

function normalizeTargetChannelId(raw) {
  const value = String(raw).trim();

  // Typical copied channel id format is "100...", but Telegram API needs "-100...".
  if (/^\d+$/.test(value) && value.startsWith("100")) {
    return `-${value}`;
  }

  return value;
}

const TARGET_CHANNEL_ID = normalizeTargetChannelId(TARGET_CHANNEL_ID_RAW);

const bot = new Bot(BOT_TOKEN);
const pendingMessages = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

async function downloadTelegramFile(fileUrl, outputPath) {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download voice from Telegram: HTTP ${response.status}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
}

async function convertVoiceToHelium(inputPath, outputPath) {
  const filter =
    "asetrate=48000*1.85,aresample=48000,atempo=0.54,highpass=f=260,lowpass=f=4200,acompressor=threshold=-18dB:ratio=4:attack=5:release=80";
  const ffmpegPath = ffmpegInstaller.path || "ffmpeg";

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-af",
      filter,
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      outputPath,
    ]);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        "ffmpeg binary not found. Reinstall dependencies with npm install.",
      );
    }
    throw error;
  }
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, entry] of pendingMessages.entries()) {
    if (now - entry.createdAt > PENDING_TTL_MS) {
      pendingMessages.delete(id);
    }
  }
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getUserLabel(user) {
  if (user.username) return `@${user.username}`;
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || `user_${user.id}`;
}

function buildKeyboard(messageId) {
  return new InlineKeyboard()
    .text("Beli", `send:${messageId}:anon`)
    .text("Xeyr", `send:${messageId}:self`);
}

bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== "private") return;
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Mene ses veya metin göndər.\n\nBu mesajı təyin edilmiş kanala göndərəcəm.",
  );
});

bot.on("message:text", async (ctx) => {
  cleanupExpired();
  const id = crypto.randomBytes(5).toString("hex");

  pendingMessages.set(id, {
    createdAt: Date.now(),
    userId: ctx.from.id,
    type: "text",
    text: ctx.message.text,
    user: ctx.from,
  });

  await ctx.reply("Mesaj anonim olaraq göndərilsin?", {
    reply_markup: buildKeyboard(id),
  });
});

bot.on("message:voice", async (ctx) => {
  cleanupExpired();
  const id = crypto.randomBytes(5).toString("hex");

  pendingMessages.set(id, {
    createdAt: Date.now(),
    userId: ctx.from.id,
    type: "voice",
    voiceFileId: ctx.message.voice.file_id,
    caption: ctx.message.caption || "",
    user: ctx.from,
  });

  await ctx.reply("Ses anonim olaraq göndərilsin?", {
    reply_markup: buildKeyboard(id),
  });
});

bot.on("message", async (ctx) => {
  if (ctx.message.text || ctx.message.voice) return;
  await ctx.reply("Zehmet olmasa sadece metin veya ses mesajı gönderin.");
});

bot.callbackQuery(/^send:([a-f0-9]+):(anon|self)$/, async (ctx) => {
  cleanupExpired();
  const [, id, mode] = ctx.match;
  const pending = pendingMessages.get(id);

  if (!pending) {
    await ctx.answerCallbackQuery({
      text: "Bu sorgunun vaxti bitdi. Yeni bir mesaj gönder.",
    });
    return;
  }

  if (pending.userId !== ctx.from.id) {
    await ctx.answerCallbackQuery({ text: "Bu senin mesajın değil." });
    return;
  }

  // await ctx.answerCallbackQuery({ text: "Mesaj göndərildi. Kanal: @" + TARGET_CHANNEL_ID });
  await ctx.api.sendMessage(
    ctx.chat.id,
    "Mesaj göndərildi. Kanal: " + TARGET_CHANNEL_ID,
    { parse_mode: "HTML" },
  );

  const anonymous = mode === "anon";
  const sender = getUserLabel(pending.user);

  if (pending.type === "text") {
    const text = anonymous
      ? `<b>Anonim etiraf geldi:</b>\n\n${escapeHtml(pending.text)}`
      : `<b>${escapeHtml(sender)} etiraf edir:</b>\n\n${escapeHtml(pending.text)}`;

    await ctx.api.sendMessage(TARGET_CHANNEL_ID, text, { parse_mode: "HTML" });
    for (const adminId of ADMIN_IDS) {
      await ctx.api.sendMessage(
        adminId,
        `<b>${escapeHtml(sender)} etiraf edir:</b>\n\n${escapeHtml(pending.text)}`,
        { parse_mode: "HTML" },
      );
    }
  } else if (pending.type === "voice") {
    const sourceCaption = pending.caption ? `\n\n${pending.caption}` : "";
    const caption = anonymous
      ? `Anonim ses${sourceCaption}`
      : `Sesin sahibi ${sender}${sourceCaption}`;
    const workingMessage = await ctx
      .reply("Ses gonderilir...")
      .catch(() => null);

    const telegramFile = await ctx.api.getFile(pending.voiceFileId);
    if (!telegramFile.file_path) {
      throw new Error("Unable to resolve Telegram voice file path.");
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${telegramFile.file_path}`;
    const tmpBase = path.join(os.tmpdir(), `anonim-voice-${id}`);
    const inputPath = `${tmpBase}-in.ogg`;
    const outputPath = `${tmpBase}-helium.ogg`;

    try {
      await downloadTelegramFile(fileUrl, inputPath);
      await convertVoiceToHelium(inputPath, outputPath);
      await ctx.api.sendVoice(TARGET_CHANNEL_ID, new InputFile(outputPath), {
        caption,
      });

      for (const adminId of ADMIN_IDS) {
        if (adminId) {
          await ctx.api.sendVoice(adminId, new InputFile(outputPath), {
            caption: `Sesin sahibi ${sender}${sourceCaption}`,
          });
        }
      }
      if (workingMessage) {
        await ctx.api
          .deleteMessage(ctx.chat.id, workingMessage.message_id)
          .catch(() => {});
      }
    } catch (err) {
      if (workingMessage) {
        await ctx.api
          .deleteMessage(ctx.chat.id, workingMessage.message_id)
          .catch(() => {});
      }
      // await ctx.reply("Ses göndərilərkən xəta baş verdi. Yenidən cəhd edin.").catch(() => {});
      throw err;
    } finally {
      await Promise.all([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {}),
      ]);
    }
  }

  pendingMessages.delete(id);

  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await ctx.answerCallbackQuery({ text: "Sent to channel." });
});

bot.catch((err) => {
  console.error("Bot error:", err.error);
  if (err.error && err.error.description === "Bad Request: chat not found") {
    console.error(
      "Check TARGET_CHANNEL_ID. Use @channel_username or numeric id like -1001234567890, and make sure bot is admin in that channel.",
    );
  }
});

bot.start();
console.log("Bot is running...");
