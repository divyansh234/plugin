(function () {
  "use strict";
  var VERSION = "1.5.0";
  var fs = window.cep.fs;
  var FF = window.DZ_FF || {
    available: false, ok: false, path: "", whenReady: function (cb) { cb(false); },
    thumb: function (i, cb) { cb(false); }, proxy: function (i, cb) { cb(false); }, probe: function (i, cb) { cb(null); },
    cacheSize: function () { return 0; }, clearCache: function () {}, setPath: function (p, cb) { cb(false); }
  };
  var EXT = {
    video: "mp4 mov mxf avi mkv m4v webm mts mpg mpeg wmv".split(" "),
    audio: "wav mp3 aac m4a aif aiff flac ogg".split(" "),
    image: "png jpg jpeg gif tif tiff bmp psd ai webp heic".split(" ")
  };
  var ALL_EXT = EXT.video.concat(EXT.audio, EXT.image);
  var KIND = {};
  Object.keys(EXT).forEach(function (k) { EXT[k].forEach(function (e) { KIND[e] = k; }); });
  var FILES = "__files__";
  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid");
  grid.tabIndex = 0;

  var S = function (d) { return '<svg viewBox="0 0 24 24">' + d + '</svg>'; };
  var ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
    video: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
    audio: S('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M21 16l-5-5-8 9"/>')
  };

  // ---------- storage ----------
  function getJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var roots = getJSON("fd_roots", []);
  var files = getJSON("fd_files", []);
  var autoRefresh = getJSON("fd_auto", true);
  try {
    var legacy = localStorage.getItem("fd_root");
    if (legacy && roots.indexOf(legacy) < 0) roots.push(legacy);
  } catch (e) {}
  var root = "";
  try { root = localStorage.getItem("fd_active") || ""; } catch (e) {}
  if (root !== FILES && roots.indexOf(root) < 0) root = roots[0] || FILES;
  function save() {
    setJSON("fd_roots", roots); setJSON("fd_files", files);
    try { localStorage.setItem("fd_active", root); } catch (e) {}
  }

  // ---------- state ----------
  var cur = root, items = [], view = [], selected = {}, tileEls = {};
  var anchor = -1, cursor = -1, typeFilter = "", renderToken = 0, pendingScroll = null;
  var dragging = false, sig = "", metaCache = {};
  var searchScope = "sub", searchOn = false, indexes = {}, building = null, buildToken = 0, lastNotify = 0;
  try { searchScope = localStorage.getItem("fd_scope") || "sub"; } catch (e) {}
  if (["here", "sub", "all"].indexOf(searchScope) < 0) searchScope = "sub";
  var INDEX_TTL = 120000, MAX_FILES = 50000, MAX_DEPTH = 12, MAX_SHOWN = 500;
  var SKIP_DIRS = { "node_modules": 1, "$recycle.bin": 1, "system volume information": 1, "__macosx": 1, ".trashes": 1, "media cache files": 1 };

  // ---------- helpers ----------
  function kindOf(n) {
    var i = n.lastIndexOf(".");
    if (i < 0) return null;
    var e = n.slice(i + 1).toLowerCase();
    return Object.prototype.hasOwnProperty.call(KIND, e) ? KIND[e] : null;
  }
  function join(a, b) { return a.replace(/[\\\/]+$/, "") + "/" + b; }
  function parentOf(p) { return p.replace(/[\\\/][^\\\/]*$/, "") || p; }
  function baseOf(p) { return p.replace(/[\\\/]+$/, "").split(/[\\\/]/).pop() || p; }
  function fileUrl(p) {
    p = p.replace(/\\/g, "/");
    return "file://" + (p.charAt(0) === "/" ? "" : "/") + encodeURI(p).replace(/#/g, "%23");
  }
  function status(t) { $("status").textContent = t; }
  function tileOf(n) {
    while (n && n !== grid) {
      if (n.getAttribute && /\btile\b/.test(n.getAttribute("class") || "")) return n;
      n = n.parentNode;
    }
    return null;
  }
  function itemOf(tile) { return view[+tile.getAttribute("data-i")]; }
  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  }
  function fmtDur(t) {
    t = Math.round(t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") + m : m) + ":" + (sec < 10 ? "0" : "") + sec;
  }
  function updateMeta(tile, it) {
    metaCache[it.path] = { size: it.size, dur: it.dur, dim: it.dim };
    if (!tile._meta) return;
    var parts = [it.name.split(".").pop().toUpperCase()];
    if (it.dim) parts.push(it.dim);
    if (it.dur) parts.push(fmtDur(it.dur));
    if (it.size != null) parts.push(fmtSize(it.size));
    tile._meta.textContent = parts.join(" · ");
    tile._dur.textContent = it.dur ? fmtDur(it.dur) : "";
  }

  // ---------- selection (no re-render) ----------
  function setSel(p, on) {
    if (on) selected[p] = true; else delete selected[p];
    var el = tileEls[p];
    if (el) { if (on) el.classList.add("sel"); else el.classList.remove("sel"); }
  }
  function clearSel() { Object.keys(selected).forEach(function (p) { setSel(p, false); }); }
  function selectRange(a, b) {
    clearSel();
    for (var k = Math.min(a, b); k <= Math.max(a, b); k++) if (view[k]) setSel(view[k].path, true);
  }
  function selectedItems() { return view.filter(function (x) { return selected[x.path] && x.kind !== "folder"; }); }

  // ---------- loading a folder / My Files ----------
  function sigOf(names) {
    return names.filter(function (n) { return n.charAt(0) !== "." && (kindOf(n) || n.indexOf(".") < 0); }).join("|");
  }
  function filesSig() { return files.map(function (p) { return p + (fs.stat(p).err === 0 ? 1 : 0); }).join("|"); }
  function mkItem(name, path, kind, missing) {
    var it = { name: name, path: path, kind: kind, missing: !!missing }, c = metaCache[path];
    if (c) { it.size = c.size; it.dur = c.dur; it.dim = c.dim; }
    return it;
  }
  function load(dir, keep) {
    var prev = keep ? selected : {}, prevN = items.length;
    pendingScroll = keep ? grid.scrollTop : null;
    cur = dir; selected = {}; items = []; anchor = cursor = -1;
    if (!keep) { preview(null); $("search").value = ""; }
    $("remove").title = dir === FILES ? "Remove selected files from My Files (Delete key)" : "Remove this folder from the list";
    if (dir === FILES) {
      files.forEach(function (p) {
        var n = baseOf(p), k = kindOf(n);
        if (k) items.push(mkItem(n, p, k, fs.stat(p).err !== 0));
      });
      sig = filesSig();
    } else if (dir) {
      var r = fs.readdir(dir);
      if (r.err !== 0) { status("Cannot read folder: " + dir); sig = "ERR"; }
      else {
        sig = sigOf(r.data);
        r.data.forEach(function (n) {
          if (n.charAt(0) === ".") return;
          var k = kindOf(n);
          if (k) { items.push(mkItem(n, join(dir, n), k)); return; }
          var s = fs.stat(join(dir, n));
          if (s.err === 0 && s.data.isDirectory()) items.push(mkItem(n, join(dir, n), "folder"));
        });
        items.sort(function (a, b) {
          if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });
      }
    } else sig = "";
    if (keep) items.forEach(function (it) { if (prev[it.path]) selected[it.path] = true; });
    else grid.scrollTop = 0;
    render();
    if (keep && prevN !== items.length) {
      var d = items.length - prevN;
      status("Folder updated (" + (d > 0 ? "+" : "") + d + ")");
    }
  }

  // ---------- lazy thumbnails ----------
  var io = null, vq = [], vActive = 0;
  function setupObserver() {
    if (io) io.disconnect();
    io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { io.unobserve(en.target); thumbFor(en.target); }
      });
    }, { root: grid, rootMargin: "300px" }) : null;
  }
  function ffThumb(tile, it, th) {
    var token = renderToken;
    FF.whenReady(function (ok) {
      if (!ok || token !== renderToken) return;
      FF.thumb(it, function (good, out) {
        if (!good || token !== renderToken) return;
        var img = new Image();
        img.onload = function () { th.appendChild(img); };
        img.src = fileUrl(out);
      });
    });
  }
  function thumbFor(tile) {
    var it = itemOf(tile); if (!it || it.missing || it.kind === "folder") return;
    try { var st = fs.stat(it.path); if (st.err === 0 && st.data && typeof st.data.size === "number") it.size = st.data.size; } catch (e) {}
    updateMeta(tile, it);
    var th = tile.firstChild;
    if (it.kind === "image") {
      if (/\.(psd|ai|tif|tiff|heic)$/i.test(it.name)) return ffThumb(tile, it, th);
      var img = new Image(); img.decoding = "async";
      img.onload = function () {
        it.dim = img.naturalWidth + "×" + img.naturalHeight; updateMeta(tile, it);
        th.appendChild(img);
      };
      img.onerror = function () { ffThumb(tile, it, th); };
      img.src = fileUrl(it.path);
    } else {
      vq.push({ th: th, it: it, tile: tile, audio: it.kind === "audio", token: renderToken }); pump();
    }
  }
  function pump() {
    while (vActive < 2 && vq.length) {
      var job = vq.shift();
      if (job.token !== renderToken) continue;
      vActive++; if (job.audio) audioMeta(job); else snapshot(job);
    }
  }
  function audioMeta(job) {
    var a = document.createElement("audio"), finished = false, tm;
    a.preload = "metadata";
    function done() {
      if (finished) return; finished = true; clearTimeout(tm);
      try { a.removeAttribute("src"); a.load(); } catch (e) {}
      vActive--; pump();
    }
    tm = setTimeout(done, 4000);
    a.onloadedmetadata = function () {
      if (isFinite(a.duration)) { job.it.dur = a.duration; updateMeta(job.tile, job.it); }
      done();
    };
    a.onerror = done;
    a.src = fileUrl(job.it.path);
  }
  // load a video just long enough to grab one frame, then free it
  function snapshot(job) {
    var v = document.createElement("video"), finished = false, drew = false, tm;
    v.muted = true; v.preload = "metadata";
    function done() {
      if (finished) return; finished = true; clearTimeout(tm);
      try { v.removeAttribute("src"); v.load(); } catch (e) {}
      vActive--; pump();
      if (!drew && job.token === renderToken) ffThumb(job.tile, job.it, job.th);   // ProRes, HEVC, MXF...
    }
    tm = setTimeout(done, 6000);
    v.onloadedmetadata = function () {
      if (isFinite(v.duration)) job.it.dur = v.duration;
      if (v.videoWidth) job.it.dim = v.videoWidth + "×" + v.videoHeight;
      updateMeta(job.tile, job.it);
      try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) {}
    };
    v.onseeked = function () {
      try {
        if (job.token === renderToken && v.videoWidth) {
          var c = document.createElement("canvas"), W = 240, H = 135;
          c.width = W; c.height = H;
          var s = Math.max(W / v.videoWidth, H / v.videoHeight), w = v.videoWidth * s, h = v.videoHeight * s;
          c.getContext("2d").drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
          job.th.appendChild(c); drew = true;
        }
      } catch (e) {}
      done();
    };
    v.onerror = done;
    v.src = fileUrl(job.it.path);
  }

  // ---------- hover scrub ----------
  var hv = null, hoverTile = null, hoverTimer = 0;
  function hoverStop() {
    clearTimeout(hoverTimer);
    if (!hv) return;
    try { hv.el.removeAttribute("src"); hv.el.load(); } catch (e) {}
    if (hv.el.parentNode) hv.el.parentNode.removeChild(hv.el);
    hv = null;
  }
  function hoverStart(tile) {
    var it = itemOf(tile);
    if (!it || it.kind !== "video" || it.missing) return;
    var v = document.createElement("video");
    v.className = "scrub"; v.muted = true; v.preload = "metadata";
    v.onloadeddata = function () { v.className = "scrub on"; };
    v.src = fileUrl(it.path);
    tile.firstChild.appendChild(v);
    hv = { el: v, tile: tile, raf: 0 };
  }
  grid.addEventListener("mouseover", function (e) {
    var tile = tileOf(e.target);
    if (tile === hoverTile) return;
    hoverTile = tile; hoverStop();
    if (tile) hoverTimer = setTimeout(function () { hoverStart(tile); }, 180);
  });
  grid.addEventListener("mouseleave", function () { hoverTile = null; hoverStop(); });
  grid.addEventListener("mousemove", function (e) {
    var h = hv;
    if (!h || h.raf || !h.el.duration) return;
    var r = h.tile.getBoundingClientRect();
    var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    h.raf = requestAnimationFrame(function () {
      h.raf = 0;
      try { h.el.currentTime = h.el.duration * x; } catch (er) {}
    });
  });

  // ---------- fuzzy search (ignores case, punctuation, accents; tolerates typos) ----------
  function norm(s) {
    s = s.toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s;
  }
  function prep(it) {
    if (it._w) return;
    it._n = norm(it.name).replace(/[_\-.()\[\]]+/g, " ").replace(/\s+/g, " ").trim();
    it._w = it._n.split(" ");
    it._c = it._n.replace(/ /g, "");
  }
  // edit distance (counts a swapped pair of letters as 1); gives up early once it exceeds max
  function dist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i]; var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  function subseq(t, w) {
    var j = 0;
    for (var i = 0; i < w.length && j < t.length; i++) if (w.charAt(i) === t.charAt(j)) j++;
    return j === t.length;
  }
  function tokenScore(t, it, fz) {
    var w = it._w, best = -1, k, word, d, L, idx;
    for (k = 0; k < w.length; k++) {
      word = w[k];
      if (word === t) return 120;
      idx = word.indexOf(t);
      if (idx === 0) best = Math.max(best, 110); else if (idx > 0) best = Math.max(best, 100);
    }
    if (best >= 0) return best;
    if (it._n.indexOf(t) > -1) return 100;
    if (it._c.indexOf(t) > -1) return 90;
    if (t.length < 3 || fz === false) return -1;
    var max = t.length <= 3 ? 0 : t.length <= 5 ? 1 : 2;
    for (k = 0; k < w.length; k++) {
      word = w[k];
      if (max) {
        d = dist(t, word, max);
        if (d <= max) best = Math.max(best, 80 - d * 15);
        for (L = t.length - 1; L <= t.length + 1; L++) {      // typo while the word is still unfinished
          if (L < 1 || word.length <= L) continue;
          d = dist(t, word.slice(0, L), max);
          if (d <= max) best = Math.max(best, 75 - d * 15);
        }
      }
      if (t.charAt(0) === word.charAt(0) && subseq(t, word)) best = Math.max(best, 40 + Math.round(20 * t.length / word.length));
    }
    return best;
  }
  function prepRel(it) {
    if (it._r) return it._r;
    var n = norm(it.rel || "").replace(/[\/_\-.()\[\]]+/g, " ").replace(/\s+/g, " ").trim();
    return (it._r = { _n: n, _w: n ? n.split(" ") : [], _c: n.replace(/ /g, "") });
  }
  function scoreItem(it, tokens, fz) {
    prep(it);
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var sc = tokenScore(tokens[i], it, fz);
      if (sc < 0 && it.rel) {                       // also match the names of the folders it sits in
        var r = prepRel(it);
        if (r._n) { var s2 = tokenScore(tokens[i], r, fz); if (s2 >= 0) sc = Math.round(s2 * 0.5); }
      }
      if (sc < 0) return -1;
      total += sc;
    }
    return total;
  }

  // ---------- search index (subfolders / everywhere), built in the background ----------
  function nrm(p) { return p.replace(/\\/g, "/").replace(/\/+$/, ""); }
  function looksLikeDir(n) { return !/\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(n); }   // skip "x.txt", "x.xml"... without a stat call
  function staleIndexes() { Object.keys(indexes).forEach(function (k) { indexes[k].ts = 0; }); }
  function mkIdx(n, p, k, dir, base) {
    var it = mkItem(n, p, k); it.dir = dir;
    var d = nrm(dir), b = nrm(base);
    it.rel = d === b ? "" : d.slice(b.length + 1);
    return it;
  }
  function derive(dir) {      // reuse a finished index of a parent folder instead of scanning again
    var d = nrm(dir), ks = Object.keys(indexes);
    for (var i = 0; i < ks.length; i++) {
      var ix = indexes[ks[i]];
      if (!ix.done || Date.now() - ix.ts > INDEX_TTL) continue;
      var ok = ks[i] === "ALL"
        ? roots.some(function (r) { var n = nrm(r); return d === n || d.indexOf(n + "/") === 0; })
        : (d === nrm(ks[i]) || d.indexOf(nrm(ks[i]) + "/") === 0);
      if (!ok) continue;
      var out = { items: ix.items.filter(function (it) { return nrm(it.path).indexOf(d + "/") === 0; }),
        done: true, ts: ix.ts, folders: ix.folders, truncated: ix.truncated };
      indexes[dir] = out;
      return out;
    }
    return null;
  }
  function notifyIndex(key, finished) {
    var now = Date.now();
    if (!finished && now - lastNotify < 350) return;
    lastNotify = now;
    var here = searchScope === "all" ? "ALL" : cur;
    if (key === here && $("search").value.trim() && searchScope !== "here") { pendingScroll = grid.scrollTop; render(); }
  }
  function startIndex(key, silent) {
    if (building && building !== key && indexes[building] && !indexes[building].done) delete indexes[building];
    building = key;
    var tok = ++buildToken, ix = { items: [], done: false, ts: Date.now(), folders: 0, truncated: false };
    if (!silent) indexes[key] = ix;
    var queue = [], seenDir = {}, seenPath = {};
    function push(it) { if (!seenPath[it.path]) { seenPath[it.path] = 1; ix.items.push(it); } }
    if (key === "ALL") {
      files.forEach(function (p) { var n = baseOf(p), k = kindOf(n); if (k) push(mkIdx(n, p, k, parentOf(p), parentOf(p))); });
      roots.forEach(function (r) { queue.push({ dir: r, base: r, depth: 0 }); });
    } else queue.push({ dir: key, base: key, depth: 0 });
    (function step() {
      if (tok !== buildToken) return;
      var t0 = Date.now();
      while (queue.length && Date.now() - t0 < 14) {
        var q = queue.shift(), dn = nrm(q.dir);
        if (seenDir[dn]) continue;
        seenDir[dn] = 1;
        var r = fs.readdir(q.dir); ix.folders++;
        if (r.err !== 0) continue;
        for (var i = 0; i < r.data.length; i++) {
          var n = r.data[i];
          if (n.charAt(0) === ".") continue;
          var k = kindOf(n), p = join(q.dir, n);
          if (k) push(mkIdx(n, p, k, q.dir, q.base));
          else if (q.depth < MAX_DEPTH && looksLikeDir(n) && !SKIP_DIRS[n.toLowerCase()]) {
            var st = fs.stat(p);
            if (st.err === 0 && st.data.isDirectory()) { push(mkIdx(n, p, "folder", q.dir, q.base)); queue.push({ dir: p, base: q.base, depth: q.depth + 1 }); }
          }
        }
        if (ix.items.length >= MAX_FILES) { ix.truncated = true; queue.length = 0; }
      }
      if (queue.length) { notifyIndex(key, false); setTimeout(step, 0); }
      else {
        ix.done = true; ix.ts = Date.now();
        if (silent) indexes[key] = ix;
        if (building === key) building = null;
        notifyIndex(key, true);
      }
    })();
  }
  function getIndex() {
    var key = searchScope === "all" ? "ALL" : cur;
    if (!key || key === FILES) return null;
    var ix = indexes[key] || (key !== "ALL" ? derive(key) : null);
    if (!ix) { startIndex(key, false); return indexes[key]; }
    if (ix.done && Date.now() - ix.ts > INDEX_TTL && building !== key) startIndex(key, true);
    return ix;
  }
  function whereOf(it) {      // where a search result lives, shown under its name
    if (!searchOn || !it.dir) return "";
    var d = nrm(it.dir);
    if (searchScope !== "all") {
      var b = nrm(cur);
      if (d === b) return "";
      return d.indexOf(b + "/") === 0 ? d.slice(b.length + 1) : baseOf(d);
    }
    var best = null;
    roots.forEach(function (r) { var n = nrm(r); if ((d === n || d.indexOf(n + "/") === 0) && (!best || n.length > nrm(best).length)) best = r; });
    if (!best) return d;
    var rel = d.slice(nrm(best).length + 1);
    return baseOf(best) + (rel ? "/" + rel : "");
  }

  // ---------- rendering (chunked) ----------
  function makeTile(it, i) {
    var d = document.createElement("div");
    d.className = "tile" + (selected[it.path] ? " sel" : "") + (it.missing ? " missing" : "");
    d.setAttribute("data-i", i);
    d.title = it.missing ? "File not found: " + it.path : it.path;
    var ext = it.name.split(".").pop().toUpperCase().replace(/[^A-Z0-9]/g, "");
    d.innerHTML = '<div class="thumb ' + it.kind + '">' + (ICONS[it.kind] || ICONS.image) +
      (it.kind === "folder" ? "" : '<span class="badge">' + ext + '</span><span class="dur"></span>') +
      '</div><div class="name"></div><div class="meta"></div><div class="where"></div>';
    d.children[1].textContent = it.name;
    d._dur = d.querySelector(".dur"); d._meta = d.querySelector(".meta");
    d.querySelector(".where").textContent = whereOf(it);
    if (it.kind !== "folder" && !it.missing) d.draggable = true;
    tileEls[it.path] = d;
    if (it.kind !== "folder") updateMeta(d, it);
    if (it.kind !== "folder" && !it.missing) { if (io) io.observe(d); else thumbFor(d); }
    return d;
  }
  function render() {
    var token = ++renderToken;
    vq = []; hoverStop(); setupObserver();
    grid.innerHTML = ""; tileEls = {};
    $("path").textContent = cur === FILES ? "Individual files" : (cur || "Nothing selected");
    var q = $("search").value.trim(), typeOk = function (i) { return !typeFilter || i.kind === "folder" || i.kind === typeFilter; };
    var ix = null, truncated = 0;
    searchOn = !!q && searchScope !== "here";
    applyView();
    if (q) {
      var pool = items;
      if (searchOn) { ix = getIndex(); if (ix) pool = ix.items; }
      var tokens = norm(q).split(/\s+/), ranked = [], fz = pool.length < 20000 || q.length >= 4;
      pool.forEach(function (it, idx) {
        if (!typeOk(it)) return;
        var sc = scoreItem(it, tokens, fz);
        if (sc >= 0) ranked.push({ it: it, s: sc, i: idx });
      });
      ranked.sort(function (a, b) { return b.s - a.s || a.i - b.i; });   // best match first
      if (ranked.length > MAX_SHOWN) { truncated = ranked.length; ranked = ranked.slice(0, MAX_SHOWN); }
      view = ranked.map(function (r) { return r.it; });
      status(view.length + " result" + (view.length === 1 ? "" : "s") + " for \u201c" + q + "\u201d" +
        (searchOn ? (searchScope === "all" ? " in all folders" : " in subfolders") : "") +
        (truncated ? " · top " + MAX_SHOWN + " of " + truncated : "") +
        (ix && !ix.done ? " · searching… " + ix.items.length + " files so far" : "") +
        (ix && ix.truncated ? " · limited to the first " + MAX_FILES + " files" : ""));
    } else view = items.filter(typeOk);
    if (!view.length) {
      var msg = q ? (ix && !ix.done ? "Searching subfolders… " + ix.items.length + " files so far" : "No match for \u201c" + q + "\u201d. Try fewer letters or another spelling.")
        : cur === FILES
          ? (roots.length ? "No individual files yet. Use the file button to add some." : "Click ＋ to add a folder, or the file button to add files.")
          : "Nothing here";
      var box = document.createElement("div");
      box.className = "empty"; box.textContent = msg;
      grid.appendChild(box);
      return;
    }
    var i = 0, BATCH = 40;
    (function step() {
      if (token !== renderToken) return;
      var frag = document.createDocumentFragment();
      for (var n = 0; n < BATCH && i < view.length; n++, i++) frag.appendChild(makeTile(view[i], i));
      grid.appendChild(frag);
      if (pendingScroll != null) { grid.scrollTop = pendingScroll; if (i >= view.length) pendingScroll = null; }
      if (i < view.length) requestAnimationFrame(step);
    })();
  }

  // ---------- preview (premium players, ffmpeg fallback) ----------
  var DZ = window.DZ_Player;
  var previewToken = 0, previewTimer = 0, curPlayer = null, previewBig = false, infoClosed = false;
  infoClosed = true;
  try { infoClosed = localStorage.getItem("fd_info_closed") !== "0"; } catch (e) {}
  var infoState = {}, previewItem = null;
  var INFO = {
    video: [["type", "Type"], ["res", "Resolution"], ["fps", "Frame rate"], ["dur", "Duration"], ["size", "File size"], ["codec", "Codec"], ["color", "Color space"], ["mod", "Modified"]],
    audio: [["type", "Type"], ["dur", "Duration"], ["rate", "Sample rate"], ["bits", "Bit depth"], ["ch", "Channels"], ["codec", "Codec"], ["size", "File size"], ["mod", "Modified"]],
    image: [["type", "Type"], ["res", "Dimensions"], ["size", "File size"], ["mod", "Modified"], ["loc", "Location"]]
  };
  INFO.video.push(["loc", "Location"]); INFO.audio.push(["loc", "Location"]);
  var SUMMARY = { video: ["res", "fps", "dur"], audio: ["dur", "rate", "bits"], image: ["res", "size"] };
  var KINDLABEL = { video: "Video", audio: "Audio", image: "Photo" };
  var CODECS = {
    h264: "H.264", hevc: "H.265 (HEVC)", prores: "Apple ProRes", mpeg4: "MPEG-4", vp9: "VP9", vp8: "VP8", av1: "AV1", dnxhd: "DNxHD",
    mpeg2video: "MPEG-2", mjpeg: "Motion JPEG", aac: "AAC", mp3: "MP3", flac: "FLAC", vorbis: "Vorbis", opus: "Opus", alac: "ALAC", ac3: "AC-3",
    pcm_s16le: "PCM 16-bit", pcm_s24le: "PCM 24-bit", pcm_s32le: "PCM 32-bit", pcm_f32le: "PCM float", pcm_s16be: "PCM 16-bit", pcm_s24be: "PCM 24-bit"
  };
  function niceCodec(c, prof) {
    if (!c) return "";
    var n = CODECS[c] || c.toUpperCase();
    return prof && prof.length < 14 ? n + " (" + prof + ")" : n;
  }
  function niceColor(c) {
    if (!c) return "";
    if (/^bt709/.test(c)) return "Rec. 709";
    if (/^bt2020/.test(c)) return "Rec. 2020";
    if (c === "smpte170m" || c === "bt470bg") return "Rec. 601";
    if (c === "smpte2084") return "HDR10 (PQ)";
    if (c === "arib-std-b67") return "HLG";
    return c;
  }
  function fmtDate(ms) {
    var d = ms instanceof Date ? ms : new Date(+ms);
    if (isNaN(d.getTime())) return "";
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function stopMedia() {
    var old = $("preview").querySelector("video,audio");
    if (old) { try { old.pause(); old.removeAttribute("src"); old.load(); } catch (e) {} }
  }
  function destroyPlayer() {
    if (curPlayer) { try { curPlayer.destroy(); } catch (e) {} curPlayer = null; }
    stopMedia();
  }
  function setInfo(o) {
    var pv = $("preview");
    Object.keys(o).forEach(function (k) {
      if (o[k] == null || o[k] === "") return;
      infoState[k] = o[k];
      var v = pv.querySelector('.irow[data-k="' + k + '"] .v');
      if (v) v.textContent = o[k];
    });
    var pp = pv.querySelector(".ppath");      // one-line summary under the file name
    if (pp && previewItem) {
      var parts = SUMMARY[previewItem.kind].map(function (k) { return infoState[k]; }).filter(Boolean);
      if (parts.length) pp.textContent = parts.join(" · ");
    }
  }
  function probeToInfo(it, p) {
    var o = {};
    if (p.dur) o.dur = fmtDur(p.dur);
    if (it.kind === "video") {
      if (p.w) o.res = p.w + " × " + p.h + (p.w >= 7600 ? " (8K)" : p.w >= 3800 ? " (4K)" : "");
      if (p.fps) o.fps = (Math.round(p.fps * 100) / 100) + " fps";
      o.codec = niceCodec(p.vcodec, p.vprofile); o.color = niceColor(p.color);
    } else if (it.kind === "audio") {
      if (p.rate) o.rate = p.rate.toLocaleString() + " Hz";
      if (p.bits) o.bits = p.bits + " bit";
      if (p.ch) o.ch = p.ch === "mono" ? "Mono" : p.ch === "stereo" ? "Stereo" : p.ch;
      o.codec = niceCodec(p.acodec);
    } else if (p.w) o.res = p.w + " × " + p.h;
    return o;
  }
  function fillInfo(it, tok) {
    var o = { type: KINDLABEL[it.kind] + " · " + it.name.split(".").pop().toUpperCase(), loc: parentOf(it.path) };
    if (it.size != null) o.size = fmtSize(it.size);
    if (it.dur) o.dur = fmtDur(it.dur);
    if (it.dim) o.res = it.dim.replace("×", " × ");
    try {
      var st = fs.stat(it.path);
      if (st.err === 0 && st.data) {
        if (typeof st.data.size === "number") o.size = fmtSize(st.data.size);
        var md = fmtDate(st.data.mtime); if (md) o.mod = md;
      }
    } catch (e) {}
    setInfo(o);
    FF.whenReady(function (ok) {
      if (!ok || tok !== previewToken) return;
      FF.probe(it, function (p) { if (p && tok === previewToken) setInfo(probeToInfo(it, p)); });
    });
  }
  function preview(it) {
    clearTimeout(previewTimer); destroyPlayer();
    var pv = $("preview"), tok = ++previewToken;
    previewItem = null; infoState = {};
    if (!it || it.kind === "folder" || it.missing) { pv.innerHTML = ""; pv.style.display = "none"; return; }
    previewItem = it;
    pv.style.display = "block";
    pv.className = "k-" + it.kind + (previewBig ? " big" : "");
    var rows = INFO[it.kind].map(function (r) { return '<div class="irow" data-k="' + r[0] + '"><span class="k">' + r[1] + '</span><span class="v">—</span></div>'; }).join("");
    pv.innerHTML =
      '<div class="pv-head"><span class="pv-ico">' + (ICONS[it.kind] || ICONS.image) + '</span>' +
      '<div class="pv-title"><div class="pname"></div><div class="ppath"></div></div>' +
      '<button class="icon sm pv-big" title="Expand / shrink preview">' + DZ.icons.expand + '</button>' +
      '<button class="icon sm pv-x" title="Close preview (Esc)">' + DZ.icons.close + '</button></div>' +
      '<div class="pstage"></div><div class="pctl"></div><div class="pstrip"></div><div class="pbar"></div>' +
      '<div class="pinfo' + (infoClosed ? " closed" : "") + '"><div class="ihead"><span>Details</span>' + DZ.icons.chev + '</div><div class="igrid">' + rows + '</div></div>';
    pv.querySelector(".pname").textContent = it.name;
    var pp = pv.querySelector(".ppath"); pp.textContent = it.name.split(".").pop().toUpperCase(); pp.title = it.path;
    pv.querySelector(".pv-x").onclick = function () { preview(null); };
    pv.querySelector(".pv-big").onclick = function () {
      previewBig = !previewBig; pv.classList.toggle("big", previewBig);
      if (curPlayer && curPlayer.relayout) curPlayer.relayout();
    };
    pv.querySelector(".ihead").onclick = function () {
      var box = pv.querySelector(".pinfo"); box.classList.toggle("closed");
      try { localStorage.setItem("fd_info_closed", box.classList.contains("closed") ? "1" : "0"); } catch (e) {}
    };
    fillInfo(it, tok);
    showMedia(it, fileUrl(it.path), tok, false);
  }
  function schedulePreview(it) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { preview(it); }, 130);
  }
  function indexOfPath(p) { for (var i = 0; i < view.length; i++) if (view[i].path === p) return i; return -1; }
  function navTarget(it, dir) {      // previous / next file of the same kind in the list
    for (var j = indexOfPath(it.path) + dir; j >= 0 && j < view.length; j += dir) if (view[j].kind === it.kind) return j;
    return -1;
  }
  function ctxFor(it, tok, isProxy, url) {
    var pv = $("preview"), failed = false;
    return {
      it: it, url: url, isProxy: isProxy,
      stage: pv.querySelector(".pstage"), ctl: pv.querySelector(".pctl"), strip: pv.querySelector(".pstrip"),
      sizeText: fmtSize,
      fail: function () {
        if (failed || tok !== previewToken) return; failed = true;
        if (!isProxy) makeProxy(it, tok); else pv.querySelector(".pbar").textContent = "Couldn't play this preview";
      },
      info: setInfo,
      canNav: function (d) { return navTarget(it, d) >= 0; },
      nav: function (d) { var n = navTarget(it, d); if (n >= 0) moveTo(n, false, true); },
      siblings: function () {
        var imgs = view.filter(function (x) { return x.kind === "image"; }), at = 0, k;
        for (k = 0; k < imgs.length; k++) if (imgs[k].path === it.path) at = k;
        return imgs.slice(Math.max(0, at - 8), at + 9).map(function (x) {
          var t = tileEls[x.path], im = t && t.querySelector("img");
          return { it: x, name: x.name, src: im ? im.src : "", active: x.path === it.path };
        });
      },
      pick: function (o) { var n = indexOfPath(o.it.path); if (n >= 0) moveTo(n, false, true); }
    };
  }
  function showMedia(it, url, tok, isProxy) {
    var pv = $("preview"), stage = pv.querySelector(".pstage"), bar = pv.querySelector(".pbar");
    if (!stage || tok !== previewToken) return;
    destroyPlayer();
    stage.className = "pstage"; stage.innerHTML = "";
    pv.querySelector(".pctl").innerHTML = ""; pv.querySelector(".pstrip").innerHTML = ""; bar.textContent = "";
    var c = ctxFor(it, tok, isProxy, url);
    curPlayer = it.kind === "video" ? DZ.video(c) : it.kind === "audio" ? DZ.audio(c) : DZ.photo(c);
    if (isProxy) bar.textContent = "Smooth preview · cached copy";
    else if (it.kind === "video") FF.whenReady(function (ok) {
      if (!ok || tok !== previewToken || bar.firstChild || bar.textContent) return;
      var b = document.createElement("button");
      b.className = "mini"; b.textContent = "⚡ Smooth preview"; b.title = "Play a lightweight 480p copy (cached)";
      b.onclick = function () { makeProxy(it, tok); };
      bar.appendChild(b);
    });
  }
  function makeProxy(it, tok) {
    var bar = $("preview").querySelector(".pbar");
    if (!bar) return;
    if (!FF.available) { bar.textContent = "Can't play this format here (it still works on the timeline). Restart Premiere after updating to enable smooth previews."; return; }
    FF.whenReady(function (ok) {
      if (tok !== previewToken) return;
      if (!ok) { bar.textContent = "Can't play this format here. Install ffmpeg for previews (⚙ Settings)."; return; }
      bar.textContent = "Creating preview… 0%";
      FF.proxy(it, function (good, out) {
        if (tok !== previewToken) return;
        if (!good) { bar.textContent = "Couldn't create a preview for this file"; return; }
        showMedia(it, fileUrl(out), tok, true);
      }, function (secs) {
        if (tok !== previewToken) return;
        bar.textContent = "Creating preview… " + (it.dur ? Math.min(99, Math.round(secs / it.dur * 100)) + "%" : Math.round(secs) + "s");
      });
    });
  }

  // ---------- insert ----------
  function insertItems(list) {
    list = list.filter(function (x) { return x.kind !== "folder" && !x.missing; });
    if (!list.length) return status("Nothing to insert");
    var arg = list.map(function (x) { return (x.kind === "audio" ? "A" : "V") + x.path; }).join("\n");
    window.__adobe_cep__.evalScript("fd_insertMany(" + JSON.stringify(arg) + ")", function (r) {
      status(r === "ok" ? "Inserted " + list.length + " clip" + (list.length > 1 ? "s" : "") : r);
    });
  }

  // ---------- grid interactions ----------
  grid.addEventListener("click", function (e) {
    var tile = tileOf(e.target); if (!tile) return;
    try { grid.focus(); } catch (er) {}
    var i = +tile.getAttribute("data-i"), it = view[i];
    if (!it || it.kind === "folder") return;
    if (e.shiftKey && anchor > -1) { selectRange(anchor, i); cursor = i; }
    else if (e.ctrlKey || e.metaKey) { setSel(it.path, !selected[it.path]); anchor = cursor = i; }
    else { clearSel(); setSel(it.path, true); anchor = cursor = i; }
    preview(selected[it.path] ? it : null);
    var n = Object.keys(selected).length;
    if (n > 1) status(n + " selected · drag or press Enter to insert them in order");
  });
  grid.addEventListener("dblclick", function (e) {
    var tile = tileOf(e.target); if (!tile) return;
    var it = itemOf(tile); if (!it) return;
    if (it.kind === "folder") return openFolder(it.path);
    if (it.missing) return status("File not found: " + it.path);
    insertItems([it]);
  });
  grid.addEventListener("dragstart", function (e) {
    var tile = tileOf(e.target); if (!tile) return;
    var it = itemOf(tile);
    if (!it || it.kind === "folder" || it.missing) { e.preventDefault(); return; }
    hoverTile = null; hoverStop(); dragging = true;
    if (!selected[it.path]) { clearSel(); setSel(it.path, true); }
    var paths = selectedItems().map(function (x) { return x.path; });
    e.dataTransfer.effectAllowed = "copyMove";
    paths.forEach(function (p, n) { e.dataTransfer.setData("com.adobe.cep.dnd.file." + n, p); });
    e.dataTransfer.setData("com.adobe.cep.dnd.file.length", String(paths.length));
    status("Dragging " + paths.length + " file(s)…");
  });
  document.addEventListener("dragend", function () { dragging = false; });

  // ---------- toolbar ----------
  function renderRoots() {
    var sel = $("folders"); sel.innerHTML = "";
    function add(v, label, title) {
      var o = document.createElement("option");
      o.value = v; o.textContent = label; o.title = title;
      sel.appendChild(o);
    }
    add(FILES, "★ My Files (" + files.length + ")", "Individually added files");
    roots.forEach(function (r) { add(r, baseOf(r), r); });
    sel.value = root;
  }
  function removeSelectedFiles() {
    var n = Object.keys(selected).length;
    if (!n) return status("Select files first, then remove them from My Files");
    files = files.filter(function (p) { return !selected[p]; });
    save(); renderRoots(); load(FILES);
    status("Removed " + n + " file(s) from the list (not deleted from disk)");
  }
  function openFolder(p) {
    var np = nrm(p), best = null;
    roots.forEach(function (r) { var n = nrm(r); if ((np === n || np.indexOf(n + "/") === 0) && (!best || n.length > nrm(best).length)) best = r; });
    if (best && best !== root) { root = best; save(); renderRoots(); }
    load(p);
  }
  function goUp() { if (cur && cur !== FILES && cur !== root) load(parentOf(cur)); }
  var startDir = function () { return cur && cur !== FILES ? cur : ""; };

  $("choose").onclick = function () {
    var r = fs.showOpenDialogEx(true, true, "Choose folder(s)", startDir());
    if (r.err === 0 && r.data && r.data.length) {
      r.data.forEach(function (p) { if (roots.indexOf(p) < 0) roots.push(p); });
      root = r.data[r.data.length - 1];
      staleIndexes(); save(); renderRoots(); load(root);
    }
  };
  $("addfile").onclick = function () {
    var r = fs.showOpenDialogEx(true, false, "Add files", startDir(), ALL_EXT, "Media files");
    if (r.err === 0 && r.data && r.data.length) {
      var added = 0;
      r.data.forEach(function (p) { if (files.indexOf(p) < 0) { files.push(p); added++; } });
      root = FILES; staleIndexes(); save(); renderRoots(); load(FILES);
      status("Added " + added + " file(s) to My Files");
    }
  };
  $("folders").onchange = function () { root = this.value; save(); load(root); };
  $("remove").onclick = function () {
    if (root === FILES) return removeSelectedFiles();
    roots = roots.filter(function (r) { return r !== root; });
    root = roots[0] || FILES; staleIndexes(); save(); renderRoots(); load(root);
  };
  $("refresh").onclick = function () { staleIndexes(); if (cur) load(cur, true); };
  $("up").onclick = goUp;
  var searchTimer = 0;
  $("search").oninput = function () { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); };
  Array.prototype.forEach.call(document.querySelectorAll("#chips button"), function (b) {
    b.onclick = function () {
      typeFilter = b.getAttribute("data-t");
      Array.prototype.forEach.call(document.querySelectorAll("#chips button"), function (x) { x.className = x === b ? "on" : ""; });
      render();
    };
  });

  // ---------- view modes ----------
  var viewMode = "grid";
  try { viewMode = localStorage.getItem("fd_view") || "grid"; } catch (e) {}
  if (["grid", "large", "list"].indexOf(viewMode) < 0) viewMode = "grid";
  var viewBtns = document.querySelectorAll("#views button");
  function applyView() {
    grid.className = "v-" + viewMode + (searchOn ? " searching" : "");
    Array.prototype.forEach.call(viewBtns, function (b) { b.className = b.getAttribute("data-v") === viewMode ? "on" : ""; });
  }
  Array.prototype.forEach.call(viewBtns, function (b) {
    b.onclick = function () {
      viewMode = b.getAttribute("data-v");
      try { localStorage.setItem("fd_view", viewMode); } catch (e) {}
      applyView();
    };
  });
  applyView();

  // ---------- search scope ----------
  $("scope").value = searchScope;
  $("scope").onchange = function () {
    searchScope = this.value;
    try { localStorage.setItem("fd_scope", searchScope); } catch (e) {}
    render();
  };
  $("search").onfocus = function () { if (searchScope !== "here" && cur && cur !== FILES || searchScope === "all") getIndex(); };   // start indexing before the first keystroke

  // ---------- settings ----------
  function renderSettings() {
    $("ver").textContent = "v" + VERSION;
    $("autoref").checked = autoRefresh;
    var st = $("ffstate");
    if (!FF.available) st.textContent = "Unavailable. Restart Premiere Pro after installing this version.";
    else if (FF.ok) st.textContent = "✓ Ready · " + FF.path + " · cache " + (FF.cacheSize() / 1048576).toFixed(1) + " MB";
    else st.textContent = "ffmpeg not found. Install it from ffmpeg.org, or click Locate.";
    $("ffloc").disabled = $("ffclear").disabled = !FF.available;
  }
  function toggleSettings(show) { $("settings").style.display = show ? "block" : "none"; if (show) renderSettings(); }
  $("gear").onclick = function () { toggleSettings(true); };
  $("sclose").onclick = function () { toggleSettings(false); };
  $("autoref").onchange = function () { autoRefresh = this.checked; setJSON("fd_auto", autoRefresh); };
  $("ffloc").onclick = function () {
    var r = fs.showOpenDialogEx(false, false, "Locate ffmpeg", "", null, "ffmpeg");
    if (r.err === 0 && r.data && r.data.length) FF.setPath(r.data[0], function (ok) {
      status(ok ? "ffmpeg is ready" : "That file doesn't look like ffmpeg"); renderSettings();
    });
  };
  $("ffclear").onclick = function () { FF.clearCache(); renderSettings(); status("Preview cache cleared"); };
  FF.whenReady(function () { if ($("settings").style.display === "block") renderSettings(); });
  $("vbadge").textContent = "v" + VERSION;

  // ---------- keyboard ----------
  function columns() {
    var first = grid.children[0];
    if (!first || viewMode === "list") return 1;
    var top = first.offsetTop, n = 0;
    while (n < grid.children.length && grid.children[n].offsetTop === top) n++;
    return Math.max(1, n);
  }
  function moveTo(i, extend, now) {
    if (!view.length) return;
    i = Math.max(0, Math.min(view.length - 1, i));
    if (extend && anchor > -1) selectRange(anchor, i);
    else { clearSel(); setSel(view[i].path, true); anchor = i; }
    cursor = i;
    var el = tileEls[view[i].path];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    if (!extend) { var tgt = view[i].kind === "folder" ? null : view[i]; if (now) preview(tgt); else schedulePreview(tgt); }
  }
  function move(delta, extend) { moveTo(cursor < 0 ? (delta > 0 ? 0 : view.length - 1) : cursor + delta, extend); }
  function activate() {
    var sel = selectedItems();
    if (sel.length) return insertItems(sel);
    var it = view[cursor];
    if (it && it.kind === "folder") openFolder(it.path);
  }
  function togglePlay() {
    var m = $("preview").querySelector("video,audio");
    if (!m) return;
    try { if (m.paused) m.play(); else m.pause(); } catch (e) {}
  }
  function selectAll() {
    clearSel();
    view.forEach(function (x) { if (x.kind !== "folder") setSel(x.path, true); });
    status(Object.keys(selected).length + " selected");
  }
  document.addEventListener("keydown", function (e) {
    var tag = e.target && e.target.tagName, k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "f" || k === "F")) { e.preventDefault(); $("search").focus(); $("search").select(); return; }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      if (tag !== "INPUT" || e.target.type === "checkbox") return;
      if (k === "Escape") { $("search").value = ""; $("search").blur(); render(); }
      else if (k === "ArrowDown" || k === "Enter") { e.preventDefault(); $("search").blur(); try { grid.focus(); } catch (er) {} if (cursor < 0) moveTo(0); }
      return;
    }
    if ($("settings").style.display === "block") { if (k === "Escape") toggleSettings(false); return; }
    switch (k) {
      case "ArrowRight": e.preventDefault(); move(1, e.shiftKey); break;
      case "ArrowLeft": e.preventDefault(); move(-1, e.shiftKey); break;
      case "ArrowDown": e.preventDefault(); move(columns(), e.shiftKey); break;
      case "ArrowUp": e.preventDefault(); move(-columns(), e.shiftKey); break;
      case "Home": e.preventDefault(); moveTo(0, e.shiftKey); break;
      case "End": e.preventDefault(); moveTo(view.length - 1, e.shiftKey); break;
      case "Enter": e.preventDefault(); activate(); break;
      case " ": e.preventDefault(); togglePlay(); break;
      case "Escape": clearSel(); anchor = cursor = -1; preview(null); break;
      case "Backspace": e.preventDefault(); goUp(); break;
      case "Delete": if (cur === FILES) removeSelectedFiles(); break;
      case "/": e.preventDefault(); $("search").focus(); break;
      case "a": case "A": if (mod) { e.preventDefault(); selectAll(); } break;
    }
  });
  try {   // ask Premiere to pass these keys to the panel instead of using them as app shortcuts
    var codes = [37, 38, 39, 40, 13, 32, 27, 8, 46, 36, 35, 191];
    var interest = codes.map(function (c) { return { keyCode: c }; });
    [65, 70].forEach(function (c) { interest.push({ keyCode: c, ctrlKey: true }); interest.push({ keyCode: c, metaKey: true }); });
    window.__adobe_cep__.registerKeyEventsInterest(JSON.stringify(interest));
  } catch (e) {}

  // ---------- auto-refresh (polls the open folder every 2.5 s) ----------
  setInterval(function () {
    if (!autoRefresh || dragging || document.hidden || !cur) return;
    var s;
    if (cur === FILES) s = filesSig();
    else { var r = fs.readdir(cur); s = r.err === 0 ? sigOf(r.data) : "ERR"; }
    if (s !== sig) { staleIndexes(); load(cur, true); }
  }, 2500);

  renderRoots();
  load(root);
})();
