// Mister Download Manager's download button over videos (a content script, in every page and
// frame). Our own design: a small pill at the video's edge that appears while the pointer is
// over the video (or it has the keyboard's focus) and fades when the pointer rests or leaves.
// Clicking it has the app look the video up (an embedded player's own address, which yt-dlp
// understands, with the video's own address when it has a plain one) and lists its qualities in a
// menu over the page; the one picked downloads without the app's window. An app that can't look
// up (an older one, another MDM chosen) opens its Download video window for this page instead,
// as does the menu's last command. It can be dragged along the video's edge, and stays where
// it was put on that site. Its menu hides it on this video, keeps it off the site (the app's
// Options → General → Download panels lists those sites), or opens those settings. The app
// decides where it may show at all (the native host: integration on, this browser captured,
// the button on, the site not excluded).
(() => {
  // One button per page: a copy cut off from the extension (after an update) gives way to the
  // new one.
  const prev = globalThis.__mdmVideoButton;
  if (prev && typeof prev === "object" && prev.alive()) return;
  if (prev && typeof prev.teardown === "function") prev.teardown();
  const ext = globalThis.browser ?? globalThis.chrome;

  // A video worth a button: big enough to be content, not a short muted looping clip (an
  // animated picture or a background). A sound player (<audio> with controls) gets one too.
  const MIN_W = 200;
  const MIN_H = 112;
  const MIN_AUDIO_H = 24;
  const CLIP_S = 15;
  // Shown this long after the pointer last moved over the video, kept while it is on the button.
  const IDLE_MS = 2600;
  const INSET = 10;
  const DRAG_PX = 4;
  // Our app icon (extension/icons/icon-48.png, as data: no extension file is exposed to pages).
  const LOGO = "data:image/png;base64,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";

  const t = (key, ...subs) => ext.i18n.getMessage(key, subs) || FALLBACK[key] || key;
  const FALLBACK = {
    video_download: "Download video",
    video_more: "More options",
    video_hide_here: "Hide on this video",
    video_settings: "Button settings...",
    video_sent: "Sent to Mister Download Manager",
    video_failed: "Mister Download Manager isn't installed or didn't start",
    video_off: "The download button is off on this site",
    video_drm: "Protected video: it can't be saved",
    video_unnamed: "Can't tell which video this is: open its own page and try there",
    video_drag: "Drag to move it along the video's edge",
    video_looking: "Looking up the qualities…",
    video_open_mdm: "Open in Mister Download Manager…",
    video_no_choices: "No video to download here",
    video_playlist: "A list of videos: choose them in Mister Download Manager",
    video_no_ytdlp: "Mister Download Manager needs yt-dlp for this video",
    video_too_long: "Looking up took too long",
    video_busy: "Mister Download Manager is busy with other videos",
    video_queued: "Added to the queue",
    video_failed_lookup: "Could not look it up",
  };
  // Sizes as the browser's language writes them.
  const lang = ext.i18n.getUILanguage?.() || undefined;
  // To the background. After the extension was updated or removed, this page's copy of the script
  // is cut off from it (calls throw at once): then it takes itself away.
  const send = (m) => {
    try {
      if (!ext.runtime?.id) throw new Error("gone");
      return ext.runtime.sendMessage(m).catch(() => ({ ok: false }));
    } catch {
      teardown();
      return Promise.resolve({ ok: false, gone: true });
    }
  };
  const host = location.hostname;
  // The address the app looks the video up by — the video's, not the page's. Most pages that play
  // a video are not the video's page: YouTube's home, a search, a channel or a playlist carries a
  // list in its address ("recommended", the results, the channel's videos), and yt-dlp reads such
  // an address as the list, so the app offered the whole feed instead of the video the button was
  // on. A watch page opened from a mix or a playlist has the same problem one level down
  // (…&list=…&index=…): its own page is watch?v=<id>, and nothing else.
  //
  // Null when the page plays a video but its DOM doesn't name it: YouTube's channel masthead player
  // has no video-id attribute, no link to the video inside the player and a blob: source. The page
  // itself never goes to the app then (a channel is a whole list to yt-dlp): the background asks
  // the player what it plays, in the page's own world (background.js playingVideo), and this
  // answer is only what it falls back on.
  function videoPage(v) {
    const watch = (id) =>
      /^[\w-]+$/.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : null;
    try {
      const url = new URL(location.href);
      const name = url.hostname.replace(/^(www|m|music)\./, "");
      if (name === "youtu.be") {
        const id = url.pathname.split("/")[1];
        if (watch(id)) return `https://youtu.be/${id}`;
      }
      if (name === "youtube.com" || name === "youtube-nocookie.com") {
        // An embed's own page is the video's (…/embed/<id>).
        if (url.pathname.startsWith("/embed/")) {
          const id = watch(url.pathname.split("/")[2]);
          if (id) return id;
        }
        // A Short's or a live stream's own page (/shorts/<id>, /live/<id>). yt-dlp reads these as
        // the same one video as watch?v=<id>.
        const [, kind, pathId] = url.pathname.split("/");
        if (kind === "shorts" || kind === "live") {
          const id = watch(pathId);
          if (id) return id;
        }
        // The page is this video's own: a watch page, with or without a list on it.
        const own = watch(url.searchParams.get("v"));
        if (own && url.pathname.startsWith("/watch")) return own;
        const shown = watch(document.querySelector("ytd-watch-flexy")?.getAttribute("video-id"));
        if (shown && url.pathname.startsWith("/watch")) return shown;
        const player = watch(document.querySelector("#movie_player")?.getAttribute("video-id"));
        if (player) return player;
        // A player inside the card it belongs to (a feed, a search, a playlist): the card links to
        // the video. Only a container that names exactly one video counts — walking on into the
        // page's column would find some other card's link and send the wrong video, which is worse
        // than sending none.
        for (let node = v, i = 0; node && i < 12; i += 1, node = node.parentElement) {
          const ids = new Set();
          for (const a of node.querySelectorAll?.('a[href*="/watch?"], a[href*="youtu.be/"]') || []) {
            const link = new URL(a.href, location.href);
            const id = link.hostname.endsWith("youtu.be")
              ? link.pathname.split("/")[1]
              : link.searchParams.get("v");
            if (watch(id)) ids.add(id);
          }
          if (ids.size === 1) return watch([...ids][0]);
          if (ids.size > 1) break;
        }
        // A page that plays a video and names none: not the video's page, so not the app's.
        return null;
      }
    } catch {
      // Not an address this page can reason about: its own follows.
    }
    return location.href;
  }

  // ---- the qualities: the app looks the video up (yt-dlp), the user picks one here ------------
  // How long a lookup is followed, from the click.
  const LOOKUP_MS = 60000;

  // The wait before asking again how a lookup is going: 1 s, a little longer each time, 2 s at
  // most.
  function pollDelay(n) {
    return Math.min(2000, Math.round(1000 * 1.25 ** Math.max(0, n)));
  }

  // A size as the browser's language writes it ("178.8 MB"); "" when unknown.
  function sizeText(bytes, lang) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    const units = [["gigabyte", 2 ** 30], ["megabyte", 2 ** 20], ["kilobyte", 2 ** 10]];
    const [unit, per] = units.find(([, u]) => n >= u) || ["byte", 1];
    try {
      return new Intl.NumberFormat(lang, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1 }).format(n / per);
    } catch {
      return `${(n / per).toFixed(1)} ${unit}`;
    }
  }

  // What a quality's row says: the app's name for it (in the app's language) and its size. Only
  // ever set as text, never as markup.
  function rowText(choice, lang) {
    const c = choice && typeof choice === "object" ? choice : {};
    return { name: String(c.label ?? "").slice(0, 200), size: sizeText(c.size, lang) };
  }

  // Follows a lookup the app is running, from its first answer: asks again only once the last
  // question was answered (never on a timer of its own), pollDelay apart, until it is no longer
  // pending (that answer, with its token), the minute is up ({state: "late"}) or it is no longer
  // wanted (null: the menu closed, the video or the page changed). `ask(token, ms)`: the
  // background's answer, or {late: true} after `ms`; `sleep(ms)` may end early when dropped.
  async function followLookup(first, { ask, alive, sleep, now, end }) {
    let s = first;
    let token = "";
    for (let n = 0; ; n += 1) {
      if (!alive()) return null;
      if (!s || typeof s !== "object") return { state: "gone" };
      if (typeof s.token === "string" && s.token) token = s.token;
      if (s.state !== "pending") return { ...s, token };
      if (!token) return { state: "gone" };
      const left = end - now();
      if (left <= 0) return { state: "late" };
      await sleep(Math.min(pollDelay(n), left));
      if (!alive()) return null;
      if (end - now() <= 0) return { state: "late" };
      const r = await ask(token, end - now());
      if (!alive() || !r || r.gone) return null;
      if (r.late) return { state: "late" };
      // Another MDM chosen meanwhile: the window, as for a click.
      s = r.fallback ? { state: "use-window" } : r.lookup;
    }
  }

  // The background's answer to a lookup or to a choice, as a lookup's state: null when there is
  // nothing to show (the extension gone); "late" past the minute, "unnamed" for a video it can't
  // tell, and "use-window" for no lookups here (another MDM, an older one) or an answer that
  // isn't one.
  function replyState(r) {
    if (r && r.gone) return null;
    if (r && r.late) return { state: "late" };
    if (r && r.why === "unnamed") return { state: "unnamed" };
    if (!r || r.fallback || !r.lookup || typeof r.lookup !== "object") return { state: "use-window" };
    return r.lookup;
  }

  // What a lookup's state (or replyState's) comes to, as the menu does it: "follow" it while the
  // app looks, "offer" its qualities, "say" a message in the menu (with the app's own words under
  // it), "flash" a word on the button (the menu closed), or "window": the click as it always was,
  // the app's Download video window. `t`: the texts. `picked`: the answer to a choice, which only
  // a download confirms; anything else there is the window's.
  function lookupAction(s, t, picked) {
    const state = s && typeof s === "object" && typeof s.state === "string" ? s.state : "";
    // A choice taken: downloading, in the queue, or handed to the app, which didn't say in time
    // what became of it ("sent": it will download it; the window would download it again).
    if (state === "started" || state === "sent") return { act: "flash", kind: "ok", text: t("video_sent") };
    if (state === "queued") return { act: "flash", kind: "ok", text: t("video_queued") };
    if (!picked) {
      if (state === "pending") return { act: "follow" };
      if (state === "ready" && Array.isArray(s.choices) && s.choices.length) return { act: "offer" };
      if (state === "ready" || (state === "failed" && s.reason === "no-choices")) return { act: "say", text: t("video_no_choices") };
      if (state === "failed" && s.reason === "no-ytdlp") return { act: "say", text: t("video_no_ytdlp") };
      if (state === "failed") return { act: "say", text: t("video_failed_lookup"), detail: typeof s.message === "string" ? s.message : "" };
      if (state === "late") return { act: "say", text: t("video_too_long") };
      if (state === "list") return { act: "say", text: t("video_playlist") };
      if (state === "busy") return { act: "say", text: t("video_busy") };
      if (state === "off") return { act: "flash", kind: "err", text: t("video_off") };
      if (state === "unnamed") return { act: "flash", kind: "err", text: t("video_unnamed") };
    }
    // "use-window", "gone" (the app forgot it: restarted), a choice the app didn't take, and
    // anything newer: the window.
    return { act: "window" };
  }

  // The click's window at most once, whichever way the click comes to it (an answer that isn't a
  // lookup, the lookup's end, a choice the app didn't take, "Open in…"): true the first time for
  // `j`, the click's lookup.
  function firstWindow(j) {
    if (!j || j.windowed) return false;
    j.windowed = true;
    return true;
  }

  // The video the pointer takes the button to: the one under it (`found`), but not another than
  // its own (`shown`) while the qualities' menu is open (`picking`): the menu reaches over the
  // videos around its own (a feed's), and the pointer crosses them on its way to a row. The menu
  // still closes when its video plays something else or the page changes (tick), or on a click
  // elsewhere.
  function pointerTarget(found, shown, picking) {
    if (!found || (picking && found !== shown)) return null;
    return found;
  }

  // The address this page first loaded at (`download`: a page that moves in place keeps its first
  // page's og:title).
  const landedAt = location.href;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // "Hide on this video": the video's address (players reuse one element for the next video),
  // else the element.
  const dismissed = new WeakSet();
  const dismissedSrc = new Set();
  const isDismissed = (v) => dismissed.has(v) || (v.currentSrc && dismissedSrc.has(v.currentSrc));
  let allowed = null; // asked once per page: may it show here?
  let place = { x: 1, y: 0 }; // where on the edge: fractions of the room, top right by default
  let chosen = false; // the user put it where it is (dragged it, on this site): theirs, never moved for a page's control
  let auto = { v: null, at: null, t: 0 }; // the spot found for this video, kept for a moment
  const AUTO_MS = 400;
  let video = null; // the video it is over
  let lastMove = 0;
  let pointer = { x: -1, y: -1 };
  let menuOpen = false;
  let dragging = null;
  let busy = false;
  // The lookup the qualities menu is for (one at a time), until the menu closes.
  let job = null;
  let flashing = false;
  let raf = 0;
  let scan = 0;
  // Kept on screen while the keyboard is on it (not after a mouse click: that leaves focus too),
  // or on the video's player (its own controls).
  const keyboardOn = () =>
    Boolean(shadow.activeElement && shadow.activeElement.matches(":focus-visible")) || playerFocused();
  let focusedPlayer = null;
  const playerFocused = () =>
    Boolean(video && focusedPlayer && document.activeElement === focusedPlayer && focusedPlayer.contains(video));

  // ---- the button: a closed shadow tree the page's styles and scripts can't reach ----------
  const root = document.createElement("mdm-video-button");
  // Each with !important: a page's own rules can't hide or move it.
  for (const [k, v] of Object.entries({
    all: "initial", position: "fixed", "z-index": "2147483647", left: "0", top: "0", display: "none",
    contain: "layout style", opacity: "1", visibility: "visible", "pointer-events": "auto",
  })) root.style.setProperty(k, v, "important");
  const shadow = root.attachShadow({ mode: "closed" });
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
/* A light, glossy panel that stands out over a dark video, with our icon: the classic download
   button's feel, made modern (rounded, crisp type, soft shadow and motion). */
