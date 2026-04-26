import crypto from "crypto";
import mongoose from "mongoose";

import { Sumula } from "../models/Sumula.js";
import {
  EventoSumula,
  TIPOS_FALTA_ENUM,
} from "../models/EventoSumula.js";
import { Jogo } from "../models/Jogo.js";
import { Escalacao } from "../models/Escalacao.js";
import { Inscricao } from "../models/Inscricao.js";
import { Arbitro } from "../models/Arbitro.js";
import { Tecnico } from "../models/Tecnico.js";
import { gerarSumulaPdf } from "../services/sumulaPdfService.js";

const FALTAS_PESSOAIS_LIMITE = 5;
// FIBA B.8.4: 2 TO na primeira metade, 3 na segunda metade.
// Nos ultimos 2 min do Q4, o tecnico ganha +1 TO adicional alem do limite.
const TIMEOUTS_PRIMEIRA_METADE = 2;
const TIMEOUTS_SEGUNDA_METADE = 3;
const TIMEOUTS_BONUS_ULTIMOS_2MIN = 1;
const QUARTO_FIM_PRIMEIRA_METADE = 2;
const QUARTO_FINAL = 4;

const limiteTimeoutsMetade = (metade) =>
  metade === "primeira" ? TIMEOUTS_PRIMEIRA_METADE : TIMEOUTS_SEGUNDA_METADE;

const getEquipeLabel = (sumula, equipeId) => {
  if (equipeId?.toString() === sumula.equipe_a_id.toString()) return "A";
  if (equipeId?.toString() === sumula.equipe_b_id.toString()) return "B";
  return null;
};

const findJogadorEmSumula = (sumula, equipe, atletaId) => {
  const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
  return lista.find(
    (j) => j.atleta_id.toString() === atletaId.toString()
  );
};

const computarEstado = async (sumulaId) => {
  const eventos = await EventoSumula.find({
    sumula_id: sumulaId,
    cancelado: false,
  }).sort({ sequencia: 1 });

  const estado = {
    placar: { A: 0, B: 0 },
    placar_por_quarto: {},
    faltas_equipe_por_quarto: {},
    timeouts: { A: { primeira: 0, segunda: 0 }, B: { primeira: 0, segunda: 0 } },
    faltas_jogador: {},
    pontos_jogador: {},
    eventos,
  };

  // Faltas que contam como pessoal do atleta (C e B sao do tecnico).
  const FALTAS_PESSOAIS = ["P", "P2", "U", "U2", "T", "D"];

  for (const ev of eventos) {
    if (ev.tipo === "ponto") {
      estado.placar[ev.equipe] += ev.valor;
      const key = ev.quarto;
      estado.placar_por_quarto[key] = estado.placar_por_quarto[key] || {
        A: 0,
        B: 0,
      };
      estado.placar_por_quarto[key][ev.equipe] += ev.valor;
      if (ev.jogador_id) {
        const pk = ev.jogador_id.toString();
        estado.pontos_jogador[pk] = (estado.pontos_jogador[pk] || 0) + ev.valor;
      }
    }
    if (ev.tipo === "falta") {
      const fKey = `${ev.quarto}-${ev.equipe}`;
      // FIBA: faltas que contam como falta de equipe sao P/T/U/D cometidas
      // por jogador EM QUADRA. Excluem-se: B/C (tecnico/banco), B2 cascata
      // (B.8.3.10), faltas de briga (Art. 39) e falta de jogador excluido
      // (registrada contra o tecnico). Categoria 'jogador_quadra' eh o filtro.
      const ehFaltaJogadorQuadra =
        FALTAS_PESSOAIS.includes(ev.tipo_falta) &&
        ev.jogador_id &&
        !ev.cascata_de &&
        (ev.categoria_pessoa === "jogador_quadra" ||
          ev.categoria_pessoa == null); // null = legado, assume jogador_quadra
      if (ehFaltaJogadorQuadra) {
        estado.faltas_equipe_por_quarto[fKey] =
          (estado.faltas_equipe_por_quarto[fKey] || 0) + 1;
      }
      if (FALTAS_PESSOAIS.includes(ev.tipo_falta) && ev.jogador_id) {
        const jogadorKey = ev.jogador_id.toString();
        estado.faltas_jogador[jogadorKey] =
          (estado.faltas_jogador[jogadorKey] || 0) + 1;
      }
    }
    if (ev.tipo === "timeout") {
      const metade = ev.quarto <= QUARTO_FIM_PRIMEIRA_METADE ? "primeira" : "segunda";
      estado.timeouts[ev.equipe][metade] += 1;
    }
  }

  return estado;
};

const popularSumula = (sumula) =>
  sumula.populate([
    { path: "jogo_id", select: "data_jogo local status" },
    { path: "competicao_id", select: "nome ano" },
    { path: "equipe_a_id", select: "nome_equipe" },
    { path: "equipe_b_id", select: "nome_equipe" },
    { path: "jogadores_a.atleta_id", select: "nome_completo" },
    { path: "jogadores_b.atleta_id", select: "nome_completo" },
  ]);

const montarRespostaSumula = async (sumula) => {
  await popularSumula(sumula);
  const estado = await computarEstado(sumula._id);
  const eventos = estado.eventos.map((e) => e.toObject());
  return {
    sumula: sumula.toObject(),
    estado: {
      placar: estado.placar,
      placar_por_quarto: estado.placar_por_quarto,
      faltas_equipe_por_quarto: estado.faltas_equipe_por_quarto,
      timeouts: estado.timeouts,
      faltas_jogador: estado.faltas_jogador,
      pontos_jogador: estado.pontos_jogador,
    },
    eventos,
  };
};

