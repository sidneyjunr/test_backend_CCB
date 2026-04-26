/*
 * Gera uma súmula de teste sem tocar no banco. Monta um objeto `dados` com a
 * estrutura que `gerarSumulaPdf` espera (sumula + estado + eventos) e salva o
 * PDF resultante em SUMULA_TEST.pdf na raiz do projeto.
 *
 * Cenário montado:
 *   - Equipe A ("LEÕES DE FORTALEZA"): 10 atletas (2 linhas vazias para
 *     exercitar o traço horizontal B.3.3.3 + a diagonal sobre as faltas
 *     vazias).
 *   - Equipe B ("ÁGUIAS BASQUETE"): 12 atletas (roster completo).
 *   - 5 titulares por equipe, 1 capitão por equipe.
 *   - Substituições no Q2 e Q3: titulares saem, reservas entram. Exercita o
 *     fix do em_quadra — após as substituições, `titular` (iniciais) fica
 *     imutável, `em_quadra` acompanha as trocas.
 *   - Pontos, faltas e timeouts distribuídos entre os 4 quartos.
 *
 * Execução: node scripts/gerar-sumula-teste.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gerarSumulaPdf, fecharBrowserPdf } from "../services/sumulaPdfService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- IDs (strings — o service aceita string como atleta_id._id) ----------
const ATL = (prefix, n) => `${prefix}${String(n).padStart(3, "0")}`;
const JOGO_ID = "jogo_test_001";
const COMP_ID = "comp_test_001";
const EQ_A_ID = "equipe_a_id";
const EQ_B_ID = "equipe_b_id";

// ---------- Helpers ----------
let seq = 0;
const nextSeq = () => ++seq;
const mkJog = ({ id, nome, numero, titular, capitao = false, faltas = 0 }) => ({
  atleta_id: { _id: id, nome_completo: nome },
  numero,
  titular,
  em_quadra: titular,
  capitao,
  faltas,
  excluido: false,
  desqualificado: false,
});

// ---------- Jogadores Equipe A (10 atletas — 2 slots ficam vazios) ----------
const jogadoresA = [
  mkJog({ id: ATL("A", 1),  nome: "Marcelo Silva Oliveira",      numero: 4,  titular: true, capitao: true }),
  mkJog({ id: ATL("A", 2),  nome: "Rafael Nascimento Costa",     numero: 7,  titular: true }),
  mkJog({ id: ATL("A", 3),  nome: "Lucas Pereira Gomes",         numero: 10, titular: true }),
  mkJog({ id: ATL("A", 4),  nome: "Fernando Alves Dias",         numero: 12, titular: true }),
  mkJog({ id: ATL("A", 5),  nome: "Rodrigo Barbosa Lima",        numero: 15, titular: true }),
  mkJog({ id: ATL("A", 6),  nome: "Thiago Rocha Martins",        numero: 21, titular: false }),
  mkJog({ id: ATL("A", 7),  nome: "Paulo Henrique Souza",        numero: 22, titular: false }),
  mkJog({ id: ATL("A", 8),  nome: "Bruno Carvalho Araújo",       numero: 23, titular: false }),
  mkJog({ id: ATL("A", 9),  nome: "Diego Ferreira Mendes",       numero: 24, titular: false }),
  mkJog({ id: ATL("A", 10), nome: "Gustavo Ribeiro Cardoso",     numero: 30, titular: false }),
];

// ---------- Jogadores Equipe B (12 atletas — roster completo) ----------
const jogadoresB = [
  mkJog({ id: ATL("B", 1),  nome: "Eduardo Moraes Teixeira",     numero: 3,  titular: true, capitao: true }),
  mkJog({ id: ATL("B", 2),  nome: "Rodrigo Pinto Machado",       numero: 5,  titular: true }),
  mkJog({ id: ATL("B", 3),  nome: "André Luiz Castro",           numero: 8,  titular: true }),
  mkJog({ id: ATL("B", 4),  nome: "Felipe Ramos Nogueira",       numero: 11, titular: true }),
  mkJog({ id: ATL("B", 5),  nome: "Victor Hugo Almeida",         numero: 14, titular: true }),
  mkJog({ id: ATL("B", 6),  nome: "Matheus Correia Pires",       numero: 17, titular: false }),
  mkJog({ id: ATL("B", 7),  nome: "Ricardo Freitas Lopes",       numero: 19, titular: false }),
  mkJog({ id: ATL("B", 8),  nome: "Caio Vinicius Brito",         numero: 20, titular: false }),
  mkJog({ id: ATL("B", 9),  nome: "João Pedro Vasconcelos",      numero: 25, titular: false }),
  mkJog({ id: ATL("B", 10), nome: "Igor Santana Figueiredo",     numero: 27, titular: false }),
  mkJog({ id: ATL("B", 11), nome: "Leonardo Medeiros Siqueira",  numero: 33, titular: false }),
  mkJog({ id: ATL("B", 12), nome: "Felix Vitor Barros",          numero: 44, titular: false }),
];

// ---------- Eventos ----------
const eventos = [];
const addPonto = (quarto, equipe, jogador_id, valor) => {
  eventos.push({
    sequencia: nextSeq(),
    tipo: "ponto",
    quarto,
    equipe,
    jogador_id,
    valor,
    cancelado: false,
  });
};
const addFalta = (quarto, equipe, jogador_id, tipo_falta, lances_livres = 0) => {
  eventos.push({
    sequencia: nextSeq(),
    tipo: "falta",
    quarto,
    equipe,
    jogador_id,
    tipo_falta,
    lances_livres,
    cancelado: false,
  });
};
const addTimeout = (quarto, equipe, minuto_jogo) => {
  eventos.push({
    sequencia: nextSeq(),
    tipo: "timeout",
    quarto,
    equipe,
    minuto_jogo,
    cancelado: false,
  });
};
const addSub = (quarto, equipe, jogador_sai_id, jogador_entra_id) => {
  eventos.push({
    sequencia: nextSeq(),
    tipo: "substituicao",
    quarto,
    equipe,
    jogador_sai_id,
    jogador_entra_id,
    cancelado: false,
  });
};
const addFimQuarto = (quarto) => {
  eventos.push({
    sequencia: nextSeq(),
    tipo: "fim_quarto",
    quarto,
    cancelado: false,
  });
};

// --- Q1 ---
addPonto(1, "A", ATL("A", 1), 2);
addPonto(1, "B", ATL("B", 3), 3);
addPonto(1, "A", ATL("A", 3), 2);
addFalta(1, "B", ATL("B", 2), "P");
addPonto(1, "A", ATL("A", 2), 2);
addPonto(1, "B", ATL("B", 1), 2);
addFalta(1, "A", ATL("A", 4), "P", 2);
addPonto(1, "B", ATL("B", 4), 1);
addPonto(1, "B", ATL("B", 4), 1);
addPonto(1, "A", ATL("A", 5), 3);
addTimeout(1, "B", 4);
addPonto(1, "A", ATL("A", 1), 2);
addPonto(1, "B", ATL("B", 5), 2);
addFimQuarto(1);

// --- Q2: substituições (testa o fix em_quadra) ---
addSub(2, "A", ATL("A", 2), ATL("A", 6));   // #7 sai, #21 entra (Equipe A)
addSub(2, "B", ATL("B", 4), ATL("B", 8));   // #11 sai, #20 entra (Equipe B)
addPonto(2, "A", ATL("A", 6), 2);            // reserva pontua
addPonto(2, "B", ATL("B", 1), 3);
addFalta(2, "A", ATL("A", 3), "P");
addPonto(2, "A", ATL("A", 4), 2);
addFalta(2, "B", ATL("B", 3), "P", 1);
addPonto(2, "B", ATL("B", 3), 1);
addPonto(2, "A", ATL("A", 1), 3);
addFalta(2, "A", ATL("A", 6), "P");          // reserva comete falta
addPonto(2, "B", ATL("B", 8), 2);            // reserva B pontua
addTimeout(2, "A", 6);
addPonto(2, "A", ATL("A", 5), 2);
addFimQuarto(2);

// --- Q3: mais substituições ---
addSub(3, "A", ATL("A", 3), ATL("A", 7));   // #10 sai, #22 entra (Equipe A)
addSub(3, "B", ATL("B", 5), ATL("B", 9));   // #14 sai, #25 entra (Equipe B)
addPonto(3, "B", ATL("B", 9), 2);
addPonto(3, "A", ATL("A", 7), 3);            // reserva entra no Q3 e pontua
addFalta(3, "A", ATL("A", 1), "P");
addPonto(3, "B", ATL("B", 1), 2);
addPonto(3, "A", ATL("A", 4), 2);
addFalta(3, "B", ATL("B", 1), "T");
addPonto(3, "A", ATL("A", 5), 1);
addPonto(3, "A", ATL("A", 5), 1);
addTimeout(3, "B", 3);
addPonto(3, "B", ATL("B", 3), 3);
addFimQuarto(3);

// --- Q4 ---
addPonto(4, "A", ATL("A", 1), 2);
addPonto(4, "B", ATL("B", 9), 3);
addFalta(4, "A", ATL("A", 4), "P");
addPonto(4, "A", ATL("A", 4), 1);
addPonto(4, "B", ATL("B", 8), 2);
addFalta(4, "B", ATL("B", 2), "P");
addPonto(4, "A", ATL("A", 7), 2);
addPonto(4, "A", ATL("A", 1), 2);
addPonto(4, "B", ATL("B", 3), 2);
addFalta(4, "A", ATL("A", 5), "P");
addTimeout(4, "A", 2);
addPonto(4, "B", ATL("B", 1), 1);
addPonto(4, "A", ATL("A", 5), 3);
addFimQuarto(4);

// ---------- Marca em_quadra pós-substituições (reflete estado final) ----------
// Equipe A: Q2 sai A2 entra A6; Q3 sai A3 entra A7 → em quadra no fim: A1, A4, A5, A6, A7
// Equipe B: Q2 sai B4 entra B8; Q3 sai B5 entra B9 → em quadra no fim: B1, B2, B3, B8, B9
const aplicarSubs = (jogadores, subs) => {
  for (const { sai, entra } of subs) {
    const jS = jogadores.find((j) => j.atleta_id._id === sai);
    const jE = jogadores.find((j) => j.atleta_id._id === entra);
    if (jS) jS.em_quadra = false;
    if (jE) jE.em_quadra = true;
  }
};
aplicarSubs(jogadoresA, [
  { sai: ATL("A", 2), entra: ATL("A", 6) },
  { sai: ATL("A", 3), entra: ATL("A", 7) },
]);
aplicarSubs(jogadoresB, [
  { sai: ATL("B", 4), entra: ATL("B", 8) },
  { sai: ATL("B", 5), entra: ATL("B", 9) },
]);

// ---------- Atualiza contadores de faltas nos jogadores ----------
for (const ev of eventos) {
  if (ev.tipo !== "falta") continue;
  const lista = ev.equipe === "A" ? jogadoresA : jogadoresB;
  const jog = lista.find((j) => j.atleta_id._id === ev.jogador_id);
  if (jog && ["P", "U", "D", "T"].includes(ev.tipo_falta)) jog.faltas += 1;
}

// ---------- Placar por quarto (computado a partir dos eventos) ----------
const placarPorQuarto = [1, 2, 3, 4].map((q) => {
  const pontosQ = eventos.filter(
    (e) => e.tipo === "ponto" && !e.cancelado && e.quarto === q
  );
  const pontos_a = pontosQ
    .filter((e) => e.equipe === "A")
    .reduce((sum, e) => sum + e.valor, 0);
  const pontos_b = pontosQ
    .filter((e) => e.equipe === "B")
    .reduce((sum, e) => sum + e.valor, 0);
  return { quarto: q, pontos_a, pontos_b };
});
const totalA = placarPorQuarto.reduce((s, q) => s + q.pontos_a, 0);
const totalB = placarPorQuarto.reduce((s, q) => s + q.pontos_b, 0);

// ---------- Estado (faltas_jogador, pontos_jogador, etc.) ----------
const estado = {
  placar: { A: totalA, B: totalB },
  placar_por_quarto: Object.fromEntries(
    placarPorQuarto.map((p) => [p.quarto, { A: p.pontos_a, B: p.pontos_b }])
  ),
  faltas_equipe_por_quarto: {
    1: {
      A: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "A" && e.quarto === 1).length,
      B: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "B" && e.quarto === 1).length,
    },
    2: {
      A: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "A" && e.quarto === 2).length,
      B: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "B" && e.quarto === 2).length,
    },
    3: {
      A: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "A" && e.quarto === 3).length,
      B: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "B" && e.quarto === 3).length,
    },
    4: {
      A: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "A" && e.quarto === 4).length,
      B: eventos.filter((e) => e.tipo === "falta" && !e.cancelado && e.equipe === "B" && e.quarto === 4).length,
    },
  },
  timeouts: { A: {}, B: {} },
  faltas_jogador: {},
  pontos_jogador: {},
};
for (const ev of eventos) {
  if (ev.cancelado) continue;
  if (ev.tipo === "ponto") {
    estado.pontos_jogador[ev.jogador_id] = (estado.pontos_jogador[ev.jogador_id] || 0) + ev.valor;
  } else if (ev.tipo === "falta") {
    estado.faltas_jogador[ev.jogador_id] = (estado.faltas_jogador[ev.jogador_id] || 0) + 1;
  }
}

// ---------- Sumula (objeto plano — o service espera .toObject()) ----------
const sumula = {
  _id: "sumula_test_001",
  jogo_id: {
    _id: JOGO_ID,
    numero_jogo: 999,
    data_hora: new Date("2026-04-18T19:30:00-03:00"),
    local: "GINÁSIO PAULO SARASATE",
    cidade: "FORTALEZA",
  },
  competicao_id: { _id: COMP_ID, nome: "CCB 2025/2026", ano: 2026 },
  equipe_a_id: { _id: EQ_A_ID, nome_equipe: "LEÕES DE FORTALEZA" },
  equipe_b_id: { _id: EQ_B_ID, nome_equipe: "ÁGUIAS BASQUETE" },
  status: "finalizada",
  quarto_atual: 4,
  arbitragem: {
    crew_chief: "MARIA CLÁUDIA COMOGORNO MORAES",
    fiscal_1: "FERNANDO ARNEÍCIO GRAILCANTE LEITE",
    fiscal_2: "TABELADOR REVISADO",
  },
  mesa: {
    apontador: "FRANCISCO IVES SIMÕES MOURA",
    cronometrista: "TATIANE RODRIGUES DE OLIVEIRA",
    operador_24s: "RICARDO PONTES",
    representante: "CRISTIANO BARBOSA FERREIRA",
  },
  jogadores_a: jogadoresA,
  jogadores_b: jogadoresB,
  comissao_a: [
    { nome: "JELENA TODOROVIC", funcao: "Técnico" },
    { nome: "VLADIMIR DOSENOVIC", funcao: "1º Assistente Técnico" },
  ],
  comissao_b: [
    { nome: "LEANDRO ARMANDO HIRIART", funcao: "Técnico" },
    { nome: "RAFAEL MARTINS DOS SANTOS", funcao: "1º Assistente Técnico" },
  ],
  placar_por_quarto: placarPorQuarto,
  placar_final: { pontos_a: totalA, pontos_b: totalB },
  equipe_vencedora_id: totalA > totalB ? EQ_A_ID : EQ_B_ID,
  protesto: { houve: false, descricao: "" },
  hora_inicio: new Date("2026-04-18T19:30:00-03:00"),
  hora_fim: new Date("2026-04-18T21:15:00-03:00"),
  hash_finalizado: "SHA256-TEST-" + "A".repeat(56),
};

// ---------- Geração ----------
const main = async () => {
  console.log("[teste] montando PDF...");
  console.log(`[teste]   Equipe A (${jogadoresA.length} atletas): ${totalA} pontos`);
  console.log(`[teste]   Equipe B (${jogadoresB.length} atletas): ${totalB} pontos`);
  console.log(`[teste]   Eventos: ${eventos.length}`);

  const pdf = await gerarSumulaPdf({ sumula, estado, eventos });

  const outPath = path.join(__dirname, "..", "..", "SUMULA_TEST.pdf");
  fs.writeFileSync(outPath, pdf);
  console.log(`[teste] PDF salvo em: ${outPath}`);

  await fecharBrowserPdf();
};

main().catch((err) => {
  console.error("[teste] falhou:", err);
  fecharBrowserPdf().finally(() => process.exit(1));
});
