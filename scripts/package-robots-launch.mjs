import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'web/robots-launch');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceSha = bytes => sha(bytes.toString('utf8').replaceAll('\r\n', '\n'));
const read = relative => readFileSync(path.join(root, relative));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
if (process.argv.includes('--check') || process.argv.includes('--check-files')) {
  const manifest = JSON.parse(read('web/robots-launch/manifest.json'));
  if (process.argv.includes('--check')) {
    for (const [file, digest] of Object.entries(manifest.sourceLfSha256)) {
      assert.equal(sourceSha(read(file)), digest, `Stale launch package: ${file}`);
    }
  }
  for (const [file, digest] of Object.entries(manifest.fileSha256)) {
    assert.equal(sha(readFileSync(path.join(folder, file))), digest, `Modified package: ${file}`);
  }
  console.log('Compiled launch package validation passed.');
} else {
  // Compile locally; Bankr receives these bytes, not a build instruction.
  execFileSync(process.env.FORGE_BIN || 'forge', ['build'], { cwd: root, stdio: 'inherit' });
  mkdirSync(folder, { recursive: true });
  const fileSha256 = {};
  const sourceLfSha256 = { 'foundry.toml': sourceSha(read('foundry.toml')) };
  const contracts = [];
  const emit = (file, content) => {
    writeFileSync(path.join(folder, file), content);
    fileSha256[file] = sha(content);
  };
  for (const name of ['TinyFrensSprite', 'TinyFrensArt', 'TinyFrensNFT']) {
    const artifact = JSON.parse(read(`out/${name}.sol/${name}.json`));
    assert.match(artifact.bytecode.object, /^0x(?:[0-9a-fA-F]{2})+$/, 'Unlinked bytecode');
    const constructor = artifact.abi.find(entry => entry.type === 'constructor');
    const initBytes = (artifact.bytecode.object.length - 2) / 2;
    const runtimeBytes = (artifact.deployedBytecode.object.length - 2) / 2;
    assert.ok(runtimeBytes <= 24000, `${name} runtime exceeds budget`);
    assert.ok(initBytes + (constructor?.inputs.length || 0) * 32 <= 49152, 'Initcode limit');
    assert.equal(artifact.metadata.compiler.version, '0.8.28+commit.7893614a');
    const sources = {};
    for (const file of Object.keys(artifact.metadata.sources)) {
      const content = read(file);
      sourceLfSha256[file] = sourceSha(content);
      sources[file] = { content: content.toString('utf8') };
    }
    const settings = { ...artifact.metadata.settings };
    delete settings.compilationTarget;
    settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } };
    emit(`${name}.bytecode.txt`, `${artifact.bytecode.object}\n`);
    emit(`${name}.abi.json`, json(artifact.abi));
    emit(`${name}.verification.json`, json({ language: 'Solidity', sources, settings }));
    contracts.push({ name, bytecodeFile: `${name}.bytecode.txt`, abiFile: `${name}.abi.json`,
      verificationFile: `${name}.verification.json`, constructor: constructor?.inputs || [], initBytes, runtimeBytes });
  }
  writeFileSync(path.join(folder, 'manifest.json'), json({
    collection: 'tinyfrens-robots-v1', status: 'compiled; not deployed; Bankr execution unverified',
    compiler: '0.8.28+commit.7893614a', optimizerRuns: 200, viaIR: true, evmVersion: 'cancun',
    sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    provenance: 'Exact compiled source bytes are embedded in verification files. sourceLfSha256 normalizes CRLF to LF for cross-platform freshness checks; fileSha256 hashes exact package bytes. Base commit may precede this package commit.',
    chain: { name: 'Base', chainId: 8453 },
    creator: 'Authenticated owner wallet; explicit second argument to TinyFrensNFT. Never the CREATE2 factory.',
    nativeValueForAllDeployments: '0',
    contracts, sourceLfSha256, fileSha256,
  }));
  console.log('Packaged three compiled contracts for Bankr Files. No transactions submitted.');
}