// --- CRIAR SUMULA ---
export const criarSumula = async (req, res) => {
  const { jogo_id } = req.body;
  if (!jogo_id) {
    return res.status(400).json({ message: "jogo_id e obrigatorio" });
  }
  try {
    const jogo = await Jogo.findById(jogo_id);
    if (!jogo) return res.status(404).json({ message: "Jogo nao encontrado" });

    const existente = await Sumula.findOne({ jogo_id });
    if (existente) {
      return res.status(200).json({ sumula: existente });
    }

    if (jogo.status === "finalizado" || jogo.status === "cancelado") {
      return res.status(400).json({
        message: `Nao e possivel criar sumula: jogo esta '${jogo.status}'`,
      });
    }

    const escalacoes = await Escalacao.find({ jogo_id });
    const escA = escalacoes.find(
      (e) => e.equipe_id.toString() === jogo.equipe_a_id.toString()
    );
    const escB = escalacoes.find(
      (e) => e.equipe_id.toString() === jogo.equipe_b_id.toString()
    );
    const faltandoA = !escA || !(escA.atletas_selecionados || []).length;
    const faltandoB = !escB || !(escB.atletas_selecionados || []).length;
    if (faltandoA || faltandoB) {
      return res.status(400).json({
        message: "Sem escalação confirmada",
        equipes_sem_escalacao: [
          faltandoA ? "A" : null,
          faltandoB ? "B" : null,
        ].filter(Boolean),
      });
    }

    const mapearJogadores = (esc) =>
      (esc.atletas_selecionados || []).map((atletaId) => ({
        atleta_id: atletaId,
        numero: null,
        titular: false,
        capitao: false,
        faltas: 0,
        excluido: false,
        desqualificado: false,
      }));

    const arbitragem = {};
    const mesa = {};
    const esc = jogo.arbitros_escalados || {};
    const idsArb = [
      esc.crew_chief_id,
      esc.fiscal_1_id,
      esc.fiscal_2_id,
      esc.apontador_id,
      esc.cronometrista_id,
      esc.operador_24s_id,
      esc.representante_id,
    ].filter(Boolean);
    if (idsArb.length) {
      const arbs = await Arbitro.find({ _id: { $in: idsArb } }).select("nome");
      const mapArb = new Map(arbs.map((a) => [a._id.toString(), a.nome]));
      const nome = (id) => (id ? mapArb.get(id.toString()) || "" : "");
      arbitragem.crew_chief = nome(esc.crew_chief_id);
      arbitragem.fiscal_1 = nome(esc.fiscal_1_id);
      arbitragem.fiscal_2 = nome(esc.fiscal_2_id);
      arbitragem.crew_chief_id = esc.crew_chief_id || null;
      arbitragem.fiscal_1_id = esc.fiscal_1_id || null;
      arbitragem.fiscal_2_id = esc.fiscal_2_id || null;
      mesa.apontador = nome(esc.apontador_id);
      mesa.cronometrista = nome(esc.cronometrista_id);
      mesa.operador_24s = nome(esc.operador_24s_id);
      mesa.representante = nome(esc.representante_id);
      mesa.apontador_id = esc.apontador_id || null;
      mesa.cronometrista_id = esc.cronometrista_id || null;
      mesa.operador_24s_id = esc.operador_24s_id || null;
      mesa.representante_id = esc.representante_id || null;
    }

    const sumula = await Sumula.create({
      jogo_id,
      competicao_id: jogo.competicao_id,
      equipe_a_id: jogo.equipe_a_id,
      equipe_b_id: jogo.equipe_b_id,
      status: "pre_jogo",
      quarto_atual: 1,
      arbitragem,
      mesa,
      jogadores_a: mapearJogadores(escA),
      jogadores_b: mapearJogadores(escB),
      mesario_id: req.user?._id || null,
    });

    await popularSumula(sumula);
    res.status(201).json({ sumula });
  } catch (error) {
    console.error("[sumula] criarSumula:", error);
    res
      .status(500)
      .json({ message: "Erro ao criar sumula", error: error.message });
  }
};

// --- GET SUMULA ---
export const getSumula = async (req, res) => {
  try {
    const sumula = await Sumula.findById(req.params.id)
      .populate("jogo_id")
      .populate("competicao_id", "nome ano")
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo");
    if (!sumula) {
      return res.status(404).json({ message: "Sumula nao encontrada" });
    }
    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] getSumula:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar sumula", error: error.message });
  }
};

// --- GET SUMULA POR JOGO ---
export const getSumulaPorJogo = async (req, res) => {
  try {
    const sumula = await Sumula.findOne({ jogo_id: req.params.jogoId })
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo");
    if (!sumula) {
      return res.status(404).json({ message: "Sumula nao encontrada" });
    }
    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] getSumulaPorJogo:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar sumula", error: error.message });
  }
};

// --- LISTAR SUMULAS ---
export const listarSumulas = async (req, res) => {
  try {
    const { status, competicao_id, jogo_id } = req.query;
    const filtro = {};
    if (status) filtro.status = status;
    if (competicao_id) filtro.competicao_id = competicao_id;
    if (jogo_id) filtro.jogo_id = jogo_id;

    const sumulas = await Sumula.find(filtro)
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("competicao_id", "nome ano")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(sumulas);
  } catch (error) {
    console.error("[sumula] listarSumulas:", error);
    res
      .status(500)
      .json({ message: "Erro ao listar sumulas", error: error.message });
  }
};

// --- ETAPA 1: ARBITRAGEM + MESA ---
export const patchArbitragemMesa = async (req, res) => {
  const { id } = req.params;
  const { arbitragem, mesa } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja esta em andamento ou finalizada" });
    }

    if (!arbitragem || !mesa) {
      return res
        .status(400)
        .json({ message: "arbitragem e mesa sao obrigatorios" });
    }

    const camposArb = ["crew_chief", "fiscal_1", "fiscal_2"];
    const camposMesa = ["apontador", "cronometrista", "operador_24s", "representante"];
    for (const c of camposArb) {
      if (!arbitragem[c] || !arbitragem[c].trim()) {
        return res.status(400).json({ message: `arbitragem.${c} obrigatorio` });
      }
    }
    for (const c of camposMesa) {
      if (!mesa[c] || !mesa[c].trim()) {
        return res.status(400).json({ message: `mesa.${c} obrigatorio` });
      }
    }

    sumula.arbitragem = arbitragem;
    sumula.mesa = mesa;
    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] patchArbitragemMesa:", error);
    res
      .status(500)
      .json({ message: "Erro ao salvar arbitragem/mesa", error: error.message });
  }
};

// --- ETAPA OPCIONAL: EDITAR ESCALACAO (antes da numeracao) ---
// Permite ao admin ajustar a lista de atletas convocados apos a criacao da
// sumula e antes da numeracao ser concluida. Atletas ja numerados ou marcados
// como titular mantem seus dados quando permanecem na lista; novos atletas
// entram com defaults; removidos saem. Obrigatorio estar em pre_jogo.
export const patchEscalacao = async (req, res) => {
  const { id } = req.params;
  const { atletas_a, atletas_b } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Escalacao so pode ser editada em pre_jogo" });
    }
    if (!Array.isArray(atletas_a) || !Array.isArray(atletas_b)) {
      return res
        .status(400)
        .json({ message: "atletas_a e atletas_b devem ser arrays" });
    }
    // FIBA: minimo 5, maximo 12 atletas por equipe.
    if (atletas_a.length < 5 || atletas_b.length < 5) {
      return res
        .status(400)
        .json({ message: "Cada equipe precisa de no minimo 5 atletas" });
    }
    if (atletas_a.length > 12 || atletas_b.length > 12) {
      return res
        .status(400)
        .json({ message: "Cada equipe pode ter no maximo 12 atletas" });
    }

    // Valida que cada atleta enviado tem inscricao aprovada/ativa na equipe.
    const validarInscricoes = async (equipeId, atletaIds) => {
      const unicos = [...new Set(atletaIds.map((x) => x.toString()))];
      if (unicos.length !== atletaIds.length) {
        throw new Error("atletas duplicados na lista");
      }
      const inscricoes = await Inscricao.find({
        equipe_id: equipeId,
        atleta_id: { $in: unicos },
        status: { $in: ["aprovado", "ativo"] },
      }).select("atleta_id");
      const encontrados = new Set(
        inscricoes.map((i) => i.atleta_id.toString())
      );
      for (const aid of unicos) {
        if (!encontrados.has(aid)) {
          throw new Error(
            `Atleta ${aid} nao possui inscricao aprovada na equipe`
          );
        }
      }
    };
    await validarInscricoes(sumula.equipe_a_id, atletas_a);
    await validarInscricoes(sumula.equipe_b_id, atletas_b);

    // Reconstroi as listas preservando os dados existentes quando o atleta
    // permanece (ex: numero ja atribuido em tentativa anterior).
    const reconstruir = (listaAtual, novosIds) => {
      return novosIds.map((atletaId) => {
        const existente = listaAtual.find(
          (j) => j.atleta_id.toString() === atletaId.toString()
        );
        if (existente) {
          return existente;
        }
        return {
          atleta_id: atletaId,
          numero: null,
          titular: false,
          capitao: false,
          faltas: 0,
          excluido: false,
          desqualificado: false,
        };
      });
    };

    sumula.jogadores_a = reconstruir(sumula.jogadores_a, atletas_a);
    sumula.jogadores_b = reconstruir(sumula.jogadores_b, atletas_b);

    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] patchEscalacao:", error);
    res.status(400).json({ message: error.message });
  }
};

