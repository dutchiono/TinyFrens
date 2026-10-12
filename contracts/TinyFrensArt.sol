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
        width = (x + width) * 3 / 2 - x * 3 / 2;
        height = (y + height) * 3 / 2 - y * 3 / 2;
        x = x * 3 / 2;
        y = y * 3 / 2;
        return string.concat('<path fill="', color, '" d="M', x.toString(), ' ', y.toString(),
            'h', width.toString(), 'v', height.toString(), 'H', x.toString(), 'z"/>');
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

    // Seven bytes per tile: x, y, width, height, RGB. Consecutive fills share an SVG path.
    function _scene(bytes memory data, string memory bg) internal pure returns (string memory result) {
        uint256 previous = type(uint256).max;
        string memory path;
        string memory color;
        for (uint256 i; i < data.length; i += 7) {
            uint256 rgb = (uint256(uint8(data[i + 4])) << 16)
                | (uint256(uint8(data[i + 5])) << 8) | uint256(uint8(data[i + 6]));
            if (rgb != previous) {
                if (bytes(path).length != 0) result = string.concat(result, '<path fill="', color, '" d="', path, '"/>');
                path = "";
                color = rgb == 0 ? bg : string.concat("#", LibString.toHexStringNoPrefix(rgb, 3));
                previous = rgb;
            }
            path = string.concat(path, "M", uint256(uint8(data[i])).toString(), " ",
                uint256(uint8(data[i + 1])).toString(), "h", uint256(uint8(data[i + 2])).toString(),
                "v", uint256(uint8(data[i + 3])).toString(), "h-", uint256(uint8(data[i + 2])).toString(), "z");
        }
        if (bytes(path).length != 0) result = string.concat(result, '<path fill="', color, '" d="', path, '"/>');
    }

    // Generated from web/robot-scenes.mjs by scripts/sync-robot-scenes.mjs.
    function _habitat(uint8 habitat, string memory bg) internal pure returns (string memory) {
        if (habitat == 0) return string.concat(
            _scene(hex"000080800000000062801e2830470062800469718d00768002444a6510660210444a6560660210444a6530780208444a6562101212f3e9b65e0c10100000000c1c0404c4b7e91c0e0202c4b7e94e0a0404c4b7e976380202c4b7e90648101a22283d6a4e161422283d0a4e04068b7cb4725404068b7cb4003c0e0c2420386e3a12142420380238080436304c72360a0436304c0a420204aa8cc578400206aa8cc5025e1604536079685e1804536079006e2002394159626e1e023941590e7a0c0259607a66780a0259607a", bg),
            string.concat('<g class="twinkle">', _scene(hex"16240206e9daff14260602e9daff58220202bda4de", bg), '</g>'),
            string.concat('<g class="twinkle late">', _scene(hex"720c0206e9daff700e0602e9daff280a0202bda4de", bg), '</g>')
        );
        if (habitat == 1) return string.concat(
            _scene(hex"0000808000000000608020202d420226143a263652081e0e082636526816184a263652062e0608e8a0cc0e400608e8a0cc6c20060864d9db7630060864d9db6c42060864d9db006080049770ac066c1206b9b2cf226c1206b9b2cf3e6c1206b9b2cf5a6c1206b9b2cf766c0a06b9b2cf087816025fa6b1627a1202c180ae06101c06e783b5182e08321c263c5e3c08241c263c1a3402046c75a31a4002046c75a3604402049c658c08160210916eb406121802ffb2d708100406ffd6e412100206ffd6e41a100406ffd6e46a5812025ca1b6045a1002ac6c9b047a0802526580", bg),
            string.concat('<g class="glow">', _scene(hex"6c200608b1fff1062e0608ffc3e3", bg), '</g>'),
            string.concat('<g class="glow late">', _scene(hex"087810028dd6df68780c02d89fc7", bg), '</g>')
        );
        if (habitat == 2) return string.concat(
            _scene(hex"00008080000000005e8022305444005e800476a56d0076800a253e360432122c654a46002a1a0aaa7476042a060af1d1aa102a060af1d1aa063c0c0ee9be7708400806dc80696c4c101281594a6a4a1404b38664703e040c81bf7c6a3c080681bf7c7238080681bf7c74340404f2a4bb0e680604b0c67c686c0604b0c67c1a7a0e026b775302341602492f3c044e1002d19a7906520c043d333808540202f4b46b0e540202f4b46b6c521002ac80616c581002634e44046e120256765262721202567652047808024a6650707a0c024a6650166a020691ba7514680604e7a0b46466020691ba7562640604efc37b", bg),
            string.concat('<g class="sway">', _scene(hex"703a020ab4d9956a3a080495c8837236080495c883", bg), '</g>'),
            string.concat('<g class="leaf">', _scene(hex"101e0402cbd5831420020282b97c", bg), '</g>'),
            string.concat('<g class="leaf late">', _scene(hex"6c140402efca8270160202a6bd78", bg), '</g>')
        );
        if (habitat == 3) return string.concat(
            _scene(hex"0000808000000000168016464666002c801372718e003f8014a28b9e0053800dc8a4ad003b0b2566647f0e41091f66647f1a340c2c66647f293d0a2366647f362e093266647f423a0d2666647f5233092d66647f5e420c1e66647f6e38092866647f793f072166647f004911174b4c6a15460c1a4b4c6a284e0d124b4c6a3d450e1b4b4c6a504b0e154b4c6a63470c194b4c6a744f0c114b4c6a3b2a0204b8a7bb3b32011e91b7cb54370206d0b8bf0060802068617e00608002c2a3bc00628001333a59006c80013f425f007980013f425f5e632204a9859252672e05a98592466d3a06a9859239734706a985922b7a5506a985926f631104d2a39964671c05d2a399586d2806d2a3994b733506d2a3993e7a4206d2a39917630109434560386301094345605c630109434560106e010b434560396e010b434560636e010b434560087b01054345603b7b01054345606f7b0105434560044c1114303853054a0f0294abc3064d0d11687b9c064d0211a7bed0104e03104657730950050826455f0a51020689e8e4075b0b01c8c0c5035f1402272d486a58100853647b69571202b3b9bf6a5a02068092a0775a030638465c1d581603a99db51e5b1402434560205d0203353c572f5d0203353c57690a0c0ef5d5ac670d1008f5d5ac", bg),
            string.concat('<g class="drift">', _scene(hex"08171a03c7b1c20c131104e9c9c511100803e9c9c50a1a1601978da9", bg), '</g>'),
            string.concat('<g class="drift late">', _scene(hex"4e222303c7b1c2531e1904e9c9c5591b0d03e9c9c550251f01978da9", bg), '</g>'),
            string.concat('<g class="glow">', _scene(hex"094f0501a5ffff3f49020399d9df454e020399d9df2b51020399d9df", bg), '</g>'),
            string.concat('<g class="sway">', _scene(hex"6d530a034b807b6b4f0e04659c886e4b09048eb2966f4b0302c3c6a276500302b9c29d", bg), '</g>')
        );
        if (habitat == 4) return string.concat(
            _scene(hex"000080800000000062801e30233f00628004bd729e02301432211b3504321006efbb68063c0c10639eae08400404a7f2dc045010049f70b4084e0402f4b6d46a2a1438211b356c2c1006a284ed6e360c12a56099703a0606f4c6786c4e1004639eae724c0402a7f2dc101060047753931a181004ef93bf561810048de0dc0c701002644369647610026443690238022856445f7c32022e56445f06560c083328456e560c08332845085802048068880e58020480688870580204806888765802048068880e220e025c496e662210025c496e00668002603e680e760c0245334e666e100245334e027c180268446b", bg),
            string.concat('<g class="glow">', _scene(hex"08400404d2ffe81a181002ffc0dd", bg), '</g>'),
            string.concat('<g class="glow late">', _scene(hex"703a0604ffe5a156181002b2fff6", bg), '</g>')
        );
        return string.concat(
            _scene(hex"000080800000000056802a416b55005880087195630066801a335444006a800255795304460a14294b40003c120e5a84566c400e1a294b4066361a105a84561060020a9bb96c0c5e0a04e7ba78105e0202ffe3ae6e62020a9bb96c6a600a04db97b60c76060286a0646074080286a0640044060e719b680a400606719b68683a0608719b6874380806719b68065602049caf6e785602069caf6e1672020691af711272040291af711870020491af716674020691af716472020491af716a74020491af71047a080271935f707a080271935f", bg),
            string.concat('<g class="drift">', _scene(hex"06181806ccbdce0c140c04ccbdce", bg), '</g>'),
            string.concat('<g class="drift late">', _scene(hex"5e0e1c06ccbdce660a0c04ccbdce", bg), '</g>'),
            string.concat('<g class="sway">', _scene(hex"003e0e028caf796c380e028caf79", bg), '</g>'),
            string.concat('<g class="leaf">', _scene(hex"0e280402e8ce83122a02029bbd77", bg), '</g>'),
            string.concat('<g class="leaf late">', _scene(hex"6e200402b5d1916c22020278a36d", bg), '</g>')
        );
    }

    function _accessory(uint8 accessory, uint8) internal pure returns (string memory) {
        if (accessory == 0) return string.concat(_box(31, 12, 2, 6, "#302048"),
                _box(29, 10, 6, 3, "#f0bd5e"),
                _box(31, 9, 2, 1, "#ffe078"));
        if (accessory == 1) return string.concat(_box(20, 16, 24, 2, "#24344f"),
                _box(22, 12, 20, 4, "#6e8da9"),
                _box(25, 10, 14, 2, "#a9c7d6"),
                _box(23, 12, 3, 3, "#d1e3e8"),
                _box(26, 13, 13, 2, "#4bd2dc"),
                _box(27, 13, 5, 1, "#c1f6ef"),
                _box(31, 10, 2, 2, "#f1d18a"),
                _box(39, 15, 3, 1, "#324f6c"));
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
        string memory duration = traits.motion == 1 ? "0.8471s" : traits.motion == 2 ? "1.8824s" :
            traits.motion == 3 ? "0.6588s" : "1.1294s";
        string memory phase = traits.motion == 1 ? "-0.42355s" : traits.motion == 2 ? "-0.9412s" :
            traits.motion == 3 ? "-0.3294s" : "-0.5647s";
        string memory style = string.concat(
            '<style>.body{animation:bob ', duration, ' steps(1) infinite}',
            '.foot-a{animation:step-a ', duration, ' steps(1) infinite}',
            '.foot-b{animation:step-a ', duration, ' steps(1) infinite;animation-delay:', phase, '}',
            '.arm-a{animation:arm-a ', duration, ' steps(1) infinite}',
            '.arm-b{animation:arm-a ', duration, ' steps(1) infinite;animation-delay:', phase, '}',
            '@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}',
            '@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}',
            '@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}',
            '.drift{animation:breeze 18s steps(12) infinite alternate}.twinkle{animation:sparkle 4s steps(3) infinite alternate}.glow{animation:glimmer 5s steps(4) infinite alternate}.sway{animation:sway 7s steps(4) infinite alternate}.leaf{animation:fall 14s steps(14) infinite}.shadow{animation:shade 6s steps(6) infinite alternate}.late{animation-delay:-7s}@keyframes breeze{from{transform:translateX(-2px)}to{transform:translateX(2px)}}@keyframes sparkle{from{opacity:.3}to{opacity:1}}@keyframes glimmer{from{opacity:.35}to{opacity:1}}@keyframes sway{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes fall{0%{transform:translate(-3px,-3px);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(4px,18px);opacity:0}}@keyframes shade{from{opacity:.65}to{opacity:1}}',
            '@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow{animation:none}}</style>'
        );
        string memory evolution = stage == 0 ? "" :
            string.concat(_box(4, 4, 2, 2, "#ffe078"), _box(57, 9, 2, 2, "#ffe078"));
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" shape-rendering="crispEdges" data-species="',
            uint256(traits.species).toString(), '">',
            style, _habitat(traits.habitat, bg), _eraMark(traits.era), '<g transform="translate(16 30)"><g class="shadow">', _box(17, 50, 32, 2, "#17212d"), '</g>',
            sprite, '<g class="body">', _accessory(traits.acc, traits.species), '</g></g>',
            evolution, '</svg>'
        );
    }
}
