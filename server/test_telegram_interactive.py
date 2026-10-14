import json
import sqlite3
import unittest
from unittest import mock

import telegram_interactive as tg_it


class TelegramInteractiveTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE pets(id TEXT PRIMARY KEY)')
        self.db.execute('CREATE TABLE tg_filters(id TEXT)')
        self.db.execute('CREATE TABLE tg_blocklist(id TEXT)')
        tg_it.install_game_schema(self.db)

    def tearDown(self):
        self.db.close()

    def test_zero_leak_redaction(self):
        # 1. Ethereum private key
        raw = "My key is 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae1870199f8d2190f please save it"
        redacted = tg_it.redact_secrets(raw)
        self.assertNotIn("4c0883a69102937d6231471b5dbb6204fe5129617082792ae1870199f8d2190f", redacted)
        self.assertIn("[REDACTED_SECRET]", redacted)

        # 2. Telegram Bot Token
        token_msg = "Telegram token 1234567890:ABCdefGHIJklmnOPQRstuvWxyz123456789 ready"
        self.assertIn("[REDACTED_SECRET]", tg_it.redact_secrets(token_msg))

        # 3. GitHub PAT
        gh_msg = "Use ghp_1234567890abcdefghijklmnopqrstuvwx for access"
        self.assertIn("[REDACTED_SECRET]", tg_it.redact_secrets(gh_msg))

        # 4. Google API key
        gemini_msg = "Key is AIzaSyD1234567890abcdefghijklmnopqrstuv"
        self.assertIn("[REDACTED_SECRET]", tg_it.redact_secrets(gemini_msg))

        # 5. Environment variable pattern
        env_msg = "SECRET_KEY='my-super-secret-password-12345'"
        self.assertIn("[REDACTED]", tg_it.redact_secrets(env_msg))

        # 6. Normal conversation is preserved
        normal = "Hello TinyFrens! Let's play a game and roll the dice."
        self.assertEqual(tg_it.redact_secrets(normal), normal)

    def test_admin_permissions(self):
        owner = {'username': 'dutchiono', 'id': 1}
        non_owner = {'username': 'random_user', 'id': 2}
        group_chat = {'type': 'supergroup', 'id': -100}
        private_chat = {'type': 'private', 'id': 1}

        # Owner is allowed in both private DM and groups
        self.assertTrue(tg_it.is_owner(owner))
        self.assertFalse(tg_it.is_owner(non_owner))
        self.assertTrue(tg_it.can_access_admin_tools(owner, private_chat))
        self.assertTrue(tg_it.can_access_admin_tools(owner, group_chat))

        # Non-owner in DM is never allowed
        self.assertFalse(tg_it.can_access_admin_tools(non_owner, private_chat, is_admin=True))

        # Non-owner in group is allowed if is_admin=True, otherwise denied
        self.assertTrue(tg_it.can_access_admin_tools(non_owner, group_chat, is_admin=True))
        self.assertFalse(tg_it.can_access_admin_tools(non_owner, group_chat, is_admin=False))

    def test_game_care_loop_and_level_up(self):
        pet = tg_it.get_or_create_pet(self.db, '-100', '42', 'Alice')
        self.assertEqual(pet['name'], "Alice's Fren")
        self.assertEqual(pet['level'], 1)
        self.assertEqual(pet['stage'], 'Hatchling 🥚')

        # 1. Feed
        pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'feed')
        self.assertIn("Yum!", note)
        self.assertEqual(pet['hunger'], 95)
        self.assertEqual(pet['xp'], 10)

        # 2. Play
        pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'play')
        self.assertIn("fetch", note)
        self.assertEqual(pet['energy'], 85)
        self.assertEqual(pet['frens_coins'], 65)

        # 3. Rest
        pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'rest')
        self.assertIn("Cozy nap", note)
        self.assertEqual(pet['energy'], 100)

        # 4. Bag
        pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'bag')
        self.assertIn("Backpack Contents", note)

        # 5. Dice rolls (1 to 6)
        for roll_val in range(1, 7):
            # Rest to ensure full energy
            tg_it.perform_care_action(self.db, '-100', '42', 'rest')
            pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'dice', roll=roll_val)
            self.assertIn(f"Rolled a {roll_val}!", note)

        # 6. Level up check
        self.db.execute('UPDATE tg_fren_game SET xp=95, level=1 WHERE chat_id=? AND user_id=?', ('-100', '42'))
        pet, note = tg_it.perform_care_action(self.db, '-100', '42', 'feed')
        self.assertIn("LEVEL UP!", note)
        self.assertEqual(pet['level'], 2)

    def test_render_game_card(self):
        pet = tg_it.get_or_create_pet(self.db, '-100', '42', 'Alice')
        text, kb = tg_it.render_game_card(pet, "Ready to explore!")
        self.assertIn("Alice's Fren", text)
        self.assertIn("Health:", text)
        self.assertIn("Ready to explore!", text)
        self.assertIn('inline_keyboard', kb)
        callbacks = [btn['callback_data'] for row in kb['inline_keyboard'] for btn in row]
        self.assertIn("g:42:feed", callbacks)
        self.assertIn("g:42:play", callbacks)
        self.assertIn("g:42:dice", callbacks)

    def test_render_github_progress(self):
        data = {
            'commits': [{'msg': 'Add game mode', 'author': 'dutch', 'sha': '1a2b3c4'}],
            'prs': [{'num': 36, 'title': 'Telegram moderation', 'state': 'closed', 'merged': True}],
            'runs': [{'name': 'Build & Test', 'conclusion': 'success'}]
        }
        text, kb = tg_it.render_github_progress(data)
        self.assertIn("TinyFrens Development Progress", text)
        self.assertIn("1a2b3c4", text)
        self.assertIn("#36", text)
        self.assertIn("✅ Merged", text)
        self.assertIn("🟢 Pass", text)
        self.assertEqual(kb['inline_keyboard'][0][0]['callback_data'], 'gh:refresh')

    def test_server_status_and_admin_triage(self):
        # Public status
        pub_text, pub_kb = tg_it.public_server_status(room_count=2, uptime_seconds=7300)
        self.assertIn("TinyFrens Server Status: Online", pub_text)
        self.assertIn("2h 1m", pub_text)
        self.assertIn("2 spaces", pub_text)
        self.assertNotIn("Memory", pub_text)
        self.assertNotIn("dutchiono", pub_text)

        # Admin triage
        adm_text = tg_it.admin_server_triage(self.db, room_count=2, uptime_seconds=7300)
        self.assertIn("TinyFrens Host & Server Triage", adm_text)
        self.assertIn("@dutchiono", adm_text)
        self.assertIn("Active Rooms:</b> 2", adm_text)


if __name__ == '__main__':
    unittest.main()
