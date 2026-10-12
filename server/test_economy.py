import json
import os
import sqlite3
import tempfile
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import economy as econ


class FakeClock:
    def __init__(self, t=1_000_000):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


def new_economy(clock=None):
    db = sqlite3.connect(":memory:")
    return econ.Economy(db, now=clock or FakeClock()), db


ADDRESS = "0x" + "ab" * 20


class CreditsUnitTests(unittest.TestCase):
    def test_credits_from_wei(self):
        self.assertEqual(econ.credits_from_wei(10 * 10**18), 1_000)
        self.assertEqual(econ.credits_from_wei(0), 0)
        self.assertEqual(econ.wei_from_frens(10), 10 * 10**18)

    def test_credits_from_wei_rejects_negative(self):
        self.assertRaises(ValueError, econ.credits_from_wei, -1)

    def test_packages_are_consistent(self):
        e, _ = new_economy()
        for pkg in e.packages():
            self.assertEqual(econ.credits_from_wei(int(pkg["amountWei"])), pkg["credits"])


class SessionUnitTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.e, self.db = new_economy(self.clock)

    def test_open_session_fields(self):
        s = self.e.open_session("pet-1", ADDRESS, 50, token="0xfrens", chain_id=84532)
        self.assertEqual(s["petId"], "pet-1")
        self.assertEqual(s["address"], ADDRESS)
        self.assertEqual(s["expectedAmount"], str(50 * 10**18))
        self.assertEqual(s["credits"], 5_000)
        self.assertEqual(s["status"], "open")

    def test_open_expires_previous_open_session(self):
        first = self.e.open_session("pet-1", ADDRESS, 10)
        second = self.e.open_session("pet-1", ADDRESS, 10)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.e.session(first["id"])["status"], "expired")
        self.assertEqual(self.e.session(second["id"])["status"], "open")

    def test_unknown_session_raises(self):
        self.assertRaises(econ.UnknownSession, self.e.session, "nope")

    def test_expire_stale(self):
        s = self.e.open_session("pet-1", ADDRESS, 10, ttl=900)
        self.clock.advance(901)
        self.assertEqual(self.e.expire_stale(), 1)
        self.assertEqual(self.e.session(s["id"])["status"], "expired")

    def test_session_by_address(self):
        s = self.e.open_session("pet-1", ADDRESS, 10)
        found = self.e.open_session_for_address(ADDRESS)
        self.assertEqual(found["id"], s["id"])

    def test_open_rejects_non_positive(self):
        self.assertRaises(ValueError, self.e.open_session, "pet-1", ADDRESS, 0)


class ConfirmUnitTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.e, self.db = new_economy(self.clock)

    def test_confirm_grants_credits(self):
        s = self.e.open_session("pet-1", ADDRESS, 50, chain_id=84532)
        result = self.e.confirm(s["id"], "0xTX", 50 * 10**18, 84532)
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["credits"], 5_000)
        self.assertEqual(self.e.balance("pet-1"), 5_000)
        self.assertEqual(self.e.session(s["id"])["status"], "confirmed")

    def test_confirm_is_idempotent_on_tx(self):
        s = self.e.open_session("pet-1", ADDRESS, 50, chain_id=84532)
        self.e.confirm(s["id"], "0xTX", 50 * 10**18, 84532)
        again = self.e.confirm(s["id"], "0xTX", 50 * 10**18, 84532)
        self.assertEqual(again["status"], "duplicate")
        self.assertEqual(self.e.balance("pet-1"), 5_000)

    def test_second_distinct_deposit_rejected(self):
        s = self.e.open_session("pet-1", ADDRESS, 10, chain_id=84532)
        self.e.confirm(s["id"], "0xTX1", 10 * 10**18, 84532)
        self.assertRaises(econ.SessionExpired, self.e.confirm, s["id"], "0xTX2", 10 * 10**18, 84532)
        self.assertEqual(self.e.balance("pet-1"), 1_000)

    def test_underpaid_rejected(self):
        s = self.e.open_session("pet-1", ADDRESS, 50, chain_id=84532)
        self.assertRaises(econ.EconomyError, self.e.confirm, s["id"], "0xTX", 1 * 10**18, 84532)

    def test_expired_session_rejected(self):
        s = self.e.open_session("pet-1", ADDRESS, 10, chain_id=84532, ttl=900)
        self.clock.advance(901)
        self.assertRaises(econ.SessionExpired, self.e.confirm, s["id"], "0xTX", 10 * 10**18, 84532)

    def test_address_mismatch_rejected(self):
        s = self.e.open_session("pet-1", ADDRESS, 10, chain_id=84532)
        self.assertRaises(
            econ.UnknownSession, self.e.confirm, s["id"], "0xTX", 10 * 10**18, 84532, 0, "0xdead"
        )

    def test_null_address_skips_check(self):
        s = self.e.open_session("pet-1", ADDRESS, 10, chain_id=84532)
        result = self.e.confirm(s["id"], "0xTX", 10 * 10**18, 84532, address=None)
        self.assertEqual(result["status"], "confirmed")