// --- ETAPA 2: NUMERACAO DAS CAMISAS ---
export const patchNumeracao = async (req, res) => {
  const { id } = req.params;
  const { jogadores_a, jogadores_b } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja esta em andamento ou finalizada" });
    }

    const aplicarNumeros = (listaSumula, entrada, label) => {
      if (!Array.isArray(entrada)) {
        throw new Error(`jogadores_${label} deve ser um array`);
      }
      const mapa = new Map();
      for (const item of entrada) {
        if (!item.atleta_id || item.numero === undefined || item.numero === null) {
          throw new Error(`Entrada invalida em jogadores_${label}`);
        }
        if (
          !Number.isInteger(item.numero) ||
          item.numero < 0 ||
          item.numero > 99
        ) {
          throw new Error(`Numero fora do intervalo 0-99 (${label})`);
        }
        if (mapa.has(item.numero)) {
          throw new Error(`Numero duplicado ${item.numero} na equipe ${label}`);
        }
        mapa.set(item.numero, item.atleta_id);
      }
      for (const jog of listaSumula) {
        const entry = entrada.find(
          (e) => e.atleta_id.toString() === jog.atleta_id.toString()
        );
        if (!entry) {
          throw new Error(
            `Atleta ${jog.atleta_id} sem numero atribuido (${label})`
          );
        }
        jog.numero = entry.numero;
      }
    };

    if (jogadores_a !== undefined) aplicarNumeros(sumula.jogadores_a, jogadores_a, "A");
    if (jogadores_b !== undefined) aplicarNumeros(sumula.jogadores_b, jogadores_b, "B");
    if (jogadores_a === undefined && jogadores_b === undefined) {
      throw new Error("Envie pelo menos jogadores_a ou jogadores_b");
    }

    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] patchNumeracao:", error);
    res.status(400).json({ message: error.message });
  }
};

// --- ETAPA 3: TITULARES + CAPITAO ---
export const patchTitulares = async (req, res) => {
  const { id } = req.params;
  const { titulares_a, capitao_a, titulares_b, capitao_b } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja esta em andamento ou finalizada" });
    }

    const aplicar = (lista, titulares, capitao, label) => {
      if (!Array.isArray(titulares) || titulares.length !== 5) {
        throw new Error(`titulares_${label} precisa ter exatamente 5 atletas`);
      }
      if (!capitao) {
        throw new Error(`capitao_${label} obrigatorio`);
      }
      const idsTitulares = titulares.map((t) => t.toString());
      const setIds = new Set(idsTitulares);
      if (setIds.size !== 5) {
        throw new Error(`titulares_${label} possui ids duplicados`);
      }
      // FIBA: o capitao NAO precisa ser titular, mas precisa pertencer a escalacao.
      const capitaoStr = capitao.toString();
      const capitaoNaEscalacao = lista.some(
        (j) => j.atleta_id.toString() === capitaoStr
      );
      if (!capitaoNaEscalacao) {
        throw new Error(
          `capitao_${label} precisa pertencer a escalacao da equipe`
        );
      }
      for (const jog of lista) {
        const atletaIdStr = jog.atleta_id.toString();
        const ehTitular = setIds.has(atletaIdStr);
        jog.titular = ehTitular;
        // em_quadra espelha titular no início do jogo — a partir daí passa a
        // ser mutado pelas substituições, deixando titular imutável.
        jog.em_quadra = ehTitular;
        jog.capitao = atletaIdStr === capitaoStr;
      }
      const marcados = lista.filter((j) => j.titular).length;
      if (marcados !== 5) {
        throw new Error(
          `titulares_${label}: alguns titulares nao fazem parte da escalacao`
        );
      }
    };

    if (titulares_a !== undefined || capitao_a !== undefined) {
      aplicar(sumula.jogadores_a, titulares_a, capitao_a, "A");
    }
    if (titulares_b !== undefined || capitao_b !== undefined) {
      aplicar(sumula.jogadores_b, titulares_b, capitao_b, "B");
    }
    if (
      titulares_a === undefined &&
      capitao_a === undefined &&
      titulares_b === undefined &&
      capitao_b === undefined
    ) {
      throw new Error("Envie titulares/capitao de pelo menos uma equipe");
    }

    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] patchTitulares:", error);
    res.status(400).json({ message: error.message });
  }
};

// --- ETAPA 3.5: COMISSAO TECNICA (tecnico + assistente por equipe) ---
export const patchComissao = async (req, res) => {
  const { id } = req.params;
  const { equipe, tecnico_id, assistente_id } = req.body;
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe deve ser 'A' ou 'B'" });
    }
    if (!tecnico_id) {
      return res.status(400).json({ message: "tecnico_id obrigatorio" });
    }

    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja esta em andamento ou finalizada" });
    }

    const equipeId = equipe === "A" ? sumula.equipe_a_id : sumula.equipe_b_id;
    const tecnico = await Tecnico.findById(tecnico_id);
    if (!tecnico || tecnico.is_assistente) {
      return res.status(400).json({ message: "Tecnico invalido" });
    }
    if (tecnico.equipe_id.toString() !== equipeId.toString()) {
      return res
        .status(400)
        .json({ message: "Tecnico nao pertence a esta equipe" });
    }

    const membros = [
      {
        nome: tecnico.nome,
        funcao: "Tecnico",
        tecnico_id: tecnico._id,
        assinatura_path: tecnico.assinatura_path || null,
      },
    ];

    if (assistente_id) {
      const assist = await Tecnico.findById(assistente_id);
      if (!assist || !assist.is_assistente) {
        return res.status(400).json({ message: "Assistente invalido" });
      }
      if (assist.equipe_id.toString() !== equipeId.toString()) {
        return res
          .status(400)
          .json({ message: "Assistente nao pertence a esta equipe" });
      }
      membros.push({
        nome: assist.nome,
        funcao: "1o Assistente Tecnico",
        tecnico_id: assist._id,
        assinatura_path: null,
      });
    }

    if (equipe === "A") sumula.comissao_a = membros;
    else sumula.comissao_b = membros;

    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] patchComissao:", error);
    res.status(400).json({ message: error.message });
  }
};

// --- ETAPA 4: INICIAR JOGO ---
export const iniciarSumula = async (req, res) => {
  const { id } = req.params;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja foi iniciada" });
    }

    const camposArb = ["crew_chief", "fiscal_1", "fiscal_2"];
    const camposMesa = ["apontador", "cronometrista", "operador_24s", "representante"];
    for (const c of camposArb) {
      if (!sumula.arbitragem[c]) {
        return res.status(400).json({ message: `Etapa 1 incompleta: ${c}` });
      }
    }
    for (const c of camposMesa) {
      if (!sumula.mesa[c]) {
        return res.status(400).json({ message: `Etapa 1 incompleta: ${c}` });
      }
    }

    const faltamNumeroA = sumula.jogadores_a.some(
      (j) => j.numero === null || j.numero === undefined
    );
    const faltamNumeroB = sumula.jogadores_b.some(
      (j) => j.numero === null || j.numero === undefined
    );
    if (faltamNumeroA || faltamNumeroB) {
      return res
        .status(400)
        .json({ message: "Etapa 2 incompleta: atletas sem numero de camisa" });
    }

    const titularesA = sumula.jogadores_a.filter((j) => j.titular).length;
    const titularesB = sumula.jogadores_b.filter((j) => j.titular).length;
    if (titularesA !== 5 || titularesB !== 5) {
      return res
        .status(400)
        .json({ message: "Etapa 3 incompleta: 5 titulares por equipe" });
    }
    const capA = sumula.jogadores_a.filter((j) => j.capitao).length;
    const capB = sumula.jogadores_b.filter((j) => j.capitao).length;
    if (capA !== 1 || capB !== 1) {
      return res
        .status(400)
        .json({ message: "Etapa 3 incompleta: 1 capitao por equipe" });
    }

    sumula.status = "em_andamento";
    sumula.quarto_atual = 1;
    sumula.hora_inicio = new Date();
    await sumula.save();

    await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: 1,
      quarto: 1,
      tipo: "inicio_quarto",
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });

    await Jogo.findByIdAndUpdate(sumula.jogo_id, { status: "em andamento" });

    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] iniciarSumula:", error);
    res
      .status(500)
      .json({ message: "Erro ao iniciar sumula", error: error.message });
  }
};

