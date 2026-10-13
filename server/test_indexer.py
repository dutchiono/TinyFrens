"""Deposit indexer tests: event decoding (unit) and end-to-end crediting on anvil."""
import asyncio
import json
import os
import re
import socket
import sqlite3
import subprocess
import unittest
from pathlib import Path

from aiohttp import ClientSession
from eth_account import Account
from eth_abi import encode
from eth_utils import keccak, to_checksum_address

from deposit_allocator import DepositRouterAllocator
from economy import Economy
from indexer import (
    DEPOSIT_TOPIC,
    TRANSFER_TOPIC,
    DepositIndexer,
    IndexerError,
    TreasuryTransferIndexer,
    decode_deposit_log,
    decode_transfer_log,
)

REPO = Path(__file__).resolve().parent.parent
TOOLS = REPO / ".tools" / "foundry"
ANVIL = TOOLS / "anvil.exe"
FORGE = TOOLS / "forge.exe"
KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
CHAIN_ID = 84532
FUNDED = Account.from_key(KEY)


def _selector(sig):
    return keccak(text=sig)[:4].hex()


MINT = _selector("mint(address,uint256)")
TRANSFER = _selector("transfer(address,uint256)")
BALANCE_OF = _selector("balanceOf(address)")
SWEEP = _selector("sweep()")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class DecodeTests(unittest.TestCase):
    def _log(self, session_id, sender, token, amount):
        data = (amount).to_bytes(32, "big").hex()
        return {
            "address": "0x" + "ab" * 20,
            "topics": [
                DEPOSIT_TOPIC,
                session_id,
                "0x000000000000000000000000" + sender[-40:],
                "0x000000000000000000000000" + token[-40:],
            ],
            "data": "0x" + data,
            "transactionHash": "0x" + "aa" * 32,
            "logIndex": "0x3",
        }

    def test_decode_eth_deposit(self):
        sid = keccak(text="s1").hex()
        sender = "0x" + "cd" * 20
        log = self._log(sid, sender, "0x0000000000000000000000000000000000000000", 10**18)
        got_sid, got_sender, got_token, amount = decode_deposit_log(log)
        self.assertEqual(got_sid, sid)
        self.assertEqual(to_checksum_address(got_sender), to_checksum_address(sender))
        self.assertEqual(got_token, "0x" + "00" * 20)
        self.assertEqual(amount, 10**18)

    def test_decode_rejects_wrong_topic(self):
        log = self._log(keccak(text="s2").hex(), "0x" + "cd" * 20, "0x" + "11" * 20, 5)
        log["topics"][0] = "0x" + "00" * 32
        self.assertRaises(IndexerError, decode_deposit_log, log)


class TransferDecodeTests(unittest.TestCase):
    def _transfer(self, sender, recipient, amount):
        return {
            "address": "0x" + "11" * 20,
            "topics": [
                TRANSFER_TOPIC,
                "0x000000000000000000000000" + sender[-40:],
                "0x000000000000000000000000" + recipient[-40:],
            ],
            "data": "0x" + amount.to_bytes(32, "big").hex(),
            "transactionHash": "0x" + "cc" * 32,
            "logIndex": "0x2",
        }

    def test_decode_transfer(self):
        sender = "0x" + "cd" * 20
        recipient = "0x" + "ef" * 20
        got_sender, got_recipient, amount = decode_transfer_log(self._transfer(sender, recipient, 7 * 10**18))
        self.assertEqual(to_checksum_address(got_sender), to_checksum_address(sender))
        self.assertEqual(to_checksum_address(got_recipient), to_checksum_address(recipient))
        self.assertEqual(amount, 7 * 10**18)

    def test_decode_transfer_rejects_wrong_topic(self):
        log = self._transfer("0x" + "cd" * 20, "0x" + "ef" * 20, 1)
        log["topics"][0] = "0x" + "00" * 32
        self.assertRaises(IndexerError, decode_transfer_log, log)


