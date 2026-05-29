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
import { Atleta } from "../models/Atleta.js";
import { gerarSumulaPdf } from "../services/sumulaPdfService.js";
import {
  computarEstado,
  montarDinamicoAoVivo,
  QUARTO_FIM_PRIMEIRA_METADE,
  QUARTO_FINAL,
} from "../services/sumulaEstadoService.js";
import * as aoVivoBus from "../services/aoVivoBus.js";
import {
  uploadBufferToCloudinary,
  destroyCloudinaryAsset,
} from "../config/cloudinary.js";

const FALTAS_PESSOAIS_LIMITE = 5;
// FIBA B.8.4: 2 TO na primeira metade, 3 na segunda metade.
// Nos ultimos 2 min do Q4, se a equipe ainda tiver 3/3 disponiveis, perde
// automaticamente o 1o TO (regra do "uso ou perde"). O sistema registra um
// evento timeout sintetico com perdido_2min=true antes do TO real.
const TIMEOUTS_PRIMEIRA_METADE = 2;
const TIMEOUTS_SEGUNDA_METADE = 3;
// QUARTO_FIM_PRIMEIRA_METADE e QUARTO_FINAL vêm de sumulaEstadoService.js.

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

// Comissao da equipe (membros principal + assistente).
const obterComissaoMembros = (sumula, equipe) => {
  const comissao = equipe === "A" ? sumula.comissao_a : sumula.comissao_b;
  const principal = (comissao || []).find((m) => {
    const fn = (m.funcao || "").toLowerCase();
    return /tecnico/.test(fn) && !/assist/.test(fn);
  });
  const assistente = (comissao || []).find((m) => {
    const fn = (m.funcao || "").toLowerCase();
    return /assist/.test(fn);
  });
  return { principal, assistente };
};

// FIBA Art. 7.9 — jogador-tecnico ATIVO (o que atua como tecnico agora).
// Prefere o nao-desqualificado (2o capitao sucessor) sobre o original ja
// expulso. Quando o original e expulso e ninguem assumiu ainda, retorna ele
// mesmo (desqualificado) — sinaliza que a equipe precisa de um 2o CAP.
const acharJogadorTecnicoAtivo = (lista) => {
  const list = lista || [];
  return (
    list.find((j) => j.jogador_tecnico && !j.desqualificado) ||
    list.find((j) => j.jogador_tecnico) ||
    null
  );
};

// Reverte a sucessao do 2o capitao quando um undo "des-expulsa" o
// jogador-tecnico original (cascata/falta cancelada). Restaura a capitania e
// limpa as flags do sucessor. Retorna true se houve mudanca.
const reverterSucessaoSeReintegrado = (sumula, equipe) => {
  const { principal, assistente } = obterComissaoMembros(sumula, equipe);
  if (!principal?.atleta_id || assistente) return false;
  const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
  const sucessor = (lista || []).find((j) => j.tecnico_sucessor);
  if (!sucessor) return false;
  const original = (lista || []).find(
    (j) => j.atleta_id && j.atleta_id.toString() === String(principal.atleta_id),
  );
  if (original && !original.desqualificado) {
    sucessor.tecnico_sucessor = false;
    sucessor.jogador_tecnico = false;
    sucessor.capitao = false;
    original.capitao = true;
    return true;
  }
  return false;
};

// FIBA Art. 38.2.4 — tecnico desqualificado se: 2 C diretas OU 3 totais (C+B).
// FIBA — assistente desqualificado com 1 D direto.
// Recebe lista de eventos ja carregada (nao acessa DB).
const calcularStatusComissao = (eventos, equipe, principalId, assistenteId) => {
  const ativos = eventos.filter((e) => !e.cancelado && e.equipe === equipe);
  // FIBA B.8.3.13/.14/.15 — faltas de delegacao acompanhante (marcador_circulo)
  // NAO contam para o limite de 3 tecnicas que gera GD do tecnico.
  const principalC = principalId
    ? ativos.filter(
        (e) =>
          e.tipo === "falta" &&
          e.tipo_falta === "C" &&
          !e.marcador_circulo &&
          e.tecnico_id &&
          String(e.tecnico_id) === String(principalId),
      ).length
    : 0;
  const principalB = principalId
    ? ativos.filter(
        (e) =>
          e.tipo === "falta" &&
          e.tipo_falta === "B" &&
          !e.marcador_circulo &&
          e.tecnico_id &&
          String(e.tecnico_id) === String(principalId),
      ).length
    : 0;
  const principalD = principalId
    ? ativos.filter(
        (e) =>
          e.tipo === "falta" &&
          e.tipo_falta === "D" &&
          e.tecnico_id &&
          String(e.tecnico_id) === String(principalId),
      ).length
    : 0;
  const assistenteD = assistenteId
    ? ativos.filter(
        (e) =>
          e.tipo === "falta" &&
          e.tipo_falta === "D" &&
          e.tecnico_id &&
          String(e.tecnico_id) === String(assistenteId),
      ).length
    : 0;
  const tecnicoFora =
    principalC >= 2 || principalC + principalB >= 3 || principalD >= 1;
  const assistenteFora = assistenteD >= 1;
  return {
    tecnicoFora,
    assistenteFora,
    principalC,
    principalB,
    principalD,
    assistenteD,
  };
};

// FIBA Art. 7.9 / B.8.3.7 / OBRI 36-27 — jogador-tecnico (player head coach).
// Soma faltas como jogador (T/U) com faltas como tecnico (C/B) para o GD
// automatico, e conta P/T/U/D/F como jogador para o limite de 5 (excluido
// como jogador, mas segue como tecnico — Art. 40.2).
const calcularStatusJogadorTecnico = (eventos, equipe, atletaId) => {
  if (!atletaId) return null;
  const alvo = String(atletaId);
  const ativos = eventos.filter(
    (e) =>
      !e.cancelado &&
      e.equipe === equipe &&
      e.tipo === "falta" &&
      e.jogador_id &&
      String(e.jogador_id) === alvo,
  );
  const contar = (tipos, opts = {}) =>
    ativos.filter((e) => {
      if (!tipos.includes(e.tipo_falta)) return false;
      // FIBA B.8.3.13/.14/.15 — falta de delegacao acompanhante (circulada)
      // nao conta para o GD do tecnico.
      if (opts.semCirculo && e.marcador_circulo) return false;
      return true;
    }).length;
  // Faltas que contam para o limite de 5 (FIBA Art. 40 / OBRI 36-33). Inclui
  // as faltas como tecnico (C/B) — o jogador-tecnico e excluido como jogador
  // ao somar 5 faltas como jogador E como tecnico.
  const faltasComoJogador = contar(
    ["P", "P2", "U", "U2", "T", "D", "F", "C", "B"],
    { semCirculo: true },
  );
  const tPlayer = contar(["T"]);
  const uPlayer = contar(["U", "U2"]);
  // Faltas como tecnico (C/B). marcador_circulo nao conta.
  const cCoach = contar(["C"], { semCirculo: true });
  const bCoach = contar(["B"], { semCirculo: true });
  const playerTU = tPlayer + uPlayer;
  // Matriz B.8.3.7 / OBRI 36-27 — GD automatico do jogador-tecnico.
  const gdAutomatico =
    playerTU >= 2 ||
    cCoach >= 2 ||
    bCoach >= 3 ||
    (cCoach >= 1 && playerTU >= 1) ||
    (bCoach >= 2 && playerTU >= 1) ||
    (cCoach >= 1 && bCoach >= 2);
  return {
    faltasComoJogador,
    excluidoComoJogador: faltasComoJogador >= FALTAS_PESSOAIS_LIMITE,
    tPlayer,
    uPlayer,
    cCoach,
    bCoach,
    gdAutomatico,
  };
};

