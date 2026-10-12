import sqlite3
import unittest
from turtle_connect import migrate_wallet_links, linked_wallets, add_wallet


class WalletMigrationTests(unittest.TestCase):
    def test_existing_link_survives_migration_and_removal_survives_restart(self):
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE wallet_links(pet_id TEXT PRIMARY KEY,address TEXT,created INTEGER)')
            first = '0x' + 'a' * 40
            second = '0x' + 'b' * 40
            db.execute('INSERT INTO wallet_links VALUES(?,?,?)', ('device', first, 1))
            db.commit()
            migrate_wallet_links(db)
            self.assertEqual(linked_wallets(db, 'device'), [first])
            add_wallet(db, 'device', second)
            add_wallet(db, 'device', second.upper().replace('0X', '0x'))
            self.assertEqual(len(linked_wallets(db, 'device')), 2)
            self.assertEqual(linked_wallets(db, 'another-device'), [])
            db.execute('DELETE FROM wallet_links WHERE address=? COLLATE NOCASE', (first,))
            db.commit()
            migrate_wallet_links(db)
            self.assertEqual(len(linked_wallets(db, 'device')), 1)
