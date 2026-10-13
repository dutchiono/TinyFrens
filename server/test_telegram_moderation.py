import sqlite3
import unittest

import telegram_moderation as tg_mod


class TelegramModerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        tg_mod.install_schema(self.db)

    def tearDown(self):
        self.db.close()

    def test_parse_filter_commands(self):
        self.assertEqual(
            tg_mod.parse_filter_command('/filter website https://tinyfrens.lol'),
            ('set', 'website', 'https://tinyfrens.lol')
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter /website https://tinyfrens.lol'),
            ('set', 'website', 'https://tinyfrens.lol')
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter@TinyFrensBot website https://tinyfrens.lol'),
            ('set', 'website', 'https://tinyfrens.lol')
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter remove website'),
            ('remove', 'website', None)
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter delete website'),
            ('remove', 'website', None)
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter list'),
            ('list', None, None)
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filter'),
            ('list', None, None)
        )
        self.assertEqual(
            tg_mod.parse_filter_command('/filters'),
            ('list', None, None)
        )
        self.assertIsNone(tg_mod.parse_filter_command('just saying /filter in a sentence'))

    def test_parse_blocklist_commands(self):
        self.assertEqual(
            tg_mod.parse_blocklist_command('/blocklist add badword'),
            ('add', 'badword')
        )
        self.assertEqual(
            tg_mod.parse_blocklist_command('/blocklist remove badword'),
            ('remove', 'badword')
        )
        self.assertEqual(
            tg_mod.parse_blocklist_command('/blocklist delete badword'),
            ('remove', 'badword')
        )
        self.assertEqual(
            tg_mod.parse_blocklist_command('/blocklist list'),
            ('list', None)
        )
        self.assertEqual(
            tg_mod.parse_blocklist_command('/blocklist'),
            ('list', None)
        )
        self.assertIsNone(tg_mod.parse_blocklist_command('hello blocklist'))

    def test_parse_ban_commands(self):
        self.assertEqual(tg_mod.parse_ban_command('/ban'), (True, None))
        self.assertEqual(tg_mod.parse_ban_command('/ban spammer'), (True, 'spammer'))
        self.assertEqual(tg_mod.parse_ban_command('/aiban'), (True, None))
        self.assertEqual(tg_mod.parse_ban_command('/aiban scammer'), (True, 'scammer'))
        self.assertEqual(tg_mod.parse_ban_command('/ban@TinyFrensBot'), (True, None))
        self.assertEqual(tg_mod.parse_ban_command('not a ban'), (False, None))

    def test_filter_crud_and_matching(self):
        chat_id = '-100123456'
        tg_mod.add_filter(self.db, chat_id, 'website', 'https://tinyfrens.lol', created_by='123')
        filters = tg_mod.list_filters(self.db, chat_id)
        self.assertEqual(len(filters), 1)
        self.assertEqual(filters[0]['trigger'], 'website')
        self.assertEqual(filters[0]['response'], 'https://tinyfrens.lol')

        # Matching variations
        self.assertEqual(tg_mod.match_filter(self.db, chat_id, 'website'), 'https://tinyfrens.lol')
        self.assertEqual(tg_mod.match_filter(self.db, chat_id, '/website'), 'https://tinyfrens.lol')
        self.assertEqual(tg_mod.match_filter(self.db, chat_id, 'Check out our website!'), 'https://tinyfrens.lol')
        self.assertIsNone(tg_mod.match_filter(self.db, chat_id, 'mywebsites is cool'))

        # Different chat has no filter
        self.assertIsNone(tg_mod.match_filter(self.db, '-100999999', 'website'))

        # Remove filter
        self.assertTrue(tg_mod.remove_filter(self.db, chat_id, 'website'))
        self.assertIsNone(tg_mod.match_filter(self.db, chat_id, 'website'))
        self.assertFalse(tg_mod.remove_filter(self.db, chat_id, 'website'))

    def test_filter_validation(self):
        with self.assertRaises(ValueError):
            tg_mod.add_filter(self.db, '1', 'two words', 'reply')
        with self.assertRaises(ValueError):
            tg_mod.add_filter(self.db, '1', '', 'reply')
        with self.assertRaises(ValueError):
            tg_mod.add_filter(self.db, '1', 'valid', '')

    def test_blocklist_crud_and_matching(self):
        chat_id = '-100123456'
        tg_mod.add_blocklist(self.db, chat_id, 'crypto-scam', created_by='123')
        tg_mod.add_blocklist(self.db, chat_id, 'airdrop', created_by='123')
        patterns = tg_mod.list_blocklist(self.db, chat_id)
        self.assertEqual(patterns, ['airdrop', 'crypto-scam'])

        # Whole-word match for alphanumeric pattern
        self.assertEqual(tg_mod.match_blocklist(self.db, chat_id, 'join our airdrop now'), 'airdrop')
        self.assertIsNone(tg_mod.match_blocklist(self.db, chat_id, 'hot air droplets everywhere'))

        # Substring match for pattern with punctuation
        self.assertEqual(tg_mod.match_blocklist(self.db, chat_id, 'claim at crypto-scam.xyz'), 'crypto-scam')

        # Remove pattern
        self.assertTrue(tg_mod.remove_blocklist(self.db, chat_id, 'airdrop'))
        self.assertIsNone(tg_mod.match_blocklist(self.db, chat_id, 'join our airdrop'))

    def test_strikes_recording_and_reset(self):
        chat_id = '-100123456'
        user_id = '999'
        self.assertEqual(tg_mod.get_strikes(self.db, chat_id, user_id), 0)

        strike_1 = tg_mod.record_strike(self.db, chat_id, user_id, 'airdrop')
        self.assertEqual(strike_1, 1)
        self.assertEqual(tg_mod.get_strikes(self.db, chat_id, user_id), 1)

        strike_2 = tg_mod.record_strike(self.db, chat_id, user_id, 'airdrop')
        self.assertEqual(strike_2, 2)
        self.assertEqual(tg_mod.get_strikes(self.db, chat_id, user_id), 2)

        self.assertTrue(tg_mod.reset_strikes(self.db, chat_id, user_id))
        self.assertEqual(tg_mod.get_strikes(self.db, chat_id, user_id), 0)

    async def test_is_chat_admin_anonymous(self):
        chat = {'id': -100, 'type': 'supergroup'}
        message = {'sender_chat': {'id': -100}}
        self.assertTrue(await tg_mod.is_chat_admin(None, chat, None, 'tok', message))

    async def test_is_chat_admin_roles(self):
        chat = {'id': -100, 'type': 'supergroup'}
        token = 'fake_tok'

        async def fake_bot_api(method, payload, tok):
            self.assertEqual(method, 'getChatMember')
            uid = payload.get('user_id')
            if uid == 1:
                return {'ok': True, 'result': {'status': 'administrator'}}, 200
            elif uid == 2:
                return {'ok': True, 'result': {'status': 'creator'}}, 200
            return {'ok': True, 'result': {'status': 'member'}}, 200

        self.assertTrue(await tg_mod.is_chat_admin(fake_bot_api, chat, {'id': 1}, token))
        self.assertTrue(await tg_mod.is_chat_admin(fake_bot_api, chat, {'id': 2}, token))
        self.assertFalse(await tg_mod.is_chat_admin(fake_bot_api, chat, {'id': 3}, token))

        # Private chat is not a group
        self.assertFalse(await tg_mod.is_chat_admin(fake_bot_api, {'id': 1, 'type': 'private'}, {'id': 1}, token))
