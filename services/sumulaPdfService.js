import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logoPath = path.join(__dirname, "..", "uploads", "ccb_logo.png");
const logoBase64 = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "";

const sigCache = new Map();
const carregarAssinatura = async (ref) => {
  if (!ref) return "";
  if (sigCache.has(ref)) return sigCache.get(ref);
  try {
    if (/^https?:\/\//i.test(ref)) {
      const resp = await fetch(ref);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const mime = resp.headers.get("content-type") || "image/png";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      sigCache.set(ref, dataUrl);
      return dataUrl;
    }
    const abs = path.isAbsolute(ref) ? ref : path.join(process.cwd(), ref);
    if (!fs.existsSync(abs)) {
      sigCache.set(ref, "");
      return "";
    }
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    sigCache.set(ref, dataUrl);
    return dataUrl;
  } catch (err) {
    console.warn("[sumulaPdf] carregarAssinatura falhou:", err?.message || err);
    sigCache.set(ref, "");
    return "";
  }
};

const sigImg = (ref, styleClass = "sig-img") => {
  const data = sigCache.get(ref);
  if (!data) return "";
  return `<img class="${styleClass}" src="${data}"/>`;
};

const precarregarAssinaturas = async (sumula) => {
  const refs = [
    sumula?.arbitragem?.crew_chief_assinatura,
    sumula?.arbitragem?.fiscal_1_assinatura,
    sumula?.arbitragem?.fiscal_2_assinatura,
    sumula?.mesa?.apontador_assinatura,
    sumula?.mesa?.cronometrista_assinatura,
    sumula?.mesa?.operador_24s_assinatura,
    sumula?.mesa?.representante_assinatura,
  ].filter(Boolean);
  await Promise.all(refs.map((r) => carregarAssinatura(r)));
};

/* ====================================================================
   HELPERS
   ==================================================================== */

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtData = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("pt-BR");
};

const fmtHora = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const atletaNome = (jog) => {
  const a = jog?.atleta_id;
  if (!a) return "";
  if (typeof a === "object" && a.nome_completo) return a.nome_completo;
  return "";
};

const atletaIdStr = (j) => {
  const a = j?.atleta_id;
  if (!a) return "";
  return String(typeof a === "object" ? a._id : a);
};

const equipeNome = (ref) => {
  if (!ref) return "";
  if (typeof ref === "object" && ref.nome_equipe) return ref.nome_equipe;
  return "";
};

const competicaoNome = (sumula) => {
  const c = sumula.competicao_id;
  if (!c) return "";
  if (typeof c === "object") {
    const nome = c.nome || "";
    const ano = c.ano ? ` ${c.ano}` : "";
    return `${nome}${ano}`.trim();
  }
  return "";
};

const cidadeJogo = (sumula) => {
  const j = sumula.jogo_id;
  if (j && typeof j === "object" && j.cidade) return j.cidade;
  return "";
};

const localJogo = (sumula) => {
  const j = sumula.jogo_id;
  if (j && typeof j === "object" && j.local) return j.local;
  return "";
};

const numeroJogo = (sumula) => {
  const j = sumula.jogo_id;
  if (j && typeof j === "object" && j.numero) return j.numero;
  const id = sumula.jogo_id?._id || sumula.jogo_id;
  if (!id) return "";
  return String(id).slice(-6).toUpperCase();
};

const tecnicoNome = (comissao) =>
  comissao?.find((m) => /t[eé]cnico$/i.test(m.funcao || "") && !/assist/i.test(m.funcao || ""))?.nome || "";

const tecnicoAssinatura = (comissao) =>
  comissao?.find((m) => /t[eé]cnico$/i.test(m.funcao || "") && !/assist/i.test(m.funcao || ""))?.assinatura_path || "";

const assistenteNome = (comissao) =>
  comissao?.find((m) => /assist/i.test(m.funcao || ""))?.nome || "";

const boxesPorQuarto = (eventos, equipe, tipo) => {
  const porQ = [0, 0, 0, 0];
  eventos
    .filter((e) => e.tipo === tipo && !e.cancelado && e.equipe === equipe)
    .forEach((e) => {
      if (e.quarto >= 1 && e.quarto <= 4) porQ[e.quarto - 1]++;
    });
  return porQ;
};

/*
 * Coleta os timeouts (tipo="timeout") de uma equipe agrupados por metade,
 * preservando o minuto do quarto em que foram concedidos e o quarto (para cor).
 * 1ª metade = quartos 1 e 2 (até 2 timeouts); 2ª metade = quartos 3 e 4 (até 3);
 * prorrogações = até 3 timeouts (um por OT).
 */
const timeoutsPorMetade = (eventos, equipe) => {
  const primeira = [];
  const segunda = [];
  const prorrogacao = [];
  eventos
    .filter((e) => e.tipo === "timeout" && !e.cancelado && e.equipe === equipe)
    .sort((a, b) => a.sequencia - b.sequencia)
    .forEach((e) => {
      const item = { quarto: e.quarto, minuto: e.minuto_jogo };
      if (e.quarto === 1 || e.quarto === 2) primeira.push(item);
      else if (e.quarto === 3 || e.quarto === 4) segunda.push(item);
      else if (e.quarto > 4) prorrogacao.push(item);
    });
  return { primeira, segunda, prorrogacao };
};

const faltasPorJogador = (eventos, atletaId) =>
  eventos
    .filter(
      (e) =>
        e.tipo === "falta" &&
        !e.cancelado &&
        String(e.jogador_id) === String(atletaId),
    )
    .sort((a, b) => a.sequencia - b.sequencia);

const codigoFalta = (f) => {
  const base = f.tipo_falta || "";
  const ll = f.lances_livres && f.lances_livres > 0 ? f.lances_livres : "";
  // FIBA: faltas canceladas reciprocamente recebem sufixo "c" (ex.: Tc Tc).
  // Aceita tanto a flag manual nova (`cancelada_manual`) quanto o pareamento
  // legado (`falta_cancelada_por`).
  const cancel = f.cancelada_manual || f.falta_cancelada_por ? "c" : "";
  return `${base}${ll}${cancel}`;
};

const entrouEmCampo = (sumula, eventos, atletaId) => {
  const id = String(atletaId);
  const jogs = [...sumula.jogadores_a, ...sumula.jogadores_b];
  const j = jogs.find((x) => atletaIdStr(x) === id);
  if (j?.titular || j?.excluido || j?.desqualificado) return true;
  return eventos.some(
    (e) =>
      !e.cancelado &&
      ((e.tipo === "substituicao" && String(e.jogador_entra_id) === id) ||
        (["ponto", "falta"].includes(e.tipo) && String(e.jogador_id) === id)),
  );
};

// Determina dados de entrada do jogador: se entrou, em que quarto e se é titular.
// Titulares sempre iniciam no Q1. Não-titulares são detectados pela primeira
// aparição em eventos (substituição, ponto ou falta), pegando o quarto daquele evento.
const entradaDadosJogador = (sumula, eventos, atletaId) => {
  const id = String(atletaId);
  const jogs = [...sumula.jogadores_a, ...sumula.jogadores_b];
  const j = jogs.find((x) => atletaIdStr(x) === id);
  if (j?.titular) return { entrou: true, quarto: 1, titular: true };
  const firstEv = eventos
    .filter(
      (e) =>
        !e.cancelado &&
        ((e.tipo === "substituicao" && String(e.jogador_entra_id) === id) ||
          (["ponto", "falta"].includes(e.tipo) && String(e.jogador_id) === id)),
    )
    .sort((a, b) => a.sequencia - b.sequencia)[0];
  if (firstEv) return { entrou: true, quarto: firstEv.quarto, titular: false };
  if (j?.excluido || j?.desqualificado) return { entrou: true, quarto: 1, titular: false };
  return { entrou: false, quarto: null, titular: false };
};

/* ====================================================================
   CONTAGEM PROGRESSIVA — rastreamento independente A e B (padrão FIBA)
   ==================================================================== */

const gerarContagemProgressiva = (eventos, sumula) => {
  const mapaNumero = new Map();
  [...sumula.jogadores_a, ...sumula.jogadores_b].forEach((j) => {
    mapaNumero.set(atletaIdStr(j), j.numero ?? "");
  });

  const pontos = eventos
    .filter((e) => e.tipo === "ponto" && !e.cancelado)
    .sort((a, b) => a.sequencia - b.sequencia);

  // Cada item: { jersey, circle, diagonal, filled, quarto, endOfQuarter }
  // - jersey: nº da camisa do atleta, registrado na linha que corresponde ao
  //   NOVO total da equipe após a cesta (padrão FIBA). Linhas intermediárias
  //   de uma cesta de 2 ou 3 pontos ficam vazias.
  // - circle: círculo ao redor da camisa → só bola de 3 pontos
  // - diagonal: risco diagonal no quadradinho do índice → bola de 2 ou 3 pontos
  // - filled: nº do quarto em que o ponto foi marcado → bola de 1 ponto
  //   (disco cheio pintado com a cor do quarto no índice, sem diagonal)
  // - endOfQuarter: último ponto do quarto para a equipe → círculo no índice
  //   e traço horizontal na aresta inferior das células (cor do quarto)
  const aScores = [];
  const bScores = [];
  const aLastOfQ = new Map(); // quarto → índice em aScores
  const bLastOfQ = new Map();

  for (const ev of pontos) {
    const valor = ev.valor || 0;
    if (valor <= 0) continue;
    const numero = mapaNumero.get(String(ev.jogador_id)) ?? "";
    const arr = ev.equipe === "A" ? aScores : ev.equipe === "B" ? bScores : null;
    if (!arr) continue;

    // Linhas intermediárias (para cestas de 2 ou 3) — vazias
    for (let i = 0; i < valor - 1; i++) {
      arr.push({ jersey: "", circle: false, diagonal: false, filled: null, quarto: null, endOfQuarter: false });
    }
    // Linha final: total atingido pela equipe → recebe a camisa e o marcador
    arr.push({
      jersey: String(numero),
      circle: valor === 3,
      diagonal: valor === 2 || valor === 3,
      filled: valor === 1 ? (ev.quarto ?? null) : null,
      quarto: ev.quarto ?? null,
      endOfQuarter: false,
    });

    if (ev.quarto != null) {
      const map = ev.equipe === "A" ? aLastOfQ : bLastOfQ;
      map.set(ev.quarto, arr.length - 1);
    }
  }

  // Marcar, para cada equipe, a linha do último ponto de cada quarto
  for (const idx of aLastOfQ.values()) {
    if (aScores[idx]) aScores[idx].endOfQuarter = true;
  }
  for (const idx of bLastOfQ.values()) {
    if (bScores[idx]) bScores[idx].endOfQuarter = true;
  }

  // Finalização do jogo: índice do último ponto do último quarto por equipe
  // + o número do quarto (para determinar a cor do traço vertical de encerramento)
  let aGameEndIdx = null, aGameEndQuarto = null;
  if (aLastOfQ.size > 0) {
    const qMax = Math.max(...aLastOfQ.keys());
    aGameEndIdx = aLastOfQ.get(qMax);
    aGameEndQuarto = qMax;
  }
  let bGameEndIdx = null, bGameEndQuarto = null;
  if (bLastOfQ.size > 0) {
    const qMax = Math.max(...bLastOfQ.keys());
    bGameEndIdx = bLastOfQ.get(qMax);
    bGameEndQuarto = qMax;
  }

  return { aScores, bScores, aGameEndIdx, aGameEndQuarto, bGameEndIdx, bGameEndQuarto };
};

