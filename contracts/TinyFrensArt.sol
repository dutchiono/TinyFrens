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
    uint16 ambience;
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
            _scene(hex"00008080000000002680141e1d34003a801427253f004e8014302c490062801e2830470062800469718d00768002444a6510660210444a6560660210444a6530780208444a6562101212f3e9b65e0c10100000000648101a22283d6a4e161422283d0a4e04068b7cb4725404068b7cb4003c0e0c2420386e3a12142420380238080436304c72360a0436304c0a420204aa8cc578400206aa8cc5025e1604536079685e1804536079006e2002394159626e1e02394159", bg),
            string.concat('<g class="parallax">', _scene(hex"1f41091d2d2b462b3b07232d2b46523f0a1f2d2b465e4607182d2b46", bg), '</g>'),
            _scene(hex"033d0a02625a82043f020849426307410404cab8e7703b0e02625a82733d020f49426377420403cab8e7025516028d91ae685518028d91ae045702073a405b0d5702073a405b705702073a405b7a5702073a405b04631b01a0a3bd64631c01a0a3bd01681a014d587205701b014d587260721f014d5872047b0a0177829a167d080177829a637c120177829a17670107171f376e660108171f3724790107171f375f2008014f496b67230a014f496b08490201958bb1714d0301958bb1085b03016a7792765b03016a77921b72040178819a5f74050178819a", bg),
            string.concat('<g class="twinkle">', _scene(hex"16230105bba2d814250501bba2d816250101ffffff4e090103e9daff4d0a0301e9daff", bg), '</g>'),
            string.concat('<g class="twinkle late">', _scene(hex"720c0105bba2d8700e0501bba2d8720e0101ffffff28090103e9daff270a0301e9daff", bg), '</g>'),
            string.concat('<g class="drift">', _scene(hex"261614027066812b140b0287788e271811014f506a", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"5e6322049cabe052672e059cabe0466d3a069cabe0397347069cabe02b7a55069cabe0", bg), '</g>')
        );
        if (habitat == 1) return string.concat(
            _scene(hex"000080800000000024801419354b00388014213d52004c80142c465a00608020202d420226143a263652081e0e082636526816184a263652062e0608e8a0cc0e400608e8a0cc6c20060864d9db7630060864d9db6c42060864d9db006080049770ac066c1206b9b2cf226c1206b9b2cf3e6c1206b9b2cf5a6c1206b9b2cf766c0a06b9b2cf06101c06e783b5182e08321c263c5e3c08241c263c1a3402046c75a31a4002046c75a3604402049c658c08160210916eb406121802ffb2d708100406ffd6e412100206ffd6e41a100406ffd6e46a5812025ca1b6045a1002ac6c9b047a0802526580", bg),
            string.concat('<g class="parallax">', _scene(hex"242d0c311c29413323093b1c294144300a2e1c294151280a361c2941", bg), '</g>'),
            _scene(hex"022702314e607e14260234172238681702424e607e7e16024417223807390a01607593074c0a016075936b2c11016075936b50110160759322193c01566080221a01055660805d1a01035660801948060a3543621a490402f5c590604e0508354362614f030193dada04641801c699bf64641c0183b9c90a750c01487583067c1201487583647312017756756c7e1001775675036b01123d47601d73010d3d4760706601053d476008210501ac91c26e1908017890ac0f5203018990ad6d5405018990ad055e1001d79dbb6c5e10018cd3cf0c770501a6e3dd747b0501e6a1c7", bg),
            string.concat('<g class="glow">', _scene(hex"6c200608b1fff1062e0608ffc3e3", bg), '</g>'),
            string.concat('<g class="glow late">', _scene(hex"087810028dd6df68780c02d89fc7", bg), '</g>'),
            string.concat('<g class="drift">', _scene(hex"261614027066812b140b0287788e271811014f506a", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"04651304ec9cce07741402ec9cce027b1c02ec9cce68661803ec9cce63791d03ec9cce", bg), '</g>')
        );
        if (habitat == 2) return string.concat(
            _scene(hex"00008080000000001e801649384a00348016614856004a8014795d60005e8022305444005e800476a56d0076800a253e360432122c654a46002a1a0aaa7476042a060af1d1aa102a060af1d1aa063c0c0ee9be7708400806dc80696c4c101281594a6a4a1404b38664703e040c81bf7c6a3c080681bf7c7238080681bf7c74340404f2a4bb02341602492f3c044e1002d19a7906520c043d333808540202f4b46b0e540202f4b46b6c521002ac80616c581002634e44046e120256765262721202567652047808024a6650707a0c024a6650166a020691ba7514680604e7a0b46466020691ba7562640604efc37b", bg),
            string.concat('<g class="parallax">', _scene(hex"284f0f0f4c6054394a12144c60544e510e0d4c6054", bg), '</g>'),
            _scene(hex"03360218b98a7014360218493c4006390c01f7d99808410701f7d998064c0e02926c5505581001322e39012c1801f2cdb201331801674c491b3a0920423d481c3b0702ba94771c460702ba94771c520702ba94771d3f02059bb38a20400204e5b2811d4a0406cb87916a4f020cc6a77e7a4f020c563f3902621903688d6566621a03688d65017219019c986963771d019c986907660208496c5076670209496c50047c1201728363647d14017283635c5a0904577c5d5e56020699b7796258020499b77909480301fce1a910580301946b596d540501d1aa84735a0401d1aa840a740501b3b9816f7a0501b3b981", bg),
            string.concat('<g class="sway">', _scene(hex"703a020ab4d9956a3a080495c8837236080495c883", bg), '</g>'),
            string.concat('<g class="leaf">', _scene(hex"101e0402cbd5831420020282b97c", bg), '</g>'),
            string.concat('<g class="leaf late">', _scene(hex"6c140402efca8270160202a6bd78", bg), '</g>'),
            string.concat('<g class="drift">', _scene(hex"261614027066812b140b0287788e271811014f506a", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"00621b05ffe0ac00672005ffe0ac006c2506ffe0ac00722b07ffe0ac00793207ffe0ac", bg), '</g>')
        );
        if (habitat == 3) return string.concat(
            _scene(hex"0000808000000000168016464666002c801372718e003f8014a28b9e0053800dc8a4ad0060802068617e00608002c2a3bc00628001333a59006c80013f425f007980013f425f5e632204a9859252672e05a98592466d3a06a9859239734706a985922b7a5506a985926f631104d2a39964671c05d2a399586d2806d2a3994b733506d2a3993e7a4206d2a39917630109434560386301094345605c630109434560106e010b434560396e010b434560636e010b434560087b01054345603b7b01054345606f7b0105434560044c1114303853054a0f0294abc3064d0d11687b9c064d0211a7bed0104e03104657730950050826455f0a51020689e8e4075b0b01c8c0c5035f1402272d486a58100853647b69571202b3b9bf6a5a02068092a0775a030638465c1d581603a99db51e5b1402434560205d0203353c572f5d0203353c57690a0c0ef5d5ac670d1008f5d5ac", bg),
            string.concat('<g class="parallax">', _scene(hex"003b0b2566647f0e41091f66647f1a340c2c66647f293d0a2366647f362e093266647f423a0d2666647f5233092d66647f5e420c1e66647f6e38092866647f793f072166647f004911174b4c6a15460c1a4b4c6a284e0d124b4c6a3d450e1b4b4c6a504b0e154b4c6a63470c194b4c6a744f0c114b4c6a3b2a0204b8a7bb3b32011e91b7cb54370206d0b8bf", bg), '</g>'),
            string.concat('<g class="drift">', _scene(hex"08171a03c7b1c20c131104e9c9c511100803e9c9c50a1a1601978da9", bg), '</g>'),
            string.concat('<g class="drift late">', _scene(hex"4e222303c7b1c2531e1904e9c9c5591b0d03e9c9c550251f01978da9", bg), '</g>'),
            string.concat('<g class="glow">', _scene(hex"094f0501a5ffff3f49020399d9df454e020399d9df2b51020399d9df", bg), '</g>'),
            string.concat('<g class="sway">', _scene(hex"6d530a034b807b6b4f0e04659c886e4b09048eb2966f4b0302c3c6a276500302b9c29d", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"5e632204ffe0ac52672e05ffe0ac466d3a06ffe0ac39734706ffe0ac2b7a5506ffe0ac", bg), '</g>')
        );
        if (habitat == 4) return string.concat(
            _scene(hex"000080800000000062801e30233f00628004bd729e02301432211b3504321006efbb68063c0c10639eae08400404a7f2dc045010049f70b4084e0402f4b6d46a2a1438211b356c2c1006a284ed6e360c12a56099703a0606f4c6786c4e1004639eae724c0402a7f2dc101060047753931a181004ef93bf561810048de0dc0c701002644369647610026443690238022856445f7c32022e56445f06560c083328456e560c08332845085802048068880e58020480688870580204806888765802048068880e220e025c496e662210025c496e00668002603e680e760c0245334e666e100245334e027c180268446b", bg),
            string.concat('<g class="parallax">', _scene(hex"1e28063730253e5a28063730253e24283601503654", bg), '</g>'),
            _scene(hex"0e1202104536536e12021045365310135e01a787b925093501654771250a0105654771590a01056547710231022e79607c1431022e15192b6a2b023479607c7c2b023415192b05390e01c39ea06d330e01b49dcc073d010db2e8d76f37010fe7b8b504511001d2a4c46c4f1001a1bdc80c4e0201efc66e764c0201efc66e006c8001513654007980015136541968011151365466680111513654117a01065136546f7a010651365405681101a47e9e6b68110180b1bd087d0e01866788697c1101597f970a46050184bfb772440501c785a70954070159495e7152070159495e0c720601be89ac6e73060187bac3", bg),
            string.concat('<g class="glow">', _scene(hex"08400404d2ffe81a181002ffc0dd", bg), '</g>'),
            string.concat('<g class="glow late">', _scene(hex"703a0604ffe5a156181002b2fff6", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"03661305ec9cce076b1405ec9cce0b701605ec9cce69671405ec9cce626c1907ec9cce", bg), '</g>')
        );
        return string.concat(
            _scene(hex"00008080000000001e8014263e5a00328014365565004680104c726d0056802a416b55005880087195630066801a335444006a800255795304460a14294b40003c120e5a84566c400e1a294b4066361a105a84561060020a9bb96c0c5e0a04e7ba78105e0202ffe3ae6e62020a9bb96c6a600a04db97b60c76060286a0646074080286a0640044060e719b680a400606719b68683a0608719b6874380806719b68065602049caf6e785602069caf6e1672020691af711272040291af711870020491af716674020691af716472020491af716a74020491af71047a080271935f707a080271935f", bg),
            string.concat('<g class="parallax">', _scene(hex"144f19074b796124491e0d4b79613b4d1e094b7961525114054b7961", bg), '</g>'),
            _scene(hex"003e1002a9c18b0241050286aa710c4405033e694d67371602a9c18b6a3b060286aa71784008033e694d054c020c64846670480210648466165710029ab681585810029ab681006e170342747c00711d0342747c0074220442747c0078280442747c006e120193c6c30473110193c6c30a78130193c6c3636d0b039ba28b69750e049ba28b636d0a01d0c7a669750d01d0c7a61d620502a6bd805c650602a6bd80587b0a017e9d69165d0103dce1ac655b0103dce1ac07530201a6bc8c74510201a6bc8c0276050176a6a7147a060176a6a773710401c2cb9b58780301c2cb9b", bg),
            string.concat('<g class="drift">', _scene(hex"06181806ccbdce0c140c04ccbdce", bg), '</g>'),
            string.concat('<g class="drift late">', _scene(hex"5e0e1c06ccbdce660a0c04ccbdce", bg), '</g>'),
            string.concat('<g class="sway">', _scene(hex"003e0e028caf796c380e028caf79", bg), '</g>'),
            string.concat('<g class="leaf">', _scene(hex"0e280402e8ce83122a02029bbd77", bg), '</g>'),
            string.concat('<g class="leaf late">', _scene(hex"6e200402b5d1916c22020278a36d", bg), '</g>'),
            string.concat('<g class="light">', _scene(hex"60622005ffe0ac5a672605ffe0ac516c2f06ffe0ac49723707ffe0ac3f794107ffe0ac", bg), '</g>')
        );
    }

    function _accessory(uint8 accessory, uint8) internal pure returns (string memory) {
        if (accessory == 0) return _scene(hex"2e1203093020482b0f0904f0bd5e2e0d0302ffe078", "");
        if (accessory == 1) return _scene(hex"1e18240324344f21121e066e8da9250f1503a9c7d622120504d1e3e8271313034bd2dc28130802c1f6ef2e0f0303f1d18a3a160502324f6c", "");
        if (accessory == 2) return _scene(hex"21181e0379503822121b06c18b3c210f0409e6b54f3a0f0509e6b54f2d0d060be6b54f25150803e6b54f33150703e6b54f22181b01ffe3a022100206ffe3a02d0f0104ffe3a02816030275d0d734160302e38eac2e1503039555a1", "");
        if (accessory == 3) return string.concat('<g class="halo">', _scene(hex"250f1501bd874221100402bd87423a100502bd87421f120504bd87423c120404bd874222161b02bd874225181501bd874225101502fff1bd21120303fff1bd3c120303f1c86c24151803f1c86c27151201fff4d4", ""), '</g>');
        if (accessory == 4) return _scene(hex"2e1203093020482b0f0904f0bd5e2e0d0302ffe078243c1801e1d7cf243d060684324f363d060684324f253d0505ef79962a3f0403cf526f313f0503cf526f363d0405ef7996253d0302ffb0b8373d0302ffb0b82e3f0303e9c371", "");
        if (accessory == 5) return string.concat(_scene(hex"2e1203093020482b0f0904f0bd5e2e0d0302ffe078", ""), '<g class="orb">', _scene(hex"522106012447624f220c032447624e250f062447624f2b0c03244762522e0602244762522206029aede45124090750b5ca522b0602387b9e512503059aede45424040474d9dc572803033785aa52240301ecfff2", ""), '</g>');
        return "";
    }

    function _eraMark(uint8 era) internal pure returns (string memory) {
        if (era == 0) return _box(23, 39, 2, 1, "#dc9979");
        if (era == 1) return string.concat(_box(23, 39, 2, 1, "#b9c5dc"), _box(27, 39, 2, 1, "#b9c5dc"));
        return string.concat(_box(23, 39, 2, 1, "#ffe078"), _box(27, 39, 2, 1, "#ffe078"),
            _box(31, 39, 2, 1, "#ffe078"));
    }

    function render(Traits calldata traits, uint8 stage) external view override returns (string memory) {
        (string memory body, string memory ink, string memory bg) = _palette(traits.palette);
        string memory sprite = spriteRenderer.render(traits.species, body, ink, traits.expr);
        string memory duration = traits.motion == 1 ? "0.8471s" : traits.motion == 2 ? "1.8824s" :
            traits.motion == 3 ? "0.6588s" : "1.1294s";
        string memory phase = traits.motion == 1 ? "-0.42355s" : traits.motion == 2 ? "-0.9412s" :
            traits.motion == 3 ? "-0.3294s" : "-0.5647s";
        string memory style = string.concat(
            '<style>', spriteRenderer.motionStyle(traits.ambience), '.body{animation:bob ', duration, ' steps(1) infinite}',
            '.foot-a{animation:step-a ', duration, ' steps(1) infinite}',
            '.foot-b{animation:step-a ', duration, ' steps(1) infinite;animation-delay:', phase, '}',
            '.arm-a{animation:arm-a ', duration, ' steps(1) infinite}',
            '.arm-b{animation:arm-a ', duration, ' steps(1) infinite;animation-delay:', phase, '}',
            '@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}',
            '@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}',
            '@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}',
            spriteRenderer.sceneryStyle(),
            '@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow,.parallax,.light,.sheen,.orb,.halo{animation:none}}</style>'
        );
        string memory evolution = stage == 0 ? "" :
            string.concat(_box(4, 4, 2, 2, "#ffe078"), _box(57, 9, 2, 2, "#ffe078"));
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" shape-rendering="crispEdges" data-species="',
            uint256(traits.species).toString(), '">',
            style, _habitat(traits.habitat, bg), '<g transform="translate(16 30)"><g class="shadow">', _box(17, 50, 32, 2, "#17212d"), '</g>',
            sprite, '<g class="body">', _accessory(traits.acc, traits.species), _eraMark(traits.era), '</g></g>',
            evolution, '</svg>'
        );
    }
}
