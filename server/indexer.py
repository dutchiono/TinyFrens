"""Deposit indexer: watches DepositSession clones for `Deposit` events and credits
players idempotently, so users never paste tx hashes.

Scans logs by topic0 + known session addresses, decodes the event, maps it to the
open deposit session (by address, then by on-chain sessionId == DB id) and calls
`economy.confirm(...)` which guards uniqueness + amount + address.

Runs as a background asyncio task in the relay (see app.create_app) or standalone:

    python indexer.py --once          # scan up to head once and exit (cron-friendly)
    python indexer.py                 # poll forever

"""
import argparse
import asyncio
import json
import logging
import time

from aiohttp import ClientSession, ClientTimeout
from eth_utils import keccak, to_checksum_address

from economy import Economy, UnknownSession

log = logging.getLogger("economy.indexer")

DEPOSIT_TOPIC = "0x" + keccak(text="Deposit(bytes32,address,address,uint256)").hex()
OPEN_STATUSES = ("open", "confirmed")

SCHEMA = "CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY, value TEXT);"


class IndexerError(ValueError):
    pass


def decode_deposit_log(log):
    """Return (session_id_hex, sender, token, amount) from a Deposit log."""
    if not log.get("topics") or len(log["topics"]) != 4:
        raise IndexerError("not a Deposit log")
    if log["topics"][0] != DEPOSIT_TOPIC:
        raise IndexerError("not our Deposit topic")
    session_id = log["topics"][1]
    sender = to_checksum_address("0x" + log["topics"][2][-40:])
    token = to_checksum_address("0x" + log["topics"][3][-40:])
    amount = int.from_bytes(bytes.fromhex(log.get("data", "")[-64:]), "big") if log.get("data") else 0
    return session_id, sender, token, amount


