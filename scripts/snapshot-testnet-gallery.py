"""Export minted TinyFrens from Base Sepolia, verifying their Net Storage metadata."""
import base64
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from eth_abi import decode, encode
from eth_utils import keccak

ROOT = Path(__file__).resolve().parents[1]
RPC = 'https://sepolia.base.org'
NFT = '0x695a9a01C4e4659327bBb4f157E5c08F05bDde2e'
STORAGE = '0x00000000DB40fcB9f4466330982372e27Fd7Bbf5'


def rpc(method, params):
    request = Request(RPC, json.dumps(dict(jsonrpc='2.0', id=1, method=method, params=params)).encode(),
                      {'Content-Type': 'application/json', 'User-Agent': 'TinyFrens-Testnet-Inspector/1.0'})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result['result']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipts', type=Path, help='Optional directory containing testnet-mint19-receipt-*.json')
    args = parser.parse_args()
    mint_transactions = {}
    if args.receipts:
        for path in args.receipts.glob('testnet-mint19-receipt-*.json'):
            receipt = json.loads(path.read_text(encoding='utf-8-sig'))
            if receipt['status'] != '0x1':
                raise RuntimeError(f'Unsuccessful receipt: {path.name}')
            for log in receipt['logs']:
                if (log['address'].lower() == NFT.lower() and
                    log['topics'][0] == '0x' + keccak(text='Transfer(address,address,uint256)').hex() and
                    int(log['topics'][1], 16) == 0):
                    mint_transactions[int(log['topics'][3], 16)] = receipt['transactionHash']
    assert int(rpc('eth_chainId', []), 16) == 84532, 'Wrong chain'
    block = rpc('eth_blockNumber', [])

    def call(address, signature, types=(), args=(), outputs=('uint256',)):
        data = keccak(text=signature)[:4] + encode(types, args)
        result = rpc('eth_call', [dict(to=address, data='0x' + data.hex()), block])
        return decode(outputs, bytes.fromhex(result[2:]))

    count, = call(NFT, 'totalSupply()')
    if not 0 < count <= 100:
        raise RuntimeError('Inspection export is limited to 100 minted tokens')
    tokens = []
    for token_id in range(1, count + 1):
        uri, = call(NFT, 'tokenURI(uint256)', ['uint256'], [token_id], ['string'])
        owner, = call(NFT, 'ownerOf(uint256)', ['uint256'], [token_id], ['address'])
        key = keccak(b'tinyfrens.tokenURI' + bytes.fromhex(NFT[2:]) + token_id.to_bytes(32, 'big'))
        _, stored = call(STORAGE, 'get(bytes32,address)', ['bytes32', 'address'], [key, NFT], ['string', 'bytes'])
        if stored.decode() != uri:
            raise RuntimeError(f'Token {token_id}: Net Storage does not match tokenURI')
        if not uri.startswith('data:application/json;base64,'):
            raise RuntimeError(f'Token {token_id}: unsupported metadata encoding')
        metadata = json.loads(base64.b64decode(uri.split(',', 1)[1]))
        if not metadata.get('image', '').startswith('data:image/svg+xml;base64,'):
            raise RuntimeError(f'Token {token_id}: embedded SVG missing')
        tokens.append(dict(id=token_id, owner=owner, storageKey='0x' + key.hex(), metadata=metadata,
                           mintTransaction=mint_transactions.get(token_id)))
    snapshot = dict(chainId=84532, network='Base Sepolia', collection=NFT, storage=STORAGE,
                    block=int(block, 16), capturedAt=datetime.now(timezone.utc).isoformat(), tokens=tokens)
    (ROOT / 'web/testnet-gallery.json').write_text(json.dumps(snapshot, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(tokens)} real NFTs at block {int(block, 16)}; all Net Storage values match.')


if __name__ == '__main__':
    main()
