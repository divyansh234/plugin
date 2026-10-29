(function () {
  "use strict";
  var node = null;
  try {
    node = { cp: require("child_process"), os: require("os"), path: require("path"), fs: require("fs"), crypto: require("crypto") };
  } catch (e) {}

  var FF = { available: !!node, ready: false, ok: false, path: "", cacheDir: "" };
  var waiters = [];
  function flush() { var w = waiters; waiters = []; w.forEach(function (f) { f(FF.ok); }); }
  FF.whenReady = function (cb) { if (FF.ready) cb(FF.ok); else waiters.push(cb); };
  window.DZ_FF = FF;

  if (!node) {
    FF.ready = true;
    FF.thumb = FF.proxy = function (it, cb) { cb(false); };
    FF.probe = function (it, cb) { cb(null); };
    FF.cacheSize = function () { return 0; };
    FF.clearCache = function () {};
    FF.setPath = function (p, cb) { cb(false); };
    return;
  }

  FF.cacheDir = node.path.join(node.os.tmpdir(), "Dropzone-cache");
  try { node.fs.mkdirSync(FF.cacheDir); } catch (e) {}

  function test(p, cb) {
    var done = false, c;
    function fin(ok) { if (!done) { done = true; cb(ok); } }
    try {
      c = node.cp.spawn(p, ["-version"], { windowsHide: true });
      c.on("error", function () { fin(false); });
      c.on("close", function (code) { fin(code === 0); });
      setTimeout(function () { try { c.kill(); } catch (e) {} fin(false); }, 4000);
    } catch (e) { fin(false); }
  }

  FF.detect = function (cb) {
    var plat = node.os.platform(), list = [], saved = "";
    try { saved = localStorage.getItem("fd_ffmpeg") || ""; } catch (e) {}
    if (saved) list.push(saved);
    list.push("ffmpeg");
    if (plat === "win32") {
      list.push("C:\\ffmpeg\\bin\\ffmpeg.exe", "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe");
      if (process.env.LOCALAPPDATA) list.push(node.path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
    } else {
      list.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg");
    }
    (function next(i) {
      if (i >= list.length) { FF.ok = false; FF.path = ""; FF.ready = true; flush(); if (cb) cb(false); return; }
      test(list[i], function (ok) {
        if (ok) { FF.ok = true; FF.path = list[i]; FF.ready = true; flush(); if (cb) cb(true); }
        else next(i + 1);
      });
    })(0);
  };
  FF.setPath = function (p, cb) {
    test(p, function (ok) {
      if (ok) { try { localStorage.setItem("fd_ffmpeg", p); } catch (e) {} FF.ok = true; FF.path = p; FF.ready = true; flush(); }
      cb(ok);
    });
  };

  // ---------- cache ----------
  function key(it, tag) {
    return node.crypto.createHash("md5").update(it.path + "|" + (it.size || 0) + "|" + tag).digest("hex");
  }
  function partOf(out) { var i = out.lastIndexOf("."); return out.slice(0, i) + ".part" + out.slice(i); }
  FF.cacheSize = function () {
    var total = 0;
    try { node.fs.readdirSync(FF.cacheDir).forEach(function (f) { total += node.fs.statSync(node.path.join(FF.cacheDir, f)).size; }); } catch (e) {}
    return total;
  };
  FF.clearCache = function () {
    try { node.fs.readdirSync(FF.cacheDir).forEach(function (f) { try { node.fs.unlinkSync(node.path.join(FF.cacheDir, f)); } catch (e) {} }); } catch (e) {}
  };
  FF.prune = function (days) {
    var cutoff = Date.now() - days * 864e5;
    try {
      node.fs.readdirSync(FF.cacheDir).forEach(function (f) {
        var p = node.path.join(FF.cacheDir, f);
        try { if (node.fs.statSync(p).mtime.getTime() < cutoff) node.fs.unlinkSync(p); } catch (e) {}
      });
    } catch (e) {}
  };

  // ---------- job queue (max 2 ffmpeg processes at once) ----------
  var active = 0, queue = [], pending = {};
  function pump() { while (active < 2 && queue.length) { active++; run(queue.shift()); } }
  function finish(job, ok) {
    active--;
    var cbs = pending[job.out] || []; delete pending[job.out];
    cbs.forEach(function (f) { f(ok, job.out); });
    pump();
  }
  function run(job) {
    var c;
    try { c = node.cp.spawn(FF.path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"].concat(job.args), { windowsHide: true }); }
    catch (e) { return finish(job, false); }
    c.stderr.on("data", function () {});
    var buf = "";
    c.stdout.on("data", function (d) {
      if (!job.progress) return;
      buf += d;
      var m, re = /out_time_ms=(\d+)/g, last = null;
      while ((m = re.exec(buf))) last = m[1];
      if (last) job.progress(+last / 1e6);
      if (buf.length > 4000) buf = buf.slice(-400);
    });
    c.on("error", function () { finish(job, false); });
    c.on("close", function (code) {
      if (code === 0) {
        try { node.fs.renameSync(job.tmp, job.out); finish(job, true); } catch (e) { finish(job, false); }
      } else { try { node.fs.unlinkSync(job.tmp); } catch (e) {} finish(job, false); }
    });
  }
  function submit(out, args, cb, progress) {
    if (node.fs.existsSync(out)) { setTimeout(function () { cb(true, out); }, 0); return; }
    if (pending[out]) { pending[out].push(cb); return; }
    pending[out] = [cb];
    queue.push({ out: out, tmp: partOf(out), args: args, progress: progress });
    pump();
  }
  function withTmp(out, make) { return make(partOf(out)); }

  // small JPG thumbnail (used when the browser can't decode the file itself)
  FF.thumb = function (it, cb) {
    var out = node.path.join(FF.cacheDir, key(it, "t") + ".jpg");
    function attempt(seek) {
      var a = withTmp(out, function (tmp) {
        return (seek ? ["-ss", "1"] : []).concat(["-i", it.path, "-frames:v", "1", "-vf", "scale=240:-2", "-q:v", "4", tmp]);
      });
      submit(out, a, function (ok, o) { if (!ok && seek && it.kind === "video") attempt(false); else cb(ok, o); });
    }
    attempt(it.kind === "video");
  };

  // lightweight, widely playable copy for preview
  FF.proxy = function (it, cb, progress) {
    var ext = it.kind === "video" ? "mp4" : it.kind === "audio" ? "m4a" : "jpg";
    var out = node.path.join(FF.cacheDir, key(it, "p") + "." + ext), args;
    args = withTmp(out, function (tmp) {
      if (it.kind === "video") return ["-i", it.path, "-vf", "scale=-2:min(480\\,ih)", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", tmp];
      if (it.kind === "audio") return ["-i", it.path, "-vn", "-c:a", "aac", "-b:a", "128k", tmp];
      return ["-i", it.path, "-frames:v", "1", "-vf", "scale=min(1280\\,iw):-2", "-q:v", "3", tmp];
    });
    submit(out, args, cb, it.kind === "video" ? (progress || function () {}) : null);
  };

  // ---------- read file details by parsing "ffmpeg -i" output ----------
  function parseProbe(t) {
    var o = {}, m;
    if ((m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t))) o.dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if ((m = /bitrate:\s*(\d+)\s*kb\/s/.exec(t))) o.bitrate = +m[1];
    var v = /Stream #[^\n]*?Video:([^\n]*)/.exec(t);
    if (v) {
      var line = v[1];
      if ((m = /^\s*([A-Za-z0-9_]+)(?:\s*\(([^)]*)\))?/.exec(line))) { o.vcodec = m[1]; o.vprofile = m[2] || ""; }
      if ((m = /\b(\d{2,5})x(\d{2,5})\b/.exec(line))) { o.w = +m[1]; o.h = +m[2]; }
      if ((m = /([\d.]+)\s*fps/.exec(line))) o.fps = +m[1];
      if ((m = /(bt709|bt2020\w*|smpte170m|bt470bg|smpte240m|smpte2084|arib-std-b67)/.exec(line))) o.color = m[1];
    }
    var a = /Stream #[^\n]*?Audio:([^\n]*)/.exec(t);
    if (a) {
      var l = a[1];
      if ((m = /^\s*([A-Za-z0-9_]+)/.exec(l))) o.acodec = m[1];
      if ((m = /(\d+)\s*Hz/.exec(l))) o.rate = +m[1];
      if ((m = /\b(mono|stereo|\d+ channels|\d\.\d)\b/.exec(l))) o.ch = m[1];
      if ((m = /\((\d+) bit\)/.exec(l))) o.bits = +m[1];
      else if ((m = /,\s*(u8|s16p?|s32p?|fltp?|dblp?)\b/.exec(l))) o.bits = { u8: 8, s16: 16, s16p: 16, s32: 32, s32p: 32, flt: 32, fltp: 32, dbl: 64, dblp: 64 }[m[1]];
    }
    return (v || a || o.dur) ? o : null;
  }
  FF._parse = parseProbe;
  var probeCache = {};
  FF.probe = function (it, cb) {
    var key = it.path + "|" + (it.size || 0);
    if (probeCache[key]) return cb(probeCache[key]);
    var c, err = "", done = false;
    function fin(info) { if (done) return; done = true; if (info) probeCache[key] = info; cb(info); }
    try { c = node.cp.spawn(FF.path, ["-hide_banner", "-nostdin", "-i", it.path], { windowsHide: true }); } catch (e) { return cb(null); }
    c.stderr.on("data", function (d) { if (err.length < 60000) err += d; });
    c.on("error", function () { fin(null); });
    c.on("close", function () { fin(parseProbe(err)); });
    setTimeout(function () { try { c.kill(); } catch (e) {} fin(null); }, 8000);
  };

  FF.detect(function () { FF.prune(14); });
})();
