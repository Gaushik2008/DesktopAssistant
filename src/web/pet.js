// DO.IT (the voxel king) - an original voxel king on a grass block, drawn as inline SVG
// (no image assets, so it scales crisply and works offline everywhere).

const SKIN = '#f0b48a', SKIN_D = '#d6966c';
const ROBE = '#c8322f', ROBE_D = '#9c2422', TRIM = '#f4efe6';
const GOLD = '#f6c945', GOLD_D = '#c99a1c';
const GRASS = '#5fae3a', GRASS_D = '#3f8426', DIRT = '#8a5a35', DIRT_D = '#6b4426';
const STONE = '#8b8f97', STONE_D = '#6a6e76';

export function petSvg() {
  return `
<svg viewBox="0 0 150 170" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
  <!-- grass block (isometric cube) -->
  <polygon points="75,112 142,134 75,158 8,134" fill="${GRASS}"/>
  <polygon points="8,134 75,158 75,168 8,144" fill="${DIRT}"/>
  <polygon points="142,134 75,158 75,168 142,144" fill="${DIRT_D}"/>
  <polygon points="8,134 75,158 75,162 8,138" fill="${GRASS_D}"/>
  <polygon points="142,134 75,158 75,162 142,138" fill="${GRASS_D}" opacity=".8"/>
  <!-- stone throne back -->
  <polygon points="92,92 124,102 124,126 92,116" fill="${STONE}"/>
  <polygon points="92,92 106,86 138,96 124,102" fill="${STONE_D}"/>
  <polygon points="124,102 138,96 138,120 124,126" fill="${STONE_D}" opacity=".85"/>

  <g class="king">
    <!-- robe / body -->
    <rect x="52" y="78" width="36" height="34" fill="${ROBE}"/>
    <rect x="52" y="78" width="6" height="34" fill="${ROBE_D}"/>
    <rect x="52" y="78" width="36" height="5" fill="${TRIM}"/>
    <rect x="66" y="83" width="8" height="29" fill="${TRIM}"/>
    <!-- arms -->
    <rect x="44" y="80" width="9" height="22" fill="${ROBE_D}"/>
    <rect x="87" y="80" width="9" height="22" fill="${ROBE}"/>
    <rect x="44" y="100" width="9" height="6" fill="${SKIN}"/>
    <rect x="87" y="100" width="9" height="6" fill="${SKIN}"/>
    <!-- legs -->
    <rect x="56" y="112" width="12" height="8" fill="#5b3a29"/>
    <rect x="72" y="112" width="12" height="8" fill="#5b3a29"/>
    <!-- head -->
    <rect x="50" y="42" width="40" height="38" fill="${SKIN}"/>
    <rect x="50" y="42" width="5" height="38" fill="${SKIN_D}"/>
    <!-- beard -->
    <rect x="50" y="66" width="40" height="14" fill="#b8793e"/>
    <rect x="60" y="66" width="20" height="5" fill="${SKIN}"/>
    <!-- eyes -->
    <g class="eye"><rect x="58" y="52" width="7" height="8" fill="#fff"/><rect x="60" y="54" width="4" height="5" fill="#222"/></g>
    <g class="eye"><rect x="75" y="52" width="7" height="8" fill="#fff"/><rect x="77" y="54" width="4" height="5" fill="#222"/></g>
    <!-- brows -->
    <rect x="57" y="48" width="9" height="2" fill="#7a4a22"/>
    <rect x="74" y="48" width="9" height="2" fill="#7a4a22"/>
    <!-- mouth (animated while speaking) -->
    <g class="mouth" style="transform-box:fill-box;transform-origin:center"><rect x="64" y="68" width="12" height="5" fill="#5a1f1f"/></g>
    <!-- crown -->
    <rect x="48" y="30" width="44" height="13" fill="${GOLD}"/>
    <rect x="48" y="38" width="44" height="5" fill="${GOLD_D}"/>
    <rect x="48" y="20" width="8" height="11" fill="${GOLD}"/>
    <rect x="66" y="16" width="8" height="15" fill="${GOLD}"/>
    <rect x="84" y="20" width="8" height="11" fill="${GOLD}"/>
    <rect x="68" y="32" width="4" height="4" fill="#e23b3b"/>
    <rect x="52" y="33" width="3" height="3" fill="#3b82f6"/>
    <rect x="85" y="33" width="3" height="3" fill="#3b82f6"/>
  </g>
</svg>`;
}

export function mountPet(el) {
  el.innerHTML = petSvg();
}
