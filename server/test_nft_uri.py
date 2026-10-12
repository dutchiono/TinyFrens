"""NFT viewer tests: /api/nft/uri against a real deployed collection, and static web/ serving.

Spins up an anvil devnet, deploys TinyFrensNFT with the testnet script, then drives the real
aiohttp app so the gallery's on-chain path (endpoint + static page) is exercised end to end.
"""
import asyncio
import os
import re
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

REPO = Path(__file__).resolve().parent.parent
TOOLS = REPO / ".tools" / "foundry"
ANVIL = TOOLS / "anvil.exe"
FORGE = TOOLS / "forge.exe"
KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
CHAIN_ID = 84532


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _grab(output, key):
    match = re.search(rf"^\s*{re.escape(key)}\s+(0x[a-fA-F0-9]{{40}})", output, re.MULTILINE)
    if not match:
        raise AssertionError(f"could not parse {key} from forge output:\n{output}")
    return match.group(1)


@unittest.skipUnless(ANVIL.exists() and FORGE.exists(), "repo-local foundry toolchain not present")
class NftUriIntegrationTests(unittest.IsolatedAsyncioTestCase):
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

        # Configure the relay to read the collection from this devnet, then start the real app.
        self._db = os.path.join(tempfile.gettempdir(), f"tf-nfturi-{self.port}.db")
        self._prev = {
            k: os.environ.get(k)
            for k in ("BASE_RPC_URL", "TINYFRENS_NFT_ADDRESS", "CHAIN_ID", "DB_PATH")
        }
        os.environ["BASE_RPC_URL"] = self.url
        os.environ["TINYFRENS_NFT_ADDRESS"] = self.nft
        os.environ["CHAIN_ID"] = str(CHAIN_ID)
        os.environ["DB_PATH"] = self._db
        import app as app_module

        self.client = TestClient(TestServer(app_module.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        try:
            os.remove(self._db)
        except OSError:
            pass
        self.anvil.terminate()
        try:
            self.anvil.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.anvil.kill()

    async def _wait_rpc(self, attempts=40):
        from aiohttp import ClientSession

        for _ in range(attempts):
            try:
                async with ClientSession() as session:
                    async with session.post(
                        self.url, json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}
                    ) as response:
                        await response.json(content_type=None)
                return
            except Exception:
                await asyncio.sleep(0.25)
        raise AssertionError("anvil did not come up")

    def _deploy(self):
        proc = subprocess.run(
            [
                str(FORGE),
                "script",
                "contracts/testnet/script/DeployTinyFrensNFT.s.sol:DeployTinyFrensNFT",
                "--rpc-url",
                self.url,
                "--broadcast",
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            env={**os.environ, "PRIVATE_KEY": KEY},
        )
        if proc.returncode != 0:
            raise AssertionError(proc.stdout + proc.stderr)
        self.nft = _grab(proc.stdout, "nftAddress")

    async def test_minted_and_unminted_token_uri(self):
        response = await self.client.get("/api/nft/uri?tokenId=1")
        self.assertEqual(response.status, 200)
        data = await response.json()
        self.assertTrue(data["minted"])
        self.assertTrue(data["uri"].startswith("data:application/json"))
        self.assertEqual(data["collection"]["address"], self.nft)

        unminted = await self.client.get("/api/nft/uri?tokenId=888")
        self.assertEqual(unminted.status, 200)
        self.assertFalse((await unminted.json())["minted"])

    async def test_gallery_static_assets_served(self):
        page = await self.client.get("/web/gallery.html")
        self.assertEqual(page.status, 200)
        body = await page.text()
        self.assertIn("TinyFrens", body)
        self.assertIn("gallery.js", body)

        script = await self.client.get("/web/gallery.js")
        self.assertEqual(script.status, 200)
        self.assertIn("/api/nft/uri", await script.text())


if __name__ == "__main__":
    unittest.main()
