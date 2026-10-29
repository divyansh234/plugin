(function () {
  "use strict";
  var DZ = window.DZ_Player = {};

  // ---------- helpers ----------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function q(root, sel) { return root.querySelector(sel); }
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") + m : m) + ":" + (s < 10 ? "0" : "") + s;
  }
  DZ.fmt = fmt;
  function svg(d) { return '<svg viewBox="0 0 24 24">' + d + '</svg>'; }
  function solid(d) { return '<g fill="currentColor" stroke="none">' + d + '</g>'; }
  var I = DZ.icons = {
    play: svg(solid('<path d="M8.5 5.2v13.6a.9.9 0 0 0 1.4.76l10.6-6.8a.9.9 0 0 0 0-1.52L9.9 4.44A.9.9 0 0 0 8.5 5.2z"/>')),
    pause: svg(solid('<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>')),
    prev: svg('<path d="M6 5.5v13"/>' + solid('<path d="M19 6.2v11.6a.7.7 0 0 1-1.1.57L9.6 12.6a.7.7 0 0 1 0-1.17l8.3-5.8a.7.7 0 0 1 1.1.57z"/>')),
    next: svg('<path d="M18 5.5v13"/>' + solid('<path d="M5 6.2v11.6a.7.7 0 0 0 1.1.57l8.3-5.77a.7.7 0 0 0 0-1.17L6.1 5.63A.7.7 0 0 0 5 6.2z"/>')),
    vol: svg(solid('<path d="M4 9.5v5h3.6l4.4 3.8V5.7L7.6 9.5z"/>') + '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
    mute: svg(solid('<path d="M4 9.5v5h3.6l4.4 3.8V5.7L7.6 9.5z"/>') + '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    fit: svg('<rect x="7.5" y="8.5" width="9" height="7" rx="1"/><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M21 8V5.5A2.5 2.5 0 0 0 18.5 3H16M3 16v2.5A2.5 2.5 0 0 0 5.5 21H8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16"/>'),
    expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    chev: svg('<path d="M6 9l6 6 6-6"/>'),
    left: svg('<path d="M15 5l-7 7 7 7"/>'),
    right: svg('<path d="M9 5l7 7-7 7"/>')
  };

  // volume / speed are remembered between previews
  var S = { vol: 0.8, muted: false, rate: 1 };
  try { var sv = JSON.parse(localStorage.getItem("fd_player")); if (sv) { S.vol = +sv.vol >= 0 ? +sv.vol : 0.8; S.muted = !!sv.muted; S.rate = +sv.rate || 1; } } catch (e) {}
  function saveS() { try { localStorage.setItem("fd_player", JSON.stringify(S)); } catch (e) {} }

  // draggable 0..1 slider on any element
  function slider(track, onSet, hooks) {
    var dragging = false;
    function pos(e) { var r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))); }
    function move(e) { if (dragging) { onSet(pos(e)); e.preventDefault(); } }
    function up() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      track.classList.remove("drag");
      if (hooks && hooks.end) hooks.end();
    }
    track.addEventListener("mousedown", function (e) {
      if (e.button) return;
      dragging = true; track.classList.add("drag");
      if (hooks && hooks.start) hooks.start();
      onSet(pos(e));
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      e.preventDefault();
    });
    return { destroy: up, dragging: function () { return dragging; } };
  }

  // ---------- play / seek / volume / speed bar (shared by video + audio) ----------
  function transport(ctx, m, o) {
    var ctl = ctx.ctl, stage = ctx.stage, dead = false, raf = 0, subs = [], seekDrag = false;
    var RATES = [1, 1.5, 2, 0.5];
    ctl.innerHTML =
      (o.seek ? '<div class="seekrow"><span class="t-cur">0:00</span><div class="track seek"><i class="fill"></i><i class="knob"></i></div><span class="t-dur">0:00</span></div>'
              : '<div class="timerow"><b class="t-cur">0:00</b><span class="sep">/</span><span class="t-dur">0:00</span></div>') +
      '<div class="ctlrow">' +
        '<button class="cbtn prev" title="Previous file">' + I.prev + '</button>' +
        '<button class="cbtn play" title="Play / pause (Space)">' + I.play + '</button>' +
        '<button class="cbtn next" title="Next file">' + I.next + '</button>' +
        '<span class="grow"></span>' +
        '<button class="cbtn mute" title="Mute">' + I.vol + '</button>' +
        '<div class="track vol"><i class="fill"></i><i class="knob"></i></div>' +
        '<button class="pill speed" title="Playback speed">1x</button>' +
      '</div>';
    var cur = q(ctl, ".t-cur"), dur = q(ctl, ".t-dur"), play = q(ctl, ".play"), prev = q(ctl, ".prev"), next = q(ctl, ".next");
    var mute = q(ctl, ".mute"), vtrack = q(ctl, ".vol"), speed = q(ctl, ".speed");
    var strack = q(ctl, ".seek");

    function sync() {
      var d = m.duration, t = m.currentTime || 0, ok = isFinite(d) && d > 0;
      cur.textContent = fmt(t); dur.textContent = ok ? fmt(d) : "0:00";
      if (strack && !seekDrag) {
        var p = ok ? Math.min(1, t / d) * 100 : 0;
        q(strack, ".fill").style.width = p + "%"; q(strack, ".knob").style.left = p + "%";
      }
      if (o.onTime) o.onTime(t, ok ? d : 0);
    }
    function loop() { raf = 0; if (dead) return; sync(); if (!m.paused && !m.ended) raf = requestAnimationFrame(loop); }
    function kick() { if (!raf && !dead) raf = requestAnimationFrame(loop); }
    function toggle() {
      try { if (m.paused) { var p = m.play(); if (p && p.catch) p.catch(function () {}); } else m.pause(); } catch (e) {}
    }
    m.addEventListener("play", function () { play.innerHTML = I.pause; stage.classList.add("playing"); kick(); });
    function stopped() { play.innerHTML = I.play; stage.classList.remove("playing"); sync(); }
    m.addEventListener("pause", stopped); m.addEventListener("ended", stopped);
    ["timeupdate", "loadedmetadata", "durationchange", "seeked"].forEach(function (n) { m.addEventListener(n, sync); });
    play.onclick = toggle;

    if (strack) subs.push(slider(strack, function (p) {
      var d = m.duration;
      if (isFinite(d) && d > 0) { m.currentTime = p * d; q(strack, ".fill").style.width = p * 100 + "%"; q(strack, ".knob").style.left = p * 100 + "%"; cur.textContent = fmt(p * d); }
    }, { start: function () { seekDrag = true; }, end: function () { seekDrag = false; } }));

    function applyVol() {
      var off = S.muted || S.vol === 0;
      m.volume = S.vol; m.muted = off;
      var f = off ? 0 : S.vol;
      q(vtrack, ".fill").style.width = f * 100 + "%"; q(vtrack, ".knob").style.left = f * 100 + "%";
      mute.innerHTML = off ? I.mute : I.vol;
    }
    subs.push(slider(vtrack, function (p) { S.vol = p; S.muted = false; applyVol(); }, { end: saveS }));
    mute.onclick = function () { S.muted = !S.muted; if (!S.muted && S.vol === 0) S.vol = 0.6; applyVol(); saveS(); };
    applyVol();

    function applyRate() { m.playbackRate = S.rate; speed.textContent = S.rate + "x"; }
    speed.onclick = function () { S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length]; applyRate(); saveS(); };
    applyRate();

    prev.disabled = !ctx.canNav(-1); next.disabled = !ctx.canNav(1);
    prev.onclick = function () { ctx.nav(-1); }; next.onclick = function () { ctx.nav(1); };
    sync();
    return {
      toggle: toggle, sync: sync,
      destroy: function () { dead = true; if (raf) cancelAnimationFrame(raf); subs.forEach(function (s) { s.destroy(); }); }
    };
  }

  // ---------- filmstrip: frames sampled along the video ----------
  function frames(ctx, v) {
    var N = 8, strip = ctx.strip, dur = v.duration, boxes = [], dead = false, fv = null, i = 0, last = -1, timer = 0;
    if (!isFinite(dur) || dur <= 0) return { at: function () {}, destroy: function () {} };
    strip.innerHTML = "";
    function jump(b) { return function () { v.currentTime = +b.getAttribute("data-t"); }; }
    for (var k = 0; k < N; k++) {
      var b = el("div", "frame"), t = (k + 0.5) / N * dur;
      b.setAttribute("data-t", t); b.title = fmt(t); b.onclick = jump(b);
      strip.appendChild(b); boxes.push(b);
    }
    function finish() { clearTimeout(timer); if (fv) { try { fv.removeAttribute("src"); fv.load(); } catch (e) {} fv = null; } }
    function nextFrame() {
      if (dead || i >= N) return finish();
      clearTimeout(timer);
      timer = setTimeout(function () { i++; nextFrame(); }, 4000);
      try { fv.currentTime = (i + 0.5) / N * dur; } catch (e) { i++; nextFrame(); }
    }
    fv = el("video"); fv.muted = true; fv.preload = "auto";
    fv.onloadedmetadata = nextFrame;
    fv.onerror = finish;
    fv.onseeked = function () {
      if (dead || !fv) return;
      clearTimeout(timer);
      try {
        var c = el("canvas"), W = 160, H = 92;
        c.width = W; c.height = H;
        var s = Math.max(W / fv.videoWidth, H / fv.videoHeight), w = fv.videoWidth * s, h = fv.videoHeight * s;
        c.getContext("2d").drawImage(fv, (W - w) / 2, (H - h) / 2, w, h);
        boxes[i].appendChild(c);
      } catch (e) {}
      i++; nextFrame();
    };
    fv.src = ctx.url;
    return {
      at: function (t, d) {
        if (!d) return;
        var idx = Math.min(N - 1, Math.floor(t / d * N));
        if (idx === last) return;
        if (last >= 0) boxes[last].classList.remove("on");
        boxes[idx].classList.add("on"); last = idx;
        strip.scrollLeft = boxes[idx].offsetLeft - strip.clientWidth / 2 + boxes[idx].offsetWidth / 2;
      },
      destroy: function () { dead = true; finish(); }
    };
  }

  // ---------- VIDEO ----------
  DZ.video = function (ctx) {
    var stage = ctx.stage, v = el("video"), strip = null, dead = false;
    stage.classList.add("video");
    v.preload = "metadata"; v.src = ctx.url;
    var big = el("button", "bigplay", I.play); big.title = "Play";
    stage.appendChild(v); stage.appendChild(big);
    var tr = transport(ctx, v, { seek: true, onTime: function (t, d) { if (strip) strip.at(t, d); } });
    big.onclick = v.onclick = function () { tr.toggle(); };
    v.onerror = function () { if (!dead) ctx.fail(); };
    v.addEventListener("loadedmetadata", function () {
      if (!v.videoWidth) return ctx.fail();
      ctx.info({ res: v.videoWidth + " × " + v.videoHeight, dur: fmt(v.duration) });
      strip = frames(ctx, v); strip.at(0, v.duration);
    });
    return { destroy: function () {
      dead = true; tr.destroy(); if (strip) strip.destroy();
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
    } };
  };

  // ---------- AUDIO (waveform doubles as the seek bar) ----------
  var PEAKS = 480;
  function loadPeaks(url, size, cb) {
    if (size && size > 60e6) return cb(null, "large");
    var x = new XMLHttpRequest();
    x.open("GET", url, true); x.responseType = "arraybuffer";
    x.onerror = function () { cb(null, "fail"); };
    x.onload = function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return cb(null, "fail");
      var c = new AC();
      function done(p) { cb(p, p ? "" : "fail"); try { c.close(); } catch (e) {} }
      try {
        c.decodeAudioData(x.response, function (buf) {
          var ch = buf.numberOfChannels, len = buf.length, data = [], out = [], mx = 0, i, j, k;
          for (k = 0; k < ch; k++) data.push(buf.getChannelData(k));
          var step = Math.max(1, Math.floor(len / PEAKS));
          for (i = 0; i < PEAKS; i++) {
            var s = i * step, e = Math.min(len, s + step), pk = 0, stride = Math.max(1, Math.floor((e - s) / 256));
            for (j = s; j < e; j += stride) for (k = 0; k < ch; k++) { var a = Math.abs(data[k][j]); if (a > pk) pk = a; }
            out.push(pk); if (pk > mx) mx = pk;
          }
          if (mx > 0) out = out.map(function (p) { return p / mx; });
          done(out);
        }, function () { done(null); });
      } catch (e) { done(null); }
    };
    x.send();
  }
  function seeded(name, n) {   // decorative bars used only while loading / when no waveform can be made
    var h = 7, i, out = [];
    for (i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
    for (i = 0; i < n; i++) { h = (h * 1103 + 12345) % 9973; out.push(0.12 + 0.28 * (h / 9973)); }
    return out;
  }

  DZ.audio = function (ctx) {
    var stage = ctx.stage, a = el("audio"), cv = el("canvas", "wave"), note = el("div", "wavenote");
    var P = null, dead = false, dpr = window.devicePixelRatio || 1, ph = seeded(ctx.it.name, PEAKS);
    stage.classList.add("audio");
    a.preload = "metadata"; a.src = ctx.url;
    stage.appendChild(cv); stage.appendChild(note); stage.appendChild(a);

    function size() { cv.width = Math.max(10, Math.round(stage.clientWidth * dpr)); cv.height = Math.max(10, Math.round(stage.clientHeight * dpr)); }
    function draw() {
      if (dead) return;
      var W = cv.width, H = cv.height, g = cv.getContext("2d"), src = P || ph;
      var n = Math.max(40, Math.min(PEAKS, Math.floor(W / (3 * dpr)))), bw = W / n;
      var d = a.duration, px = isFinite(d) && d > 0 ? (a.currentTime / d) * W : 0;
      g.clearRect(0, 0, W, H);
      var lg = g.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, "#7c5cff"); lg.addColorStop(0.55, "#9b6bff"); lg.addColorStop(1, "#3d8bff");
      g.fillStyle = lg;
      var per = src.length / n;
      for (var i = 0; i < n; i++) {
        var pk = 0, s = Math.floor(i * per), e = Math.max(s + 1, Math.floor((i + 1) * per));
        for (var j = s; j < e && j < src.length; j++) if (src[j] > pk) pk = src[j];
        var h = Math.max(3 * dpr, pk * H * 0.84), x = i * bw;
        g.globalAlpha = !P ? 0.22 : (x + bw / 2 <= px ? 1 : 0.42);
        g.fillRect(x + bw * 0.2, (H - h) / 2, bw * 0.6, h);
      }
      g.globalAlpha = 1;
      if (px > 0 || P) { g.fillStyle = "#fff"; g.shadowColor = "rgba(160,130,255,.9)"; g.shadowBlur = 8 * dpr; g.fillRect(Math.max(0, px - dpr), 0, 2 * dpr, H); g.shadowBlur = 0; }
    }
    size(); draw();
    var tr = transport(ctx, a, { seek: false, onTime: draw });
    var sl = slider(stage, function (p) {
      if (isFinite(a.duration) && a.duration > 0) { a.currentTime = p * a.duration; tr.sync(); draw(); }
    });
    function onResize() { size(); draw(); }
    window.addEventListener("resize", onResize);
    a.onerror = function () { if (!dead) ctx.fail(); };
    a.addEventListener("loadedmetadata", function () { ctx.info({ dur: fmt(a.duration) }); draw(); });
    loadPeaks(ctx.url, ctx.isProxy ? 0 : ctx.it.size, function (p, why) {
      if (dead) return;
      P = p; note.textContent = p ? "" : (why === "large" ? "Waveform skipped for large file" : "Waveform unavailable");
      draw();
    });
    return { destroy: function () {
      dead = true; tr.destroy(); sl.destroy(); window.removeEventListener("resize", onResize);
      try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) {}
    } };
  };

  // ---------- PHOTO (zoom, pan, neighbours) ----------
  DZ.photo = function (ctx) {
    var stage = ctx.stage, img = el("img", "pimg"), nat = { w: 0, h: 0 }, z = 1, tx = 0, ty = 0, fit = 1, dead = false;
    stage.classList.add("photo");
    img.draggable = false;
    stage.appendChild(img);

    var L = el("button", "navbtn left", I.left), R = el("button", "navbtn right", I.right);
    L.title = "Previous photo"; R.title = "Next photo";
    L.disabled = !ctx.canNav(-1); R.disabled = !ctx.canNav(1);
    L.onclick = function (e) { e.stopPropagation(); ctx.nav(-1); }; R.onclick = function (e) { e.stopPropagation(); ctx.nav(1); };
    stage.appendChild(L); stage.appendChild(R);

    ctx.ctl.innerHTML = '<div class="photobar"><div class="facts"></div><div class="zoom">' +
      '<button class="zbtn minus" title="Zoom out">' + I.minus + '</button>' +
      '<button class="pill pct" title="Toggle fit / 100%">100%</button>' +
      '<button class="zbtn plus" title="Zoom in">' + I.plus + '</button>' +
      '<button class="zbtn fitb" title="Fit to window">' + I.fit + '</button></div></div>';
    var facts = q(ctx.ctl, ".facts"), pct = q(ctx.ctl, ".pct");
    pct.textContent = "Fit";

    function sw() { return stage.clientWidth; } function sh() { return stage.clientHeight; }
    function apply() {
      var s = fit * z;
      img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
      pct.textContent = z <= 1.001 ? "Fit" : Math.round(s * 100) + "%";
      stage.classList.toggle("zoomed", z > 1.001);
    }
    function layout(reset) { if (!nat.w) return; fit = Math.min(sw() / nat.w, sh() / nat.h); if (reset) { z = 1; tx = ty = 0; } apply(); }
    function zoomAt(f, cx, cy) {
      var nz = Math.min(40, Math.max(1, z * f));
      if (nz === z) return;
      var s = fit * z, ns = fit * nz, px = (cx - sw() / 2 - tx) / s, py = (cy - sh() / 2 - ty) / s;
      z = nz; tx = cx - sw() / 2 - px * ns; ty = cy - sh() / 2 - py * ns;
      if (z <= 1.0001) { z = 1; tx = ty = 0; }
      apply();
    }
    function actual() { var target = fit > 0 ? 1 / fit : 1; if (Math.abs(fit * z - 1) < 0.01 || z > 1.001 && target <= 1) { layout(true); } else { zoomAt(Math.max(1, target) / z, sw() / 2, sh() / 2); } }
    img.onload = function () {
      nat.w = img.naturalWidth; nat.h = img.naturalHeight;
      img.style.width = nat.w + "px"; img.style.height = nat.h + "px";
      img.style.marginLeft = (-nat.w / 2) + "px"; img.style.marginTop = (-nat.h / 2) + "px";
      layout(true);
      ctx.info({ res: nat.w + " × " + nat.h });
      facts.textContent = nat.w + " × " + nat.h + (ctx.it.size != null ? "  ·  " + ctx.sizeText(ctx.it.size) : "");
    };
    img.onerror = function () { if (!dead) ctx.fail(); };
    img.src = ctx.url;

    q(ctx.ctl, ".minus").onclick = function () { zoomAt(1 / 1.3, sw() / 2, sh() / 2); };
    q(ctx.ctl, ".plus").onclick = function () { zoomAt(1.3, sw() / 2, sh() / 2); };
    q(ctx.ctl, ".fitb").onclick = function () { layout(true); };
    pct.onclick = actual;
    stage.addEventListener("dblclick", actual);
    stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // drag to pan when zoomed
    var pan = null;
    function pmove(e) { if (!pan) return; tx = pan.tx + e.clientX - pan.x; ty = pan.ty + e.clientY - pan.y; apply(); }
    function pup() { pan = null; stage.classList.remove("panning"); document.removeEventListener("mousemove", pmove); document.removeEventListener("mouseup", pup); }
    stage.addEventListener("mousedown", function (e) {
      if (z <= 1.001 || e.button || e.target !== stage && e.target !== img) return;
      pan = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; stage.classList.add("panning");
      document.addEventListener("mousemove", pmove); document.addEventListener("mouseup", pup); e.preventDefault();
    });
    function onResize() { layout(false); }
    window.addEventListener("resize", onResize);

    // neighbouring photos
    var sib = ctx.siblings ? ctx.siblings() : [];
    if (sib.length > 1) {
      ctx.strip.innerHTML = "";
      sib.forEach(function (o) {
        var b = el("div", "frame photo" + (o.active ? " on" : ""));
        b.title = o.name;
        if (o.src) { var t = new Image(); t.src = o.src; t.draggable = false; b.appendChild(t); }
        b.onclick = function () { ctx.pick(o); };
        ctx.strip.appendChild(b);
      });
      var on = q(ctx.strip, ".on");
      if (on) ctx.strip.scrollLeft = on.offsetLeft - ctx.strip.clientWidth / 2 + on.offsetWidth / 2;
    }
    return { relayout: function () { layout(true); }, destroy: function () { dead = true; pup(); window.removeEventListener("resize", onResize); img.removeAttribute("src"); } };
  };
})();
