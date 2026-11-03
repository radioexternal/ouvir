// SAM WEB RADIO FREE - os MEDIDORES (02/11, o Samir: «spectrum, RTA e LUFS/dBFS», em tela grande), iguais aos do Windows 1.1:
// RTA de 1/3 de oitava ou ESPECTRO (FFT 4096), loudness BS.1770 (momentaneo 400 ms, curto 3 s, programa com as portas -70 / -10),
// true-peak 4x (dBTP), barras L/R, Mid/Side, correlacao e balanco. Serve a pagina web e a app Android (o mesmo ficheiro).
// O som MEDE-SE NUMA COPIA do canal (um <audio> escondido, com CORS, ligado ao AudioContext com ganho 0): o leitor principal
// nao muda, o volume nao entra na medida (e' o nivel real da emissora) e, se o servidor nao deixar ler, so' os medidores ficam sem sinal.
// Uso: SAMMED.abrir({url: '<stream>', nome: '<canal>'}); SAMMED.canal(url, nome) ao trocar; SAMMED.fechar().
(function () {
  'use strict';
  const BANDAS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
    4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
  const NFFT = 4096, NGON = 512;
  const AMAR = '#f6e226', AMAR_E = '#968814', AMBAR = '#ff9500', MAG = '#e040fb', AZUL = '#4fc3f7', GRE = '#3a3c40', ROT = '#c8ccd2';

  // ---- o processamento de cada amostra (corre no AudioWorklet; o mesmo texto serve de reserva no ScriptProcessor) ----
  const DSP = `
  class MedDSP {
    constructor(fs) {
      this.fs = fs;
      let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
      let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
      this.b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0];
      this.a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
      f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
      this.b2 = [1, -2, 1]; this.a2 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
      this.z = new Float64Array(8); this.be = 0; this.bn = 0; this.b100 = Math.round(fs / 10); this.blocos = [];
      this.pL = 0; this.pR = 0; this.tL = 0; this.tR = 0; this.lr = 0; this.ll = 0; this.rr = 0;
      this.hL = new Float64Array(12); this.hR = new Float64Array(12); this.ih = 0;
      this.fase = [];
      for (let f = 0; f < 4; f++) { const h = []; let s = 0;
        for (let t = 0; t < 12; t++) { const x = t - (5 + f / 4); const si = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
          h.push(si * (0.5 + 0.5 * Math.cos(Math.PI * x / 6.5))); s += h[t]; }
        this.fase.push(h.map(v => v / s)); }
      this.mono = new Float32Array(${NFFT}); this.im = 0; this.gL = new Float32Array(${NGON}); this.gR = new Float32Array(${NGON}); this.ig = 0; this.par = 0;
    }
    bq(c, x) {
      const z = this.z, o = c * 4;
      const y = this.b1[0] * x + z[o]; z[o] = this.b1[1] * x - this.a1[1] * y + z[o + 1]; z[o + 1] = this.b1[2] * x - this.a1[2] * y;
      const w = y + z[o + 2]; z[o + 2] = -2 * y - this.a2[1] * w + z[o + 3]; z[o + 3] = y - this.a2[2] * w;
      return w;
    }
    passa(L, R) {
      const n = L.length;
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R ? R[i] : l, al = Math.abs(l), ar = Math.abs(r);
        if (al > this.pL) this.pL = al; if (ar > this.pR) this.pR = ar;
        this.hL[this.ih] = l; this.hR[this.ih] = r; this.ih = (this.ih + 1) % 12;
        for (let f = 1; f < 4; f++) { const h = this.fase[f]; let il = 0, ir = 0;
          for (let t = 0; t < 12; t++) { const k = (this.ih + t) % 12; il += h[t] * this.hL[k]; ir += h[t] * this.hR[k]; }
          il = Math.abs(il); ir = Math.abs(ir); if (il > this.tL) this.tL = il; if (ir > this.tR) this.tR = ir; }
        if (al > this.tL) this.tL = al; if (ar > this.tR) this.tR = ar;
        const kl = this.bq(0, l), kr = this.bq(1, r);
        this.be += kl * kl + kr * kr; if (++this.bn >= this.b100) { this.blocos.push(this.be / this.bn); this.be = 0; this.bn = 0; }
        const a = Math.exp(-1 / (0.3 * this.fs));
        this.lr = this.lr * a + l * r; this.ll = this.ll * a + l * l; this.rr = this.rr * a + r * r;
        this.mono[this.im] = (l + r) * 0.5; this.im = (this.im + 1) % ${NFFT};
        if ((this.par ^= 1)) { this.gL[this.ig] = l; this.gR[this.ig] = r; this.ig = (this.ig + 1) % ${NGON}; }
      }
    }
    tira() {
      const m = new Float32Array(${NFFT}), gl = new Float32Array(${NGON}), gr = new Float32Array(${NGON});
      for (let i = 0; i < ${NFFT}; i++) m[i] = this.mono[(this.im + i) % ${NFFT}];
      for (let i = 0; i < ${NGON}; i++) { gl[i] = this.gL[(this.ig + i) % ${NGON}]; gr[i] = this.gR[(this.ig + i) % ${NGON}]; }
      const r = {blocos: this.blocos, pL: this.pL, pR: this.pR, tL: this.tL, tR: this.tR, lr: this.lr, ll: this.ll, rr: this.rr, mono: m, gL: gl, gR: gr, fs: this.fs};
      this.blocos = []; this.pL = this.pR = this.tL = this.tR = 0;
      return r;
    }
  }`;
  const WORKLET = DSP + `
  class MedProc extends AudioWorkletProcessor {
    constructor() { super(); this.d = new MedDSP(sampleRate); this.n = 0; }
    process(ins) {
      const i = ins[0];
      if (i && i.length) { this.d.passa(i[0], i[1]); this.n += i[0].length; }
      if (this.n >= sampleRate / 20) { this.n = 0; this.port.postMessage(this.d.tira()); }
      return true;
    }
  }
  registerProcessor('sam-medidores', MedProc);`;

  // ---- o estado (o que o C# faz no Medidor.Ler + a balistica da janela) ----
  const H = {e: new Float64Array(750), n: new Uint32Array(750)};
  let ult = [], tpMax = 0, L = null;
  const vis = {vL: -120, vR: -120, hL: -120, hR: -120, thL: 0, thR: 0, rta: BANDAS.map(() => -120), rp: BANDAS.map(() => -120), rt: BANDAS.map(() => 0),
    esp: null, corr: 0, bal: 0, oL: false, oR: false, oT: 0, antes: 0};
  const ops = {espectro: false, pico: true, e80: false};
  const lufs = e => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -99);
  const db = a => (a > 1e-6 ? 20 * Math.log10(a) : -120);
  const media = n => { let s = 0; for (let i = ult.length - n; i < ult.length; i++) s += ult[i]; return s / n; };
  function repor() { H.e.fill(0); H.n.fill(0); ult = []; tpMax = 0; }
  function integrado() {
    let e = 0, n = 0; for (let i = 0; i < 750; i++) { e += H.e[i]; n += H.n[i]; }
    if (!n) return -99;
    const b0 = Math.max(0, Math.ceil((lufs(e / n) - 10 + 70) * 10)); e = 0; n = 0;
    for (let i = b0; i < 750; i++) { e += H.e[i]; n += H.n[i]; }
    return n ? lufs(e / n) : -99;
  }
  const JAN = new Float64Array(NFFT); let SJ2 = 0;
  for (let i = 0; i < NFFT; i++) { JAN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT); SJ2 += JAN[i] * JAN[i]; }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  function recebe(d) {
    for (const e of d.blocos) {
      ult.push(e); if (ult.length > 30) ult.shift();
      if (ult.length >= 4) { const m = media(4), l = lufs(m); if (l > -70) { const b = Math.min(749, Math.floor((l + 70) * 10)); H.e[b] += m; H.n[b]++; } }
    }
    tpMax = Math.max(tpMax, d.tL, d.tR);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) re[i] = d.mono[i] * JAN[i];
    fft(re, im);
    const nb = NFFT / 2, p = new Float64Array(nb), esc = 2 / (NFFT * SJ2);
    for (let k = 1; k < nb; k++) p[k] = (re[k] * re[k] + im[k] * im[k]) * esc;
    const esp = new Float64Array(nb); for (let k = 0; k < nb; k++) esp[k] = p[k] > 1e-14 ? 10 * Math.log10(2 * p[k]) : -140;
    const df = d.fs / NFFT, g = Math.pow(2, 1 / 6);
    const rta = BANDAS.map(f => {
      const k0 = Math.max(1, Math.ceil(f / g / df)), k1 = Math.min(nb - 1, Math.floor(f * g / df)); let s = 0;
      if (k1 < k0) { const k = Math.round(f / df); if (k >= 1 && k < nb) s = p[k]; } else for (let k = k0; k <= k1; k++) s += p[k];
      return s > 1e-14 ? 10 * Math.log10(2 * s) : -140;
    });
    const dd = Math.sqrt(d.ll * d.rr);
    L = {pL: db(d.pL), pR: db(d.pR), tL: db(d.tL), tR: db(d.tR), tpMax: db(tpMax), mom: ult.length >= 4 ? lufs(media(4)) : -99,
      curto: ult.length >= 30 ? lufs(media(30)) : -99, integ: integrado(), corr: dd > 1e-9 ? d.lr / dd : 0,
      bal: d.ll > 1e-12 && d.rr > 1e-12 ? 10 * Math.log10(d.ll / d.rr) : 0, esp, rta, gL: d.gL, gR: d.gR, fs: d.fs};
    balistica(L);
  }
  function balistica(r) {
    const agora = performance.now() / 1000, dt = Math.min(0.2, vis.antes ? agora - vis.antes : 0.05); vis.antes = agora;
    const pl = Math.max(r.pL, r.tL), pr = Math.max(r.pR, r.tR);
    vis.vL = Math.max(pl, vis.vL - 24 * dt); vis.vR = Math.max(pr, vis.vR - 24 * dt);
    if (pl >= vis.hL) { vis.hL = pl; vis.thL = agora; } else if (agora - vis.thL > 2) vis.hL -= 12 * dt;
    if (pr >= vis.hR) { vis.hR = pr; vis.thR = agora; } else if (agora - vis.thR > 2) vis.hR -= 12 * dt;
    if (r.tL > -0.5) { vis.oL = true; vis.oT = agora; } if (r.tR > -0.5) { vis.oR = true; vis.oT = agora; }
    if (agora - vis.oT > 3) vis.oL = vis.oR = false;
    r.rta.forEach((x, b) => { vis.rta[b] = Math.max(x, vis.rta[b] - 18 * dt);
      if (x >= vis.rp[b]) { vis.rp[b] = x; vis.rt[b] = agora; } else if (agora - vis.rt[b] > 1.5) vis.rp[b] -= 10 * dt; });
    if (!vis.esp || vis.esp.length !== r.esp.length) vis.esp = Float64Array.from(r.esp);
    else for (let k = 0; k < vis.esp.length; k++) vis.esp[k] = r.esp[k] > vis.esp[k] ? r.esp[k] : vis.esp[k] * 0.8 + r.esp[k] * 0.2;
    vis.corr = vis.corr * 0.8 + r.corr * 0.2; vis.bal = vis.bal * 0.8 + r.bal * 0.2;
  }

  // ---- o desenho (tela virtual: 1000 x 470 deitado, 600 x 1000 em pe') ----
  let cv = null, cx = null, rato = {x: -1, y: -1}, esc = 1, ox = 0, oy = 0, deitado = true, nomeCanal = '', erro = '';
  const BR = (v, c = 1) => v.toFixed(c).replace('.', ',');
  const yDb = (d, y0, y1, min) => y0 + (y1 - y0) * Math.max(0, Math.min(1, d / min));
  function texto(s, x, y, cor, tam, peso, al) { cx.fillStyle = cor; cx.font = (peso || '') + ' ' + tam + 'px "Segoe UI",system-ui,Roboto,sans-serif'; cx.textAlign = al || 'left'; cx.fillText(s, x, y); }
  function desenha() {
    if (!cv) return;
    const W = cv.clientWidth, Hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    deitado = W >= Hh * 0.9;
    const VW = deitado ? 1000 : 600, VH = deitado ? 470 : 1000;
    esc = Math.min(W / VW, Hh / VH); ox = (W - VW * esc) / 2; oy = (Hh - VH * esc) / 2;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = '#0e0f11'; cx.fillRect(0, 0, W, Hh);
    cx.setTransform(dpr * esc, 0, 0, dpr * esc, dpr * ox, dpr * oy);
    const T = deitado ? {x: 10, y: 10, w: 980, h: 450} : {x: 10, y: 10, w: 580, h: 980};
    cx.fillStyle = '#000'; cx.fillRect(T.x, T.y, T.w, T.h);
    cx.fillStyle = 'rgba(255,255,255,.06)'; cx.beginPath(); cx.moveTo(T.x, T.y); cx.lineTo(T.x + T.w, T.y); cx.lineTo(T.x + T.w, T.y + 40); cx.lineTo(T.x, T.y + T.h * 0.6); cx.fill();
    cx.strokeStyle = '#28292e'; cx.lineWidth = 3; cx.strokeRect(T.x, T.y, T.w, T.h);
    if (!L) { texto(erro || 'a ligar ao canal…', T.x + T.w / 2, T.y + T.h / 2, erro ? AMBAR : ROT, 18, '600', 'center'); return; }
    if (deitado) { espectro(20, 20, 480, 440); centro(506, 20); picos(746, 20); }
    else { espectro(20, 20, 560, 470); centro(40, 520); picos(340, 520); }
    if (erro) texto('⚠ ' + erro, T.x + 14, T.y + T.h - 10, AMBAR, 12);
  }
  function espectro(X, Y, Wd, Ht) {
    const x0 = X + 44, x1 = X + Wd - 10, y0 = Y + 44, y1 = Y + Ht - 46, min = ops.e80 ? -80 : -60, nb = BANDAS.length;
    cx.lineWidth = 1;
    texto('dB', X + 12, y0 - 18, ROT, 12);
    for (let d = 0; d >= min; d -= 10) { const y = yDb(d, y0, y1, min); cx.strokeStyle = GRE; cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke(); texto(String(d), x0 - 8, y + 4, ROT, 12, '', 'right'); }
    const fmin = 20, fmax = 20000, xf = f => x0 + (x1 - x0) * Math.log(f / fmin) / Math.log(fmax / fmin);
    let cur = -1, curF = 0, curDb = -120;
    if (rato.x >= x0 && rato.x <= x1 && rato.y >= y0 - 10 && rato.y <= y1 + 20) {
      curF = fmin * Math.pow(fmax / fmin, (rato.x - x0) / (x1 - x0)); let m = 1e9;
      BANDAS.forEach((f, b) => { const d = Math.abs(Math.log(f / curF)); if (d < m) { m = d; cur = b; } });
    } else vis.rta.forEach((v, b) => { if (cur < 0 || v > vis.rta[cur]) cur = b; });
    const MOSTRA = [[31.5, '31.5'], [63, '63'], [125, '125'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [4000, '4k'], [8000, '8k'], [16000, '16k']];
    if (!ops.espectro) {
      const lg = (x1 - x0) / nb;
      for (let b = 0; b < nb; b++) {
        const x = x0 + b * lg + 2, w = lg - 4, y = yDb(vis.rta[b], y0, y1, min);
        if (b === cur) { cx.fillStyle = 'rgba(255,120,30,.45)'; cx.fillRect(x - 1, y0, w + 2, y1 - y0); }
        if (y < y1) { const gr = cx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, AMAR); gr.addColorStop(1, AMAR_E); cx.fillStyle = b === cur ? AMBAR : gr; cx.fillRect(x, y, w, y1 - y); }
        if (ops.pico && vis.rp[b] > min) { cx.fillStyle = '#ebebeb'; cx.fillRect(x + 1, yDb(vis.rp[b], y0, y1, min) - 5, w - 2, 2); }
      }
      MOSTRA.forEach(([f, s]) => texto(s, x0 + BANDAS.indexOf(f) * lg + lg / 2, y1 + 18, ROT, 11, '', 'center'));
      curF = BANDAS[cur]; curDb = vis.rta[cur];
    } else if (vis.esp) {
      const df = L.fs / NFFT, px = Math.round(x1 - x0), pts = [];
      for (let i = 0; i <= px; i++) {
        const fa = fmin * Math.pow(fmax / fmin, i / px), fb = fmin * Math.pow(fmax / fmin, (i + 1) / px); let v = -140;
        if (fb - fa < df) { const kf = (fa + fb) / 2 / df, k = Math.max(1, Math.min(vis.esp.length - 2, Math.floor(kf))), t = Math.max(0, Math.min(1, kf - k)); v = vis.esp[k] * (1 - t) + vis.esp[k + 1] * t; }
        else for (let k = Math.max(1, Math.floor(fa / df)); k <= Math.min(vis.esp.length - 1, Math.floor(fb / df)); k++) if (vis.esp[k] > v) v = vis.esp[k];
        pts.push([x0 + i, yDb(v, y0, y1, min)]);
      }
      cx.strokeStyle = '#222428'; MOSTRA.forEach(([f, s]) => { const x = xf(f); cx.beginPath(); cx.moveTo(x, y0); cx.lineTo(x, y1); cx.stroke(); texto(s, x, y1 + 18, ROT, 11, '', 'center'); });
      const gr = cx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(246,226,38,.66)'); gr.addColorStop(1, 'rgba(150,136,20,.12)');
      cx.beginPath(); cx.moveTo(x0, y1); pts.forEach(p => cx.lineTo(p[0], p[1])); cx.lineTo(x0 + px, y1); cx.closePath(); cx.fillStyle = gr; cx.fill();
      cx.beginPath(); pts.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]))); cx.strokeStyle = AMAR; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1;
      if (curF <= 0) curF = BANDAS[cur];
      const kc = Math.max(1, Math.min(vis.esp.length - 1, Math.round(curF / df))); curDb = vis.esp[kc];
      cx.strokeStyle = AMBAR; cx.setLineDash([4, 3]); cx.beginPath(); cx.moveTo(xf(curF), y0); cx.lineTo(xf(curF), y1); cx.stroke(); cx.setLineDash([]);
    }
    texto('Hz', x1, y1 + 18, ROT, 11, '', 'right');
    const fs = curF >= 1000 ? BR(curF / 1000, curF >= 10000 ? 1 : 2) + ' k' : BR(curF, 0) + ' ';
    texto(ops.espectro ? 'ESPECTRO' : 'RTA 1/3', x0, Y + 22, AZUL, 15, '700');
    texto('Frequência: ', x0 + 130, Y + 22, '#fff', 14); texto(fs + 'Hz', x0 + 214, Y + 22, AMAR, 14, '700');
    texto('Nível: ', x0 + 300, Y + 22, '#fff', 14); texto((curDb > -119 ? BR(curDb) : '—') + ' dB', x0 + 344, Y + 22, AMAR, 14, '700');
  }
  function valor(x, y, tit, v, un, ok) {
    texto(tit, x, y + 14, '#fff', 14);
    const s = ok ? BR(v) : '—';
    cx.font = '30px "Segoe UI",system-ui,Roboto,sans-serif'; const w = cx.measureText(s).width;
    texto(s, x + 120 - w / 2, y + 48, ok ? AMAR : '#777', 30); texto(un, x + 124 + w / 2, y + 48, '#fff', 12);
  }
  function centro(X, Y) {
    cx.fillStyle = AZUL; cx.fillRect(X, Y + 6, 11, 11);
    let n = nomeCanal || 'SAM FREE'; if (n.length > 22) n = n.slice(0, 21) + '…';
    texto(n, X + 18, Y + 16, '#fff', 14);
    valor(X, Y + 26, 'Loudness de programa', L.integ, 'LUFS', L.integ > -98);
    valor(X, Y + 86, 'True-peak máximo', L.tpMax, 'dBTP', L.tpMax > -119);
    const gx = X + 110, gy = Y + 236, rr = 62;
    cx.strokeStyle = '#969696'; cx.beginPath(); cx.arc(gx, gy, rr, Math.PI, 2 * Math.PI); cx.stroke();
    cx.strokeStyle = '#464646'; cx.beginPath(); cx.moveTo(gx - rr, gy); cx.lineTo(gx + rr, gy); cx.moveTo(gx, gy); cx.lineTo(gx, gy - rr); cx.stroke();
    texto('Mid/Side', gx, gy - rr - 6, ROT, 11, '', 'center'); texto('Esq.', gx - rr - 4, gy + 4, ROT, 11, '', 'right'); texto('Dir.', gx + rr + 4, gy + 4, ROT, 11);
    let mx = 1e-4; for (let i = 0; i < NGON; i++) mx = Math.max(mx, Math.abs(L.gL[i]), Math.abs(L.gR[i]));
    const k = rr / Math.max(0.05, mx) * 0.7; cx.fillStyle = 'rgba(246,226,38,.6)';
    for (let i = 0; i < NGON; i++) { let m = (L.gL[i] + L.gR[i]) * 0.7071, s = (L.gL[i] - L.gR[i]) * 0.7071; if (m < 0) { m = -m; s = -s; }
      const x = gx - s * k, y = gy - m * k; if (Math.abs(x - gx) <= rr && gy - y <= rr) cx.fillRect(x, y, 1.6, 1.6); }
    valor(X, Y + 252, 'Pico / loudness (PLR)', L.tpMax - L.integ, 'dB', L.integ > -98 && L.tpMax > -119);
    valor(X, Y + 312, 'Curto prazo · 3 s', L.curto, 'LUFS', L.curto > -98);
    texto('Momentâneo ' + (L.mom > -98 ? BR(L.mom) : '—') + ' LUFS', X, Y + 392, ROT, 12);
  }
  function barra(x, y0, y1, w, v, h, min) {
    cx.fillStyle = '#1c1c1e'; cx.fillRect(x, y0, w, y1 - y0);
    const y = yDb(v, y0, y1, min), y6 = yDb(-6, y0, y1, min), y1d = yDb(-1, y0, y1, min);
    if (y < y1) { cx.fillStyle = AMAR; cx.fillRect(x, Math.max(y, y6), w, y1 - Math.max(y, y6));
      if (y < y6) { cx.fillStyle = AMBAR; cx.fillRect(x, Math.max(y, y1d), w, y6 - Math.max(y, y1d)); }
      if (y < y1d) { cx.fillStyle = MAG; cx.fillRect(x, y, w, y1d - y); } }
    if (ops.pico && h > min) { cx.fillStyle = h > -1 ? MAG : '#fff'; cx.fillRect(x, yDb(h, y0, y1, min) - 1, w, 2); }
    cx.strokeStyle = '#3c3c40'; cx.strokeRect(x, y0, w, y1 - y0);
  }
  function escala(x0, x1, y, v, a, b, ea, eb, un) {
    const n = 21, lg = (x1 - 28 - x0) / n, t = Math.max(0, Math.min(1, (v - a) / (b - a))), iv = Math.round(t * (n - 1)), meio = 10;
    for (let i = 0; i < n; i++) { const on = (iv >= meio && i >= meio && i <= iv) || (iv < meio && i <= meio && i >= iv); cx.fillStyle = on ? AZUL : '#404246'; cx.fillRect(x0 + i * lg + 1, y, lg - 2, i === meio ? 12 : 9); }
    texto(ea, x0, y + 24, ROT, 10); texto('0', x0 + meio * lg + lg / 2, y + 24, ROT, 10, '', 'center'); texto(eb, x0 + (n - 1) * lg, y + 24, ROT, 10, '', 'center'); texto(un, x1 - 24, y + 10, ROT, 10);
  }
  function picos(X, Y) {
    const y0 = Y + 30, y1 = Y + 310, xl = X + 48, xr = X + 76, w = 22, min = -60;
    texto('dBTP', X, Y + 16, ROT, 11); texto('L', xl + 11, Y + 16, ROT, 11, '', 'center'); texto('R', xr + 11, Y + 16, ROT, 11, '', 'center');
    for (let d = 0; d >= -60; d -= 6) { const y = yDb(d, y0, y1, min); texto(String(d), X + 30, y + 4, ROT, 11, '', 'right'); cx.strokeStyle = GRE; cx.beginPath(); cx.moveTo(X + 38, y); cx.lineTo(X + 44, y); cx.stroke(); }
    barra(xl, y0, y1, w, vis.vL, vis.hL, min); barra(xr, y0, y1, w, vis.vR, vis.hR, min);
    texto('Estéreo', X + 130, Y + 22, '#fff', 15);
    texto('L', X + 140, Y + 56, '#fff', 13, '', 'center'); texto('R', X + 176, Y + 56, '#fff', 13, '', 'center');
    cx.fillStyle = vis.oL ? MAG : '#461e4a'; cx.fillRect(X + 133, Y + 64, 14, 10); cx.fillStyle = vis.oR ? MAG : '#461e4a'; cx.fillRect(X + 169, Y + 64, 14, 10);
    texto('Pico', X + 158, Y + 92, '#fff', 12, '', 'center');
    texto('Correlação', X, Y + 340, '#fff', 13); escala(X, X + 226, Y + 348, vis.corr, -1, 1, '−', '+', 'L/R');
    texto('Balanço L/R (dB)', X, Y + 392, '#fff', 13); escala(X, X + 226, Y + 400, -vis.bal, -4, 4, '-4', '+4', 'dB');
  }

  // ---- o audio (a copia medida) ----
  let ctx = null, au = null, no = null, sp = null, dsp = null, raf = 0, url = '', aberto = false, cai = 0;
  async function liga(u) {
    url = u || ''; L = null; erro = ''; repor();
    if (!au) return;
    au.removeAttribute('src'); try { au.load(); } catch (e) { /* */ }
    if (!url) { erro = 'este canal não deixa medir'; return; }
    au.src = url;
    try { await au.play(); } catch (e) { erro = 'não deu para ler o canal'; }
  }
  async function montaAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { erro = 'este navegador não tem áudio para medir'; return; }
    ctx = new AC(); try { await ctx.resume(); } catch (e) { /* */ }
    au = new Audio(); au.crossOrigin = 'anonymous'; au.preload = 'none';
    au.addEventListener('error', () => { if (!aberto || !au.getAttribute('src')) return; erro = 'o canal não deixa medir (ou caiu) — tento de novo'; clearTimeout(cai); cai = setTimeout(() => aberto && liga(url), 5000); });
    const src = ctx.createMediaElementSource(au), zero = ctx.createGain(); zero.gain.value = 0;     // a copia nao se ouve
    try {
      if (!ctx.audioWorklet) throw new Error('sem worklet');
      const blob = URL.createObjectURL(new Blob([WORKLET], {type: 'application/javascript'}));
      await ctx.audioWorklet.addModule(blob);
      no = new AudioWorkletNode(ctx, 'sam-medidores', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit'});
      no.port.onmessage = ev => recebe(ev.data);
      src.connect(no); no.connect(zero);
    } catch (e) {
      // reserva: o mesmo processamento no ScriptProcessor (navegadores antigos)
      const C = (new Function(DSP + '; return MedDSP;'))(); dsp = new C(ctx.sampleRate);
      sp = ctx.createScriptProcessor(4096, 2, 2); let n = 0;
      sp.onaudioprocess = ev => { const b = ev.inputBuffer; dsp.passa(b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : null); n += b.length; if (n >= ctx.sampleRate / 20) { n = 0; recebe(dsp.tira()); } };
      src.connect(sp); sp.connect(zero);
    }
    zero.connect(ctx.destination);
  }

  // ---- a janela (tela grande) ----
  let cx0 = null;
  function monta() {
    if (cx0) return;
    const st = document.createElement('style');
    st.textContent = `#sammed{position:fixed;inset:0;z-index:9999;background:#0e0f11;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
#sammed canvas{flex:1;width:100%;min-height:0;display:block;touch-action:none}
#sammed .bt{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:8px 10px 12px;background:linear-gradient(180deg,#2a2b2f,#18191c)}
#sammed button{min-width:84px;min-height:40px;border-radius:20px;border:1.5px solid #4e5056;background:linear-gradient(180deg,#2c2d31,#0c0c0e);color:#bec2c8;font:600 13px system-ui,-apple-system,Roboto,sans-serif;letter-spacing:.04em;cursor:pointer}
#sammed button[aria-pressed=true]{color:${AMAR};border-color:#8a7f1a}
#sammed button.x{color:#fff;border-color:${AZUL}}
#sammed button:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
    document.head.appendChild(st);
    cx0 = document.createElement('div'); cx0.id = 'sammed'; cx0.hidden = true;
    cx0.setAttribute('role', 'dialog'); cx0.setAttribute('aria-label', 'Medidores');
    cv = document.createElement('canvas'); cx = cv.getContext('2d');
    const bt = document.createElement('div'); bt.className = 'bt';
    const B = (t, f, p) => { const b = document.createElement('button'); b.textContent = t; b.onclick = () => { f(); pinta(); }; b._p = p; bt.appendChild(b); return b; };
    B('RTA', () => (ops.espectro = false), () => !ops.espectro);
    B('ESPECTRO', () => (ops.espectro = true), () => ops.espectro);
    B('RESET', repor);
    B('PICO', () => (ops.pico = !ops.pico), () => ops.pico);
    B('ESCALA −80', () => (ops.e80 = !ops.e80), () => ops.e80);
    B('TELA', () => { const d = document; if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d); else cheia(); }, () => !!(document.fullscreenElement || document.webkitFullscreenElement));
    const x = B('✕ FECHAR', () => window.SAMMED.fechar()); x.className = 'x';
    function pinta() { [...bt.children].forEach(b => b._p && b.setAttribute('aria-pressed', String(!!b._p()))); }
    document.addEventListener('fullscreenchange', pinta);
    const onde = ev => { const r = cv.getBoundingClientRect(), t = ev.touches ? ev.touches[0] : ev; rato = {x: (t.clientX - r.left - ox) / esc, y: (t.clientY - r.top - oy) / esc}; };
    cv.addEventListener('mousemove', onde); cv.addEventListener('touchstart', onde, {passive: true}); cv.addEventListener('touchmove', onde, {passive: true});
    cv.addEventListener('mouseleave', () => (rato = {x: -1, y: -1}));
    cv.addEventListener('dblclick', () => { ops.espectro = !ops.espectro; pinta(); });
    document.addEventListener('keydown', ev => { if (!aberto) return; if (ev.key === 'Escape') window.SAMMED.fechar(); else if (ev.key === ' ') { ev.preventDefault(); ops.espectro = !ops.espectro; pinta(); } else if (ev.key === 'r' || ev.key === 'R') repor(); });
    cx0.append(cv, bt); document.body.appendChild(cx0); pinta();
  }
  function cheia() {
    const e = cx0, f = e.requestFullscreen || e.webkitRequestFullscreen;
    if (f) Promise.resolve(f.call(e)).then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (er) { /* */ } }).catch(() => {});
  }
  function ciclo() { desenha(); raf = requestAnimationFrame(ciclo); }

  window.SAMMED = {
    async abrir(o) {
      monta(); nomeCanal = (o && o.nome) || ''; aberto = true; cx0.hidden = false;
      if (!(o && o.semTelaCheia)) cheia();
      cancelAnimationFrame(raf); ciclo();
      if (o && o.prova) { window.SAMMED._prova = recebe; return; }
      if (!ctx) await montaAudio(); else try { await ctx.resume(); } catch (e) { /* */ }
      await liga(o && o.url);
    },
    canal(u, nome) { nomeCanal = nome || ''; if (aberto && u !== url) liga(u); },
    fechar() {
      aberto = false; clearTimeout(cai); cancelAnimationFrame(raf);
      if (cx0) cx0.hidden = true;
      if (au) { au.removeAttribute('src'); try { au.load(); } catch (e) { /* */ } }
      if (ctx) ctx.suspend().catch(() => {});
      const d = document; if (d.fullscreenElement || d.webkitFullscreenElement) try { (d.exitFullscreen || d.webkitExitFullscreen).call(d); } catch (e) { /* */ }
      if (window.SAMMED.aoFechar) window.SAMMED.aoFechar();
    },
    // para as provas: o mesmo DSP fora do audio
    _DSP: fs => { const C = (new Function(DSP + '; return MedDSP;'))(); return new C(fs); },
    _recebe: d => recebe(d), _ler: () => L, _repor: repor, _ops: ops,
  };
})();