// --- REGISTRAR EVENTO ---
export const registrarEvento = async (req, res) => {
  const { id } = req.params;
  const {
    tipo,
    equipe,
    jogador_id,
    valor,
    tipo_falta,
    lances_livres,
    jogador_entra_id,
    jogador_sai_id,
    minuto_jogo,
    ultimos_2min_q4,
  } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res
        .status(400)
        .json({ message: "Sumula nao esta em andamento" });
    }

    if (!["ponto", "falta", "timeout", "substituicao", "fim_quarto", "inicio_quarto"].includes(tipo)) {
      return res.status(400).json({ message: "tipo invalido" });
    }

    if (["ponto", "falta", "timeout", "substituicao"].includes(tipo)) {
      if (!["A", "B"].includes(equipe)) {
        return res.status(400).json({ message: "equipe invalida" });
      }
    }

    const estado = await computarEstado(sumula._id);

    if (tipo === "ponto") {
      if (![1, 2, 3].includes(valor)) {
        return res.status(400).json({ message: "valor do ponto invalido (1,2,3)" });
      }
      const jogador = findJogadorEmSumula(sumula, equipe, jogador_id);
      if (!jogador) {
        return res.status(400).json({ message: "jogador nao pertence a equipe" });
      }
      if (jogador.excluido || jogador.desqualificado) {
        return res
          .status(400)
          .json({ message: "jogador excluido/desqualificado nao pode pontuar" });
      }
    }

    if (tipo === "falta") {
      if (!TIPOS_FALTA_ENUM.includes(tipo_falta)) {
        return res.status(400).json({ message: "tipo_falta invalido" });
      }
      if (
        lances_livres !== undefined &&
        lances_livres !== null &&
        (!Number.isInteger(lances_livres) ||
          lances_livres < 0 ||
          lances_livres > 3)
      ) {
        return res
          .status(400)
          .json({ message: "lances_livres deve ser inteiro 0-3" });
      }
      // Validacao por categoria FIBA (entendimentoregras.md). categoria_pessoa
      // eh enviada pelo frontend; legado (null) cai em validacao mais permissiva.
      const cat = req.body.categoria_pessoa || null;
      const TIPOS_POR_CATEGORIA = {
        jogador_quadra: ["P", "T", "U", "D"],
        substituto: ["D"],
        excluido: ["B"],
        tecnico: ["C", "B", "D"],
        assistente: ["D"],
      };
      if (cat && TIPOS_POR_CATEGORIA[cat]) {
        if (!TIPOS_POR_CATEGORIA[cat].includes(tipo_falta)) {
          return res.status(400).json({
            message: `tipo_falta '${tipo_falta}' nao permitido para categoria '${cat}' (FIBA)`,
          });
        }
      }
      const ehFaltaTecnico =
        (tipo_falta === "C" || tipo_falta === "B" || tipo_falta === "D") &&
        req.body.tecnico_id &&
        !jogador_id;
      if (!ehFaltaTecnico) {
        const jogador = findJogadorEmSumula(sumula, equipe, jogador_id);
        if (!jogador) {
          return res.status(400).json({ message: "jogador nao pertence a equipe" });
        }
        // FIBA: jogador excluido/desqualificado ainda pode receber faltas
        // (ex.: tecnica do banco aplicada nele apos sair). So validamos que
        // pertence a equipe.
      } else {
        const comissao = equipe === "A" ? sumula.comissao_a : sumula.comissao_b;
        const pertence = (comissao || []).some(
          (m) =>
            m.tecnico_id && m.tecnico_id.toString() === req.body.tecnico_id.toString(),
        );
        if (!pertence) {
          return res.status(400).json({ message: "tecnico nao pertence a comissao" });
        }
      }
    }

    if (tipo === "timeout") {
      const metade =
        sumula.quarto_atual <= QUARTO_FIM_PRIMEIRA_METADE ? "primeira" : "segunda";
      let limite = limiteTimeoutsMetade(metade);
      // FIBA: no Q3 so sao permitidos 2 TOs — o 3o da 2a metade fica reservado
      // para o Q4.
      if (metade === "segunda" && sumula.quarto_atual < QUARTO_FINAL) {
        limite = 2;
      }
      // FIBA: bonus de +1 TO nos ultimos 2 minutos do Q4.
      const podeBonus =
        ultimos_2min_q4 === true && sumula.quarto_atual === QUARTO_FINAL;
      if (podeBonus) {
        limite += TIMEOUTS_BONUS_ULTIMOS_2MIN;
      }
      if (estado.timeouts[equipe][metade] >= limite) {
        return res.status(400).json({
          message: `Limite de timeouts atingido na ${metade} metade (max ${limite})`,
        });
      }
      if (minuto_jogo === undefined || minuto_jogo === null) {
        return res
          .status(400)
          .json({ message: "minuto_jogo obrigatorio para timeout" });
      }
      const minutoInt = Number(minuto_jogo);
      if (!Number.isInteger(minutoInt) || minutoInt < 0 || minutoInt > 10) {
        return res
          .status(400)
          .json({ message: "minuto_jogo deve ser inteiro 0-10 (FIBA B.7)" });
      }
    }

    if (tipo === "substituicao") {
      const jogSai = findJogadorEmSumula(sumula, equipe, jogador_sai_id);
      if (!jogSai) {
        return res
          .status(400)
          .json({ message: "jogador que sai invalido" });
      }
      // Fallback (?? jogSai.titular) cobre súmulas antigas criadas antes do
      // campo em_quadra existir — lá titular ainda refletia "em quadra".
      if (!(jogSai.em_quadra ?? jogSai.titular)) {
        return res
          .status(400)
          .json({ message: "jogador que sai precisa estar em quadra" });
      }
      // jogador_entra_id null = saida forcada (jogador excluido/desqualificado
      // sem reposicao no banco). FIBA: time pode continuar com 4 em quadra.
      if (jogador_entra_id === null || jogador_entra_id === undefined) {
        if (!jogSai.excluido && !jogSai.desqualificado) {
          return res.status(400).json({
            message:
              "saida sem reposicao so e permitida para jogador excluido/desqualificado",
          });
        }
      } else {
        const jogEntra = findJogadorEmSumula(sumula, equipe, jogador_entra_id);
        if (!jogEntra) {
          return res
            .status(400)
            .json({ message: "jogador que entra invalido" });
        }
        if (jogEntra.em_quadra ?? jogEntra.titular) {
          return res
            .status(400)
            .json({ message: "jogador que entra ja esta em quadra" });
        }
        if (jogEntra.excluido || jogEntra.desqualificado) {
          return res
            .status(400)
            .json({ message: "jogador que entra esta excluido/desqualificado" });
        }
      }
    }

    const ultimaSeq = await EventoSumula.findOne({ sumula_id: sumula._id })
      .sort({ sequencia: -1 })
      .select("sequencia");
    const proxSeq = (ultimaSeq?.sequencia || 0) + 1;

    let pontoProgressivo = null;
    if (tipo === "ponto") {
      const totalPontosAnteriores = Object.values(estado.placar).reduce(
        (a, b) => a + b,
        0
      );
      pontoProgressivo = totalPontosAnteriores + valor;
    }

    const evento = await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: proxSeq,
      quarto: sumula.quarto_atual,
      tipo,
      equipe: equipe || null,
      jogador_id: jogador_id || null,
      tecnico_id: tipo === "falta" ? req.body.tecnico_id || null : null,
      falta_cancelada_por:
        tipo === "falta" ? req.body.falta_cancelada_por || null : null,
      cancelada_manual:
        tipo === "falta" ? req.body.cancelada_manual === true : false,
      categoria_pessoa:
        tipo === "falta" ? req.body.categoria_pessoa || null : null,
      valor: tipo === "ponto" ? valor : null,
      tipo_falta: tipo === "falta" ? tipo_falta : null,
      lances_livres:
        tipo === "falta" && lances_livres !== undefined ? lances_livres : null,
      jogador_entra_id:
        tipo === "substituicao" ? jogador_entra_id || null : null,
      jogador_sai_id: tipo === "substituicao" ? jogador_sai_id : null,
      minuto_jogo:
        tipo === "timeout" ? Number(minuto_jogo) : null,
      ponto_progressivo: pontoProgressivo,
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });

    // Espelha cancelamento mutuo: se o cliente enviou um par, marca o outro
    // evento tambem. Isso permite registrar o segundo de um par Tc Tc com
    // um unico request, e os dois ficam vinculados.
    if (tipo === "falta" && req.body.falta_cancelada_por) {
      await EventoSumula.findByIdAndUpdate(req.body.falta_cancelada_por, {
        falta_cancelada_por: evento._id,
      });
    }

    // Cascata FIBA B.8.3.10: D em substituto/assistente gera B2 contra
    // tecnico principal. NAO conta como falta de equipe (cascata_de marca).
    if (
      tipo === "falta" &&
      tipo_falta === "D" &&
      (req.body.categoria_pessoa === "substituto" ||
        req.body.categoria_pessoa === "assistente")
    ) {
      const comissao = equipe === "A" ? sumula.comissao_a : sumula.comissao_b;
      const principal = (comissao || []).find((m) => {
        const fn = (m.funcao || "").toLowerCase();
        return /tecnico/.test(fn) && !/assist/.test(fn);
      });
      if (principal && principal.tecnico_id) {
        const seqB2 = proxSeq + 0.5; // entre o evento atual e o proximo
        await EventoSumula.create({
          sumula_id: sumula._id,
          sequencia: seqB2,
          quarto: sumula.quarto_atual,
          tipo: "falta",
          equipe,
          jogador_id: null,
          tecnico_id: principal.tecnico_id,
          tipo_falta: "B",
          lances_livres: 2,
          categoria_pessoa: "tecnico",
          cascata_de: evento._id,
          ip: req.ip,
          user_agent: req.get("user-agent") || null,
        });
      }
    }

    if (tipo === "falta" && jogador_id) {
      const jogador = findJogadorEmSumula(sumula, equipe, jogador_id);
      // Faltas que contam como pessoal do atleta (FIBA B.8.3): P, U, D, T.
      // C (Coach) e B (Banco) sao contadas contra o tecnico, nao contra o jogador.
      const contaComoPessoal = ["P", "P2", "U", "U2", "T", "D"].includes(
        tipo_falta
      );
      if (contaComoPessoal) {
        jogador.faltas += 1;
        if (jogador.faltas >= FALTAS_PESSOAIS_LIMITE) {
          jogador.excluido = true;
        }
      }
      // Auto-deteccao de desqualificacao (GD) do jogador.
      if (tipo_falta === "D" || tipo_falta === "U2") {
        jogador.desqualificado = true;
      }
      if (tipo_falta === "U") {
        const usAnteriores = estado.eventos.filter(
          (e) =>
            e.tipo === "falta" &&
            (e.tipo_falta === "U" || e.tipo_falta === "U2") &&
            e.jogador_id?.toString() === jogador_id.toString()
        ).length;
        if (usAnteriores + 1 >= 2) {
          jogador.desqualificado = true;
        }
      }
      if (tipo_falta === "T") {
        const tecnicasAnteriores = estado.eventos.filter(
          (e) =>
            e.tipo === "falta" &&
            e.tipo_falta === "T" &&
            e.jogador_id?.toString() === jogador_id.toString()
        ).length;
        if (tecnicasAnteriores + 1 >= 2) {
          jogador.desqualificado = true;
        }
      }
      // T + U no mesmo jogador = GD.
      if (tipo_falta === "T" || tipo_falta === "U") {
        const temT = estado.eventos.some(
          (e) =>
            e.tipo === "falta" &&
            e.tipo_falta === "T" &&
            e.jogador_id?.toString() === jogador_id.toString()
        );
        const temU = estado.eventos.some(
          (e) =>
            e.tipo === "falta" &&
            (e.tipo_falta === "U" || e.tipo_falta === "U2") &&
            e.jogador_id?.toString() === jogador_id.toString()
        );
        const novaT = tipo_falta === "T";
        const novaU = tipo_falta === "U";
        if ((temT && novaU) || (temU && novaT)) {
          jogador.desqualificado = true;
        }
      }
      await sumula.save();
    }

    if (tipo === "substituicao") {
      const jogSai = findJogadorEmSumula(sumula, equipe, jogador_sai_id);
      if (jogSai) {
        // Mutamos apenas em_quadra — titular continua valendo "iniciou o jogo"
        // para preservar a coluna E. (X+bolinha no Q1) no PDF.
        jogSai.em_quadra = false;
        if (jogador_entra_id) {
          const jogEntra = findJogadorEmSumula(
            sumula,
            equipe,
            jogador_entra_id
          );
          if (jogEntra) {
            jogEntra.em_quadra = true;
          }
        }
        await sumula.save();
      }
    }

    if (tipo === "fim_quarto") {
      const placarQuarto = estado.placar_por_quarto[sumula.quarto_atual] || {
        A: 0,
        B: 0,
      };
      sumula.placar_por_quarto = sumula.placar_por_quarto.filter(
        (p) => p.quarto !== sumula.quarto_atual
      );
      sumula.placar_por_quarto.push({
        quarto: sumula.quarto_atual,
        pontos_a: placarQuarto.A,
        pontos_b: placarQuarto.B,
      });
      sumula.quarto_atual += 1;
      await sumula.save();
    }

    const resposta = await montarRespostaSumula(sumula);
    res.status(201).json({ evento, ...resposta });
  } catch (error) {
    console.error("[sumula] registrarEvento:", error);
    res
      .status(500)
      .json({ message: "Erro ao registrar evento", error: error.message });
  }
};