// FIBA Art. 37 — herança de cargo na cascata B2.
// Retorna { tecnico_id, role } para o evento sintetico.
// principal disponivel → principal; senao assistente; senao capitao (jogador).
const resolverResponsavelCascata = (sumula, equipe, eventos) => {
  const { principal, assistente } = obterComissaoMembros(sumula, equipe);
  const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
  // FIBA Art. 7.9 — jogador-tecnico ATIVO (original ou 2o capitao sucessor).
  // Ele segue sendo o tecnico do time esteja em quadra ou no banco: a cascata
  // B2 cai nele (categoria "tecnico" + jogador_id) ate ser desqualificado. So
  // entao herda pro proximo (assistente/capitao/sucessor — Art. 37). Usar a
  // flag jogador_tecnico (e nao so o atleta_id da comissao) garante que, apos a
  // expulsao do titular, a cascata va pro 2o CAP mesmo que ele nao esteja em
  // quadra.
  const jtAtivo = acharJogadorTecnicoAtivo(lista);
  if (jtAtivo && !jtAtivo.desqualificado) {
    return { jogador_id: jtAtivo.atleta_id, role: "jogador_tecnico" };
  }
  const principalId = principal?.tecnico_id
    ? String(principal.tecnico_id)
    : null;
  const assistenteId = assistente?.tecnico_id
    ? String(assistente.tecnico_id)
    : null;
  const status = calcularStatusComissao(
    eventos,
    equipe,
    principalId,
    assistenteId,
  );
  if (principalId && !status.tecnicoFora) {
    return { tecnico_id: principalId, role: "principal" };
  }
  if (assistenteId && !status.assistenteFora) {
    return { tecnico_id: assistenteId, role: "assistente" };
  }
  // Capitao em quadra como ultimo recurso (Art. 37). Atribui ao jogador_id
  // como falta B (pessoal nao conta — B nao esta em FALTAS_PESSOAIS).
  const capitao = (lista || []).find(
    (j) => j.capitao && (j.em_quadra ?? j.titular) && !j.excluido && !j.desqualificado,
  );
  if (capitao) {
    // FIBA Art. 7.9 — se o capitao e o jogador-tecnico, a cascata B2 e uma
    // falta de tecnico (categoria "tecnico") e conta no GD dele. Capitao
    // comum que assume so como ultimo recurso recebe B como jogador_quadra.
    return {
      jogador_id: capitao.atleta_id,
      role: capitao.jogador_tecnico ? "jogador_tecnico" : "capitao",
    };
  }
  // Fallback: sem ninguem disponivel — registra contra principal mesmo
  // assim para preservar trilha de auditoria.
  return { tecnico_id: principalId, role: "principal_fallback" };
};

// FIBA Art. 7.9 / B.8.3.7 — apos uma cascata B2 cair no jogador-tecnico,
// reavalia a matriz de GD combinada e persiste a desqualificacao. Re-le os
// eventos do banco para incluir a B2 recem-criada.
const aplicarGdCascataJogadorTecnico = async (sumula, equipe, alvo) => {
  if (alvo?.role !== "jogador_tecnico" || !alvo.jogador_id) return;
  const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
  const jt = (lista || []).find(
    (j) => j.atleta_id.toString() === String(alvo.jogador_id),
  );
  if (!jt || jt.desqualificado) return;
  const eventos = await EventoSumula.find({
    sumula_id: sumula._id,
    cancelado: false,
  });
  const st = calcularStatusJogadorTecnico(eventos, equipe, alvo.jogador_id);
  if (st && st.gdAutomatico) {
    jt.desqualificado = true;
    await sumula.save();
  }
};

