const fs = require('fs');
const path = require('path');
const solc = require('solc');

const root = path.resolve(__dirname, '..');

function findImports(importPath) {
  let resolvedPath;
  if (importPath.startsWith('@openzeppelin/contracts/')) {
    resolvedPath = path.join(root, 'lib', 'openzeppelin-contracts-upgradeable', 'lib', 'openzeppelin-contracts', 'contracts', importPath.replace('@openzeppelin/contracts/', ''));
  } else if (importPath.startsWith('@openzeppelin/contracts-upgradeable/')) {
    resolvedPath = path.join(root, 'lib', 'openzeppelin-contracts-upgradeable', 'contracts', importPath.replace('@openzeppelin/contracts-upgradeable/', ''));
  } else if (importPath.startsWith('solady/')) {
    resolvedPath = path.join(root, 'lib', 'solady', 'src', importPath.replace('solady/', ''));
  } else {
    resolvedPath = path.resolve(root, 'contracts', importPath);
  }

  if (fs.existsSync(resolvedPath)) {
    return { contents: fs.readFileSync(resolvedPath, 'utf8') };
  }
  return { error: `File not found: ${resolvedPath} (from ${importPath})` };
}

const contractSource = fs.readFileSync(path.join(root, 'contracts', 'economy', 'CollectionVote.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'CollectionVote.sol': {
      content: contractSource
    }
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode']
      }
    }
  }
};

console.log('Compiling CollectionVote.sol with solc 0.8.28...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  let hasFatal = false;
  for (const err of output.errors) {
    if (err.severity === 'error') {
      console.error('ERROR:', err.formattedMessage);
      hasFatal = true;
    } else {
      console.warn('WARN:', err.formattedMessage);
    }
  }
  if (hasFatal) process.exit(1);
}

const contract = output.contracts['CollectionVote.sol']['CollectionVote'];
console.log('Compilation SUCCESS!');
console.log('Bytecode size:', contract.evm.bytecode.object.length / 2, 'bytes');
console.log('Deployed bytecode size:', contract.evm.deployedBytecode.object.length / 2, 'bytes');
