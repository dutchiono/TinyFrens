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

    // Each rectangle is seven bytes: x, y, width, height, RGB. Zero RGB uses the palette background.
    function _scene(bytes memory data, string memory bg) internal pure returns (string memory result) {
        for (uint256 i; i < data.length; i += 7) {
            uint256 rgb = (uint256(uint8(data[i + 4])) << 16)
                | (uint256(uint8(data[i + 5])) << 8) | uint256(uint8(data[i + 6]));
            string memory color = rgb == 0 ? bg : string.concat("#", LibString.toHexStringNoPrefix(rgb, 3));
            result = string.concat(result, _box(uint8(data[i]), uint8(data[i + 1]),
                uint8(data[i + 2]), uint8(data[i + 3]), color));
        }
    }

    function _habitat(uint8 habitat, string memory bg) internal pure returns (string memory) {
        if (habitat == 0) return _scene(hex"000040400000000031400f2830470031400269718d003b4001444a6508330108444a6530330108444a65183c0104444a6531080909f3e9b62f060808000000060e0202c4b7e90e070101c4b7e927050202c4b7e93b1c0101c4b7e90324080d22283d35270b0a22283d052702038b7cb4392a02038b7cb4", bg);
        if (habitat == 1) return _scene(hex"0000404000000000304010202d4201130a1d263652040f0704263652340b0c2526365203170304e8a0cc07200304e8a0cc3610030464d9db3b18030464d9db3621030464d9db003040029770ac03360903b9b2cf11360903b9b2cf1f360903b9b2cf2d360903b9b2cf3b360503b9b2cf043c0b015fa6b1313d0901c180ae03080e03e783b5", bg);
        if (habitat == 2) return _scene(hex"00004040000000002f4011305444002f400276a56d003b4005253e3602190916654a4600150d05aa747602150305f1d1aa08150305f1d1aa031e0607e9be7704200403dc80693626080981594a35250a02b38664381f020681bf7c351e040381bf7c391c040381bf7c3a1a0202f2a4bb07340302b0c67c34360302b0c67c0d3d07016b7753", bg);
        if (habitat == 3) return _scene(hex"00004040000000000040036b5b860303022e6b5b863b03022e6b5b8605053601a994bf051b36026b5b860c0502166b5b86310502166b5b86060f0d03e2cde4090d0602e2cde42a0a0f03e2cde42e080702e2cde40031400f55496800314002bca0c50039400180709009330106807090363301068070901e3a0106807090", bg);
        if (habitat == 4) return _scene(hex"000040400000000031400f30233f00314002bd729e01180a19211b3502190803efbb68031e0608639eae04200202a7f2dc022808029f70b404270201f4b6d435150a1c211b3536160803a284ed371b0609a56099381d0303f4c67836270802639eae39260201a7f2dc080830027753930d0c0802ef93bf2b0c08028de0dc06380801644369323b0801644369", bg);
        return _scene(hex"00004040000000002b4015416b55002c40047195630033400d33544400354001557953030c0c03ccbdce060a0602ccbdce2f070e03ccbdce33050602ccbdce0223050a294b40001e09075a84563620070d294b40331b0d085a8456083001059bb96c062f0502e7ba78082f0101ffe3ae373101059bb96c35300502db97b6063b030186a064303a040186a064", bg);
    }

    function _accessory(uint8 accessory, uint8) internal pure returns (string memory) {
        if (accessory == 0) return string.concat(_box(31, 12, 2, 6, "#302048"),
                _box(29, 10, 6, 3, "#f0bd5e"),
                _box(31, 9, 2, 1, "#ffe078"));
        if (accessory == 1) return string.concat(_box(23, 16, 18, 2, "#8c405f"),
                _box(25, 13, 14, 3, "#f16d8c"),
                _box(27, 10, 10, 3, "#f16d8c"),
                _box(29, 7, 6, 3, "#f16d8c"),
                _box(31, 5, 2, 2, "#ffe078"),
                _box(27, 14, 3, 2, "#ffe078"),
                _box(32, 10, 3, 2, "#ffe078"),
                _box(34, 14, 3, 2, "#c5acff"));
        if (accessory == 2) return string.concat(_box(22, 15, 20, 3, "#b47c32"),
                _box(23, 9, 4, 6, "#f5cb67"),
                _box(30, 7, 4, 8, "#f5cb67"),
                _box(37, 9, 4, 6, "#f5cb67"),
                _box(24, 15, 16, 2, "#ffe6a0"),
                _box(26, 15, 2, 2, "#c58cf0"),
                _box(31, 15, 2, 2, "#ed87a5"),
                _box(36, 15, 2, 2, "#84dbd3"));
        if (accessory == 3) return string.concat(_box(24, 9, 16, 2, "#b98d47"),
                _box(22, 11, 4, 2, "#fbe9aa"),
                _box(38, 11, 4, 2, "#fbe9aa"),
                _box(25, 13, 14, 2, "#fbe9aa"),
                _box(25, 8, 14, 1, "#fff5d0"));
        if (accessory == 4) return string.concat(_box(31, 12, 2, 6, "#302048"),
                _box(29, 10, 6, 3, "#f0bd5e"),
                _box(31, 9, 2, 1, "#ffe078"),
                _box(27, 41, 4, 3, "#ec6c7c"),
                _box(33, 41, 4, 3, "#ec6c7c"),
                _box(31, 42, 2, 2, "#f9d77d"));
        if (accessory == 5) return string.concat(_box(31, 12, 2, 6, "#302048"),
                _box(29, 10, 6, 3, "#f0bd5e"),
                _box(31, 9, 2, 1, "#ffe078"),
                _box(52, 33, 7, 7, "#327e9c"),
                _box(53, 34, 5, 5, "#69dce3"),
                _box(54, 34, 2, 2, "#ffffff"),
                _box(54, 41, 3, 1, "#458793"));
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
        string memory duration = traits.motion == 1 ? "0.72s" : traits.motion == 2 ? "1.6s" :
            traits.motion == 3 ? "0.56s" : "0.96s";
        string memory style = string.concat(
            '<style>.body{animation:bob ', duration, ' steps(1) infinite}',
            '.foot-a{animation:step-a ', duration, ' steps(1) infinite}',
            '.foot-b{animation:step-b ', duration, ' steps(1) infinite}',
            '.arm-a{animation:arm-a ', duration, ' steps(1) infinite}',
            '.arm-b{animation:arm-b ', duration, ' steps(1) infinite}',
            '@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}',
            '@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}',
            '@keyframes step-b{0%,100%{transform:translate(2px,0)}12.5%{transform:translate(1px,0)}25%{transform:translate(0,0)}37.5%{transform:translate(-1px,0)}50%{transform:translate(-1px,0)}62.5%{transform:translate(0,-1px)}75%{transform:translate(1px,-2px)}87.5%{transform:translate(2px,-1px)}}',
            '@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}',
            '@keyframes arm-b{0%,100%{transform:translate(-1px,0)}25%{transform:translate(1px,-1px)}50%{transform:translate(1px,0)}75%{transform:translate(-1px,1px)}}',
            '@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b{animation:none}}</style>'
        );
        string memory evolution = stage == 0 ? "" :
            string.concat(_box(4, 4, 2, 2, "#ffe078"), _box(57, 9, 2, 2, "#ffe078"));
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" shape-rendering="crispEdges" data-species="',
            uint256(traits.species).toString(), '">',
            style, _habitat(traits.habitat, bg), _eraMark(traits.era), _box(17, 50, 32, 2, "#17212d"),
            sprite, '<g class="body">', _accessory(traits.acc, traits.species), '</g>',
            evolution, '</svg>'
        );
    }
}
