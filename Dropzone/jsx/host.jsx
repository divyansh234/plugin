function fd_find(parent, path) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var c = parent.children[i];
    if (c.type == ProjectItemType.BIN) { var r = fd_find(c, path); if (r) return r; }
    else { try { if (c.getMediaPath() == path) return c; } catch (e) {} }
  }
  return null;
}
function fd_insert(path, isAudio) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "Open a sequence first";
    var f = new File(path), p = f.fsName;
    var item = fd_find(app.project.rootItem, p);
    if (!item) {
      app.project.importFiles([p], true, app.project.getInsertionBin(), false);
      item = fd_find(app.project.rootItem, p);
    }
    if (!item) return "Import failed";
    var track = isAudio ? seq.audioTracks[0] : seq.videoTracks[0];
    track.insertClip(item, seq.getPlayerPosition());
    return "ok";
  } catch (e) { return "Error: " + e; }
}

function fd_endOf(track, pos, item) {
  for (var i = track.clips.numItems - 1; i >= 0; i--) {
    var c = track.clips[i];
    if (Math.abs(c.start.seconds - pos) < 0.01) return c.end.seconds;
  }
  try { var d = item.getOutPoint().seconds - item.getInPoint().seconds; if (d > 0) return pos + d; } catch (e) {}
  return pos + 5;
}
// s = lines like "V<path>" or "A<path>"; clips are placed back-to-back from the playhead
function fd_insertMany(s) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "Open a sequence first";
    var parts = s.split("\n"), pos = seq.getPlayerPosition().seconds;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var isAudio = parts[i].charAt(0) == "A";
      var p = new File(parts[i].substr(1)).fsName;
      var item = fd_find(app.project.rootItem, p);
      if (!item) {
        app.project.importFiles([p], true, app.project.getInsertionBin(), false);
        item = fd_find(app.project.rootItem, p);
      }
      if (!item) return "Import failed: " + p;
      var track = isAudio ? seq.audioTracks[0] : seq.videoTracks[0];
      var t = new Time(); t.seconds = pos;
      track.insertClip(item, t);
      pos = fd_endOf(track, pos, item);
    }
    return "ok";
  } catch (e) { return "Error: " + e; }
}
