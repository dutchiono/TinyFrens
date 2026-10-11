'use strict';
function clampPosition(position, area, width, height) {
  return { x: Math.round(Math.max(area.x, Math.min(area.x + Math.max(0, area.width - width), position.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + Math.max(0, area.height - height), position.y))) };
}
function hits(point, bounds, regions) { return regions.some(r => point.x >= bounds.x + r.x && point.y >= bounds.y + r.y && point.x < bounds.x + r.x + r.width && point.y < bounds.y + r.y + r.height); }
module.exports = { clampPosition, hits };
