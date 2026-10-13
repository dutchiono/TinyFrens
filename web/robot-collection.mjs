// Identity of the next launch, separate from historical testnet deployments.
export const ROBOT_COLLECTION = Object.freeze({
  id: "tinyfrens-robots-v1",
  name: "TinyFrens: Robots v1",
  symbol: "TFROB1",
  series: "Robots",
  version: 1,
  tokenPrefix: "TinyFrens Robot v1 #",
  description: "TinyFrens: Robots v1. An on-chain robot companion collection with animated pixel artwork.",
});

export const robotTokenName = tokenId => `${ROBOT_COLLECTION.tokenPrefix}${tokenId}`;
