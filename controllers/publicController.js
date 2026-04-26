import { Equipe } from "../models/Equipe.js";
import { Jogo } from "../models/Jogo.js";
import { Escalacao } from "../models/Escalacao.js";
import { Competicao } from "../models/Competicao.js";
import { Inscricao } from "../models/Inscricao.js";
import { Sumula } from "../models/Sumula.js";
import { EventoSumula } from "../models/EventoSumula.js";
import Ponto from "../models/Ponto.js";
import mongoose from "mongoose";

export const getResultadosHome = async (req, res) => {
  try {
    const jogos = await Jogo.aggregate([
      // 1. Filtrar apenas jogos finalizados (opcional para a home)
      // { $match: { status: 'finalizado' } },

      // 2. Ordenar por data (mais recentes primeiro)
      { $sort: { data_jogo: -1 } },

      // 3. Join com Equipe A
      {
        $lookup: {
          from: "equipes",
          localField: "equipe_a_id",
          foreignField: "_id",
          as: "equipe_a",
        },
      },
      { $unwind: "$equipe_a" },

      // 5. Join com Equipe B
      {
        $lookup: {
          from: "equipes",
          localField: "equipe_b_id",
          foreignField: "_id",
          as: "equipe_b",
        },
      },
      { $unwind: "$equipe_b" },

      // 6. Join com Competição para pegar o array de categorias
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: "$competicao" },

      // 7. Resolver o nome da categoria usando $filter
      {
        $addFields: {
          categoria_info: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$competicao.categorias",
                  as: "cat",
                  cond: { $eq: ["$$cat._id", "$categoria_id"] },
                },
              },
              0,
            ],
          },
        },
      },

      // 8. Projetar o resultado final limpo
      {
        $project: {
          _id: 1,
          placar_a: 1,
          placar_b: 1,
          data_jogo: 1,
          local: 1,
          status: 1,
          equipe_a: { nome_equipe: "$equipe_a.nome_equipe" },
          equipe_b: { nome_equipe: "$equipe_b.nome_equipe" },
          competicao: { nome: "$competicao.nome", ano: "$competicao.ano" },
          categoria_nome: "$categoria_info.nome",
        },
      },
    ]);

    res.status(200).json(jogos);
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar resultados para a home",
      error: error.message,
    });
  }
};

export const getEquipes = async (req, res) => {
  try {
    const equipes = await Equipe.aggregate([
      // 1. Join com a coleção de usuários para pegar o Técnico
      {
        $lookup: {
          from: "usuarios",
          localField: "tecnico_id",
          foreignField: "_id",
          as: "tecnico",
        },
      },
      { $unwind: { path: "$tecnico", preserveNullAndEmptyArrays: true } },

      // 2. Join com a coleção de competições
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: { path: "$competicao", preserveNullAndEmptyArrays: true } },

      // 3. Filtra o array de categorias da competição para achar a correta
      {
        $addFields: {
          categoria: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$competicao.categorias",
                  as: "cat",
                  cond: { $eq: ["$$cat._id", "$categoria_id"] },
                },
              },
              0,
            ],
          },
        },
      },

      // 4. Limpa o output para o frontend
      {
        $project: {
          nome_equipe: 1,
          tecnico: { _id: 1, nome: 1, email: 1 },
          competicao: { _id: 1, nome: 1, ano: 1 },
          categoria: { _id: 1, nome: 1 },
        },
      },
    ]);

    res.status(200).json(equipes);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar equipes", error: error.message });
  }
};

export const getAtletasEquipePublic = async (req, res) => {
  const { id } = req.params;
  try {
    const inscricoes = await Inscricao.find({ equipe_id: id })
      .populate("atleta_id", "nome_completo data_nascimento")
      .sort({ createdAt: -1 });

    // Mapear retornando apenas dados públicos (sem documento_id, rg, etc)
    const atletas = inscricoes.map((inscricao) => ({
      _id: inscricao._id,
      status: inscricao.status,
      atleta_id: {
        _id: inscricao.atleta_id?._id,
        nome_completo: inscricao.atleta_id?.nome_completo,
        data_nascimento: inscricao.atleta_id?.data_nascimento,
        data_formatada: inscricao.atleta_id?.data_formatada,
      },
    }));

    res.json(atletas);
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar atletas da equipe",
      error: error.message,
    });
  }
};