class TreasuryIndexerUnitTests(unittest.IsolatedAsyncioTestCase):
    """Drive `TreasuryTransferIndexer.scan` with a stubbed RPC (no network)."""

    TREASURY = "0x" + "ab" * 20
    TOKEN = "0x" + "11" * 20

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.economy = Economy(self.db)

    def _indexer(self, logs, resolve, **kw):
        indexer = TreasuryTransferIndexer(
            self.economy, "http://rpc.invalid", 8453, treasury=self.TREASURY,
            token=kw.pop("token", self.TOKEN), resolve=resolve, **kw,
        )
        calls = []

        async def fake_rpc(method, params):
            calls.append((method, params))
            return logs if method == "eth_getLogs" else "0x0"

        indexer._rpc = fake_rpc
        indexer.calls = calls
        return indexer

    def _log(self, sender, recipient, amount):
        return {
            "address": self.TOKEN,
            "topics": [
                TRANSFER_TOPIC,
                "0x000000000000000000000000" + sender[-40:],
                "0x000000000000000000000000" + recipient[-40:],
            ],
            "data": "0x" + amount.to_bytes(32, "big").hex(),
            "transactionHash": "0x" + "dd" * 32,
            "logIndex": "0x5",
        }

    async def test_scan_credits_resolved_sender(self):
        sender = "0x" + "01" * 20
        indexer = self._indexer([self._log(sender, self.TREASURY, 12 * 10**18)],
                                resolve=lambda s: "pet-1" if s.lower() == sender else None)
        credited = await indexer.scan(100, 120)
        self.assertEqual(credited, 1)
        self.assertEqual(self.economy.balance("pet-1"), 1_200)

    async def test_scan_filters_to_treasury_and_token(self):
        sender = "0x" + "01" * 20
        other = "0x" + "02" * 20
        logs = [self._log(sender, other, 10**18), self._log(sender, self.TREASURY, 10**18)]
        indexer = self._indexer(logs, resolve=lambda s: "pet-1")
        credited = await indexer.scan(1, 2)
        self.assertEqual(credited, 1)
        self.assertEqual(self.economy.balance("pet-1"), 100)
        method, params = indexer.calls[0]
        self.assertEqual(method, "eth_getLogs")
        self.assertEqual(params[0]["address"], self.TOKEN)
        self.assertEqual(params[0]["topics"][0], TRANSFER_TOPIC)
        self.assertEqual(params[0]["topics"][2], "0x" + self.TREASURY[2:].lower().rjust(64, "0"))

    async def test_scan_unmatched_sender_credits_nothing(self):
        indexer = self._indexer([self._log("0x" + "01" * 20, self.TREASURY, 10**18)],
                                resolve=lambda s: None)
        credited = await indexer.scan(1, 2)
        self.assertEqual(credited, 0)
        self.assertEqual(self.economy.balance("pet-1"), 0)

    async def test_scan_over_cap_credits_nothing(self):
        indexer = self._indexer([self._log("0x" + "01" * 20, self.TREASURY, 10**21)],
                                resolve=lambda s: "pet-1", max_credits=100)
        credited = await indexer.scan(1, 2)
        self.assertEqual(credited, 0)
        self.assertEqual(self.economy.balance("pet-1"), 0)

    async def test_scan_is_idempotent(self):
        indexer = self._indexer([self._log("0x" + "01" * 20, self.TREASURY, 10**18)],
                                resolve=lambda s: "pet-1")
        self.assertEqual(await indexer.scan(1, 2), 1)
        self.assertEqual(await indexer.scan(1, 2), 0)
        self.assertEqual(self.economy.balance("pet-1"), 100)

    async def test_scan_respects_its_own_state_key(self):
        indexer = self._indexer([], resolve=lambda s: None)
        self.assertIsNone(indexer._state_last())
        indexer._state_save(4321)
        self.assertEqual(indexer._state_last(), 4321)
        # A stale deposit-indexer cursor must not be read as the treasury cursor.
        self.db.execute("INSERT INTO indexer_state(key,value) VALUES('last_block',9999999)")
        self.assertEqual(indexer._state_last(), 4321)