// --- CANCELAR EVENTO (soft delete) ---
export const cancelarEvento = async (req, res) => {
  const { id, eventoId } = req.params;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status === "finalizada" || sumula.status === "cancelada") {
      return res
        .status(400)
        .json({ message: "Sumula finalizada/cancelada nao pode editar eventos" });
    }

    const evento = await EventoSumula.findById(eventoId);
    if (!evento || evento.sumula_id.toString() !== id) {
      return res.status(404).json({ message: "Evento nao encontrado" });
    }
    if (evento.cancelado) {
      return res.status(400).json({ message: "Evento ja esta cancelado" });
    }
    if (evento.tipo === "inicio_quarto") {
      return res
        .status(400)
        .json({ message: "Nao e possivel cancelar evento de inicio de quarto" });
    }
    evento.cancelado = true;
    await evento.save();

    if (evento.tipo === "falta" && evento.jogador_id) {
      const equipeLabel = evento.equipe;
      const jogador = findJogadorEmSumula(
        sumula,
        equipeLabel,
        evento.jogador_id
      );
      if (jogador) {
        const contaComoPessoal = ["P", "P2", "U", "U2", "T", "D"].includes(
          evento.tipo_falta
        );
        if (contaComoPessoal && jogador.faltas > 0) {
          jogador.faltas -= 1;
          if (jogador.faltas < FALTAS_PESSOAIS_LIMITE) {
            jogador.excluido = false;
          }
        }
        // Recalcula desqualificacao a partir dos eventos restantes.
        const faltasRestantes = await EventoSumula.find({
          sumula_id: sumula._id,
          jogador_id: evento.jogador_id,
          tipo: "falta",
          cancelado: false,
        });
        const temD = faltasRestantes.some(
          (e) => e.tipo_falta === "D" || e.tipo_falta === "U2"
        );
        const countU = faltasRestantes.filter(
          (e) => e.tipo_falta === "U" || e.tipo_falta === "U2"
        ).length;
        const countT = faltasRestantes.filter(
          (e) => e.tipo_falta === "T"
        ).length;
        const temUeT = countU >= 1 && countT >= 1;
        jogador.desqualificado =
          temD || countU >= 2 || countT >= 2 || temUeT;
        await sumula.save();
      }
    }

    if (evento.tipo === "substituicao" && evento.equipe) {
      const jogSai = findJogadorEmSumula(
        sumula,
        evento.equipe,
        evento.jogador_sai_id
      );
      if (jogSai) {
        // Reverte apenas em_quadra — titular nunca é tocado em substituições.
        jogSai.em_quadra = true;
        if (evento.jogador_entra_id) {
          const jogEntra = findJogadorEmSumula(
            sumula,
            evento.equipe,
            evento.jogador_entra_id
          );
          if (jogEntra) {
            jogEntra.em_quadra = false;
          }
        }
        await sumula.save();
      }
    }

    if (evento.tipo === "fim_quarto") {
      if (sumula.quarto_atual > 1) {
        sumula.quarto_atual -= 1;
        sumula.placar_por_quarto = sumula.placar_por_quarto.filter(
          (p) => p.quarto !== evento.quarto
        );
        await sumula.save();
      }
    }

    const resposta = await montarRespostaSumula(sumula);
    res.json({ evento, ...resposta });
  } catch (error) {
    console.error("[sumula] cancelarEvento:", error);
    res
      .status(500)
      .json({ message: "Erro ao cancelar evento", error: error.message });
  }
};

