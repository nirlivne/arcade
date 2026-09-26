'use strict';
// Minimal circle physics: fixed step, position-based separation, sleeping.
(function () {
  var GRAVITY = 1400, MAX_V = 1400, SLEEP_V = 20, SLEEP_T = 0.5, ITER = 4;

  function World(bounds) {
    this.b = bounds; // {l, r, floor}
    this.bodies = [];
    this.merges = [];
  }
  World.prototype.add = function (body) {
    body.vx = body.vx || 0; body.vy = body.vy || 0;
    body.sleep = false; body.sleepT = 0; body.age = 0;
    body.m = body.r * body.r;
    this.bodies.push(body);
    return body;
  };
  World.prototype.wakeAll = function () {
    for (var i = 0; i < this.bodies.length; i++) { this.bodies[i].sleep = false; this.bodies[i].sleepT = 0; }
  };
  World.prototype.step = function (dt) {
    var bs = this.bodies, b = this.b, i, j, k, a, c;
    for (i = 0; i < bs.length; i++) {
      a = bs[i]; a.age += dt;
      if (a.sleep) continue;
      a.vy += GRAVITY * dt;
      var sp = Math.hypot(a.vx, a.vy);
      if (sp > MAX_V) { a.vx *= MAX_V / sp; a.vy *= MAX_V / sp; }
      a.vx *= 0.9995; a.vy *= 0.9995;
      a.x += a.vx * dt; a.y += a.vy * dt;
    }
    this.merges.length = 0;
    for (k = 0; k < ITER; k++) {
      for (i = 0; i < bs.length; i++) {
        a = bs[i];
        if (a.sleep) continue;
        if (a.x - a.r < b.l) { a.x = b.l + a.r; if (a.vx < 0) a.vx = -a.vx * 0.1; }
        if (a.x + a.r > b.r) { a.x = b.r - a.r; if (a.vx > 0) a.vx = -a.vx * 0.1; }
        if (a.y + a.r > b.floor) {
          a.y = b.floor - a.r;
          if (a.vy > 0) { if (a.vy > 250) a.hit = Math.max(a.hit || 0, a.vy); a.vy = -a.vy * (a.vy > 200 ? 0.15 : 0); }
          a.vx *= 0.94;
        }
      }
      for (i = 0; i < bs.length; i++) {
        a = bs[i];
        for (j = i + 1; j < bs.length; j++) {
          c = bs[j];
          if (a.sleep && c.sleep) continue;
          var dx = c.x - a.x, dy = c.y - a.y, rr = a.r + c.r;
          if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
          var d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          var d = Math.sqrt(d2), nx, ny;
          if (d < 1e-6) { nx = 0; ny = 1; d = 0; } else { nx = dx / d; ny = dy / d; }
          if (a.t === c.t && !a.dead && !c.dead && k === 0) this.merges.push([a, c]);
          var ia = a.sleep ? 0 : 1 / a.m, ic = c.sleep ? 0 : 1 / c.m;
          var vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          // wake a sleeper only when hit by something moving
          if (a.sleep && Math.hypot(c.vx, c.vy) > 40) { a.sleep = false; a.sleepT = 0; ia = 1 / a.m; }
          else if (c.sleep && Math.hypot(a.vx, a.vy) > 40) { c.sleep = false; c.sleepT = 0; ic = 1 / c.m; }
          var isum = ia + ic;
          if (isum === 0) continue;
          var ov = rr - d, corr = Math.max(ov - 0.05, 0) * 0.5 / isum;
          a.x -= nx * corr * ia; a.y -= ny * corr * ia;
          c.x += nx * corr * ic; c.y += ny * corr * ic;
          if (vn < 0) {
            if (vn < -250) { a.hit = Math.max(a.hit || 0, -vn); c.hit = Math.max(c.hit || 0, -vn); }
            var e = vn < -250 ? 0.18 : 0;
            var jn = -(1 + e) * vn / isum;
            a.vx -= nx * jn * ia; a.vy -= ny * jn * ia;
            c.vx += nx * jn * ic; c.vy += ny * jn * ic;
            // friction
            var tx = -ny, ty = nx;
            var vt = (c.vx - a.vx) * tx + (c.vy - a.vy) * ty;
            var jt = Math.max(-0.3 * jn, Math.min(0.3 * jn, -vt * 0.5 / isum));
            a.vx -= tx * jt * ia; a.vy -= ty * jt * ia;
            c.vx += tx * jt * ic; c.vy += ty * jt * ic;
          }
        }
      }
    }
    for (i = 0; i < bs.length; i++) {
      a = bs[i];
      if (a.sleep) continue;
      if (a.vx * a.vx + a.vy * a.vy < SLEEP_V * SLEEP_V) {
        a.sleepT += dt;
        if (a.sleepT > SLEEP_T) { a.sleep = true; a.vx = a.vy = 0; }
      } else a.sleepT = 0;
    }
  };
  window.Physics = { World: World };
})();
