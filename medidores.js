// SAM WEB RADIO FREE - os MEDIDORES 2.1 (02/11). Serve a pagina web e a app Android (o mesmo ficheiro).
// 2.0: RTA de 1/3 de oitava ou ESPECTRO (FFT 4096), loudness BS.1770 (momentaneo 400 ms, curto 3 s, programa com as portas
// -70 / -10), true-peak 4x (dBTP), barras L/R, Mid/Side, correlacao e balanco.
// 2.1: dois ecras - L|R (RTA, VU e CASCATA de cada canal, os numeros ao centro) e L+R (a soma, como na 2.0, mais VU e cascata);
// AUTO PICO na linha de cima de cada RTA (segue a banda mais forte; tocar escolhe, 5 s ou toque duplo volta ao AUTO);
// GANHO de ecra +/-10 dB por RTA, VU e CASCATA; GATE da cascata; ingles por omissao, EN / PT; um ecra em pe' para telemoveis.
// O som MEDE-SE NUMA COPIA do canal (um <audio> escondido, com CORS, ligado ao AudioContext com ganho 0): o leitor principal
// nao muda, o volume nao entra na medida (e' o nivel real da emissora) e, se o servidor nao deixar ler, so' os medidores ficam sem sinal.
// Uso: SAMMED.abrir({url: '<stream>', nome: '<canal>'}); SAMMED.canal(url, nome) ao trocar; SAMMED.fechar().
(function () {
  'use strict';
  const BANDAS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
    4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
  const NB = BANDAS.length, NFFT = 4096, NGON = 512, NC = 240, NR = 150;      // cascata: 240 colunas (log) x 150 linhas (15 s)
  const AMAR = '#f6e226', AMAR_E = '#968814', AMBAR = '#ff9500', MAG = '#e040fb', AZUL = '#4fc3f7', AZUL_E = '#1d4f9a',
    GRE = '#2c2e33', ROT = '#b9bec6', FUNDO = '#0e0f11', PAINEL = '#08090b', BORDA = '#26282d';
  const FONTE = '"Segoe UI",system-ui,Roboto,sans-serif';

  // ---- os textos (EN por omissao) ----
  const TX = {
    EN: {titulo: 'SAM WEB RADIO FREE · METERS', curto: 'METERS', est: 'STEREO L | R', soma: 'L+R (SUM)', liga: 'connecting to the channel…',
      e_nao: 'this channel cannot be measured', e_ler: 'could not read the channel', e_cai: 'the channel cannot be measured (or dropped) — retrying',
      e_nav: 'this browser has no audio to measure', PROG: 'PROGRAM LOUDNESS', LKFS: 'LKFS (PGM)', TP: 'TRUE-PEAK MAX', REC: 'RECONSTRUCTED PEAK',
      PLR: 'PLR', CURTO: 'SHORT-TERM (3 s)', MOM: 'MOMENTARY (400 ms)', CORR: 'CORRELATION', MS: 'MID/SIDE', BAL: 'BALANCE', ESC: 'SCALES',
      CASC: 'WATERFALL', CASC_C: 'WATERF.', GANHO: 'GAIN', FREQ: 'Frequency', NIVEL: 'Level', ESPEC: 'SPECTRUM', esq: 'LEFT L', dir: 'RIGHT R',
      pico: 'Peak', b_espec: 'SPECTRUM', b_casc: 'WATERFALL', b_pico: 'PEAK', b_escala: 'SCALE −80', b_tela: 'SCREEN', b_fechar: '✕ CLOSE', dlg: 'Meters'},
    PT: {titulo: 'SAM WEB RADIO FREE · MEDIDORES', curto: 'MEDIDORES', est: 'ESTÉREO L | R', soma: 'L+R (SOMA)', liga: 'a ligar ao canal…',
      e_nao: 'este canal não deixa medir', e_ler: 'não deu para ler o canal', e_cai: 'o canal não deixa medir (ou caiu) — tento de novo',
      e_nav: 'este navegador não tem áudio para medir', PROG: 'LOUDNESS DE PROGRAMA', LKFS: 'LKFS (PGM)', TP: 'TRUE-PEAK MÁX.', REC: 'PICO RECONSTRUÍDO',
      PLR: 'PLR', CURTO: 'CURTO PRAZO (3 s)', MOM: 'MOMENTÂNEO (400 ms)', CORR: 'CORRELAÇÃO', MS: 'MID/SIDE', BAL: 'BALANÇO', ESC: 'ESCALAS',
      CASC: 'CASCATA', CASC_C: 'CASC.', GANHO: 'GANHO', FREQ: 'Frequência', NIVEL: 'Nível', ESPEC: 'ESPECTRO', esq: 'ESQUERDO L', dir: 'DIREITO R',
      pico: 'Pico', b_espec: 'ESPECTRO', b_casc: 'CASCATA', b_pico: 'PICO', b_escala: 'ESCALA −80', b_tela: 'TELA', b_fechar: '✕ FECHAR', dlg: 'Medidores'},
  };
  const ops = {espectro: false, pico: true, e80: false, modo: 'LR', lingua: 'EN', ganhos: {rta: 0, vu: 0, cascata: 0}, gate: -80, cascata: true};
  try { const v = localStorage.getItem('sammed.lingua'); if (v === 'PT' || v === 'EN') ops.lingua = v; } catch (e) { /* sem armazenamento */ }
  const guarda = () => { try { localStorage.setItem('sammed.lingua', ops.lingua); } catch (e) { /* */ } };
  const T = k => (TX[ops.lingua] || TX.EN)[k] || TX.EN[k] || k;

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
      this.bL = new Float32Array(${NFFT}); this.bR = new Float32Array(${NFFT}); this.im = 0;
      this.gL = new Float32Array(${NGON}); this.gR = new Float32Array(${NGON}); this.ig = 0; this.par = 0;
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
        this.bL[this.im] = l; this.bR[this.im] = r; this.im = (this.im + 1) % ${NFFT};
        if ((this.par ^= 1)) { this.gL[this.ig] = l; this.gR[this.ig] = r; this.ig = (this.ig + 1) % ${NGON}; }
      }
    }
    tira() {
      const sl = new Float32Array(${NFFT}), sr = new Float32Array(${NFFT}), gl = new Float32Array(${NGON}), gr = new Float32Array(${NGON});
      for (let i = 0; i < ${NFFT}; i++) { const k = (this.im + i) % ${NFFT}; sl[i] = this.bL[k]; sr[i] = this.bR[k]; }
      for (let i = 0; i < ${NGON}; i++) { gl[i] = this.gL[(this.ig + i) % ${NGON}]; gr[i] = this.gR[(this.ig + i) % ${NGON}]; }
      const r = {blocos: this.blocos, pL: this.pL, pR: this.pR, tL: this.tL, tR: this.tR, lr: this.lr, ll: this.ll, rr: this.rr, sL: sl, sR: sr, gL: gl, gR: gr, fs: this.fs};
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

  // ---- o estado ----
  const agora = () => performance.now() / 1000;
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  const H = {e: new Float64Array(750), n: new Uint32Array(750)};
  let ult = [], tpMax = 0, L = null, rec = {v: -120, t: 0}, nMsg = 0;
  const vis = {vL: -120, vR: -120, hL: -120, hR: -120, thL: 0, thR: 0, corr: 0, bal: 0, oL: false, oR: false, oT: 0, antes: 0};
  function novoCanal() {
    return {rta: new Float64Array(NB).fill(-120), rp: new Float64Array(NB).fill(-120), rt: new Float64Array(NB), esp: null,
      auto: {b: -1, t: 0, db: -120}, man: null, wf: new Float32Array(NC * NR).fill(-200), wi: 0, oc: null, ox: null, lin: null, chave: ''};
  }
  const CH = {L: novoCanal(), R: novoCanal(), S: novoCanal()};
  const lufs = e => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -99);
  const db = a => (a > 1e-6 ? 20 * Math.log10(a) : -120);
  const media = n => { let s = 0; for (let i = ult.length - n; i < ult.length; i++) s += ult[i]; return s / n; };
  function repor(tudo) {
    H.e.fill(0); H.n.fill(0); ult = []; tpMax = 0; rec = {v: -120, t: 0};
    for (const k in CH) { const C = CH[k]; C.rp.fill(-120); C.rt.fill(0);
      if (tudo === true) { C.rta.fill(-120); C.auto = {b: -1, t: 0, db: -120}; C.man = null; C.esp = null; C.wf.fill(-200); C.wi = 0; C.chave = ''; } }
    if (tudo === true) { vis.vL = vis.vR = vis.hL = vis.hR = -120; vis.corr = vis.bal = 0; nMsg = 0; }
  }
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
  const pdb = v => (v > 1e-14 ? 10 * Math.log10(2 * v) : -140);
  function bandas(p, df) {
    const nb = p.length, g = Math.pow(2, 1 / 6);
    return BANDAS.map(f => {
      const k0 = Math.max(1, Math.ceil(f / g / df)), k1 = Math.min(nb - 1, Math.floor(f * g / df)); let s = 0;
      if (k1 < k0) { const k = Math.round(f / df); if (k >= 1 && k < nb) s = p[k]; } else for (let k = k0; k <= k1; k++) s += p[k];
      return pdb(s);
    });
  }
  const espDb = p => { const e = new Float64Array(p.length); for (let k = 0; k < p.length; k++) e[k] = pdb(p[k]); return e; };

  // ---- a cascata: anel de linhas em dB + uma tela escondida que desce uma linha (drawImage dela mesma + putImageData) ----
  const fCol = c => 20 * Math.pow(1000, (c + 0.5) / NC);
  let mapa = null, mapaFs = 0;
  function mapaCol(fs) {
    if (mapa && mapaFs === fs) return mapa;
    const df = fs / NFFT, nb = NFFT / 2; mapa = [];
    for (let c = 0; c < NC; c++) {
      const fa = 20 * Math.pow(1000, c / NC), fb = 20 * Math.pow(1000, (c + 1) / NC);
      if (fb - fa < df) { const kf = (fa + fb) / 2 / df, k = lim(Math.floor(kf), 1, nb - 2); mapa.push([0, k, lim(kf - k, 0, 1)]); }
      else mapa.push([1, Math.max(1, Math.floor(fa / df)), Math.min(nb - 1, Math.floor(fb / df))]);
    }
    mapaFs = fs; return mapa;
  }
  const PAL = [[0, 0, 0, 0], [0.14, 0, 0, 92], [0.32, 22, 72, 235], [0.52, 0, 205, 255], [0.72, 255, 228, 20], [0.88, 255, 140, 0], [1, 255, 255, 255]];
  const LUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { const t = i / 255; let s = 1; while (s < PAL.length - 1 && PAL[s][0] < t) s++;
    const a = PAL[s - 1], b = PAL[s], u = (t - a[0]) / (b[0] - a[0] || 1);
    for (let j = 0; j < 3; j++) LUT[i * 3 + j] = Math.round(a[j + 1] + (b[j + 1] - a[j + 1]) * u); }
  const chaveCasc = () => ops.gate + '|' + ops.ganhos.cascata;
  function pinta1(d, o, v) {
    const t = (v - ops.gate) / 60;
    if (t < 0) { d[o] = d[o + 1] = d[o + 2] = 0; } else { const i = Math.round(lim(t, 0, 1) * 255) * 3; d[o] = LUT[i]; d[o + 1] = LUT[i + 1]; d[o + 2] = LUT[i + 2]; }
    d[o + 3] = 255;
  }
  function linha(C, p, fs) {
    const m = mapaCol(fs); C.wi = (C.wi + 1) % NR; const base = C.wi * NC;
    for (let c = 0; c < NC; c++) { const q = m[c]; let v;
      if (!q[0]) v = pdb(p[q[1]]) * (1 - q[2]) + pdb(p[q[1] + 1]) * q[2];
      else { let mx = 0; for (let k = q[1]; k <= q[2]; k++) if (p[k] > mx) mx = p[k]; v = pdb(mx); }
      C.wf[base + c] = v; }
    if (C.oc && C.chave === chaveCasc()) {
      C.ox.drawImage(C.oc, 0, 0, NC, NR - 1, 0, 1, NC, NR - 1);
      if (!C.lin) C.lin = C.ox.createImageData(NC, 1);
      const g = ops.ganhos.cascata, d = C.lin.data; for (let c = 0; c < NC; c++) pinta1(d, c * 4, C.wf[base + c] + g);
      C.ox.putImageData(C.lin, 0, 0);
    }
  }
  function renderCasc(C) {
    if (!C.oc) { C.oc = document.createElement('canvas'); C.oc.width = NC; C.oc.height = NR; C.ox = C.oc.getContext('2d'); }
    const img = C.ox.createImageData(NC, NR), d = img.data, g = ops.ganhos.cascata;
    for (let a = 0; a < NR; a++) { const base = ((C.wi - a + NR) % NR) * NC; for (let c = 0; c < NC; c++) pinta1(d, (a * NC + c) * 4, C.wf[base + c] + g); }
    C.ox.putImageData(img, 0, 0); C.chave = chaveCasc();
  }

  function recebe(d) {
    for (const e of d.blocos) {
      ult.push(e); if (ult.length > 30) ult.shift();
      if (ult.length >= 4) { const m = media(4), l = lufs(m); if (l > -70) { const b = Math.min(749, Math.floor((l + 70) * 10)); H.e[b] += m; H.n[b]++; } }
    }
    tpMax = Math.max(tpMax, d.tL, d.tR);
    const sL = d.sL || d.mono, sR = d.sR || d.mono;
    const r1 = new Float64Array(NFFT), i1 = new Float64Array(NFFT), r2 = new Float64Array(NFFT), i2 = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) { r1[i] = sL[i] * JAN[i]; r2[i] = sR[i] * JAN[i]; }
    fft(r1, i1); fft(r2, i2);
    const nb = NFFT / 2, kp = 2 / (NFFT * SJ2), pl = new Float64Array(nb), pr = new Float64Array(nb), ps = new Float64Array(nb);
    for (let k = 1; k < nb; k++) {
      pl[k] = (r1[k] * r1[k] + i1[k] * i1[k]) * kp; pr[k] = (r2[k] * r2[k] + i2[k] * i2[k]) * kp;
      const a = (r1[k] + r2[k]) * 0.5, b = (i1[k] + i2[k]) * 0.5; ps[k] = (a * a + b * b) * kp;        // a soma (L+R)/2
    }
    const df = d.fs / NFFT;
    if ((++nMsg & 1) === 0) { linha(CH.L, pl, d.fs); linha(CH.R, pr, d.fs); linha(CH.S, ps, d.fs); }    // ~10 linhas/s
    const tn = db(Math.max(d.tL, d.tR)), t = agora();
    if (tn >= rec.v || t - rec.t > 1) { rec.v = tn; rec.t = t; }
    const dd = Math.sqrt(d.ll * d.rr);
    L = {pL: db(d.pL), pR: db(d.pR), tL: db(d.tL), tR: db(d.tR), tpMax: db(tpMax), rec: rec.v, mom: ult.length >= 4 ? lufs(media(4)) : -99,
      curto: ult.length >= 30 ? lufs(media(30)) : -99, integ: integrado(), corr: dd > 1e-9 ? d.lr / dd : 0,
      bal: d.ll > 1e-12 && d.rr > 1e-12 ? 10 * Math.log10(d.ll / d.rr) : 0,
      rta: bandas(ps, df), rtaL: bandas(pl, df), rtaR: bandas(pr, df),
      esp: ops.espectro ? espDb(ps) : null, espL: ops.espectro ? espDb(pl) : null, espR: ops.espectro ? espDb(pr) : null,
      gL: d.gL, gR: d.gR, fs: d.fs};
    balistica(L);
  }
  function balCanal(C, rta, esp, t, dt) {
    for (let b = 0; b < NB; b++) { const x = rta[b]; C.rta[b] = Math.max(x, C.rta[b] - 18 * dt);
      if (x >= C.rp[b]) { C.rp[b] = x; C.rt[b] = t; } else if (t - C.rt[b] > 1.5) C.rp[b] -= 10 * dt; }
    if (!esp) C.esp = null;
    else if (!C.esp || C.esp.length !== esp.length) C.esp = Float64Array.from(esp);
    else for (let k = 0; k < esp.length; k++) C.esp[k] = esp[k] > C.esp[k] ? esp[k] : C.esp[k] * 0.8 + esp[k] * 0.2;
    // AUTO PICO: a banda mais forte, com ~1 s de espera antes de mudar (salta logo se outra passar 3 dB acima)
    let m = 0; for (let b = 1; b < NB; b++) if (C.rta[b] > C.rta[m]) m = b;
    const a = C.auto;
    if (a.b < 0) { a.b = m; a.t = t; a.db = C.rta[m]; }
    else {
      if (m === a.b) a.t = t; else if (C.rta[m] > C.rta[a.b] + 3 || t - a.t > 1) { a.b = m; a.t = t; a.db = C.rta[m]; }
      a.db = a.db * 0.7 + C.rta[a.b] * 0.3;
    }
  }
  function balistica(r) {
    const t = agora(), dt = Math.min(0.2, vis.antes ? t - vis.antes : 0.05); vis.antes = t;
    const pl = Math.max(r.pL, r.tL), pr = Math.max(r.pR, r.tR);
    vis.vL = Math.max(pl, vis.vL - 24 * dt); vis.vR = Math.max(pr, vis.vR - 24 * dt);
    if (pl >= vis.hL) { vis.hL = pl; vis.thL = t; } else if (t - vis.thL > 2) vis.hL -= 12 * dt;
    if (pr >= vis.hR) { vis.hR = pr; vis.thR = t; } else if (t - vis.thR > 2) vis.hR -= 12 * dt;
    if (r.tL > -0.5) { vis.oL = true; vis.oT = t; } if (r.tR > -0.5) { vis.oR = true; vis.oT = t; }
    if (t - vis.oT > 3) vis.oL = vis.oR = false;
    balCanal(CH.S, r.rta, r.esp, t, dt); balCanal(CH.L, r.rtaL, r.espL, t, dt); balCanal(CH.R, r.rtaR, r.espR, t, dt);
    vis.corr = vis.corr * 0.8 + r.corr * 0.2; vis.bal = vis.bal * 0.8 + r.bal * 0.2;
  }
  // o que o ecra mostra (as provas leem isto)
  const rtaMostra = C => Array.from(C.rta, v => v + ops.ganhos.rta);
  function selecao(C, esp) {
    const t = agora();
    if (C.man && t - C.man.t > 5) C.man = null;
    const auto = !C.man; let b = auto ? (C.auto.b < 0 ? 17 : C.auto.b) : C.man.b, f = BANDAS[b], v;
    if (!esp) v = auto ? C.auto.db : C.rta[b];
    else {
      const df = L.fs / NFFT, n = C.esp.length;
      if (auto) { let k0 = lim(Math.ceil(f / 1.1225 / df), 1, n - 1), k1 = lim(Math.floor(f * 1.1225 / df), 1, n - 1);
        if (k1 < k0) k0 = k1 = lim(Math.round(f / df), 1, n - 1); let km = k0;
        for (let k = k0; k <= k1; k++) if (C.esp[k] > C.esp[km]) km = k; f = km * df; v = C.esp[km]; }
      else { f = C.man.f || f; v = C.esp[lim(Math.round(f / df), 1, n - 1)]; }
    }
    return {b, f, db: v, auto};
  }

  // ---- o desenho (tela virtual que enche o ecra: base 1200 x 560 deitado, 420 x 740 em pe') ----
  let cv = null, cx = null, esc = 1, deitado = true, nomeCanal = '', erro = '', zonas = [], areas = [], linguaPintada = '';
  const fmt = (v, c = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(c).replace('.', ops.lingua === 'PT' ? ',' : '.');
  const fmtS = (v, c = 1) => (v > 0.04 ? '+' : '') + fmt(v, c);
  const fmtG = v => (v > 0 ? '+' + v : v < 0 ? '−' + -v : '0');
  const fmtF = f => (f >= 1000 ? fmt(f / 1000, f >= 10000 ? 1 : 2) + ' kHz' : fmt(f, f % 1 ? 1 : 0) + ' Hz');
  const yDb = (d, y0, y1, min) => y0 + (y1 - y0) * lim(d / min, 0, 1);
  function texto(s, x, y, cor, tam, peso, al) { cx.fillStyle = cor; cx.font = (peso || '400') + ' ' + tam + 'px ' + FONTE; cx.textAlign = al || 'left'; cx.fillText(s, x, y); }
  function larg(s, tam, peso) { cx.font = (peso || '400') + ' ' + tam + 'px ' + FONTE; return cx.measureText(s).width; }
  function corta(s, mx, tam, peso) { if (larg(s, tam, peso) <= mx) return s; while (s.length > 1 && larg(s + '…', tam, peso) > mx) s = s.slice(0, -1); return s + '…'; }
  function painel(x, y, w, h) { cx.fillStyle = PAINEL; cx.fillRect(x, y, w, h); cx.strokeStyle = BORDA; cx.lineWidth = 1; cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  function botao(x, y, w, h, s, f) {
    cx.fillStyle = '#1d1f24'; cx.fillRect(x, y, w, h); cx.strokeStyle = '#4e5056'; cx.lineWidth = 1; cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    texto(s, x + w / 2, y + h / 2 + 4, '#e8eaed', Math.min(12, h - 6), '700', 'center');
    zonas.push({x: x - 4, y: y - 4, w: w + 8, h: h + 8, f});
  }
  function muda(k, d) {
    if (k === 'gate') ops.gate = lim(ops.gate + d, -120, -20);
    else ops.ganhos[k] = lim((ops.ganhos[k] || 0) + d, -30, 30);
  }
  // [GANHO +10 dB][▼][▲] alinhado a' direita em xr; devolve o x onde comeca
  function ganhoCtl(xr, y, k, compacto) {
    const bw = 20, bh = 16;
    botao(xr - bw, y - 12, bw, bh, '▲', () => muda(k, 10)); botao(xr - 2 * bw - 4, y - 12, bw, bh, '▼', () => muda(k, -10));
    const v = ops.ganhos[k], s = (compacto ? '' : T('GANHO') + ' ') + fmtG(v) + ' dB', x = xr - 2 * bw - 10;
    texto(s, x, y, v ? AMBAR : ROT, 10.5, '600', 'right');
    return x - larg(s, 10.5, '600');
  }
  function gateCtl(xr, y) {
    const bw = 20, bh = 16;
    botao(xr - bw, y - 12, bw, bh, '▶', () => muda('gate', 10)); botao(xr - 2 * bw - 4, y - 12, bw, bh, '◀', () => muda('gate', -10));
    const s = 'GATE ' + fmt(ops.gate, 0) + ' dB', x = xr - 2 * bw - 10;
    texto(s, x, y, ROT, 10.5, '600', 'right');
    return x - larg(s, 10.5, '600');
  }
  const tagTxt = (tag, curto) => (tag === 'S' ? 'L+R' : curto ? tag : T(tag === 'L' ? 'esq' : 'dir'));

  function desenha() {
    if (!cv) return;
    const W = cv.clientWidth, Hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W || !Hh) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    deitado = W >= Hh * 0.9;
    const baixo = deitado && Hh < 460;                       // telemovel deitado: base 420 de altura e o centro em duas colunas
    esc = !deitado ? Math.min(W / 420, Hh / 740) : baixo ? Math.min(Hh / 420, W / 1000) : Math.min(W / 1200, Hh / 560);
    const VW = W / esc, VH = Hh / esc, LR = ops.modo !== 'SOMA';
    cx.setTransform(dpr * esc, 0, 0, dpr * esc, 0, 0); cx.fillStyle = FUNDO; cx.fillRect(0, 0, VW, VH);
    zonas = []; areas = [];
    const ce = [ops.lingua, ops.modo, ops.espectro, ops.cascata, ops.pico, ops.e80].join('|');
    if (ce !== linguaPintada && pinta) { pinta(); linguaPintada = ce; }
    cabecalho(VW, LR);
    if (!L) { texto(T(erro || 'liga'), VW / 2, VH / 2, erro ? AMBAR : ROT, 18, '600', 'center'); return; }
    const P = 8, G = 8, top = 28, bot = VH - P, alt = bot - top;
    if (deitado) {
      if (LR && baixo) {
        const cw = lim(VW * 0.4, 460, 540), sw = (VW - 2 * P - cw - 2 * G) / 2, xc = P + sw + G, xr = xc + cw + G, ca = (cw - G) / 2;
        coluna(CH.L, P, top, sw, alt, 'L'); coluna(CH.R, xr, top, sw, alt, 'R');
        const hb = 48, hs = 84, hg = alt - hb - hs - 2 * G;
        gonio(xc, top, ca, hg); balanco(xc, top + hg + G, ca, hb); escalas(xc, bot - hs, ca, hs); numeros(xc + ca + G, top, ca, alt, 1);
      } else if (LR) {
        const cw = lim(VW * 0.25, 290, 360), sw = (VW - 2 * P - cw - 2 * G) / 2, xc = P + sw + G, xr = xc + cw + G;
        coluna(CH.L, P, top, sw, alt, 'L'); coluna(CH.R, xr, top, sw, alt, 'R');
        const hg = lim(alt * 0.27, 120, 200), hb = 48, hs = 84, hn = alt - hg - hb - hs - 3 * G;
        gonio(xc, top, cw, hg); numeros(xc, top + hg + G, cw, hn, 1); balanco(xc, top + hg + G + hn + G, cw, hb); escalas(xc, bot - hs, cw, hs);
      } else {
        const rw = lim(VW * 0.24, 270, 340), cw = lim(VW * 0.21, 240, 300), lw = VW - 2 * P - rw - cw - 2 * G, xc = P + lw + G, xr = xc + cw + G;
        coluna(CH.S, P, top, lw, alt, 'S'); numeros(xc, top, cw, alt, 1);
        const hg = lim(alt * 0.27, 120, 190), hb = 48, hs = 84, hv = alt - hg - hb - hs - 3 * G;
        gonio(xr, top, rw, hg); barrasLR(xr, top + hg + G, rw, hv); balanco(xr, top + hg + G + hv + G, rw, hb); escalas(xr, bot - hs, rw, hs);
      }
    } else {
      const lw = VW - 2 * P, w2 = (lw - G) / 2, hn = 4 * 40 + 3 * 4;
      numeros(P, top, lw, hn, 2);
      let y = top + hn + G;
      const hBot = 152, hvu = LR ? 2 * 26 + 4 : 26, livre = bot - y - hBot - hvu - (ops.cascata ? 3 : 2) * G;
      const hr = Math.round(ops.cascata ? livre * 0.5 : livre), hw = livre - (ops.cascata ? hr : livre);
      if (LR) { rta(CH.L, P, y, w2, hr, 'L'); rta(CH.R, P + w2 + G, y, w2, hr, 'R'); } else rta(CH.S, P, y, lw, hr, 'S');
      y += hr + G;
      if (LR) { vuH(P, y, lw, 26, 'L'); vuH(P, y + 30, lw, 26, 'R'); } else vuH(P, y, lw, 26, 'S');
      y += hvu + G;
      if (ops.cascata) { if (LR) { cascata(CH.L, P, y, w2, hw, 'L'); cascata(CH.R, P + w2 + G, y, w2, hw, 'R'); } else cascata(CH.S, P, y, lw, hw, 'S'); y += hw + G; }
      gonio(P, y, w2, hBot); balanco(P + w2 + G, y, w2, 48); escalas(P + w2 + G, y + 48 + 6, w2, hBot - 54);
    }
  }
  function cabecalho(VW, LR) {
    const tam = deitado ? 13 : 12, esq = (deitado ? T('titulo') : T('curto')) + ' · ' + (LR ? T('est') : T('soma'));
    texto(esq, 8, 18, '#e6e8eb', tam, '700');
    const x0 = 8 + larg(esq, tam, '700') + 16, mx = VW - 8 - x0;
    let dir, cor = AZUL;
    if (erro) { dir = '⚠ ' + T(erro); cor = AMBAR; } else dir = (nomeCanal || 'SAM FREE') + (L ? ' · ' + fmt(L.fs / 1000, L.fs % 1000 ? 1 : 0) + ' kHz' : '');
    if (mx > 30) texto(corta(dir, mx, tam, '700'), VW - 8, 18, cor, tam, '700', 'right');
  }
  function coluna(C, X, Y, Wd, Ht, tag) {
    const hv = 28, G = 8;
    if (ops.cascata) { const hr = Math.round((Ht - hv - 2 * G) * 0.5); rta(C, X, Y, Wd, hr, tag); vuH(X, Y + hr + G, Wd, hv, tag); cascata(C, X, Y + hr + G + hv + G, Wd, Ht - hr - hv - 2 * G, tag); }
    else { rta(C, X, Y, Wd, Ht - hv - G, tag); vuH(X, Y + Ht - hv, Wd, hv, tag); }
  }
  const MOSTRA = [[31.5, '31.5'], [63, '63'], [125, '125'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [4000, '4k'], [8000, '8k'], [16000, '16k']];
  const MOSTRA_C = [[63, '63'], [250, '250'], [1000, '1k'], [4000, '4k'], [16000, '16k']];
  function rta(C, X, Y, Wd, Ht, tag) {
    painel(X, Y, Wd, Ht);
    const estreito = Wd < 330, esp = ops.espectro && !!C.esp, soma = tag === 'S', g = ops.ganhos.rta;
    const tit = esp ? T('ESPEC') : estreito ? 'RTA' : 'RTA 1/3';
    texto(tit, X + 8, Y + 16, AZUL, 13, '700');
    const xg = ganhoCtl(X + Wd - 6, Y + 16, 'rta', estreito), wt = larg(tit, 13, '700');
    const tg = tagTxt(tag, estreito || xg - X - wt < 110);
    if (xg - 10 - larg(tg, 12, '700') > X + 8 + wt + 8) texto(tg, xg - 10, Y + 16, AZUL, 12, '700', 'right');
    // a linha de cima: Frequencia / Nivel (AUTO ou MANUAL)
    const s = selecao(C, esp), fs = fmtF(s.f), ds = (s.db > -119 ? fmt(s.db) : '—') + ' dB', md = s.auto ? 'AUTO' : 'MANUAL';
    let x = X + 8; const yl = Y + 33, tz = estreito ? 11 : 12;
    const parte = (t2, cor, p) => { texto(t2, x, yl, cor, tz, p); x += larg(t2, tz, p); };
    if (!estreito) { parte(T('FREQ') + ': ', '#fff'); parte(fs, AMAR, '700'); parte('    ' + T('NIVEL') + ': ', '#fff'); parte(ds, AMAR, '700'); parte('    ', '#fff'); }
    else { parte(fs, AMAR, '700'); parte(' · ', ROT); parte(ds, AMAR, '700'); parte(' · ', ROT); }
    parte(md, s.auto ? AZUL : AMBAR, '700');
    // o grafico
    const x0 = X + 32, x1 = X + Wd - 8, y0 = Y + 46, y1 = Y + Ht - 18, min = ops.e80 ? -80 : -60;
    if (y1 - y0 < 20) return;
    const passo = (y1 - y0) / (-min / 10) < 15 ? 20 : 10;
    cx.lineWidth = 1;
    for (let d = 0; d >= min; d -= passo) { const y = Math.round(yDb(d, y0, y1, min)) + 0.5; cx.strokeStyle = GRE; cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke(); texto(fmt(d, 0), x0 - 4, y + 4, ROT, 10, '', 'right'); }
    const fmin = 20, fmax = 20000, xf = f => x0 + (x1 - x0) * Math.log(f / fmin) / Math.log(fmax / fmin), lg = (x1 - x0) / NB;
    const marcas = Wd < 300 ? MOSTRA_C : MOSTRA;
    areas.push({C, x0, x1, y0: y0 - 8, y1: y1 + 14, esp, lg});
    cx.save(); cx.beginPath(); cx.rect(x0, y0 - 1, x1 - x0, y1 - y0 + 1); cx.clip();
    if (!esp) {
      const v = rtaMostra(C), gr = cx.createLinearGradient(0, y0, 0, y1);
      if (soma) { gr.addColorStop(0, AMAR); gr.addColorStop(1, AMAR_E); } else { gr.addColorStop(0, AZUL); gr.addColorStop(1, AZUL_E); }
      const bw = Math.max(1, lg - (lg > 8 ? 4 : 2));
      for (let b = 0; b < NB; b++) {
        const xb = x0 + b * lg + (lg - bw) / 2, y = yDb(v[b], y0, y1, min), sel = b === s.b;
        if (sel) { cx.fillStyle = 'rgba(255,149,0,.22)'; cx.fillRect(xb - 1, y0, bw + 2, y1 - y0); }
        if (y < y1) { cx.fillStyle = sel ? AMBAR : gr; cx.fillRect(xb, y, bw, y1 - y); }
        if (ops.pico && C.rp[b] + g > min) { const yp = yDb(C.rp[b] + g, y0, y1, min);
          if (soma) { cx.fillStyle = '#ebebeb'; cx.fillRect(xb + 1, yp - 4, bw - 2, 2); }
          else { cx.strokeStyle = AMAR; cx.strokeRect(xb + 0.5, yp + 0.5, bw - 1, y1 - yp - 1); } }
      }
    } else {
      const df = L.fs / NFFT, px = Math.round(x1 - x0), pts = [], e = C.esp;
      for (let i = 0; i <= px; i++) {
        const fa = fmin * Math.pow(fmax / fmin, i / px), fb = fmin * Math.pow(fmax / fmin, (i + 1) / px); let v = -140;
        if (fb - fa < df) { const kf = (fa + fb) / 2 / df, k = lim(Math.floor(kf), 1, e.length - 2), t = lim(kf - k, 0, 1); v = e[k] * (1 - t) + e[k + 1] * t; }
        else for (let k = Math.max(1, Math.floor(fa / df)); k <= Math.min(e.length - 1, Math.floor(fb / df)); k++) if (e[k] > v) v = e[k];
        pts.push([x0 + i, yDb(v + g, y0, y1, min)]);
      }
      cx.strokeStyle = '#1c1e22'; marcas.forEach(([f]) => { const xx = Math.round(xf(f)) + 0.5; cx.beginPath(); cx.moveTo(xx, y0); cx.lineTo(xx, y1); cx.stroke(); });
      const gr = cx.createLinearGradient(0, y0, 0, y1);
      if (soma) { gr.addColorStop(0, 'rgba(246,226,38,.66)'); gr.addColorStop(1, 'rgba(150,136,20,.12)'); } else { gr.addColorStop(0, 'rgba(79,195,247,.66)'); gr.addColorStop(1, 'rgba(29,79,154,.15)'); }
      cx.beginPath(); cx.moveTo(x0, y1); pts.forEach(p => cx.lineTo(p[0], p[1])); cx.lineTo(x0 + px, y1); cx.closePath(); cx.fillStyle = gr; cx.fill();
      cx.beginPath(); pts.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]))); cx.strokeStyle = soma ? AMAR : AZUL; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1;
      cx.strokeStyle = AMBAR; cx.setLineDash([4, 3]); cx.beginPath(); cx.moveTo(xf(s.f), y0); cx.lineTo(xf(s.f), y1); cx.stroke(); cx.setLineDash([]);
    }
    cx.restore();
    marcas.forEach(([f, t2]) => texto(t2, esp ? xf(f) : x0 + BANDAS.indexOf(f) * lg + lg / 2, y1 + 13, ROT, 10, '', 'center'));
  }
  function vuH(X, Y, Wd, Ht, tag) {
    painel(X, Y, Wd, Ht);
    const v = tag === 'L' ? vis.vL : tag === 'R' ? vis.vR : Math.max(vis.vL, vis.vR), h = tag === 'L' ? vis.hL : tag === 'R' ? vis.hR : Math.max(vis.hL, vis.hR);
    const g = ops.ganhos.vu, yc = Y + Ht / 2;
    texto(tag === 'S' ? 'L+R' : tag, X + 8, yc + 4.5, '#fff', 12, '700');
    let x0 = X + (tag === 'S' ? 40 : 26);
    if (g) { texto(fmtG(g), x0, yc + 4, AMBAR, 10, '700'); x0 += 26; }
    const xr = X + Wd - 6, bw = 18;
    botao(xr - bw, yc - 8, bw, 16, '▲', () => muda('vu', 10)); botao(xr - 2 * bw - 4, yc - 8, bw, 16, '▼', () => muda('vu', -10));
    const xn = xr - 2 * bw - 10, ns = (h > -119 ? fmtS(h) : '—') + ' dBTP';
    texto(ns, xn, yc + 4.5, h > -1 ? MAG : AMAR, 12, '700', 'right');
    const x1 = xn - 84, a = -60, b = 3, n = Math.max(10, Math.floor((x1 - x0) / 6)), lw = (x1 - x0) / n, sh = Math.min(14, Ht - 10);
    for (let i = 0; i < n; i++) {
      const dv = a + (i + 0.5) * (b - a) / n, real = dv - g, on = dv <= v + g;
      cx.fillStyle = on ? (real < -12 ? AZUL : real < -6 ? AMAR : real < -1 ? AMBAR : MAG) : (real < -1 ? '#16202a' : '#2a1630');
      cx.fillRect(x0 + i * lw + 0.5, yc - sh / 2, Math.max(1, lw - 1.5), sh);
    }
    if (ops.pico && h + g > a) { const xp = x0 + (x1 - x0) * lim((h + g - a) / (b - a), 0, 1); cx.fillStyle = h > -1 ? MAG : '#fff'; cx.fillRect(xp - 1, yc - sh / 2 - 2, 2.5, sh + 4); }
  }
  function cascata(C, X, Y, Wd, Ht, tag) {
    painel(X, Y, Wd, Ht);
    const estreito = Wd < 330;
    texto(T('CASC'), X + 8, Y + 16, '#e6e8eb', 12, '700');
    let xg = ganhoCtl(X + Wd - 6, Y + 16, 'cascata', estreito);
    if (Wd >= 420) xg = gateCtl(xg - 12, Y + 16);
    const tg = tagTxt(tag, true), wt = larg(T('CASC'), 12, '700');
    if (xg - 8 > X + 8 + wt + 8 + larg(tg, 12, '700')) texto(tg, X + 8 + wt + 8, Y + 16, AZUL, 12, '700');
    const x0 = X + 30, x1 = X + Wd - 16, y0 = Y + 24, y1 = Y + Ht - 16;
    if (y1 - y0 < 10) return;
    if (!C.oc || C.chave !== chaveCasc()) renderCasc(C);
    cx.imageSmoothingEnabled = true; cx.drawImage(C.oc, 0, 0, NC, NR, x0, y0, x1 - x0, y1 - y0);
    const xf = f => x0 + (x1 - x0) * Math.log(f / 20) / Math.log(1000);
    cx.strokeStyle = 'rgba(255,255,255,.13)'; cx.lineWidth = 1;
    (Wd < 300 ? MOSTRA_C : MOSTRA).forEach(([f, t2]) => { const x = Math.round(xf(f)) + 0.5; cx.beginPath(); cx.moveTo(x, y0); cx.lineTo(x, y1); cx.stroke(); texto(t2, x, y1 + 12, ROT, 10, '', 'center'); });
    const ps = (y1 - y0) < 110 ? 5 : 3;
    for (let sg = 0; sg <= NR / 10; sg += ps) texto(sg ? '−' + sg + 's' : '0s', x0 - 3, y0 + (y1 - y0) * sg / (NR / 10) + (sg ? 3 : 8), ROT, 9.5, '', 'right');
    const gr = cx.createLinearGradient(0, y0, 0, y1); for (let i = PAL.length - 1; i >= 0; i--) gr.addColorStop(1 - PAL[i][0], 'rgb(' + PAL[i].slice(1).join(',') + ')');
    cx.fillStyle = gr; cx.fillRect(x1 + 4, y0, 7, y1 - y0); cx.strokeStyle = '#3a3c40'; cx.strokeRect(x1 + 4.5, y0 + 0.5, 6, y1 - y0 - 1);
  }
  function cela(x, y, w, h, tit, v, un, ok, cor, dec) {
    painel(x, y, w, h);
    const s = ok ? (dec === 2 ? fmtS(v, 2) : un === 'dBTP' || un === 'dBFS' ? fmtS(v) : fmt(v)) : '—', c = ok ? cor : '#6b6e74';
    if (h >= 36) {
      texto(tit, x + 8, y + 13, ROT, 10.5);
      const fz = Math.min(30, h - 18), yb = Math.min(y + h - 7, y + 18 + (h - 18) / 2 + fz * 0.36);
      texto(s, x + 8, yb, c, fz, '700'); texto(un, x + 14 + larg(s, fz, '700'), yb, '#fff', 11, '700');
    } else {
      const fz = Math.min(22, h - 8), wu = larg(un, 11, '700');
      texto(un, x + w - 8, y + h / 2 + 5, '#fff', 11, '700', 'right');
      texto(s, x + w - 14 - wu, y + h / 2 + fz * 0.36, c, fz, '700', 'right');
      texto(corta(tit, w - 30 - wu - larg(s, fz, '700'), 10.5), x + 8, y + h / 2 + 4, ROT, 10.5);
    }
  }
  function numeros(X, Y, Wd, Ht, cols) {
    const okI = L.integ > -98, okT = L.tpMax > -119;
    const it = [[T('PROG'), L.integ, 'LUFS', okI, AMBAR], [T('LKFS'), L.integ, 'LKFS', okI, AMBAR],
      [T('TP'), L.tpMax, 'dBTP', okT, L.tpMax > -1 ? MAG : AMAR], [T('REC'), L.rec, 'dBFS', L.rec > -119, L.rec > -1 ? MAG : AMAR],
      [T('PLR'), L.tpMax - L.integ, 'LU', okI && okT, '#d8dade'], [T('CURTO'), L.curto, 'LUFS', L.curto > -98, AZUL], [T('MOM'), L.mom, 'LUFS', L.mom > -98, AZUL]];
    if (cols === 2) it.push([T('CORR'), vis.corr, '', true, vis.corr < 0 ? AMBAR : AZUL, 2]);
    const g = cols === 2 ? 4 : 3, nl = Math.ceil(it.length / cols), h = (Ht - (nl - 1) * g) / nl, w = (Wd - (cols - 1) * 4) / cols;
    it.forEach((q, i) => cela(X + (i % cols) * (w + 4), Y + Math.floor(i / cols) * (h + g), w, h, q[0], q[1], q[2], q[3], q[4], q[5]));
  }
  function segmentos(x0, x1, y, h, v, a, b, corNeg) {
    const n = 21, meio = 10, lw = (x1 - x0) / n, iv = Math.round(lim((v - a) / (b - a), 0, 1) * (n - 1));
    for (let i = 0; i < n; i++) { const on = (iv >= meio && i >= meio && i <= iv) || (iv < meio && i <= meio && i >= iv);
      cx.fillStyle = on ? (i < meio && corNeg ? corNeg : AZUL) : '#34363b'; cx.fillRect(x0 + i * lw + 1, y - (i === meio ? 2 : 0), lw - 2, h + (i === meio ? 4 : 0)); }
  }
  function gonio(X, Y, Wd, Ht) {
    painel(X, Y, Wd, Ht);
    const c = vis.corr < 0 ? AMBAR : AZUL, cs = fmtS(vis.corr, 2);
    const tg = T('CORR') + ' · ' + T('MS'), mt = Wd - 24 - larg(cs, 12, '700');
    texto(corta(larg(tg, 12, '700') <= mt ? tg : T('CORR'), mt, 12, '700'), X + 8, Y + 16, '#e6e8eb', 12, '700');
    texto(cs, X + Wd - 8, Y + 16, c, 12, '700', 'right');
    const by = Y + Ht - 24; segmentos(X + 10, X + Wd - 10, by, 7, vis.corr, -1, 1, AMBAR);
    texto('−1', X + 10, by + 19, ROT, 9.5); texto('0', X + Wd / 2, by + 19, ROT, 9.5, '', 'center'); texto('+1', X + Wd - 10, by + 19, ROT, 9.5, '', 'right');
    const gx = X + Wd / 2, gy = by - 8, rr = Math.max(16, Math.min(Wd / 2 - 24, gy - (Y + 36)));
    cx.strokeStyle = '#8a8d92'; cx.lineWidth = 1; cx.beginPath(); cx.arc(gx, gy, rr, Math.PI, 2 * Math.PI); cx.stroke();
    cx.strokeStyle = '#3c3e43'; cx.beginPath(); cx.moveTo(gx - rr, gy); cx.lineTo(gx + rr, gy); cx.moveTo(gx, gy); cx.lineTo(gx, gy - rr);
    cx.moveTo(gx, gy); cx.lineTo(gx - rr * 0.7071, gy - rr * 0.7071); cx.moveTo(gx, gy); cx.lineTo(gx + rr * 0.7071, gy - rr * 0.7071); cx.stroke();
    texto('M', gx, gy - rr - 4, ROT, 10, '', 'center'); texto('L', gx - rr * 0.7071 - 4, gy - rr * 0.7071 - 2, ROT, 10, '', 'right'); texto('R', gx + rr * 0.7071 + 4, gy - rr * 0.7071 - 2, ROT, 10);
    let mx = 1e-4; for (let i = 0; i < NGON; i++) mx = Math.max(mx, Math.abs(L.gL[i]), Math.abs(L.gR[i]));
    const k = rr / Math.max(0.05, mx) * 0.7; cx.fillStyle = 'rgba(246,226,38,.6)';
    for (let i = 0; i < NGON; i++) { let m = (L.gL[i] + L.gR[i]) * 0.7071, s = (L.gL[i] - L.gR[i]) * 0.7071; if (m < 0) { m = -m; s = -s; }
      const x = gx - s * k, y = gy - m * k; if (Math.abs(x - gx) <= rr && gy - y <= rr) cx.fillRect(x, y, 1.6, 1.6); }
  }
  function balanco(X, Y, Wd, Ht) {
    painel(X, Y, Wd, Ht);
    const b = vis.bal, s = (b > 0.05 ? 'L ' + fmt(b) : b < -0.05 ? 'R ' + fmt(-b) : fmt(0)) + ' dB';
    texto(T('BAL'), X + 8, Y + 16, '#e6e8eb', 12, '700'); texto(s, X + Wd - 8, Y + 16, AMBAR, 12, '700', 'right');
    segmentos(X + 10, X + Wd - 10, Y + 23, 7, -b, -4, 4);
    texto('L 4', X + 10, Y + Ht - 4, ROT, 9.5); texto('0', X + Wd / 2, Y + Ht - 4, ROT, 9.5, '', 'center'); texto('R 4', X + Wd - 10, Y + Ht - 4, ROT, 9.5, '', 'right');
  }
  function escalas(X, Y, Wd, Ht) {
    painel(X, Y, Wd, Ht);
    texto(T('ESC'), X + 8, Y + 16, '#e6e8eb', 12, '700');
    const col = [['RTA', 'rta'], ['VU', 'vu'], [T('CASC_C'), 'cascata'], ['GATE', 'gate']], cw = (Wd - 16) / 4;
    const bh = lim(Ht - 58, 16, 24), bw = lim((cw - 10) / 2, 16, 30);
    col.forEach(([n, k], i) => {
      const x = X + 8 + i * cw, v = k === 'gate' ? ops.gate : ops.ganhos[k];
      texto(n, x, Y + 32, ROT, 10); texto((k === 'gate' ? fmt(v, 0) : fmtG(v)) + ' dB', x, Y + 47, k === 'gate' || v ? AMBAR : '#e6e8eb', 11.5, '700');
      const yb = Y + 53;
      if (k === 'gate') { botao(x, yb, bw, bh, '◀', () => muda('gate', -10)); botao(x + bw + 4, yb, bw, bh, '▶', () => muda('gate', 10)); }
      else { botao(x, yb, bw, bh, '▼', () => muda(k, -10)); botao(x + bw + 4, yb, bw, bh, '▲', () => muda(k, 10)); }
    });
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
  function barrasLR(X, Y, Wd, Ht) {
    painel(X, Y, Wd, Ht);
    const g = ops.ganhos.vu, y0 = Y + 30, y1 = Y + Ht - 12, min = -60, w = 26, xl = X + 46, xr = xl + w + 10;
    texto('dBTP', X + 8, Y + 16, ROT, 10.5); texto('L', xl + w / 2, y0 - 6, '#fff', 11, '700', 'center'); texto('R', xr + w / 2, y0 - 6, '#fff', 11, '700', 'center');
    const passo = (y1 - y0) < 90 ? 20 : (y1 - y0) < 150 ? 12 : 6;
    for (let d = 0; d >= min; d -= passo) { const y = yDb(d, y0, y1, min); texto(fmt(d, 0), X + 32, y + 4, ROT, 10, '', 'right'); cx.strokeStyle = GRE; cx.beginPath(); cx.moveTo(X + 36, y); cx.lineTo(X + 42, y); cx.stroke(); }
    barra(xl, y0, y1, w, vis.vL + g, vis.hL + g, min); barra(xr, y0, y1, w, vis.vR + g, vis.hR + g, min);
    const px = xr + w + 24;
    texto(T('pico'), px + 22, Y + 28, '#fff', 12, '600', 'center');
    texto('L', px + 7, Y + 46, ROT, 10, '', 'center'); texto('R', px + 37, Y + 46, ROT, 10, '', 'center');
    cx.fillStyle = vis.oL ? MAG : '#461e4a'; cx.fillRect(px, Y + 51, 14, 10); cx.fillStyle = vis.oR ? MAG : '#461e4a'; cx.fillRect(px + 30, Y + 51, 14, 10);
    texto('> −0.5 dBTP', px + 22, Y + 76, ROT, 9.5, '', 'center');
    if (g) texto(T('GANHO') + ' ' + fmtG(g) + ' dB', px + 22, Y + 94, AMBAR, 10, '700', 'center');
  }

  // ---- o toque e o rato: botoes desenhados, escolher a banda, toque duplo = AUTO ----
  let ultToque = {t: 0, a: null}, ignora = 0;
  const virt = ev => { const r = cv.getBoundingClientRect(); return {x: (ev.clientX - r.left) / esc, y: (ev.clientY - r.top) / esc}; };
  const dentro = (p, a) => p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1;
  function aponta(p) {
    for (const a of areas) if (dentro(p, a)) {
      const f = 20 * Math.pow(1000, lim((p.x - a.x0) / (a.x1 - a.x0), 0, 1)); let b;
      if (a.esp) { let m = 1e9; BANDAS.forEach((fb, i) => { const d = Math.abs(Math.log(fb / f)); if (d < m) { m = d; b = i; } }); }
      else b = lim(Math.floor((p.x - a.x0) / a.lg), 0, NB - 1);
      a.C.man = {b, f: a.esp ? f : BANDAS[b], t: agora()};
      return a;
    }
    return null;
  }

  // ---- o audio (a copia medida) ----
  let ctx = null, au = null, no = null, sp = null, dsp = null, raf = 0, url = '', aberto = false, cai = 0;
  async function liga(u) {
    url = u || ''; L = null; erro = ''; repor();
    if (!au) return;
    au.removeAttribute('src'); try { au.load(); } catch (e) { /* */ }
    if (!url) { erro = 'e_nao'; return; }
    au.src = url;
    try { await au.play(); } catch (e) { erro = 'e_ler'; }
  }
  async function montaAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { erro = 'e_nav'; return; }
    ctx = new AC(); try { await ctx.resume(); } catch (e) { /* */ }
    au = new Audio(); au.crossOrigin = 'anonymous'; au.preload = 'none';
    au.addEventListener('error', () => { if (!aberto || !au.getAttribute('src')) return; erro = 'e_cai'; clearTimeout(cai); cai = setTimeout(() => aberto && liga(url), 5000); });
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
  let cx0 = null, pinta = null;
  function monta() {
    if (cx0) return;
    const st = document.createElement('style');
    st.textContent = `#sammed{position:fixed;inset:0;z-index:9999;background:${FUNDO};display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
#sammed canvas{flex:1;width:100%;min-height:0;display:block;touch-action:none}
#sammed .bt{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:6px 8px 8px;background:linear-gradient(180deg,#232428,#141517)}
#sammed button{flex:0 0 auto;min-width:64px;min-height:38px;padding:0 12px;border-radius:19px;border:1.5px solid #4e5056;background:linear-gradient(180deg,#2c2d31,#0c0c0e);color:#bec2c8;font:600 12.5px system-ui,-apple-system,Roboto,sans-serif;letter-spacing:.04em;cursor:pointer;white-space:nowrap}
#sammed button[aria-pressed=true]{color:${AMAR};border-color:#8a7f1a}
#sammed button .on{color:${AMAR}}
#sammed button.x{color:#fff;border-color:${AZUL}}
#sammed button:focus-visible{outline:2px solid #fff;outline-offset:2px}
@media (max-height:480px){#sammed .bt{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;padding:4px 8px 5px}#sammed button{min-height:34px;min-width:0}}`;
    document.head.appendChild(st);
    cx0 = document.createElement('div'); cx0.id = 'sammed'; cx0.hidden = true;
    cx0.setAttribute('role', 'dialog');
    cv = document.createElement('canvas'); cx = cv.getContext('2d');
    const bt = document.createElement('div'); bt.className = 'bt';
    const par = (a, b, primeiro) => (primeiro ? '<span class="on">' + a + '</span> / ' + b : a + ' / <span class="on">' + b + '</span>');
    const B = (t, f, p, cls) => { const b = document.createElement('button'); b.type = 'button'; b._t = t; b.onclick = () => { f(); pinta(); }; b._p = p; if (cls) b.className = cls; bt.appendChild(b); return b; };
    B(() => par('L|R', 'L+R', ops.modo !== 'SOMA'), () => (ops.modo = ops.modo === 'SOMA' ? 'LR' : 'SOMA'));
    B(() => 'RTA', () => (ops.espectro = false), () => !ops.espectro);
    B(() => T('b_espec'), () => (ops.espectro = true), () => ops.espectro);
    B(() => T('b_casc'), () => (ops.cascata = !ops.cascata), () => ops.cascata);
    B(() => 'RESET', () => repor());
    B(() => T('b_pico'), () => (ops.pico = !ops.pico), () => ops.pico);
    B(() => T('b_escala'), () => (ops.e80 = !ops.e80), () => ops.e80);
    B(() => T('b_tela'), () => { const d = document; if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d); else cheia(); }, () => !!(document.fullscreenElement || document.webkitFullscreenElement));
    B(() => par('EN', 'PT', ops.lingua !== 'PT'), () => { ops.lingua = ops.lingua === 'PT' ? 'EN' : 'PT'; guarda(); });
    B(() => T('b_fechar'), () => window.SAMMED.fechar(), null, 'x');
    pinta = () => {
      [...bt.children].forEach(b => { b.innerHTML = b._t(); if (b._p) b.setAttribute('aria-pressed', String(!!b._p())); });
      cx0.setAttribute('aria-label', T('dlg'));
    };
    document.addEventListener('fullscreenchange', pinta);
    cv.addEventListener('pointerdown', ev => {
      const p = virt(ev), t = agora();
      for (let i = zonas.length - 1; i >= 0; i--) { const z = zonas[i]; if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) { z.f(); ultToque.t = 0; return; } }
      const a = areas.find(q => dentro(p, q));
      if (a && ultToque.a === a.C && t - ultToque.t < 0.4) { a.C.man = null; ultToque.t = 0; ignora = t + 0.6; return; }    // toque duplo: AUTO
      if (t < ignora) return;
      aponta(p); ultToque = {t, a: a ? a.C : null};
    });
    cv.addEventListener('pointermove', ev => { if (agora() < ignora) return; if (ev.pointerType === 'mouse' || ev.buttons) aponta(virt(ev)); });
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
    // para as provas: o mesmo DSP fora do audio e o que o ecra mostra
    _DSP: fs => { const C = (new Function(DSP + '; return MedDSP;'))(); return new C(fs); },
    _recebe: d => recebe(d), _ler: () => L, _repor: repor, _ops: ops,
    _vista: c => rtaMostra(CH[c] || CH.S),
    _auto: c => { const C = CH[c] || CH.S, s = selecao(C, false); return {f: s.f, b: s.b, db: s.db, auto: s.auto}; },
    _cascata: c => { const C = CH[c] || CH.S, g = ops.ganhos.cascata, b = C.wi * NC, v = [], f = [];
      for (let i = 0; i < NC; i++) { v.push(C.wf[b + i] + g); f.push(fCol(i)); } return {v, f, gate: ops.gate}; },
    _desenha: () => desenha(),
  };
})();