class DepositIndexer:
    def __init__(
        self,
        economy,
        rpc_url,
        chain_id,
        *,
        poll_seconds=6,
        lookback=300,
        start_block="latest",
        max_block_span=2000,
    ):
        self.economy = economy
        self.chain_id = int(chain_id)
        self.rpc_url = rpc_url.rstrip("/")
        self.poll = float(poll_seconds)
        self.lookback = int(lookback)
        self.start_block = start_block
        self.max_span = int(max_block_span)
        self.economy.db.executescript(SCHEMA)
        self._task = None
        self._stop = False

    # -- rpc ------------------------------------------------------------
    async def _rpc(self, method, params):
        async with ClientSession(timeout=ClientTimeout(total=30)) as session:
            async with session.post(
                self.rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
            ) as response:
                data = await response.json(content_type=None)
        if "error" in data:
            raise IndexerError(f"rpc {method}: {data['error']}")
        return data["result"]

    async def block_number(self):
        return int(await self._rpc("eth_blockNumber", []), 16)

    # -- session address list ------------------------------------------
    def _session_addresses(self):
        rows = self.economy.db.execute(
            "SELECT address FROM deposit_sessions WHERE status IN (?,?)", OPEN_STATUSES
        ).fetchall()
        addr = sorted({r[0].lower() for r in rows})
        return addr

    # -- matching -------------------------------------------------------
    def _session_for_log(self, log, session_id, address):
        best = self.economy.open_session_for_address(address)
        if best and best["petId"]:
            return best
        try:
            cand = self.economy.session(session_id)
            if cand["address"].lower() == address.lower():
                return cand
        except UnknownSession:
            pass
        return None

    # -- scanning --------------------------------------------------------
    async def scan(self, from_block, to_block):
        """Scan [from_block, to_block] for Deposit logs and credit open sessions.
        Returns number of newly confirmed deposits."""
        addresses = self._session_addresses()
        if not addresses:
            return 0
        params = {
            "fromBlock": hex(int(from_block)),
            "toBlock": hex(int(to_block)),
            "address": addresses,
            "topics": [DEPOSIT_TOPIC],
        }
        logs = await self._rpc("eth_getLogs", [params])
        confirmed = 0
        for raw in logs:
            try:
                session_id, sender, token, amount = decode_deposit_log(raw)
            except IndexerError as exc:
                log.warning(f"skipping log: {exc}")
                continue
            session = self._session_for_log(raw, session_id, raw["address"])
            if not session or session["status"] != "open":
                continue
            try:
                result = self.economy.confirm(
                    session["id"],
                    raw["transactionHash"],
                    amount,
                    self.chain_id,
                    int(raw["logIndex"], 16),
                    address=to_checksum_address(raw["address"]),
                )
            except Exception as exc:  # noqa: BLE001 - indexer must never die on a bad log
                log.warning(f"confirm {raw['transactionHash']}: {exc}")
                continue
            if result["status"] == "confirmed":
                confirmed += 1
                log.info(
                    f"credited {result['credits']} credits on deposit {raw['transactionHash']} "
                    f"(session {session['id']}, token {token})"
                )
        return confirmed

    def _state_last(self):
        row = self.economy.db.execute("SELECT value FROM indexer_state WHERE key='last_block'").fetchone()
        return int(row[0]) if row else None

    def _state_save(self, block):
        self.economy.db.execute(
            "INSERT INTO indexer_state(key,value) VALUES('last_block',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(block),),
        )
        self.economy.db.commit()

    async def _block_number_or_inject(self, head):
        """The last processed block when none persisted: latest - lookback (or 0)."""
        if self.start_block == "latest":
            return max(0, head - self.lookback)
        if self.start_block == "earliest":
            return 0
        return max(0, int(self.start_block))

    async def run_once(self):
        """Scan any new range exactly once. Returns number confirmed and blocks scanned."""
        head = await self.block_number()
        last = self._state_last()
        if last is None:
            last = await self._block_number_or_inject(head)
            if last > head:
                last = head
            self._state_save(last)
        frm = last + 1
        if frm > head:
            return 0, 0
        confirmed = 0
        lo = frm
        while lo <= head:
            hi = min(lo + self.max_span - 1, head)
            confirmed += await self.scan(lo, hi)
            lo = hi + 1
        self._state_save(head)
        return confirmed, head - frm + 1

    async def run_forever(self, stop_event=None):
        self._stop = False
        while not self._stop:
            try:
                confirmed, _ = await self.run_once()
                if confirmed:
                    log.info(f"processed {confirmed} new deposit(s)")
            except Exception as exc:
                log.warning(f"indexer scan failed (will retry): {exc}")
            if stop_event is not None:
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=self.poll)
                    break
                except asyncio.TimeoutError:
                    continue
            else:
                await asyncio.sleep(self.poll)
        return self

    def stop(self):
        self._stop = True

    # asyncio task helpers ----------------------------------------------
    def start(self):
        loop = asyncio.get_event_loop()
        self._task = loop.create_task(self.run_forever())
        return self._task

    async def aclose(self):
        self._stop = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()


async def _cli_once(args):
    from economy import Economy
    import sqlite3

    db = sqlite3.connect(args.db)
    economy = Economy(db)
    indexer = DepositIndexer(
        economy,
        args.rpc,
        args.chain_id,
        poll_seconds=args.poll,
        lookback=args.lookback,
        start_block=args.start_block,
    )
    confirmed, blocks = await indexer.run_once()
    print(json.dumps({"blocksScanned": blocks, "confirmed": confirmed}))
    db.close()


def _cli_forever(args):
    async def main():
        from economy import Economy
        import sqlite3

        db = sqlite3.connect(args.db)
        economy = Economy(db)
        indexer = DepositIndexer(
            economy,
            args.rpc,
            args.chain_id,
            poll_seconds=args.poll,
            lookback=args.lookback,
            start_block=args.start_block,
        )
        await indexer.run_forever()

    asyncio.run(main())


def main():
    parser = argparse.ArgumentParser(description="TinyFrens deposit indexer")
    parser.add_argument("--rpc", default="https://sepolia.base.org")
    parser.add_argument("--chain-id", type=int, default=84532)
    parser.add_argument("--db", default="tinyfrens.db")
    parser.add_argument("--poll", type=float, default=6)
    parser.add_argument("--lookback", type=int, default=300)
    parser.add_argument("--start-block", default="latest", help="latest | earliest | <number>")
    parser.add_argument("--once", action="store_true", help="scan once and exit")
    group = parser.add_mutually_exclusive_group()
    parser.set_defaults(func=_cli_forever)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if args.once:
        asyncio.run(_cli_once(args))
    else:
        _cli_forever(args)


if __name__ == "__main__":
    main()