@unittest.skipUnless(ANVIL.exists() and FORGE.exists(), "repo-local foundry toolchain not present")
class IndexerIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.anvil = subprocess.Popen(
            [str(ANVIL), "--port", str(self.port), "--chain-id", str(CHAIN_ID)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        await self._wait_rpc()
        await asyncio.to_thread(self._deploy)

        self.db = sqlite3.connect(":memory:")
        self.economy = Economy(self.db)
        self.indexer = DepositIndexer(self.economy, self.url, CHAIN_ID, start_block="earliest", poll_seconds=0.2)

    async def asyncTearDown(self):
        self.anvil.terminate()
        try:
            self.anvil.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.anvil.kill()

    async def rpc(self, method, params):
        async with ClientSession() as session:
            async with session.post(
                self.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
            ) as response:
                data = await response.json(content_type=None)
        if "error" in data:
            raise AssertionError(f"rpc {method}: {data['error']}")
        return data["result"]

    async def _wait_rpc(self, attempts=40):
        for _ in range(attempts):
            try:
                await self.rpc("eth_blockNumber", [])
                return
            except Exception:
                await asyncio.sleep(0.25)
        raise AssertionError("anvil did not come up")

    def _script(self, script):
        proc = subprocess.run(
            [str(FORGE), "script", str(script), "--rpc-url", self.url, "--broadcast"],
            cwd=REPO,
            capture_output=True,
            text=True,
            env={**os.environ, "PRIVATE_KEY": KEY},
        )
        if proc.returncode != 0:
            raise AssertionError(proc.stdout + proc.stderr)
        return proc.stdout

    def _deploy(self):
        out = self._script(REPO / "contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy")
        self.router = _grab(out, "routerProxy")
        self.treasury = _grab(out, "treasuryProxy")
        self._script(REPO / "contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS")
        broadcast = REPO / "broadcast" / "DeployTestFRENS.s.sol" / str(CHAIN_ID) / "run-latest.json"
        data = json.loads(broadcast.read_text())
        created = next(
            t for t in data["transactions"] if t["contractName"] == "TestFRENS" and t["transactionType"] == "CREATE"
        )
        self.token = to_checksum_address(created["contractAddress"])

    async def send(self, to, data, value=0, account=FUNDED):
        to = to_checksum_address(to)
        txn = {
            "from": account.address,
            "to": to,
            "value": value,
            "data": data,
            "chainId": CHAIN_ID,
        }
        txn["nonce"] = int(await self.rpc("eth_getTransactionCount", [account.address, "pending"]), 16)
        estimated = await self.rpc(
            "eth_estimateGas",
            [{"from": account.address, "to": to, "data": data, "value": hex(value)}],
        )
        txn["gas"] = int(estimated, 16)
        gas_price = int(await self.rpc("eth_gasPrice", []), 16)
        txn["maxFeePerGas"] = gas_price + 10**9
        txn["maxPriorityFeePerGas"] = 10**9
        signed = account.sign_transaction(txn)
        tx_hash = await self.rpc("eth_sendRawTransaction", [signed.rawTransaction.hex()])
        for _ in range(40):
            receipt = await self.rpc("eth_getTransactionReceipt", [tx_hash])
            if receipt:
                assert receipt["status"] == "0x1", f"tx reverted: {receipt}"
                return receipt
            await asyncio.sleep(0.25)
        raise AssertionError(f"tx {tx_hash} never mined")

    async def test_indexer_credits_eth_and_erc20_deposits(self):
        eth_allocator = DepositRouterAllocator(self.router, KEY, CHAIN_ID, self.url)
        clone_eth, _, sid_eth = await eth_allocator.allocate("pet-eth")
        erc_allocator = DepositRouterAllocator(self.router, KEY, CHAIN_ID, self.url, token=self.token)
        clone_erc, _, sid_erc = await erc_allocator.allocate("pet-erc")

        eth_session = self.economy.open_session(
            "pet-eth", clone_eth, 40, token=None, chain_id=CHAIN_ID, session_id=sid_eth
        )
        erc_session = self.economy.open_session(
            "pet-erc", clone_erc, 25, token=self.token, chain_id=CHAIN_ID, session_id=sid_erc
        )
        self.assertEqual(eth_session["credits"], 4000)
        self.assertEqual(erc_session["credits"], 2500)

        # ETH deposit: user sends value to the clone; Deposit auto-forwarded.
        await self.send(clone_eth, "0x", value=40 * 10**18)
        # ERC-20 deposit: mint, transfer to clone, then sweep emits the Deposit event.
        await self.send(self.token, "0x" + MINT + encode(["address", "uint256"], [FUNDED.address, 100 * 10**18]).hex())
        await self.send(self.token, "0x" + TRANSFER + encode(["address", "uint256"], [clone_erc, 25 * 10**18]).hex())
        await self.send(clone_erc, "0x" + SWEEP)

        self.assertEqual(self.economy.balance("pet-eth"), 0)
        self.assertEqual(self.economy.balance("pet-erc"), 0)

        confirmed, blocks = await self.indexer.run_once()
        self.assertGreater(blocks, 0)
        self.assertEqual(confirmed, 2)
        self.assertEqual(self.economy.balance("pet-eth"), 4000)
        self.assertEqual(self.economy.balance("pet-erc"), 2500)
        self.assertEqual(self.economy.session(sid_eth)["status"], "confirmed")
        self.assertEqual(self.economy.session(sid_erc)["status"], "confirmed")

        again, _ = await self.indexer.run_once()
        self.assertEqual(again, 0)
        self.assertEqual(self.economy.balance("pet-eth"), 4000)
        self.assertEqual(self.economy.balance("pet-erc"), 2500)


def _grab(output, key):
    match = re.search(rf"^\s*{re.escape(key)}\s+(0x[a-fA-F0-9]{{40}})", output, re.MULTILINE)
    if not match:
        raise AssertionError(f"could not parse {key} from forge output:\n{output}")
    return match.group(1)


if __name__ == "__main__":
    unittest.main()