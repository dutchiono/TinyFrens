"""On-chain allocator: calls DepositRouter.createSession so every payment gets a
fresh clone address that forwards to the Treasury.

Standard flow (server holds the game-controller key):
  1. build `createSession(bytes32,address)` calldata
  2. sign an EIP-1559 tx from the controller and broadcast over JSON-RPC
  3. wait for the receipt
  4. read `sessionAddress(sessionId)` to learn the clone address
  5. return (clone address, token, sessionId) -> route stores it and returns to client

Uses the standard eth-account/eth-abi/eth-utils stack (no web3 needed).
"""
import asyncio
import json
import logging
import secrets
import time

from aiohttp import ClientSession, ClientTimeout
from eth_account import Account
from eth_abi import encode
from eth_utils import keccak, to_checksum_address

log = logging.getLogger("economy.allocator")

CREATE_SESSION_SELECTOR = keccak(text="createSession(bytes32,address)")[:4].hex()
SESSION_ADDRESS_SELECTOR = keccak(text="sessionAddress(bytes32)")[:4].hex()
ONE_GWEI = 1_000_000_000


class AllocatorError(Exception):
    pass


class NotConfigured(AllocatorError):
    pass


class AllocatorTimeout(AllocatorError):
    pass


def session_id_bytes(pet_id, token=None):
    """Fresh 32-byte session id for a pet; collision-safe via random salt."""
    salt = secrets.token_bytes(8)
    return keccak(pet_id.encode() + (token or "").encode() + salt)


class DepositRouterAllocator:
    """Async allocator wired to a live DepositRouter on Base (testnet or main)."""

    def __init__(
        self,
        router_address,
        controller_key,
        chain_id,
        rpc_url,
        *,
        token=None,
        timeout=30,
        poll_seconds=1.5,
        max_priority_fee=ONE_GWEI,
    ):
        self.router = to_checksum_address(router_address)
        self.account = Account.from_key(controller_key)
        self.chain_id = int(chain_id)
        self.rpc_url = rpc_url
        self.token = token  # address(0) or None => ETH session
        self.timeout = timeout
        self.poll = poll_seconds
        self.max_priority_fee = int(max_priority_fee)
        if rpc_url.endswith(("/",)):
            self.rpc_url = rpc_url[:-1]

    async def _rpc(self, method, params):
        async with ClientSession(
            timeout=ClientTimeout(total=self.timeout + 5)
        ) as session:
            async with session.post(
                self.rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            ) as response:
                data = await response.json(content_type=None)
        if "error" in data:
            raise AllocatorError(f"rpc {method}: {data['error']}")
        return data.get("result")

    async def allocate(self, pet_id):
        token = self.token or "0x0000000000000000000000000000000000000000"
        sid = session_id_bytes(pet_id, token)
        sid_b = sid if isinstance(sid, bytes) else bytes.fromhex(sid.removeprefix("0x"))
        calldata = "0x" + CREATE_SESSION_SELECTOR + encode(["bytes32", "address"], [sid_b, token]).hex()

        txn = {
            "from": self.account.address,
            "to": self.router,
            "value": 0,
            "data": calldata,
            "chainId": self.chain_id,
        }
        txn["nonce"] = int(await self._rpc("eth_getTransactionCount", [self.account.address, "pending"]), 16)
        try:
            txn["gas"] = int(await self._rpc("eth_estimateGas", [{"from": self.account.address, "to": self.router, "data": calldata}]), 16)
        except AllocatorError:
            raise
        priority = self.max_priority_fee
        gas_price = int(await self._rpc("eth_gasPrice", []), 16)
        txn["maxFeePerGas"] = gas_price + priority
        txn["maxPriorityFeePerGas"] = priority

        signed = self.account.sign_transaction(txn)
        tx_hash = await self._rpc("eth_sendRawTransaction", [signed.rawTransaction.hex()])

        receipt = await self._wait_receipt(tx_hash)
        if not receipt or receipt.get("status") not in ("0x1", "1"):
            raise AllocatorError(f"createSession tx {tx_hash} failed: {receipt}")

        address = await self._read_session_address(sid)
        return address, None, "0x" + sid.hex()

    async def _wait_receipt(self, tx_hash):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            receipt = await self._rpc("eth_getTransactionReceipt", [tx_hash])
            if receipt:
                return receipt
            await asyncio.sleep(self.poll)
        raise AllocatorTimeout(f"tx {tx_hash} not mined within {self.timeout}s")

    async def _read_session_address(self, sid):
        calldata = "0x" + SESSION_ADDRESS_SELECTOR + encode(["bytes32"], [sid]).hex()
        result = await self._rpc("eth_call", [{"to": self.router, "data": calldata}, "latest"])
        return to_checksum_address("0x" + result[-40:])