.pill {
  display: flex; align-items: stretch; height: 34px; border-radius: 9px;
  background: linear-gradient(#ffffff, #f1f4f8 48%, #e3e8ef 52%, #eef2f6);
  color: #17324d; border: 1px solid rgba(23, 50, 77, .28);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .32), 0 1px 0 rgba(255, 255, 255, .9) inset;
  font: 600 13px/1 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  opacity: 0; transform: translateY(-3px) scale(.98);
  transition: opacity .16s ease-out, transform .16s ease-out, filter .12s;
  user-select: none; -webkit-user-select: none; touch-action: none; white-space: nowrap;
}
.pill.shown { opacity: 1; transform: none; }
.pill.dragging { cursor: grabbing; box-shadow: 0 10px 28px rgba(0, 0, 0, .45); transition: none; }
.pill.dragging .go { cursor: grabbing; }
.pill.ok { background: linear-gradient(#f2fff6, #d4f3df); border-color: #2f9a5b; color: #135c33; }
.pill.err { background: linear-gradient(#fff4f4, #f6d6d6); border-color: #c24848; color: #7d1f1f; }
button {
  /* all: unset resets box-sizing too, past the rule above: without it a menu item's 100 % width
     plus its padding ran past the menu's edge (#81). */
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  color: inherit; cursor: pointer; font: inherit;
}
.go { padding: 0 12px 0 8px; border-radius: 8px 0 0 8px; cursor: grab; }
.more { padding: 0 9px; border-left: 1px solid rgba(23, 50, 77, .18); border-radius: 0 8px 8px 0; }
.go:hover, .more:hover { background: linear-gradient(rgba(214, 232, 255, .9), rgba(182, 212, 250, .9)); }
.go:active, .more:active { background: rgba(160, 196, 242, .9); }
button:focus-visible { outline: 2px solid #2a78d6; outline-offset: -2px; }
.go img { width: 22px; height: 22px; flex: none; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .25)); }
.more svg { width: 12px; height: 12px; color: #3b5876; }
.compact .label { display: none; }
.compact .go { padding: 0 6px; border-radius: 8px 0 0 8px; }
.menu {
  position: absolute; min-width: 210px; padding: 4px; border-radius: 9px;
  background: #fbfcfe; color: #17324d; border: 1px solid rgba(23, 50, 77, .22);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
  font: 400 13px/1.2 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  display: none;
}
.menu.open { display: block; }
.menu button { display: block; width: 100%; padding: 8px 12px; border-radius: 6px; cursor: default; }
.menu button:hover, .menu button:focus-visible { background: #dceafb; outline: none; }
.menu hr { border: 0; border-top: 1px solid rgba(23, 50, 77, .12); margin: 4px 2px; }
/* The qualities: a row each (the app's name for it, its size at the end), a message while it
   looks or when it found none, "Open in…" last. Scrolls when there are many. */
.picks { min-width: 240px; max-width: 360px; max-height: min(300px, 45vh); overflow: auto; overscroll-behavior: contain; }
.picks:focus { outline: none; }
.menu .pick { display: flex; align-items: baseline; gap: 16px; }
.pick .name { overflow-wrap: anywhere; }
.pick .size { margin-inline-start: auto; color: #4a6681; font-variant-numeric: tabular-nums; white-space: nowrap; }
.note { padding: 8px 12px; color: #3b5876; overflow-wrap: anywhere; }
.note .why { display: block; margin-top: 4px; font-size: 12px; color: #5a7086; }
@media (prefers-reduced-motion: reduce) { .pill { transition: none; transform: none; } }
`;
  // A constructed sheet: a page whose Content-Security-Policy refuses inline styles can't strip
  // it (Firefox applies the page's policy to what a content script adds).
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
  }
  shadow.innerHTML += `
<div class="pill" part="pill">
  <button class="go" type="button">
    <img alt="" draggable="false">
    <span class="label"></span>
  </button>
  <button class="more" type="button" aria-haspopup="menu" aria-expanded="false">
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>
  </button>
</div>
<div class="menu" role="menu">
  <button role="menuitem" data-act="download"></button>
  <hr>
  <button role="menuitem" data-act="hide"></button>
  <button role="menuitem" data-act="never"></button>
  <hr>
  <button role="menuitem" data-act="settings"></button>
</div>
<div class="menu picks" role="menu" tabindex="-1" aria-describedby="said">
  <div class="note" id="said" role="status"></div>
  <div class="rows" role="none"></div>
  <hr>
  <button role="menuitem" data-act="window"></button>
</div>`;
  shadow.querySelector(".go img").src = LOGO;
  const pill = shadow.querySelector(".pill");
  const go = shadow.querySelector(".go");
  const label = shadow.querySelector(".label");
  const more = shadow.querySelector(".more");
  const menu = shadow.querySelector(".menu");
  const item = (act) => menu.querySelector(`[data-act="${act}"]`);
  // The qualities' menu: its message, its rows, "Open in…".
  const picks = shadow.querySelector(".picks");
  const note = picks.querySelector(".note");
  const rows = picks.querySelector(".rows");
  const openRow = picks.querySelector('[data-act="window"]');
  // Which of the two menus is open (`menuOpen`).
  let panel = menu;
  pill.dir = ext.i18n.getMessage("@@bidi_dir") || "ltr";
  menu.dir = pill.dir;
  picks.dir = pill.dir;
  const idleLabel = t("video_download");
  label.textContent = idleLabel;
  go.title = `${idleLabel} — ${t("video_drag")}`;
  go.setAttribute("aria-label", idleLabel);
  more.title = t("video_more");
  more.setAttribute("aria-label", t("video_more"));
  item("download").textContent = idleLabel;
  item("hide").textContent = t("video_hide_here");
  item("never").textContent = ext.i18n.getMessage("video_never_site", [host]) || `Never on ${host}`;
  item("settings").textContent = t("video_settings");
  picks.setAttribute("aria-label", idleLabel);
  openRow.textContent = t("video_open_mdm");

  // ---- which video ----------------------------------------------------------------------------
  const videos = document.getElementsByTagName("video");
  const audios = document.getElementsByTagName("audio");

  // Videos inside open shadow roots (players built as web components), looked for again every
  // few seconds at most.
  let shadowed = [];
  let shadowedAt = 0;
  function shadowVideos() {
    if (Date.now() - shadowedAt < 3000) return shadowed;
    shadowedAt = Date.now();
    const found = [];
    const walk = (root, depth) => {
      if (depth > 4) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let n = w.nextNode(), seen = 0; n && seen < 20000; n = w.nextNode(), seen++) {
        if (n.shadowRoot) {
          found.push(...n.shadowRoot.querySelectorAll("video"));
          walk(n.shadowRoot, depth + 1);
        }
      }
    };
    walk(document.documentElement, 0);
    shadowed = found;
    return found;
  }

  function eligible(v) {
    if (!v.isConnected || isDismissed(v)) return false;
    const r = v.getBoundingClientRect();
    const audio = v instanceof HTMLAudioElement;
    if (audio ? !v.controls || r.width < MIN_W || r.height < MIN_AUDIO_H : r.width < MIN_W || r.height < MIN_H) {
      return false;
    }
    // A short muted loop without controls: a moving picture, not something to save.
    if (v.muted && v.loop && !v.controls && !(v.duration > CLIP_S)) return false;
    const s = getComputedStyle(v);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  // The topmost eligible video under (x, y): players lay their controls over the video, so the
  // video itself rarely gets the pointer's events.
  function videoAt(x, y) {
    let best = null;
    for (const v of [...videos, ...audios, ...shadowVideos()]) {
      const r = v.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom || !eligible(v)) continue;
      if (!best || r.width * r.height < best.r.width * best.r.height) best = { v, r };
    }
    return best && best.v;
  }

  // ---- placing it -------------------------------------------------------------------------
  // `place` is where it sits in the room the video leaves around it: x and y from 0 to 1, one of
  // them 0 or 1 (on an edge).
  function rects() {
    const r = video.getBoundingClientRect();
    const w = pill.offsetWidth || 150;
    const h = pill.offsetHeight || 32;
    return { r, w, h, roomX: Math.max(0, r.width - w - 2 * INSET), roomY: Math.max(0, r.height - h - 2 * INSET) };
  }

  // Is a control of the page under this spot (a viewport rectangle)? What counts is something
  // on top of the video that the user clicks and that is much smaller than the video: a button,
  // a small link, a watch-later or menu button on a preview (#421); a link or layer over the
  // whole video isn't one. On the video itself, and below it, is nothing to cover.
  function onControl(b, video, videoRect) {
    const area = (x) => Math.max(0, x.width) * Math.max(0, x.height);
    const small = (el) => area(el.getBoundingClientRect()) < area(videoRect) / 5;
    const points = [
      [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
      [b.left + 4, b.top + 4],
      [b.right - 4, b.top + 4],
      [b.left + 4, b.bottom - 4],
      [b.right - 4, b.bottom - 4],
    ];
    for (const [x, y] of points) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === root) continue;
        if (el === video || el.contains(video)) break;
        const control = el.closest("button, [role=button], a[href], input, select, [onclick]");
        if (control && !control.contains(video) && small(control)) return true;
        if (small(el) && getComputedStyle(el).cursor === "pointer") return true;
      }
    }
    return false;
  }

  // Where it goes now: the place the user gave it, else the default corner, or the next corner
  // free of the page's own controls (a thumbnail's watch-later button at the top right, #421).
  function spot(r, w, h, roomX, roomY) {
    if (chosen) return place;
    const now = Date.now();
    if (auto.v === video && now - auto.t < AUTO_MS) return auto.at;
    let at = place;
    for (const c of [place, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const left = r.left + INSET + c.x * roomX;
      const top = r.top + INSET + c.y * roomY;
      if (!onControl({ left, top, right: left + w, bottom: top + h }, video, r)) {
        at = c;
        break;
      }
    }
    auto = { v: video, at, t: now };
    return at;
  }

  function position() {
    if (!video) return;
    const { r, w, roomX, roomY } = rects();
    // A narrow video gets the icon only.
    pill.classList.toggle("compact", r.width < 360);
    const at = dragging ? dragging.at : spot(r, w, pill.offsetHeight || 32, roomX, roomY);
    const left = r.left + INSET + at.x * roomX;
    // In the part of the video on screen: one scrolled half out keeps its button in view.
    const h = pill.offsetHeight || 32;
    const visTop = Math.max(r.top, 0) + INSET;
    const visBottom = Math.min(r.bottom, innerHeight) - INSET - h;
    const top = Math.min(Math.max(r.top + INSET + at.y * roomY, visTop), Math.max(visTop, visBottom));
    root.style.setProperty("transform", `translate(${Math.round(left)}px, ${Math.round(top)}px)`, "important");
    if (menuOpen) placeMenu(top, left, w);
  }

  // The open menu opens below the button, or above it near the bottom of the window; aligned
  // with whichever of its sides is nearer the video's middle.
  function placeMenu(top, left, w) {
    const h = panel.offsetHeight;
    const below = top + 36 + h < innerHeight;
    panel.style.top = below ? "36px" : `${-h - 4}px`;
    const { r } = rects();
    const rightHalf = left + w / 2 > r.left + r.width / 2;
    panel.style.left = rightHalf ? "" : "0";
    panel.style.right = rightHalf ? "0" : "";
  }

  // Snap a free spot (fractions, after a drag) to the nearest edge.
  function snap(at) {
    const d = { left: at.x, right: 1 - at.x, top: at.y, bottom: 1 - at.y };
    const edge = Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
    // Along the edge it stays where it was dropped, but close to a corner it goes into it.
    const c = (n) => (n < 0.08 ? 0 : n > 0.92 ? 1 : n);
    if (edge === "left") return { x: 0, y: c(at.y) };
    if (edge === "right") return { x: 1, y: c(at.y) };
    if (edge === "top") return { x: c(at.x), y: 0 };
    return { x: c(at.x), y: 1 };
  }

  // ---- showing and hiding ---------------------------------------------------------------------
  function attach() {
    // Over the video in fullscreen: inside the fullscreen element (a fullscreen <video> itself
    // can't hold it: then it hides).
    const fs = document.fullscreenElement;
    const parent = fs && fs !== video && fs.contains(video) ? fs : document.documentElement;
    if (root.parentNode !== parent) parent.appendChild(root);
    return !(fs && (fs === video || !fs.contains(video)));
  }

  function show(v) {
    if (video !== v) {
      video = v;
      closeMenu();
    }
    if (!attach()) return hide(true);
    root.style.setProperty("display", "block", "important");
    position();
    if (!pill.classList.contains("shown")) requestAnimationFrame(() => pill.classList.add("shown"));
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // `now`: at once and whatever has the focus (dismissed, the video gone).
  function hide(now) {
    if (!now && (menuOpen || dragging || keyboardOn())) return;
    if (now) {
      closeMenu();
      shadow.activeElement?.blur();
    }
    pill.classList.remove("shown");
    cancelAnimationFrame(raf);
    raf = 0;
    const was = video;
    setTimeout(() => {
      if (!pill.classList.contains("shown") && video === was) root.style.setProperty("display", "none", "important");
    }, now || reduced ? 0 : 180);
  }

  // While shown: follow the video (scrolling, layout) and fade when the pointer rests.
  function tick() {
    raf = 0;
    if (!video || !video.isConnected || !eligible(video)) {
      video = null;
      return hide(true);
    }
    const r = video.getBoundingClientRect();
    const over =
      pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
    // The qualities' menu for a video this element no longer plays, or a page left: it goes.
    if (menuOpen && panel === picks && !(job && current(job))) closeMenu();
    const onButton = root.matches(":hover");
    if (!onButton && !menuOpen && !dragging && !keyboardOn() && (!over || Date.now() - lastMove > IDLE_MS)) {
      return hide();
    }
    position();
    raf = requestAnimationFrame(tick);
  }

  // At most one look per frame, however fast the pointer moves.
  function onMove(e) {
    pointer = { x: e.clientX, y: e.clientY };
    lastMove = Date.now();
    if (!scan) scan = requestAnimationFrame(look);
  }

  function look() {
    scan = 0;
    if (dragging || allowed === false) return;
    // Kept on its video while the qualities' menu is open (pointerTarget).
    const v = pointerTarget(videoAt(pointer.x, pointer.y), video, menuOpen && panel === picks);
    if (!v) return;
    if (allowed === null) return void ask().then(() => allowed && look());
    show(v);
  }

  async function ask() {
    if (allowed !== null) return;
    allowed = false; // until answered: one question per page
    const r = await send({ type: "panel" });
    allowed = Boolean(r && r.on);
    if (allowed) {
      try {
        const { positions } = await ext.storage.local.get({ positions: {} });
        if (positions[host]) {
          place = snap(positions[host]);
          chosen = true;
        }
      } catch {
        // Default spot.
      }
    }
  }

  // ---- acting ---------------------------------------------------------------------------------
  // The middle of the video: where the background asks the page's own player what it plays.
  function middle(v) {
    const box = v.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  // What a click is about: the video's own file (a plain address), the page's title, the video's
  // page and its middle.
  function describe(v) {
    const src = /^https?:/i.test(v.currentSrc || "") ? v.currentSrc : "";
    // A page that moved in place keeps its first page's og:title; its document title follows.
    const og = location.href === landedAt ? document.querySelector('meta[property="og:title"]')?.content : "";
    const title = (og || document.title || "").trim();
    // Asked now, not kept: one <video> plays many videos at the same address (a feed's previews).
    return { src, title, url: videoPage(v), at: middle(v) };
  }

  // A promise's answer, or {late: true} once `ms` is up.
  const within = (promise, ms) => {
    let timer = 0;
    const late = new Promise((done) => (timer = setTimeout(() => done({ late: true }), Math.max(0, ms))));
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };

  // The click: the app looks the video up and its qualities open in a menu here. An app that can't
  // (an older one, another MDM chosen) gets the click as it always was: its Download video window.
  async function download() {
    // The button again while its qualities are open: they close.
    if (menuOpen && panel === picks) return closeMenu();
    if (busy || !video) return;
    busy = true;
    try {
      closeMenu();
      // Encrypted (DRM): no tool can save it; say so rather than send it.
      if (video.mediaKeys) return flash("err", t("video_drm"));
      const j = { video, src: video.currentSrc || "", href: location.href, asked: describe(video), started: Date.now(), token: "", count: 0 };
      job = j;
      // The menu opens at once, saying it is looking; an answer that needs none and comes first
      // (no lookups here: the window) shows none.
      const opening = setTimeout(() => openPicks(j), 100);
      const s = replyState(await within(send({ type: "video-lookup", ...j.asked }), LOOKUP_MS));
      clearTimeout(opening);
      if (!s || !current(j)) return;
      const a = lookupAction(s, t);
      // No lookups here, or an answer that isn't one: the click as it was, once.
      if (a.act === "window") return await useWindow(j);
      // A video it can't tell, or the button off here: a word on the button, no menu.
      if (a.act === "flash") {
        closeMenu();
        dropLookup();
        return flash(a.kind, a.text);
      }
      openPicks(j);
      follow(j, s);
    } finally {
      busy = false;
    }
  }

  // Still the lookup the menu is for: the menu open on the same video (the same element playing
  // the same thing) on the same page. Whatever answers a lookup after that is dropped.
  const current = (j) =>
    job === j && video === j.video && (!j.src || video.currentSrc === j.src) && location.href === j.href;

  function openPicks(j) {
    if (!current(j) || (menuOpen && panel === picks)) return;
    closeMenu();
    panel = picks;
    menuOpen = true;
    rows.replaceChildren();
    said(t("video_looking"));
    picks.setAttribute("aria-busy", "true");
    picks.classList.add("open");
    go.setAttribute("aria-expanded", "true");
    lastMove = Date.now();
    position();
    picks.focus({ preventScroll: true });
  }

  // The menu's message (plain text), with the app's own words under it.
  function said(text, detail) {
    note.textContent = text;
    if (detail) {
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = String(detail).slice(0, 400);
      note.append(why);
    }
    note.hidden = !text;
  }

  // The keyboard's focus goes to the menu's new rows while it is in the menu or on the button
  // (not when it was taken elsewhere meanwhile).
  const focusHere = () => {
    const a = shadow.activeElement;
    return Boolean(a) && (a === go || picks.contains(a));
  };

  // A message instead of qualities, "Open in…" under it.
  function say(j, text, detail) {
    if (!current(j)) return;
    picks.setAttribute("aria-busy", "false");
    rows.replaceChildren();
    said(text, detail);
    position();
    if (focusHere()) openRow.focus();
  }

  // The lookup's end, in the menu (lookupAction).
  function settle(j, s) {
    if (!current(j)) return;
    const a = lookupAction(s, t);
    if (a.act === "offer") return offer(j, s);
    if (a.act === "say") return say(j, a.text, a.detail);
    if (a.act === "flash") {
      closeMenu();
      dropLookup();
      return flash(a.kind, a.text);
    }
    // "use-window", "gone" (the app forgot it: restarted) and anything newer: the window.
    return useWindow(j);
  }

  // The qualities, a row each: the app's name for it and its size, as text.
  function offer(j, s) {
    j.count = Math.min(s.choices.length, 100);
    j.token = s.token;
    rows.replaceChildren(
      ...s.choices.slice(0, j.count).map((choice, i) => {
        const { name, size } = rowText(choice, lang);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pick";
        b.setAttribute("role", "menuitem");
        b.dataset.choice = String(i);
        const n = document.createElement("span");
        n.className = "name";
        n.textContent = name;
        b.append(n);
        if (size) {
          const z = document.createElement("span");
          z.className = "size";
          z.textContent = size;
          b.append(z);
        }
        return b;
      }),
    );
    said("");
    picks.setAttribute("aria-busy", "false");
    // Rows that just pushed "Open in…" down under the pointer aren't picked by a click meant for
    // it.
    j.armed = Date.now() + 300;
    position();
    if (focusHere()) rows.firstElementChild.focus();
  }

  // Asks how the lookup is going until it ends (followLookup), then shows what it came to.
  async function follow(j, first) {
    const s = await followLookup(first, {
      ask: (token, ms) => within(send({ type: "video-poll", token }), ms),
      alive: () => current(j),
      sleep: (ms) =>
        new Promise((wake) => {
          j.wake = wake;
          j.timer = setTimeout(wake, ms);
        }),
      now: Date.now,
      end: j.started + LOOKUP_MS,
    });
    if (!s || !current(j)) return;
    settle(j, s);
  }

  // The lookup is no longer wanted (its menu closed): no more questions about it.
  function dropLookup() {
    const j = job;
    job = null;
    if (!j) return;
    clearTimeout(j.timer);
    if (j.wake) j.wake();
  }

  // A quality picked: the app downloads it (its own choice of it, with what it looked the video
  // up with) without its window. Only the token and the row's number go.
  async function pick(j, i) {
    if (!current(j) || !j.count || j.picked || !(i >= 0 && i < j.count) || Date.now() < j.armed) return;
    j.picked = true;
    closeMenu();
    busy = true;
    try {
      const s = replyState(await send({ type: "video-pick", token: j.token, choice: i }));
      if (!s) return;
      // Downloading, queued, or handed to the app ("sent"): a word on the button. Anything else
      // (the lookup forgotten or another window's, an older app): the window.
      const a = lookupAction(s, t, true);
      if (a.act === "flash") return flash(a.kind, a.text);
      return await useWindow(j);
    } finally {
      busy = false;
    }
  }

  // The click as it always was: the app's Download video window for this video. Once per click.
  async function useWindow(j) {
    if (job === j) {
      closeMenu();
      dropLookup();
    }
    if (!firstWindow(j)) return;
    // Where the video is now, for the background to ask the page's player there.
    const r = await send({ type: "video", ...j.asked, ...(j.video.isConnected ? { at: middle(j.video) } : {}) });
    if (r.gone) return;
    flash(r.ok ? "ok" : "err", t(r.ok ? "video_sent" : r.why === "options" ? "video_off" : r.why === "unnamed" ? "video_unnamed" : "video_failed"));
  }

  // A row of the qualities' menu, clicked or by key.
  function choosePick(b) {
    const j = job;
    if (!j || !b) return;
    if (b.dataset.act === "window") return useWindow(j);
    if (b.dataset.choice !== undefined) return pick(j, Number(b.dataset.choice));
  }

  // A short confirmation on the button itself, then back to normal.
  function flash(kind, text) {
    flashing = true;
    pill.classList.remove("ok", "err");
    pill.classList.add(kind);
    label.textContent = text;
    lastMove = Date.now();
    position();
    setTimeout(() => {
      flashing = false;
      pill.classList.remove(kind);
      label.textContent = idleLabel;
      if (video) position();
    }, 2200);
  }

  function openMenu() {
    closeMenu();
    panel = menu;
    menuOpen = true;
    menu.classList.add("open");
    more.setAttribute("aria-expanded", "true");
    position();
    menu.querySelector("button").focus();
  }

  // Closes whichever menu is open; the qualities' takes its lookup with it.
  function closeMenu() {
    if (!menuOpen) return;
    const back = panel === picks && picks.contains(shadow.activeElement);
    menuOpen = false;
    panel.classList.remove("open");
    more.setAttribute("aria-expanded", "false");
    if (panel !== picks) return;
    go.setAttribute("aria-expanded", "false");
    picks.setAttribute("aria-busy", "false");
    dropLookup();
    // The keyboard's focus back on the button, not lost with the menu.
    if (back) go.focus();
  }

  menu.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act) run(act);
  });

  async function run(act) {
    if (act === "download") return download();
    closeMenu();
    if (act === "hide") {
      dismissed.add(video);
      if (video.currentSrc) dismissedSrc.add(video.currentSrc);
      video = null;
      return hide(true);
    }
    if (act === "never") {
      allowed = false;
      video = null;
      hide(true);
      return send({ type: "hide-site" });
    }
    if (act === "settings") send({ type: "options" });
  }

  more.addEventListener("click", () => (menuOpen && panel === menu ? closeMenu() : openMenu()));

  // The qualities' rows: only the user's own clicks.
  picks.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    choosePick(e.target.closest("button"));
  });

  // Keys (only the user's own, never ones a page script makes up): Escape closes the open menu
  // (the keyboard's focus back on its button), arrows move through it, Enter and Space run the
  // focused command.
  shadow.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    const focused = shadow.activeElement;
    if (e.key === "Escape" && menuOpen) {
      const opener = panel === picks ? go : more;
      closeMenu();
      opener.focus();
      e.stopPropagation();
    } else if (menuOpen && (e.key === "Enter" || e.key === " ") && focused && focused !== panel && panel.contains(focused)) {
      // The focused command, whatever the browser does with a key on a button.
      if (panel === picks) choosePick(focused);
      else run(focused.dataset.act);
      e.preventDefault();
    } else if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...panel.querySelectorAll("button")];
      const i = items.indexOf(focused);
      const down = e.key === "ArrowDown";
      // From the menu itself (the qualities' while it looks): the first, or the last.
      const next = i < 0 ? (down ? 0 : items.length - 1) : (i + (down ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
      e.preventDefault();
    }
  });

  // The main part: a click downloads, a drag moves it (and is not a click).
  // Only the user's own clicks and keys (never events a page script makes up).
  go.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !video || !e.isTrusted) return;
    const { r, roomX, roomY } = rects();
    dragging = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      // Where in the button it was taken.
      dx: e.clientX - (r.left + INSET + (chosen ? place : auto.at || place).x * roomX),
      dy: e.clientY - (r.top + INSET + (chosen ? place : auto.at || place).y * roomY),
      at: chosen ? place : auto.at || place,
      moved: false,
    };
    go.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  go.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if (!dragging.moved && Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) < DRAG_PX) return;
    if (!dragging.moved) {
      dragging.moved = true;
      closeMenu();
      pill.classList.add("dragging");
    }
    const { r, roomX, roomY } = rects();
    const c = (n) => Math.min(1, Math.max(0, n));
    dragging.at = {
      x: roomX ? c((e.clientX - dragging.dx - r.left - INSET) / roomX) : 0,
      y: roomY ? c((e.clientY - dragging.dy - r.top - INSET) / roomY) : 0,
    };
    position();
  });
  const endDrag = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const d = dragging;
    dragging = null;
    pill.classList.remove("dragging");
    if (!d.moved) {
      if (e.type === "pointerup") download();
      return;
    }
    place = snap(d.at);
    chosen = true;
    position();
    lastMove = Date.now();
    // Remembered per site, not in a private window (it would keep the site's name), and the
    // 200 sites used last only.
    if (ext.extension?.inIncognitoContext) return;
    try {
      ext.storage.local
        .get({ positions: {} })
        .then(({ positions }) => {
          delete positions[host];
          positions[host] = place;
          const sites = Object.keys(positions);
          for (const s of sites.slice(0, Math.max(0, sites.length - 200))) delete positions[s];
          return ext.storage.local.set({ positions });
        })
        .catch(() => {});
    } catch {
      teardown();
    }
  };
  go.addEventListener("pointerup", endDrag);
  go.addEventListener("pointercancel", endDrag);
  // Keyboard: Enter / Space (a real button's click without a pointer).
  go.addEventListener("click", (e) => {
    if (e.detail === 0 && e.isTrusted) download();
  });

  // ---- wiring -----------------------------------------------------------------------------------
  // The extension updated or removed under this page: the button and its listeners go (a fresh
  // copy of this script comes with the new extension).
  function teardown() {
    dropLookup();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(scan);
    removeEventListener("pointermove", onMove, true);
    removeEventListener("keydown", onTab, true);
    root.remove();
    allowed = false;
    video = null;
  }
  globalThis.__mdmVideoButton = { alive: () => Boolean(ext.runtime?.id), teardown };
  addEventListener("pointermove", onMove, { capture: true, passive: true });
  addEventListener("pointerdown", (e) => {
    if (menuOpen && !e.composedPath().includes(root)) closeMenu();
  }, { capture: true, passive: true });
  // A video with the keyboard's focus, or a player around one (its controls), gets the button
  // too, kept while the focus stays there; Tab goes from there to the button.
  addEventListener("focusin", (e) => {
    if (!(e.target instanceof Element) || e.composedPath().includes(root)) return;
    const t = e.target;
    const v =
      t instanceof HTMLMediaElement ? t : [...t.querySelectorAll("video, audio")].find(eligible) || null;
    if (!v || !eligible(v)) return;
    focusedPlayer = t;
    ask().then(() => {
      if (!allowed) return;
      lastMove = Date.now();
      show(v);
    });
  }, true);
  // Tab on the focused player moves into the button first; Tab from the button goes back to
  // the player and on from there (its own controls next), as if the button sat at its start.
  let tabOn = 0;
  function onTab(e) {
    if (e.key !== "Tab" || e.shiftKey) return;
    // The Tab that just left the button: on from the player, as the browser goes.
    if (Date.now() - tabOn < 100) {
      tabOn = 0;
      return;
    }
    if (video && playerFocused() && root.style.getPropertyValue("display") === "block") {
      go.focus();
      e.preventDefault();
    }
  }
  addEventListener("keydown", onTab, true);
  go.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && focusedPlayer && focusedPlayer.isConnected) {
      tabOn = Date.now();
      focusedPlayer.focus();
    }
  });
  document.addEventListener("fullscreenchange", () => video && show(video));
  addEventListener("blur", () => hide());
})();
