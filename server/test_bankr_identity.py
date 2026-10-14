import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from bankr_identity import verify_handle


class BankrIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_matching_resolved_wallet_is_accepted(self):
        for data, expected in [({'resolved':True, 'address':'0xABC'}, None),
                               ({'resolved':True, 'address':'0xdef'}, ValueError),
                               ({'resolved':False}, ValueError)]:
            response = MagicMock(status=200)
            response.json = AsyncMock(return_value=data)
            session = MagicMock()
            session.get.return_value.__aenter__.return_value = response
            with patch('bankr_identity.ClientSession') as factory:
                factory.return_value.__aenter__.return_value = session
                if expected:
                    with self.assertRaises(expected): await verify_handle('test', '0xabc')
                else: await verify_handle('test', '0xabc')
                session.get.assert_called_once_with('https://api.bankr.bot/addresses/resolve',
                    params={'value':'test','type':'twitter'}, allow_redirects=False)
