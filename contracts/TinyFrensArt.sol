// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Traits {
    uint8 species; // 0..7 (333 of each across 2664 total supply)
    uint8 palette; // 0..7 (Curated paired body, outline, bg)
    uint8 expr;    // 0..3 (Happy, Wink, Shades, Star Eyes)
    uint8 acc;     // 0..5 (None, Party Hat, Crown, Halo, Bow Tie, Mystic Orb)
    uint8 era;     // 0..2 (three 888-token cohorts)
    uint8 habitat; // 0..5 (scene/background layer)
    uint8 motion;  // 0..3 (animation personality)
}

interface ITinyFrensArt {
    function render(Traits calldata t, uint8 stage) external pure returns (string memory);
}

/// @title TinyFrensArt
/// @notice Dedicated on-chain SVG vector renderer for TinyFrens companions.
contract TinyFrensArt is ITinyFrensArt {
    function _paletteData(uint8 p) internal pure returns (
        string memory body,
        string memory dark,
        string memory bg
    ) {
        if (p == 0) return ("#a474f1", "#4b2d77", "#17142a");
        if (p == 1) return ("#66c7d2", "#235960", "#0d1117");
        if (p == 2) return ("#ffb95e", "#7a4e12", "#fff7ed");
        if (p == 3) return ("#82eba1", "#235f37", "#e8f5e9");
        if (p == 4) return ("#ff82a7", "#6f233a", "#fdf2f8");
        if (p == 5) return ("#4d96ff", "#1b3f75", "#f0f9ff");
        if (p == 6) return ("#3a2d52", "#1e162d", "#211c39");
        return ("#ffd700", "#b7791f", "#2d132c");
    }

    function render(Traits calldata t, uint8 stage) external pure override returns (string memory) {
        (string memory body, string memory dark, string memory bg) = _paletteData(t.palette);

        string memory earsSvg = "";
        string memory shellSvg = "";
        string memory speciesSvg = "";
        string memory limbsSvg = "";
        string memory shineSvg = "";
        string memory habitatSvg = "";

        if (t.habitat == 0) {
            habitatSvg = '<circle cx="18" cy="22" r="3" fill="#fff" opacity=".7"/><circle cx="102" cy="31" r="2" fill="#fff" opacity=".55"/><path d="M12 126 H116" stroke="#fff" stroke-width="2" opacity=".12"/>';
        } else if (t.habitat == 1) {
            habitatSvg = '<path d="M0 120 H128" stroke="#00d2d3" stroke-width="4" opacity=".32"/><path d="M8 132 H38 M54 132 H84 M100 132 H126" stroke="#fff" stroke-width="4" opacity=".22"/><circle cx="108" cy="22" r="7" fill="#ff82a7" opacity=".5"/>';
        } else if (t.habitat == 2) {
            habitatSvg = '<path d="M0 124 C22 114 42 134 64 122 C86 110 104 128 128 116 V148 H0 Z" fill="#82eba1" opacity=".28"/><circle cx="18" cy="110" r="3" fill="#ff4757"/><circle cx="104" cy="118" r="3" fill="#ff4757"/>';
        } else if (t.habitat == 3) {
            habitatSvg = '<ellipse cx="30" cy="28" rx="18" ry="7" fill="#fff" opacity=".22"/><ellipse cx="92" cy="42" rx="22" ry="8" fill="#fff" opacity=".18"/><path d="M0 130 C20 124 42 128 64 123 C86 118 108 124 128 119 V148 H0 Z" fill="#fff" opacity=".12"/>';
        } else if (t.habitat == 4) {
            habitatSvg = '<rect x="8" y="16" width="18" height="18" rx="4" fill="#ffd700" opacity=".32"/><rect x="102" y="20" width="14" height="30" rx="4" fill="#66c7d2" opacity=".28"/><path d="M8 128 H120" stroke="#ffd700" stroke-width="3" stroke-dasharray="8 7" opacity=".32"/>';
        } else {
            habitatSvg = '<path d="M0 126 Q32 112 64 124 T128 122 V148 H0 Z" fill="#82eba1" opacity=".24"/><circle cx="24" cy="112" r="4" fill="#ffd700" opacity=".7"/><circle cx="112" cy="108" r="3" fill="#ffd700" opacity=".65"/>';
        }

        if (t.species == 0) { // Cat
            earsSvg = string.concat(
                '<path d="M18 45 L34 6 L54 43 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M74 43 L94 6 L110 45 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M29 34 L36 17 L45 35 Z M83 35 L92 17 L99 34 Z" fill="#ffb6c8" opacity=".78"/>',
                '<path d="M102 105 C132 98 130 64 103 75 C122 79 121 99 102 97" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>'
            );
            limbsSvg = string.concat(
                '<path d="M30 119 C21 126 19 137 35 137 H49 C47 126 39 120 30 119 Z" fill="', dark, '"/>',
                '<path d="M79 119 C88 120 97 126 99 137 H82 C72 137 72 126 79 119 Z" fill="', dark, '"/>'
            );
            speciesSvg = string.concat(
                '<path d="M21 88 H5 M22 96 H7 M107 88 H123 M106 96 H121" stroke="', dark, '" stroke-width="3" stroke-linecap="round"/>',
                '<path d="M58 94 Q64 99 70 94" stroke="', dark, '" stroke-width="3" fill="none" stroke-linecap="round"/>'
            );
            shineSvg = '<ellipse cx="43" cy="55" rx="16" ry="13" fill="url(#shine)"/>';
        } else if (t.species == 1) { // Blob
            limbsSvg = string.concat(
                '<path d="M28 124 C20 131 27 140 39 134" fill="', dark, '" opacity=".58"/>',
                '<path d="M88 126 C99 132 97 141 83 136" fill="', dark, '" opacity=".58"/>'
            );
            shellSvg = string.concat(
                '<path d="M31 58 C19 75 19 112 40 125 C53 134 57 120 68 126 C90 136 111 116 108 86 C105 56 89 45 70 52 C54 40 39 43 31 58 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>',
                '<path d="M38 55 C47 47 56 47 65 55" stroke="#fff" stroke-width="4" opacity=".22" fill="none" stroke-linecap="round"/>'
            );
            speciesSvg = string.concat('<path d="M30 101 C45 93 50 114 64 104 C79 94 87 112 101 101" stroke="', dark, '" stroke-width="3" opacity=".36" fill="none" stroke-linecap="round"/>');
            shineSvg = '<ellipse cx="47" cy="62" rx="19" ry="16" fill="url(#shine)"/>';
        } else if (t.species == 2) { // Robot
            earsSvg = string.concat(
                '<path d="M64 31 V13" stroke="', dark, '" stroke-width="6" stroke-linecap="round"/>',
                '<circle cx="64" cy="9" r="6" fill="#00d2d3" stroke="', dark, '" stroke-width="3"/>',
                '<path d="M50 28 H78" stroke="', dark, '" stroke-width="5" stroke-linecap="round"/>',
                '<circle cx="26" cy="66" r="8" fill="', body, '" stroke="', dark, '" stroke-width="5"/>',
                '<circle cx="102" cy="66" r="8" fill="', body, '" stroke="', dark, '" stroke-width="5"/>'
            );
            limbsSvg = string.concat(
                '<path d="M23 88 H13 V108 H25" fill="none" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M105 88 H115 V108 H103" fill="none" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M38 128 H52 M76 128 H90" stroke="', dark, '" stroke-width="10" stroke-linecap="round"/>',
                '<path d="M31 134 H56 M72 134 H97" stroke="', dark, '" stroke-width="5" stroke-linecap="round" opacity=".55"/>'
            );
            speciesSvg = string.concat(
                '<path d="M36 57 H92 M36 79 H92" stroke="', dark, '" stroke-width="3" opacity=".45"/>',
                '<rect x="49" y="101" width="30" height="15" rx="3" fill="', bg, '" stroke="', dark, '" stroke-width="4" opacity=".92"/>',
                '<path d="M55 108 H73" stroke="#00d2d3" stroke-width="3" stroke-linecap="round"/>',
                '<circle cx="41" cy="105" r="3" fill="', dark, '" opacity=".7"/><circle cx="87" cy="105" r="3" fill="', dark, '" opacity=".7"/>'
            );
            shineSvg = '<path d="M39 45 H58" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".24"/>';
        } else if (t.species == 3) { // Bunny
            earsSvg = string.concat(
                '<path d="M34 58 C22 38 22 11 36 4 C52 8 52 40 43 61 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M94 58 C106 38 106 11 92 4 C76 8 76 40 85 61 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M37 47 C32 33 33 19 38 13 M91 47 C96 33 95 19 90 13" stroke="#ffb6c8" stroke-width="5" stroke-linecap="round" opacity=".72"/>'
            );
            limbsSvg = string.concat('<ellipse cx="42" cy="132" rx="18" ry="8" fill="', dark, '"/><ellipse cx="86" cy="132" rx="18" ry="8" fill="', dark, '"/>');
            speciesSvg = '<rect x="58" y="101" width="5" height="10" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="10" rx="1" fill="#fff"/><circle cx="103" cy="104" r="8" fill="#fff" opacity=".55"/>';
            shineSvg = '<ellipse cx="47" cy="62" rx="15" ry="14" fill="url(#shine)"/>';
        } else if (t.species == 4) { // Duck
            earsSvg = string.concat(
                '<path d="M64 34 C60 22 68 14 63 8 C70 14 72 23 66 34" fill="', body, '" stroke="', dark, '" stroke-width="4.5" stroke-linejoin="round"/>',
                '<path d="M64 34 C67 25 76 20 73 14 C78 20 77 27 66 34" fill="', body, '" stroke="', dark, '" stroke-width="3.5" stroke-linejoin="round"/>'
            );
            limbsSvg = string.concat(
                '<path d="M18 84 C8 94 12 112 24 106" stroke="', dark, '" stroke-width="7" stroke-linecap="round" fill="none"/>',
                '<path d="M110 84 C120 94 116 112 104 106" stroke="', dark, '" stroke-width="7" stroke-linecap="round" fill="none"/>',
                '<path d="M26 127 L14 137 H46 Z" fill="', dark, '"/>',
                '<path d="M102 127 L114 137 H82 Z" fill="', dark, '"/>'
            );
            speciesSvg = string.concat(
                '<ellipse cx="64" cy="95" rx="17" ry="10" fill="#ff9f43" stroke="', dark, '" stroke-width="4.5"/>',
                '<circle cx="60" cy="93" r="1.5" fill="', dark, '"/><circle cx="68" cy="93" r="1.5" fill="', dark, '"/>',
                '<path d="M53 96 Q64 102 75 96" stroke="', dark, '" stroke-width="2.5" fill="none"/>'
            );
            shineSvg = '<ellipse cx="43" cy="59" rx="15" ry="13" fill="url(#shine)"/>';
        } else if (t.species == 5) { // Pig
            earsSvg = string.concat(
                '<path d="M26 44 C12 30 16 14 34 22 C28 30 26 38 26 44 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M102 44 C116 30 112 14 94 22 C100 30 102 38 102 44 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M24 28 C20 22 22 17 28 20 M104 28 C108 22 106 17 100 20" stroke="#ffb6c8" stroke-width="4" stroke-linecap="round"/>',
                '<path d="M104 106 C118 104 124 94 116 88 C108 84 112 76 118 78" fill="none" stroke="', dark, '" stroke-width="6" stroke-linecap="round"/>'
            );
            limbsSvg = string.concat(
                '<path d="M29 126 H47 V137 H29 Z" fill="', dark, '"/>',
                '<path d="M81 126 H99 V137 H81 Z" fill="', dark, '"/>',
                '<line x1="38" y1="131" x2="38" y2="137" stroke="#fff" stroke-width="2"/>',
                '<line x1="90" y1="131" x2="90" y2="137" stroke="#fff" stroke-width="2"/>'
            );
            speciesSvg = string.concat(
                '<ellipse cx="64" cy="95" rx="17" ry="11" fill="#ffb6c8" stroke="', dark, '" stroke-width="4.5"/>',
                '<ellipse cx="58" cy="95" rx="2.5" ry="4" fill="', dark, '"/>',
                '<ellipse cx="70" cy="95" rx="2.5" ry="4" fill="', dark, '"/>'
            );
            shineSvg = '<ellipse cx="43" cy="59" rx="17" ry="14" fill="url(#shine)"/>';
        } else if (t.species == 6) { // Frog
            earsSvg = string.concat(
                '<circle cx="34" cy="40" r="18" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="94" cy="40" r="18" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<ellipse cx="32" cy="36" rx="9" ry="6" fill="#fff" opacity=".35"/>',
                '<ellipse cx="92" cy="36" rx="9" ry="6" fill="#fff" opacity=".35"/>'
            );
            limbsSvg = string.concat(
                '<path d="M22 118 C8 120 8 136 28 135 H46" fill="', dark, '"/>',
                '<path d="M106 118 C120 120 120 136 100 135 H82" fill="', dark, '"/>',
                '<path d="M18 108 C10 102 12 94 25 92" stroke="', dark, '" stroke-width="7" stroke-linecap="round" fill="none"/>',
                '<path d="M110 108 C118 102 116 94 103 92" stroke="', dark, '" stroke-width="7" stroke-linecap="round" fill="none"/>'
            );
            speciesSvg = string.concat(
                '<ellipse cx="64" cy="110" rx="30" ry="16" fill="#fff" opacity=".34"/>',
                '<path d="M42 96 Q64 112 86 96" stroke="', dark, '" stroke-width="4.5" fill="none" stroke-linecap="round"/>',
                '<circle cx="42" cy="95" r="2.5" fill="', dark, '"/><circle cx="86" cy="95" r="2.5" fill="', dark, '"/>'
            );
            shineSvg = '<ellipse cx="44" cy="65" rx="17" ry="12" fill="url(#shine)"/>';
        } else { // Turtle
            earsSvg = string.concat('<ellipse cx="64" cy="46" rx="24" ry="19" fill="', body, '" stroke="', dark, '" stroke-width="8"/>');
            limbsSvg = string.concat(
                '<path d="M24 70 C10 66 8 80 20 86" stroke="', dark, '" stroke-width="8" stroke-linecap="round" fill="none"/>',
                '<path d="M104 70 C118 66 120 80 108 86" stroke="', dark, '" stroke-width="8" stroke-linecap="round" fill="none"/>',
                '<path d="M29 125 L16 137 H44 Z" fill="', dark, '"/>',
                '<path d="M99 125 L112 137 H84 Z" fill="', dark, '"/>'
            );
            shellSvg = string.concat(
                '<ellipse cx="64" cy="95" rx="44" ry="36" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>',
                '<ellipse cx="64" cy="95" rx="28" ry="24" fill="none" stroke="', dark, '" stroke-width="5" opacity=".78"/>',
                '<path d="M36 95 H92 M64 71 V119 M46 80 Q64 92 82 80 M46 110 Q64 98 82 110" stroke="', dark, '" stroke-width="3.5" fill="none" opacity=".78"/>'
            );
            speciesSvg = shellSvg;
            shineSvg = '<ellipse cx="49" cy="81" rx="15" ry="11" fill="url(#shine)"/>';
        }

        string memory defsSvg = string.concat(
            '<defs><linearGradient id="body" x1="20" y1="30" x2="104" y2="132">',
            '<stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="32%" stop-color="', body,
            '"/><stop offset="100%" stop-color="', dark, '" stop-opacity=".28"/></linearGradient>',
            '<radialGradient id="shine" cx="35%" cy="26%" r="58%"><stop offset="0%" stop-color="#fff" stop-opacity=".42"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
        );
        string memory bodySvg = t.species == 1 ? speciesSvg : (
            t.species == 2 ? string.concat('<rect x="29" y="36" width="70" height="54" rx="9" fill="url(#body)" stroke="', dark, '" stroke-width="8"/><rect x="38" y="48" width="52" height="31" rx="5" fill="', bg, '" stroke="', dark, '" stroke-width="4" opacity=".9"/><path d="M48 90 H80 L86 98 V121 Q86 129 78 129 H50 Q42 129 42 121 V98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/><rect x="54" y="91" width="20" height="8" fill="', dark, '" opacity=".55"/>') :
            t.species == 3 ? string.concat('<path d="M31 72 C29 48 43 35 64 38 C85 35 99 48 97 72 L94 105 C91 127 78 137 64 134 C50 137 37 127 34 105 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 4 ? string.concat('<path d="M22 66 C18 42 38 32 64 34 C90 32 110 42 106 66 L102 102 C100 125 84 136 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 5 ? string.concat('<path d="M22 68 C18 44 38 32 64 34 C90 32 110 44 106 68 L104 100 C102 125 86 136 64 133 C42 136 26 125 24 100 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 6 ? string.concat('<path d="M14 78 C14 48 32 38 64 38 C96 38 114 48 114 78 C114 114 96 133 64 130 C32 133 14 114 14 78 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 7 ? shellSvg :
            string.concat('<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>')
        );
        if (t.species == 1) {
            bodySvg = shellSvg;
        }

        string memory eyesSvg = "";
        if (t.expr == 0) { // Happy
            eyesSvg = string.concat(
                '<rect x="32" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<rect x="84" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<circle cx="35" cy="70" r="2.5" fill="#fff"/>',
                '<circle cx="87" cy="70" r="2.5" fill="#fff"/>'
            );
        } else if (t.expr == 1) { // Wink
            eyesSvg = string.concat(
                '<rect x="32" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<circle cx="35" cy="70" r="2.5" fill="#fff"/>',
                '<path d="M 82 76 Q 90 70 98 76" stroke="', dark, '" stroke-width="4" fill="none" stroke-linecap="round"/>'
            );
        } else if (t.expr == 2) { // Shades
            eyesSvg = string.concat(
                '<rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/>',
                '<rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/>',
                '<rect x="56" y="68" width="16" height="4" fill="#111"/>',
                '<line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>',
                '<line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>'
            );
        } else { // Star Eyes
            eyesSvg = '<polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/><polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>';
        }
        string memory cheeksSvg = '<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/><rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>';
        string memory mouthSvg = string.concat('<rect x="60" y="96" width="8" height="5" rx="2" fill="', dark, '"/>');
        if (t.species == 4 || t.species == 5 || t.species == 6) {
            mouthSvg = "";
        } else if (t.species == 3) {
            mouthSvg = string.concat(mouthSvg, '<rect x="61" y="101" width="6" height="5" rx="1" fill="#fff"/>');
        } else if (t.species == 7) {
            if (t.expr == 0) {
                eyesSvg = string.concat('<rect x="51" y="44" width="8" height="13" rx="3" fill="', dark, '"/><rect x="69" y="44" width="8" height="13" rx="3" fill="', dark, '"/><circle cx="53" cy="47" r="1.8" fill="#fff"/><circle cx="71" cy="47" r="1.8" fill="#fff"/>');
            } else if (t.expr == 1) {
                eyesSvg = string.concat('<rect x="51" y="44" width="8" height="13" rx="3" fill="', dark, '"/><circle cx="53" cy="47" r="1.8" fill="#fff"/><path d="M69 50 Q73 46 77 50" stroke="', dark, '" stroke-width="3" fill="none" stroke-linecap="round"/>');
            } else if (t.expr == 2) {
                eyesSvg = '<rect x="45" y="44" width="17" height="9" rx="2" fill="#111"/><rect x="66" y="44" width="17" height="9" rx="2" fill="#111"/><rect x="61" y="47" width="6" height="3" fill="#111"/>';
            } else {
                eyesSvg = '<polygon points="55,42 57,48 63,48 58,52 60,58 55,55 50,58 52,52 47,48 53,48" fill="#ffd700"/><polygon points="73,42 75,48 81,48 76,52 78,58 73,55 68,58 70,52 65,48 71,48" fill="#ffd700"/>';
            }
            cheeksSvg = '<rect x="43" y="56" width="10" height="6" rx="3" fill="#ff82a7"/><rect x="75" y="56" width="10" height="6" rx="3" fill="#ff82a7"/>';
            mouthSvg = string.concat('<rect x="61" y="56" width="6" height="4" rx="2" fill="', dark, '"/>');
        }

        string memory accSvg = "";
        if (t.acc == 1) { // Party hat
            accSvg = '<polygon points="64,4 48,32 80,32" fill="#ff4757" stroke="#ffd700" stroke-width="3"/><circle cx="64" cy="4" r="5" fill="#ffd700"/>';
        } else if (t.acc == 2) { // Crown
            accSvg = '<polygon points="46,26 46,14 55,20 64,10 73,20 82,14 82,26" fill="#ffd700" stroke="#b7791f" stroke-width="2"/><circle cx="64" cy="10" r="3" fill="#e74c3c"/>';
        } else if (t.acc == 3) { // Halo
            accSvg = '<ellipse cx="64" cy="12" rx="30" ry="8" fill="none" stroke="#ffeaa7" stroke-width="5"/>';
        } else if (t.acc == 4) { // Bow tie
            accSvg = t.species == 7
                ? string.concat('<polygon points="56,70 64,74 56,78" fill="#e74c3c"/><polygon points="72,70 64,74 72,78" fill="#e74c3c"/><circle cx="64" cy="74" r="3" fill="#c0392b"/>')
                : string.concat('<polygon points="56,116 64,120 56,124" fill="#e74c3c"/><polygon points="72,116 64,120 72,124" fill="#e74c3c"/><circle cx="64" cy="120" r="3" fill="#c0392b"/>');
        } else if (t.acc == 5) { // Mystic orb
            accSvg = '<circle cx="114" cy="100" r="12" fill="#00d2d3" opacity="0.85"/><circle cx="111" cy="97" r="4" fill="#fff" opacity="0.9"/>';
        }

        string memory evolutionSvg = "";
        if (stage == 1) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#fff" stroke-width="2" opacity="0.28"/>';
        } else if (stage == 2) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#fff" stroke-width="2" opacity="0.28"/><path d="M18 28 L24 18 L30 28 M98 28 L104 18 L110 28" stroke="#ffd700" stroke-width="4" fill="none" stroke-linecap="round"/>';
        } else if (stage == 3) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#ffd700" stroke-width="3" opacity="0.5"/><path d="M16 30 L24 16 L32 30 M96 30 L104 16 L112 30 M34 16 L40 6 L46 16 M82 16 L88 6 L94 16" stroke="#ffd700" stroke-width="4" fill="none" stroke-linecap="round"/>';
        }

        string memory sceneSvg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">',
            defsSvg,
            '<rect width="128" height="148" fill="', bg, '"/>',
            habitatSvg,
            '<ellipse cx="64" cy="137" rx="45" ry="8" fill="', dark, '" opacity=".24"/>',
            evolutionSvg,
            '<g>'
        );
        string memory characterSvg = string.concat(
            earsSvg,
            limbsSvg,
            bodySvg,
            shineSvg,
            speciesSvg,
            cheeksSvg
        );
        string memory faceSvg = string.concat(
            eyesSvg,
            mouthSvg,
            accSvg,
            '</g>',
            '</svg>'
        );
        return string.concat(sceneSvg, characterSvg, faceSvg);
    }
}
