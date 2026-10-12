"""End-to-end test of DepositRouterAllocator against a real DepositRouter on
local anvil: createSession -> fresh clone address -> funds forwarded to Treasury.

Skipped when the repo-local Foundry toolchain is missing (anvil / forge).
"""
import asyncio
import json
import os
import re
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path

from aiohttp import ClientSession
from eth_account import Account
from eth_abi import encode
from eth_utils import keccak, to_checksum_address

from deposit_allocator import DepositRouterAllocator

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


@unittest.skipUnless(ANVIL.exists() and FORGE.exists(), "repo-local foundry toolchain not present")
class DepositRouterAllocatorTests(unittest.IsolatedAsyncioTestCase):
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
        await self._wait_rpc()  # re-connect session lazily

    async def asyncTearDown(self):
        self.anvil.terminate()
        try:
            self.anvil.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.anvil.kill()

    # -- rpc helpers --------------------------------------------------------
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

    def _script(self, script, env):
        proc = subprocess.run(
            [str(FORGE), "script", script, "--rpc-url", self.url, "--broadcast"],
            cwd=REPO,
            capture_output=True,
            text=True,
            env={**os.environ, "PRIVATE_KEY": KEY},
        )
        if proc.returncode != 0:
            raise AssertionError(proc.stdout + proc.stderr)
        return proc.stdout

    def _deploy(self):
        out = self._script(
            REPO / "contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy", None
        )
        self.router = _grab(out, "routerProxy")
        self.treasury = _grab(out, "treasuryProxy")
        self._script(REPO / "contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS", None)
        broadcast = REPO / "broadcast" / "DeployTestFRENS.s.sol" / str(CHAIN_ID) / "run-latest.json"
        data = json.loads(broadcast.read_text())
        created = next(
            t for t in data["transactions"] if t["contractName"] == "TestFRENS" and t["transactionType"] == "CREATE"
        )
        self.token = to_checksum_address(created["contractAddress"])

    async def call_balance(self, account):
        data = "0x" + BALANCE_OF + encode(["address"], [account]).hex()
        result = await self.rpc("eth_call", [{"to": self.token, "data": data}, "latest"])
        return int(result, 16)

    async def send(self, to, data, value=0, account=FUNDED):
        to = to_checksum_address(to)  # eth-account needs checksummed 'to'
        txn = {
            "from": account.address,
            "to": to,
            "value": value,
            "data": data,
            "chainId": CHAIN_ID,
        }
        txn["nonce"] = int(await self.rpc("eth_getTransactionCount", [account.address, "pending"]), 16)
        txn["gas"] = int(
            await self.rpc(
                "eth_estimateGas",
                [{"from": account.address, "to": to, "data": data, "value": hex(value)}],
            ),
            16,
        )
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

    # -- the tests ----------------------------------------------------------
    async def test_erc20_deposit_forwards_to_treasury(self):
        allocator = DepositRouterAllocator(
            self.router, KEY, CHAIN_ID, self.url, token=self.token
        )
        clone, _, session_id = await allocator.allocate("pet-integration")
        self.assertRegex(clone, r"^0x[a-fA-F0-9]{40}$")
        self.assertRegex(session_id, r"^0x[a-fA-F0-9]{64}$")

        await self.send(self.token, "0x" + MINT + encode(["address", "uint256"], [FUNDED.address, 100 * 10**18]).hex())
        await self.send(self.token, "0x" + TRANSFER + encode(["address", "uint256"], [clone, 40 * 10**18]).hex())
        await self.send(clone, "0x" + SWEEP)

        self.assertEqual(await self.call_balance(self.treasury), 40 * 10**18)
        self.assertEqual(await self.call_balance(clone), 0)

    async def test_eth_deposit_auto_forwards_to_treasury(self):
        allocator = DepositRouterAllocator(self.router, KEY, CHAIN_ID, self.url)
        clone, _, _ = await allocator.allocate("pet-eth")

        before = int(await self.rpc("eth_getBalance", [self.treasury, "latest"]), 16)
        await self.send(clone, "0x", value=10**18)
        after = int(await self.rpc("eth_getBalance", [self.treasury, "latest"]), 16)
        self.assertEqual(after - before, 10**18)
        self.assertEqual(int(await self.rpc("eth_getBalance", [clone, "latest"]), 16), 0)

    async def test_allocator_reuses_router_nonce(self):
        allocator = DepositRouterAllocator(self.router, KEY, CHAIN_ID, self.url, token=self.token)
        a, _, _ = await allocator.allocate("pet-a")
        b, _, sid_b, = await allocator.allocate("pet-b")
        self.assertNotEqual(a, b)
        self.assertNotEqual(await allocator._rpc("eth_getTransactionCount", [FUNDED.address, "latest"]), "0x0")


def _grab(output, key):
    match = re.search(rf"^\s*{re.escape(key)}\s+(0x[a-fA-F0-9]{{40}})", output, re.MULTILINE)
    if not match:
        raise AssertionError(f"could not parse {key} from forge output:\n{output}")
    return match.group(1)


if __name__ == "__main__":
    unittest.main()