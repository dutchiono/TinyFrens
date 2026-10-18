# GitHub → Telegram workflow notifications

Set **production-backend** environment secret `TELEGRAM_BOT_TOKEN` to the bot token, and environment variable `TELEGRAM_GITHUB_CHAT_ID` to the owner's private Telegram user/chat ID. Keep failure alerts private; group deployment status uses the bot's separate pinned status card.

After merging, failed, cancelled, or timed-out repository workflows trigger a private Telegram alert containing the actual GitHub result, branch, SHA, and Actions URL. Successful CI stays silent. Successful production deployments continue to use the bot's existing single edited and pinned deployment-status card. Failed Telegram delivery fails the notification job.

GitHub Actions secrets are not automatically copied to the VPS by this workflow.