export const getEscalacaoJogo = async (req, res) => {
  try {
    const { jogoId } = req.params;
    const { equipe_id } = req.query;

    // Valida o ID
    if (!mongoose.Types.ObjectId.isValid(jogoId)) {
      return res.status(400).json({ message: "ID de jogo inválido" });
    }

    // Monta o filtro
    const filtro = { jogo_id: new mongoose.Types.ObjectId(jogoId) };
    if (equipe_id && mongoose.Types.ObjectId.isValid(equipe_id)) {
      filtro.equipe_id = new mongoose.Types.ObjectId(equipe_id);
    }

    // Busca a escalação do jogo usando aggregation pipeline
    const escalacao = await Escalacao.aggregate([
      {
        $match: filtro,
      },
      {
        $lookup: {
          from: "atletas",
          localField: "atletas_selecionados",
          foreignField: "_id",
          as: "atletas_selecionados",
        },
      },
      {
        $project: {
          jogo_id: 1,
          equipe_id: 1,
          "atletas_selecionados._id": 1,
          "atletas_selecionados.nome_completo": 1,
        },
      },
    ]);

    if (!escalacao || escalacao.length === 0) {
      return res
        .status(404)
        .json({ message: "Escalação não encontrada para este jogo" });
    }

    res.status(200).json(escalacao[0]);
  } catch (error) {
    console.error("Erro ao buscar escalação:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar escalação", error: error.message });
  }
};