// computarEstado foi movido para services/sumulaEstadoService.js (importado no
// topo) para ser reutilizado pela visão pública ao vivo.

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
  // Status da comissao tecnica por equipe (FIBA Art. 38.2.4).
  const statusComissao = {};
  // Status do jogador-tecnico por equipe (FIBA Art. 7.9 / B.8.3.7).
  const statusJogadorTecnico = {};
  for (const eq of ["A", "B"]) {
    const { principal, assistente } = obterComissaoMembros(sumula, eq);
    const principalId = principal?.tecnico_id ? String(principal.tecnico_id) : null;
    const assistenteId = assistente?.tecnico_id
      ? String(assistente.tecnico_id)
      : null;
    statusComissao[eq] = calcularStatusComissao(
      estado.eventos,
      eq,
      principalId,
      assistenteId,
    );
    const lista = eq === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    const jt = acharJogadorTecnicoAtivo(lista);
    if (jt) {
      const jtId = jt.atleta_id?._id || jt.atleta_id;
      statusJogadorTecnico[eq] = {
        atleta_id: String(jtId),
        ...calcularStatusJogadorTecnico(estado.eventos, eq, jtId),
      };
    }
  }

  // Visão pública ao vivo: enquanto o jogo roda, persiste o placar no Jogo
  // (para os cards da home) e empurra o estado dinâmico aos viewers via SSE.
  // Só dispara quando a súmula está em andamento — leituras pós-jogo não emitem.
  if (sumula.status === "em_andamento") {
    const jogoId = sumula.jogo_id?._id || sumula.jogo_id;
    try {
      await Jogo.findByIdAndUpdate(jogoId, {
        placar_a: estado.placar.A,
        placar_b: estado.placar.B,
      });
      aoVivoBus.publicar(String(jogoId), montarDinamicoAoVivo(sumula, estado));
    } catch (e) {
      console.error("[aovivo] emit:", e.message);
    }
  }

  return {
    sumula: sumula.toObject(),
    estado: {
      placar: estado.placar,
      placar_por_quarto: estado.placar_por_quarto,
      faltas_equipe_por_quarto: estado.faltas_equipe_por_quarto,
      timeouts: estado.timeouts,
      faltas_jogador: estado.faltas_jogador,
      pontos_jogador: estado.pontos_jogador,
      comissao_status: statusComissao,
      jogador_tecnico_status: statusJogadorTecnico,
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
        if (!item.atleta_id) {
          throw new Error(`Entrada invalida em jogadores_${label}`);
        }
        // Numero null/ausente = atleta escalado sem numero (chegou atrasado).
        // Permitido na Etapa 2; recebe numero durante o jogo.
        if (item.numero === undefined || item.numero === null) continue;
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
            `Atleta ${jog.atleta_id} sem entrada na numeracao (${label})`
          );
        }
        jog.numero =
          entry.numero === undefined || entry.numero === null
            ? null
            : entry.numero;
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
      // FIBA Art. 7.9 — o jogador-tecnico atua como capitao. Se a equipe usa
      // jogador-tecnico, ele tem que ser o capitao escolhido.
      const jt = lista.find((j) => j.jogador_tecnico);
      if (jt && jt.atleta_id.toString() !== capitaoStr) {
        throw new Error(
          `capitao_${label}: o jogador-tecnico precisa ser o capitao (FIBA Art. 7.9)`
        );
      }
      const semNumero = (j) => j.numero === null || j.numero === undefined;
      for (const jog of lista) {
        const atletaIdStr = jog.atleta_id.toString();
        const ehTitular = setIds.has(atletaIdStr);
        // Atleta sem numero (chegou atrasado) nao pode ser titular nem capitao.
        if (ehTitular && semNumero(jog)) {
          throw new Error(
            `titulares_${label}: atleta sem numero de camisa nao pode ser titular`
          );
        }
        if (atletaIdStr === capitaoStr && semNumero(jog)) {
          throw new Error(
            `capitao_${label}: capitao precisa ter numero de camisa`
          );
        }
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
  const { equipe, tecnico_id, assistente_id, jogador_tecnico_atleta_id } =
    req.body;
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe deve ser 'A' ou 'B'" });
    }
    // FIBA B.4.2 — ou a equipe tem tecnico inscrito, ou usa jogador-tecnico.
    // Nunca os dois ao mesmo tempo.
    if (!tecnico_id && !jogador_tecnico_atleta_id) {
      return res.status(400).json({
        message: "tecnico_id ou jogador_tecnico_atleta_id obrigatorio",
      });
    }
    if (tecnico_id && jogador_tecnico_atleta_id) {
      return res.status(400).json({
        message:
          "Equipe nao pode ter tecnico e jogador-tecnico ao mesmo tempo (FIBA B.4.2)",
      });
    }

    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Sumula ja esta em andamento ou finalizada" });
    }

    const equipeId = equipe === "A" ? sumula.equipe_a_id : sumula.equipe_b_id;
    const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;

    let membros;

    if (jogador_tecnico_atleta_id) {
      // FIBA Art. 7.9 / B.4.2 — capitao atua como jogador-tecnico. O atleta
      // precisa estar na escalacao; vira ComissaoMembro com atleta_id e a
      // flag jogador_tecnico e espelhada no JogadorSumula correspondente.
      const jtId = jogador_tecnico_atleta_id.toString();
      const jog = lista.find((j) => j.atleta_id.toString() === jtId);
      if (!jog) {
        return res.status(400).json({
          message: "Jogador-tecnico precisa estar na escalacao da equipe",
        });
      }
      const atleta = await Atleta.findById(jtId);
      if (!atleta) {
        return res.status(404).json({ message: "Atleta nao encontrado" });
      }
      membros = [
        {
          nome: atleta.nome_completo,
          funcao: "Jogador-Tecnico",
          tecnico_id: null,
          atleta_id: atleta._id,
          assinatura_path: null,
        },
      ];
      lista.forEach((j) => {
        j.jogador_tecnico = j.atleta_id.toString() === jtId;
      });
    } else {
      const tecnico = await Tecnico.findById(tecnico_id);
      if (!tecnico || tecnico.is_assistente) {
        return res.status(400).json({ message: "Tecnico invalido" });
      }
      if (tecnico.equipe_id.toString() !== equipeId.toString()) {
        return res
          .status(400)
          .json({ message: "Tecnico nao pertence a esta equipe" });
      }

      membros = [
        {
          nome: tecnico.nome,
          funcao: "Tecnico",
          tecnico_id: tecnico._id,
          atleta_id: null,
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
          atleta_id: null,
          assinatura_path: null,
        });
      }
      // Equipe deixou de usar jogador-tecnico (re-configuracao): limpa flags.
      lista.forEach((j) => {
        j.jogador_tecnico = false;
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

// --- ASSINATURA DO JOGADOR-TECNICO (pre-jogo, ao vivo) ---
// FIBA Art. 7.9 — equipe sem tecnico inscrito usa o capitao como
// jogador-tecnico. Ele nao tem cadastro de Tecnico (nem senha nem assinatura
// reusavel), entao a assinatura e desenhada na hora e guardada SO nesta
// sumula. Cada coleta sobrescreve a anterior (mesmo public_id).
export const uploadAssinaturaJogadorTecnico = async (req, res) => {
  const { id } = req.params;
  const { equipe } = req.body;
  const file = req.file;
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe deve ser 'A' ou 'B'" });
    }
    if (!file?.buffer?.length) {
      return res.status(400).json({ message: "Imagem da assinatura ausente" });
    }
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "pre_jogo") {
      return res
        .status(400)
        .json({ message: "Assinatura so pode ser coletada no pre-jogo" });
    }

    const comissao = equipe === "A" ? sumula.comissao_a : sumula.comissao_b;
    const membro = (comissao || []).find((m) => m.atleta_id);
    if (!membro) {
      return res.status(400).json({
        message: "Equipe nao usa jogador-tecnico — defina a comissao antes",
      });
    }

    if (membro.assinatura_public_id) {
      await destroyCloudinaryAsset(membro.assinatura_public_id);
    }
    const result = await uploadBufferToCloudinary(file.buffer, {
      folder: "ccb/assinaturas/sumula",
      public_id: `jt_${sumula._id}_${equipe}`,
    });

    membro.assinatura_path = result.secure_url;
    membro.assinatura_public_id = result.public_id;
    await sumula.save();
    await popularSumula(sumula);
    res.json({ sumula });
  } catch (error) {
    console.error("[sumula] uploadAssinaturaJogadorTecnico:", error);
    res
      .status(500)
      .json({ message: "Erro ao salvar assinatura", error: error.message });
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

    // Atletas sem numero sao permitidos na escalacao (chegaram atrasados) —
    // recebem numero durante o jogo. So titulares e capitao exigem numero.
    const semNumero = (j) => j.numero === null || j.numero === undefined;
    const titularSemNumero =
      sumula.jogadores_a.some((j) => j.titular && semNumero(j)) ||
      sumula.jogadores_b.some((j) => j.titular && semNumero(j));
    const capitaoSemNumero =
      sumula.jogadores_a.some((j) => j.capitao && semNumero(j)) ||
      sumula.jogadores_b.some((j) => j.capitao && semNumero(j));
    if (titularSemNumero || capitaoSemNumero) {
      return res
        .status(400)
        .json({ message: "Titular/capitao sem numero de camisa" });
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
        jogador_quadra: ["P", "T", "U", "D", "F"],
        substituto: ["D"],
        // FIBA B.8.3.11 / Art. 36 — jogador excluido pode receber D
        // (cascateia B no tecnico principal). B continua valido (regra 40.3).
        excluido: ["B", "D"],
        // FIBA Art. 39 — tecnico que entra na briga e nao acalma recebe D2
        // + F nos espacos restantes.
        tecnico: ["C", "B", "D", "F"],
        assistente: ["D"],
      };
      if (cat && TIPOS_POR_CATEGORIA[cat]) {
        if (!TIPOS_POR_CATEGORIA[cat].includes(tipo_falta)) {
          return res.status(400).json({
            message: `tipo_falta '${tipo_falta}' nao permitido para categoria '${cat}' (FIBA)`,
          });
        }
      }
      // Validacao tipo↔LL (FIBA Sec. 8 — bloqueios):
      //   T, C, B (input direto) → LL=1; cancelada → LL=0.
      //   B com LL=2 (B2) so via cascata sintetica (cascata_de preenchido).
      //   U, D em jogador_quadra → LL ∈ {1,2,3}.
      //   D em substituto/assistente/excluido (direto) → LL=0 (sem numero).
      //   F → LL=0 (Art. 39 / B.8.3.14).
      //   P → LL ∈ {0,1,2,3} livre.
      const ehCancelada = req.body.cancelada_manual === true;
      const ll = lances_livres == null ? 0 : Number(lances_livres);
      const validarLL = (permitidos) => {
        if (!permitidos.includes(ll)) {
          return res.status(400).json({
            message: `lances_livres=${ll} invalido para tipo_falta '${tipo_falta}' (FIBA permite ${permitidos.join("/")})`,
          });
        }
        return null;
      };
      if (ehCancelada) {
        // Qualquer tipo cancelado deve zerar LL.
        if (ll !== 0) {
          return res.status(400).json({
            message: "falta cancelada (cancelada_manual=true) deve ter lances_livres=0",
          });
        }
      } else if (tipo_falta === "T" || tipo_falta === "C") {
        const err = validarLL([1]);
        if (err) return err;
      } else if (tipo_falta === "B") {
        // B direto (input do mesario) → LL=1. B2 (LL=2) so via cascata.
        const ehCascata = !!req.body.cascata_de;
        const permitidos = ehCascata ? [1, 2] : [1];
        const err = validarLL(permitidos);
        if (err) return err;
      } else if (tipo_falta === "U") {
        const err = validarLL([1, 2, 3]);
        if (err) return err;
      } else if (tipo_falta === "D") {
        const semNumero =
          cat === "substituto" || cat === "assistente" || cat === "excluido";
        const permitidos = semNumero ? [0] : [1, 2, 3];
        const err = validarLL(permitidos);
        if (err) return err;
      } else if (tipo_falta === "F") {
        const err = validarLL([0]);
        if (err) return err;
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
        // FIBA Art. 38 — jogador desqualificado (GD) deixa o ginasio e nao
        // recebe mais faltas. Excluido (5 faltas) ainda pode receber D
        // (cascateia B2 no tecnico — categoria=excluido).
        if (jogador.desqualificado) {
          return res.status(400).json({
            message: "atleta ja desqualificado (GD) — deveria ter deixado o ginasio. Nao recebe mais faltas.",
          });
        }
        // FIBA Art. 7.9 — falta como tecnico (C/B) atribuida a um jogador_id
        // so e valida quando esse jogador e o jogador-tecnico da equipe.
        if (
          (tipo_falta === "C" || tipo_falta === "B") &&
          cat === "tecnico" &&
          !jogador.jogador_tecnico
        ) {
          return res.status(400).json({
            message:
              "falta C/B so pode ser atribuida a um tecnico ou ao jogador-tecnico",
          });
        }
      } else {
        const comissao = equipe === "A" ? sumula.comissao_a : sumula.comissao_b;
        const pertence = (comissao || []).some(
          (m) =>
            m.tecnico_id && m.tecnico_id.toString() === req.body.tecnico_id.toString(),
        );
        if (!pertence) {
          return res.status(400).json({ message: "tecnico nao pertence a comissao" });
        }
        // FIBA Art. 38.2.4 — tecnico/assistente ja desqualificado nao recebe
        // mais faltas diretas do mesario. Cascata B2 (req.body.cascata_de) ja
        // contorna isso via resolverResponsavelCascata (Art. 37: principal →
        // assistente → capitao). Bloqueio so aplica a input direto.
        if (!req.body.cascata_de) {
          const { principal, assistente } = obterComissaoMembros(sumula, equipe);
          const principalId = principal?.tecnico_id ? String(principal.tecnico_id) : null;
          const assistenteId = assistente?.tecnico_id ? String(assistente.tecnico_id) : null;
          const status = calcularStatusComissao(
            estado.eventos,
            equipe,
            principalId,
            assistenteId,
          );
          const alvoStr = String(req.body.tecnico_id);
          if (alvoStr === principalId && status.tecnicoFora) {
            return res.status(400).json({
              message: "tecnico ja desqualificado (Art. 38.2.4) — nao recebe mais faltas; B2 cascateia para 1o assistente ou capitao",
            });
          }
          if (alvoStr === assistenteId && status.assistenteFora) {
            return res.status(400).json({
              message: "1o assistente ja desqualificado — nao recebe mais faltas",
            });
          }
        }
      }
    }

    if (tipo === "timeout") {
      const ehOT = sumula.quarto_atual > QUARTO_FINAL;
      if (minuto_jogo === undefined || minuto_jogo === null) {
        return res
          .status(400)
          .json({ message: "minuto_jogo obrigatorio para timeout" });
      }
      const minutoInt = Number(minuto_jogo);
      if (ehOT) {
        // Prorrogacao dura 5 min — minuto inteiro do quarto vai de 0 a 4.
        if (!Number.isInteger(minutoInt) || minutoInt < 0 || minutoInt > 4) {
          return res
            .status(400)
            .json({ message: "minuto_jogo na prorrogacao deve ser inteiro 0-4" });
        }
        // FIBA: 1 timeout por equipe por prorrogacao.
        const usadosOT =
          estado.timeouts[equipe].prorrogacao[sumula.quarto_atual] || 0;
        if (usadosOT >= 1) {
          return res.status(400).json({
            message: "Limite de timeouts da prorrogacao atingido (max 1)",
          });
        }
      } else {
        if (!Number.isInteger(minutoInt) || minutoInt < 0 || minutoInt > 10) {
          return res
            .status(400)
            .json({ message: "minuto_jogo deve ser inteiro 0-10 (FIBA B.7)" });
        }
        const metade =
          sumula.quarto_atual <= QUARTO_FIM_PRIMEIRA_METADE
            ? "primeira"
            : "segunda";
        let limite = limiteTimeoutsMetade(metade);
        // FIBA: no Q3 so sao permitidos 2 TOs — o 3o da 2a metade fica
        // reservado para o Q4.
        if (metade === "segunda" && sumula.quarto_atual < QUARTO_FINAL) {
          limite = 2;
        }
        // Regra "uso ou perde" (Q4 ultimos 2 min com 3/3): incrementa em 2
        // (1 sintetico perdido + 1 real). Validar que ha espaco.
        const acionaPerdido2min =
          sumula.quarto_atual === QUARTO_FINAL &&
          minutoInt <= 1 &&
          estado.timeouts[equipe].segunda === 0;
        const incremento = acionaPerdido2min ? 2 : 1;
        if (estado.timeouts[equipe][metade] + incremento > limite) {
          return res.status(400).json({
            message: `Limite de timeouts atingido na ${metade} metade (max ${limite})`,
          });
        }
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
    let proxSeq = (ultimaSeq?.sequencia || 0) + 1;

    let pontoProgressivo = null;
    if (tipo === "ponto") {
      const totalPontosAnteriores = Object.values(estado.placar).reduce(
        (a, b) => a + b,
        0
      );
      pontoProgressivo = totalPontosAnteriores + valor;
    }

    // Regra "uso ou perde" — Q4 ultimos 2 min com 3/3: cria evento sintetico
    // de TO perdido ANTES do TO real. Ambos ocupam slots da segunda metade.
    if (
      tipo === "timeout" &&
      sumula.quarto_atual === QUARTO_FINAL &&
      Number(minuto_jogo) <= 1 &&
      estado.timeouts[equipe].segunda === 0
    ) {
      await EventoSumula.create({
        sumula_id: sumula._id,
        sequencia: proxSeq,
        quarto: sumula.quarto_atual,
        tipo: "timeout",
        equipe,
        minuto_jogo: null,
        perdido_2min: true,
        ip: req.ip,
        user_agent: req.get("user-agent") || null,
      });
      proxSeq += 1;
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

    // Cascata FIBA B.8.3.10 / B.8.3.11: D em substituto/assistente/excluido
    // gera B2 contra tecnico principal (ou herdeiro de cargo, Art. 37).
    // NAO conta como falta de equipe (cascata_de marca).
    // SKIP quando subtipo_briga setado — fluxo briga (registrarBriga) cuida
    // da propria cascata deduplicada por fight_group_id.
    if (
      tipo === "falta" &&
      tipo_falta === "D" &&
      !req.body.subtipo_briga &&
      (req.body.categoria_pessoa === "substituto" ||
        req.body.categoria_pessoa === "assistente" ||
        req.body.categoria_pessoa === "excluido")
    ) {
      // Inclui o evento recem-criado na lista para que o calculo de
      // herança considere o D que acabou de cair (afeta assistenteD).
      const eventosBase = [...estado.eventos, evento];
      const alvo = resolverResponsavelCascata(sumula, equipe, eventosBase);
      const seqB2 = proxSeq + 0.5; // entre o evento atual e o proximo
      const baseB2 = {
        sumula_id: sumula._id,
        sequencia: seqB2,
        quarto: sumula.quarto_atual,
        tipo: "falta",
        equipe,
        tipo_falta: "B",
        lances_livres: 2,
        categoria_pessoa:
          alvo.role === "capitao" ? "jogador_quadra" : "tecnico",
        cascata_de: evento._id,
        ip: req.ip,
        user_agent: req.get("user-agent") || null,
      };
      if (alvo.tecnico_id) {
        await EventoSumula.create({
          ...baseB2,
          jogador_id: null,
          tecnico_id: alvo.tecnico_id,
        });
      } else if (alvo.jogador_id) {
        await EventoSumula.create({
          ...baseB2,
          jogador_id: alvo.jogador_id,
          tecnico_id: null,
        });
      }
      await aplicarGdCascataJogadorTecnico(sumula, equipe, alvo);
    }

    if (tipo === "falta" && jogador_id) {
      const jogador = findJogadorEmSumula(sumula, equipe, jogador_id);
      // jogador.faltas NAO e incremental — e recomputado a partir dos eventos
      // ativos a cada falta. Isso elimina o drift de contagem que aparecia ao
      // desfazer/refazer faltas (register +1 / cancel -1 podiam dessincronizar).
      // computarEstado conta P/T/U/D/F + C/B do jogador-tecnico (OBRI 36-33).
      const estadoPosFalta = await computarEstado(sumula._id);
      jogador.faltas =
        estadoPosFalta.faltas_jogador[jogador_id.toString()] || 0;
      jogador.excluido = jogador.faltas >= FALTAS_PESSOAIS_LIMITE;
      // Auto-deteccao de desqualificacao (GD) do jogador.
      // F (briga, Art. 39) tambem causa desqualificacao imediata.
      if (tipo_falta === "D" || tipo_falta === "U2" || tipo_falta === "F") {
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
      // FIBA Art. 7.9 / B.8.3.7 / OBRI 36-27 — jogador-tecnico: combina faltas
      // como jogador (T/U) com faltas como tecnico (C/B) na matriz de GD
      // automatico. Cobre combinacoes que o bloco acima (so jogador) nao pega,
      // como 1 C + 1 T.
      if (jogador.jogador_tecnico && !jogador.desqualificado) {
        const st = calcularStatusJogadorTecnico(
          [...estado.eventos, evento],
          equipe,
          jogador_id,
        );
        if (st && st.gdAutomatico) {
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

// --- REGISTRAR BRIGA (FIBA B.8.3.14 / B.8.3.15) ---
// Cria de uma vez todos os eventos derivados de uma briga: D ou D2 em cada
// envolvido + UNICA cascata B2 no tecnico principal (deduplicada por
// fight_group_id). Na mesma partida pode haver varias brigas (cada uma um
// novo group). Mesma briga pode receber novos envolvidos (envia
// fight_group_id existente — nova B2 NAO eh criada).
//
// Body: {
//   equipe: "A"|"B",
//   envolvidos: [{
//     atleta_id?, tecnico_id?,
//     categoria: "jogador_quadra"|"substituto"|"excluido"|"tecnico"|"assistente",
//     subtipo: "invasao"|"envolvimento_ativo"  // por envolvido — mesma briga
//                                                pode misturar sub que invadiu
//                                                sem brigar (D) e sub que
//                                                invadiu E brigou (D2).
//   }],
//   delegacao_count?: number,
//   delegacao_subtipo?: "invasao"|"envolvimento_ativo",  // obrigatorio se count>0
//   fight_group_id?: string  // omitido = nova briga; setado = adiciona a briga existente
// }
//
// Letras geradas (por envolvido):
//   invasao  + jogador_quadra/substituto/excluido/assistente → D (sem numero)
//   invasao  + tecnico (saiu do banco)                      → D2
//   envolvimento_ativo + qualquer envolvido                  → D2
// Cascata UNICA B2 (LL=2) no tec. principal — mesma briga = mesma B2.
// PDF preenche F nos slots restantes do envolvido (auto via subtipo_briga).
export const registrarBriga = async (req, res) => {
  const { id } = req.params;
  const {
    equipe,
    envolvidos,
    fight_group_id: groupIdEntrada,
    delegacao_count: delegacaoCountRaw,
    delegacao_subtipo: delegacaoSubtipo,
  } = req.body || {};
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe invalida" });
    }
    const delegacaoCount = Number.isFinite(Number(delegacaoCountRaw))
      ? Math.max(0, Math.floor(Number(delegacaoCountRaw)))
      : 0;
    if (
      delegacaoCount > 0 &&
      !["invasao", "envolvimento_ativo"].includes(delegacaoSubtipo)
    ) {
      return res.status(400).json({
        message: "delegacao_subtipo obrigatorio (invasao|envolvimento_ativo) quando delegacao_count > 0",
      });
    }
    const envolvidosArr = Array.isArray(envolvidos) ? envolvidos : [];
    if (envolvidosArr.length === 0 && delegacaoCount === 0) {
      return res.status(400).json({
        message: "briga requer pelo menos 1 envolvido OU 1 delegacao",
      });
    }
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res.status(400).json({ message: "Sumula nao esta em andamento" });
    }

    // Resolve tecnico principal — alvo natural da cascata B2. Para a herança
    // de cargo (Art. 37 — usado quando principal ja esta fora) chamamos
    // resolverResponsavelCascata mais abaixo, apos criar os eventos da briga,
    // para que o calculo considere o estado atualizado.
    const { principal } = obterComissaoMembros(sumula, equipe);
    const principalId = principal?.tecnico_id ? String(principal.tecnico_id) : null;
    // FIBA Art. 7.9 — quando o tecnico principal e um jogador-tecnico, ele e
    // identificado por atleta_id (nao tecnico_id). Usado pra detectar
    // principal-envolvido e deduplicar a cascata B2.
    const principalAtletaId = principal?.atleta_id
      ? String(principal.atleta_id)
      : null;

    // Fight group: reusa se passado (briga existente), cria novo se omitido.
    const fight_group_id = groupIdEntrada
      ? new mongoose.Types.ObjectId(groupIdEntrada)
      : new mongoose.Types.ObjectId();

    // Valida envolvidos (categoria + subtipo + atleta_id/tecnico_id).
    // Bloqueia jogador ja desqualificado (FIBA: deveria ter deixado o ginasio
    // — incidentes com ele sao ata extra, nao briga regular).
    let tecnicoPrincipalEnvolvido = false;
    for (const env of envolvidosArr) {
      if (
        !["jogador_quadra", "substituto", "excluido", "tecnico", "assistente"].includes(
          env.categoria,
        )
      ) {
        return res
          .status(400)
          .json({ message: `categoria invalida: ${env.categoria}` });
      }
      if (!["invasao", "envolvimento_ativo"].includes(env.subtipo)) {
        return res.status(400).json({
          message: "envolvido requer subtipo (invasao|envolvimento_ativo)",
        });
      }
      // FIBA Art. 7.9 — jogador-tecnico envolvido na briga enquanto esta no
      // banco atua como COACH: enviado com categoria "tecnico" + atleta_id (sem
      // tecnico_id, pois e um atleta do roster). D/D2 vai pra linha do tecnico
      // (categoria "tecnico" + jogador_id) e espelha na linha de jogador dele.
      const ehJTCoach =
        env.categoria === "tecnico" && env.atleta_id && !env.tecnico_id;
      if (ehJTCoach) {
        const jogador = findJogadorEmSumula(sumula, equipe, env.atleta_id);
        if (!jogador) {
          return res
            .status(400)
            .json({ message: "atleta nao pertence a equipe" });
        }
        if (!jogador.jogador_tecnico) {
          return res.status(400).json({
            message:
              "categoria 'tecnico' com atleta_id so e valida para jogador-tecnico",
          });
        }
        if (jogador.desqualificado) {
          return res.status(400).json({
            message: `jogador-tecnico ${env.atleta_id} ja desqualificado — deveria ter deixado o ginasio.`,
          });
        }
        if (principalAtletaId && String(env.atleta_id) === principalAtletaId) {
          tecnicoPrincipalEnvolvido = true;
        }
      } else if (env.categoria === "tecnico" || env.categoria === "assistente") {
        if (!env.tecnico_id) {
          return res.status(400).json({
            message: "tecnico/assistente envolvido requer tecnico_id",
          });
        }
        if (env.categoria === "tecnico" && String(env.tecnico_id) === principalId) {
          tecnicoPrincipalEnvolvido = true;
        }
      } else {
        if (!env.atleta_id) {
          return res.status(400).json({
            message: `${env.categoria} envolvido requer atleta_id`,
          });
        }
        const jogador = findJogadorEmSumula(sumula, equipe, env.atleta_id);
        if (jogador?.desqualificado) {
          return res.status(400).json({
            message: `atleta ${env.atleta_id} ja desqualificado — deveria ter deixado o ginasio. Reportar ao evento.`,
          });
        }
      }
    }

    const ultimaSeq = await EventoSumula.findOne({ sumula_id: sumula._id })
      .sort({ sequencia: -1 })
      .select("sequencia");
    let proxSeq = (ultimaSeq?.sequencia || 0) + 1;

    const eventosCriados = [];
    for (const env of envolvidosArr) {
      const ehJTCoach =
        env.categoria === "tecnico" && env.atleta_id && !env.tecnico_id;
      // Letra + LL por subtipo+categoria (subtipo agora vem por envolvido).
      let tipoFalta = "D";
      let ll;
      if (ehJTCoach) {
        // FIBA Art. 7.9 — jogador-tecnico (coach) envolvido na briga: SEMPRE D2.
        // Nao existe "invasao" pra ele — como tecnico do time pode entrar em
        // quadra pra separar a briga, entao a anotacao e sempre D2 (LL=2). Os 2
        // LL ficam na linha do tecnico; a linha de jogador dele espelha so a
        // letra "D" (PDF suprime o nº — montarSlotsFalta).
        ll = 2;
      } else if (env.categoria === "tecnico" || env.categoria === "jogador_quadra") {
        // Tecnico saindo do banco OU jogador quadra envolvido = D2.
        ll = 2;
      } else {
        // substituto/excluido/assistente: invasao=D sem numero; envolvimento=D2.
        ll = env.subtipo === "invasao" ? 0 : 2;
      }
      const ehAtleta =
        env.categoria === "jogador_quadra" ||
        env.categoria === "substituto" ||
        env.categoria === "excluido";
      // JT-coach grava jogador_id (linha de jogador espelha o D + F) MAS
      // categoria "tecnico" (linha Head coach recebe o D/D2 com o nº de LL).
      const gravaJogadorId = ehAtleta || ehJTCoach;
      const evento = await EventoSumula.create({
        sumula_id: sumula._id,
        sequencia: proxSeq++,
        quarto: sumula.quarto_atual,
        tipo: "falta",
        equipe,
        jogador_id: gravaJogadorId ? env.atleta_id : null,
        tecnico_id: gravaJogadorId ? null : env.tecnico_id,
        categoria_pessoa: env.categoria,
        tipo_falta: tipoFalta,
        lances_livres: ll,
        subtipo_briga: env.subtipo,
        fight_group_id,
        ip: req.ip,
        user_agent: req.get("user-agent") || null,
      });
      eventosCriados.push(evento);

      // Atualiza estado do atleta — D em briga conta como pessoal e desqualifica.
      // JT-coach tambem: a linha de jogador dele mostra D + F, e ele e DQ.
      if (gravaJogadorId) {
        const jogador = findJogadorEmSumula(sumula, equipe, env.atleta_id);
        if (jogador) {
          jogador.faltas += 1;
          if (jogador.faltas >= FALTAS_PESSOAIS_LIMITE) {
            jogador.excluido = true;
          }
          jogador.desqualificado = true;
          jogador.em_quadra = false;
        }
      }
    }

    // Cascata B2 unica por briga (FIBA B.8.3.14/.15). LL=2 sempre — qualquer
    // briga (invasao OU envolvimento) gera B2 no tec. principal. NAO cria se:
    //   - briga so tem delegacoes (delegacoes ja geram marcas circuladas
    //     proprias — nao precisam cascata adicional)
    //   - tecnico principal ja esta entre envolvidos (D2 dele cobre obrigacao)
    //   - briga existente ja tem cascata B2 registrada (dedup fight_group_id)
    //   - sem principal definido na comissao
    // subtipo_briga da cascata: prioriza envolvimento_ativo se houver algum
    // (severidade maior); senao invasao.
    let cascataCriada = null;
    const temEnvolvidoNaoTecnico = envolvidosArr.length > 0;
    // FIBA Art. 37 — alvo da cascata existe se ha tecnico principal por
    // tecnico_id OU por atleta_id (jogador-tecnico).
    const temPrincipal = !!(principalId || principalAtletaId);
    if (temPrincipal && !tecnicoPrincipalEnvolvido && temEnvolvidoNaoTecnico) {
      // FIBA Art. 37 — herança de cargo: se principal ja esta desqualificado,
      // cascata B2 vai pro 1o assistente; se nao houver, capitao em quadra.
      // Considera todos os eventos ja existentes + os recem-criados desta briga
      // (que podem incluir D no proprio principal/assistente/capitao).
      const eventosBaseHeranca = await EventoSumula.find({
        sumula_id: sumula._id,
        cancelado: false,
      }).sort({ sequencia: 1 });
      const alvoCascata = resolverResponsavelCascata(
        sumula,
        equipe,
        eventosBaseHeranca,
      );
      const jaCascata = await EventoSumula.exists({
        sumula_id: sumula._id,
        fight_group_id,
        tipo_falta: "B",
        cancelado: false,
        marcador_circulo: false,
      });
      if (!jaCascata) {
        const subtipoCascata = envolvidosArr.some(
          (e) => e.subtipo === "envolvimento_ativo",
        )
          ? "envolvimento_ativo"
          : "invasao";
        const baseCascata = {
          sumula_id: sumula._id,
          sequencia: proxSeq++,
          quarto: sumula.quarto_atual,
          tipo: "falta",
          equipe,
          categoria_pessoa:
            alvoCascata.role === "capitao" ? "jogador_quadra" : "tecnico",
          tipo_falta: "B",
          lances_livres: 2,
          subtipo_briga: subtipoCascata,
          fight_group_id,
          cascata_de: eventosCriados[0]._id,
          ip: req.ip,
          user_agent: req.get("user-agent") || null,
        };
        if (alvoCascata.tecnico_id) {
          cascataCriada = await EventoSumula.create({
            ...baseCascata,
            tecnico_id: alvoCascata.tecnico_id,
            jogador_id: null,
          });
        } else if (alvoCascata.jogador_id) {
          cascataCriada = await EventoSumula.create({
            ...baseCascata,
            jogador_id: alvoCascata.jogador_id,
            tecnico_id: null,
          });
        }
        if (cascataCriada) eventosCriados.push(cascataCriada);
        await aplicarGdCascataJogadorTecnico(sumula, equipe, alvoCascata);
      }
    }

    // FIBA B.8.3.13/.14/.15 — membros da delegacao acompanhante: cada
    // disqualifying foul vira marca CIRCULADA na linha do tecnico principal.
    // Sempre B2 (LL=2) — qualquer briga (invasao OU envolvimento) = B2.
    // NAO conta para o limite de 3 tecnicas que dispara GD do tecnico
    // (calcularStatusComissao filtra marcador_circulo).
    // Alvo da delegacao = linha do tecnico principal (Head coach). Suporta o
    // jogador-tecnico (FIBA Art. 7.9): sem tecnico inscrito, a B2 circulada cai
    // no jogador_id do JT ATIVO (original ou 2o capitao sucessor) com categoria
    // "tecnico" + marcador_circulo (nao conta GD nem falta de equipe).
    const listaDelegacao =
      equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    const jtAtivoDelegacao = principalId
      ? null
      : acharJogadorTecnicoAtivo(listaDelegacao);
    const delegacaoAlvo = principalId
      ? { tecnico_id: principalId }
      : jtAtivoDelegacao && !jtAtivoDelegacao.desqualificado
        ? { jogador_id: jtAtivoDelegacao.atleta_id }
        : null;
    if (delegacaoCount > 0 && delegacaoAlvo) {
      for (let i = 0; i < delegacaoCount; i++) {
        const delEv = await EventoSumula.create({
          sumula_id: sumula._id,
          sequencia: proxSeq++,
          quarto: sumula.quarto_atual,
          tipo: "falta",
          equipe,
          tecnico_id: delegacaoAlvo.tecnico_id || null,
          jogador_id: delegacaoAlvo.jogador_id || null,
          categoria_pessoa: "tecnico",
          tipo_falta: "B",
          lances_livres: 2,
          subtipo_briga: delegacaoSubtipo,
          fight_group_id,
          marcador_circulo: true,
          ip: req.ip,
          user_agent: req.get("user-agent") || null,
        });
        eventosCriados.push(delEv);
      }
    }

    await sumula.save();
    const resposta = await montarRespostaSumula(sumula);
    res.status(201).json({
      fight_group_id: fight_group_id.toString(),
      eventos: eventosCriados,
      ...resposta,
    });
  } catch (error) {
    console.error("[sumula] registrarBriga:", error);
    res
      .status(500)
      .json({ message: "Erro ao registrar briga", error: error.message });
  }
};

// --- REGISTRAR FALTA DE DELEGAÇÃO ACOMPANHANTE (FIBA B.8.3.13/.14/.15) ---
// Membro da delegacao acompanhante (nao listado individualmente na sumula)
// recebe D ou D2 → unica anotacao "B" ou "B2" no tecnico principal com marca
// de circulo (ⓑ / B₂ circulado). NAO conta para o limite de 3 tecnicas que
// gera GD do tecnico.
//
// Body: {
//   equipe: "A"|"B",
//   subtipo: "normal"|"invasao"|"envolvimento_ativo"  // "normal" = falta isolada de delegacao
// }
export const registrarFaltaDelegacao = async (req, res) => {
  const { id } = req.params;
  const { equipe, subtipo } = req.body || {};
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe invalida" });
    }
    if (!["normal", "invasao", "envolvimento_ativo"].includes(subtipo)) {
      return res
        .status(400)
        .json({ message: "subtipo invalido (normal|invasao|envolvimento_ativo)" });
    }
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res.status(400).json({ message: "Sumula nao esta em andamento" });
    }
    const { principal } = obterComissaoMembros(sumula, equipe);
    const principalId = principal?.tecnico_id ? String(principal.tecnico_id) : null;
    // FIBA Art. 7.9 — sem tecnico inscrito, a B2 circulada cai no jogador_id do
    // jogador-tecnico ATIVO (original ou 2o capitao sucessor).
    const listaDel = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    const jtDel = principalId ? null : acharJogadorTecnicoAtivo(listaDel);
    const alvo = principalId
      ? { tecnico_id: principalId }
      : jtDel && !jtDel.desqualificado
        ? { jogador_id: jtDel.atleta_id }
        : null;
    if (!alvo) {
      return res
        .status(400)
        .json({ message: "tecnico principal nao definido na comissao" });
    }
    const ultimaSeq = await EventoSumula.findOne({ sumula_id: sumula._id })
      .sort({ sequencia: -1 })
      .select("sequencia");
    const proxSeq = (ultimaSeq?.sequencia || 0) + 1;
    // LL: normal=2 (B2 padrao para delegacao), invasao=2, envolvimento=2.
    // Sempre B2 com circulo conforme exemplos B.8.3.14/.15.
    const evento = await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: proxSeq,
      quarto: sumula.quarto_atual,
      tipo: "falta",
      equipe,
      tecnico_id: alvo.tecnico_id || null,
      jogador_id: alvo.jogador_id || null,
      categoria_pessoa: "tecnico",
      tipo_falta: "B",
      lances_livres: 2,
      subtipo_briga: subtipo === "normal" ? null : subtipo,
      marcador_circulo: true,
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });
    const resposta = await montarRespostaSumula(sumula);
    res.status(201).json({ evento, ...resposta });
  } catch (error) {
    console.error("[sumula] registrarFaltaDelegacao:", error);
    res
      .status(500)
      .json({ message: "Erro ao registrar falta delegacao", error: error.message });
  }
};

