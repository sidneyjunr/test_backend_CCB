import mongoose from "mongoose";
import { Atleta } from "../models/Atleta.js";
import { Equipe } from "../models/Equipe.js";
import { Escalacao } from "../models/Escalacao.js";
import { Inscricao } from "../models/Inscricao.js";
import { Jogo } from "../models/Jogo.js";

const MAX_ATLETAS_ESCALACAO = 12;

export const getMinhasEquipes = async (req, res) => {
  try {
    // Usamos aggregate para resolver a categoria que é subdocumento
    const equipes = await Equipe.aggregate([
      // 1. Filtramos apenas as equipes do técnico logado
      // Nota: Convertemos o ID de string para ObjectId do MongoDB
      {
        $match: { tecnico_id: new mongoose.Types.ObjectId(req.user.id) },
      },

      // 2. Join com a coleção de competições
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: "$competicao" },

      // 3. Resolve o nome da categoria (subdocumento)
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

      // 4. Formata a saída para o Frontend
      {
        $project: {
          nome_equipe: 1,
          competicao: {
            _id: "$competicao._id",
            nome: "$competicao.nome",
            ano: "$competicao.ano",
          },
          categoria: { _id: "$categoria._id", nome: "$categoria.nome" },
        },
      },
    ]);

    res.json(equipes);
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar suas equipes",
      error: error.message,
    });
  }
};
/**
 * @desc    Busca TODAS as inscrições de uma equipe (Pendente, Aprovado, Recusado)
 * @route   GET /api/equipes/:id/inscricoes
 */
export const getInscricoesEquipe = async (req, res) => {
  const { id } = req.params; // ID da Equipa
  try {
    // Verificar se o técnico logado é o dono desta equipe
    const equipe = await Equipe.findById(id);
    if (!equipe) {
      return res.status(404).json({ message: "Equipe não encontrada." });
    }
    if (equipe.tecnico_id.toString() !== req.user.id) {
      return res.status(403).json({ message: "Acesso negado." });
    }

    // Buscamos todas as inscrições ligadas a esta equipe
    // Ordenamos pelas mais recentes para o técnico ver o status das últimas submissões
    const inscricoes = await Inscricao.find({ equipe_id: id })
      .populate("atleta_id")
      .sort({ createdAt: -1 });

    res.json(inscricoes);
  } catch (error) {
    console.error('[equipe] Erro ao buscar inscrições:', error);
    res.status(500).json({
      message: "Erro ao buscar inscrições da equipe",
    });
  }
};

