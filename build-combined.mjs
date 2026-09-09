// Build hp2-combined.js (the Webflow-injected homepage) from index.html.
//
// Adapted from Platform-Page/build-combined.mjs. Transform rules (lessons
// from the Donate page saga, see CLAUDE.md):
// - Content classes are RENAMED with a `hp2-` prefix (not just #hp2-root-scoped)
//   so Webflow's own stylesheet — and the legacy homepage patch scripts that
//   keep running at launch — can never leak into or out of the content.
// - .p3-nav / .pp-mob-* / .p3-footer markup + CSS stay char-for-char verbatim
//   and are injected as BODY-LEVEL SIBLINGS of #hp2-root (they inherit
//   Webflow's site-level body Satoshi/30px metrics — nesting breaks that).
// - HOMEPAGE-SPECIFIC: the runtime removes pre-existing .p3-nav/.p3-footer/
//   .pp-mob-overlay nodes and the sections hp-shared-sections.js injects
//   (.lc-section/.gl/.os-section) BEFORE appending ours — the old homepage's
//   own chrome shares those class names, so hiding alone would whitelist it,
//   and hp-shared-sections' nav dedupe would otherwise delete OUR nav if it
//   runs after us. Our hamburger is marked data-wired so hp-shared-sections
//   can't double-bind it (two toggles = instant open+close).
// - Webflow's native chrome is hidden via body.hp2-active > *:not(...) and
//   IX2 body animations are cancelled.
// - dedupeTermsLinks() keeps ONE Terms link in the footer while the legacy
//   p3footerfix script is still registered (it appends its own copy).
//
// Usage: node build-combined.mjs   (writes hp2-combined.js next to it)
import { readFileSync, writeFileSync } from "node:fs";

const CDN = "https://tparis7.github.io/Homepage-Concept-V2/";
// Asset cache-buster: bump this whenever shots/ images/ press-logos/ change so
// browsers refetch them. combined.js itself is busted by the loader's ?v=.
const ASSET_VER = "20260814b";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// ---- extract pieces --------------------------------------------------------
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];

function extractBlock(startMarker, endMarker) {
  const s = body.indexOf(startMarker);
  const e = body.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error(`block not found: ${startMarker}`);
  return body.slice(s, e + endMarker.length);
}

const navHtml = extractBlock('<div class="p3-nav" id="p3nav">', "</div>\n\n<!-- Mobile fullscreen overlay menu -->")
  .replace("\n\n<!-- Mobile fullscreen overlay menu -->", "");
const overlayHtml = extractBlock('<div class="pp-mob-overlay" id="ppMobOverlay">', "</div>\n\n<!-- ===== HERO");
const overlayClean = overlayHtml.slice(0, overlayHtml.lastIndexOf("</div>") + 6);
const footerHtml = extractBlock('<footer class="p3-footer">', "</footer>");
const contentStart = body.indexOf("<!-- ===== HERO ===== -->");
const contentEnd = body.indexOf("<!-- ===== FOOTER");
if (contentStart === -1 || contentEnd === -1) throw new Error("content markers not found");
const contentHtml = body.slice(contentStart, contentEnd);

// ---- collect + rename content class tokens ---------------------------------
// Tokens come from class attributes in the CONTENT + nav/overlay/footer; only
// non-p3/pp tokens get the hp2- prefix (nav/footer/overlay classes stay put).
const tokens = new Set();
for (const m of body.matchAll(/class="([^"]+)"/g)) {
  for (const t of m[1].split(/\s+/)) {
    if (t && !t.startsWith("p3-") && !t.startsWith("pp-") && !t.startsWith("w-")) tokens.add(t);
  }
}
const renames = [...tokens].sort((a, b) => b.length - a.length);

function renameClassesInHtml(s) {
  return s.replace(/class="([^"]+)"/g, (_, cls) => {
    const out = cls
      .split(/\s+/)
      .map((t) => (tokens.has(t) ? `hp2-${t}` : t))
      .join(" ");
    return `class="${out}"`;
  });
}