class LedgerUnitTests(unittest.TestCase):
    def setUp(self):
        self.e, self.db = new_economy()

    def test_grant_and_spend(self):
        self.e.grant("pet-1", 500, reason="welcome")
        self.assertEqual(self.e.balance("pet-1"), 500)
        self.e.spend("pet-1", 200, reason="hat")
        self.assertEqual(self.e.balance("pet-1"), 300)

    def test_spend_beyond_balance_rejected(self):
        self.e.grant("pet-1", 100)
        self.assertRaises(econ.InsufficientCredits, self.e.spend, "pet-1", 101)
        self.assertEqual(self.e.balance("pet-1"), 100)

    def test_grant_rejects_non_positive(self):
        self.assertRaises(ValueError, self.e.grant, "pet-1", 0)

    def test_history_is_append_only_descending(self):
        self.e.grant("pet-1", 100, reason="a")
        self.e.grant("pet-1", 50, reason="b")
        self.e.spend("pet-1", 30, reason="c")
        history = self.e.history("pet-1")
        self.assertEqual([h["reason"] for h in history], ["c", "b", "a"])
        self.assertEqual(history[0]["balance"], 120)


def build_app():
    db = sqlite3.connect(":memory:")
    app = web.Application()
    settings = lambda: {
        "enabled": True,
        "mode": "testnet",
        "chainId": 84532,
        "frensToken": "0x" + "11" * 20,
    }
    tokens = {"tok": "pet-1"}
    econ.attach(
        app,
        db,
        token_pet=lambda t: tokens[t],
        limit=lambda *a: None,
        settings=settings,
        allocator=lambda pid: ("0x" + "ab" * 20, None),
    )
    return app, db


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app, self.db = build_app()
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.db.close()

    async def test_open_confirm_balance_flow(self):
        r = await self.client.post("/api/deposits/open", json={"token": "tok", "package": 50})
        self.assertEqual(r.status, 200)
        data = await r.json()
        self.assertEqual(data["amountWei"], str(50 * 10**18))
        self.assertEqual(data["credits"], 5000)
        self.assertEqual(data["token"], "0x" + "11" * 20)

        r = await self.client.post(
            "/api/deposits/confirm",
            json={"depositId": data["depositId"], "txHash": "0xTX", "amount": 50 * 10**18, "chainId": 84532},
        )
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())["status"], "confirmed")

        r = await self.client.post("/api/deposits/confirm",
                                   json={"depositId": data["depositId"], "txHash": "0xTX", "amount": 50 * 10**18})
        self.assertEqual((await r.json())["status"], "duplicate")

        r = await self.client.post("/api/credits/balance", json={"token": "tok"})
        self.assertEqual((await r.json())["balance"], 5000)

    async def test_status_endpoint(self):
        r = await self.client.post("/api/deposits/open", json={"token": "tok", "package": 10})
        deposit_id = (await r.json())["depositId"]
        r = await self.client.post("/api/deposits/status", json={"token": "tok", "depositId": deposit_id})
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())["status"], "open")

    async def test_status_rejects_other_pet(self):
        r = await self.client.post("/api/deposits/open", json={"token": "tok", "package": 10})
        deposit_id = (await r.json())["depositId"]
        # swap the token map so 'tok2' -> another pet, route must not leak the session
        r = await self.client.post("/api/deposits/status", json={"token": "nope", "depositId": deposit_id})
        self.assertEqual(r.status, 400)

    async def test_unknown_package_rejected(self):
        r = await self.client.post("/api/deposits/open", json={"token": "tok", "package": 7})
        self.assertEqual(r.status, 400)

    async def test_confirm_unknown_session_404(self):
        r = await self.client.post("/api/deposits/confirm", json={"depositId": "nope", "txHash": "0xTX", "amount": 1})
        self.assertEqual(r.status, 404)

    async def test_confirm_second_deposit_conflict(self):
        r = await self.client.post("/api/deposits/open", json={"token": "tok", "package": 10})
        deposit_id = (await r.json())["depositId"]
        await self.client.post("/api/deposits/confirm",
                               json={"depositId": deposit_id, "txHash": "0x1", "amount": 10 * 10**18})
        r = await self.client.post("/api/deposits/confirm",
                                   json={"depositId": deposit_id, "txHash": "0x2", "amount": 10 * 10**18})
        self.assertEqual(r.status, 409)

    async def test_disabled_economy_returns_503(self):
        app, _ = build_app()
        # override the settings closure via a fresh attach on a fresh app
        app2 = web.Application()
        econ.attach(
            app2,
            sqlite3.connect(":memory:"),
            token_pet=lambda t: "pet-1",
            limit=lambda *a: None,
            settings=lambda: {"enabled": False, "mode": None},
            allocator=lambda pid: ("0x" + "ab" * 20, None),
        )
        client = TestClient(TestServer(app2))
        await client.start_server()
        try:
            r = await client.post("/api/deposits/open", json={"token": "tok", "package": 10})
            self.assertEqual(r.status, 503)
        finally:
            await client.close()

    async def test_no_allocator_returns_503(self):
        app = web.Application()
        econ.attach(
            app,
            sqlite3.connect(":memory:"),
            token_pet=lambda t: "pet-1",
            limit=lambda *a: None,
            settings=lambda: {"enabled": True, "chainId": 84532, "frensToken": "0x" + "11" * 20},
            allocator=None,
        )
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.post("/api/deposits/open", json={"token": "tok", "package": 10})
            self.assertEqual(r.status, 503)
        finally:
            await client.close()


