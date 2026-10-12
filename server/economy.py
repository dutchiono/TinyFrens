"""TinyFrens economy: deposit sessions + off-chain credit ledger.

Self-contained store on the shared sqlite connection. Wire it into the relay with
`attach(app, db, token_pet=..., limit=..., settings=..., allocator=...)`.

Design notes (see ONCHAIN-ECONOMY.md):
  * credits are integers; FRENS is 18-decimal on-chain value.
  * one open deposit session per pet: opening a new one expires the previous.
  * deposit confirmation is idempotent on (chain_id, tx_hash, log_index).
  * credits are only granted from a confirmed deposit (or admin grant) and the
    ledger is append-only.
"""
import json
import secrets
import sqlite3
import time

from aiohttp import web

CREDITS_PER_FRENS = 100
FRENS_DECIMALS = 18
SESSION_TTL_SECONDS = 900
PACKAGES = (10, 50, 100)  # FRENS

SCHEMA = """
CREATE TABLE IF NOT EXISTS deposit_sessions(
    id TEXT PRIMARY KEY,
    pet_id TEXT NOT NULL,
    address TEXT NOT NULL,
    token TEXT,
    expected_amount TEXT NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL,
    chain_id INTEGER,
    tx_hash TEXT,
    created INTEGER NOT NULL,
    expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deposit_sessions_pet ON deposit_sessions(pet_id, status);
CREATE INDEX IF NOT EXISTS deposit_sessions_address ON deposit_sessions(address);
CREATE TABLE IF NOT EXISTS deposits(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    pet_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    amount TEXT NOT NULL,
    credits INTEGER NOT NULL,
    created INTEGER NOT NULL,
    UNIQUE(chain_id, tx_hash, log_index));
CREATE TABLE IF NOT EXISTS credit_accounts(
    pet_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_type TEXT,
    ref_id TEXT,
    created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS credit_ledger_pet ON credit_ledger(pet_id, id);
"""


class EconomyError(Exception):
    """Base for economy errors that map to HTTP 4xx."""


class NotEnabled(EconomyError):
    pass


class UnknownSession(EconomyError):
    pass


class SessionExpired(EconomyError):
    pass


class InsufficientCredits(EconomyError):
    pass


class AddressPool:
    """Hands out configured deposit-session addresses not currently in use.

    Provisioned out-of-band (controller creates DepositSession clones on-chain);
    an address is free when it has no open session.
    """

    def __init__(self, db, addresses):
        self.db = db
        self.addresses = [a for a in addresses if a]

    def __call__(self, pet_id=None):
        busy = {
            r[0].lower()
            for r in self.db.execute("SELECT address FROM deposit_sessions WHERE status='open'")
        }
        for address in self.addresses:
            if address.lower() not in busy:
                return address
        raise EconomyError("no deposit address available")


def credits_from_wei(amount_wei, credits_per_frens=CREDITS_PER_FRENS):
    if amount_wei < 0:
        raise ValueError("amount must be >= 0")
    return (int(amount_wei) * credits_per_frens) // (10 ** FRENS_DECIMALS)


def wei_from_frens(frens):
    return int(frens) * (10 ** FRENS_DECIMALS)


