(() => {
  const hood = '0xca28587b61eac19a87dfcfd9420870867a916675';
  window.TinyFrensCompanionKey = nft => `${nft.chainId || 4663}:${String(nft.originalAddress || hood).toLowerCase()}:${nft.tokenId}`;
})();