export const getClassificacao = async (req, res) => {
  try {
    const { categoria } = req.query;
    if (!categoria) {
      return res.status(400).json({ message: "Categoria é obrigatória" });
    }

    // Buscar a competição para validar e pegar o ID da categoria
    const competicao = await Competicao.findOne({
      "categorias.nome": categoria,
    });

    if (!competicao) {
      return res.status(404).json({ message: "Categoria não encontrada" });
    }

    const categoriaId = competicao.categorias.find(
      (cat) => cat.nome === categoria,
    )._id;

    // Agregação para calcular a classificação com critérios de desempate
    const classificacao = await Jogo.aggregate([
      // 1. Filtrar jogos finalizados da categoria
      {
        $match: {
          categoria_id: new mongoose.Types.ObjectId(categoriaId),
          status: "finalizado",
        },
      },

      // 2. Usar $facet para processar dados de ambas as equipes
      {
        $facet: {
          equipeA: [
            {
              $project: {
                equipe_id: "$equipe_a_id",
                equipe_adversaria_id: "$equipe_b_id",
                placar_pro: "$placar_a",
                placar_contra: "$placar_b",
                resultado: {
                  $cond: [
                    { $gt: ["$placar_a", "$placar_b"] },
                    "vitoria",
                    {
                      $cond: [
                        { $lt: ["$placar_a", "$placar_b"] },
                        "derrota",
                        "empate",
                      ],
                    },
                  ],
                },
              },
            },
          ],
          equipeB: [
            {
              $project: {
                equipe_id: "$equipe_b_id",
                equipe_adversaria_id: "$equipe_a_id",
                placar_pro: "$placar_b",
                placar_contra: "$placar_a",
                resultado: {
                  $cond: [
                    { $gt: ["$placar_b", "$placar_a"] },
                    "vitoria",
                    {
                      $cond: [
                        { $lt: ["$placar_b", "$placar_a"] },
                        "derrota",
                        "empate",
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      },

      // 3. Combinar os resultados
      {
        $project: {
          todos: { $concatArrays: ["$equipeA", "$equipeB"] },
        },
      },
      { $unwind: "$todos" },
      { $replaceRoot: { newRoot: "$todos" } },

      // 4. Agrupar por equipe e calcular estatísticas gerais
      {
        $group: {
          _id: "$equipe_id",
          jogos: { $sum: 1 },
          vitorias: {
            $sum: { $cond: [{ $eq: ["$resultado", "vitoria"] }, 1, 0] },
          },
          derrotas: {
            $sum: { $cond: [{ $eq: ["$resultado", "derrota"] }, 1, 0] },
          },
          pontos_pro: { $sum: "$placar_pro" },
          pontos_contra: { $sum: "$placar_contra" },
          confrontos: {
            $push: {
              equipe_adversaria_id: "$equipe_adversaria_id",
              resultado: "$resultado",
              placar_pro: "$placar_pro",
              placar_contra: "$placar_contra",
            },
          },
        },
      },

      // 5. Calcular saldo e pontos
      {
        $addFields: {
          saldo: { $subtract: ["$pontos_pro", "$pontos_contra"] },
          pontos: { $add: [{ $multiply: ["$vitorias", 2] }, "$derrotas"] },
        },
      },

      // 6. Fazer lookup para pegar o nome da equipe e manter ordem
      {
        $lookup: {
          from: "equipes",
          localField: "_id",
          foreignField: "_id",
          as: "equipe_info",
        },
      },
      { $unwind: "$equipe_info" },

      // 7. Projetar os campos finais mantendo confrontos para posterior processamento
      {
        $project: {
          _id: 1,
          nome_equipe: "$equipe_info.nome_equipe",
          jogos: 1,
          vitorias: 1,
          derrotas: 1,
          pontos_pro: 1,
          pontos_contra: 1,
          saldo: 1,
          pontos: 1,
          confrontos: 1,
        },
      },

      // 8. Ordenação inicial por pontos
      { $sort: { pontos: -1, saldo: -1, pontos_pro: -1 } },
    ]);

    // Processamento pós-agregação para critério de confronto direto
    const classificacaoOrdenada =
      processarClassificacaoComConfrontoDireto(classificacao);

    res.status(200).json(classificacaoOrdenada);
  } catch (error) {
    console.error("Erro na agregação:", error);
    res.status(500).json({
      message: "Erro ao buscar classificação",
      error: error.message,
    });
  }
};

// Função para processar confronto direto
function processarClassificacaoComConfrontoDireto(times) {
  // Agrupar times por pontuação
  const grupos = {};

  times.forEach((time) => {
    if (!grupos[time.pontos]) {
      grupos[time.pontos] = [];
    }
    grupos[time.pontos].push(time);
  });

  const resultado = [];

  // Para cada grupo de pontos iguais
  Object.keys(grupos)
    .sort((a, b) => b - a)
    .forEach((pontos) => {
      const grupo = grupos[pontos];

      if (grupo.length === 1) {
        // Apenas um time com essa pontuação
        resultado.push(grupo[0]);
      } else {
        // Múltiplos times com mesma pontuação - aplicar confronto direto
        const timesOrdenados = ordenarPorConfrontoDireto(grupo);
        resultado.push(...timesOrdenados);
      }
    });

  // Remover campo confrontos do resultado final
  return resultado.map((time) => {
    const { confrontos, ...rest } = time;
    return rest;
  });
}

// Função para ordenar times com mesma pontuação pelo confronto direto
function ordenarPorConfrontoDireto(timesComMesmaPontos) {
  // Calcular pontos do confronto direto entre esses times
  const timesComConfrontoDireto = timesComMesmaPontos.map((time) => {
    let pontosConfrontoDireto = 0;
    let saldoConfrontoDireto = 0;

    // Verificar confrontos com outros times do grupo
    time.confrontos.forEach((confronto) => {
      // Verificar se o adversário está no grupo
      const adversarioNoGrupo = timesComMesmaPontos.some(
        (t) => t._id.toString() === confronto.equipe_adversaria_id.toString(),
      );

      if (adversarioNoGrupo) {
        if (confronto.resultado === "vitoria") {
          pontosConfrontoDireto += 2;
        } else if (confronto.resultado === "derrota") {
          pontosConfrontoDireto += 1;
        }
        saldoConfrontoDireto += confronto.placar_pro - confronto.placar_contra;
      }
    });

    return {
      ...time,
      pontosConfrontoDireto,
      saldoConfrontoDireto,
    };
  });

  // Ordenar por: confronto direto (pontos), saldo do confronto direto, saldo geral, pp
  timesComConfrontoDireto.sort((a, b) => {
    if (a.pontosConfrontoDireto !== b.pontosConfrontoDireto) {
      return b.pontosConfrontoDireto - a.pontosConfrontoDireto;
    }
    if (a.saldoConfrontoDireto !== b.saldoConfrontoDireto) {
      return b.saldoConfrontoDireto - a.saldoConfrontoDireto;
    }
    if (a.saldo !== b.saldo) {
      return b.saldo - a.saldo;
    }
    return b.pontos_pro - a.pontos_pro;
  });

  return timesComConfrontoDireto;
}

// --- ESTATÍSTICAS DE ATLETAS ---

/**
 * @desc    Retorna top 50 atletas por pontuação total.
 *          Aceita filtros opcionais: competicao_id, categoria_id
 */
export const getEstatisticas = async (req, res) => {
  try {
    const { competicao_id, categoria_id } = req.query;

    const pipeline = [];

    // Lookup do jogo para obter competicao_id e categoria_id
    pipeline.push({
      $lookup: {
        from: "jogos",
        localField: "jogo_id",
        foreignField: "_id",
        as: "jogo",
      },
    });
    pipeline.push({ $unwind: "$jogo" });

    // Filtrar por competição/categoria se fornecido
    const matchFiltro = {};
    if (competicao_id) {
      matchFiltro["jogo.competicao_id"] = new mongoose.Types.ObjectId(competicao_id);
    }
    if (categoria_id) {
      matchFiltro["jogo.categoria_id"] = new mongoose.Types.ObjectId(categoria_id);
    }
    if (Object.keys(matchFiltro).length > 0) {
      pipeline.push({ $match: matchFiltro });
    }

    // Agrupar por atleta
    pipeline.push({
      $group: {
        _id: "$atleta_id",
        pontos_totais: { $sum: "$tipo_cesta" },
        bolas_de_3: {
          $sum: { $cond: [{ $eq: ["$tipo_cesta", 3] }, 1, 0] },
        },
        bolas_de_2: {
          $sum: { $cond: [{ $eq: ["$tipo_cesta", 2] }, 1, 0] },
        },
        lances_livres: {
          $sum: { $cond: [{ $eq: ["$tipo_cesta", 1] }, 1, 0] },
        },
        jogos: { $addToSet: "$jogo_id" },
        equipe_id: { $first: "$equipe_id" },
      },
    });

    // Lookup atleta
    pipeline.push({
      $lookup: {
        from: "atletas",
        localField: "_id",
        foreignField: "_id",
        as: "atleta",
      },
    });
    pipeline.push({ $unwind: "$atleta" });

    // Lookup equipe
    pipeline.push({
      $lookup: {
        from: "equipes",
        localField: "equipe_id",
        foreignField: "_id",
        as: "equipe",
      },
    });
    pipeline.push({ $unwind: { path: "$equipe", preserveNullAndEmptyArrays: true } });

    // Projetar campos
    pipeline.push({
      $project: {
        _id: 0,
        atleta_id: "$_id",
        nome_completo: "$atleta.nome_completo",
        equipe_nome: { $ifNull: ["$equipe.nome_equipe", "—"] },
        pontos_totais: 1,
        bolas_de_3: 1,
        bolas_de_2: 1,
        lances_livres: 1,
        total_jogos: { $size: "$jogos" },
      },
    });

    // Ordenar e limitar
    pipeline.push({ $sort: { pontos_totais: -1 } });
    pipeline.push({ $limit: 50 });

    const estatisticas = await Ponto.aggregate(pipeline);

    res.json(estatisticas);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar estatísticas", error: error.message });
  }
};

/**
 * @desc    Retorna histórico de pontos de um atleta, agrupado por jogo.
 */
export const getPontosAtleta = async (req, res) => {
  try {
    const { id } = req.params;

    const pipeline = [
      { $match: { atleta_id: new mongoose.Types.ObjectId(id) } },

      // Agrupar por jogo
      {
        $group: {
          _id: "$jogo_id",
          pontos_totais: { $sum: "$tipo_cesta" },
          bolas_de_3: {
            $sum: { $cond: [{ $eq: ["$tipo_cesta", 3] }, 1, 0] },
          },
          bolas_de_2: {
            $sum: { $cond: [{ $eq: ["$tipo_cesta", 2] }, 1, 0] },
          },
          lances_livres: {
            $sum: { $cond: [{ $eq: ["$tipo_cesta", 1] }, 1, 0] },
          },
          pontos_por_quarto: {
            $push: { quarto: "$quarto", valor: "$tipo_cesta" },
          },
        },
      },

      // Lookup jogo
      {
        $lookup: {
          from: "jogos",
          localField: "_id",
          foreignField: "_id",
          as: "jogo",
        },
      },
      { $unwind: "$jogo" },

      // Lookup equipes do jogo
      {
        $lookup: {
          from: "equipes",
          localField: "jogo.equipe_a_id",
          foreignField: "_id",
          as: "equipe_a",
        },
      },
      { $unwind: { path: "$equipe_a", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "equipes",
          localField: "jogo.equipe_b_id",
          foreignField: "_id",
          as: "equipe_b",
        },
      },
      { $unwind: { path: "$equipe_b", preserveNullAndEmptyArrays: true } },

      // Projetar
      {
        $project: {
          _id: 0,
          jogo_id: "$_id",
          data_jogo: "$jogo.data_jogo",
          equipe_a_nome: { $ifNull: ["$equipe_a.nome_equipe", "—"] },
          equipe_b_nome: { $ifNull: ["$equipe_b.nome_equipe", "—"] },
          placar_a: "$jogo.placar_a",
          placar_b: "$jogo.placar_b",
          pontos_totais: 1,
          bolas_de_3: 1,
          bolas_de_2: 1,
          lances_livres: 1,
          pontos_por_quarto: 1,
        },
      },

      { $sort: { data_jogo: -1 } },
    ];

    const historico = await Ponto.aggregate(pipeline);

    // Calcular pontos por quarto de forma limpa (dinâmico para prorrogação)
    const resultado = historico.map((h) => {
      const maxQ = h.pontos_por_quarto.reduce((max, p) => Math.max(max, p.quarto), 4);
      const quartos = Array.from({ length: maxQ }, () => 0);
      for (const p of h.pontos_por_quarto) {
        quartos[p.quarto - 1] += p.valor;
      }
      return {
        ...h,
        pontos_por_quarto: quartos,
      };
    });

    // Buscar dados do atleta
    const atleta = await mongoose.model("Atleta").findById(id).select("nome_completo data_nascimento");

    // Buscar equipe do atleta via inscrição
    const inscricao = await Inscricao.findOne({ atleta_id: id })
      .populate("equipe_id", "nome_equipe")
      .select("equipe_id")
      .lean();

    res.json({
      atleta: {
        nome_completo: atleta?.nome_completo || "Atleta não encontrado",
        data_nascimento: atleta?.data_nascimento,
        equipe_nome: inscricao?.equipe_id?.nome_equipe || "—",
      },
      historico: resultado,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar pontos do atleta", error: error.message });
  }
};

/**
 * @desc    Retorna dados completos de scout de um jogo: placar, quartos, atletas de ambos os times.
 */
export const getScoutJogo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID de jogo inválido" });
    }

    const jogoId = new mongoose.Types.ObjectId(id);

    // Buscar dados do jogo com lookups
    const jogoArr = await Jogo.aggregate([
      { $match: { _id: jogoId } },
      {
        $lookup: {
          from: "equipes",
          localField: "equipe_a_id",
          foreignField: "_id",
          as: "equipe_a",
        },
      },
      { $unwind: "$equipe_a" },
      {
        $lookup: {
          from: "equipes",
          localField: "equipe_b_id",
          foreignField: "_id",
          as: "equipe_b",
        },
      },
      { $unwind: "$equipe_b" },
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: "$competicao" },
      {
        $addFields: {
          categoria_info: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$competicao.categorias",
                  as: "cat",
                  cond: { $eq: ["$$cat._id", "$categoria_id"] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          placar_a: 1,
          placar_b: 1,
          data_jogo: 1,
          local: 1,
          status: 1,
          equipe_a_id: 1,
          equipe_b_id: 1,
          equipe_a: { _id: "$equipe_a._id", nome_equipe: "$equipe_a.nome_equipe" },
          equipe_b: { _id: "$equipe_b._id", nome_equipe: "$equipe_b.nome_equipe" },
          competicao: { nome: "$competicao.nome", ano: "$competicao.ano" },
          categoria_nome: "$categoria_info.nome",
        },
      },
    ]);

    if (!jogoArr.length) {
      return res.status(404).json({ message: "Jogo não encontrado" });
    }

    const jogo = jogoArr[0];

    // Carrega sumula + eventos (nova fonte da verdade para pontuacao).
    const sumula = await Sumula.findOne({ jogo_id: jogoId })
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo")
      .lean();

    const respostaBase = {
      jogo: {
        _id: jogo._id,
        equipe_a: jogo.equipe_a,
        equipe_b: jogo.equipe_b,
        placar_a: jogo.placar_a,
        placar_b: jogo.placar_b,
        data_jogo: jogo.data_jogo,
        local: jogo.local,
        status: jogo.status,
        competicao: jogo.competicao,
        categoria_nome: jogo.categoria_nome,
      },
    };

    if (!sumula) {
      return res.json({
        ...respostaBase,
        quartos: { team_a: [0, 0, 0, 0], team_b: [0, 0, 0, 0] },
        scout_a: [],
        scout_b: [],
      });
    }

    const eventosPonto = await EventoSumula.find({
      sumula_id: sumula._id,
      tipo: "ponto",
      cancelado: false,
    }).lean();

    const maxQuarto = Math.max(
      4,
      sumula.quarto_atual || 4,
      ...eventosPonto.map((e) => e.quarto || 0),
    );

    const createEmptyQuartos = (n) =>
      Array.from({ length: n }, () => ({
        pontos: 0,
        bolas_de_3: 0,
        bolas_de_2: 0,
        lances_livres: 0,
      }));

    const buildAtletaMap = (jogadores) => {
      const map = new Map();
      for (const j of jogadores || []) {
        const atleta = j.atleta_id;
        if (!atleta || !atleta._id) continue;
        map.set(atleta._id.toString(), {
          atleta_id: atleta._id,
          nome_completo: atleta.nome_completo || "—",
          numero_camisa:
            j.numero !== null && j.numero !== undefined ? String(j.numero) : "—",
          pontos_totais: 0,
          bolas_de_3: 0,
          bolas_de_2: 0,
          lances_livres: 0,
          quartos: createEmptyQuartos(maxQuarto),
        });
      }
      return map;
    };

    const mapA = buildAtletaMap(sumula.jogadores_a);
    const mapB = buildAtletaMap(sumula.jogadores_b);

    for (const ev of eventosPonto) {
      const valor = ev.valor;
      if (![1, 2, 3].includes(valor)) continue;
      if (!ev.jogador_id) continue;
      const map = ev.equipe === "A" ? mapA : ev.equipe === "B" ? mapB : null;
      if (!map) continue;
      const key = ev.jogador_id.toString();
      const atleta = map.get(key);
      if (!atleta) continue;
      atleta.pontos_totais += valor;
      if (valor === 3) atleta.bolas_de_3++;
      if (valor === 2) atleta.bolas_de_2++;
      if (valor === 1) atleta.lances_livres++;
      if (ev.quarto >= 1 && ev.quarto <= maxQuarto) {
        const q = atleta.quartos[ev.quarto - 1];
        q.pontos += valor;
        if (valor === 3) q.bolas_de_3++;
        if (valor === 2) q.bolas_de_2++;
        if (valor === 1) q.lances_livres++;
      }
    }

    const formatScout = (map) =>
      Array.from(map.values())
        .map((s) => ({
          atleta_id: s.atleta_id,
          nome_completo: s.nome_completo,
          numero_camisa: s.numero_camisa,
          pontos_totais: s.pontos_totais,
          bolas_de_3: s.bolas_de_3,
          bolas_de_2: s.bolas_de_2,
          lances_livres: s.lances_livres,
          pontos_por_quarto: s.quartos,
        }))
        .sort((a, b) => b.pontos_totais - a.pontos_totais);

    const calcQuartos = (equipe) => {
      const q = Array.from({ length: maxQuarto }, () => 0);
      for (const ev of eventosPonto) {
        if (ev.equipe !== equipe) continue;
        if (ev.quarto >= 1 && ev.quarto <= maxQuarto) {
          q[ev.quarto - 1] += ev.valor;
        }
      }
      return q;
    };

    res.json({
      ...respostaBase,
      quartos: {
        team_a: calcQuartos("A"),
        team_b: calcQuartos("B"),
      },
      scout_a: formatScout(mapA),
      scout_b: formatScout(mapB),
    });
  } catch (error) {
    console.error("[public] getScoutJogo:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar scout do jogo", error: error.message });
  }
};

/**
 * @desc    Retorna sumula finalizada de um jogo (visualizacao publica, read-only).
 */
export const getSumulaPublic = async (req, res) => {
  try {
    const { jogoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jogoId)) {
      return res.status(400).json({ message: "ID de jogo invalido" });
    }
    const sumula = await Sumula.findOne({ jogo_id: jogoId })
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("competicao_id", "nome ano")
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo")
      .lean();
    if (!sumula) {
      return res.status(404).json({ message: "Sumula nao encontrada" });
    }
    if (sumula.status !== "finalizada") {
      return res
        .status(403)
        .json({ message: "Sumula ainda nao foi finalizada" });
    }
    const eventos = await EventoSumula.find({
      sumula_id: sumula._id,
      cancelado: false,
    })
      .sort({ sequencia: 1 })
      .lean();
    res.json({ sumula, eventos });
  } catch (error) {
    console.error("[public] getSumulaPublic:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar sumula publica", error: error.message });
  }
};

/**
 * @desc    Lista competições com categorias (endpoint público, sem auth).
 */
export const getCompeticoesPublic = async (req, res) => {
  try {
    const competicoes = await Competicao.find({}).select("nome ano categorias").lean();
    res.json(competicoes);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar competições", error: error.message });
  }
};
