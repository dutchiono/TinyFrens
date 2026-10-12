// Two bits per independently inherited environmental motion, separate from the walk.
export const ROBOT_MOTION_TRAITS = [
  { key: "cloud", label: "Cloud Drift", seconds: [8, 6, 4, 10], names: ["Easy", "Brisk", "Swift", "Lazy"] },
  { key: "stars", label: "Star Twinkle", seconds: [3, 2, 4, 5], names: ["Sparkling", "Lively", "Soft", "Dreamy"] },
  { key: "leaves", label: "Falling Leaves", seconds: [10, 8, 14, 6], names: ["Drifting", "Breezy", "Unhurried", "Playful"] },
  { key: "sway", label: "Foliage Sway", seconds: [6, 4, 8, 3], names: ["Gentle", "Breezy", "Calm", "Lively"] },
  { key: "light", label: "Light Cycle", seconds: [8, 6, 12, 4], names: ["Warm", "Rolling", "Lingering", "Shimmering"] },
  { key: "glow", label: "Neon Glow", seconds: [5, 3, 7, 4], names: ["Pulsing", "Lively", "Mellow", "Glowing"] },
  { key: "depth", label: "Layer Drift", seconds: [20, 16, 24, 12], names: ["Gentle", "Wandering", "Still Air", "Breezy"] },
  { key: "float", label: "Accessory Float", seconds: [4, 3, 6, 5], names: ["Buoyant", "Bobbing", "Dreamy", "Gentle"] },
];

export const robotAmbience = tokenId => (tokenId * 7919 + 104729) % 65536;

export function motionStyle(ambience = 0) {
  return `:root{${ROBOT_MOTION_TRAITS.map((t, i) => `--${t.key}:${t.seconds[(ambience >> (i * 2)) & 3]}s`).join(";")}}`;
}

export function motionAttributes(traits) {
  const habitat = traits.habitat, accessory = traits.acc;
  return ROBOT_MOTION_TRAITS.flatMap((t, i) => {
    const relevant = [habitat !== 4, habitat === 0, habitat === 2 || habitat === 5,
      habitat === 2 || habitat === 3 || habitat === 5, true,
      habitat === 1 || habitat === 3 || habitat === 4, true, accessory === 3 || accessory === 5][i];
    return relevant ? [[t.label, t.names[((traits.ambience || 0) >> (i * 2)) & 3]]] : [];
  });
}
