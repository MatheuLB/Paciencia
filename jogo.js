"use strict";

// ===== Configuração =====
const TEXTO = String.fromCharCode(0xfe0e); // impede o iPhone de desenhar ♥ e ♦ como emoji
const NAIPES = ["♠", "♥", "♦", "♣"].map((s) => s + TEXTO);
const NOMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const NOMES_NIVEL = { 1: "Fácil · vira 1 carta", 3: "Difícil · vira 3 cartas" };
const CHAVE_JOGO = "paciencia-jogo";
const CHAVE_VITORIAS = "paciencia-vitorias";
const LIMITE_HISTORICO = 400;
const HISTORICO_SALVO = 40;
const DISTANCIA_ARRASTO = 8;

// ===== Estado =====
const mesa = document.getElementById("mesa");
const elCartas = [];
const elVagas = {};
let jogo = null;
let historico = [];
let medidas = null;
let ultimasPos = new Map();
let arrasto = null;
let autoTimer = null;
let avisoTimer = null;

// ===== Cartas e regras =====
const naipe = (n) => Math.floor(n / 13);
const valor = (n) => (n % 13) + 1;
const vermelha = (n) => naipe(n) === 1 || naipe(n) === 2;

function embaralhar() {
  const b = [...Array(52).keys()];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function pilha(loc) {
  if (loc.tipo === "monte") return jogo.monte;
  if (loc.tipo === "descarte") return jogo.descarte;
  if (loc.tipo === "fund") return jogo.fundacoes[loc.i];
  return jogo.colunas[loc.i];
}

function localizar(n) {
  const procurar = (lista, loc) => {
    const idx = lista.findIndex((c) => c.n === n);
    return idx >= 0 ? { ...loc, idx } : null;
  };
  return (
    procurar(jogo.monte, { tipo: "monte" }) ||
    procurar(jogo.descarte, { tipo: "descarte" }) ||
    jogo.fundacoes.map((f, i) => procurar(f, { tipo: "fund", i })).find(Boolean) ||
    jogo.colunas.map((c, i) => procurar(c, { tipo: "col", i })).find(Boolean)
  );
}

function podeMexer(loc) {
  const p = pilha(loc);
  if (loc.tipo === "col") return p[loc.idx].aberta;
  return (loc.tipo === "descarte" || loc.tipo === "fund") && loc.idx === p.length - 1;
}

function podeIrFundacao(n, f) {
  return naipe(n) === f && valor(n) === jogo.fundacoes[f].length + 1;
}

function podeIrColuna(n, c) {
  const col = jogo.colunas[c];
  if (!col.length) return valor(n) === 13;
  const topo = col[col.length - 1];
  return topo.aberta && vermelha(topo.n) !== vermelha(n) && valor(topo.n) === valor(n) + 1;
}

function destinoValido(loc, dest) {
  const p = pilha(loc);
  const n = p[loc.idx].n;
  if (dest.tipo === "fund") return loc.tipo !== "fund" && p.length - loc.idx === 1 && podeIrFundacao(n, dest.i);
  if (dest.tipo === "col") return !(loc.tipo === "col" && loc.i === dest.i) && podeIrColuna(n, dest.i);
  return false;
}

// Para onde a carta vai com um toque: primeiro a pilha do naipe, depois outra coluna.
function melhorDestino(loc) {
  const n = pilha(loc)[loc.idx].n;
  const fund = { tipo: "fund", i: naipe(n) };
  if (destinoValido(loc, fund)) return fund;
  const inicio = loc.tipo === "col" ? loc.i + 1 : 0;
  const reiJaNoFundo = loc.tipo === "col" && loc.idx === 0;
  let vazia = null;
  for (let k = 0; k < 7; k++) {
    const dest = { tipo: "col", i: (inicio + k) % 7 };
    if (!destinoValido(loc, dest)) continue;
    if (jogo.colunas[dest.i].length) return dest;
    if (!vazia && !reiJaNoFundo) vazia = dest;
  }
  return vazia;
}

// ===== Jogadas =====
function novoJogo(nivel) {
  pararAuto();
  const b = embaralhar();
  const colunas = [];
  for (let c = 0; c < 7; c++) {
    const col = [];
    for (let r = 0; r <= c; r++) col.push({ n: b.pop(), aberta: r === c });
    colunas.push(col);
  }
  jogo = { nivel, monte: b.map((n) => ({ n, aberta: false })), descarte: [], fundacoes: [[], [], [], []], colunas, venceu: false };
  historico = [];
  depoisDaJogada();
}

function guardarHistorico() {
  historico.push(JSON.stringify(jogo));
  if (historico.length > LIMITE_HISTORICO) historico.shift();
}

function comprar() {
  if (!jogo.monte.length && !jogo.descarte.length) return;
  guardarHistorico();
  if (!jogo.monte.length) {
    jogo.monte = jogo.descarte.reverse().map((c) => ({ n: c.n, aberta: false }));
    jogo.descarte = [];
  } else {
    const qtd = Math.min(jogo.nivel, jogo.monte.length);
    for (let i = 0; i < qtd; i++) {
      const c = jogo.monte.pop();
      c.aberta = true;
      jogo.descarte.push(c);
    }
  }
  depoisDaJogada();
}

function mover(loc, dest) {
  guardarHistorico();
  const origem = pilha(loc);
  pilha(dest).push(...origem.splice(loc.idx));
  const topo = origem[origem.length - 1];
  if (loc.tipo === "col" && topo) topo.aberta = true;
  depoisDaJogada();
}

function desfazer() {
  if (!historico.length || autoTimer) return;
  jogo = JSON.parse(historico.pop());
  depoisDaJogada();
}

function depoisDaJogada() {
  salvarJogo();
  desenhar();
  if (!jogo.venceu && jogo.fundacoes.every((f) => f.length === 13)) {
    pararAuto();
    jogo.venceu = true;
    salvarJogo();
    registrarVitoria();
    setTimeout(mostrarVitoria, 600);
  } else if (podeTerminarSozinho()) {
    iniciarAuto();
  }
}

// Quando todas as cartas estão abertas, o jogo termina sozinho.
function podeTerminarSozinho() {
  return !jogo.venceu && !jogo.monte.length && !jogo.descarte.length && jogo.colunas.every((col) => col.every((c) => c.aberta));
}

function iniciarAuto() {
  if (!autoTimer) autoTimer = setInterval(passoAuto, 150);
}

function pararAuto() {
  clearInterval(autoTimer);
  autoTimer = null;
}

function passoAuto() {
  let melhor = null;
  jogo.colunas.forEach((col, i) => {
    if (!col.length) return;
    const n = col[col.length - 1].n;
    if (podeIrFundacao(n, naipe(n)) && (!melhor || valor(n) < melhor.v)) melhor = { i, idx: col.length - 1, v: valor(n) };
  });
  if (!melhor) return pararAuto();
  mover({ tipo: "col", i: melhor.i, idx: melhor.idx }, { tipo: "fund", i: naipe(jogo.colunas[melhor.i][melhor.idx].n) });
}

// ===== Dica =====
function acharDica() {
  const topos = [];
  if (jogo.descarte.length) topos.push({ tipo: "descarte", idx: jogo.descarte.length - 1 });
  jogo.colunas.forEach((col, i) => col.length && topos.push({ tipo: "col", i, idx: col.length - 1 }));
  const praFundacao = topos.find((loc) => {
    const n = pilha(loc)[loc.idx].n;
    return podeIrFundacao(n, naipe(n));
  });
  if (praFundacao) return praFundacao;

  for (let i = 0; i < 7; i++) {
    const col = jogo.colunas[i];
    const idx = col.findIndex((c) => c.aberta);
    if (idx < 0 || (idx === 0 && valor(col[0].n) === 13)) continue;
    const loc = { tipo: "col", i, idx };
    if (melhorDestino(loc)) return loc;
  }

  if (jogo.descarte.length) {
    const loc = { tipo: "descarte", idx: jogo.descarte.length - 1 };
    if (melhorDestino(loc)) return loc;
  }
  if (jogo.monte.length || jogo.descarte.length) return { tipo: "monte" };
  return null;
}

function mostrarDica() {
  if (autoTimer || jogo.venceu) return;
  const loc = acharDica();
  if (!loc) return avisar("Não há mais jogadas. Toque em Novo jogo.");
  let alvos;
  if (loc.tipo === "monte") {
    alvos = jogo.monte.length ? [elCartas[jogo.monte[jogo.monte.length - 1].n]] : [elVagas.monte];
    avisar(jogo.monte.length ? "Toque no monte para virar cartas." : "Toque no monte para recomeçar as cartas.");
  } else {
    alvos = pilha(loc).slice(loc.idx).map((c) => elCartas[c.n]);
  }
  alvos.forEach((el) => el.classList.add("dica"));
  setTimeout(() => alvos.forEach((el) => el.classList.remove("dica")), 1800);
}

// ===== Desenho =====
function medir() {
  const r = mesa.getBoundingClientRect();
  const g = Math.max(3, Math.round(r.width * 0.012));
  const cw = Math.floor(Math.min((r.width - g * 8) / 7, r.height / (1.4 * 4.2), 104));
  const ch = Math.round(cw * 1.4);
  const x0 = (r.width - (cw * 7 + g * 6)) / 2;
  medidas = { altura: r.height, g, cw, ch, x0, y0: g, yCol: g * 4 + ch };
  mesa.style.setProperty("--cw", cw + "px");
  mesa.style.setProperty("--ch", ch + "px");
  posicionarVagas();
}

const xColuna = (c) => medidas.x0 + c * (medidas.cw + medidas.g);

// Encolhe o espaço entre as cartas quando a coluna não cabe na tela.
function espacos(col) {
  const { ch, altura, yCol, g } = medidas;
  const base = col.map((c) => (c.aberta ? ch * 0.3 : ch * 0.13));
  const soma = base.slice(0, -1).reduce((a, b) => a + b, 0);
  const cabe = altura - yCol - ch - g;
  const fator = soma > cabe && soma > 0 ? cabe / soma : 1;
  return base.map((b) => b * fator);
}

function posicoes() {
  const { cw, y0, yCol } = medidas;
  const pos = new Map();
  jogo.monte.forEach((c, i) => pos.set(c.n, { x: xColuna(0), y: y0, z: 1 + i, aberta: false }));

  const visiveis = jogo.nivel === 3 ? 3 : 1;
  const inicio = Math.max(0, jogo.descarte.length - visiveis);
  jogo.descarte.forEach((c, i) => {
    const leque = Math.max(0, i - inicio) * cw * 0.34;
    pos.set(c.n, { x: xColuna(1) + leque, y: y0, z: 200 + i, aberta: true });
  });

  jogo.fundacoes.forEach((f, i) => f.forEach((c, j) => pos.set(c.n, { x: xColuna(3 + i), y: y0, z: 300 + j, aberta: true })));

  jogo.colunas.forEach((col, i) => {
    const esp = espacos(col);
    let y = yCol;
    col.forEach((c, j) => {
      pos.set(c.n, { x: xColuna(i), y, z: 100 + j, aberta: c.aberta });
      y += esp[j];
    });
  });
  return pos;
}

function desenhar() {
  ultimasPos = posicoes();
  ultimasPos.forEach((p, n) => {
    const el = elCartas[n];
    el.classList.remove("arrastando");
    el.classList.toggle("virada", !p.aberta);
    el.style.zIndex = p.z;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  });
  elVagas.monte.textContent = !jogo.monte.length && jogo.descarte.length ? "↻" : "";
  document.getElementById("botao-desfazer").disabled = !historico.length;
  document.getElementById("nivel").textContent = NOMES_NIVEL[jogo.nivel];
}

function criarCartas() {
  for (let n = 0; n < 52; n++) {
    const el = document.createElement("div");
    el.className = "carta virada " + (vermelha(n) ? "vermelha" : "preta");
    el.dataset.n = n;
    el.innerHTML = `<span class="canto"><b>${NOMES[valor(n)]}</b><i>${NAIPES[naipe(n)]}</i></span><span class="centro">${NAIPES[naipe(n)]}</span>`;
    mesa.appendChild(el);
    elCartas[n] = el;
  }
}

function criarVagas() {
  const criar = (id, texto) => {
    const el = document.createElement("div");
    el.className = "vaga";
    el.dataset.vaga = id;
    el.textContent = texto;
    mesa.appendChild(el);
    elVagas[id] = el;
  };
  criar("monte", "");
  for (let i = 0; i < 4; i++) criar("fund-" + i, NAIPES[i]);
  for (let i = 0; i < 7; i++) criar("col-" + i, "");
}

function posicionarVagas() {
  const { y0, yCol } = medidas;
  const colocar = (id, x, y) => (elVagas[id].style.transform = `translate(${x}px, ${y}px)`);
  colocar("monte", xColuna(0), y0);
  for (let i = 0; i < 4; i++) colocar("fund-" + i, xColuna(3 + i), y0);
  for (let i = 0; i < 7; i++) colocar("col-" + i, xColuna(i), yCol);
}

function balancar(ids) {
  ids.forEach((id) => {
    const el = elCartas[id];
    el.classList.remove("nao");
    void el.offsetWidth;
    el.classList.add("nao");
  });
}

// ===== Toque e arrasto =====
function aoApertar(e) {
  if (autoTimer || arrasto || !jogo || jogo.venceu) return;
  const el = e.target.closest(".carta, .vaga");
  if (!el) return;
  if (el.classList.contains("vaga")) {
    if (el.dataset.vaga === "monte") comprar();
    return;
  }
  const loc = localizar(+el.dataset.n);
  if (loc.tipo === "monte") return comprar();
  if (!podeMexer(loc)) return;
  const ids = pilha(loc).slice(loc.idx).map((c) => c.n);
  arrasto = { loc, ids, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moveu: false };
  mesa.setPointerCapture(e.pointerId);
}

function aoArrastar(e) {
  if (!arrasto) return;
  const dx = e.clientX - arrasto.x;
  const dy = e.clientY - arrasto.y;
  if (!arrasto.moveu && Math.hypot(dx, dy) < DISTANCIA_ARRASTO) return;
  arrasto.moveu = true;
  arrasto.dx = dx;
  arrasto.dy = dy;
  arrasto.ids.forEach((id, k) => {
    const p = ultimasPos.get(id);
    const el = elCartas[id];
    el.classList.add("arrastando");
    el.style.zIndex = 1000 + k;
    el.style.transform = `translate(${p.x + dx}px, ${p.y + dy}px)`;
  });
}

function aoSoltar() {
  if (!arrasto) return;
  const a = arrasto;
  arrasto = null;
  if (!a.moveu) {
    const dest = melhorDestino(a.loc);
    return dest ? mover(a.loc, dest) : balancar(a.ids);
  }
  const p = ultimasPos.get(a.ids[0]);
  const dest = destinoNoPonto(p.x + a.dx + medidas.cw / 2, p.y + a.dy + medidas.ch / 2, a.loc);
  if (dest && destinoValido(a.loc, dest)) mover(a.loc, dest);
  else desenhar();
}

function aoCancelar() {
  arrasto = null;
  desenhar();
}

function destinoNoPonto(cx, cy, loc) {
  const { cw, g, x0, yCol } = medidas;
  const c = Math.floor((cx - x0 + g / 2) / (cw + g));
  if (c < 0 || c > 6) return null;
  if (cy >= yCol - g) return { tipo: "col", i: c };
  return c >= 3 ? { tipo: "fund", i: naipe(pilha(loc)[loc.idx].n) } : null;
}

// ===== Janelas e avisos =====
function abrirEscolha(podeVoltar) {
  document.getElementById("botao-voltar").hidden = !podeVoltar;
  document.getElementById("janela-nivel").hidden = false;
}

function fecharEscolha() {
  document.getElementById("janela-nivel").hidden = true;
}

function mostrarVitoria() {
  const v = lerVitorias();
  document.getElementById("placar").textContent = `Vitórias no fácil: ${v[1]} · no difícil: ${v[3]}`;
  document.getElementById("janela-vitoria").hidden = false;
}

function avisar(texto) {
  const el = document.getElementById("aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 2800);
}

// ===== Guardar no aparelho =====
function salvarJogo() {
  try {
    localStorage.setItem(CHAVE_JOGO, JSON.stringify({ jogo, historico: historico.slice(-HISTORICO_SALVO) }));
  } catch {}
}

function carregarJogo() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_JOGO));
    if (salvo && salvo.jogo && !salvo.jogo.venceu) {
      jogo = salvo.jogo;
      historico = salvo.historico || [];
      return true;
    }
  } catch {}
  return false;
}