class Economy:
    def __init__(self, db, now=time.time):
        self.db = db
        self.now = now
        self.db.executescript(SCHEMA)

    # -- packages ---------------------------------------------------------
    def packages(self):
        return [
            {"frens": f, "amountWei": str(wei_from_frens(f)), "credits": f * CREDITS_PER_FRENS}
            for f in PACKAGES
        ]

    # -- sessions ---------------------------------------------------------
    def open_session(self, pet_id, address, frens, token=None, chain_id=None, ttl=SESSION_TTL_SECONDS):
        if frens <= 0:
            raise ValueError("frens must be > 0")
        ts = self.now()
        self.db.execute(
            "UPDATE deposit_sessions SET status='expired' WHERE pet_id=? AND status='open'",
            (pet_id,),
        )
        session_id = secrets.token_hex(16)
        self.db.execute(
            "INSERT INTO deposit_sessions"
            "(id,pet_id,address,token,expected_amount,credits,status,chain_id,tx_hash,created,expires_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                session_id,
                pet_id,
                address,
                token,
                str(wei_from_frens(frens)),
                frens * CREDITS_PER_FRENS,
                "open",
                chain_id,
                None,
                ts,
                ts + ttl,
            ),
        )
        self.db.commit()
        return self.session(session_id)

    def session(self, session_id):
        row = self.db.execute(
            "SELECT id,pet_id,address,token,expected_amount,credits,status,chain_id,tx_hash,created,expires_at "
            "FROM deposit_sessions WHERE id=?",
            (session_id,),
        ).fetchone()
        if not row:
            raise UnknownSession("deposit session not found")
        return self._session_dict(row)

    def close_session(self, session_id, status="expired"):
        self.db.execute("UPDATE deposit_sessions SET status=? WHERE id=?", (status, session_id))
        self.db.commit()
        return self.session(session_id)

    def expire_stale(self):
        ts = self.now()
        cur = self.db.execute(
            "UPDATE deposit_sessions SET status='expired' WHERE status='open' AND expires_at<=?",
            (ts,),
        )
        self.db.commit()
        return cur.rowcount

    def open_session_for_address(self, address, chain_id=None):
        row = self.db.execute(
            "SELECT id,pet_id,address,token,expected_amount,credits,status,chain_id,tx_hash,created,expires_at "
            "FROM deposit_sessions WHERE address=? AND status='open' ORDER BY created DESC LIMIT 1",
            (address.lower(),),
        ).fetchone()
        return self._session_dict(row) if row else None

    # -- deposits ---------------------------------------------------------
    def _deposit(self, chain_id, tx_hash, log_index):
        return self.db.execute(
            "SELECT id FROM deposits WHERE chain_id=? AND tx_hash=? AND log_index=?",
            (int(chain_id), str(tx_hash).lower(), int(log_index)),
        ).fetchone()

    def confirm(self, session_id, tx_hash, amount_wei, chain_id, log_index=0, address=None):
        """Idempotently record a confirmed on-chain deposit and grant credits.

        A session is single-use: the first confirmation grants credits, replays of
        the same (chain_id, tx_hash, log_index) are no-ops, and a second distinct
        deposit against the same session is rejected.
        """
        ts = self.now()
        sess = self.session(session_id)

        if self._deposit(chain_id, tx_hash, log_index):
            return {"status": "duplicate", "sessionId": session_id, "credits": 0}

        if sess["status"] == "open" and sess["expiresAt"] <= ts:
            self.close_session(session_id, "expired")
            raise SessionExpired("deposit session expired")
        if sess["status"] != "open":
            raise SessionExpired("deposit session already used")
        if address is not None and sess["address"].lower() != str(address).lower():
            raise UnknownSession("address does not match session")
        if int(amount_wei) < int(sess["expectedAmount"]):
            raise EconomyError("deposit amount below expected")

        try:
            self.db.execute(
                "INSERT INTO deposits(session_id,pet_id,chain_id,tx_hash,log_index,amount,credits,created) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (
                    session_id,
                    sess["petId"],
                    int(chain_id),
                    str(tx_hash).lower(),
                    int(log_index),
                    str(amount_wei),
                    sess["credits"],
                    ts,
                ),
            )
        except sqlite3.IntegrityError:
            self.db.rollback()
            return {"status": "duplicate", "sessionId": session_id, "credits": 0}

        self.db.execute(
            "UPDATE deposit_sessions SET status='confirmed', tx_hash=?, chain_id=? WHERE id=?",
            (str(tx_hash).lower(), int(chain_id), session_id),
        )
        self._grant(
            sess["petId"],
            sess["credits"],
            reason="deposit",
            ref_type="deposit",
            ref_id=session_id,
        )
        self.db.commit()
        return {"status": "confirmed", "sessionId": session_id, "credits": sess["credits"]}

    # -- ledger -----------------------------------------------------------
    def balance(self, pet_id):
        row = self.db.execute("SELECT balance FROM credit_accounts WHERE pet_id=?", (pet_id,)).fetchone()
        return row[0] if row else 0

    def history(self, pet_id, limit=50):
        rows = self.db.execute(
            "SELECT delta,balance,reason,ref_type,ref_id,created FROM credit_ledger "
            "WHERE pet_id=? ORDER BY id DESC LIMIT ?",
            (pet_id, max(1, min(int(limit), 200))),
        ).fetchall()
        return [
            dict(delta=r[0], balance=r[1], reason=r[2], refType=r[3], refId=r[4], created=r[5])
            for r in rows
        ]

    def grant(self, pet_id, credits, reason="grant", ref_type=None, ref_id=None):
        if credits <= 0:
            raise ValueError("credits must be > 0")
        return self._grant(pet_id, credits, reason, ref_type, ref_id)

    def spend(self, pet_id, credits, reason="spend", ref_type=None, ref_id=None):
        if credits <= 0:
            raise ValueError("credits must be > 0")
        if self.balance(pet_id) < credits:
            raise InsufficientCredits("not enough credits")
        return self._grant(pet_id, -credits, reason, ref_type, ref_id)

    def _grant(self, pet_id, delta, reason, ref_type=None, ref_id=None):
        ts = self.now()
        row = self.db.execute("SELECT balance FROM credit_accounts WHERE pet_id=?", (pet_id,)).fetchone()
        balance = (row[0] if row else 0) + delta
        if balance < 0:
            raise InsufficientCredits("not enough credits")
        self.db.execute(
            "INSERT INTO credit_accounts(pet_id,balance,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(pet_id) DO UPDATE SET balance=excluded.balance, updated_at=excluded.updated_at",
            (pet_id, balance, ts),
        )
        self.db.execute(
            "INSERT INTO credit_ledger(pet_id,delta,balance,reason,ref_type,ref_id,created) VALUES(?,?,?,?,?,?,?)",
            (pet_id, delta, balance, reason, ref_type, ref_id, ts),
        )
        self.db.commit()
        return balance

    # -- helpers ----------------------------------------------------------
    @staticmethod
    def _session_dict(row):
        return dict(
            id=row[0],
            petId=row[1],
            address=row[2],
            token=row[3],
            expectedAmount=row[4],
            credits=row[5],
            status=row[6],
            chainId=row[7],
            txHash=row[8],
            created=row[9],
            expiresAt=row[10],
        )


