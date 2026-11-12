/* p3-rail v1.3 (Nov 12 2026). Source: Website Folder/site-chrome/rail.js, applied by apply-rail.py.
   Safari paints its own chrome in the page's body background colour: the side rail on a folded
   iPhone Duo, the bars on other iPhones, the overscroll area. The body was white, so a maroon
   hero looked cut off beside a white rail. This keeps the body colour in step with the sections
   at the right edge of the view, so the rail continues the page. Touch devices only. Nothing the
   visitor sees inside the page changes: body children that relied on the white body get it
   as their own background first.
   v1.1: the colour BLENDS between two sections as their boundary crosses the middle half of the
   view (it used to flip at the midpoint), and the first colour fades in as soon as the hero
   lands. Measured on the Duo: Safari's rail follows per-frame changes and CSS transitions in
   step with the page.
   v1.2: understands a preset first-paint colour (see sync).
   v1.3: forces a 1px repaint with each colour change so Safari applies it at once (see sync). */
(function () {
  if (window.__p3Rail) return;
  window.__p3Rail = 1;
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
  if (!document.elementsFromPoint) return;
  var MEDIA = [50, 18, 28, 1]; // behind a full-bleed photo or video: the heroes' dark maroon
  var FADE = 'background-color .35s ease';
  var orig = null, last = '', queued = false, scrolled = false, canFade = null, ping = null;
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function parse(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || isNaN(p[0])) return null;
    return [p[0], p[1], p[2], p.length > 3 && !isNaN(p[3]) ? p[3] : 1];
  }
  function gradient(layer) {
    var stops = layer.match(/rgba?\([^)]+\)/g);
    if (!stops) return null;
    var r = 0, g = 0, b = 0, a = 0, n = 0;
    for (var i = 0; i < stops.length; i++) {
      var c = parse(stops[i]);
      if (!c) continue;
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; n++;
    }
    if (!n || a === 0) return null;
    return [r / a, g / a, b / a, a / n];
  }
  // background-image is a comma list of layers, top first; split it outside parentheses.
  function split(img) {
    var out = [], depth = 0, start = 0;
    for (var i = 0; i < img.length; i++) {
      var ch = img.charAt(i);
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { out.push(img.slice(start, i)); start = i + 1; }
    }
    out.push(img.slice(start));
    return out;
  }
  // One element's paint, top first. MEDIA marks a full-bleed photo or video.
  function layersOf(el, vw) {
    if (cache) { var hit = cache.get(el); if (hit) return hit; }
    var cs = getComputedStyle(el), out = [];
    if (cs.visibility !== 'hidden' && parseFloat(cs.opacity) >= 0.05) {
      var wide = el.getBoundingClientRect().width >= vw * 0.9;
      var tag = el.tagName;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE') {
        if (wide) out.push(MEDIA);
      } else {
        var img = cs.backgroundImage || 'none';
        if (img !== 'none') {
          var parts = split(img);
          for (var i = 0; i < parts.length; i++) {
            if (parts[i].indexOf('gradient') !== -1) { var gr = gradient(parts[i]); if (gr) out.push(gr); }
            else if (parts[i].indexOf('url(') !== -1 && wide) out.push(MEDIA);
          }
        }
        var bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0.02) out.push(bg);
      }
    }
    if (cache) cache.set(el, out);
    return out;
  }
  // The colour at the right edge of the view, y px down.
  function colourAt(y, vw) {
    var stack = document.elementsFromPoint(vw - 3, Math.round(y));
    var layers = [], base = [orig[0], orig[1], orig[2]], done = false;
    for (var i = 0; i < stack.length && !done; i++) {
      var el = stack[i];
      if (el === document.body || el === document.documentElement) break;
      var ls = layersOf(el, vw);
      for (var j = 0; j < ls.length; j++) {
        if (ls[j] === MEDIA) {
          // A photo under a mostly opaque wash reads as the wash; otherwise as the heroes' maroon.
          var cov = 0, acc = [0, 0, 0];
          for (var m = layers.length - 1; m >= 0; m--) {
            var t = layers[m], ta = Math.min(1, t[3]);
            acc = [t[0] * ta + acc[0] * (1 - ta), t[1] * ta + acc[1] * (1 - ta), t[2] * ta + acc[2] * (1 - ta)];
            cov = ta + cov * (1 - ta);
          }
          base = cov >= 0.6 ? [acc[0] / cov, acc[1] / cov, acc[2] / cov] : [MEDIA[0], MEDIA[1], MEDIA[2]];
          done = true; break;
        }
        layers.push(ls[j]);
        if (ls[j][3] >= 0.98) { done = true; break; }
      }
    }
    var c = base;
    for (var k = layers.length - 1; k >= 0; k--) {
      var l = layers[k], a = Math.min(1, l[3]);
      c = [l[0] * a + c[0] * (1 - a), l[1] * a + c[1] * (1 - a), l[2] * a + c[2] * (1 - a)];
    }
    return c;
  }
  function near(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 9; }
  // Blend the section above with the section below while their boundary crosses the middle half.
  function sample() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var y1 = vh * 0.25, y2 = vh * 0.75;
    var c1 = colourAt(y1, vw), c2 = colourAt(y2, vw), c = c1;
    if (!near(c1, c2)) {
      var lo = y1, hi = y2;
      for (var i = 0; i < 6; i++) {
        var mid = (lo + hi) / 2;
        if (near(colourAt(mid, vw), c1)) lo = mid; else hi = mid;
      }
      var t = (y2 - (lo + hi) / 2) / (y2 - y1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      t = t * t * (3 - 2 * t);
      c = [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
    }
    return 'rgb(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ')';
  }
  // Body children that showed the body's own colour keep it once the body starts changing.
  function guard() {
    var kids = document.body.children, fill = 'rgb(' + orig[0] + ', ' + orig[1] + ', ' + orig[2] + ')';
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.__p3RailSeen) continue;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      el.__p3RailSeen = 1;
      if (cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky') continue;
      var bg = parse(cs.backgroundColor);
      if ((!bg || bg[3] < 0.02) && (cs.backgroundImage || 'none') === 'none') el.style.backgroundColor = fill;
    }
  }
  function sync() {
    var byScroll = scrolled;
    queued = false; scrolled = false;
    var body = document.body;
    if (!body) return;
    if (!orig) {
      var bcs = getComputedStyle(body), o = parse(bcs.backgroundColor);
      // v1.2: a page may preset the body colour for its first paint, before this file arrives
      // (<style id="p3-rail-initial"> in the page's Webflow head code). The body's computed colour
      // is then the hero's, not the page's base, so the base stays the white every page had.
      var preset = document.getElementById('p3-rail-initial');
      orig = !preset && o && o[3] > 0.5 ? [Math.round(o[0]), Math.round(o[1]), Math.round(o[2])] : [255, 255, 255];
      // Fade only if the page has no transition of its own on the body.
      canFade = !/[1-9]/.test(bcs.transitionDuration || '0s');
    }
    guard();
    var c = sample();
    if (c === last) return;
    last = c;
    // Scrolling drives the colour frame by frame; anything else (load, late content, rotation) fades.
    if (canFade) body.style.transition = byScroll ? 'none' : FADE;
    body.style.backgroundColor = c;
    // v1.3: Safari only picks the new body colour up with the page's next paint. With nothing else
    // repainting, the rail trailed the scroll by 0.1-0.3s in uneven steps (measured on the Duo from
    // a screen recording). Recolouring a 1px, near-transparent fixed element forces that paint, and
    // the rail then follows within a frame or two.
    if (!ping) {
      ping = document.createElement('div');
      ping.setAttribute('aria-hidden', 'true');
      ping.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.02;pointer-events:none;z-index:2147483000';
      // On <html>, not <body>: the bundles hide every body child that is not their own root.
      document.documentElement.appendChild(ping);
    }
    ping.style.backgroundColor = c;
  }
  function queue(e) {
    if (e && e.type === 'scroll') scrolled = true;
    if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(sync); }
  }
  function reset() { if (cache) cache = new WeakMap(); queue(); }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', reset);
  window.addEventListener('load', reset);
  document.addEventListener('DOMContentLoaded', queue);
  [0, 300, 900, 2000, 4000].forEach(function (t) { setTimeout(reset, t); });
  // The hero is injected a moment after this runs: pick its colour up the frame it lands.
  if (window.MutationObserver) {
    var start = function () {
      if (!document.body) return;
      var mo = new MutationObserver(reset);
      mo.observe(document.body, { childList: true, subtree: true });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); // the bundles reveal the page by a body class
      setTimeout(function () { mo.disconnect(); }, 8000);
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
  queue();
})();
/* p3-navwide v1 (Nov 12 2026). Source: Website Folder/site-chrome/navwide.js, applied with rail.js
   by apply-rail.py. The full navigation (logo, four links, Enterprise and Login) needs 780px, but
   every page switched to the menu button at 991px. An open iPhone Duo is 951px wide in Safari, so
   it got the phone menu on a tablet-wide screen. From 860 to 991px the full bar now shows. The
   selectors out-rank the nav spec's and the pages' own 991px rules, whatever order the styles load in. */
(function () {
  if (window.__p3NavWide) return;
  window.__p3NavWide = 1;
  var css = '@media (min-width: 860px) and (max-width: 991px) {' +
    'html body .p3-nav .p3-nav-links, html body .p3-nav .p3-nav-actions { display: flex !important; }' +
    'html body .p3-nav .pp-mob-menu { display: none !important; }' +
    'html body .p3-nav { padding: 16px 32px !important; height: auto !important; }' +
    '}';
  var st = document.createElement('style');
  st.id = 'p3-nav-wide';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