// --- ATUALIZAR EM QUADRA (snapshot pos timeout / fim_quarto) ---
// FIBA: tecnico nao precisa anunciar pares de substituicao apos timeout ou
// fim de quarto. Mesario marca quem esta em quadra; o sistema persiste o
// snapshot como evento set_em_quadra, atualiza sumula.jogadores_X.em_quadra
// e usa o evento para inferir entradas no PDF (coluna E.).
export const atualizarEmQuadra = async (req, res) => {
  const { id } = req.params;
  const { equipe, jogadores } = req.body || {};
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res.status(400).json({ message: "Sumula nao esta em andamento" });
    }
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe invalida" });
    }
    if (!Array.isArray(jogadores) || jogadores.length < 2 || jogadores.length > 5) {
      return res
        .status(400)
        .json({ message: "jogadores deve ter 2 a 5 atleta_ids" });
    }
    const ids = jogadores.map((x) => x.toString());
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ message: "jogadores nao pode ter ids duplicados" });
    }
    const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    for (const aid of ids) {
      const jog = lista.find((j) => j.atleta_id.toString() === aid);
      if (!jog) {
        return res
          .status(400)
          .json({ message: "atleta nao pertence a equipe" });
      }
      if (jog.excluido || jog.desqualificado) {
        return res
          .status(400)
          .json({ message: "atleta excluido/desqualificado nao pode estar em quadra" });
      }
    }

    const ultimaSeq = await EventoSumula.findOne({ sumula_id: sumula._id })
      .sort({ sequencia: -1 })
      .select("sequencia");
    const proxSeq = (ultimaSeq?.sequencia || 0) + 1;

    const evento = await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: proxSeq,
      quarto: sumula.quarto_atual,
      tipo: "set_em_quadra",
      equipe,
      jogadores_em_quadra: ids,
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });

    const idsSet = new Set(ids);
    for (const j of lista) {
      if (j.excluido || j.desqualificado) {
        j.em_quadra = false;
        continue;
      }
      j.em_quadra = idsSet.has(j.atleta_id.toString());
    }
    await sumula.save();

    const resposta = await montarRespostaSumula(sumula);
    res.status(201).json({ evento, ...resposta });
  } catch (error) {
    console.error("[sumula] atualizarEmQuadra:", error);
    res
      .status(500)
      .json({ message: "Erro ao atualizar em quadra", error: error.message });
  }
};

