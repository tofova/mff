/*!
 * Pip: a small, friendly website mascot.  v1.0.0
 * One file, no dependencies, works on any site.
 *
 *   <script src="pip-mascot.js"><\/script>
 *   <script>
 *     const pip = PipMascot.mount({ theme: 'lavender', greeting: ['Hi there!', 'Welcome to my site!'] });
 *     pip.say('Hello!');   // speech bubble
 *     pip.do('dance');     // wave hop dance spin love wink think lookAround yawn sleep dizzy giggle
 *   <\/script>
 *
 * Give a link or button a line to say:   <a href="/pricing" data-pip-hint="Psst, there's a free plan!">Pricing</a>
 * Stop Pip reacting inside an area:      <nav data-pip-ignore>…</nav>
 *
 * This file is this site's own copy, taken from the "Pip Website Mascot"
 * artifact (v1.0.0). The artifact is never changed; this copy may be.
 * Changed here so far:
 *   - LINES.thoughts: removed the line "Hmm. Pizza or noodles?"
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.PipMascot) return;

  const VERSION = '1.0.0';

  const THEMES = {
    lavender: { body: '#A391FF', hi: '#D3CAFF', shade: '#7563EE', belly: '#F1EEFF', limb: '#907FFA', foot: '#6B5ADF', leaf: '#62D6A0', leafDark: '#2E9F6C', cheek: '#FF8DB5' },
    mint:     { body: '#5FD6B0', hi: '#B3F4DE', shade: '#2CA982', belly: '#E8FDF5', limb: '#4CC8A2', foot: '#25977A', leaf: '#FFB547', leafDark: '#E08718', cheek: '#FF8EA6' },
    peach:    { body: '#FFA98C', hi: '#FFD9CB', shade: '#EE7A56', belly: '#FFF1EB', limb: '#FA9677', foot: '#D9643F', leaf: '#62D6A0', leafDark: '#2E9F6C', cheek: '#FF6E98' },
    sky:      { body: '#72C3FF', hi: '#C0E6FF', shade: '#3A95E8', belly: '#ECF7FF', limb: '#5CB3FB', foot: '#2C82D4', leaf: '#62D6A0', leafDark: '#2E9F6C', cheek: '#FF8DB5' },
  };

  const DEFAULTS = {
    name: 'Pip',
    theme: 'lavender',
    mode: 'corner',            // 'corner' = fixed to the viewport, 'inline' = inside `container`
    container: null,           // element or selector, for mode: 'inline'
    side: 'right',             // corner side: 'right' | 'left'
    size: 140,                 // px, or any CSS length such as 'min(300px, 60vw)'
    greet: true,               // wave and say the greeting on load
    greeting: ['Hi there!', "I'm Pip. Nice to meet you!"],
    messages: [
      'Psst… click me!',
      'I like where your cursor is going.',
      'Need a hand? I have two tiny ones.',
      "Take your time. I'll be right here.",
      "Fun fact: I'm made of 100% SVG.",
    ],
    hints: true,               // react to hovered links and buttons
    hintSelector: 'a[href], button, [role="button"], input[type="submit"], [data-pip-hint]',
    idleTricks: true,          // random tricks when nothing else is happening
    chatter: true,             // say one of `messages` now and then
    trickEvery: [7000, 13000], // ms between idle tricks
    sleepAfter: 25000,         // ms without activity before a nap; 0 = never
    stareFor: 3500,            // ms of watching a still cursor before glancing around
  };

  const LINES = {
    thoughts: ['Hmm…', 'Hmm… what was I doing?', 'Thinking very hard…'],
    giggles: ['Hehe, that tickles!', 'Boop!', 'Hee hee!', 'Again! Again!'],
    dizzy: ['Whoa… the room is spinning.', 'Easy there… @_@', 'Wheee… oof.'],
    wake: ['Oh! Hi again!', "I wasn't sleeping. Promise.", 'Huh? Oh, hello!'],
    miss: ["Hey, where'd you go?", 'Hello? Anyone there?'],
    back: ['Welcome back!', "Oh hey, you're back!"],
  };

  const CSS = `
.pip-host{--pip-size:140px;--pip-ink:#2B2146;--pip-mouth:#5B1F45;--pip-tongue:#FF7D9C;
  position:fixed;z-index:2147483000;right:max(16px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));
  width:var(--pip-size);height:var(--pip-size);pointer-events:none;line-height:normal;
  -webkit-user-select:none;user-select:none;
  font-family:var(--pip-font,ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",system-ui,-apple-system,sans-serif)}
.pip-host.pip-side-left{right:auto;left:max(16px,env(safe-area-inset-left))}
.pip-host.pip-inline{position:relative;inset:auto;margin:0 auto;z-index:auto;flex:none}
.pip-host *{box-sizing:border-box}
.pip-host .pip-stage{position:absolute;inset:0;transform-origin:50% 93%}
.pip-host.pip-enter .pip-stage{animation:pip-enter .75s cubic-bezier(.2,.75,.35,1) both}
.pip-host .pip-btn{all:unset;position:absolute;inset:0;display:block;pointer-events:none;border-radius:42%;-webkit-tap-highlight-color:transparent}
.pip-host .pip-btn:focus-visible{outline:3px solid var(--pip-shade);outline-offset:3px}
.pip-host .pip-svg{display:block;width:100%;height:100%;overflow:visible}
.pip-host .pip-hit{pointer-events:visiblePainted;cursor:pointer}

.pip-host .pip-st-hi{stop-color:var(--pip-hi)}
.pip-host .pip-st-body{stop-color:var(--pip-body)}
.pip-host .pip-st-shade{stop-color:var(--pip-shade)}
.pip-host .pip-shadow{fill:var(--pip-ink);opacity:.13;transform-box:fill-box;transform-origin:center}
.pip-host .pip-foot{fill:var(--pip-foot);transform-box:fill-box;transform-origin:50% 100%}
.pip-host .pip-limb{fill:var(--pip-limb)}
.pip-host .pip-body{stroke:var(--pip-shade);stroke-opacity:.35;stroke-width:1.2}
.pip-host .pip-belly{fill:var(--pip-belly);opacity:.5}
.pip-host .pip-shine{fill:#fff;opacity:.5}
.pip-host .pip-leaf{fill:var(--pip-leaf)}
.pip-host .pip-stem{fill:none;stroke:var(--pip-leaf-dark);stroke-width:4.2;stroke-linecap:round}
.pip-host .pip-vein{fill:none;stroke:var(--pip-leaf-dark);stroke-width:1.5;stroke-linecap:round;opacity:.5}
.pip-host .pip-cheeks{fill:var(--pip-cheek);opacity:.5;transition:opacity .35s ease}
.pip-host.pip-blush .pip-cheeks,.pip-host[data-eyes="happy"] .pip-cheeks,.pip-host[data-eyes="heart"] .pip-cheeks{opacity:.9}
.pip-host .pip-ink{fill:var(--pip-ink)}
.pip-host .pip-glint{fill:#fff}
.pip-host .pip-line{fill:none;stroke:var(--pip-ink);stroke-width:3.6;stroke-linecap:round;stroke-linejoin:round}
.pip-host .pip-line-bold{stroke-width:4.2}
.pip-host .pip-line-thin{stroke-width:2.3}
.pip-host .pip-mouth-in{fill:var(--pip-mouth)}
.pip-host .pip-tongue{fill:var(--pip-tongue)}
.pip-host .pip-heart{fill:#FF4F86}
.pip-host .pip-star{fill:#FFC53D}
.pip-host .pip-orbit{opacity:0;transition:opacity .25s ease}
.pip-host.pip-dizzy .pip-orbit{opacity:1}

.pip-host .pip-e,.pip-host .pip-m{display:none}
.pip-host[data-eyes="open"] .pip-e-open,
.pip-host[data-eyes="happy"] .pip-e-happy,
.pip-host[data-eyes="closed"] .pip-e-closed,
.pip-host[data-eyes="heart"] .pip-e-heart,
.pip-host[data-eyes="dizzy"] .pip-e-dizzy,
.pip-host[data-eyes="wink"] .pip-eye-l .pip-e-open,
.pip-host[data-eyes="wink"] .pip-eye-r .pip-e-happy,
.pip-host[data-mouth="smile"] .pip-m-smile,
.pip-host[data-mouth="open"] .pip-m-open,
.pip-host[data-mouth="grin"] .pip-m-grin,
.pip-host[data-mouth="o"] .pip-m-o,
.pip-host[data-mouth="cat"] .pip-m-cat,
.pip-host[data-mouth="wavy"] .pip-m-wavy,
.pip-host[data-mouth="hmm"] .pip-m-hmm{display:inline}

.pip-host .pip-bob,.pip-host .pip-tilt,.pip-host .pip-breathe{transform-box:view-box;transform-origin:120px 222px}
.pip-host .pip-bob{transition:transform .6s cubic-bezier(.34,1.3,.64,1)}
.pip-host .pip-breathe{animation:pip-breathe 3.6s ease-in-out infinite}
.pip-host .pip-eye-in,.pip-host .pip-arm-rot,.pip-host .pip-sprout-rot,.pip-host .pip-sprout-spring,
.pip-host .pip-e-open,.pip-host .pip-e-heart,.pip-host .pip-m{transform-box:view-box;transform-origin:0 0}
.pip-host .pip-eye-in{transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.pip-host.pip-curious .pip-eye-in{transform:scale(1.14)}
.pip-host.pip-startled .pip-eye-in{transform:scale(1.26)}
.pip-host.pip-blink .pip-e-open{animation:pip-blink .17s ease-in-out}
.pip-host .pip-e-heart{animation:pip-pulse .55s ease-in-out infinite}
.pip-host .pip-e-dizzy{transform-box:fill-box;transform-origin:center;animation:pip-rot 1s linear infinite}
.pip-host .pip-arm-rot{transition:transform .45s cubic-bezier(.34,1.56,.64,1)}
.pip-host .pip-arm-l .pip-arm-rot{transform:rotate(28deg)}
.pip-host .pip-arm-r .pip-arm-rot{transform:rotate(-28deg)}
.pip-host.pip-arms-up .pip-arm-l .pip-arm-rot{transform:rotate(152deg)}
.pip-host.pip-arms-up .pip-arm-r .pip-arm-rot{transform:rotate(-152deg)}
.pip-host .pip-sprout-rot{animation:pip-sway 3.8s ease-in-out infinite}
.pip-host.pip-sleeping .pip-sprout-rot{animation:none;transform:rotate(30deg);transition:transform 1.2s ease}
.pip-host.pip-sleeping .pip-bob{transform:translateY(3px) scale(1.035,.955)}
.pip-host.pip-sleeping .pip-breathe{animation:pip-breathe-deep 4.4s ease-in-out infinite}
.pip-host.pip-sleeping .pip-m-o{transform:scale(.62)}

.pip-host.pip-wave .pip-arm-r .pip-arm-rot{animation:pip-wave 1.9s ease-in-out}
.pip-host.pip-wave .pip-bob{animation:pip-wave-body 1.9s ease-in-out}
.pip-host.pip-hop .pip-bob{animation:pip-hop .8s cubic-bezier(.3,.7,.4,1)}
.pip-host.pip-hop .pip-shadow{animation:pip-shadow-hop .8s cubic-bezier(.3,.7,.4,1)}
.pip-host.pip-dance .pip-bob{animation:pip-dance .66s ease-in-out 4}
.pip-host.pip-dance .pip-arm-l .pip-arm-rot{animation:pip-dance-l .66s ease-in-out 4}
.pip-host.pip-dance .pip-arm-r .pip-arm-rot{animation:pip-dance-r .66s ease-in-out 4}
.pip-host.pip-dance .pip-foot-l{animation:pip-tap .66s ease-in-out 4}
.pip-host.pip-dance .pip-foot-r{animation:pip-tap .66s ease-in-out .33s 4}
.pip-host.pip-spin .pip-bob{animation:pip-spin 1.1s cubic-bezier(.45,0,.55,1)}
.pip-host.pip-spin .pip-front{animation:pip-backside 1.1s linear}
.pip-host.pip-spin .pip-shadow{animation:pip-shadow-spin 1.1s ease-in-out}
.pip-host.pip-love .pip-bob{animation:pip-love .7s ease-in-out 3}
.pip-host.pip-wink .pip-bob{animation:pip-wink-tilt 1.4s ease-in-out}
.pip-host.pip-giggle .pip-bob{animation:pip-giggle .16s ease-in-out 8}
.pip-host.pip-dizzy .pip-bob{animation:pip-wobble .7s ease-in-out 4}
.pip-host.pip-yawn .pip-bob{animation:pip-stretch 2.2s ease-in-out}
.pip-host.pip-yawn .pip-m-o{animation:pip-yawn-mouth 2.2s ease-in-out}
.pip-host.pip-startle .pip-bob{animation:pip-startle .7s cubic-bezier(.3,.7,.4,1)}

.pip-host .pip-fxl{position:absolute;inset:0;pointer-events:none;overflow:visible}
.pip-host .pip-fx{position:absolute;width:13%;height:13%;margin:-6.5% 0 0 -6.5%;pointer-events:none;
  animation:pip-float var(--d,1.6s) cubic-bezier(.2,.7,.3,1) forwards}
.pip-host .pip-fx svg{display:block;width:100%;height:100%;overflow:visible}
.pip-host .pip-fx-t{display:flex;align-items:center;justify-content:center;font-weight:800;line-height:1;
  color:var(--pip-ink);font-size:calc(var(--pip-size) * .13)}

.pip-host .pip-bubble{position:absolute;right:56%;bottom:84%;width:max-content;max-width:min(250px,64vw);
  padding:.62em .95em .68em;background:var(--pip-bubble-bg,#fff);color:var(--pip-bubble-ink,#2B2146);
  font-size:clamp(13px,calc(var(--pip-size) * .095),17px);font-weight:600;line-height:1.3;letter-spacing:.005em;
  text-align:left;white-space:normal;border-radius:1.15em 1.15em .3em 1.15em;
  box-shadow:0 12px 28px -10px rgba(43,33,70,.35),0 2px 6px rgba(43,33,70,.1);
  transform-origin:100% 100%;opacity:0;transform:translate(8px,10px) scale(.35);
  transition:opacity .15s ease,transform .4s cubic-bezier(.34,1.56,.64,1);pointer-events:none}
.pip-host .pip-bubble.pip-show{opacity:1;transform:none}
.pip-host .pip-bubble::after{content:"";position:absolute;right:-7px;bottom:0;width:13px;height:13px;
  background:inherit;clip-path:polygon(0 0,100% 100%,0 100%)}
.pip-host.pip-side-left .pip-bubble{right:auto;left:56%;border-radius:1.15em 1.15em 1.15em .3em;transform-origin:0 100%}
.pip-host.pip-side-left .pip-bubble::after{right:auto;left:-7px;clip-path:polygon(100% 0,100% 100%,0 100%)}
.pip-host.pip-inline .pip-bubble{right:auto;left:50%;bottom:90%;translate:-50% 0;max-width:min(260px,86vw);
  border-radius:1.15em;transform-origin:50% 100%;transform:translateY(10px) scale(.35)}
.pip-host.pip-inline .pip-bubble.pip-show{transform:none}
.pip-host.pip-inline .pip-bubble::after{right:auto;left:calc(50% - 8px);bottom:-7px;width:16px;height:8px;
  clip-path:polygon(0 0,100% 0,50% 100%)}
.pip-host .pip-rest{visibility:hidden}

@keyframes pip-enter{0%{opacity:0;transform:translateY(38%) scale(.55)}55%{opacity:1;transform:translateY(-5%) scale(1.05,.95)}75%{transform:translateY(0) scale(.97,1.03)}100%{opacity:1;transform:none}}
@keyframes pip-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(.988,1.022)}}
@keyframes pip-breathe-deep{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.965)}}
@keyframes pip-blink{0%,100%{transform:scaleY(1)}45%,55%{transform:scaleY(.1)}}
@keyframes pip-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.16)}}
@keyframes pip-rot{to{transform:rotate(360deg)}}
@keyframes pip-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}
@keyframes pip-wave{0%{transform:rotate(-28deg)}14%{transform:rotate(-150deg)}24%{transform:rotate(-122deg)}34%{transform:rotate(-160deg)}44%{transform:rotate(-122deg)}54%{transform:rotate(-160deg)}64%{transform:rotate(-122deg)}76%{transform:rotate(-148deg)}100%{transform:rotate(-28deg)}}
@keyframes pip-wave-body{0%,100%{transform:rotate(0)}20%,75%{transform:rotate(-3deg)}}
@keyframes pip-hop{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.1,.88)}40%{transform:translateY(-44px) scale(.93,1.08)}55%{transform:translateY(-50px) scale(1,1)}76%{transform:translateY(0) scale(1.13,.86)}89%{transform:translateY(0) scale(.97,1.03)}}
@keyframes pip-shadow-hop{0%,100%{transform:scale(1);opacity:.13}15%{transform:scale(1.08);opacity:.15}55%{transform:scale(.6);opacity:.06}76%{transform:scale(1.12);opacity:.16}}
@keyframes pip-dance{0%,50%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-9px) rotate(-7deg)}75%{transform:translateY(-9px) rotate(7deg)}}
@keyframes pip-dance-l{0%,50%,100%{transform:rotate(28deg)}25%{transform:rotate(140deg)}}
@keyframes pip-dance-r{0%,50%,100%{transform:rotate(-28deg)}75%{transform:rotate(-140deg)}}
@keyframes pip-tap{0%,60%,100%{transform:translateY(0)}25%{transform:translateY(-4px)}}
@keyframes pip-spin{0%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.08,.9)}30%{transform:translateY(-28px) scale(.04,1.05)}50%{transform:translateY(-34px) scale(-1,1.05)}70%{transform:translateY(-28px) scale(.04,1.05)}88%{transform:translateY(0) scale(1.06,.94)}100%{transform:translateY(0) scale(1,1)}}
@keyframes pip-backside{0%,29%{opacity:1}31%,69%{opacity:0}71%,100%{opacity:1}}
@keyframes pip-shadow-spin{0%,100%{transform:scale(1);opacity:.13}50%{transform:scale(.7);opacity:.07}}
@keyframes pip-love{0%,100%{transform:translateY(0) scale(1,1)}35%{transform:translateY(-7px) scale(.98,1.03)}70%{transform:translateY(0) scale(1.03,.97)}}
@keyframes pip-wink-tilt{0%,100%{transform:rotate(0)}18%,78%{transform:rotate(-6deg)}}
@keyframes pip-giggle{0%,100%{transform:rotate(0) scale(1,1)}25%{transform:rotate(-3.5deg) scale(1.02,.98)}75%{transform:rotate(3.5deg) scale(1.02,.98)}}
@keyframes pip-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
@keyframes pip-stretch{0%,100%{transform:scale(1,1)}30%,70%{transform:scale(.95,1.07)}}
@keyframes pip-yawn-mouth{0%,100%{transform:scale(1)}30%,70%{transform:scale(1.6,2)}}
@keyframes pip-startle{0%,100%{transform:translateY(0) scale(1,1)}22%{transform:translateY(-24px) scale(.95,1.07)}48%{transform:translateY(0) scale(1.07,.93)}70%{transform:scale(.98,1.02)}}
@keyframes pip-float{0%{opacity:0;transform:translate(0,0) scale(.3) rotate(0)}18%{opacity:1;transform:translate(calc(var(--dx) * .18),calc(var(--dy) * .18)) scale(var(--s,1)) rotate(calc(var(--r) * .3))}75%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(calc(var(--s,1) * .85)) rotate(var(--r))}}

@media (prefers-reduced-motion:reduce){
  .pip-host .pip-stage,.pip-host .pip-bob,.pip-host .pip-breathe,.pip-host .pip-sprout-rot,.pip-host .pip-shadow,.pip-host .pip-foot,.pip-host .pip-front{animation:none!important}
  .pip-host .pip-fx{animation-duration:1ms!important}
}
`;

  const HEART = 'M0 10C-4.5 6.4 -12.5 1.6 -12.5 -4.6C-12.5 -9 -9.2 -11.8 -5.8 -11.8C-3 -11.8 -1 -10.2 0 -8.2C1 -10.2 3 -11.8 5.8 -11.8C9.2 -11.8 12.5 -9 12.5 -4.6C12.5 1.6 4.5 6.4 0 10Z';
  const STAR = 'M0 -7C.8 -2.2 2.2 -.8 7 0C2.2 .8 .8 2.2 0 7C-.8 2.2 -2.2 .8 -7 0C-2.2 -.8 -.8 -2.2 0 -7Z';

  const FX_SVG = {
    heart: '<svg viewBox="-13 -13 26 26"><path class="pip-heart" d="' + HEART + '"/></svg>',
    star: '<svg viewBox="-8 -8 16 16"><path class="pip-star" d="' + STAR + '"/></svg>',
  };
  const FX_TEXT = { note: '♪', note2: '♫', z: 'z', Z: 'Z', q: '?', bang: '!' };

  function eye(side, x) {
    return '<g class="pip-eye pip-eye-' + side + '" transform="translate(' + x + ' 131)"><g class="pip-eye-in">' +
      '<g class="pip-e pip-e-open"><ellipse class="pip-ink" rx="11" ry="13.5"/>' +
        '<circle class="pip-glint" cx="3.7" cy="-5.2" r="4.1"/><circle class="pip-glint" cx="-4" cy="5.4" r="1.9"/></g>' +
      '<path class="pip-e pip-e-happy pip-line pip-line-bold" d="M-9.5 4Q0 -12 9.5 4"/>' +
      '<path class="pip-e pip-e-closed pip-line pip-line-bold" d="M-9.5 -1Q0 9 9.5 -1"/>' +
      '<path class="pip-e pip-e-heart pip-heart" d="' + HEART + '"/>' +
      '<path class="pip-e pip-e-dizzy pip-line pip-line-thin" d="M0 0A2.6 2.6 0 0 1 5.2 0A5.2 5.2 0 0 1 -5.2 0A7.8 7.8 0 0 1 10.4 0A10.4 10.4 0 0 1 -10.4 0"/>' +
    '</g></g>';
  }

  function svgMarkup(id) {
    return '<svg class="pip-svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + id + '-g" cx="38%" cy="30%" r="80%" fx="34%" fy="24%">' +
        '<stop offset="0" class="pip-st-hi"/><stop offset=".52" class="pip-st-body"/><stop offset="1" class="pip-st-shade"/>' +
      '</radialGradient></defs>' +
      '<ellipse class="pip-shadow" cx="120" cy="224" rx="56" ry="8.5"/>' +
      '<g class="pip-bob"><g class="pip-tilt"><g class="pip-breathe">' +
        '<ellipse class="pip-foot pip-foot-l pip-hit" cx="96" cy="214" rx="16" ry="10"/>' +
        '<ellipse class="pip-foot pip-foot-r pip-hit" cx="144" cy="214" rx="16" ry="10"/>' +
        '<g transform="translate(120 72)"><g class="pip-sprout-spring"><g class="pip-sprout-rot">' +
          '<path class="pip-stem" d="M0 6C0 -4 1 -11 4 -18"/>' +
          '<path class="pip-leaf pip-hit" d="M3 -16C-3 -27 -16 -29 -23 -22C-17 -13 -6 -11 3 -16Z"/>' +
          '<path class="pip-leaf pip-hit" d="M4 -18C8 -31 22 -36 30 -29C26 -19 14 -14 4 -18Z"/>' +
          '<path class="pip-vein" d="M1 -16.5C-5 -19.5 -11 -21.5 -17 -21.5"/>' +
          '<path class="pip-vein" d="M6 -19C11 -23 17 -26.5 24 -28"/>' +
        '</g></g></g>' +
        '<path class="pip-body pip-hit" fill="url(#' + id + '-g)" d="M120 64C166 64 196 104 198 152C200 194 170 218 120 218C70 218 40 194 42 152C44 104 74 64 120 64Z"/>' +
        '<g class="pip-shine"><ellipse cx="84" cy="101" rx="15" ry="8.5" transform="rotate(-38 84 101)"/><circle cx="104" cy="85" r="3.8"/></g>' +
        '<g class="pip-front">' +
          '<ellipse class="pip-belly" cx="120" cy="186" rx="44" ry="24"/>' +
          '<g class="pip-face">' +
            '<g class="pip-cheeks"><ellipse cx="77" cy="153" rx="11.5" ry="7"/><ellipse cx="163" cy="153" rx="11.5" ry="7"/></g>' +
            '<g class="pip-eyes">' + eye('l', 96) + eye('r', 144) + '</g>' +
            '<g transform="translate(120 152)">' +
              '<path class="pip-m pip-m-smile pip-line" d="M-8 -2.5Q0 5.5 8 -2.5"/>' +
              '<g class="pip-m pip-m-open"><path class="pip-mouth-in" d="M-9 -3.5H9Q8.5 9 0 9Q-8.5 9 -9 -3.5Z"/><path class="pip-tongue" d="M-5 6.2Q0 2.6 5 6.2Q3.6 8.7 0 8.8Q-3.6 8.7 -5 6.2Z"/></g>' +
              '<g class="pip-m pip-m-grin"><path class="pip-mouth-in" d="M-12 -4H12Q11 11 0 11Q-11 11 -12 -4Z"/><path class="pip-tongue" d="M-6.5 7.6Q0 3 6.5 7.6Q4.6 10.6 0 10.7Q-4.6 10.6 -6.5 7.6Z"/></g>' +
              '<ellipse class="pip-m pip-m-o pip-mouth-in" cx="0" cy="1.5" rx="5" ry="6"/>' +
              '<path class="pip-m pip-m-cat pip-line" d="M-9 -1.5Q-4.5 4.5 0 -1.5Q4.5 4.5 9 -1.5"/>' +
              '<path class="pip-m pip-m-wavy pip-line" d="M-10 1Q-7.5 -2 -5 1T0 1T5 1T10 1"/>' +
              '<path class="pip-m pip-m-hmm pip-line" d="M-3 .5Q2 2.5 7 -.5"/>' +
            '</g>' +
          '</g>' +
        '</g>' +
        '<g class="pip-arm pip-arm-l" transform="translate(51 147)"><g class="pip-arm-rot"><ellipse class="pip-limb pip-hit" cx="0" cy="14" rx="10.5" ry="17"/></g></g>' +
        '<g class="pip-arm pip-arm-r" transform="translate(189 147)"><g class="pip-arm-rot"><ellipse class="pip-limb pip-hit" cx="0" cy="14" rx="10.5" ry="17"/></g></g>' +
        '<g class="pip-orbit" transform="translate(120 60)">' +
          '<path class="pip-star pip-orb" d="' + STAR + '"/><path class="pip-star pip-orb" d="' + STAR + '"/><path class="pip-star pip-orb" d="' + STAR + '"/>' +
        '</g>' +
      '</g></g></g>' +
    '</svg>';
  }

  // ---------------------------------------------------------------- helpers
  let uid = 0;
  const CANCEL = { cancelled: true };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const weighted = (pairs) => {
    let total = 0;
    pairs.forEach((p) => { total += p[1]; });
    let r = Math.random() * total;
    for (let i = 0; i < pairs.length; i++) { r -= pairs[i][1]; if (r <= 0) return pairs[i][0]; }
    return pairs[0][0];
  };
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(motionQuery && motionQuery.matches);
  const now = () => performance.now();

  function injectStyles() {
    if (document.getElementById('pip-mascot-css')) return;
    const style = document.createElement('style');
    style.id = 'pip-mascot-css';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------- mount
  function mount(options) {
    const cfg = Object.assign({}, DEFAULTS, options || {});
    injectStyles();

    const id = 'pipm' + (++uid);
    const host = document.createElement('div');
    host.className = 'pip-host pip-enter';
    host.setAttribute('data-eyes', 'open');
    host.setAttribute('data-mouth', 'smile');
    host.innerHTML =
      '<div class="pip-stage">' +
        '<button type="button" class="pip-btn" aria-label="' + esc(cfg.name) + ', the site mascot. Press to play.">' + svgMarkup(id) + '</button>' +
        '<div class="pip-fxl" aria-hidden="true"></div>' +
        '<div class="pip-bubble" aria-hidden="true"><span class="pip-typed"></span><span class="pip-rest"></span></div>' +
      '</div>';

    const $ = (s) => host.querySelector(s);
    const btn = $('.pip-btn');
    const svg = $('.pip-svg');
    const fxLayer = $('.pip-fxl');
    const bubble = $('.pip-bubble');
    const typedEl = $('.pip-typed');
    const restEl = $('.pip-rest');
    const tiltEl = $('.pip-tilt');
    const faceEl = $('.pip-face');
    const eyesEl = $('.pip-eyes');
    const sproutEl = $('.pip-sprout-spring');
    const orbs = Array.prototype.slice.call(host.querySelectorAll('.pip-orb'));

    const S = { eyes: null, mouth: null, hover: false, talking: false, talkOpen: false, sleeping: false, lookOverride: null };
    let destroyed = false;
    let current = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    // ---- look & placement
    function setTheme(theme) {
      const t = typeof theme === 'string' ? (THEMES[theme] || THEMES.lavender) : Object.assign({}, THEMES.lavender, theme || {});
      Object.keys(t).forEach((k) => host.style.setProperty('--pip-' + kebab(k), t[k]));
      cfg.theme = theme;
    }
    function setSize(size) {
      cfg.size = size;
      host.style.setProperty('--pip-size', typeof size === 'number' ? size + 'px' : String(size));
    }
    function setMode(mode, container) {
      cfg.mode = mode === 'inline' ? 'inline' : 'corner';
      if (container) cfg.container = container;
      host.classList.toggle('pip-inline', cfg.mode === 'inline');
      host.classList.toggle('pip-side-left', cfg.mode !== 'inline' && cfg.side === 'left');
      let parent = document.body;
      if (cfg.mode === 'inline') {
        const c = typeof cfg.container === 'string' ? document.querySelector(cfg.container) : cfg.container;
        if (c) parent = c;
      }
      if (parent && host.parentNode !== parent) {
        parent.appendChild(host);
        host.classList.remove('pip-enter');
        void host.offsetWidth;
        host.classList.add('pip-enter');
        later(() => host.classList.remove('pip-enter'), 900);
      }
    }

    // ---- expression
    function render() {
      let eyes = S.eyes || (S.hover && !S.sleeping ? 'happy' : 'open');
      let mouth = S.mouth || (S.hover && !S.sleeping ? 'cat' : 'smile');
      if (S.talking && S.talkOpen && (mouth === 'smile' || mouth === 'cat' || mouth === 'grin')) mouth = 'open';
      if (host.getAttribute('data-eyes') !== eyes) host.setAttribute('data-eyes', eyes);
      if (host.getAttribute('data-mouth') !== mouth) host.setAttribute('data-mouth', mouth);
    }

    function blink(double) {
      const e = host.getAttribute('data-eyes');
      if (destroyed || (e !== 'open' && e !== 'wink')) return;
      host.classList.remove('pip-blink');
      void host.offsetWidth;
      host.classList.add('pip-blink');
      later(() => host.classList.remove('pip-blink'), 190);
      if (double) later(() => blink(false), 300);
    }
    (function scheduleBlink() {
      later(() => { if (!S.sleeping && !document.hidden) blink(Math.random() < 0.22); scheduleBlink(); }, rand(2200, 5600));
    })();

    // ---- speech bubble
    let sayTimers = [];
    function hush() {
      sayTimers.forEach(clearTimeout);
      sayTimers = [];
      bubble.classList.remove('pip-show');
      S.talking = false;
      S.talkOpen = false;
      render();
    }
    function say(text, opts) {
      opts = opts || {};
      if (destroyed) return 0;
      sayTimers.forEach(clearTimeout);
      sayTimers = [];
      const chars = Array.from(String(text == null ? '' : text));
      if (!chars.length) { hush(); return 0; }
      typedEl.textContent = '';
      restEl.textContent = chars.join('');
      bubble.classList.add('pip-show');
      S.talking = true;
      const speed = reducedMotion() ? 0 : 26;
      let i = 0;
      const step = () => {
        i = speed ? i + 1 : chars.length;
        typedEl.textContent = chars.slice(0, i).join('');
        restEl.textContent = chars.slice(i).join('');
        if (i % 4 === 0) { S.talkOpen = !S.talkOpen; render(); }
        if (i < chars.length) sayTimers.push(setTimeout(step, speed));
        else { S.talking = false; S.talkOpen = false; render(); }
      };
      sayTimers.push(setTimeout(step, speed ? 90 : 0));
      const typeMs = speed * chars.length + 90;
      const hold = opts.hold != null ? opts.hold : clamp(1200 + chars.length * 45, 1600, 4200);
      sayTimers.push(setTimeout(hush, typeMs + hold));
      return typeMs + hold;
    }

    // ---- particles (x, y and offsets are in the 240×240 drawing's units)
    function fx(kind, x, y, o) {
      o = o || {};
      if (destroyed) return;
      const el = document.createElement('div');
      el.className = 'pip-fx' + (FX_SVG[kind] ? '' : ' pip-fx-t');
      if (FX_SVG[kind]) el.innerHTML = FX_SVG[kind];
      else el.textContent = FX_TEXT[kind] || String(kind);
      el.style.left = (x / 2.4).toFixed(2) + '%';
      el.style.top = (y / 2.4).toFixed(2) + '%';
      const k = 100 / 31.2; // drawing units -> % of the particle's own box
      el.style.setProperty('--dx', ((o.dx || 0) * k).toFixed(1) + '%');
      el.style.setProperty('--dy', ((o.dy != null ? o.dy : -60) * k).toFixed(1) + '%');
      el.style.setProperty('--r', (o.r != null ? o.r : rand(-25, 25)).toFixed(0) + 'deg');
      el.style.setProperty('--s', String(o.s || 1));
      el.style.setProperty('--d', (o.d || 1600) + 'ms');
      const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      el.addEventListener('animationend', remove);
      later(remove, (o.d || 1600) + 500);
      fxLayer.appendChild(el);
    }

    // ---- sprout spring + gaze loop
    const pointer = { x: 0, y: 0, t: -1e9, inside: false };
    const look = { x: 0, y: 0 };
    const drift = { x: 0, y: 0, next: 0 };
    const spring = { a: 0, v: 0 };
    const last = { ex: NaN, ey: NaN, fx: NaN, fy: NaN, tilt: NaN, spr: NaN };
    let prevTilt = 0;
    let lastFrame = now();
    let raf = 0;

    function frame(t) {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      const dt = clamp((t - lastFrame) / 1000, 0.001, 0.05);
      lastFrame = t;

      let tx = 0;
      let ty = 0;
      if (S.lookOverride) { tx = S.lookOverride.x; ty = S.lookOverride.y; }
      else if (S.sleeping) { tx = 0; ty = 0.2; }
      else if (pointer.inside && t - pointer.t < cfg.stareFor) {
        const r = svg.getBoundingClientRect();
        if (r.width > 0) {
          const dx = pointer.x - (r.left + r.width * 0.5);
          const dy = pointer.y - (r.top + r.height * 0.55);
          const d = Math.hypot(dx, dy);
          const m = Math.min(1, d / Math.max(140, r.width * 1.5));
          if (d > 0.5) { tx = (dx / d) * m; ty = (dy / d) * m; }
        }
      } else {
        if (t > drift.next) {
          if (Math.random() < 0.4) { drift.x = 0; drift.y = 0; }
          else {
            const a = rand(0, Math.PI * 2);
            const m = rand(0.25, 0.7);
            drift.x = Math.cos(a) * m;
            drift.y = Math.sin(a) * m * 0.7;
          }
          if (Math.random() < 0.3) blink(false);
          drift.next = t + rand(900, 2600);
        }
        tx = drift.x;
        ty = drift.y;
      }

      const k = 1 - Math.exp(-dt * (S.lookOverride ? 8 : 11));
      look.x += (tx - look.x) * k;
      look.y += (ty - look.y) * k;
      const calm = reducedMotion() ? 0.4 : 1;
      const tilt = look.x * 5.5 * calm;

      spring.v += (-150 * spring.a - 9 * spring.v) * dt - (tilt - prevTilt) * 16;
      spring.a = clamp(spring.a + spring.v * dt, -35, 35);
      prevTilt = tilt;

      write(eyesEl, 'ex', 'ey', look.x * 6.5, look.y * 5.5);
      write(faceEl, 'fx', 'fy', look.x * 4.5, look.y * 3.5);
      if (Math.abs(tilt - last.tilt) > 0.01 || isNaN(last.tilt)) { last.tilt = tilt; tiltEl.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg)'; }
      const sa = spring.a * calm;
      if (Math.abs(sa - last.spr) > 0.01 || isNaN(last.spr)) { last.spr = sa; sproutEl.style.transform = 'rotate(' + sa.toFixed(2) + 'deg)'; }

      if (host.classList.contains('pip-dizzy')) {
        const base = (t / 1000) * 4.2;
        orbs.forEach((o, i) => {
          const a = base + i * 2.094;
          const depth = (Math.sin(a) + 1) / 2;
          o.setAttribute('transform', 'translate(' + (Math.cos(a) * 44).toFixed(1) + ' ' + (Math.sin(a) * 10).toFixed(1) + ') scale(' + (0.7 + depth * 0.5).toFixed(2) + ')');
          o.style.opacity = (0.45 + depth * 0.55).toFixed(2);
        });
      }
    }
    function write(el, kx, ky, x, y) {
      if (Math.abs(x - last[kx]) < 0.01 && Math.abs(y - last[ky]) < 0.01) return;
      last[kx] = x;
      last[ky] = y;
      el.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
    }

    // ---- action runner: one action at a time; higher or equal priority interrupts
    function run(name, opts, prio) {
      if (destroyed || !ACTIONS[name]) return false;
      prio = prio == null ? 3 : prio;
      if (current && current.prio > prio) return false;
      if (current) stop(current);
      const tok = { name: name, prio: prio, timers: new Set(), rejects: new Set(), classes: new Set(), dead: false, done: false };
      current = tok;
      const api = actionApi(tok);
      Promise.resolve()
        .then(() => ACTIONS[name](api, opts || {}))
        .catch((e) => { if (e !== CANCEL) console.warn('[Pip]', e); })
        .then(() => finish(tok));
      return true;
    }
    function stop(tok) {
      if (!tok || tok.done) return;
      tok.dead = true;
      tok.rejects.forEach((r) => r(CANCEL));
      finish(tok);
    }
    function finish(tok) {
      if (tok.done) return;
      tok.done = true;
      tok.dead = true;
      tok.timers.forEach(clearTimeout);
      tok.classes.forEach((c) => host.classList.remove(c));
      if (tok.look) S.lookOverride = null;
      if (tok.expr) { S.eyes = null; S.mouth = null; }
      if (tok.name === 'sleep') S.sleeping = false;
      if (current === tok) current = null;
      render();
    }
    function actionApi(tok) {
      const live = () => { if (tok.dead) throw CANCEL; };
      return {
        wait(ms) {
          return new Promise((resolve, reject) => {
            if (tok.dead) { reject(CANCEL); return; }
            const t = setTimeout(() => { tok.timers.delete(t); tok.rejects.delete(reject); resolve(); }, ms);
            tok.timers.add(t);
            tok.rejects.add(reject);
          });
        },
        add() {
          live();
          const cls = Array.prototype.slice.call(arguments);
          cls.forEach((c) => host.classList.remove(c));
          void host.offsetWidth; // restart CSS animations
          cls.forEach((c) => { host.classList.add(c); tok.classes.add(c); });
        },
        remove() {
          live();
          Array.prototype.slice.call(arguments).forEach((c) => { host.classList.remove(c); tok.classes.delete(c); });
        },
        eyes(v) { live(); S.eyes = v; tok.expr = true; render(); },
        mouth(v) { live(); S.mouth = v; tok.expr = true; render(); },
        look(x, y) { live(); S.lookOverride = x == null ? null : { x: x, y: y }; tok.look = true; },
        say(text, o) { live(); return say(text, o); },
        fx(kind, x, y, o) { live(); fx(kind, x, y, o); },
        kick(v) { live(); spring.v += v; },
        blink() { live(); blink(false); },
      };
    }

    // ---- the tricks
    let msgBag = [];
    const nextMessage = () => {
      if (!msgBag.length) msgBag = shuffle((cfg.messages || []).slice());
      return msgBag.pop();
    };
    let sleepGuard = { until: 0, travel: 0 };

    const ACTIONS = {
      async hello(a, o) {
        const lines = (o.lines || cfg.greeting || []).filter(Boolean);
        a.add('pip-wave');
        a.eyes('happy');
        a.mouth('grin');
        a.kick(60);
        if (lines[0]) a.say(lines[0], { hold: 1400 });
        await a.wait(750);
        a.eyes(null);
        a.mouth(null);
        await a.wait(1150);
        a.remove('pip-wave');
        for (let i = 1; i < lines.length; i++) {
          await a.wait(250);
          await a.wait(Math.min(3200, a.say(lines[i])));
        }
      },
      async wave(a) {
        a.add('pip-wave');
        a.eyes('happy');
        a.mouth('grin');
        await a.wait(1900);
      },
      async hop(a) {
        a.add('pip-hop');
        a.mouth('open');
        await a.wait(130);
        a.kick(-160);
        await a.wait(220);
        a.eyes('happy');
        await a.wait(260);
        a.kick(260);
        a.eyes(null);
        a.mouth(null);
        await a.wait(300);
      },
      async dance(a) {
        a.add('pip-dance');
        a.eyes('happy');
        a.mouth('cat');
        for (let i = 0; i < 6; i++) {
          const right = i % 2 === 1;
          a.fx(right ? 'note2' : 'note', right ? 178 : 62, 96, { dx: right ? 26 : -26, dy: -70, d: 1500 });
          a.kick(right ? 90 : -90);
          await a.wait(440);
        }
      },
      async spin(a) {
        a.add('pip-spin');
        a.eyes('happy');
        a.mouth('open');
        a.say('Wheee!', { hold: 500 });
        await a.wait(300);
        a.kick(220);
        await a.wait(700);
        a.kick(-160);
        await a.wait(250);
      },
      async love(a) {
        a.add('pip-love', 'pip-blush');
        a.eyes('heart');
        a.mouth('grin');
        for (let i = 0; i < 5; i++) {
          a.fx('heart', rand(78, 162), rand(70, 100), { dx: rand(-40, 40), dy: -rand(70, 100), s: rand(0.7, 1.1), d: 1700 });
          await a.wait(240);
        }
        await a.wait(900);
      },
      async wink(a) {
        a.add('pip-wink');
        a.eyes('wink');
        a.mouth('cat');
        a.kick(-80);
        a.fx('star', 170, 106, { dx: 22, dy: -30, r: 90, s: 0.8, d: 1100 });
        await a.wait(1350);
      },
      async think(a) {
        a.look(0.55, -0.9);
        a.mouth('hmm');
        await a.wait(450);
        await a.wait(Math.min(2200, a.say(pick(LINES.thoughts))));
        a.look(null);
        a.eyes('happy');
        a.mouth('grin');
        a.add('pip-hop');
        a.fx('star', 168, 64, { dy: -40, s: 1.1, d: 1200 });
        await a.wait(900);
      },
      async lookAround(a) {
        a.look(-1, 0.1);
        a.blink();
        await a.wait(850);
        a.look(1, 0.1);
        a.blink();
        await a.wait(950);
        a.look(0.15, -0.35);
        await a.wait(500);
      },
      async yawn(a) {
        a.add('pip-yawn');
        a.eyes('closed');
        a.mouth('o');
        await a.wait(350);
        a.add('pip-arms-up');
        await a.wait(1250);
        a.remove('pip-arms-up');
        await a.wait(600);
      },
      async sleep(a, o) {
        if (!o.skipYawn) {
          a.add('pip-yawn');
          a.eyes('closed');
          a.mouth('o');
          await a.wait(350);
          a.add('pip-arms-up');
          await a.wait(1250);
          a.remove('pip-arms-up');
          await a.wait(600);
          a.remove('pip-yawn');
        }
        a.eyes('closed');
        a.mouth('o');
        a.add('pip-sleeping');
        hush();
        S.sleeping = true;
        sleepGuard = { until: now() + (o.grace || 600), travel: 0 };
        for (;;) {
          a.fx('z', 152, 96, { dx: 34, dy: -64, r: 14, d: 2200, s: 0.8 });
          await a.wait(1100);
          a.fx('Z', 158, 90, { dx: 46, dy: -80, r: -10, d: 2400 });
          await a.wait(1500);
        }
      },
      async wake(a) {
        a.eyes('open');
        a.mouth('o');
        a.add('pip-startle', 'pip-startled', 'pip-arms-up');
        a.fx('bang', 120, 34, { dy: -30, r: 0, d: 900 });
        a.kick(240);
        await a.wait(420);
        a.remove('pip-arms-up');
        await a.wait(280);
        a.remove('pip-startled');
        a.mouth(null);
        await a.wait(Math.min(2400, a.say(pick(LINES.wake))));
      },
      async giggle(a) {
        a.add('pip-giggle', 'pip-blush');
        a.eyes('happy');
        a.mouth('grin');
        a.say(pick(LINES.giggles), { hold: 900 });
        a.fx('heart', 168, 92, { dx: 20, dy: -60, s: 0.7, d: 1300 });
        await a.wait(1350);
      },
      async dizzy(a) {
        a.add('pip-dizzy');
        a.eyes('dizzy');
        a.mouth('wavy');
        a.say(pick(LINES.dizzy), { hold: 1600 });
        await a.wait(2800);
      },
      async curious(a, o) {
        a.add('pip-curious');
        a.mouth('o');
        if (o.text) {
          await a.wait(160);
          a.mouth(null);
          await a.wait(Math.min(2600, a.say(o.text)));
        } else {
          if (Math.random() < 0.6) a.fx('q', 160, 62, { dy: -36, r: 10, d: 1100, s: 0.9 });
          await a.wait(1000);
        }
      },
      async chatter(a) {
        const msg = nextMessage();
        if (!msg) return;
        if (Math.random() < 0.5) a.add('pip-wave');
        await a.wait(Math.min(2600, a.say(msg)));
      },
      async miss(a) {
        a.mouth('o');
        a.look(-1, -0.1);
        await a.wait(650);
        a.look(1, -0.1);
        a.blink();
        await a.wait(750);
        a.look(0, -0.2);
        a.mouth(null);
        await a.wait(a.say(pick(LINES.miss), { hold: 2600 }));
      },
      async found(a) {
        a.eyes('happy');
        a.mouth('grin');
        a.add('pip-hop');
        a.say('There you are!', { hold: 1100 });
        await a.wait(900);
      },
    };

    // ---- what makes Pip do things on its own
    let lastActivity = now();
    function wake() { if (S.sleeping) run('wake', {}, 3); }
    function activity(strong) {
      lastActivity = now();
      if (strong && S.sleeping && now() > sleepGuard.until) wake();
    }

    let idleTimer = 0;
    let lastTrick = '';
    function scheduleIdle() {
      clearTimeout(idleTimer);
      timers.delete(idleTimer);
      idleTimer = later(() => {
        if (!current && !document.hidden && cfg.idleTricks) {
          const pool = [['lookAround', 3], ['hop', 2], ['wink', 1.4], ['love', 1], ['dance', 1], ['spin', 1], ['think', 1.2], ['wave', 0.6]];
          if (cfg.chatter && cfg.messages && cfg.messages.length) pool.push(['chatter', 2]);
          if (now() - lastActivity > 8000) pool.push(['yawn', 1.2]);
          let name = weighted(pool);
          for (let i = 0; i < 4 && name === lastTrick; i++) name = weighted(pool);
          lastTrick = name;
          run(name, { idle: true }, 1);
        }
        scheduleIdle();
      }, rand(cfg.trickEvery[0], cfg.trickEvery[1]));
    }

    const sleepCheck = setInterval(() => {
      if (destroyed || !cfg.sleepAfter || S.sleeping || current || document.hidden) return;
      if (now() - lastActivity > cfg.sleepAfter) run('sleep', {}, 1);
    }, 1000);

    // ---- events
    let lastPX = null;
    let lastPY = null;
    let pointerType = 'mouse';
    const onPointerMove = (e) => {
      pointerType = e.pointerType || 'mouse';
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.t = now();
      pointer.inside = true;
      if (S.sleeping && now() > sleepGuard.until && lastPX != null) {
        sleepGuard.travel += Math.abs(e.clientX - lastPX) + Math.abs(e.clientY - lastPY);
        if (sleepGuard.travel > 140) wake();
      }
      lastPX = e.clientX;
      lastPY = e.clientY;
      activity(false);
    };
    const onPointerDown = (e) => {
      pointerType = e.pointerType || 'mouse';
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.t = now();
      pointer.inside = true;
      activity(true);
    };
    const onStrong = () => activity(true);

    let hintEl = null;
    let hintAt = -1e9;
    const onOver = (e) => {
      const t = e.target;
      if (!cfg.hints || S.sleeping || !t || !t.closest || host.contains(t)) return;
      const el = t.closest(cfg.hintSelector);
      if (!el || el === hintEl || el.closest('[data-pip-ignore]')) return;
      const hint = el.getAttribute('data-pip-hint');
      const n = now();
      if (n - hintAt < (hint ? 2500 : 6000)) return;
      if (!hint && Math.random() > 0.4) return;
      hintEl = el;
      hintAt = n;
      run('curious', { text: hint }, 2);
    };
    const onOut = (e) => {
      if (!hintEl || !e.target || !hintEl.contains(e.target)) return;
      if (!e.relatedTarget || !hintEl.contains(e.relatedTarget)) hintEl = null;
    };

    let missTimer = 0;
    let missAt = -1e9;
    const onDocOut = (e) => {
      if (e.relatedTarget || pointerType !== 'mouse') return;
      pointer.inside = false;
      clearTimeout(missTimer);
      missTimer = setTimeout(() => {
        if (destroyed || S.sleeping || document.hidden || now() - missAt < 20000) return;
        missAt = now();
        run('miss', {}, 2);
      }, 900);
    };
    const onDocOver = (e) => {
      if (e.relatedTarget) return;
      clearTimeout(missTimer);
      if (current && current.name === 'miss') run('found', {}, 2);
    };

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) { hiddenAt = now(); return; }
      if (hiddenAt && now() - hiddenAt > 4000) {
        if (S.sleeping) wake();
        else later(() => run('hello', { lines: [pick(LINES.back)] }, 2), 350);
      }
      hiddenAt = 0;
      lastActivity = now();
    };

    let clicks = [];
    let lastClickTrick = '';
    const onClick = () => {
      activity(false);
      if (S.sleeping) { wake(); return; }
      const n = now();
      clicks = clicks.filter((c) => n - c < 1500);
      clicks.push(n);
      if (clicks.length >= 4) { clicks = []; run('dizzy', {}, 3); return; }
      const pool = ['giggle', 'giggle', 'love', 'hop', 'spin', 'wink'];
      let next = pick(pool);
      if (next === lastClickTrick) next = pick(pool);
      lastClickTrick = next;
      run(next, { click: true }, 3);
    };
    let leaveTimer = 0;
    const onEnterPip = () => { clearTimeout(leaveTimer); if (!S.hover) { S.hover = true; render(); } };
    const onLeavePip = () => {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { S.hover = false; render(); }, 140);
    };

    const listeners = [
      [window, 'pointermove', onPointerMove, { passive: true }],
      [window, 'pointerdown', onPointerDown, { passive: true }],
      [window, 'keydown', onStrong, undefined],
      [window, 'wheel', onStrong, { passive: true }],
      [window, 'scroll', onStrong, { passive: true }],
      [document, 'pointerover', onOver, { passive: true }],
      [document, 'pointerout', onOut, { passive: true }],
      [document, 'mouseout', onDocOut, undefined],
      [document, 'mouseover', onDocOver, undefined],
      [document, 'visibilitychange', onVisibility, undefined],
      [btn, 'click', onClick, undefined],
      [btn, 'pointerenter', onEnterPip, undefined],
      [btn, 'pointerleave', onLeavePip, undefined],
    ];
    listeners.forEach((l) => l[0].addEventListener(l[1], l[2], l[3]));

    // ---- go
    setTheme(cfg.theme);
    setSize(cfg.size);
    const start = () => {
      if (destroyed) return;
      setMode(cfg.mode, cfg.container);
      render();
      lastFrame = now();
      raf = requestAnimationFrame(frame);
      if (cfg.greet) later(() => run('hello', {}, 2.5), 600);
      scheduleIdle();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    function destroy() {
      if (destroyed) return;
      if (current) stop(current);
      destroyed = true;
      cancelAnimationFrame(raf);
      clearInterval(sleepCheck);
      clearTimeout(missTimer);
      clearTimeout(leaveTimer);
      timers.forEach(clearTimeout);
      sayTimers.forEach(clearTimeout);
      listeners.forEach((l) => l[0].removeEventListener(l[1], l[2], l[3]));
      if (host.parentNode) host.parentNode.removeChild(host);
    }

    return {
      el: host,
      version: VERSION,
      tricks: ['wave', 'hop', 'dance', 'spin', 'love', 'wink', 'think', 'lookAround', 'yawn', 'sleep', 'dizzy', 'giggle'],
      say: (text, o) => say(text, o),
      do: (name, o) => {
        if (name === 'sleep') return run('sleep', Object.assign({ grace: 4000 }, o), 3);
        if (name === 'wake') { wake(); return true; }
        return run(name, o, 3);
      },
      blink: () => blink(false),
      wake: wake,
      setTheme: setTheme,
      setSize: setSize,
      setMode: setMode,
      configure: (o) => { Object.assign(cfg, o || {}); if (o && o.trickEvery) scheduleIdle(); },
      destroy: destroy,
    };
  }

  window.PipMascot = { mount: mount, themes: THEMES, version: VERSION };

  // <script src="pip-mascot.js" data-pip-auto><\/script> mounts with defaults
  const me = document.currentScript;
  if (me && me.hasAttribute('data-pip-auto')) {
    const go = () => mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }
})();
