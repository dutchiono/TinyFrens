// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibString} from "solady/utils/LibString.sol";
import {TinyFrensSprite} from "./TinyFrensSprite.sol";

struct Traits {
    uint8 species;
    uint8 palette;
    uint8 expr;
    uint8 acc;
    uint8 era;
    uint8 habitat;
    uint8 motion;
}

interface ITinyFrensArt {
    function render(Traits calldata traits, uint8 stage) external view returns (string memory);
}

contract TinyFrensArt is ITinyFrensArt {
    using LibString for uint256;

    TinyFrensSprite public immutable spriteRenderer;

    constructor(address spriteRenderer_) {
        require(spriteRenderer_.code.length > 0, "Missing sprite renderer");
        spriteRenderer = TinyFrensSprite(spriteRenderer_);
    }

    function _box(uint256 x, uint256 y, uint256 width, uint256 height, string memory color)
        internal pure returns (string memory)
    {
        return string.concat('<rect x="', x.toString(), '" y="', y.toString(), '" width="',
            width.toString(), '" height="', height.toString(), '" fill="', color, '"/>');
    }

    function _palette(uint8 palette) internal pure returns (string memory body, string memory ink, string memory bg) {
        if (palette == 0) return ("#a474f1", "#302048", "#17142a");
        if (palette == 1) return ("#66c7d2", "#183d4d", "#102c38");
        if (palette == 2) return ("#ffb95e", "#623b29", "#382a38");
        if (palette == 3) return ("#82eba1", "#24533f", "#193c3a");
        if (palette == 4) return ("#ff82a7", "#632b48", "#3b213b");
        if (palette == 5) return ("#4d96ff", "#263a6a", "#182d50");
        if (palette == 6) return ("#76638e", "#241d38", "#211c39");
        return ("#ffd700", "#6c421c", "#2d2238");
    }

    function _habitat(uint8 habitat, string memory bg) internal pure returns (string memory) {
        string memory scene = string.concat(_box(0, 0, 64, 64, bg), _box(0, 49, 64, 15, "#263446"));
        if (habitat == 0) {
            return string.concat(scene, _box(7, 9, 2, 2, "#f3e9b6"), _box(50, 16, 1, 1, "#f3e9b6"),
                _box(0, 50, 64, 2, "#536480"));
        }
        if (habitat == 1) {
            return string.concat(scene, _box(4, 9, 9, 21, "#1a314c"), _box(49, 7, 10, 25, "#203452"),
                _box(6, 13, 3, 3, "#f597b8"), _box(52, 11, 3, 3, "#69e5dc"),
                _box(2, 55, 14, 2, "#65d5cd"), _box(29, 55, 14, 2, "#65d5cd"));
        }
        if (habitat == 2) {
            return string.concat(scene, _box(0, 47, 64, 17, "#305444"), _box(5, 47, 3, 3, "#f5b258"),
                _box(54, 45, 3, 3, "#f597b8"), _box(7, 44, 1, 3, "#80cf83"),
                _box(55, 43, 1, 3, "#80cf83"));
        }
        if (habitat == 3) {
            return string.concat(scene, _box(5, 12, 15, 3, "#c4a2ce"), _box(39, 17, 16, 3, "#c4a2ce"),
                _box(9, 10, 7, 3, "#c4a2ce"), _box(44, 15, 7, 3, "#c4a2ce"),
                _box(0, 52, 64, 2, "#817197"));
        }
        if (habitat == 4) {
            return string.concat(scene, _box(4, 8, 11, 18, "#352944"), _box(49, 10, 10, 16, "#352944"),
                _box(6, 10, 7, 3, "#eebf60"), _box(51, 12, 6, 3, "#7bdde2"),
                _box(0, 54, 64, 2, "#a761a0"));
        }
        return string.concat(scene, _box(0, 48, 64, 16, "#3a6247"), _box(9, 43, 2, 5, "#94bc64"),
            _box(8, 42, 4, 2, "#eecb73"), _box(52, 44, 2, 4, "#94bc64"),
            _box(51, 43, 4, 2, "#ee92a7"));
    }

    function _accessory(uint8 accessory, uint8) internal pure returns (string memory) {
        uint256 top = 15;
        uint256 center = 32;
        if (accessory == 1) {
            return string.concat(_box(center - 5, top - 4, 10, 2, "#f16d72"),
                _box(center - 3, top - 8, 6, 4, "#f16d72"), _box(center - 1, top - 10, 2, 2, "#ffe078"));
        }
        if (accessory == 2) {
            return string.concat(_box(center - 6, top - 4, 12, 3, "#e6b84b"),
                _box(center - 5, top - 8, 2, 4, "#e6b84b"), _box(center - 1, top - 9, 2, 5, "#e6b84b"),
                _box(center + 3, top - 8, 2, 4, "#e6b84b"));
        }
        if (accessory == 3) {
            return string.concat(_box(center - 7, top - 8, 14, 2, "#fbe9aa"),
                _box(center - 7, top - 7, 2, 2, "#fbe9aa"), _box(center + 5, top - 7, 2, 2, "#fbe9aa"));
        }
        if (accessory == 4) {
            uint256 neck = 41;
            return string.concat(_box(center - 4, neck, 3, 3, "#ec6c7c"),
                _box(center + 1, neck, 3, 3, "#ec6c7c"), _box(center - 1, neck + 1, 2, 2, "#f9d77d"));
        }
        if (accessory == 5) {
            return string.concat(_box(49, 37, 5, 5, "#69dce3"), _box(50, 38, 2, 2, "#ffffff"));
        }
        return "";
    }

    function _eraMark(uint8 era) internal pure returns (string memory) {
        if (era == 0) return _box(3, 4, 2, 2, "#dc9979");
        if (era == 1) return string.concat(_box(3, 4, 2, 2, "#b9c5dc"), _box(7, 4, 2, 2, "#b9c5dc"));
        return string.concat(_box(3, 4, 2, 2, "#ffe078"), _box(7, 4, 2, 2, "#ffe078"),
            _box(11, 4, 2, 2, "#ffe078"));
    }

    function render(Traits calldata traits, uint8 stage) external view override returns (string memory) {
        (string memory body, string memory ink, string memory bg) = _palette(traits.palette);
        string memory sprite = spriteRenderer.render(traits.species, body, ink, traits.expr);
        string memory duration = traits.motion == 1 ? "0.48s" : traits.motion == 2 ? "1.1s" :
            traits.motion == 3 ? "0.4s" : "0.72s";
        string memory style = string.concat(
            '<style>.body{animation:bob ', duration, ' steps(1) infinite}',
            '.foot-a{animation:step-a ', duration, ' steps(1) infinite}',
            '.foot-b{animation:step-b ', duration, ' steps(1) infinite}',
            '.arm-a{animation:arm-a ', duration, ' steps(1) infinite}',
            '.arm-b{animation:arm-b ', duration, ' steps(1) infinite}',
            '@keyframes bob{0%,100%{transform:translateY(0)}25%,75%{transform:translateY(-1px)}50%{transform:translateY(-2px)}}',
            '@keyframes step-a{0%,100%{transform:translate(0,0)}25%{transform:translate(2px,-2px)}50%{transform:translate(0,0)}75%{transform:translate(-2px,0)}}',
            '@keyframes step-b{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,0)}50%{transform:translate(0,0)}75%{transform:translate(2px,-2px)}}',
            '@keyframes arm-a{0%,100%{transform:translate(0,0)}25%,75%{transform:translate(0,2px)}50%{transform:translate(-1px,0)}}',
            '@keyframes arm-b{0%,100%{transform:translate(0,2px)}25%,75%{transform:translate(0,0)}50%{transform:translate(1px,2px)}}',
            '@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b{animation:none}}</style>'
        );
        string memory evolution = stage == 0 ? "" :
            string.concat(_box(4, 4, 2, 2, "#ffe078"), _box(57, 9, 2, 2, "#ffe078"));
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" shape-rendering="crispEdges" data-species="',
            uint256(traits.species).toString(), '">',
            style, _habitat(traits.habitat, bg), _eraMark(traits.era), _box(17, 50, 32, 2, "#17212d"),
            '<g class="body">', sprite, _accessory(traits.acc, traits.species), '</g>',
            evolution, '</svg>'
        );
    }
}