/* ====================================================================
   RESUMO TÉCNICO (Página 2)
   ==================================================================== */

const gerarResumoTecnico = (eventos, jogadores, sumula) => {
  const hasExtra = eventos.some((e) => !e.cancelado && e.quarto > 4);
  const stats = new Map();
  for (const j of jogadores) {
    const aid = atletaIdStr(j);
    if (!aid) continue;
    const entrada = entradaDadosJogador(sumula, eventos, aid);
    stats.set(aid, {
      numero: j.numero,
      nome: atletaNome(j),
      entrou: entrada.entrou,
      quartoEntrada: entrada.quarto,
      q1: 0, q2: 0, q3: 0, q4: 0, extra: 0, total: 0,
    });
  }
  for (const e of eventos) {
    if (e.tipo !== "ponto" || e.cancelado || !e.jogador_id) continue;
    const row = stats.get(String(e.jogador_id));
    if (!row) continue;
    const v = e.valor || 0;
    if (e.quarto === 1) row.q1 += v;
    else if (e.quarto === 2) row.q2 += v;
    else if (e.quarto === 3) row.q3 += v;
    else if (e.quarto === 4) row.q4 += v;
    else row.extra += v;
    row.total += v;
  }
  const linhas = Array.from(stats.values())
    .filter((r) => r.numero !== null && r.numero !== undefined)
    .sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999));
  const totais = linhas.reduce(
    (acc, r) => {
      acc.q1 += r.q1; acc.q2 += r.q2; acc.q3 += r.q3;
      acc.q4 += r.q4; acc.extra += r.extra; acc.total += r.total;
      return acc;
    },
    { q1: 0, q2: 0, q3: 0, q4: 0, extra: 0, total: 0 },
  );
  return { linhas, totais, hasExtra };
};

/* ====================================================================
   CSS — Padrão FIBA / Livro de Regras para Mesário
   ==================================================================== */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:Arial,Helvetica,sans-serif;
  font-size:9px;color:#000;margin:0;padding:3mm;
  background:#fff;text-transform:uppercase;
}
.page{page-break-after:always}
.page:last-child{page-break-after:auto}