// --- HELPER: recomputa estado completo da sumula a partir dos eventos ativos ---
// Reset jogadores + placar_por_quarto + quarto_atual, depois re-aplica cada
// evento nao cancelado em ordem de sequencia. Recalcula ponto_progressivo
// de todos os eventos "ponto". Deterministico.
const recomputarSumula = async (sumula) => {
  const resetJog = (j) => {
    j.faltas = 0;
    j.excluido = false;
    j.desqualificado = false;
    j.em_quadra = j.titular;
  };
  for (const j of sumula.jogadores_a) resetJog(j);
  for (const j of sumula.jogadores_b) resetJog(j);
  sumula.placar_por_quarto = [];
  sumula.quarto_atual = 1;

  const eventos = await EventoSumula.find({
    sumula_id: sumula._id,
    cancelado: false,
  }).sort({ sequencia: 1 });

  // Contadores por jogador p/ detectar 2 U, 2 T, U+T (GD).
  const usPorJog = new Map();
  const tsPorJog = new Map();
  const inc = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  let totalPontos = 0;

  for (const ev of eventos) {
    if (ev.tipo === "fim_quarto") {
      const quartoAtual = ev.quarto;
      const pontosA = eventos
        .filter(
          (e) =>
            e.tipo === "ponto" && e.equipe === "A" && e.quarto === quartoAtual
        )
        .reduce((s, e) => s + (e.valor || 0), 0);
      const pontosB = eventos
        .filter(
          (e) =>
            e.tipo === "ponto" && e.equipe === "B" && e.quarto === quartoAtual
        )
        .reduce((s, e) => s + (e.valor || 0), 0);
      sumula.placar_por_quarto = sumula.placar_por_quarto.filter(
        (p) => p.quarto !== quartoAtual
      );
      sumula.placar_por_quarto.push({
        quarto: quartoAtual,
        pontos_a: pontosA,
        pontos_b: pontosB,
      });
      sumula.quarto_atual = quartoAtual + 1;
      continue;
    }

    if (ev.tipo === "ponto") {
      totalPontos += ev.valor || 0;
      if (ev.ponto_progressivo !== totalPontos) {
        ev.ponto_progressivo = totalPontos;
        await ev.save();
      }
      continue;
    }

    if (ev.tipo === "falta") {
      const jogador = findJogadorEmSumula(sumula, ev.equipe, ev.jogador_id);
      if (!jogador) continue;
      const pessoal = ["P", "P2", "U", "U2", "T", "D"].includes(ev.tipo_falta);
      if (pessoal) {
        jogador.faltas += 1;
        if (jogador.faltas >= FALTAS_PESSOAIS_LIMITE) {
          jogador.excluido = true;
        }
      }
      if (ev.tipo_falta === "D" || ev.tipo_falta === "U2") {
        jogador.desqualificado = true;
      }
      const key = ev.jogador_id?.toString();
      if (key) {
        if (ev.tipo_falta === "U" || ev.tipo_falta === "U2") inc(usPorJog, key);
        if (ev.tipo_falta === "T") inc(tsPorJog, key);
        const us = usPorJog.get(key) || 0;
        const ts = tsPorJog.get(key) || 0;
        if (us >= 2 || ts >= 2 || (us >= 1 && ts >= 1)) {
          jogador.desqualificado = true;
        }
      }
      continue;
    }

    if (ev.tipo === "substituicao") {
      const jogSai = findJogadorEmSumula(sumula, ev.equipe, ev.jogador_sai_id);
      if (jogSai) jogSai.em_quadra = false;
      if (ev.jogador_entra_id) {
        const jogEntra = findJogadorEmSumula(
          sumula,
          ev.equipe,
          ev.jogador_entra_id
        );
        if (jogEntra) jogEntra.em_quadra = true;
      }
    }
  }

  await sumula.save();
};

// --- HARD DELETE evento (revisao pre-finalizacao) ---
export const hardDeletarEvento = async (req, res) => {
  const { id, eventoId } = req.params;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status === "finalizada" || sumula.status === "cancelada") {
      return res
        .status(400)
        .json({ message: "Sumula finalizada/cancelada nao pode editar eventos" });
    }

    const ev = await EventoSumula.findById(eventoId);
    if (!ev || ev.sumula_id.toString() !== id) {
      return res.status(404).json({ message: "Evento nao encontrado" });
    }
    if (ev.tipo === "inicio_quarto") {
      return res.status(400).json({ message: "inicio_quarto nao pode ser removido" });
    }

    await EventoSumula.findByIdAndDelete(eventoId);
    await recomputarSumula(sumula);
    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] hardDeletarEvento:", error);
    res
      .status(500)
      .json({ message: "Erro ao excluir evento", error: error.message });
  }
};