function renameClassesInCss(s) {
  let out = s;
  for (const t of renames) {
    out = out.replaceAll(new RegExp(`\\.${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"), `.hp2-${t}`);
  }
  return out;
}

// ---- CSS transforms ---------------------------------------------------------
let outCss = css;
// scope the wildcard reset to the content root (nav/footer live outside it)
outCss = outCss.replace(
  "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
  "#hp2-root, #hp2-root *, #hp2-root *::before, #hp2-root *::after { box-sizing: border-box; margin: 0; padding: 0; }",
);
outCss = outCss.replace("html { scroll-behavior: smooth; }", "");
// strip the standalone page's bare element rules FIRST (they'd leak site-wide
// on Webflow), then re-add them scoped to the content root
outCss = outCss.replace(/^img \{ max-width: 100%; display: block; \}\n/m, "");
outCss = outCss.replace(/^a \{ text-decoration: none; color: inherit; \}\n/m, "");
outCss = outCss.replace(
  /body \{[^}]*\}/,
  "#hp2-root { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; color: #1a1a1a; background: #fff; line-height: 1.6; overflow-x: hidden; -webkit-font-smoothing: antialiased; }\n#hp2-root img { max-width: 100%; display: block; }\n#hp2-root a { text-decoration: none; color: inherit; }",
);
outCss = outCss.replace(":root {", "#hp2-root {");
// Chrome font rule. The standalone preview pins line-height: 30.006px to
// mimic Webflow; live, the nav/footer INHERIT that from Webflow's body, so
// only the family survives into the build (Plus Jakarta Sans since the
// Sep 2026 parity pass; it used to be dropped entirely because it was Satoshi).
outCss = outCss.replace(
  /(\.p3-nav, \.pp-mob-overlay, \.p3-footer \{ font-family: '[^']+', sans-serif;) line-height: 30\.006px; \}/,
  "$1 }",
);
// reduced-motion wildcard → scoped
outCss = outCss.replace(
  "* { transition-duration: 0.01ms !important; }",
  "#hp2-root * { transition-duration: 0.01ms !important; }",
);
outCss = renameClassesInCss(outCss);
// Prefix every content rule with #hp2-root so it out-specifies the scoped
// wildcard reset (#hp2-root * = 1,0,1 beats bare .hp2-x = 0,1,0 — the Donate
// wildcard-reset trap). Nav/footer (.p3-/.pp-) rules stay verbatim.
outCss = outCss.replace(/([^{}]+)\{/g, (m, prelude) => {
  // comments (section headers etc.) can precede the selector inside the
  // matched prelude — only transform the part after the last comment
  const cut = prelude.lastIndexOf("*/");
  const head = cut === -1 ? "" : prelude.slice(0, cut + 2);
  const selPart = cut === -1 ? prelude : prelude.slice(cut + 2);
  const trimmed = selPart.trim();
  if (trimmed.startsWith("@") || trimmed === "") return m; // media queries / stray
  const prefixed = trimmed
    .split(",")
    .map((s) => {
      const sel = s.trim();
      return sel.startsWith(".hp2-") ? `#hp2-root ${sel}` : sel;
    })
    .join(", ");
  const lead = selPart.slice(0, selPart.length - selPart.trimStart().length);
  return `${head}${lead}${prefixed} {`;
});
// hide Webflow's native chrome; whitelist our injected body-level pieces
outCss += `
/* Hide Webflow's native page chrome once the injected page is live.
   Intercom mounts its chat bubble as body-level [id/class^=intercom]
   containers — whitelisted so the launcher survives the swap. */
body.hp2-active > *:not(#hp2-root):not(.p3-nav):not(.pp-mob-overlay):not(.p3-footer):not(script):not(style):not(link):not([id^="intercom"]):not([class^="intercom"]) { display: none !important; }

/* Legacy-script shield (homepage only): the still-registered patch scripts
   inject "footer{padding:36px 20px 20px!important}" and
   ".p3-footer-brand img{height:24px!important}" at <=600px, which would
   deform our footer. Re-assert the FS-verbatim values at higher specificity.
   Delete this block once the legacy homepage scripts are unregistered. */
@media (max-width: 600px) {
  footer.p3-footer { padding: 64px 40px 32px !important; }
  .p3-footer-brand img.p3-footer-logo { height: 36px !important; }
}
`;

// ---- HTML transforms --------------------------------------------------------
function toCdn(s) {
  // absolutize + append the asset cache-buster to every local asset URL
  return s
    .replace(/src="shots\/([A-Za-z0-9._-]+)"/g, `src="${CDN}shots/$1?v=${ASSET_VER}"`)
    .replace(/src="images\/([A-Za-z0-9._-]+)"/g, `src="${CDN}images/$1?v=${ASSET_VER}"`)
    .replace(/src="press-logos\/([A-Za-z0-9._-]+)"/g, `src="${CDN}press-logos/$1?v=${ASSET_VER}"`)
    .replace(/url\("images\/([A-Za-z0-9._-]+)"\)/g, `url("${CDN}images/$1?v=${ASSET_VER}")`);
}
const content = toCdn(renameClassesInHtml(contentHtml));
outCss = toCdn(outCss);

// sanity: no local (repo-relative) asset URLs may survive the CDN pass
for (const leftover of [...content.matchAll(/src="(?!https?:)([^"]+)"/g)]) {
  throw new Error(`non-absolute src survived toCdn: ${leftover[1]}`);
}

// ---- assemble ---------------------------------------------------------------
function assertSafe(name, s) {
  if (s.includes("`") || s.includes("${")) throw new Error(`${name} contains template-literal chars`);
  return s;
}