function lerVitorias() {
  try {
    return { 1: 0, 3: 0, ...JSON.parse(localStorage.getItem(CHAVE_VITORIAS)) };
  } catch {
    return { 1: 0, 3: 0 };
  }
}

function registrarVitoria() {
  const v = lerVitorias();
  v[jogo.nivel] += 1;
  try {
    localStorage.setItem(CHAVE_VITORIAS, JSON.stringify(v));
  } catch {}
}

// ===== Início =====
function iniciar() {
  criarVagas();
  criarCartas();
  medir();

  mesa.addEventListener("pointerdown", aoApertar);
  mesa.addEventListener("pointermove", aoArrastar);
  mesa.addEventListener("pointerup", aoSoltar);
  mesa.addEventListener("pointercancel", aoCancelar);
  window.addEventListener("resize", () => {
    medir();
    if (jogo) desenhar();
  });

  document.getElementById("botao-novo").addEventListener("click", () => abrirEscolha(true));
  document.getElementById("botao-desfazer").addEventListener("click", desfazer);
  document.getElementById("botao-dica").addEventListener("click", mostrarDica);
  document.getElementById("botao-voltar").addEventListener("click", fecharEscolha);
  document.querySelectorAll("[data-nivel]").forEach((b) =>
    b.addEventListener("click", () => {
      fecharEscolha();
      novoJogo(+b.dataset.nivel);
    })
  );
  document.getElementById("botao-de-novo").addEventListener("click", () => {
    document.getElementById("janela-vitoria").hidden = true;
    abrirEscolha(false);
  });

  if (carregarJogo()) {
    desenhar();
    if (podeTerminarSozinho()) iniciarAuto();
  } else {
    novoJogo(1);
    abrirEscolha(false);
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
}

iniciar();