/* ===== Labels & Values ===== */
.L{font-weight:700;color:#000;font-size:8px;margin-right:3px}
.V{color:#0000CC;text-decoration:underline;font-weight:700;font-size:9.5px}

/* ===== HEADER TOP (sem bordas) ===== */
.ht{display:flex;align-items:center;gap:10px;margin-bottom:3px}
.ht .logo img{width:60px;height:auto}
.ht .logo-ph{width:60px;height:60px;border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:7px;color:#999}
.ht-info{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
.ht-info div{line-height:1.4}

/* ===== GAME INFO TABLE (3 colunas com bordas) ===== */
.gi{width:100%;border-collapse:collapse;border:2px solid #000;margin-bottom:3px}
.gi td{border:1px solid #000;padding:3px 6px;vertical-align:top;font-size:8.5px}
.gi .gi-j{width:65px;text-align:center;vertical-align:middle}
.gi .gi-j .L{display:block;font-size:8px;margin:0}
.gi .gi-j .V{font-size:14px;display:block;margin-top:2px}
.gi .gi-l{width:33%}
.gi .gi-a{}
.gi-row{margin-bottom:1px}

/* ===== MAIN (borda única compartilhada) ===== */
.M{border:2px solid #000;display:grid;grid-template-columns:54% 46%;margin-bottom:3px}
.Ml{border-right:2px solid #000;display:flex;flex-direction:column}
.Mr{display:flex;flex-direction:column}

/* ===== TEAM BLOCK ===== */
.T{padding:4px 5px;flex:1}
.T+.T{border-top:2px solid #000}
.T-hd{display:flex;align-items:baseline;gap:6px;font-size:9.5px;font-weight:800;margin-bottom:3px}
.T-hd .tn{color:#0000CC;text-decoration:underline;font-weight:700}

/* --- Área de Controle (Tempos + Faltas) --- */
.ctrl{display:grid;grid-template-columns:1fr 1.8fr;gap:8px;padding:3px 0 4px;border-bottom:1px solid #000;margin-bottom:3px}
.sec-lbl{font-size:7.5px;font-weight:700;margin-bottom:3px}

/* Tempos Debitados */
/* Tempos debitados — tabelas colapsadas (1×2 na 1ª metade, 1×3 na 2ª metade).
   Cada célula traz o minuto do quarto em que o timeout foi pedido, na cor
   do quarto (Q1/Q3 vermelho, Q2/Q4 azul) */
.td-tbl{border-collapse:collapse;margin-bottom:2px}
.td-tbl td{
  width:18px;height:14px;
  border:1px solid #000;
  text-align:center;
  line-height:14px;
  font-size:11px;
  font-weight:700;
  padding:0;
  color:#000;
  position:relative;
  overflow:hidden;
}
.td-tbl td.tq1{color:#E60000}
.td-tbl td.tq2{color:#0000CC}
/* Célula vazia: dois traços horizontais (padrão FIBA para inutilizar
   campos não preenchidos ao final do jogo). Azul por padrão nos Tempos
   Debitados; nas Faltas assume a cor do quarto via --lc (fq1/fq2). */
.td-tbl td.empty{--lc:#0000CC}
.td-tbl td.empty.fq1{--lc:#E60000}
.td-tbl td.empty.fq2{--lc:#0000CC}
.td-tbl td.empty::before,
.td-tbl td.empty::after{
  content:"";
  position:absolute;
  left:0;
  right:0;
  height:2px;
  background:var(--lc);
  pointer-events:none;
}
.td-tbl td.empty::before{top:4px}
.td-tbl td.empty::after{top:8px}
/* Faltas de equipe — X diagonal corner-to-corner na cor do quarto.
   Desenhado com dois retângulos rotacionados (espessura uniforme, sem
   artefatos de gradiente). O overflow:hidden do td clipa as pontas nos
   cantos. O número pré-impresso (1/2/3/4) permanece visível por baixo. */
.td-tbl td.fe-on{--xc:#000}
.td-tbl td.fe-on.fq1{--xc:#E60000}
.td-tbl td.fe-on.fq2{--xc:#0000CC}
.td-tbl td.fe-on::before,
.td-tbl td.fe-on::after{
  content:"";
  position:absolute;
  top:50%;
  left:50%;
  width:150%;
  height:1.8px;
  background:var(--xc);
  pointer-events:none;
}
.td-tbl td.fe-on::before{transform:translate(-50%,-50%) rotate(38deg)}
.td-tbl td.fe-on::after{transform:translate(-50%,-50%) rotate(-38deg)}

/* Faltas de Equipe */
.fe-ln{display:flex;align-items:center;gap:3px;margin-bottom:2px;font-size:7.5px}
.fe-ln .qt{font-weight:700;font-size:7px;min-width:26px}
.qc{display:inline-flex;width:15px;height:15px;border-radius:50%;border:1px solid #000;align-items:center;justify-content:center;font-size:8px;font-weight:800;flex-shrink:0;margin:0 2px}
.qc.ghost{visibility:hidden}

/* --- Tabela de Jogadores (Roster) --- */
/* table-layout:fixed + colgroup garante que as colunas de faltas não encolham
   quando não há código no quadradinho. Sem isso, o navegador recalcularia as
   larguras com base no conteúdo e o campo de nome invadiria as faltas. */
.R{width:100%;border-collapse:collapse;margin-top:2px;table-layout:fixed}
/* FIBA B.3.3.3 — quando a equipe tem menos de 12 jogadores, a primeira linha
   vazia recebe um traço horizontal azul passando por cima das três colunas
   (nome, Nº e E.). As células mantêm suas próprias bordas laterais; o traço
   é desenhado via pseudo-elemento em cada célula, com left/right em -1px e
   overflow:visible para cobrir o border colapsado e ficar contínuo. z-index
   garante que o traço fique POR CIMA das bordas. */
.R tr.nm-strike-row td.nm,
.R tr.nm-strike-row td.nu,
.R tr.nm-strike-row td.en{position:relative;overflow:visible}
.R tr.nm-strike-row td.nm::before,
.R tr.nm-strike-row td.nu::before,
.R tr.nm-strike-row td.en::before{
  content:"";
  position:absolute;
  left:-1px;right:-1px;
  top:50%;
  height:1.5px;
  margin-top:-0.75px;
  background:#0000CC;
  pointer-events:none;
  z-index:2;
}
/* FIBA B.3.3.3 (continuação) — quando a equipe tem menos de 12 jogadores,
   um traço diagonal azul cobre o bloco inteiro das caixas de falta que ficou
   sem uso: começa no meio da aresta esquerda da 1ª caixa de falta da 1ª
   linha vazia e termina na aresta inferior-direita da 5ª caixa de falta da
   12ª linha. O SVG é ancorado na 5ª célula de falta da 12ª linha (fl[4]
   da última linha) com right:0/bottom:0 — ancorar NO ALVO garante que a
   diagonal sempre feche exatamente no canto certo, sem depender das
   alturas das linhas da comissão técnica que vêm depois. A largura
   calc(500% + 5px) compensa as bordas colapsadas (4 bordas internas de
   0,5px + 2 bordas externas de 0,5px ≈ 5px de diferença entre 5 padding-
   boxes e 5 border-boxes). Altura = nº de linhas vazias × 18px (linhas
   vazias têm altura fixa de 18px). vector-effect=non-scaling-stroke
   mantém a espessura fixa independentemente da proporção do SVG. */
.R td.fl-diag{position:relative;overflow:visible;padding:0}
.R td.fl-diag .fldiag{
  position:absolute;
  right:0;
  bottom:0;
  pointer-events:none;
  z-index:2;
}
.R th,.R td{border:1px solid #000;padding:0 2px;text-align:center;font-size:9px;height:18px;line-height:18px;overflow:hidden}
.R th{font-size:9px;font-weight:600;background:#fff;height:18px;line-height:18px;letter-spacing:0.2px}
/* Nome: azul, sem sublinhado, permite quebra em linhas (wrap). overflow:visible
   + height:auto permitem que a linha expanda se o nome ocupar duas linhas. */
.R td.nm{text-align:left;padding:2px 4px;color:#0000CC;font-weight:500;font-size:9px;line-height:1.15;white-space:normal;word-break:break-word;overflow:visible;height:auto}
.R td.nu{font-weight:700;color:#0000CC;font-size:12px}
.R td.en{padding:0;vertical-align:middle;line-height:0}
.R td.en .xe{display:inline-block;width:14px;height:14px;vertical-align:middle}
/* Código da falta colorido pelo quarto em que ocorreu (FIBA):
   Q1/Q3 vermelho; Q2/Q4/prorrogações azul. */
.R td.fl{font-weight:600;font-size:10.5px;color:#000}
.R td.fl.fq1{color:#E60000}
.R td.fl.fq2{color:#0000CC}
/* Fechamento vertical grosso azul (FIBA) — traçado à esquerda da célula:
   (a) no intervalo (fim do Q2), separa as faltas de H1 (já registradas) das
   que ainda ficarão em branco, eliminando a ambiguidade do vermelho de Q1×Q3;
   (b) ao apito final, fecha o espaço imediatamente após a última falta
   preenchida. Quando as duas marcações coincidem na mesma célula, vira uma
   linha só; quando divergem, somam-se ao traço horizontal de inutilização
   formando o "zigue-zague" característico da súmula FIBA. */
.R td.fl.vsep{border-left:2px solid #0000CC}
/* Conector horizontal azul no topo da célula — liga o traço vertical desta
   linha ao traço vertical da linha anterior quando eles estão em colunas
   diferentes, formando o zigue-zague contínuo da súmula FIBA. Usado entre
   min(colAtual,colAnterior) e max-1 do separador correspondente (halftime
   ou fim de jogo). border-collapse escolhe o borda mais grossa/colorida. */
.R td.fl.hsep{border-top:2px solid #0000CC}
/* FIBA B.8.4 — ao final do jogo, espaços de falta não utilizados são
   "inutilizados" com um traço horizontal grosso centralizado na caixa.
   Só entra em vigor quando a súmula está finalizada (.final na tabela) e
   somente em linhas de jogadores realmente inscritos (tr:not(.unlisted));
   linhas "fantasma" são cobertas pela diagonal B.3.3.3 em separado.
   Implementado via background linear-gradient com origin:border-box para
   ficar centralizado em relação à caixa COMPLETA da célula (inclusive
   quando há zigue-zague com bordas mais grossas em um dos lados — se
   posicionasse em relação ao padding-box o traço sairia do meio). */
.R.final tr:not(.unlisted) td.fl:empty{
  background:linear-gradient(#0000CC,#0000CC) center/100% 2px no-repeat border-box;
}
/* Borda-inferior grossa — usada na última linha do roster (i=11) para levar
   o zigue-zague da coluna do separador de faltas do jogador até a coluna do
   separador do técnico (cf[0] do bloco .st), atravessando por cima da borda
   que separa o último jogador da comissão técnica. */
.R td.fl.hsep-bot{border-bottom:2px solid #0000CC}
/* 6ª "caixa" invisível — reserva o espaço à direita das 5 faltas para o
   código "GD" ou qualquer 6ª marcação (ex.: D em jogador já excluído, per FIBA
   B.8.3.13). border:0 + background:transparent fazem a célula desaparecer
   visualmente; com border-collapse:collapse a borda direita da 5ª falta é
   preservada (é a "vencedora" no colapso), então o quadradinho da 5ª falta
   continua fechado normalmente. */
.R td.dq,.R th.dq{border:0;background:transparent;padding:0 2px;font-weight:700;font-size:10.5px;color:#000}
.R td.dq.fq1{color:#E60000}
.R td.dq.fq2{color:#0000CC}
/* 6ª coluna invisível com 2 letras empilhadas (FIBA B.8.3.13 — casos como
   B2/B2 no técnico ou D/F em jogador excluído desqualificado em briga).
   As letras ficam no MESMO canto, uma em cima da outra, sem aumentar a
   largura da célula. */
.R td.dq.dq-stack{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;gap:1px;padding:1px 2px}
.R td.dq.dq-stack .dq-top,
.R td.dq.dq-stack .dq-bot{font-weight:700;font-size:8.5px;line-height:1}
.R td.dq.dq-stack .dq-top.fq1,
.R td.dq.dq-stack .dq-bot.fq1{color:#E60000}
.R td.dq.dq-stack .dq-top.fq2,
.R td.dq.dq-stack .dq-bot.fq2{color:#0000CC}

/* --- Comissão Técnica (rodapé do bloco, agora parte da tabela .R) --- */
/* Técnico e 1º assistente ocupam as duas últimas linhas da própria tabela
   de jogadores (unificação visual). O colspan=5 do rótulo+nome cobre as
   colunas NOME/Nº/E./fl1/fl2 (79,4%), e as 3 caixinhas de falta técnica
   ficam exatamente sob fl3/fl4/fl5, preservando o alinhamento do zigue-
   zague FIBA com o cf[0] do técnico. */
.R tr.st-row td{height:20px;vertical-align:middle;font-size:8.5px;padding:3px 4px}
.R tr.st-row td.st-hd{text-align:left}
.R tr.st-row td.st-hd .st-lbl{font-weight:700;font-size:7.5px;margin-right:6px}
.R tr.st-row td.st-hd .sv{color:#0000CC;text-decoration:underline;font-weight:700;font-size:9px}
.R tr.st-row td.st-hd .st-inner{display:flex;align-items:center;gap:6px;justify-content:flex-start;width:100%}
.R tr.st-row td.st-hd .sig-tec{height:16px;max-width:90px;object-fit:contain;margin-left:auto;padding-right:4px}
.R tr.st-row td.cf{padding:0;text-align:center;font-weight:600;font-size:10.5px;line-height:20px;color:#000;height:20px}
.R tr.st-row td.cf.fq1{color:#E60000}
.R tr.st-row td.cf.fq2{color:#0000CC}
.R tr.st-row td.cf.vsep{border-left:2px solid #0000CC}
.R tr.st-row td.cf.hsep{border-top:2px solid #0000CC}
.R tr.st-row td.dq{border:0;background:transparent;padding:0}
.R.final tr.st-row td.cf:empty{
  background:linear-gradient(#0000CC,#0000CC) center/100% 2px no-repeat border-box;
}

/* ===== CONTAGEM PROGRESSIVA ===== */
.cp-ttl{text-align:center;font-size:14px;font-weight:800;letter-spacing:3px;padding:5px 0;border-bottom:1.5px solid #000}
.cp{width:100%;border-collapse:collapse;flex:1;table-layout:fixed}
.cp th,.cp td{border:1px solid #000;padding:0;text-align:center;font-size:11px;line-height:1;height:17px}
.cp th{font-size:12px;font-weight:800;height:17px;line-height:17px}
/* Separador entre macrocolunas (borda grossa) */
.cp .ms{border-right:2px solid #000}
/* Separador entre TIME A e TIME B dentro de cada macro */
.cp .mid{border-right:1.5px solid #000}
/* Coluna de índice (número do ponto) */
.cp .cn{color:#555;font-size:10.5px;background:#f9f9f9;font-weight:600}
/* Coluna de camisa (nº do atleta que marcou o ponto) */
.cp .ca{color:#E60000;font-weight:700;font-size:11px}
.cp .cb{color:#0000CC;font-weight:700;font-size:11px}
/* Cabeçalhos de equipe no topo de cada macro */
.cp .hA{color:#000}
.cp .hB{color:#000}
/* Cor FIBA por quarto — tudo anotado na súmula segue essa regra:
   Q1 e Q3 → vermelho; Q2 e Q4 → azul; quartos extras → roxo */
.cp td.q1,.cp td.q3{color:#E60000}
.cp td.q2,.cp td.q4{color:#0000CC}
.cp td.qe{color:#800080}
/* Índice pré-impresso mantém cor cinza mesmo quando a célula é marcada */
.cp td span.num{color:#555;font-size:12.5px}
/* Regra FIBA: bola de 3 pontos — círculo ao redor da camisa (cor do quarto) */
.cp .c3{
  display:inline-block;
  border:1.4px solid currentColor;
  border-radius:50%;
  min-width:14px;
  height:14px;
  line-height:12px;
  padding:0 2px;
  font-weight:700;
  box-sizing:border-box;
  text-align:center;
}
/* IMPORTANTE: as marcações (diagonal e bolinha) NÃO são aplicadas via
   pseudo-elemento do <td>. Colocar position:relative / overflow:hidden no
   td de uma tabela com border-collapse faz o Chromium/Puppeteer rasterizar
   a célula inteira, o que deixa a borda mais fina, some no zoom e tira o
   número da camada de texto selecionável do PDF. Por isso o posicionamento
   mora num <span class="ib"> interno (ver idxCell). */
.cp td.d3{background:#f9f9f9}
.cp td.filled{padding:0;background:#f9f9f9;vertical-align:middle}
/* Wrapper interno que carrega a posição e as marcações (dot / diagonal).
   Mantém o <td> em modo vetor com borda normal. Flex para centralizar o
   número sem alterar line-height (herda do td = 1), preservando a métrica
   tipográfica original — assim o tamanho e a altura do dígito ficam
   idênticos aos das células sem marcação. */
.cp td.filled .ib,
.cp td.d3 .ib{
  display:flex;
  align-items:center;
  justify-content:center;
  position:relative;
  width:100%;
  height:17px;
}
/* Regra FIBA: bola de 1 ponto — disco cheio colorido sobreposto ao número
   do índice. */
.cp td.filled .ib::before{
  content:"";
  position:absolute;
  top:50%;
  left:50%;
  width:8px;
  height:8px;
  border-radius:50%;
  background:currentColor;
  transform:translate(-50%,-50%);
  pointer-events:none;
}
/* Regra FIBA: bola de 2 ou 3 pontos — risco diagonal na cor do quarto.
   Retângulo sólido rotacionado; overflow:hidden no WRAPPER (não no td)
   clipa as pontas sem contaminar a rasterização da célula. */
.cp td.d3 .ib{overflow:hidden}
.cp td.d3 .ib::after{
  content:"";
  position:absolute;
  top:50%;
  left:-20%;
  right:-20%;
  height:1.8px;
  background:currentColor;
  transform:translateY(-50%) rotate(-34deg);
  pointer-events:none;
}
/* Regra FIBA: último ponto de cada quarto —
   círculo em torno do índice (mesmo com diagonal ou disco) e traço horizontal
   inferior na aresta das células de camisa + índice, na cor do quarto */
.cp td.eoq{border-bottom:4px solid currentColor}
/* Regra FIBA: finalização do jogo — traço vertical no meio da caixinha de
   camisa e do índice, partindo do fim do bloco até o traço horizontal de fim
   de quarto. Cor = cor do último quarto (via currentColor) */
.cp td.vline{
  background:linear-gradient(to right, transparent calc(50% - 1.3px), currentColor calc(50% - 1.3px), currentColor calc(50% + 1.3px), transparent calc(50% + 1.3px)) no-repeat;
}
.cp td.cn.vline{
  background:
    linear-gradient(to right, transparent calc(50% - 1.3px), currentColor calc(50% - 1.3px), currentColor calc(50% + 1.3px), transparent calc(50% + 1.3px)) no-repeat,
    #f9f9f9;
}
.cp td.eoq .idxwrap{
  display:inline-block;
  border:1.2px solid currentColor;
  border-radius:50%;
  min-width:15px;
  height:15px;
  line-height:13px;
  padding:0 1px;
  box-sizing:border-box;
  text-align:center;
}

/* ===== RODAPÉ DE ENCERRAMENTO ===== */
.F{border:2px solid #000;display:grid;grid-template-columns:1fr 1fr}
.Fl{border-right:1.5px solid #000;padding:4px 5px;display:flex;flex-direction:column}
.Fr{padding:4px 5px;display:flex;flex-direction:column}

/* Mesa */
.mt{width:100%;border-collapse:collapse;margin-bottom:3px}
.mt td{border:1px solid #000;padding:2px 4px;font-size:8.5px;height:17px}
.mt .ml{font-weight:700;font-size:7.5px;width:82px}
.mt .mv{color:#0000CC;text-decoration:underline;font-weight:700}
.mt .ms-sign{width:55px}

/* Arbitragem */
.arb{border-top:1px solid #000;padding-top:4px}
.arb-r{display:flex;align-items:center;gap:5px;min-height:20px;margin-bottom:3px}
.arb-r .L{min-width:62px;font-size:7.5px}
.sig{flex:1;border-bottom:1px solid #000;min-height:17px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sig-img{max-height:22px;max-width:100%;object-fit:contain}
.ms-sign{text-align:center;padding:0}
.ms-sign .sig-img{max-height:15px;max-width:50px;object-fit:contain}

/* Pontuação por período */
.sc{border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:3px}
.sc-ln{display:flex;align-items:center;gap:4px;margin-bottom:3px;font-size:8.5px;font-weight:700}
.sp{display:inline-flex;align-items:center;gap:3px;margin-right:10px;font-size:8.5px}
.sb{display:inline-block;width:28px;text-align:center;border-bottom:1px solid #000;color:#0000CC;font-weight:700;font-size:9px;min-height:13px}

/* Resultado Final */
.rs{border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:3px}
.rs-ln{display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:9px}
.wv{flex:1;border-bottom:1px solid #000;color:#0000CC;font-weight:700;text-decoration:underline;padding:0 4px;font-size:9px;min-height:14px}

/* Protesto */
.pr .pr-row{display:grid;grid-template-columns:1fr 1.5fr;gap:6px;margin-bottom:3px;font-size:7.5px}
.pr .end-row{border-top:1px solid #000;padding-top:3px;font-size:8.5px;display:flex;align-items:center;gap:5px}
.pr strong{font-size:7.5px}

/* ===== PÁGINA 2 ===== */
.p2h{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:8px;font-size:10px;font-weight:700}
.p2h .jb{border:1px solid #000;padding:3px 12px;min-width:60px;text-align:center}
.p2t{text-align:center;font-size:13px;font-weight:800;border:1.5px solid #000;padding:8px;margin-bottom:12px}
.p2sm{text-align:center;border-bottom:1px solid #000;padding:26px 40px 5px;margin:0 60px 3px;font-size:8px;color:#555}
.p2sl{text-align:center;font-size:9px;font-weight:700;margin-bottom:14px}
.p2sg{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:0 40px;margin-bottom:14px}
.p2si{text-align:center}
.p2si .ln{border-bottom:1px solid #000;padding:22px 0 5px;margin-bottom:3px;font-size:8px;color:#555}
.p2si .lb{font-size:9px;font-weight:700}
.p2sig{max-height:48px;max-width:240px;object-fit:contain}

/* Resumo Técnico */
.rg{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
.rt{border:1.5px solid #000;padding:6px}
.rt h5{text-align:center;font-size:10.5px;font-weight:800;margin-bottom:2px}
.rt .sub{text-align:center;font-size:7.5px;color:#555;margin-bottom:4px}
.rt .stt{text-align:center;font-size:8px;text-decoration:underline;margin-bottom:4px;font-weight:700}
.rtb{width:100%;border-collapse:collapse;table-layout:fixed}
.rtb th,.rtb td{border:1px solid #000;padding:3px 2px;text-align:center;font-size:13px;font-weight:800;position:relative}
.rtb th{background:#f2f2f2;font-size:9px;font-weight:700;color:#000;font-family:Arial,Helvetica,sans-serif}
.rtb th.rn-th{width:48px;font-size:8px}
.rtb td.rn{font-weight:800;font-size:13px;color:#0000CC;width:48px}
.rtb tr.tot td{font-weight:800;background:#f5f5f5;font-size:9px}
.rtb tr.tot td.qr,.rtb tr.tot td.qb{font-size:13px}
.rtb .qr{color:#E60000}
.rtb .qb{color:#0000CC}
.rtb td.dashq::before{
  content:"";
  position:absolute;
  left:0;right:0;
  top:50%;
  height:1.5px;
  margin-top:-0.75px;
  background:currentColor;
  pointer-events:none;
}
.hsh{margin-top:10px;border:1px dashed #000;padding:5px;font-family:"Courier New",monospace;font-size:7.5px;word-break:break-all}
`;

/* ====================================================================
   RENDER — Cabeçalho (Área superior + Tabela de info)
   ==================================================================== */

const renderHeader = (sumula) => {
  const comp = esc(competicaoNome(sumula)).toUpperCase();
  const cidade = esc(cidadeJogo(sumula)).toUpperCase();
  const nA = esc(equipeNome(sumula.equipe_a_id)).toUpperCase();
  const nB = esc(equipeNome(sumula.equipe_b_id)).toUpperCase();
  const num = esc(numeroJogo(sumula));
  const loc = esc(localJogo(sumula)).toUpperCase();
  const dt = esc(fmtData(sumula.jogo_id?.data_jogo || sumula.hora_inicio));
  const hr = esc(fmtHora(sumula.hora_inicio));
  const arb = sumula.arbitragem || {};

  const logo = logoBase64
    ? `<div class="logo"><img src="${logoBase64}"/></div>`
    : `<div class="logo"><div class="logo-ph">CCB</div></div>`;

  return `
  <div class="ht">
    ${logo}
    <div class="ht-info">
      <div><span class="L">COMPETIÇÃO</span> <span class="V">${comp}</span></div>
      <div><span class="L">CIDADE</span> <span class="V">${cidade}</span></div>
      <div><span class="L">EQUIPE A</span> <span class="V">${nA}</span></div>
      <div><span class="L">EQUIPE B</span> <span class="V">${nB}</span></div>
    </div>
  </div>
  <table class="gi">
    <tr>
      <td class="gi-j" rowspan="2">
        <span class="L">JOGO Nº</span>
        <span class="V">${num}</span>
      </td>
      <td class="gi-l"><span class="L">LOCAL</span> <span class="V">${loc}</span></td>
      <td class="gi-a"><span class="L">CREW CHIEF</span> <span class="V">${esc(arb.crew_chief || "")}</span></td>
    </tr>
    <tr>
      <td class="gi-l">
        <span class="L">DATA</span> <span class="V">${dt}</span>
        <span class="L" style="margin-left:10px">HORA I.</span> <span class="V">${hr}</span>
      </td>
      <td class="gi-a">
        <span class="L">FISCAL 1</span> <span class="V">${esc(arb.fiscal_1 || "")}</span>
        <span class="L" style="margin-left:8px">FISCAL 2</span> <span class="V">${esc(arb.fiscal_2 || "")}</span>
      </td>
    </tr>
  </table>`;
};

/* ====================================================================
   RENDER — Bloco de Equipe
   ==================================================================== */

const renderTemposDebitados = (tos) => {
  const tqCls = (q) => {
    if (q === 1 || q === 3) return "tq1"; // vermelho
    if (q === 2 || q === 4 || (q && q > 4)) return "tq2"; // azul (inclui prorrogações)
    return "";
  };
  // Converte o minuto do cronômetro (regressivo) no minuto jogado, conforme FIBA:
  // quartos 1–4 duram 10min; prorrogações duram 5min. Se o cronômetro marca 8min,
  // foram jogados 2min.
  const minutoJogado = (to) => {
    if (!to || to.minuto == null) return "";
    const dur = to.quarto > 4 ? 5 : 10;
    const jogado = dur - Number(to.minuto);
    if (!Number.isFinite(jogado)) return "";
    return Math.max(0, Math.min(dur, jogado));
  };
  const cell = (to) => {
    if (!to) return `<td class="empty"></td>`;
    const cls = tqCls(to.quarto);
    return `<td class="${cls}">${minutoJogado(to)}</td>`;
  };
  const row1 = [0, 1].map((i) => cell(tos.primeira[i])).join("");
  const row2 = [0, 1, 2].map((i) => cell(tos.segunda[i])).join("");
  const row3 = [0, 1, 2].map((i) => cell(tos.prorrogacao[i])).join("");
  return `
    <div>
      <div class="sec-lbl">TEMPOS DEBITADOS</div>
      <table class="td-tbl td-tbl-2"><tr>${row1}</tr></table>
      <table class="td-tbl td-tbl-3"><tr>${row2}</tr></table>
      <table class="td-tbl td-tbl-3"><tr>${row3}</tr></table>
    </div>`;
};

const renderFaltasEquipe = (porQuarto) => {
  // Cor do X para o quarto (FIBA): Q1/Q3 vermelho, Q2/Q4 azul
  const fqCls = (q) => {
    if (q === 1 || q === 3) return "fq1";
    if (q === 2 || q === 4) return "fq2";
    return "";
  };
  const boxes = (q0) => {
    const q = q0 + 1;
    const count = porQuarto[q0];
    const qc = fqCls(q);
    return [1, 2, 3, 4]
      .map((k) => {
        if (k <= count) return `<td class="fe-on ${qc}">${k}</td>`;
        return `<td class="empty ${qc}">${k}</td>`;
      })
      .join("");
  };
  const pair = (qa, qb) => `
    <div class="fe-ln">
      <span class="qt">QUARTO</span>
      <span class="qc">${qa + 1}</span>
      <table class="td-tbl"><tr>${boxes(qa)}</tr></table>
      <span class="qc">${qb + 1}</span>
      <table class="td-tbl"><tr>${boxes(qb)}</tr></table>
    </div>`;
  // HCC: 4 caixinhas no mesmo padrão das faltas, alinhadas abaixo do Q3.
  // Sistema ainda não implementa tempo técnico, então todas as caixinhas
  // vão sempre riscadas (dois traços azuis), inutilizando o campo no documento.
  const hccBoxes = [1, 2, 3, 4].map(() => `<td class="empty"></td>`).join("");
  return `
    <div>
      <div class="sec-lbl" style="text-align:center">FALTAS DE EQUIPE</div>
      ${pair(0, 1)}
      ${pair(2, 3)}
      <div class="fe-ln">
        <span class="qt">HCC</span>
        <span class="qc ghost">0</span>
        <table class="td-tbl"><tr>${hccBoxes}</tr></table>
      </div>
    </div>`;
};

// Cor do X da coluna E. (entrou em campo) conforme quarto de entrada.
// Instrução explícita do cliente: no Q1 o X vai azul (titulares recebem
// círculo vermelho por cima). Nos demais quartos segue a convenção FIBA do
// restante do documento — Q3 vermelho; Q2, Q4 e prorrogações azuis.
const entQuartoColor = (q) => {
  if (q === 3) return "#E60000";
  return "#0000CC";
};

// SVG inline para o X da coluna E. — 2 traços diagonais com espessura uniforme.
// Usamos SVG (não CSS pseudo-elemento) para evitar o bug de rasterização do
// Chromium/Puppeteer em tabelas com border-collapse (mesmo problema que foi
// corrigido na contagem progressiva). Círculo vermelho envolvendo o X é
// adicionado apenas para titulares.
const entSvg = (color, circled) => {
  const circle = circled
    ? `<circle cx="7" cy="7" r="6" stroke="#E60000" stroke-width="1.1" fill="none"/>`
    : "";
  return `<svg class="xe" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${circle}<line x1="3.2" y1="3.2" x2="10.8" y2="10.8" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><line x1="10.8" y1="3.2" x2="3.2" y2="10.8" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
};

// Classe de cor do código da falta pelo quarto em que foi cometida (FIBA):
// Q1/Q3 → vermelho; Q2/Q4/prorrogações → azul.
const faltaQuartoCls = (q) => {
  if (q === 1 || q === 3) return "fq1";
  if (q === 2 || q === 4 || (q && q > 4)) return "fq2";
  return "";
};

// FIBA B.8.3 — monta os "espaços" de falta do jogador. Cada falta ocupa um
// slot; certas combinações inserem automaticamente um "GD" no espaço seguinte
// (desqualificação do jogo):
//   • 2ª falta técnica do jogador (T)            → B.8.3.2
//   • 2ª falta antidesportiva (U)                → B.8.3.5
//   • T + U em qualquer ordem                    → B.8.3.6
//   • 3ª falta técnica do técnico (B ou C)       → B.8.3.3 / B.8.3.4
// A falta "D" (desqualificante direta, B.8.3.7) não gera GD extra — é ela
// própria a indicação de desqualificação. Códigos legados P2/U2 viram P/U
// (os lances livres já carregam o número).
const montarSlotsFalta = (faltas) => {
  const slots = [];
  let tCount = 0, uCount = 0, bCount = 0;
  for (const f of faltas) {
    const raw = (f.tipo_falta || "").toUpperCase();
    const base = raw === "P2" ? "P" : raw === "U2" ? "U" : raw;
    const ll = f.lances_livres && f.lances_livres > 0 ? f.lances_livres : "";
    // Sufixo "c" (canceladas reciprocamente — FIBA, ex.: Tc Tc). Aceita
    // tanto a flag manual nova quanto o pareamento legado.
    const cancel = f.cancelada_manual || f.falta_cancelada_por ? "c" : "";
    slots.push({ text: `${base}${ll}${cancel}`, quarto: f.quarto });

    let gd = false;
    if (base === "T") { tCount++; if (tCount >= 2 || uCount >= 1) gd = true; }
    else if (base === "U") { uCount++; if (uCount >= 2 || tCount >= 1) gd = true; }
    else if (base === "B" || base === "C") { bCount++; if (bCount >= 3) gd = true; }

    if (gd) slots.push({ text: "GD", quarto: f.quarto });
  }
  return slots;
};

// faltasTecnico: array bruto de eventos C/B atribuídos ao tecnico_id da
// comissão (ja filtrados por equipe). Usado para preencher os 3 slots da
// linha do tecnico/assistente.
const renderRoster = (
  jogadores,
  eventos,
  sumula,
  tec,
  ass,
  tecSig,
  faltasTecnico = [],
  faltasAssistente = [],
) => {
  const sorted = [...jogadores].sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999));
  // Quando a súmula está finalizada, a tabela ganha a classe .final para que
  // os espaços de falta vazios recebam os traços horizontais de inutilização
  // (FIBA B.8.4).
  const jogoFinalizado = sumula?.status === "finalizada";
  // Intervalo ultrapassado: há evento em Q3+, fim_quarto de Q2 registrado ou
  // jogo finalizado. Habilita o traço vertical grosso de fim de H1, que
  // desambigua o vermelho de Q1×Q3 (FIBA B.8.3.x).
  const halftimePassed =
    jogoFinalizado ||
    eventos.some((e) => e.quarto >= 3) ||
    eventos.some((e) => e.tipo === "fim_quarto" && e.quarto >= 2);
  // Larguras explícitas via colgroup (table-layout:fixed exige isso). Campo do
  // nome tem mais espaço agora para reduzir wrap, Nº e E. afinadas, 5 colunas
  // de falta menores e 1 coluna extra à direita para a letra de desqualificação.
  // Soma: 58 + 5.5 + 5.5 + 5×5.2 + 5 = 100%.
  const colgroup = `<colgroup>
    <col style="width:58%"/>
    <col style="width:5.5%"/>
    <col style="width:5.5%"/>
    <col style="width:5.2%"/>
    <col style="width:5.2%"/>
    <col style="width:5.2%"/>
    <col style="width:5.2%"/>
    <col style="width:5.2%"/>
    <col style="width:5%"/>
  </colgroup>`;
  const K = sorted.length; // quantidade de atletas inscritos
  const emptyRows = Math.max(0, 12 - K);
  // Diagonal FIBA B.3.3.3: ancorada na fl[4] da 12ª linha (último não-listado)
  // via .fl-diag/.fldiag (position:relative + absolute right:0/bottom:0). Isso
  // trava o canto inferior-direito exatamente na quina inferior-direita da 5ª
  // caixa de falta do último jogador não-listado. width=calc(500% + 5px)
  // estende para a esquerda cobrindo as 5 colunas de falta; height=emptyRows*18px
  // sobe até a aresta superior da 1ª linha não-listada (linhas vazias têm 18px
  // fixos). y1 no viewBox = 9/(emptyRows*18)*100 = 50/emptyRows — ponto inicial
  // no meio da aresta esquerda da 1ª caixa de falta da 1ª linha não-listada.
  const y1 = emptyRows > 0 ? (50 / emptyRows).toFixed(4) : 0;
  const diagSvg = emptyRows > 0
    ? `<svg class="fldiag" preserveAspectRatio="none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:calc(500% + 5px);height:${emptyRows * 18}px"><line x1="0" y1="${y1}" x2="100" y2="100" stroke="#0000CC" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`
    : "";
  // Pré-computa os separadores (halftime h e fim-de-jogo f) e os slots por
  // linha. Dois "caminhos" independentes percorrem a coluna de faltas:
  //   h_i = coluna do traço de fim de H1 (n2 de faltas em Q1+Q2);
  //   f_i = coluna do traço de fim de jogo (nTotal de faltas preenchidas).
  // Cada caminho desenha uma borda-esquerda grossa na linha i (.vsep) e,
  // quando a coluna muda entre as linhas i-1 e i, uma borda-superior grossa
  // (.hsep) nas células intermediárias — border-collapse funde a borda
  // inferior da linha anterior com a superior da atual, formando o
  // traçado contínuo em zigue-zague visto na súmula impressa. */
  const seps = [];
  for (let i = 0; i < 12; i++) {
    const j = sorted[i];
    if (!j) {
      // Linha fantasma — 0 faltas por definição, então h=f=0 quando o
      // fechamento correspondente foi alcançado. O caminho desce verticalmente
      // pelo col 0 (vsep) e o trecho de transição da última linha listada até
      // cá é coberto por hsep, fechando as linhas não-inscritas junto com a
      // diagonal FIBA B.3.3.3 já existente.
      const h = halftimePassed ? 0 : null;
      const f = jogoFinalizado ? 0 : null;
      seps.push({ h, f, slots: null, listed: false });
      continue;
    }
    const aid = atletaIdStr(j);
    const faltasAll = faltasPorJogador(eventos, aid);
    const slots = montarSlotsFalta(faltasAll);
    const n2 = slots.slice(0, 5).filter((s) => s.quarto <= 2).length;
    const nTotal = Math.min(slots.length, 5);
    const h = halftimePassed && n2 < 5 ? n2 : null;
    const f = jogoFinalizado && nTotal < 5 ? nTotal : null;
    seps.push({ h, f, slots, listed: true });
  }
  // Linhas do técnico (idx 12) e 1º assistente técnico (idx 13) entram no
  // mesmo array de seps para que o zigue-zague flua naturalmente do roster
  // para a comissão técnica. Cada linha tem 3 caixas (cf[0..2]) ancoradas em
  // ST_CF0_COL=2 (alinhadas com fl[2..4] do roster). h/f mapeiam para coluna
  // ST_CF0_COL + n (n = faltas registradas até halftime/total).
  const ST_CF0_COL = 2;
  const ST_BOXES = 3;
  const computeStSeps = (faltasSt) => {
    const stSlots = montarSlotsFalta(faltasSt || []).slice(0, ST_BOXES);
    const n2 = stSlots.filter((s) => s.quarto <= 2).length;
    const nTotal = Math.min(stSlots.length, ST_BOXES);
    const h =
      halftimePassed && n2 < ST_BOXES ? ST_CF0_COL + n2 : null;
    const f =
      jogoFinalizado && nTotal < ST_BOXES ? ST_CF0_COL + nTotal : null;
    return { h, f, slots: stSlots, listed: true, st: true };
  };
  seps.push(computeStSeps(faltasTecnico)); // idx 12 — técnico
  seps.push(computeStSeps(faltasAssistente)); // idx 13 — assistente

  // Ponte da última linha de jogadores (i=11) para o bloco do técnico. Como
  // o técnico ocupa só cf[0..2] (cols 2..4), as células dos cols 0 e 1 ficam
  // dentro do colspan=5 do rótulo, sem onde aplicar hsep. Usamos hsep-bot na
  // linha 11 para cobrir essas colunas inacessíveis durante a transição.
  const bridgeBotCols = new Set();
  {
    const last = seps[11];
    const tecSep = seps[12];
    const bridgeRange = (a, b) => {
      for (let c = Math.min(a, b); c < Math.max(a, b); c++) {
        if (c < ST_CF0_COL) bridgeBotCols.add(c);
      }
    };
    if (last.h !== null && tecSep.h !== null && last.h !== tecSep.h) {
      bridgeRange(last.h, tecSep.h);
    }
    if (last.f !== null && tecSep.f !== null && last.f !== tecSep.f) {
      bridgeRange(last.f, tecSep.f);
    }
  }
  const cellSepClass = (i, c) => {
    const curr = seps[i];
    const prev = i > 0 ? seps[i - 1] : { h: null, f: null };
    let cls = "";
    if (curr.h === c || curr.f === c) cls += " vsep";
    const inRange = (a, b) => Math.min(a, b) <= c && c < Math.max(a, b);
    const topFromH = curr.h !== null && prev.h !== null && curr.h !== prev.h && inRange(curr.h, prev.h);
    const topFromF = curr.f !== null && prev.f !== null && curr.f !== prev.f && inRange(curr.f, prev.f);
    if (topFromH || topFromF) cls += " hsep";
    if (i === 11 && bridgeBotCols.has(c)) cls += " hsep-bot";
    return cls;
  };
  let rows = "";
  for (let i = 0; i < 12; i++) {
    const j = sorted[i];
    if (!j) {
      // Linha "fantasma" (jogador não inscrito) — marcada .unlisted para que
      // as caixas de falta não recebam o traço de fim de jogo. A PRIMEIRA
      // linha vazia (i === K) leva .nm-strike-row para que o traço horizontal
      // azul FIBA B.3.3.3 passe por cima das células nome/Nº/E. mantendo as
      // bordas laterais normais. Na ÚLTIMA linha (i===11), a 5ª caixa de falta
      // recebe .fl-diag + o SVG da diagonal ancorado em right:0/bottom:0.
      const isFirstEmpty = i === K;
      const rowCls = isFirstEmpty ? "unlisted nm-strike-row" : "unlisted";
      const isLastRow = i === 11;
      const flCells = [0,1,2,3,4].map((c) => {
        const isAnchor = isLastRow && c === 4 && emptyRows > 0;
        const extra = cellSepClass(i, c) + (isAnchor ? " fl-diag" : "");
        const inner = isAnchor ? diagSvg : "";
        return `<td class="fl${extra}">${inner}</td>`;
      }).join("");
      rows += `<tr class="${rowCls}"><td class="nm">&nbsp;</td><td class="nu"></td><td class="en"></td>${flCells}<td class="dq"></td></tr>`;
      continue;
    }
    const nome = esc(atletaNome(j)).toUpperCase();
    const aid = atletaIdStr(j);
    const slots = seps[i].slots;
    // 5 caixas visíveis de falta; as classes .vsep/.hsep vêm de cellSepClass.
    const faltaCells = [0,1,2,3,4].map((idx) => {
      const extra = cellSepClass(i, idx);
      const s = slots[idx];
      if (!s) return `<td class="fl${extra}"></td>`;
      return `<td class="fl ${faltaQuartoCls(s.quarto)}${extra}">${esc(s.text)}</td>`;
    }).join("");
    const entrada = entradaDadosJogador(sumula, eventos, aid);
    const entCell = entrada.entrou
      ? entSvg(entQuartoColor(entrada.quarto), entrada.titular)
      : "";
    const num = j.numero ?? "";
    // 6ª célula invisível — só aparece quando a regra FIBA gerou um 6º slot,
    // isto é, quando a 5ª falta do jogador foi o gatilho de desqualificação
    // (p.ex. 2ª U como 5ª falta → slots[4]=U, slots[5]=GD). Se a
    // desqualificação ocorreu antes da 5ª falta, o GD cai naturalmente em uma
    // das 5 caixas visíveis e o 6º espaço fica vazio.
    // 6ª coluna invisível agora aceita ATÉ 2 marcações empilhadas (uma em cima
    // e outra embaixo no mesmo canto). FIBA B.8.3.13 prevê casos como
    // "B2 / B2" no técnico ou "D / F" em jogador excluído + briga, em que
    // duas letras precisam ocupar o mesmo espaço-canto.
    const slot6 = slots[5];
    const slot7 = slots[6];
    let dqCell;
    if (slot6 && slot7) {
      dqCell = `<td class="dq dq-stack"><span class="dq-top ${faltaQuartoCls(slot6.quarto)}">${esc(slot6.text)}</span><span class="dq-bot ${faltaQuartoCls(slot7.quarto)}">${esc(slot7.text)}</span></td>`;
    } else if (slot6) {
      dqCell = `<td class="dq ${faltaQuartoCls(slot6.quarto)}">${esc(slot6.text)}</td>`;
    } else {
      dqCell = `<td class="dq"></td>`;
    }
    rows += `<tr>
      <td class="nm">${nome}${j.capitao ? " (C)" : ""}</td>
      <td class="nu">${num}</td>
      <td class="en">${entCell}</td>
      ${faltaCells}
      ${dqCell}
    </tr>`;
  }
  // Linhas do técnico e 1º assistente técnico — agora parte da própria tabela
  // .R. colspan=5 no rótulo+nome cobre NOME/Nº/E./fl1/fl2 (79,4%), deixando
  // as 3 caixinhas de falta técnica alinhadas com fl3/fl4/fl5 e a célula
  // espaçadora à direita sob a coluna de desqualificação.
  const stRow = (label, nome, sigSrc, rowIdx) => {
    const sigImg = sigSrc
      ? `<img class="sig-tec" src="${sigSrc}" alt="assinatura" />`
      : "";
    const stSlots = seps[rowIdx].slots || [];
    // cf[0..2] mapeiam para fl-coord 2..4. cellSepClass opera em fl-coord, então
    // o zigue-zague flui continuamente do roster para a comissão técnica.
    const cfCells = [0, 1, 2]
      .map((i) => {
        const flCol = ST_CF0_COL + i;
        const sl = stSlots[i];
        const sepCls = cellSepClass(rowIdx, flCol);
        const qCls = sl ? ` ${faltaQuartoCls(sl.quarto)}` : "";
        return `<td class="cf${sepCls}${qCls}">${sl ? esc(sl.text) : ""}</td>`;
      })
      .join("");
    return `
    <tr class="st-row">
      <td class="st-hd" colspan="5"><div class="st-inner"><span class="st-lbl">${label}</span><span class="sv">${nome}</span>${sigImg}</div></td>
      ${cfCells}
      <td class="dq"></td>
    </tr>`;
  };
  const tecRow = stRow("TÉCNICO", tec || "", tecSig || "", 12);
  const assRow = stRow("1º ASSIST. TÉCNICO", ass || "", "", 13);
  return `
    <table class="R${jogoFinalizado ? " final" : ""}">
      ${colgroup}
      <thead><tr>
        <th>NOME DOS JOGADORES</th>
        <th>Nº</th>
        <th>E.</th>
        <th colspan="5">FALTAS</th>
        <th class="dq"></th>
      </tr></thead>
      <tbody>${rows}${tecRow}${assRow}</tbody>
    </table>`;
};

const renderTeamBlock = ({ sumula, eventos, equipe, label, nome, jogadores, comissao }) => {
  const tempos = timeoutsPorMetade(eventos, equipe);
  const faltas = boxesPorQuarto(eventos, equipe, "falta");
  const tec = esc(tecnicoNome(comissao)).toUpperCase();
  const ass = esc(assistenteNome(comissao)).toUpperCase();
  const tecSig = tecnicoAssinatura(comissao) || "";
  // Resolve ids para extrair faltas C/B da comissao tecnica.
  const tecMembro = (comissao || []).find(
    (m) => /t[eé]cnico$/i.test(m.funcao || "") && !/assist/i.test(m.funcao || ""),
  );
  const assMembro = (comissao || []).find((m) => /assist/i.test(m.funcao || ""));
  const tecId = tecMembro?.tecnico_id ? String(tecMembro.tecnico_id) : null;
  const assId = assMembro?.tecnico_id ? String(assMembro.tecnico_id) : null;
  // Tecnico principal recebe C/B/B2 (incluindo cascata B.8.3.10) + eventual D
  // se for desqualificado diretamente.
  const filtrarFaltasTecnico = (alvoId) =>
    eventos
      .filter(
        (e) =>
          e.tipo === "falta" &&
          !e.cancelado &&
          e.equipe === equipe &&
          ["C", "B", "D"].includes(e.tipo_falta) &&
          alvoId &&
          e.tecnico_id &&
          String(e.tecnico_id) === alvoId,
      )
      .sort((a, b) => a.sequencia - b.sequencia);
  // Assistente so pode receber D. Listar so os Ds atribuidos a ele.
  const filtrarFaltasAssistente = (alvoId) =>
    eventos
      .filter(
        (e) =>
          e.tipo === "falta" &&
          !e.cancelado &&
          e.equipe === equipe &&
          e.tipo_falta === "D" &&
          alvoId &&
          e.tecnico_id &&
          String(e.tecnico_id) === alvoId,
      )
      .sort((a, b) => a.sequencia - b.sequencia);
  const faltasTecnico = filtrarFaltasTecnico(tecId);
  const faltasAssistente = filtrarFaltasAssistente(assId);

  // Técnico e 1º assistente são emitidos como as duas últimas linhas da
  // própria tabela .R (renderRoster), preservando a estrutura FIBA sem ter
  // uma tabela separada abaixo do roster. O zigue-zague de fim de metade /
  // fim de jogo agora flui também sobre as faltas C/B/D do técnico e o D do
  // assistente — calculado dentro de renderRoster.
  return `
  <div class="T">
    <div class="T-hd">
      <span>${label}</span>
      <span class="tn">${esc(nome)}</span>
    </div>
    <div class="ctrl">
      ${renderTemposDebitados(tempos)}
      ${renderFaltasEquipe(faltas)}
    </div>
    ${renderRoster(jogadores, eventos, sumula, tec, ass, tecSig, faltasTecnico, faltasAssistente)}
  </div>`;
};

/* ====================================================================
   RENDER — Contagem Progressiva (Running Score)
   Numeração contínua 1→160, rastreio independente de A e B
   ==================================================================== */

const renderContagemProgressiva = (eventos, sumula) => {
  const cp = gerarContagemProgressiva(eventos, sumula);
  const ROWS = 40;

  // Colgroup: 4 macrocolunas × (A-camisa, A-índice, B-índice, B-camisa)  — padrão FIBA espelhado
  const colgroup = `<colgroup>
    ${"<col style='width:5.5%'/><col style='width:7%'/><col style='width:7%'/><col style='width:5.5%'/>".repeat(4)}
  </colgroup>`;

  // Cabeçalho: TIME A (camisa+índice) | TIME B (índice+camisa)
  let headerCells = "";
  for (let m = 0; m < 4; m++) {
    const macroSep = m < 3 ? " ms" : "";
    headerCells += `<th colspan="2" class="hA mid">A</th><th colspan="2" class="hB${macroSep}">B</th>`;
  }

  const qCls = (q) => {
    if (q === 1) return "q1";
    if (q === 2) return "q2";
    if (q === 3) return "q3";
    if (q === 4) return "q4";
    if (q && q > 4) return "qe";
    return "";
  };

  const idxCell = (n, val, extraCls) => {
    const base = "cn" + (extraCls ? " " + extraCls : "");
    const q = qCls(val?.quarto);
    const qExt = q ? " " + q : "";
    const eoqExt = val?.endOfQuarter ? " eoq" : "";

    // O número do índice é sempre renderizado (pré-impresso na súmula).
    // No caso de 1pt o disco é sobreposto por cima via position:absolute,
    // sem remover o número de trás.
    let numInner = `<span class="num">${n}</span>`;
    if (val?.endOfQuarter) numInner = `<span class="idxwrap">${numInner}</span>`;

    let cls = base + qExt + eoqExt;
    if (val?.filled) {
      cls += " filled";
      return `<td class="${cls}"><span class="ib">${numInner}</span></td>`;
    }
    if (val?.diagonal) {
      cls += " d3";
      return `<td class="${cls}"><span class="ib">${numInner}</span></td>`;
    }
    return `<td class="${cls}">${numInner}</td>`;
  };

  const jerseyCell = (val, teamCls, extraCls) => {
    const q = qCls(val?.quarto);
    const qExt = q ? " " + q : "";
    const eoqExt = val?.endOfQuarter ? " eoq" : "";
    const cls = teamCls + (extraCls ? " " + extraCls : "") + qExt + eoqExt;
    const j = val?.jersey ?? "";
    if (!j) return `<td class="${cls}"></td>`;
    if (val.circle) return `<td class="${cls}"><span class="c3">${esc(j)}</span></td>`;
    return `<td class="${cls}">${esc(j)}</td>`;
  };

  // Encerramento do jogo: linhas abaixo do último ponto da equipe, dentro do
  // mesmo macrobloco, recebem um traço vertical central na cor do último quarto
  const inCloseRange = (n, endIdx) => {
    if (endIdx == null) return false;
    const pos = n - 1;
    return pos > endIdx && Math.floor(pos / 40) === Math.floor(endIdx / 40);
  };

  // Linhas de dados
  let dataRows = "";
  for (let r = 0; r < ROWS; r++) {
    let cells = "";
    for (let m = 0; m < 4; m++) {
      const n = m * ROWS + r + 1;       // Índice do ponto: 1-40, 41-80, 81-120, 121-160
      const aVal = cp.aScores[n - 1] ?? null;
      const bVal = cp.bScores[n - 1] ?? null;
      const macroSep = m < 3 ? " ms" : "";

      const aClose = inCloseRange(n, cp.aGameEndIdx);
      const bClose = inCloseRange(n, cp.bGameEndIdx);
      const aVl = aClose ? ` vline ${qCls(cp.aGameEndQuarto)}` : "";
      const bVl = bClose ? ` vline ${qCls(cp.bGameEndQuarto)}` : "";

      cells +=
        jerseyCell(aVal, "ca", aVl.trim()) +
        idxCell(n, aVal, ("mid" + aVl).trim()) +
        idxCell(n, bVal, bVl.trim()) +
        jerseyCell(bVal, "cb", (macroSep + bVl).trim());
    }
    dataRows += `<tr>${cells}</tr>`;
  }

  return `
  <div class="Mr">
    <div class="cp-ttl">CONTAGEM PROGRESSIVA</div>
    <table class="cp">
      ${colgroup}
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${dataRows}</tbody>
    </table>
  </div>`;
};

/* ====================================================================
   RENDER — Rodapé de Encerramento
   ==================================================================== */

const renderFooter = (sumula, estado) => {
  const mesa = sumula.mesa || {};
  const placarA = sumula.placar_final?.pontos_a ?? estado.placar.A;
  const placarB = sumula.placar_final?.pontos_b ?? estado.placar.B;
  const nA = equipeNome(sumula.equipe_a_id).toUpperCase();
  const nB = equipeNome(sumula.equipe_b_id).toUpperCase();
  const venc = placarA > placarB ? nA : placarB > placarA ? nB : "EMPATE";
  const hFim = fmtHora(sumula.hora_fim);
  const prot = sumula.protesto?.houve;

  const pq = (q) => {
    const p = (sumula.placar_por_quarto || []).find((x) => x.quarto === q);
    return { a: p?.pontos_a ?? estado.placar_por_quarto?.[q]?.A ?? 0, b: p?.pontos_b ?? estado.placar_por_quarto?.[q]?.B ?? 0 };
  };
  const q1=pq(1), q2=pq(2), q3=pq(3), q4=pq(4);

  return `
  <div class="F">
    <!-- METADE ESQUERDA: Mesa + Arbitragem -->
    <div class="Fl">
      <table class="mt" style="flex:1">
        <tr><td class="ml">APONTADOR</td><td class="mv">${esc(mesa.apontador||"")}</td><td class="ms-sign">${sigImg(mesa.apontador_assinatura)}</td></tr>
        <tr><td class="ml">CRONOMETRISTA</td><td class="mv">${esc(mesa.cronometrista||"")}</td><td class="ms-sign">${sigImg(mesa.cronometrista_assinatura)}</td></tr>
        <tr><td class="ml">OPERADOR 24S</td><td class="mv">${esc(mesa.operador_24s||"")}</td><td class="ms-sign">${sigImg(mesa.operador_24s_assinatura)}</td></tr>
        <tr><td class="ml">REPRESENTANTE</td><td class="mv">${esc(mesa.representante||"")}</td><td class="ms-sign">${sigImg(mesa.representante_assinatura)}</td></tr>
      </table>
      <div class="arb">
        <div class="arb-r"><span class="L">CREW CHIEF</span><div class="sig">${sigImg(sumula.arbitragem?.crew_chief_assinatura)}</div></div>
        <div class="arb-r">
          <span class="L">FISCAL 1</span><div class="sig">${sigImg(sumula.arbitragem?.fiscal_1_assinatura)}</div>
          <span class="L" style="margin-left:6px">FISCAL 2</span><div class="sig">${sigImg(sumula.arbitragem?.fiscal_2_assinatura)}</div>
        </div>
      </div>
    </div>

    <!-- METADE DIREITA: Placar + Resultado + Protesto -->
    <div class="Fr">
      <div class="sc">
        <div class="sc-ln">
          <span class="qt">QUARTO</span>
          <span class="qc">1</span>
          <span class="sp">A <span class="sb">${q1.a}</span> B <span class="sb">${q1.b}</span></span>
          <span class="qc">2</span>
          <span class="sp">A <span class="sb">${q2.a}</span> B <span class="sb">${q2.b}</span></span>
        </div>
        <div class="sc-ln">
          <span class="qt">QUARTO</span>
          <span class="qc">3</span>
          <span class="sp">A <span class="sb">${q3.a}</span> B <span class="sb">${q3.b}</span></span>
          <span class="qc">4</span>
          <span class="sp">A <span class="sb">${q4.a}</span> B <span class="sb">${q4.b}</span></span>
        </div>
        <div class="sc-ln">
          <span class="qt">QUARTOS EXTRAS</span>
          <span class="sp">A <span class="sb">-</span> B <span class="sb">-</span></span>
        </div>
      </div>

      <div class="rs">
        <div class="rs-ln">
          <span class="L">PONTUAÇÃO FINAL</span>
          <span class="sp">A <span class="sb">${placarA}</span> B <span class="sb">${placarB}</span></span>
        </div>
        <div class="rs-ln">
          <span class="L">EQUIPE VENCEDORA</span>
          <div class="wv">${esc(venc)}</div>
        </div>
      </div>

      <div class="pr">
        <div class="pr-row">
          <div><strong>SÚMULA FOI PROTESTADA?</strong><br/><span class="V" style="font-size:7px">${prot ? "SIM" : "NÃO"}</span></div>
          <div><strong>ASSINATURA DO CAPITÃO EM CASO DE PROTESTO</strong><br/>
            <span style="font-size:6px;color:#666">${prot ? esc(sumula.protesto?.descricao || "") : ""}</span>
          </div>
        </div>
        <div class="end-row">
          <strong>FIM DE JOGO ÀS (HH:MM)</strong>
          <span class="V">${esc(hFim)}</span>
        </div>
      </div>
    </div>
  </div>`;
};

/* ====================================================================
   PÁGINA 1 — Súmula Principal (Frente)
   ==================================================================== */

const gerarPagina1 = ({ sumula, estado, eventos }) => {
  const nA = equipeNome(sumula.equipe_a_id).toUpperCase();
  const nB = equipeNome(sumula.equipe_b_id).toUpperCase();

  return `
  <div class="page">
    ${renderHeader(sumula)}

    <div class="M">
      <div class="Ml">
        ${renderTeamBlock({ sumula, eventos, equipe: "A", label: "EQUIPE A", nome: nA, jogadores: sumula.jogadores_a, comissao: sumula.comissao_a })}
        ${renderTeamBlock({ sumula, eventos, equipe: "B", label: "EQUIPE B", nome: nB, jogadores: sumula.jogadores_b, comissao: sumula.comissao_b })}
      </div>
      ${renderContagemProgressiva(eventos, sumula)}
    </div>

    ${renderFooter(sumula, estado)}
  </div>`;
};

/* ====================================================================
   PÁGINA 2 — Resumo Técnico (Verso)
   ==================================================================== */

const renderResumoTeam = ({ nome, label, resumo }) => {
  const hasExtra = resumo.hasExtra;
  const qColor = (q) => (q === 1 || q === 3 ? "qr" : "qb");
  const qCell = (r, q) => {
    const cls = qColor(q);
    const entrouAte = r.entrou && r.quartoEntrada != null && r.quartoEntrada <= q;
    if (!entrouAte) return `<td class="${cls} dashq"></td>`;
    return `<td class="${cls}">${r[`q${q}`]}</td>`;
  };
  const extraCell = (r) => {
    if (!hasExtra || !r.entrou) return `<td class="qb dashq"></td>`;
    return `<td class="qb">${r.extra}</td>`;
  };
  const totalCell = (r) => {
    if (!r.entrou) return `<td class="qb dashq"></td>`;
    return `<td class="qb"><strong>${r.total}</strong></td>`;
  };

  let rows = resumo.linhas
    .map((r) => `<tr>
      <td class="rn">${r.numero ?? ""}</td>
      ${qCell(r, 1)}
      ${qCell(r, 2)}
      ${qCell(r, 3)}
      ${qCell(r, 4)}
      ${extraCell(r)}
      ${totalCell(r)}
    </tr>`)
    .join("");

  // Preencher até 12 linhas — jogadores não-listados: camisa vazia, traços em todos os quartos
  for (let i = resumo.linhas.length; i < 12; i++) {
    rows += `<tr>
      <td class="rn">&nbsp;</td>
      <td class="qr dashq"></td>
      <td class="qb dashq"></td>
      <td class="qr dashq"></td>
      <td class="qb dashq"></td>
      <td class="qb dashq"></td>
      <td class="qb dashq"></td>
    </tr>`;
  }

  const t = resumo.totais;
  const extraTot = hasExtra ? t.extra : "-";
  return `
  <div class="rt">
    <h5>${esc(nome)}</h5>
    <div class="sub">${label}</div>
    <div class="stt">RESUMO TÉCNICO SOBRE OS MARCADORES</div>
    <table class="rtb">
      <thead>
        <tr><th rowspan="2" class="rn-th">Nº<br/>JOGO</th><th colspan="5">QUARTO</th><th rowspan="2" class="qb">TOTAL</th></tr>
        <tr><th class="qr">1º</th><th class="qb">2º</th><th class="qr">3º</th><th class="qb">4º</th><th class="qb">EXTRA</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="tot">
          <td>TOTAL<br/>EQUIPE</td>
          <td class="qr">${t.q1}</td>
          <td class="qb">${t.q2}</td>
          <td class="qr">${t.q3}</td>
          <td class="qb">${t.q4}</td>
          <td class="qb">${extraTot}</td>
          <td class="qb">${t.total}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
};

const gerarPagina2 = ({ sumula, eventos }) => {
  const nA = equipeNome(sumula.equipe_a_id).toUpperCase();
  const nB = equipeNome(sumula.equipe_b_id).toUpperCase();
  const resumoA = gerarResumoTecnico(eventos, sumula.jogadores_a, sumula);
  const resumoB = gerarResumoTecnico(eventos, sumula.jogadores_b, sumula);
  const num = esc(numeroJogo(sumula));

  return `
  <div class="page">
    <div class="p2h"><span>Nº</span><div class="jb">${num}</div></div>
    <div class="p2t">INFORMAÇÃO DOS ÁRBITROS</div>

    <div class="p2sm">${sigImg(sumula.arbitragem?.crew_chief_assinatura, "p2sig") || "&nbsp;"}</div>
    <div class="p2sl">ASSINATURA DO ÁRBITRO${sumula.arbitragem?.crew_chief ? ` — ${esc(sumula.arbitragem.crew_chief.toUpperCase())}` : ""}</div>

    <div class="p2sg">
      <div class="p2si"><div class="ln">${sigImg(sumula.arbitragem?.fiscal_1_assinatura, "p2sig") || "&nbsp;"}</div><div class="lb">ASSINATURA DO FISCAL 1${sumula.arbitragem?.fiscal_1 ? ` — ${esc(sumula.arbitragem.fiscal_1.toUpperCase())}` : ""}</div></div>
      <div class="p2si"><div class="ln">${sigImg(sumula.arbitragem?.fiscal_2_assinatura, "p2sig") || "&nbsp;"}</div><div class="lb">ASSINATURA DO FISCAL 2${sumula.arbitragem?.fiscal_2 ? ` — ${esc(sumula.arbitragem.fiscal_2.toUpperCase())}` : ""}</div></div>
    </div>

    <div class="rg">
      ${renderResumoTeam({ nome: nA, label: "EQUIPE A", resumo: resumoA })}
      ${renderResumoTeam({ nome: nB, label: "EQUIPE B", resumo: resumoB })}
    </div>

  </div>`;
};

/* ====================================================================
   HTML FINAL
   ==================================================================== */

const montarHtml = (dados) => `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"/><title>Súmula Oficial FIBA</title><style>${CSS}</style></head>
<body>${gerarPagina1(dados)}${gerarPagina2(dados)}</body>
</html>`;

/* ====================================================================
   GERAÇÃO DO PDF (Puppeteer)
   ==================================================================== */

let _browserPromise = null;
const getBrowser = async () => {
  if (!_browserPromise) {
    _browserPromise = puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return _browserPromise;
};

export const gerarSumulaPdf = async (dados) => {
  await precarregarAssinaturas(dados?.sumula);
  const html = montarHtml(dados);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return pdf;
  } finally {
    await page.close();
  }
};

export const fecharBrowserPdf = async () => {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close();
    _browserPromise = null;
  }
};