// --- 2o CAPITAO: sucessor do jogador-tecnico expulso (FIBA Art. 7.9) ---
// Quando o jogador-tecnico (que atua como capitao-tecnico) e desqualificado e
// a equipe nao tem assistente inscrito, um novo capitao e designado. Ele assume
// como jogador-tecnico (todas as responsabilidades/GD combinado) e aparece na
// linha do 1o assistente do PDF com o sufixo "(2o CAP)". O original (expulso)
// permanece na comissao (linha TECNICO) com suas faltas.
// Body: { equipe: "A"|"B", atleta_id }
export const definirSucessorTecnico = async (req, res) => {
  const { id } = req.params;
  const { equipe, atleta_id } = req.body || {};
  try {
    if (!["A", "B"].includes(equipe)) {
      return res.status(400).json({ message: "equipe invalida" });
    }
    if (!atleta_id) {
      return res.status(400).json({ message: "atleta_id obrigatorio" });
    }
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res.status(400).json({ message: "Sumula nao esta em andamento" });
    }
    const { principal, assistente } = obterComissaoMembros(sumula, equipe);
    if (!principal?.atleta_id) {
      return res
        .status(400)
        .json({ message: "Equipe nao usa jogador-tecnico (FIBA Art. 7.9)" });
    }
    if (assistente) {
      return res.status(400).json({
        message: "Equipe tem assistente inscrito — sucessao nao se aplica",
      });
    }
    const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    // O jogador-tecnico em exercicio precisa estar expulso para haver sucessao.
    const atual = acharJogadorTecnicoAtivo(lista);
    if (atual && !atual.desqualificado) {
      return res
        .status(400)
        .json({ message: "Jogador-tecnico em exercicio ainda esta em jogo" });
    }
    const novoStr = atleta_id.toString();
    const novo = (lista || []).find(
      (j) => j.atleta_id && j.atleta_id.toString() === novoStr,
    );
    if (!novo) {
      return res.status(400).json({ message: "Atleta nao pertence a equipe" });
    }
    if (novo.excluido || novo.desqualificado) {
      return res
        .status(400)
        .json({ message: "Atleta indisponivel (excluido/expulso)" });
    }
    if (novo.numero === null || novo.numero === undefined) {
      return res
        .status(400)
        .json({ message: "2o capitao precisa de numero de camisa" });
    }
    if (novo.tecnico_sucessor && novo.jogador_tecnico) {
      return res
        .status(400)
        .json({ message: "Atleta ja e o 2o capitao em exercicio" });
    }
    // Troca de capitania + assume como jogador-tecnico sucessor. Mantem
    // exatamente 1 capitao na equipe (validado no pre-save do modelo).
    (lista || []).forEach((j) => {
      j.capitao = j.atleta_id && j.atleta_id.toString() === novoStr;
    });
    novo.jogador_tecnico = true;
    novo.tecnico_sucessor = true;
    await sumula.save();

    const resposta = await montarRespostaSumula(sumula);
    res.status(200).json(resposta);
  } catch (error) {
    console.error("[sumula] definirSucessorTecnico:", error);
    res
      .status(500)
      .json({ message: "Erro ao definir 2o capitao", error: error.message });
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
    // Desfazer definir_numero so e permitido enquanto o atleta nao registrou
    // nenhum evento depois — caso contrario sobrariam eventos de um atleta
    // sem numero (que sumiria da sumula). O botao desfazer global e LIFO e ja
    // garante isso, mas o log permite cancelar um evento especifico.
    if (evento.tipo === "definir_numero") {
      const posteriores = await EventoSumula.countDocuments({
        sumula_id: sumula._id,
        jogador_id: evento.jogador_id,
        sequencia: { $gt: evento.sequencia },
        cancelado: false,
      });
      if (posteriores > 0) {
        return res.status(400).json({
          message:
            "Atleta ja participou apos receber o numero — desfaca os eventos dele primeiro",
        });
      }
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
        // faltas recomputado dos eventos ativos (o evento ja foi marcado
        // cancelado acima) — evita drift de undo/redo.
        const estadoPosCancel = await computarEstado(sumula._id);
        jogador.faltas =
          estadoPosCancel.faltas_jogador[evento.jogador_id.toString()] || 0;
        jogador.excluido = jogador.faltas >= FALTAS_PESSOAIS_LIMITE;
        // Recalcula desqualificacao a partir dos eventos restantes.
        const faltasRestantes = await EventoSumula.find({
          sumula_id: sumula._id,
          jogador_id: evento.jogador_id,
          tipo: "falta",
          cancelado: false,
        });
        const temD = faltasRestantes.some(
          (e) =>
            e.tipo_falta === "D" ||
            e.tipo_falta === "U2" ||
            e.tipo_falta === "F"
        );
        const countU = faltasRestantes.filter(
          (e) => e.tipo_falta === "U" || e.tipo_falta === "U2"
        ).length;
        const countT = faltasRestantes.filter(
          (e) => e.tipo_falta === "T"
        ).length;
        const temUeT = countU >= 1 && countT >= 1;
        let desq = temD || countU >= 2 || countT >= 2 || temUeT;
        // FIBA Art. 7.9 / B.8.3.7 — jogador-tecnico: matriz de GD combinada
        // (T/U como jogador + C/B como tecnico).
        if (jogador.jogador_tecnico) {
          const countC = faltasRestantes.filter(
            (e) => e.tipo_falta === "C" && !e.marcador_circulo
          ).length;
          const countB = faltasRestantes.filter(
            (e) => e.tipo_falta === "B" && !e.marcador_circulo
          ).length;
          const tu = countU + countT;
          desq =
            desq ||
            tu >= 2 ||
            countC >= 2 ||
            countB >= 3 ||
            (countC >= 1 && tu >= 1) ||
            (countB >= 2 && tu >= 1) ||
            (countC >= 1 && countB >= 2);
        }
        jogador.desqualificado = desq;
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

    // Se cancelou um TO real precedido pelo TO sintetico "perdido_2min",
    // cancela tambem o sintetico — caso contrario sobra um slot riscado
    // sem o TO real que o motivou.
    if (
      evento.tipo === "timeout" &&
      !evento.perdido_2min &&
      evento.equipe
    ) {
      const anterior = await EventoSumula.findOne({
        sumula_id: sumula._id,
        sequencia: { $lt: evento.sequencia },
        tipo: "timeout",
        equipe: evento.equipe,
        perdido_2min: true,
        cancelado: false,
      }).sort({ sequencia: -1 });
      if (anterior) {
        anterior.cancelado = true;
        await anterior.save();
      }
    }

    // Cancelar set_em_quadra: reverte em_quadra para o snapshot anterior
    // (set_em_quadra ativo previo) ou para os titulares iniciais (se nao
    // existir). Permite ao mesario desfazer e refazer a selecao.
    if (evento.tipo === "set_em_quadra" && evento.equipe) {
      const lista =
        evento.equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
      const anterior = await EventoSumula.findOne({
        sumula_id: sumula._id,
        sequencia: { $lt: evento.sequencia },
        tipo: "set_em_quadra",
        equipe: evento.equipe,
        cancelado: false,
      }).sort({ sequencia: -1 });
      if (anterior) {
        const ids = new Set(
          (anterior.jogadores_em_quadra || []).map((x) => x.toString()),
        );
        for (const j of lista) {
          if (j.excluido || j.desqualificado) {
            j.em_quadra = false;
            continue;
          }
          j.em_quadra = ids.has(j.atleta_id.toString());
        }
      } else {
        for (const j of lista) {
          if (j.excluido || j.desqualificado) {
            j.em_quadra = false;
            continue;
          }
          j.em_quadra = !!j.titular;
        }
      }
      await sumula.save();
    }

    // Cancelar definir_numero: atleta volta a ficar sem numero. So e possivel
    // desfazer enquanto ele nao registrou nenhum evento (garantido pela ordem
    // LIFO do botao desfazer — sem numero ele nao pode pontuar).
    if (
      evento.tipo === "definir_numero" &&
      evento.equipe &&
      evento.jogador_id
    ) {
      const jogador = findJogadorEmSumula(
        sumula,
        evento.equipe,
        evento.jogador_id
      );
      if (jogador) {
        jogador.numero = null;
        await sumula.save();
      }
    }

    // Se o undo reintegrou o jogador-tecnico original, desfaz a sucessao do
    // 2o capitao (capitania volta ao original; flags do sucessor limpas).
    const revA = reverterSucessaoSeReintegrado(sumula, "A");
    const revB = reverterSucessaoSeReintegrado(sumula, "B");
    if (revA || revB) await sumula.save();

    const resposta = await montarRespostaSumula(sumula);
    res.json({ evento, ...resposta });
  } catch (error) {
    console.error("[sumula] cancelarEvento:", error);
    res
      .status(500)
      .json({ message: "Erro ao cancelar evento", error: error.message });
  }
};

