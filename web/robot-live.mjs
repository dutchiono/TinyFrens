export const CONTRACT = '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff';
export const RPC = 'https://mainnet.base.org';
export function decodeString(hex) {
  const data = hex.slice(2);
  const offset = Number(BigInt('0x' + data.slice(0, 64))) * 2;
  const length = Number(BigInt('0x' + data.slice(offset, offset + 64)));
  return new TextDecoder().decode(Uint8Array.from(data.slice(offset + 64, offset + 64 + length * 2).match(/../g) || [], b => parseInt(b, 16)));
}
export function decodeMetadata(uri) {
  const prefix = 'data:application/json;base64,';
  if (!uri.startsWith(prefix)) throw new Error('Unexpected metadata format');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.slice(prefix.length)), c => c.charCodeAt(0))));
}
export async function rpc(method, params, fetcher = fetch) {
  const response = await fetcher(RPC, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) {
    if (result.error.code === 3 && result.error.data?.toLowerCase() === '0xa14c4b50') return null;
    throw new Error(result.error.message || 'Base RPC request failed');
  }
  return result.result;
}