def attach(app, db, *, token_pet, limit, settings, allocator=None, indexer_secret=None):
    """Register economy HTTP routes on the relay app.

    token_pet(token) -> pet_id  (raises ValueError on bad token)
    limit(key, max, seconds)    (raises ValueError when rate limited)
    settings()                  -> economy_settings() dict from app.py
    allocator(pet_id) -> address | (address, token)  on-chain session allocator
    """
    economy = Economy(db)

    def _require_enabled():
        s = settings()
        if not s.get("enabled"):
            raise NotEnabled("economy is not enabled on this server")
        return s

    def _pet(body):
        return token_pet(body.get("token"))

    async def deposits_open(request):
        try:
            _require_enabled()
            body = await request.json()
            pid = _pet(body)
            limit(("deposit-open", pid), 10, 3600)
            frens = int(body.get("package") or PACKAGES[0])
            if frens not in PACKAGES:
                return web.json_response({"error": "Unknown package"}, status=400)
            if allocator is None:
                return web.json_response({"error": "Deposit allocator not configured"}, status=503)
            allocated = allocator(pid)
            address, token = allocated if isinstance(allocated, (tuple, list)) else (allocated, None)
            s = _require_enabled()
            session = economy.open_session(pid, address, frens, token=token, chain_id=s.get("chainId"))
            return web.json_response(
                {
                    "depositId": session["id"],
                    "address": session["address"],
                    "token": s.get("frensToken"),
                    "chainId": s.get("chainId"),
                    "amountWei": session["expectedAmount"],
                    "credits": session["credits"],
                    "expiresAt": session["expiresAt"],
                }
            )
        except NotEnabled as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return web.json_response({"error": str(exc) or "Bad request"}, status=400)

    async def deposits_status(request):
        try:
            body = await request.json()
            pid = _pet(body)
            session = economy.session(body["depositId"])
            if session["petId"] != pid:
                return web.json_response({"error": "Not found"}, status=404)
            return web.json_response(
                {
                    "depositId": session["id"],
                    "status": session["status"],
                    "address": session["address"],
                    "amountWei": session["expectedAmount"],
                    "credits": session["credits"],
                    "expiresAt": session["expiresAt"],
                    "txHash": session["txHash"],
                }
            )
        except UnknownSession as exc:
            return web.json_response({"error": str(exc)}, status=404)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return web.json_response({"error": str(exc) or "Bad request"}, status=400)

    async def deposits_confirm(request):
        try:
            body = await request.json()
            if indexer_secret and request.headers.get("X-Indexer-Secret") != indexer_secret:
                return web.json_response({"error": "Forbidden"}, status=403)
            result = economy.confirm(
                body["depositId"],
                body["txHash"],
                int(body["amount"]),
                int(body.get("chainId") or settings().get("chainId")),
                int(body.get("logIndex") or 0),
                address=body.get("address"),
            )
            return web.json_response(result)
        except UnknownSession as exc:
            return web.json_response({"error": str(exc)}, status=404)
        except SessionExpired as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except (EconomyError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            return web.json_response({"error": str(exc) or "Bad request"}, status=400)

    async def credits_balance(request):
        try:
            body = await request.json()
            pid = _pet(body)
            return web.json_response({"balance": economy.balance(pid), "history": economy.history(pid, 20)})
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return web.json_response({"error": str(exc)}, status=400)

    app.router.add_post("/api/deposits/open", deposits_open)
    app.router.add_post("/api/deposits/status", deposits_status)
    app.router.add_post("/api/deposits/confirm", deposits_confirm)
    app.router.add_post("/api/credits/balance", credits_balance)
    return economy