export const inscreverAtleta = async (req, res) => {
  try {
    const { equipe_id, nome_completo, data_nascimento, documento_id, rg } =
      req.body;

    if (!req.file) {
      return res
        .status(400)
        .json({ message: "O documento (RG/CPF) é obrigatório para análise." });
    }

    // Guardamos apenas o nome do ficheiro. A segurança será tratada na rota de visualização.
    const pathDocumento = req.file.filename;

    const equipe = await Equipe.findById(equipe_id);
    if (!equipe)
      return res.status(404).json({ message: "Equipa não encontrada." });

    let atleta = await Atleta.findOne({ documento_id });

    if (!atleta) {
      atleta = await Atleta.create({
        nome_completo,
        data_nascimento,
        documento_id,
        rg,
        url_documento: pathDocumento, // Guardamos o nome do ficheiro local
        verificado_pelo_admin: false,
      });
    }

    const inscricaoExistente = await Inscricao.findOne({
      atleta_id: atleta._id,
      competicao_id: equipe.competicao_id,
      status: { $in: ["pendente", "aprovado"] },
    });

    if (inscricaoExistente) {
      return res.status(400).json({
        message: "Este atleta já possui uma inscrição ativa ou pendente.",
      });
    }

    // Verificar se atleta já jogou nesta competição (ja_jogou: true)
    const jaJogouNesta = await Inscricao.findOne({
      atleta_id: atleta._id,
      competicao_id: equipe.competicao_id,
      ja_jogou: true,
    });

    if (jaJogouNesta) {
      return res.status(400).json({
        message:
          "Este atleta já jogou nesta competição e não pode ser inscrito novamente na mesma categoria/competição.",
      });
    }

    const novaInscricao = await Inscricao.create({
      atleta_id: atleta._id,
      equipe_id: equipe._id,
      competicao_id: equipe.competicao_id,
      status: "pendente",
    });

    res.status(201).json({
      message: "Inscrição enviada! O Admin verificará o documento em breve.",
      inscricao: novaInscricao,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao processar inscrição", error: error.message });
  }
};

export const getElencoAprovado = async (req, res) => {
  const { id } = req.params;
  try {
    const elenco = await Inscricao.find({
      equipe_id: id,
      status: "aprovado",
    }).populate("atleta_id");
    res.json(elenco);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar Elenco Aprovado" });
  }
};

////daqui pra frente eu taquei na ia

export const getJogosProximos = async (req, res) => {
  const { equipe_id } = req.params;
  try {
    const jogos = await Jogo.find({
      $or: [{ equipe_a_id: equipe_id }, { equipe_b_id: equipe_id }],
      status: "agendado",
    }).populate("equipe_a_id equipe_b_id", "nome_equipe");

    res.json(jogos);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar jogos" });
  }
};

//escolher 12 pra sumula
export const salvarEscalacao = async (req, res) => {
  const { jogo_id, equipe_id, atletas_selecionados } = req.body;

  try {
    if (atletas_selecionados.length > MAX_ATLETAS_ESCALACAO) {
      return res
        .status(400)
        .json({ message: `Máximo de ${MAX_ATLETAS_ESCALACAO} atletas permitidos.` });
    }

    const escalacao = await Escalacao.findOneAndUpdate(
      { jogo_id, equipe_id },
      { atletas_selecionados: atletas_selecionados },
      { upsert: true, new: true }
    );

    res.json({ message: "Escalação confirmada!", escalacao });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao salvar escalação", error: error.message });
  }
};

export const desvincularAtleta = async (req, res) => {
  try {
    const { id } = req.params; // ID da inscrição
    const { status } = req.body; // Status a ser alterado

    if (!status || !["rejeitado", "pendente", "aprovado"].includes(status)) {
      return res.status(400).json({ message: "Status inválido." });
    }

    const inscricao = await Inscricao.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!inscricao) {
      return res.status(404).json({ message: "Inscrição não encontrada." });
    }

    res.json({
      message: "Status da inscrição atualizado com sucesso!",
      inscricao,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao atualizar inscrição", error: error.message });
  }
};

export const buscarAtletas = async (req, res) => {
  try {
    const { nome, equipe_id, competicao_id } = req.query;

    if (!nome || nome.trim().length === 0) {
      return res.status(400).json({ message: "Informe um nome para buscar." });
    }

    // Escapar caracteres especiais de regex para evitar injeção NoSQL
    const nomeEscapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Buscar atletas por nome (case-insensitive)
    const atletas = await Atleta.find({
      $or: [
        { nome_completo: { $regex: nomeEscapado, $options: "i" } },
        { nome: { $regex: nomeEscapado, $options: "i" } },
      ],
    }).limit(10);

    if (!atletas || atletas.length === 0) {
      return res.status(404).json({ message: "Nenhum atleta encontrado." });
    }

    // Verificar se cada atleta já está vinculado a alguma equipe (inscrição aprovada)
    const atletasComStatus = await Promise.all(
      atletas.map(async (atleta) => {
        // Verificar se tem inscrição aprovada EM QUALQUER EQUIPE
        const inscricaoAprovada = await Inscricao.findOne({
          atleta_id: atleta._id,
          status: "aprovado",
        });

        return {
          ...atleta.toObject(),
          estaVinculado: !!inscricaoAprovada,
        };
      })
    );

    // Se fornecido equipe_id e competicao_id, filtrar atletas já inscritos NESTA equipe
    let atletasDisponiveis = atletasComStatus;
    if (equipe_id && competicao_id) {
      const inscricoesPendentesOuAprovadas = await Inscricao.find({
        equipe_id: new mongoose.Types.ObjectId(equipe_id),
        competicao_id: new mongoose.Types.ObjectId(competicao_id),
        status: { $in: ["pendente", "aprovado"] },
      });

      const atletasInscritos = inscricoesPendentesOuAprovadas.map((i) =>
        i.atleta_id.toString()
      );

      // Filtrar atletas que já jogaram nesta competição
      const atletasQueJogaram = await Inscricao.find({
        competicao_id: new mongoose.Types.ObjectId(competicao_id),
        ja_jogou: true,
      });

      const atletasJogados = atletasQueJogaram.map((i) =>
        i.atleta_id.toString()
      );

      // Filtrar apenas atletas não inscritos NESTA equipe E que não jogaram nesta competição
      atletasDisponiveis = atletasComStatus.filter(
        (a) =>
          !atletasInscritos.includes(a._id.toString()) &&
          !atletasJogados.includes(a._id.toString())
      );
    }

    res.json(atletasDisponiveis);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar atletas", error: error.message });
  }
};

export const criarSolicitacaoAgregamento = async (req, res) => {
  try {
    const { atleta_id, equipe_id } = req.body;

    if (!atleta_id || !equipe_id) {
      return res
        .status(400)
        .json({ message: "Atleta e equipe são obrigatórios." });
    }

    const equipe = await Equipe.findById(equipe_id);
    if (!equipe)
      return res.status(404).json({ message: "Equipe não encontrada." });

    const atleta = await Atleta.findById(atleta_id);
    if (!atleta)
      return res.status(404).json({ message: "Atleta não encontrado." });

    // Verificar se já existe inscrição pendente ou aprovada
    const inscricaoExistente = await Inscricao.findOne({
      atleta_id,
      equipe_id,
      status: { $in: ["pendente", "aprovado"] },
    });

    if (inscricaoExistente) {
      return res.status(400).json({
        message:
          "Este atleta já possui uma inscrição ativa ou pendente nesta equipe.",
      });
    }

    // Verificar se atleta já jogou nesta competição (ja_jogou: true)
    const jaJogouNesta = await Inscricao.findOne({
      atleta_id,
      competicao_id: equipe.competicao_id,
      ja_jogou: true,
    });

    // Se já jogou nesta competição, verificar se está tentando agregar em OUTRO time
    if (jaJogouNesta && jaJogouNesta.equipe_id.toString() !== equipe_id) {
      return res.status(400).json({
        message:
          "Este atleta já jogou nesta competição e não pode ser agregado a outro time.",
      });
    }

    // Criar nova inscrição com status 'pendente'
    const novaInscricao = await Inscricao.create({
      atleta_id,
      equipe_id,
      competicao_id: equipe.competicao_id,
      status: "pendente",
      tipo: "agregacao", // Marcar como agregação
    });

    res.status(201).json({
      message: "Solicitação de agregamento enviada com sucesso!",
      inscricao: novaInscricao,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao criar solicitação", error: error.message });
  }
};
