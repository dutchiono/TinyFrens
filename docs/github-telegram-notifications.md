# GitHub → Telegram workflow notifications

Set **production-backend** environment secret `TELEGRAM_BOT_TOKEN` to the bot token, and environment variable `TELEGRAM_GITHUB_CHAT_ID` to the desired Telegram chat ID (numeric; negative for groups). For a Telegram topic, this initial workflow posts to the chat's default thread, not a topic.

After merging, each completed GitHub workflow named **TinyFrens quality gate**, **Android APK**, **Deploy backend to server**, or **Publish website to server** triggers a Telegram message containing the actual GitHub result, branch, SHA, and Actions URL. Failed Telegram delivery fails the notification job.

**Note:** A successful publish workflow is a verified website publish, but a successful quality gate or Android build is not a production deployment. A deployment workflow skipped by its own conditions may still report success; inspect its linked Actions run for whether a deployment actually occurred. GitHub Actions secrets are not automatically copied to the VPS by this workflow.
