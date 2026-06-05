/**
 * src/js/ai-face.js
 * DoBo AI Assistant — Rabbit Character Canvas Renderer
 *
 * The rabbit character peeks from the right edge of the screen.
 * All expressions rendered on a <canvas> element:
 *   neutral  : calm upright ears, small smile, dot eyes
 *   happy    : perked ears angled outward, wide smile, sparkle eyes
 *   thinking : one ear tilted, looking up, small "..." thought
 *   surprised: ears straight up tall, wide round eyes, small "o" mouth
 *   sleepy   : ears drooped down, half-closed eyes, slight frown
 */
(function () {
  'use strict';

  class AIFace {
    constructor(canvasEl) {
      this.canvas = canvasEl;
      this.ctx    = canvasEl.getContext('2d');
      this.W      = canvasEl.width;
      this.H      = canvasEl.height;

      this._expression  = 'neutral';
      this._blinkState  = 0;     // 0=open, 1=closing, 2=open (blink frame)
      this._blinkTimer  = null;
      this._raf         = null;
      this._frame       = 0;

      this._startLoop();
      this._scheduleBlink();
    }

    // ── Public API ──────────────────────────────────────────────────────────
    setExpression(expr) {
      const valid = ['neutral','happy','thinking','surprised','sleepy'];
      if (valid.includes(expr)) {
        this._expression = expr;
      }
    }

    blink() {
      this._blinkState = 1;
      clearTimeout(this._blinkTimer);
      setTimeout(() => {
        this._blinkState = 0;
        this._scheduleBlink();
      }, 160);
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      clearTimeout(this._blinkTimer);
    }

    // ── Animation loop ──────────────────────────────────────────────────────
    _startLoop() {
      const tick = () => {
        this._frame++;
        this._draw();
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    _scheduleBlink() {
      const delay = 3000 + Math.random() * 4000;
      this._blinkTimer = setTimeout(() => this.blink(), delay);
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    _draw() {
      const { ctx, W, H, _frame, _expression, _blinkState } = this;
      ctx.clearRect(0, 0, W, H);

      const t = _frame * 0.04;

      // ── Ears ────────────────────────────────────────────────────────────
      this._drawEars(ctx, W, H, _expression, t);

      // ── Body / Head ──────────────────────────────────────────────────────
      this._drawHead(ctx, W, H, _expression, t);

      // ── Face features ────────────────────────────────────────────────────
      this._drawFace(ctx, W, H, _expression, _blinkState, t);
    }

    _drawEars(ctx, W, H, expr, t) {
      ctx.save();

      const earW  = 10;
      const headCX = W / 2;
      const headCY = H * 0.62;
      const earBaseY = headCY - 22;

      // Ear shape params per expression
      const configs = {
        neutral:   { lX:-13, lY:-30, rX:13, rY:-30, lTilt:  0, rTilt:  0, lH:32, rH:32 },
        happy:     { lX:-16, lY:-26, rX:16, rY:-26, lTilt:-14, rTilt: 14, lH:28, rH:28 },
        thinking:  { lX:-13, lY:-30, rX:15, rY:-20, lTilt:  0, rTilt: 18, lH:32, rH:22 },
        surprised: { lX:-13, lY:-38, rX:13, rY:-38, lTilt:  0, rTilt:  0, lH:38, rH:38 },
        sleepy:    { lX:-12, lY:-18, rX:12, rY:-18, lTilt:-20, rTilt: 20, lH:22, rH:22 },
      };

      const cfg = configs[expr] || configs.neutral;

      // subtle idle sway for neutral
      const sway = (expr === 'neutral' || expr === 'happy')
        ? Math.sin(t) * 1.2 : 0;

      this._drawSingleEar(ctx, headCX + cfg.lX + sway,  earBaseY + cfg.lY, earW, cfg.lH, cfg.lTilt);
      this._drawSingleEar(ctx, headCX + cfg.rX + sway,  earBaseY + cfg.rY, earW, cfg.rH, cfg.rTilt);

      ctx.restore();
    }

    _drawSingleEar(ctx, cx, cy, w, h, tiltDeg) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((tiltDeg * Math.PI) / 180);

      // Outer ear (white/light gray)
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f0eeeb';
      ctx.fill();
      ctx.strokeStyle = '#d4d0ca';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner ear (pink)
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 4, h / 2 - 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,182,193,0.7)';
      ctx.fill();

      ctx.restore();
    }

    _drawHead(ctx, W, H, expr, t) {
      const cx = W / 2;
      const cy = H * 0.62;

      // Subtle body bob
      const bob = (expr === 'sleepy') ? Math.sin(t * 0.5) * 0.8 : Math.sin(t) * 0.8;

      ctx.save();
      ctx.translate(0, bob);

      // Head glow / shadow
      const grd = ctx.createRadialGradient(cx - 4, cy - 6, 2, cx, cy, 26);
      grd.addColorStop(0,   'rgba(255,255,255,0.9)');
      grd.addColorStop(0.6, 'rgba(240,238,235,0.95)');
      grd.addColorStop(1,   'rgba(210,205,198,0.6)');

      ctx.beginPath();
      ctx.ellipse(cx, cy, 22, 22, 0, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,195,188,0.6)';
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Cheek blush (happy / surprised)
      if (expr === 'happy' || expr === 'surprised') {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle   = '#ff8ba0';
        ctx.beginPath(); ctx.ellipse(cx - 13, cy + 5, 7, 4, 0, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 13, cy + 5, 7, 4, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    _drawFace(ctx, W, H, expr, blinkState, t) {
      const cx = W / 2;
      const cy = H * 0.62;
      const bob = (expr === 'sleepy') ? Math.sin(t * 0.5) * 0.8 : Math.sin(t) * 0.8;

      ctx.save();
      ctx.translate(0, bob);

      // ── Eyes ──────────────────────────────────────────────────────────────
      const eyeY   = cy - 4;
      const eyeLX  = cx - 7;
      const eyeRX  = cx + 7;

      if (blinkState === 1) {
        // Blink — flat line
        ctx.strokeStyle = '#555';
        ctx.lineWidth   = 2;
        ctx.lineCap     = 'round';
        ctx.beginPath(); ctx.moveTo(eyeLX - 4, eyeY); ctx.lineTo(eyeLX + 4, eyeY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(eyeRX - 4, eyeY); ctx.lineTo(eyeRX + 4, eyeY); ctx.stroke();
      } else {
        switch (expr) {
          case 'happy': {
            // Sparkle eyes — crescent arcs
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth   = 2;
            ctx.lineCap     = 'round';
            ctx.beginPath(); ctx.arc(eyeLX, eyeY, 4.5, Math.PI, 0, false); ctx.stroke();
            ctx.beginPath(); ctx.arc(eyeRX, eyeY, 4.5, Math.PI, 0, false); ctx.stroke();
            // Sparkle dots
            ctx.fillStyle = '#fbbf24';
            [[eyeLX+6,eyeY-6],[eyeRX-6,eyeY-6]].forEach(([x,y]) => {
              ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI*2); ctx.fill();
            });
            break;
          }
          case 'surprised': {
            // Wide round eyes
            ctx.fillStyle = '#1f2937';
            ctx.beginPath(); ctx.arc(eyeLX, eyeY, 5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX, eyeY, 5, 0, Math.PI*2); ctx.fill();
            // White highlight
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(eyeLX - 1.5, eyeY - 1.5, 1.5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX - 1.5, eyeY - 1.5, 1.5, 0, Math.PI*2); ctx.fill();
            break;
          }
          case 'sleepy': {
            // Half-closed eyes
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(eyeLX, eyeY, 4.5, 3.5, 0, 0, Math.PI*2);
            ctx.clip();
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(eyeLX - 5, eyeY - 3.5, 10, 7);
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(eyeRX, eyeY, 4.5, 3.5, 0, 0, Math.PI*2);
            ctx.clip();
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(eyeRX - 5, eyeY - 3.5, 10, 7);
            ctx.restore();
            // Eyelid cover (top half)
            ctx.fillStyle = '#f0eeeb';
            ctx.fillRect(cx - 16, eyeY - 8, 32, 5);
            break;
          }
          case 'thinking': {
            // Dot eyes, left looking up-right
            ctx.fillStyle = '#1f2937';
            ctx.beginPath(); ctx.arc(eyeLX, eyeY - 1.5, 3.5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX, eyeY, 3.5, 0, Math.PI*2); ctx.fill();
            // Highlight
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(eyeLX + 1, eyeY - 3, 1, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX + 1, eyeY - 1.5, 1, 0, Math.PI*2); ctx.fill();
            break;
          }
          default: { // neutral
            ctx.fillStyle = '#1f2937';
            ctx.beginPath(); ctx.arc(eyeLX, eyeY, 3.5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX, eyeY, 3.5, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(eyeLX + 1, eyeY - 1.5, 1, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX + 1, eyeY - 1.5, 1, 0, Math.PI*2); ctx.fill();
          }
        }
      }

      // ── Nose (small pink oval) ────────────────────────────────────────────
      ctx.fillStyle = 'rgba(255,160,180,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 4, 2.5, 1.8, 0, 0, Math.PI*2);
      ctx.fill();

      // ── Mouth ─────────────────────────────────────────────────────────────
      ctx.strokeStyle = '#555';
      ctx.lineWidth   = 1.8;
      ctx.lineCap     = 'round';

      const mY = cy + 9;
      switch (expr) {
        case 'happy': {
          ctx.beginPath();
          ctx.moveTo(cx - 7, mY - 2);
          ctx.quadraticCurveTo(cx, mY + 6, cx + 7, mY - 2);
          ctx.stroke();
          break;
        }
        case 'surprised': {
          ctx.beginPath();
          ctx.arc(cx, mY + 1, 4, 0, Math.PI*2);
          ctx.stroke();
          break;
        }
        case 'sleepy': {
          ctx.beginPath();
          ctx.moveTo(cx - 6, mY + 1);
          ctx.quadraticCurveTo(cx, mY - 2, cx + 6, mY + 1);
          ctx.stroke();
          break;
        }
        case 'thinking': {
          // Small "..." text above head
          ctx.save();
          ctx.fillStyle = '#9ca3af';
          ctx.font = '9px Inter, sans-serif';
          ctx.fillText('...', cx - 6, cy - 24);
          ctx.restore();
          // Neutral mouth
          ctx.beginPath();
          ctx.moveTo(cx - 5, mY);
          ctx.lineTo(cx + 5, mY);
          ctx.stroke();
          break;
        }
        default: {
          ctx.beginPath();
          ctx.moveTo(cx - 5, mY);
          ctx.quadraticCurveTo(cx, mY + 4, cx + 5, mY);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  window.AIFace = AIFace;
})();
