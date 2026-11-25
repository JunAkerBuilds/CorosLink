// The intro's watch, drawn: metal case, ticked bezel, knurled crown, mint button and a vented strap fading out, with
// the animated "This is fine" face behind the glass (a still frame when motion is reduced, intro.css).
const CX = 150, CY = 220;

/** The bezel's 60 ticks: long at 12/3/6/9, medium every five, short between. */
function ticks() {
  return Array.from({ length: 60 }, (_, i) => {
    const cardinal = i % 15 === 0, five = i % 5 === 0;
    const [r1, r2, width, alpha] = cardinal ? [104, 114, 3.6, 1] : five ? [107, 114, 2.6, 0.9] : [109, 112, 1.1, 0.45];
    const a = (i * 6 * Math.PI) / 180, sin = Math.sin(a), cos = Math.cos(a);
    return <line key={i} x1={CX + r1 * sin} y1={CY - r1 * cos} x2={CX + r2 * sin} y2={CY - r2 * cos} stroke={`rgba(255,255,255,${alpha})`} strokeWidth={width} strokeLinecap="round" />;
  });
}

/** The strap's vents: three across, three deep, at both ends. */
function vents() {
  return [17, 39, 61].flatMap((y) => [116, 142, 168].flatMap((x) => [
    <rect key={`t${x}-${y}`} x={x} y={y} width="16" height="10" rx="5" fill="#070909" />,
    <rect key={`b${x}-${y}`} x={x} y={430 - y} width="16" height="10" rx="5" fill="#070909" />,
  ]));
}

export function IntroWatch() {
  return (
    <div className="ix-watch" aria-hidden="true">
      <svg className="ix-wsvg" viewBox="0 0 300 440">
        <defs>
          <linearGradient id="ixwStrap" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#141817" /><stop offset="0.5" stopColor="#2b3331" /><stop offset="1" stopColor="#141817" /></linearGradient>
          <linearGradient id="ixwCase" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#a7b1ae" /><stop offset="0.35" stopColor="#4b5452" /><stop offset="0.62" stopColor="#262c2b" /><stop offset="1" stopColor="#7d8785" /></linearGradient>
          <linearGradient id="ixwLug" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#2d3332" /><stop offset="0.5" stopColor="#5d6765" /><stop offset="1" stopColor="#2d3332" /></linearGradient>
          <radialGradient id="ixwBezel" cx="0.5" cy="0.5" r="0.5"><stop offset="0.82" stopColor="#151a19" /><stop offset="1" stopColor="#0a0d0c" /></radialGradient>
          <linearGradient id="ixwCrown" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9aa4a1" /><stop offset="0.5" stopColor="#4a5351" /><stop offset="1" stopColor="#8b9592" /></linearGradient>
          <linearGradient id="ixwFadeG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.14" stopColor="#fff" /><stop offset="0.86" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id="ixwFade" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="440"><rect width="300" height="440" fill="url(#ixwFadeG)" /></mask>
        </defs>
        <g mask="url(#ixwFade)">
          <path d="M98 0 H202 Q206 60 214 112 H86 Q94 60 98 0 Z" fill="url(#ixwStrap)" />
          <path d="M98 440 H202 Q206 380 214 328 H86 Q94 380 98 440 Z" fill="url(#ixwStrap)" />
          {vents()}
          {["M98 0 Q94 60 86 112", "M202 0 Q206 60 214 112", "M98 440 Q94 380 86 328", "M202 440 Q206 380 214 328"].map((d) => <path key={d} d={d} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />)}
        </g>
        <rect x="80" y="86" width="140" height="268" rx="56" fill="url(#ixwLug)" />
        <rect x="270" y="158" width="22" height="34" rx="7" fill="url(#ixwCrown)" />
        {[279, 281.2, 283.4, 285.6, 287.8, 290].map((x) => <line key={x} x1={x} y1="160" x2={x} y2="190" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" />)}
        <rect x="268" y="171" width="4" height="8" rx="1" fill="#53cba1" />
        <rect x="270" y="252" width="14" height="42" rx="6" fill="#3db88c" />
        <rect x="270" y="252" width="5" height="42" rx="2" fill="rgba(0,0,0,0.25)" />
        <circle cx={CX} cy={CY} r="126" fill="url(#ixwCase)" />
        <circle cx={CX} cy={CY} r="126" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r="117" fill="url(#ixwBezel)" />
        {ticks()}
        <circle cx={CX} cy={CY} r="100" fill="#000" />
        <circle cx={CX} cy={CY} r="100" fill="none" stroke="#2a302f" strokeWidth="2" />
      </svg>
      <img className="ix-wface ix-wface-live" src="/img/intro-face-fine.webp" alt="" />
      <img className="ix-wface ix-wface-still" src="/img/intro-face-fine-still.webp" alt="" />
      <svg className="ix-wsvg" viewBox="0 0 300 440">
        <defs><linearGradient id="ixwGlare" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.28" /><stop offset="0.45" stopColor="#ffffff" stopOpacity="0.04" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></linearGradient></defs>
        <path d="M58 196 A96 96 0 0 1 190 132 A140 140 0 0 0 58 196 Z" fill="url(#ixwGlare)" />
        <circle cx={CX} cy={CY} r="96" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="6" />
      </svg>
    </div>
  );
}
