import { EventoSumula } from "../models/EventoSumula.js";

// Constantes FIBA de quartos usadas pelo cálculo de timeouts por metade.
export const QUARTO_FIM_PRIMEIRA_METADE = 2;
export const QUARTO_FINAL = 4;

// Recalcula o estado completo da súmula a partir dos eventos (fonte da verdade).
// Usado tanto pelo controller do mesário quanto pela visão pública ao vivo.
export const computarEstado = async (sumulaId) => {
  const eventos = await EventoSumula.find({
    sumula_id: sumulaId,
    cancelado: false,
  }).sort({ sequencia: 1 });

  const estado = {
    placar: { A: 0, B: 0 },
    placar_por_quarto: {},
    faltas_equipe_por_quarto: {},
    timeouts: {
      A: { primeira: 0, segunda: 0, prorrogacao: {} },
      B: { primeira: 0, segunda: 0, prorrogacao: {} },
    },
    faltas_jogador: {},
    pontos_jogador: {},
    eventos,
  };

  // Faltas que contam como pessoal do atleta (C e B sao do tecnico).
  // F (briga, Art. 39) conta como pessoal e ainda preenche os espacos
  // restantes do atleta no PDF (B.8.3.14).
  const FALTAS_PESSOAIS = ["P", "P2", "U", "U2", "T", "D", "F"];
  // FIBA B.9.2 (interpretacao confirmada): apenas faltas P/T/U/D cometidas
  // por jogador EM QUADRA contam como falta de equipe.
  // Excluem-se: F (briga, Art. 39), C/B do tecnico (sem jogador_id), cascatas
  // B2, faltas de jogador excluido/banco/assistente, e qualquer evento com
  // marcador_circulo (delegacao acompanhante).
  const FALTAS_TEAM_FOUL = ["P", "P2", "U", "U2", "T", "D"];

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
      const ehFaltaJogadorQuadra =
        FALTAS_TEAM_FOUL.includes(ev.tipo_falta) &&
        ev.jogador_id &&
        !ev.cascata_de &&
        !ev.marcador_circulo &&
        (ev.categoria_pessoa === "jogador_quadra" ||
          ev.categoria_pessoa == null); // null = legado, assume jogador_quadra
      if (ehFaltaJogadorQuadra) {
        estado.faltas_equipe_por_quarto[fKey] =
          (estado.faltas_equipe_por_quarto[fKey] || 0) + 1;
      }
      // FIBA OBRI 36-33 — o jogador-tecnico e excluido como jogador ao
      // somar 5 faltas como jogador E como tecnico. Suas C/B (categoria
      // "tecnico", com jogador_id) tambem contam para o limite de 5.
      const ehCoachJogadorTecnico =
        (ev.tipo_falta === "C" || ev.tipo_falta === "B") &&
        ev.categoria_pessoa === "tecnico" &&
        !ev.marcador_circulo;
      if (
        (FALTAS_PESSOAIS.includes(ev.tipo_falta) || ehCoachJogadorTecnico) &&
        ev.jogador_id
      ) {
        const jogadorKey = ev.jogador_id.toString();
        estado.faltas_jogador[jogadorKey] =
          (estado.faltas_jogador[jogadorKey] || 0) + 1;
      }
    }
    if (ev.tipo === "timeout") {
      if (ev.quarto > QUARTO_FINAL) {
        const q = ev.quarto;
        const slot = estado.timeouts[ev.equipe].prorrogacao;
        slot[q] = (slot[q] || 0) + 1;
      } else {
        const metade =
          ev.quarto <= QUARTO_FIM_PRIMEIRA_METADE ? "primeira" : "segunda";
        estado.timeouts[ev.equipe][metade] += 1;
      }
    }
  }

  return estado;
};

// Resolve nome + numero de camisa de um atleta a partir das listas da súmula.
const construirMapaJogadores = (sumula) => {
  const map = new Map();
  for (const lista of [sumula.jogadores_a, sumula.jogadores_b]) {
    for (const j of lista || []) {
      const at = j.atleta_id;
      if (!at) continue;
      const id = (at._id || at).toString();
      map.set(id, {
        nome: at.nome_completo || "—",
        numero: j.numero ?? null,
      });
    }
  }
  return map;
};

// Feed jogada-a-jogada estruturado (sem texto pronto — o front formata e
// aplica a cor por equipe). Recebe os eventos já ordenados por sequência.
export const montarFeedAoVivo = (sumula, eventos) => {
  const mapa = construirMapaJogadores(sumula);
  const resolver = (jid) => (jid ? mapa.get(jid.toString()) || null : null);
  return eventos.map((e) => {
    const ev = e.toObject ? e.toObject() : e;
    return {
      seq: ev.sequencia,
      quarto: ev.quarto,
      tipo: ev.tipo,
      valor: ev.valor ?? null,
      tipo_falta: ev.tipo_falta ?? null,
      equipe: ev.equipe ?? null,
      jogador: resolver(ev.jogador_id),
      jogador_entra: resolver(ev.jogador_entra_id),
      jogador_sai: resolver(ev.jogador_sai_id),
    };
  });
};

// IDs dos atletas atualmente em quadra por equipe (muda a cada substituição).
const emQuadraIds = (lista) =>
  (lista || [])
    .filter((j) => j.em_quadra && j.atleta_id)
    .map((j) => String(j.atleta_id._id || j.atleta_id));

// Parte DINÂMICA do payload ao vivo (placar + feed + faltas de equipe + quem
// está em quadra) — o que muda durante o jogo e é re-enviado a cada evento via
// SSE. A parte estática (árbitros, técnicos, competição, data, elenco) vem do
// snapshot inicial em publicController.
export const montarDinamicoAoVivo = (sumula, estado) => ({
  placar: estado.placar,
  placar_por_quarto: estado.placar_por_quarto,
  // Faltas de equipe por quarto, chaveado "quarto-equipe" (ex.: "1-A").
  faltas_equipe_por_quarto: estado.faltas_equipe_por_quarto,
  quarto_atual: sumula.quarto_atual,
  em_quadra: {
    A: emQuadraIds(sumula.jogadores_a),
    B: emQuadraIds(sumula.jogadores_b),
  },
  feed: montarFeedAoVivo(sumula, estado.eventos),
});
