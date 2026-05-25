import { Equipe } from "../models/Equipe.js";
import { Jogo } from "../models/Jogo.js";
import { Escalacao } from "../models/Escalacao.js";
import { Competicao } from "../models/Competicao.js";
import { Inscricao } from "../models/Inscricao.js";
import { Sumula } from "../models/Sumula.js";
import { EventoSumula } from "../models/EventoSumula.js";
import { Atleta } from "../models/Atleta.js";
import Ponto from "../models/Ponto.js";
import mongoose from "mongoose";
import {
  computarEstado,
  montarDinamicoAoVivo,
} from "../services/sumulaEstadoService.js";
import * as aoVivoBus from "../services/aoVivoBus.js";

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

    const categoriaDoc = competicao.categorias.find(
      (cat) => cat.nome === categoria,
    );
    const categoriaId = categoriaDoc._id;

    // Configuração da categoria (defaults defensivos para documentos antigos)
    const pontosVitoria = categoriaDoc.pontos_vitoria ?? 2;
    const pontosDerrota = categoriaDoc.pontos_derrota ?? 1;
    const criterios =
      categoriaDoc.criterios_classificacao &&
      categoriaDoc.criterios_classificacao.length > 0
        ? categoriaDoc.criterios_classificacao
        : ["pontos", "confronto_direto", "saldo", "pontos_pro"];
    const formato = categoriaDoc.formato || "chaveamento_unico";
    const cfg = { pontosVitoria, pontosDerrota };

    // Agregação: estatísticas por equipe a partir dos jogos finalizados
    const times = await Jogo.aggregate([
      // 1. Filtrar jogos finalizados da categoria.
      //    Basquete não admite empate (prorrogação decide); jogo finalizado
      //    com placar igual é dado inválido e é descartado da classificação.
      {
        $match: {
          categoria_id: new mongoose.Types.ObjectId(categoriaId),
          status: "finalizado",
          $expr: { $ne: ["$placar_a", "$placar_b"] },
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
                    "derrota",
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
                    "derrota",
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

      // 5. Calcular saldo e pontos (pontuação configurável por categoria)
      {
        $addFields: {
          saldo: { $subtract: ["$pontos_pro", "$pontos_contra"] },
          pontos: {
            $add: [
              { $multiply: ["$vitorias", pontosVitoria] },
              { $multiply: ["$derrotas", pontosDerrota] },
            ],
          },
        },
      },

      // 6. Lookup para nome e grupo da equipe
      {
        $lookup: {
          from: "equipes",
          localField: "_id",
          foreignField: "_id",
          as: "equipe_info",
        },
      },
      { $unwind: "$equipe_info" },

      // 7. Projetar campos finais (confrontos é auxiliar p/ confronto direto)
      {
        $project: {
          _id: 1,
          nome_equipe: "$equipe_info.nome_equipe",
          grupo_id: "$equipe_info.grupo_id",
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
    ]);

    // Incluir equipes da categoria que ainda não jogaram (sem doc em Jogo),
    // com estatísticas zeradas, para que apareçam na tabela.
    const equipesCategoria = await Equipe.find({ categoria_id: categoriaId })
      .select("nome_equipe grupo_id")
      .lean();
    const idsComJogo = new Set(times.map((t) => t._id.toString()));
    equipesCategoria.forEach((eq) => {
      if (!idsComJogo.has(eq._id.toString())) {
        times.push({
          _id: eq._id,
          nome_equipe: eq.nome_equipe,
          grupo_id: eq.grupo_id || null,
          jogos: 0,
          vitorias: 0,
          derrotas: 0,
          pontos_pro: 0,
          pontos_contra: 0,
          saldo: 0,
          pontos: 0,
          confrontos: [],
        });
      }
    });

    if (formato === "grupos") {
      // Uma tabela de classificação por grupo configurado na categoria
      const grupos = (categoriaDoc.grupos || []).map((g) => {
        const timesDoGrupo = times.filter(
          (t) => t.grupo_id && t.grupo_id.toString() === g._id.toString(),
        );
        return {
          _id: g._id,
          nome: g.nome,
          classificacao: limparConfrontos(
            classificarTimes(timesDoGrupo, criterios, cfg),
          ),
        };
      });
      // Equipes da categoria ainda não atribuídas a um grupo
      const semGrupo = limparConfrontos(
        classificarTimes(
          times.filter((t) => !t.grupo_id),
          criterios,
          cfg,
        ),
      );
      return res.status(200).json({ formato: "grupos", grupos, semGrupo });
    }

    // Chaveamento único: tabela plana (compatível com o front atual)
    const classificacao = limparConfrontos(
      classificarTimes(times, criterios, cfg),
    );
    res.status(200).json(classificacao);
  } catch (error) {
    console.error("Erro na agregação:", error);
    res.status(500).json({
      message: "Erro ao buscar classificação",
      error: error.message,
    });
  }
};

// Remove o campo auxiliar `confrontos` do resultado final.
function limparConfrontos(times) {
  return times.map(({ confrontos, ...rest }) => rest);
}

// Valor de um critério simples (maior = melhor) para um time.
function valorCriterio(time, criterio) {
  switch (criterio) {
    case "pontos":
      return time.pontos;
    case "saldo":
      return time.saldo;
    case "pontos_pro":
      return time.pontos_pro;
    case "pontos_contra":
      return -time.pontos_contra; // menos pontos sofridos = melhor
    case "vitorias":
      return time.vitorias;
    case "aproveitamento":
      return time.jogos > 0 ? time.vitorias / time.jogos : 0;
    default:
      return 0;
  }
}

// Confronto direto: pontos e saldo de um time considerando só adversários do subgrupo.
function valorConfrontoDireto(time, subgrupo, cfg) {
  const idsSubgrupo = new Set(subgrupo.map((t) => t._id.toString()));
  let pontos = 0;
  let saldo = 0;
  (time.confrontos || []).forEach((c) => {
    if (idsSubgrupo.has(c.equipe_adversaria_id.toString())) {
      if (c.resultado === "vitoria") pontos += cfg.pontosVitoria;
      else if (c.resultado === "derrota") pontos += cfg.pontosDerrota;
      saldo += c.placar_pro - c.placar_contra;
    }
  });
  return { pontos, saldo };
}

// Ordena os times aplicando os critérios na ordem de prioridade.
// Empate em um critério é desempatado pelo próximo critério (recursivo).
function classificarTimes(times, criterios, cfg) {
  if (times.length <= 1 || criterios.length === 0) return [...times];

  const [criterio, ...resto] = criterios;

  // Valor primário e secundário de cada time para este critério
  const comValor = times.map((time) => {
    if (criterio === "confronto_direto") {
      const cd = valorConfrontoDireto(time, times, cfg);
      return { time, valor: cd.pontos, valor2: cd.saldo };
    }
    return { time, valor: valorCriterio(time, criterio), valor2: 0 };
  });

  comValor.sort((a, b) => b.valor - a.valor || b.valor2 - a.valor2);

  // Agrupa times empatados neste critério e desempata pelos critérios restantes
  const resultado = [];
  let i = 0;
  while (i < comValor.length) {
    let j = i;
    while (
      j < comValor.length &&
      comValor[j].valor === comValor[i].valor &&
      comValor[j].valor2 === comValor[i].valor2
    ) {
      j++;
    }
    const empatados = comValor.slice(i, j).map((x) => x.time);
    if (empatados.length === 1) {
      resultado.push(empatados[0]);
    } else {
      resultado.push(...classificarTimes(empatados, resto, cfg));
    }
    i = j;
  }
  return resultado;
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
 * Fallback de scout para jogos antigos (sistema legado de scout manual): em vez
 * de EventoSumula, os pontos ficam na collection `Ponto` (atleta/equipe/quarto/
 * tipo_cesta). Reconstrói o mesmo formato (quartos + scout_a/b) a partir dela.
 * Retorna null se não houver nenhum Ponto para o jogo.
 */
const montarScoutDePonto = async (jogo) => {
  const pontos = await Ponto.find({ jogo_id: jogo._id }).lean();
  if (!pontos.length) return null;

  const idEquipeA = String(jogo.equipe_a._id);
  const maxQuarto = Math.max(4, ...pontos.map((p) => p.quarto || 0));

  // Escalações do jogo: usadas para listar TODOS os atletas escalados (mesmo
  // quem não pontuou) e o número de camisa salvo na finalização do scout.
  const escalacoes = await Escalacao.find({ jogo_id: jogo._id }).lean();
  const rosterPorEquipe = new Map(); // equipe_id -> [{ atleta_id, numero_camisa }]
  for (const esc of escalacoes) {
    const camisaPorAtleta = new Map(
      (esc.camisas || []).map((c) => [String(c.atleta_id), c.numero_camisa]),
    );
    const roster = (esc.atletas_selecionados || []).map((aid) => ({
      atleta_id: aid,
      numero_camisa: camisaPorAtleta.get(String(aid)) ?? null,
    }));
    rosterPorEquipe.set(String(esc.equipe_id), roster);
  }

  // Nomes de todos os atletas (escalados + qualquer um que tenha pontuado).
  const atletaIds = [
    ...new Set([
      ...pontos.map((p) => String(p.atleta_id)),
      ...escalacoes.flatMap((esc) =>
        (esc.atletas_selecionados || []).map((aid) => String(aid)),
      ),
    ]),
  ];
  const atletas = await Atleta.find({ _id: { $in: atletaIds } })
    .select("nome_completo")
    .lean();
  const nomePorId = new Map(
    atletas.map((a) => [String(a._id), a.nome_completo || "—"]),
  );

  const novoQuartos = () =>
    Array.from({ length: maxQuarto }, () => ({
      pontos: 0,
      bolas_de_3: 0,
      bolas_de_2: 0,
      lances_livres: 0,
    }));

  const mapA = new Map();
  const mapB = new Map();
  const ensure = (map, p) => {
    const key = String(p.atleta_id);
    if (!map.has(key)) {
      map.set(key, {
        atleta_id: p.atleta_id,
        nome_completo: nomePorId.get(key) || "—",
        numero_camisa: p.numero_camisa != null ? String(p.numero_camisa) : "—",
        pontos_totais: 0,
        bolas_de_3: 0,
        bolas_de_2: 0,
        lances_livres: 0,
        quartos: novoQuartos(),
      });
    }
    return map.get(key);
  };

  // Pré-popula os mapas com o elenco inteiro (zerado), para que atletas que não
  // pontuaram também apareçam no scout.
  const seedRoster = (equipeId, map) => {
    for (const r of rosterPorEquipe.get(String(equipeId)) || []) {
      const key = String(r.atleta_id);
      if (map.has(key)) continue;
      map.set(key, {
        atleta_id: r.atleta_id,
        nome_completo: nomePorId.get(key) || "—",
        numero_camisa: r.numero_camisa != null ? String(r.numero_camisa) : "—",
        pontos_totais: 0,
        bolas_de_3: 0,
        bolas_de_2: 0,
        lances_livres: 0,
        quartos: novoQuartos(),
      });
    }
  };
  seedRoster(jogo.equipe_a._id, mapA);
  seedRoster(jogo.equipe_b._id, mapB);

  for (const p of pontos) {
    const valor = p.tipo_cesta; // 1=LL, 2=2pts, 3=3pts
    if (![1, 2, 3].includes(valor)) continue;
    const ehA = String(p.equipe_id) === idEquipeA;
    const at = ensure(ehA ? mapA : mapB, p);
    at.pontos_totais += valor;
    if (valor === 3) at.bolas_de_3++;
    else if (valor === 2) at.bolas_de_2++;
    else if (valor === 1) at.lances_livres++;
    const qi = (p.quarto || 1) - 1;
    if (qi >= 0 && qi < maxQuarto) {
      const q = at.quartos[qi];
      q.pontos += valor;
      if (valor === 3) q.bolas_de_3++;
      else if (valor === 2) q.bolas_de_2++;
      else if (valor === 1) q.lances_livres++;
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

  const calcQuartos = (ehA) => {
    const q = Array.from({ length: maxQuarto }, () => 0);
    for (const p of pontos) {
      if ((String(p.equipe_id) === idEquipeA) !== ehA) continue;
      const qi = (p.quarto || 1) - 1;
      if (qi >= 0 && qi < maxQuarto) q[qi] += p.tipo_cesta;
    }
    return q;
  };

  return {
    quartos: { team_a: calcQuartos(true), team_b: calcQuartos(false) },
    scout_a: formatScout(mapA),
    scout_b: formatScout(mapB),
  };
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
      // Sem súmula eletrônica: tenta o scout legado (collection Ponto).
      const legado = await montarScoutDePonto(jogo);
      return res.json({
        ...respostaBase,
        ...(legado || {
          quartos: { team_a: [0, 0, 0, 0], team_b: [0, 0, 0, 0] },
          scout_a: [],
          scout_b: [],
        }),
      });
    }

    const eventosPonto = await EventoSumula.find({
      sumula_id: sumula._id,
      tipo: "ponto",
      cancelado: false,
    }).lean();

    // Súmula existe mas sem pontos registrados (ex.: jogo antigo migrado só com
    // escalação) → ainda tenta o scout legado da collection Ponto.
    if (eventosPonto.length === 0) {
      const legado = await montarScoutDePonto(jogo);
      if (legado) {
        return res.json({ ...respostaBase, ...legado });
      }
    }

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

// Monta nomes da equipe de arbitragem + mesa a partir da súmula.
const montarArbitros = (sumula) => ({
  crew_chief: sumula.arbitragem?.crew_chief || null,
  fiscal_1: sumula.arbitragem?.fiscal_1 || null,
  fiscal_2: sumula.arbitragem?.fiscal_2 || null,
  apontador: sumula.mesa?.apontador || null,
  cronometrista: sumula.mesa?.cronometrista || null,
  operador_24s: sumula.mesa?.operador_24s || null,
  representante: sumula.mesa?.representante || null,
});

const montarTecnicos = (sumula) => {
  const map = (lista) =>
    (lista || []).map((m) => ({ nome: m.nome, funcao: m.funcao }));
  return { A: map(sumula.comissao_a), B: map(sumula.comissao_b) };
};

// Elenco completo de cada equipe (todos os atletas escalados, pontuando ou
// não) — o front usa para listar todos no scout, não só quem fez pontos.
const montarElenco = (sumula) => {
  const map = (lista) =>
    (lista || [])
      .filter((j) => j.atleta_id)
      .map((j) => ({
        atleta_id: String(j.atleta_id._id || j.atleta_id),
        nome: j.atleta_id.nome_completo || "—",
        numero: j.numero ?? null,
      }));
  return { A: map(sumula.jogadores_a), B: map(sumula.jogadores_b) };
};

/**
 * @desc    Snapshot inicial da visão ao vivo de um jogo: info estática
 *          (data/hora, local, competição, árbitros, técnicos) + estado
 *          dinâmico (placar, placar por quarto, quarto atual, feed jogada-a-
 *          jogada). O front busca isto ao abrir a página e depois recebe só a
 *          parte dinâmica via SSE (streamAoVivo).
 */
export const getAoVivoAbertura = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "id de jogo inválido" });
    }

    const jogo = await Jogo.findById(id)
      .populate("competicao_id", "nome ano")
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .lean();
    if (!jogo) return res.status(404).json({ message: "Jogo não encontrado" });

    const base = {
      jogo: {
        _id: jogo._id,
        data_jogo: jogo.data_jogo,
        local: jogo.local || null,
        status: jogo.status,
        competicao: jogo.competicao_id
          ? { nome: jogo.competicao_id.nome, ano: jogo.competicao_id.ano }
          : null,
        equipe_a: jogo.equipe_a_id
          ? { _id: jogo.equipe_a_id._id, nome_equipe: jogo.equipe_a_id.nome_equipe }
          : null,
        equipe_b: jogo.equipe_b_id
          ? { _id: jogo.equipe_b_id._id, nome_equipe: jogo.equipe_b_id.nome_equipe }
          : null,
      },
    };

    const sumula = await Sumula.findOne({ jogo_id: id })
      .populate("jogadores_a.atleta_id", "nome_completo")
      .populate("jogadores_b.atleta_id", "nome_completo");

    if (!sumula) {
      // Jogo agendado sem súmula ainda — devolve o esqueleto.
      return res.json({
        ...base,
        arbitros: null,
        tecnicos: { A: [], B: [] },
        elenco: { A: [], B: [] },
        placar: { A: jogo.placar_a || 0, B: jogo.placar_b || 0 },
        placar_por_quarto: {},
        faltas_equipe_por_quarto: {},
        quarto_atual: 1,
        em_quadra: { A: [], B: [] },
        feed: [],
      });
    }

    const estado = await computarEstado(sumula._id);
    res.json({
      ...base,
      arbitros: montarArbitros(sumula),
      tecnicos: montarTecnicos(sumula),
      elenco: montarElenco(sumula),
      ...montarDinamicoAoVivo(sumula, estado),
    });
  } catch (error) {
    console.error("[public] getAoVivoAbertura:", error);
    res
      .status(500)
      .json({ message: "Erro ao buscar dados ao vivo", error: error.message });
  }
};

