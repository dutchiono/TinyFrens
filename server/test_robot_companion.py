import base64
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import AsyncMock, patch
import xml.etree.ElementTree as ET

from robot_companion import Robots, companion, CONTRACT, NS, START_BLOCK, TRANSFER

IMAGE = 'data:image/svg+xml;base64,' + base64.b64encode((Path(__file__).parent / 'fixtures/robots-v1/1.svg').read_bytes()).decode()
OWNER = '0x1111111111111111111111111111111111111111'
OTHER = '0x2222222222222222222222222222222222222222'


class RobotArtTests(unittest.TestCase):
    def test_actual_minted_art_keeps_character_paths_and_removes_scene(self):
        rig = companion(IMAGE)
        self.assertEqual(len(rig['frames']), 8)
        self.assertEqual(rig['frameMs'], 141)
        self.assertEqual(len(set(rig['frames'])), 8)
        original = ET.fromstring(base64.b64decode(IMAGE.split(',')[1]))
        character = next(n for n in original if n.get('transform') == 'translate(16 30)')
        expected = [n.attrib for group in character if group.get('class') != 'shadow'
                    for n in group.iter() if n.tag == NS + 'path']
        for image in [rig['idle'], *rig['frames']]:
            root = ET.fromstring(base64.b64decode(image.split(',')[1]))
            self.assertEqual([n.attrib for n in root.iter() if n.tag == NS + 'path'], expected)
            self.assertEqual(len(root), 1)
            self.assertFalse(any(n.tag == NS + 'style' or n.get('class') == 'shadow' for n in root.iter()))
        with self.assertRaises(ValueError): companion('data:image/png;base64,AAAA')


class RobotOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = sqlite3.connect(':memory:')
        self.robots = Robots(self.db)
        self.owner = OWNER
        metadata = 'data:application/json;base64,' + base64.b64encode(json.dumps({'name':'Robot #1','image':IMAGE}).encode()).decode()
        self.encoded = '0x' + format(32, '064x') + format(len(metadata), '064x') + metadata.encode().hex()
        async def rpc(method, params):
            if method == 'eth_chainId': return '0x2105'
            if method == 'eth_blockNumber': return hex(START_BLOCK + 10)
            if method == 'eth_getLogs': return [{'address':CONTRACT,'topics':[TRANSFER,'0x'+'0'*64,'0x'+OWNER[2:].zfill(64), '0x'+format(1,'064x')]}]
            selector = params[0]['data'][:10]
            if selector == '0x18160ddd': return '0x'+format(1,'064x')
            if selector == '0x70a08231': return '0x'+format(1,'064x')
            if selector == '0x6352211e': return '0x'+self.owner[2:].zfill(64)
            if selector == '0xc87b56dd': return self.encoded
            raise AssertionError(selector)
        self.robots.rpc = AsyncMock(side_effect=rpc)
        self.robots.owner_batch = AsyncMock(return_value={'1':OWNER})

    async def asyncTearDown(self): self.db.close()

    async def test_owner_only_daily_renewal_and_transfer_revocation(self):
        self.assertFalse((await self.robots.read(OTHER, 1))['active'])
        result = await self.robots.read(OWNER, 1)
        self.assertEqual(result['companion']['adapter'], 'tinyfrens-robots-v1')
        self.owner = OTHER
        self.assertTrue((await self.robots.read(OWNER, 1))['active'])
        with patch('robot_companion.time.time', return_value=result['validUntil'] + 1):
            self.assertFalse((await self.robots.read(OWNER, 1))['active'])

    async def test_discovery_uses_current_inventory_without_archive_logs(self):
        result = await self.robots.discover(OWNER)
        self.assertEqual([n['tokenId'] for n in result['nfts']], [1])
        self.assertEqual(result['nfts'][0]['originalAddress'], CONTRACT)
        self.assertFalse(any(call.args[0] == 'eth_getLogs' for call in self.robots.rpc.call_args_list))
        await self.robots.discover(OWNER)
        self.assertEqual(self.robots.owner_batch.await_count, 1)
        self.robots.rpc = AsyncMock(return_value='0x1')
        with self.assertRaisesRegex(RuntimeError, 'Base mainnet'): await self.robots.discover(OWNER)

    async def test_incomplete_inventory_is_not_cached_as_missing_nfts(self):
        self.robots.owner_batch = AsyncMock(return_value={})
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            await self.robots.discover(OWNER)
        self.assertIsNone(self.db.execute('SELECT owners FROM robot_owner_inventory').fetchone())