// --- EDITAR evento (patch campos + recomputar) ---
export const editarEvento = async (req, res) => {
  const { id, eventoId } = req.params;
  const patch = req.body || {};
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status === "finalizada" || sumula.status === "cancelada") {
      return res
        .status(400)
        .json({ message: "Sumula finalizada/cancelada nao pode editar eventos" });
    }

    const ev = await EventoSumula.findById(eventoId);
    if (!ev || ev.sumula_id.toString() !== id) {
      return res.status(404).json({ message: "Evento nao encontrado" });
    }
    if (ev.tipo === "inicio_quarto") {
      return res.status(400).json({ message: "inicio_quarto nao editavel" });
    }

    const editaveis = [
      "quarto",
      "equipe",
      "jogador_id",
      "tecnico_id",
      "valor",
      "tipo_falta",
      "lances_livres",
      "categoria_pessoa",
      "cancelada_manual",
      "jogador_entra_id",
      "jogador_sai_id",
      "minuto_jogo",
      "cancelado",
    ];
    for (const campo of editaveis) {
      if (patch[campo] !== undefined) ev[campo] = patch[campo];
    }

    // Validacao por tipo.
    if (ev.tipo === "ponto" && ![1, 2, 3].includes(ev.valor)) {
      return res.status(400).json({ message: "valor do ponto invalido (1,2,3)" });
    }
    if (ev.tipo === "falta" && !TIPOS_FALTA_ENUM.includes(ev.tipo_falta)) {
      return res.status(400).json({ message: "tipo_falta invalido" });
    }
    if (
      ev.tipo === "falta" &&
      ev.lances_livres !== null &&
      ev.lances_livres !== undefined
    ) {
      if (
        !Number.isInteger(ev.lances_livres) ||
        ev.lances_livres < 0 ||
        ev.lances_livres > 3
      ) {
        return res
          .status(400)
          .json({ message: "lances_livres deve ser inteiro 0-3" });
      }
    }
    if (ev.tipo === "timeout") {
      if (ev.minuto_jogo === null || ev.minuto_jogo === undefined) {
        return res
          .status(400)
          .json({ message: "minuto_jogo obrigatorio para timeout" });
      }
      const minutoInt = Number(ev.minuto_jogo);
      if (!Number.isInteger(minutoInt) || minutoInt < 0 || minutoInt > 10) {
        return res
          .status(400)
          .json({ message: "minuto_jogo deve ser inteiro 0-10" });
      }
    }
    if (ev.tipo === "substituicao" && !ev.jogador_sai_id) {
      return res
        .status(400)
        .json({ message: "substituicao requer jogador_sai_id" });
    }
    if (["ponto", "falta", "timeout", "substituicao"].includes(ev.tipo)) {
      if (!["A", "B"].includes(ev.equipe)) {
        return res.status(400).json({ message: "equipe invalida" });
      }
    }

    await ev.save();
    await recomputarSumula(sumula);
    const resposta = await montarRespostaSumula(sumula);
    res.json({ evento: ev, ...resposta });
  } catch (error) {
    console.error("[sumula] editarEvento:", error);
    res
      .status(500)
      .json({ message: "Erro ao editar evento", error: error.message });
  }
};

// --- INSERIR evento entre dois existentes ---
// body: { apos_sequencia, tipo, equipe, jogador_id, valor, tipo_falta,
// lances_livres, jogador_entra_id, jogador_sai_id, minuto_jogo, quarto }
export const inserirEventoEntre = async (req, res) => {
  const { id } = req.params;
  const {
    apos_sequencia,
    tipo,
    quarto,
    equipe,
    jogador_id,
    valor,
    tipo_falta,
    lances_livres,
    jogador_entra_id,
    jogador_sai_id,
    minuto_jogo,
  } = req.body || {};
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status === "finalizada" || sumula.status === "cancelada") {
      return res
        .status(400)
        .json({ message: "Sumula finalizada/cancelada nao pode editar eventos" });
    }
    if (
      !["ponto", "falta", "timeout", "substituicao", "fim_quarto"].includes(tipo)
    ) {
      return res.status(400).json({ message: "tipo invalido" });
    }

    const eventos = await EventoSumula.find({ sumula_id: sumula._id }).sort({
      sequencia: 1,
    });
    let novaSeq;
    const idx = eventos.findIndex((e) => e.sequencia === Number(apos_sequencia));
    if (idx === -1) {
      novaSeq = (eventos.at(-1)?.sequencia || 0) + 1;
    } else if (idx === eventos.length - 1) {
      novaSeq = eventos[idx].sequencia + 1;
    } else {
      novaSeq = (eventos[idx].sequencia + eventos[idx + 1].sequencia) / 2;
    }

    if (tipo === "ponto" && ![1, 2, 3].includes(valor)) {
      return res.status(400).json({ message: "valor do ponto invalido (1,2,3)" });
    }
    if (tipo === "falta" && !TIPOS_FALTA_ENUM.includes(tipo_falta)) {
      return res.status(400).json({ message: "tipo_falta invalido" });
    }

    const novo = await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: novaSeq,
      quarto: Number(quarto) || 1,
      tipo,
      equipe: equipe || null,
      jogador_id: jogador_id || null,
      tecnico_id: tipo === "falta" ? req.body.tecnico_id || null : null,
      categoria_pessoa:
        tipo === "falta" ? req.body.categoria_pessoa || null : null,
      valor: tipo === "ponto" ? valor : null,
      tipo_falta: tipo === "falta" ? tipo_falta : null,
      lances_livres:
        tipo === "falta" && lances_livres !== undefined ? lances_livres : null,
      jogador_entra_id:
        tipo === "substituicao" ? jogador_entra_id || null : null,
      jogador_sai_id: tipo === "substituicao" ? jogador_sai_id : null,
      minuto_jogo: tipo === "timeout" ? Number(minuto_jogo) : null,
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });

    await recomputarSumula(sumula);
    const resposta = await montarRespostaSumula(sumula);
    res.status(201).json({ evento: novo, ...resposta });
  } catch (error) {
    console.error("[sumula] inserirEventoEntre:", error);
    res
      .status(500)
      .json({ message: "Erro ao inserir evento", error: error.message });
  }
};