const js = `/* hp2-combined.js v1.0.0 — pulseofp3.org homepage rebuild
   Generated from Website Folder/Homepage/concept/index.html by build-combined.mjs.
   Do not hand-edit: edit index.html, re-run the build, push, bump the loader
   cache-buster. Serves from ${CDN}hp2-combined.js */
(function () {
  'use strict';
  if (document.getElementById('hp2-root')) return;

  // Fonts (Plus Jakarta Sans + Bricolage Grotesque) — skip if another page script already loaded them
  var FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Plus+Jakarta+Sans:wght@400..800&display=swap';
  if (!document.querySelector('link[href*="Bricolage+Grotesque"]')) {
    var fl = document.createElement('link');
    fl.rel = 'stylesheet';
    fl.href = FONTS;
    document.head.appendChild(fl);
  }

  var style = document.createElement('style');
  style.textContent = ${JSON.stringify(outCss)};
  document.head.appendChild(style);

  // LEGACY CLEANUP — the old homepage's own chrome and the sections
  // hp-shared-sections.js injects share our whitelisted class names, so they
  // must be REMOVED (hiding would let them escape the body.hp2-active rule,
  // and hp-shared-sections' nav dedupe would delete OUR nav if it runs later).
  ['.p3-nav', '.pp-mob-overlay', '.p3-footer', '.lc-section', '.gl', '.os-section'].forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
  });

  // Content root
  var root = document.createElement('div');
  root.id = 'hp2-root';
  root.innerHTML = ${JSON.stringify(content)};
  document.body.appendChild(root);

  // Hero watermark video: innerHTML-injected videos don't reliably autoplay —
  // set the muted IDL explicitly and nudge play()
  var vid = root.querySelector('video');
  if (vid) {
    vid.muted = true;
    var vp = vid.play();
    if (vp && vp.catch) vp.catch(function () {});
  }

  // Nav + mobile overlay + footer as BODY-LEVEL SIBLINGS of #hp2-root — they
  // must inherit Webflow's body Satoshi/30px metrics (see Donate-page lesson).
  var chrome = document.createElement('div');
  chrome.innerHTML = ${JSON.stringify(assertSafe("nav", navHtml) + "\n" + assertSafe("overlay", overlayClean) + "\n" + assertSafe("footer", footerHtml))};
  while (chrome.firstElementChild) document.body.appendChild(chrome.firstElementChild);

  // Cancel Webflow IX2 body animations, then reveal (releases the FOUC guard)
  if (document.body.getAnimations) {
    document.body.getAnimations().forEach(function (a) { a.cancel(); });
  }
  document.body.classList.add('hp2-active');

  // SEO: JSON-LD (Google renders JS, so this is crawlable)
  var ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'The Pulse of Perseverance Project',
    alternateName: 'P3',
    url: 'https://www.pulseofp3.org/',
    logo: 'https://cdn.prod.website-files.com/69b02f65f0068e9fb16f09f7/69b02f65f0068e9fb16f0df1_P3%20Logo.svg',
    description: 'P3 connects underserved students with vetted mentors, scholarships, and real opportunities. 100% online and powered by community.',
    foundingDate: '2018',
    sameAs: [
      'https://www.instagram.com/pulseofp3/',
      'https://www.linkedin.com/company/pulseofperseverance/',
      'https://www.youtube.com/@PulseofPerseverance',
    ],
  });
  document.head.appendChild(ld);

  // Nav scroll behavior — same threshold as the old homepage (50px)
  var nav = document.getElementById('p3nav');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 50); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Hamburger menu. data-wired guards against hp-shared-sections.js (still
  // registered at launch) binding a second toggle to our button.
  var btn = document.getElementById('ppMobMenu');
  var ov = document.getElementById('ppMobOverlay');
  if (btn && ov) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', function () {
      var open = btn.classList.toggle('open');
      ov.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    ov.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        btn.classList.remove('open');
        ov.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  /*
    Legacy-script guard for the footer (Sep 9 2026). p3footerfix 1.4.0 is still
    registered on this page. After we run it (a) rewrites the footer's
    "For Institutions" link back to /partner and (b) appends its own
    "Terms & Conditions" anchor inside the copyright line. Both are undone here,
    on a schedule and again whenever the footer changes, so the outcome does not
    depend on which script runs last. Delete once the legacy scripts are gone.
  */
  function guardFooter() {
    var footer = document.querySelector('.p3-footer');
    if (!footer) return;
    footer.querySelectorAll('a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      /* no backslashes in these regexes: the homepage build carries this block through a template literal, which drops them */
      if (h === '/partner' || /pulseofp3[.]org[/]partner[/]?$/.test(h)) a.setAttribute('href', 'https://enterprise.pulseofp3.org/overview');
      if (/^Terms[ ]*&[ ]*Conditions$/i.test((a.textContent || '').trim())) {
        var host = a.parentElement;
        a.remove();
        if (host && host.tagName === 'P' && !host.textContent.trim() && !host.querySelector('a')) host.remove();
      }
    });
  }
  guardFooter();
  document.addEventListener('DOMContentLoaded', guardFooter);
  window.addEventListener('load', guardFooter);
  [300, 1200, 3000].forEach(function (ms) { setTimeout(guardFooter, ms); });
  if (window.MutationObserver) {
    var guarded = document.querySelector('.p3-footer');
    if (guarded) new MutationObserver(guardFooter).observe(guarded, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }
})();
`;

writeFileSync(new URL("./hp2-combined.js", import.meta.url), js);
console.log(`hp2-combined.js written (${Math.round(js.length / 1024)} KB, ${renames.length} classes renamed)`);