/**
 * @desc    Stream SSE da parte dinâmica do jogo ao vivo. Cada alteração de
 *          estado feita pelo mesário (registrar/cancelar/editar evento) é
 *          empurrada aqui pelo aoVivoBus. Também envia heartbeat para manter a
 *          conexão viva atrás de proxies. Sem auth (visão pública).
 */
export const streamAoVivo = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Desabilita buffering do Nginx/proxies para SSE.
    "X-Accel-Buffering": "no",
  });
  // Sugere ao EventSource reconectar em 5s se a conexão cair.
  res.write("retry: 5000\n\n");

  const enviar = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  const cancelar = aoVivoBus.inscrever(id, enviar);

  req.on("close", () => {
    clearInterval(ping);
    cancelar();
    res.end();
  });
};

/**
 * @desc    Stream SSE agregado para a home: UMA conexão recebe os placares de
 *          TODOS os jogos ao vivo. Evita abrir um EventSource por card (que
 *          estouraria o limite de 6 conexões/origem do HTTP/1.1). Cada mensagem:
 *          { jogoId, placar:{A,B}, encerrado }.
 */
export const streamHomeAoVivo = async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 5000\n\n");

  const enviar = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  const cancelar = aoVivoBus.inscreverHome(enviar);

  req.on("close", () => {
    clearInterval(ping);
    cancelar();
    res.end();
  });
};