// --- FINALIZAR SUMULA ---
export const finalizarSumula = async (req, res) => {
  const { id } = req.params;
  const { protesto } = req.body || {};
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res
        .status(400)
        .json({ message: "Sumula precisa estar em andamento" });
    }

    const estado = await computarEstado(sumula._id);
    sumula.placar_final = {
      pontos_a: estado.placar.A,
      pontos_b: estado.placar.B,
    };

    if (estado.placar.A > estado.placar.B) {
      sumula.equipe_vencedora_id = sumula.equipe_a_id;
    } else if (estado.placar.B > estado.placar.A) {
      sumula.equipe_vencedora_id = sumula.equipe_b_id;
    } else {
      sumula.equipe_vencedora_id = null;
    }

    if (protesto && protesto.houve) {
      sumula.protesto = {
        houve: true,
        descricao: protesto.descricao || "",
      };
    }

    // Snapshot das assinaturas atuais dos árbitros escalados — PDF histórico
    // precisa ficar imutável mesmo que o árbitro troque a assinatura depois.
    const idsSnap = [
      sumula.arbitragem?.crew_chief_id,
      sumula.arbitragem?.fiscal_1_id,
      sumula.arbitragem?.fiscal_2_id,
      sumula.mesa?.apontador_id,
      sumula.mesa?.cronometrista_id,
      sumula.mesa?.operador_24s_id,
      sumula.mesa?.representante_id,
    ].filter(Boolean);
    if (idsSnap.length) {
      const arbs = await Arbitro.find({ _id: { $in: idsSnap } }).select(
        "assinatura_path"
      );
      const mapSig = new Map(
        arbs.map((a) => [a._id.toString(), a.assinatura_path || null])
      );
      const sig = (id) => (id ? mapSig.get(id.toString()) || null : null);
      sumula.arbitragem.crew_chief_assinatura = sig(sumula.arbitragem.crew_chief_id);
      sumula.arbitragem.fiscal_1_assinatura = sig(sumula.arbitragem.fiscal_1_id);
      sumula.arbitragem.fiscal_2_assinatura = sig(sumula.arbitragem.fiscal_2_id);
      sumula.mesa.apontador_assinatura = sig(sumula.mesa.apontador_id);
      sumula.mesa.cronometrista_assinatura = sig(sumula.mesa.cronometrista_id);
      sumula.mesa.operador_24s_assinatura = sig(sumula.mesa.operador_24s_id);
      sumula.mesa.representante_assinatura = sig(sumula.mesa.representante_id);
      await Arbitro.updateMany(
        { _id: { $in: idsSnap } },
        { $inc: { jogos_contador: 1 } }
      );
    }

    // Refresh assinatura_path da comissão técnica já populada no pré-jogo.
    // Se por alguma razão a comissão não foi definida, cai no fallback de
    // pegar todos os técnicos ativos da equipe.
    const refreshComissao = async (comissao, equipe_id) => {
      if (Array.isArray(comissao) && comissao.length > 0) {
        const ids = comissao.map((m) => m.tecnico_id).filter(Boolean);
        if (!ids.length) return comissao;
        const tecs = await Tecnico.find({ _id: { $in: ids } }).select(
          "assinatura_path is_assistente"
        );
        const mapSig = new Map(
          tecs.map((t) => [t._id.toString(), { sig: t.assinatura_path || null, assist: t.is_assistente }])
        );
        return comissao.map((m) => {
          const info = m.tecnico_id
            ? mapSig.get(m.tecnico_id.toString())
            : null;
          return {
            ...(m.toObject ? m.toObject() : m),
            assinatura_path: info && !info.assist ? info.sig : null,
          };
        });
      }
      // Fallback: comissão não foi escolhida no pré-jogo.
      if (!equipe_id) return [];
      const tecs = await Tecnico.find({ equipe_id, ativo: true }).sort({
        is_assistente: 1,
        nome: 1,
      });
      return tecs.map((t) => ({
        nome: t.nome,
        funcao: t.is_assistente ? "1o Assistente Tecnico" : "Tecnico",
        tecnico_id: t._id,
        assinatura_path: t.is_assistente ? null : t.assinatura_path || null,
      }));
    };
    sumula.comissao_a = await refreshComissao(sumula.comissao_a, sumula.equipe_a_id);
    sumula.comissao_b = await refreshComissao(sumula.comissao_b, sumula.equipe_b_id);

    sumula.status = "finalizada";
    sumula.hora_fim = new Date();

    const payloadHash = JSON.stringify({
      jogo_id: sumula.jogo_id,
      placar_final: sumula.placar_final,
      eventos: estado.eventos.map((e) => ({
        seq: e.sequencia,
        tipo: e.tipo,
        valor: e.valor,
        tipo_falta: e.tipo_falta,
        equipe: e.equipe,
        jogador_id: e.jogador_id,
        cancelado: e.cancelado,
      })),
    });
    sumula.hash_finalizado = crypto
      .createHash("sha256")
      .update(payloadHash)
      .digest("hex");

    await sumula.save();

    const jogo = await Jogo.findByIdAndUpdate(
      sumula.jogo_id,
      {
        placar_a: sumula.placar_final.pontos_a,
        placar_b: sumula.placar_final.pontos_b,
        status: "finalizado",
      },
      { new: true }
    );

    if (jogo) {
      const escalacoes = await Escalacao.find({ jogo_id: jogo._id });
      for (const esc of escalacoes) {
        const ids = esc.atletas_selecionados || [];
        if (ids.length === 0) continue;
        await Inscricao.updateMany(
          {
            atleta_id: { $in: ids },
            equipe_id: esc.equipe_id,
            competicao_id: jogo.competicao_id,
          },
          { ja_jogou: true }
        );
      }
    }

    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] finalizarSumula:", error);
    res
      .status(500)
      .json({ message: "Erro ao finalizar sumula", error: error.message });
  }
};

// --- GERAR PDF ---
export const gerarPdfSumula = async (req, res) => {
  const { id } = req.params;
  const preview = req.query.preview === "1" || req.query.preview === "true";
  try {
    const sumula = await Sumula.findById(id)
      .populate("jogo_id")
      .populate("competicao_id", "nome ano")
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo");
    if (!sumula) {
      return res.status(404).json({ message: "Sumula nao encontrada" });
    }

    const estado = await computarEstado(sumula._id);
    const eventos = estado.eventos.map((e) => e.toObject());

    const sumulaObj = sumula.toObject();
    if (preview) {
      // Preview = PDF final sem assinaturas. Simula status finalizada para
      // disparar traços de fechamento FIBA e preencher placar_final/vencedor
      // a partir do estado computado em tempo real.
      sumulaObj.status = "finalizada";
      sumulaObj.placar_final = {
        pontos_a: estado.placar.A,
        pontos_b: estado.placar.B,
      };
      const idA =
        sumulaObj.equipe_a_id && typeof sumulaObj.equipe_a_id === "object"
          ? sumulaObj.equipe_a_id._id
          : sumulaObj.equipe_a_id;
      const idB =
        sumulaObj.equipe_b_id && typeof sumulaObj.equipe_b_id === "object"
          ? sumulaObj.equipe_b_id._id
          : sumulaObj.equipe_b_id;
      if (estado.placar.A > estado.placar.B) {
        sumulaObj.equipe_vencedora_id = idA;
      } else if (estado.placar.B > estado.placar.A) {
        sumulaObj.equipe_vencedora_id = idB;
      } else {
        sumulaObj.equipe_vencedora_id = null;
      }
      if (!sumulaObj.hora_fim) sumulaObj.hora_fim = new Date();

      // Zera assinaturas p/ pré-visualização antes do aval do árbitro.
      if (sumulaObj.arbitragem) {
        sumulaObj.arbitragem.crew_chief_assinatura = null;
        sumulaObj.arbitragem.fiscal_1_assinatura = null;
        sumulaObj.arbitragem.fiscal_2_assinatura = null;
      }
      if (sumulaObj.mesa) {
        sumulaObj.mesa.apontador_assinatura = null;
        sumulaObj.mesa.cronometrista_assinatura = null;
        sumulaObj.mesa.operador_24s_assinatura = null;
        sumulaObj.mesa.representante_assinatura = null;
      }
      sumulaObj.comissao_a = (sumulaObj.comissao_a || []).map((m) => ({
        ...m,
        assinatura_path: null,
      }));
      sumulaObj.comissao_b = (sumulaObj.comissao_b || []).map((m) => ({
        ...m,
        assinatura_path: null,
      }));
    }

    const pdfBuffer = await gerarSumulaPdf({
      sumula: sumulaObj,
      estado: {
        placar: estado.placar,
        placar_por_quarto: estado.placar_por_quarto,
        faltas_equipe_por_quarto: estado.faltas_equipe_por_quarto,
        timeouts: estado.timeouts,
        faltas_jogador: estado.faltas_jogador,
        pontos_jogador: estado.pontos_jogador,
      },
      eventos,
      preview,
    });

    const nomeArquivo = preview
      ? `sumula-preview-${sumula._id}.pdf`
      : `sumula-${sumula._id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${nomeArquivo}"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    console.error("[sumula] gerarPdfSumula:", error);
    res
      .status(500)
      .json({ message: "Erro ao gerar PDF", error: error.message });
  }
};
