// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibString} from "solady/utils/LibString.sol";

contract TinyFrensSprite {
    using LibString for uint256;

    // Fixed CSS lives beside sprite data to leave room for packed scene artwork.
    function sceneryStyle() external pure returns (string memory) {
        return '.camera{transform-origin:64px 96px;animation:depth 20s steps(4) infinite alternate}.parallax{animation:parallax 20s steps(4) infinite alternate}.light{animation:lighting 8s steps(4) infinite alternate}.sheen{animation:shade 8s steps(4) infinite alternate}.drift{animation:breeze 12s steps(10) infinite alternate}.twinkle{animation:sparkle 4s steps(3) infinite alternate}.glow{animation:glimmer 5s steps(4) infinite alternate}.sway{animation:sway 7s steps(4) infinite alternate}.leaf{animation:fall 14s steps(14) infinite}.shadow{animation:shade 6s steps(6) infinite alternate}.late{animation-delay:-7s}@keyframes depth{from{transform:scale(1)}to{transform:scale(1.025)}}@keyframes parallax{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes lighting{from{opacity:.02}to{opacity:.18}}@keyframes breeze{from{transform:translateX(-5px)}to{transform:translateX(5px)}}@keyframes sparkle{from{opacity:.3}to{opacity:1}}@keyframes glimmer{from{opacity:.35}to{opacity:1}}@keyframes sway{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes fall{0%{transform:translate(-3px,-3px);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(4px,18px);opacity:0}}@keyframes shade{from{opacity:.65}to{opacity:1}}';
    }

    function _box(uint256 x, uint256 y, uint256 width, uint256 height, string memory color)
        internal pure returns (string memory)
    {
        width = (x + width) * 3 / 2 - x * 3 / 2;
        height = (y + height) * 3 / 2 - y * 3 / 2;
        x = x * 3 / 2;
        y = y * 3 / 2;
        return string.concat('<path fill="', color, '" d="M', x.toString(), ' ', y.toString(),
            'h', width.toString(), 'v', height.toString(), 'H', x.toString(), 'z"/>');
    }

    function _eyes(uint8 expression, uint256 left, uint256 right, uint256 y, string memory ink)
        internal pure returns (string memory)
    {
        if (expression == 1) return string.concat(_box(left, y, 2, 3, ink), _box(right, y + 2, 3, 1, ink));
        if (expression == 2) return string.concat(_box(left - 1, y, 6, 3, "#10141e"),
            _box(right - 1, y, 6, 3, "#10141e"), _box(left + 1, y, 2, 1, "#9be7e6"));
        if (expression == 3) return string.concat(_box(left, y, 3, 3, "#ffe078"),
            _box(right, y, 3, 3, "#ffe078"), _box(left + 1, y + 1, 1, 1, ink),
            _box(right + 1, y + 1, 1, 1, ink));
        return string.concat(_box(left, y, 2, 3, ink), _box(right, y, 2, 3, ink),
            _box(left, y, 1, 1, "#ffffff"), _box(right, y, 1, 1, "#ffffff"));
    }

    function _feet(uint8 species, string memory ink, string memory body) internal pure returns (string memory) {
        uint256 left = species == 3 ? 23 : 21;
        uint256 y = species == 2 ? 46 : 45;
        return string.concat(
            '<g class="foot-a">', _box(left, y, 6, 6, ink), _box(left + 1, y, 4, 4, body), '</g>',
            '<g class="foot-b">', _box(38, y, 6, 6, ink), _box(39, y, 4, 4, body), '</g>'
        );
    }

    function _cat(string memory body, string memory ink, uint8 expression) internal pure returns (string memory) {
        return string.concat(
            _box(45, 35, 5, 3, ink), _box(48, 31, 3, 5, ink), _box(47, 28, 3, 4, ink),
            _box(16, 15, 7, 12, ink), _box(39, 15, 7, 12, ink),
            _box(18, 17, 4, 9, body), _box(40, 17, 4, 9, body),
            _box(19, 20, 2, 4, "#f6a3b3"), _box(41, 20, 2, 4, "#f6a3b3"),
            _box(17, 25, 29, 20, ink), _box(19, 27, 25, 15, body),
            _box(23, 38, 17, 6, "#f5d8bd"), _eyes(expression, 24, 37, 31, ink),
            _box(30, 38, 3, 2, ink), _box(12, 38, 8, 1, ink), _box(43, 38, 8, 1, ink),
            _box(13, 41, 7, 1, ink), _box(43, 41, 7, 1, ink), _feet(0, ink, body)
        );
    }

    function _robot(string memory body, string memory ink, uint8 expression) internal pure returns (string memory) {
        return string.concat(
            '<g class="body">',
            _box(17, 18, 30, 24, ink), _box(19, 20, 26, 20, body),
            '<g class="sheen">', _box(20, 20, 23, 1, "#d5e5eb"), _box(19, 21, 1, 16, "#b9c6e4"), '</g>',
            _box(43, 22, 2, 18, ink), _box(21, 21, 1, 1, ink), _box(42, 21, 1, 1, ink),
            _box(16, 24, 3, 8, "#6bdce3"), _box(45, 24, 3, 8, "#6bdce3"),
            _box(22, 23, 20, 12, "#192a41"), _eyes(expression, 26, 36, 27, "#79e3e3"),
            _box(23, 33, 3, 1, "#80c9ab"), _box(28, 33, 2, 1, "#f0bd5e"),
            _box(25, 36, 14, 2, ink), _box(30, 36, 4, 1, "#f0bd5e"),
            _box(21, 41, 22, 4, ink), _box(23, 41, 18, 2, "#2b4767"),
            '<g class="arm-a">', _box(12, 27, 5, 11, ink), _box(13, 30, 3, 6, body), _box(11, 38, 5, 3, "#f0bd5e"), '</g>',
            '<g class="arm-b">', _box(47, 27, 5, 11, ink), _box(48, 30, 3, 6, body), _box(48, 38, 5, 3, "#f0bd5e"), '</g>',
            '</g>', _feet(1, ink, body)
        );
    }

    function _frog(string memory body, string memory ink, uint8 expression) internal pure returns (string memory) {
        return string.concat(
            _box(16, 17, 11, 12, ink), _box(37, 17, 11, 12, ink),
            _box(18, 19, 7, 8, body), _box(39, 19, 7, 8, body),
            _box(16, 26, 32, 20, ink), _box(18, 28, 28, 15, body),
            _box(22, 38, 20, 6, "#d0e5a5"), _eyes(expression, 21, 41, 22, ink),
            _box(22, 35, 3, 2, ink), _box(39, 35, 3, 2, ink),
            _box(25, 38, 14, 1, ink), _box(19, 39, 2, 2, "#f3a19c"),
            _box(43, 39, 2, 2, "#f3a19c"), _feet(2, ink, body)
        );
    }

    function _turtle(string memory body, string memory ink, uint8 expression) internal pure returns (string memory) {
        return string.concat(
            _box(12, 36, 6, 3, ink), _box(15, 39, 5, 2, ink),
            _box(17, 28, 30, 19, ink), _box(20, 25, 23, 4, ink),
            _box(20, 29, 25, 15, body), _box(25, 26, 15, 3, body),
            _box(29, 30, 3, 13, ink), _box(21, 36, 23, 2, ink),
            _box(23, 31, 4, 3, "#f1d48f"), _box(35, 31, 4, 3, "#f1d48f"),
            _box(46, 31, 11, 13, ink), _box(48, 29, 7, 3, ink),
            _box(48, 33, 9, 9, "#91d890"), _box(54, 36, 6, 5, "#91d890"),
            _box(55, 41, 5, 2, ink), _eyes(expression, 52, 57, 34, ink),
            _feet(3, ink, "#91d890")
        );
    }

    function render(uint8, string calldata body, string calldata ink, uint8 expression)
        external pure returns (string memory)
    {
        return _robot(body, ink, expression);
    }
}