// --- DURANTE O JOGO: definir numero de atleta escalado sem numero ---
// Atleta que chegou atrasado entra na escalacao sem numero e nao pode pontuar.
// O mesario define o numero quando ele chega; o atleta fica disponivel como
// substituto no banco. Registrado como evento para entrar no botao desfazer.
export const definirNumeroJogador = async (req, res) => {
  const { id, atletaId } = req.params;
  const { numero } = req.body;
  try {
    const sumula = await Sumula.findById(id);
    if (!sumula) return res.status(404).json({ message: "Sumula nao encontrada" });
    if (sumula.status !== "em_andamento") {
      return res.status(400).json({ message: "Sumula nao esta em andamento" });
    }
    if (!Number.isInteger(numero) || numero < 0 || numero > 99) {
      return res.status(400).json({ message: "Numero fora do intervalo 0-99" });
    }

    let jogador = findJogadorEmSumula(sumula, "A", atletaId);
    let equipe = "A";
    if (!jogador) {
      jogador = findJogadorEmSumula(sumula, "B", atletaId);
      equipe = "B";
    }
    if (!jogador) {
      return res.status(404).json({ message: "Atleta nao esta na escalacao" });
    }
    if (jogador.numero !== null && jogador.numero !== undefined) {
      return res
        .status(400)
        .json({ message: "Atleta ja possui numero de camisa" });
    }

    const lista = equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
    if (lista.some((j) => j.numero === numero)) {
      return res
        .status(400)
        .json({ message: `Numero ${numero} ja usado na equipe ${equipe}` });
    }

    jogador.numero = numero;

    const ultimaSeq = await EventoSumula.findOne({ sumula_id: sumula._id })
      .sort({ sequencia: -1 })
      .select("sequencia");
    const proxSeq = (ultimaSeq?.sequencia || 0) + 1;

    await EventoSumula.create({
      sumula_id: sumula._id,
      sequencia: proxSeq,
      quarto: sumula.quarto_atual,
      tipo: "definir_numero",
      equipe,
      jogador_id: atletaId,
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });

    await sumula.save();
    const resposta = await montarRespostaSumula(sumula);
    res.json(resposta);
  } catch (error) {
    console.error("[sumula] definirNumeroJogador:", error);
    res.status(400).json({ message: error.message });
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

  // Contadores por jogador p/ detectar 2 U, 2 T, U+T (GD). cs/bs sao usados
  // so para o jogador-tecnico (matriz combinada B.8.3.7).
  const usPorJog = new Map();
  const tsPorJog = new Map();
  const csPorJog = new Map();
  const bsPorJog = new Map();
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
      // FIBA OBRI 36-33 — para o jogador-tecnico, C/B (categoria "tecnico")
      // tambem contam para o limite de 5.
      const pessoal =
        ["P", "P2", "U", "U2", "T", "D", "F"].includes(ev.tipo_falta) ||
        (jogador.jogador_tecnico &&
          (ev.tipo_falta === "C" || ev.tipo_falta === "B") &&
          !ev.marcador_circulo);
      if (pessoal) {
        jogador.faltas += 1;
        if (jogador.faltas >= FALTAS_PESSOAIS_LIMITE) {
          jogador.excluido = true;
        }
      }
      if (
        ev.tipo_falta === "D" ||
        ev.tipo_falta === "U2" ||
        ev.tipo_falta === "F"
      ) {
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
        // FIBA Art. 7.9 / B.8.3.7 — jogador-tecnico: matriz de GD combinada
        // (T/U como jogador + C/B como tecnico).
        if (jogador.jogador_tecnico) {
          if (ev.tipo_falta === "C" && !ev.marcador_circulo) inc(csPorJog, key);
          if (ev.tipo_falta === "B" && !ev.marcador_circulo) inc(bsPorJog, key);
          const tu = us + ts;
          const c = csPorJog.get(key) || 0;
          const b = bsPorJog.get(key) || 0;
          if (
            tu >= 2 ||
            c >= 2 ||
            b >= 3 ||
            (c >= 1 && tu >= 1) ||
            (b >= 2 && tu >= 1) ||
            (c >= 1 && b >= 2)
          ) {
            jogador.desqualificado = true;
          }
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

    if (ev.tipo === "set_em_quadra") {
      const lista =
        ev.equipe === "A" ? sumula.jogadores_a : sumula.jogadores_b;
      const novosIds = new Set(
        (ev.jogadores_em_quadra || []).map((x) => x.toString()),
      );
      for (const j of lista) {
        if (j.excluido || j.desqualificado) {
          j.em_quadra = false;
          continue;
        }
        j.em_quadra = novosIds.has(j.atleta_id.toString());
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
  const { protesto, observacoes } = req.body || {};
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

    sumula.observacoes =
      typeof observacoes === "string" ? observacoes.trim() : "";

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
          const obj = m.toObject ? m.toObject() : m;
          // FIBA Art. 7.9 — jogador-tecnico: assinatura ja foi coletada ao vivo
          // no pre-jogo e vive na propria sumula. Preserva (nao tem Tecnico de
          // onde puxar).
          if (obj.atleta_id) return obj;
          const info = m.tecnico_id
            ? mapSig.get(m.tecnico_id.toString())
            : null;
          return {
            ...obj,
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
        finalizado_por: "sumula",
      },
      { new: true }
    );

    // Avisa os viewers ao vivo que o jogo encerrou (trocam para a visão final).
    aoVivoBus.publicar(String(sumula.jogo_id), {
      encerrado: true,
      placar: { A: sumula.placar_final.pontos_a, B: sumula.placar_final.pontos_b },
    });

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

      // Observações ainda não estão persistidas no banco (só ao finalizar).
      // Front pode enviar o texto digitado via query para o preview refletir.
      if (typeof req.query.observacoes === "string") {
        sumulaObj.observacoes = req.query.observacoes.trim();
      }
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
