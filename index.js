require("dotenv").config();

const { Telegraf } = require("telegraf");

const token = process.env.BOT_TOKEN;
if (!token || token === "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
    console.error("❌ Error: BOT_TOKEN is missing or not configured in your .env file!");
    console.error("Please edit your .env file and set BOT_TOKEN to your actual Telegram Bot Token from @BotFather.");
    process.exit(1);
}

const bot = new Telegraf(token);


bot.start((ctx) => {
    ctx.reply(
        "🚀 Welcome to Ruleo\n\nType a rule like:\nBuy ETH every Friday if ETH < $2800 max $50/week"
    );
});

bot.on("text", (ctx) => {
    ctx.reply(`You said:\n${ctx.message.text}`);
});

bot.launch();

console.log("Bot running...");