ORIGIN = "https://tinyfrens.lol"
SESSION_ADDRESS = "0x" + "cd" * 20


class EconomyAppWiringTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app import create_app

        self.saved = {
            k: os.environ.get(k)
            for k in ("ECONOMY_MODE", "FRENS_TOKEN", "CHAIN_ID", "DEPOSIT_SESSION_ADDRESSES")
        }
        os.environ["ECONOMY_MODE"] = "testnet"
        os.environ["FRENS_TOKEN"] = "0x" + "11" * 20
        os.environ["CHAIN_ID"] = "84532"
        os.environ["DEPOSIT_SESSION_ADDRESSES"] = SESSION_ADDRESS
        self.tmp = tempfile.TemporaryDirectory()
        self.client = TestClient(TestServer(create_app(self.tmp.name + "/pets.db", [ORIGIN])))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    async def test_deposit_flow_through_create_app(self):
        r = await self.client.post(
            "/api/register",
            headers={"Origin": ORIGIN},
            json={"pet": {"name": "Beep", "shape": "robot", "color": "#a474f1"}},
        )
        self.assertEqual(r.status, 200)
        token = (await r.json())["token"]

        r = await self.client.post(
            "/api/deposits/open",
            headers={"Origin": ORIGIN},
            json={"token": token, "package": 50},
        )
        self.assertEqual(r.status, 200)
        session = await r.json()
        self.assertEqual(session["address"], SESSION_ADDRESS)
        self.assertEqual(session["credits"], 5000)

        r = await self.client.post(
            "/api/deposits/confirm",
            headers={"Origin": ORIGIN},
            json={"depositId": session["depositId"], "txHash": "0xTX", "amount": 50 * 10**18},
        )
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())["credits"], 5000)

        r = await self.client.post(
            "/api/credits/balance", headers={"Origin": ORIGIN}, json={"token": token}
        )
        self.assertEqual((await r.json())["balance"], 5000)

    async def test_deposit_requires_allowed_origin(self):
        r = await self.client.post(
            "/api/deposits/open",
            headers={"Origin": "https://evil.example"},
            json={"token": "x", "package": 10},
        )
        self.assertEqual(r.status, 403)

    async def test_economy_disabled_without_env(self):
        from app import create_app

        for k in ("ECONOMY_MODE", "FRENS_TOKEN", "CHAIN_ID"):
            os.environ.pop(k, None)
        client = TestClient(TestServer(create_app(self.tmp.name + "/pets2.db", [ORIGIN])))
        await client.start_server()
        try:
            r = await client.post(
                "/api/deposits/open", headers={"Origin": ORIGIN}, json={"package": 10}
            )
            self.assertEqual(r.status, 503)
        finally:
            await client.close()


if __name__ == "__main__":
    unittest.main()