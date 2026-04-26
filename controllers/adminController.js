import { Usuario } from "../models/Usuario.js";
import { Competicao } from "../models/Competicao.js";
import { Equipe } from "../models/Equipe.js";
import { Inscricao } from "../models/Inscricao.js";
import { Atleta } from "../models/Atleta.js";
import { Jogo } from "../models/Jogo.js";
import { Escalacao } from "../models/Escalacao.js";
import { Arbitro, FUNCOES_ARBITRO } from "../models/Arbitro.js";

import fs from "fs";
import path from "path";

// --- HELPER: marca ja_jogou para todos os atletas escalados de um jogo ---

const marcarJaJogou = async (jogoId, competicaoId, atletasExcluidos = []) => {
  const escalacoes = await Escalacao.find({ jogo_id: jogoId });

  for (const esc of escalacoes) {
    let idsAtletas = esc.atletas_selecionados || [];

    // Excluir atletas ausentes (marcados com "-" na camisa)
    if (atletasExcluidos.length > 0) {
      const excluidos = new Set(atletasExcluidos.map((id) => id.toString()));
      idsAtletas = idsAtletas.filter((id) => !excluidos.has(id.toString()));
    }

    if (idsAtletas.length === 0) continue;

    await Inscricao.updateMany(
      {
        atleta_id: { $in: idsAtletas },
        equipe_id: esc.equipe_id,
        competicao_id: competicaoId,
      },
      { ja_jogou: true },
    );
  }
};

// --- GESTÃO DE USUÁRIOS (TÉCNICOS) ---

export const criarUsuarioTecnico = async (req, res) => {
  const { nome, email, senha } = req.body;

  // Validação de campos obrigatórios
  if (!nome || !email || !senha) {
    return res.status(400).json({ message: "Nome, email e senha são obrigatórios" });
  }

  // Validação de força de senha
  if (senha.length < 8) {
    return res.status(400).json({ message: "A senha deve ter pelo menos 8 caracteres" });
  }
  if (!/[A-Z]/.test(senha)) {
    return res.status(400).json({ message: "A senha deve conter pelo menos uma letra maiúscula" });
  }
  if (!/[0-9]/.test(senha)) {
    return res.status(400).json({ message: "A senha deve conter pelo menos um número" });
  }

  try {
    // Mantendo a tua validação de e-mail existente
    const usuarioExiste = await Usuario.findOne({ email });
    if (usuarioExiste) {
      return res.status(400).json({ message: "Email já foi cadastrado" });
    }

    const usuario = await Usuario.create({
      nome,
      email,
      senha_hash: senha,
      tipo_usuario: "tecnico",
    });

    res.status(201).json({
      _id: usuario._id,
      nome: usuario.nome,
      email: usuario.email,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao criar o Usuário", error: error.message });
  }
};

export const getTecnicos = async (req, res) => {
  try {
    const tecnicos = await Usuario.find({ tipo_usuario: "tecnico" }).select(
      "nome email",
    );
    res.json(tecnicos);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar técnicos", error: error.message });
  }
};

export const getEquipes = async (req, res) => {
  try {
    const equipes = await Equipe.aggregate([
      {
        $lookup: {
          from: "usuarios",
          localField: "tecnico_id",
          foreignField: "_id",
          as: "tecnico",
        },
      },
      { $unwind: { path: "$tecnico", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: { path: "$competicao", preserveNullAndEmptyArrays: true } },
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
      {
        $project: {
          _id: 1,
          nome_equipe: 1,
          tecnico: {
            _id: "$tecnico._id",
            nome: "$tecnico.nome",
            email: "$tecnico.email",
          },
          competicao: {
            _id: "$competicao._id",
            nome: "$competicao.nome",
          },
          categoria: {
            _id: "$categoria._id",
            nome: "$categoria.nome",
          },
        },
      },
    ]);
    res.json(equipes);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar equipes", error: error.message });
  }
};

export const getAtletasEquipe = async (req, res) => {
  const { id } = req.params;
  try {
    const inscricoes = await Inscricao.find({ equipe_id: id })
      .populate("atleta_id")
      .sort({ createdAt: -1 });

    res.json(inscricoes);
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar atletas da equipe",
      error: error.message,
    });
  }
};

// --- GESTÃO DE COMPETIÇÕES ---
export const getCompeticoes = async (req, res) => {
  try {
    const competicoes = await Competicao.find();
    res.json(competicoes);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar competições", error: error.message });
  }
};

export const criarCompeticao = async (req, res) => {
  const { nome, ano, categorias } = req.body;
  try {
    const competicao = await Competicao.create({
      nome,
      ano,
      categorias,
    });
    res.status(201).json(competicao);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao criar Competição", error: error.message });
  }
};

export const adicionarCategoria = async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;
  if (!nome) {
    return res
      .status(400)
      .json({ message: "O nome da categoria é obrigatório" });
  }
  try {
    // Usamos o operador $push para adicionar um item ao array categorias
    const competicao = await Competicao.findByIdAndUpdate(
      id,
      { $push: { categorias: { nome } } },
      { new: true, runValidators: true },
    );

    if (!competicao) {
      return res.status(404).json({ message: "Competição não encontrada" });
    }

    res.status(201).json({
      message: "Categoria adicionada com sucesso!",
      categorias: competicao.categorias,
    });
  } catch (error) {
    console.error('[admin] Erro ao adicionar categoria:', error);
    res
      .status(500)
      .json({ message: "Erro ao adicionar categoria" });
  }
};

export const updateCompeticao = async (req, res) => {
  const { id } = req.params;
  const { nome, ano, categorias } = req.body;

  try {
    // { new: true } retorna o documento atualizado
    // { runValidators: true } garante que as regras do Schema sejam aplicadas
    const competicao = await Competicao.findByIdAndUpdate(
      id,
      { nome, ano, categorias },
      { new: true, runValidators: true },
    );

    if (!competicao) {
      return res.status(404).json({ message: "Competição não encontrada" });
    }

    res.json({ message: "Competição atualizada com sucesso!", competicao });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao atualizar competição", error: error.message });
  }
};

// --- GESTÃO DE EQUIPES ---

export const criarEquipe = async (req, res) => {
  const { nome_equipe, tecnico_id, competicao_id, categoria_id } = req.body;
  try {
    const equipe = await Equipe.create({
      nome_equipe,
      tecnico_id,
      competicao_id,
      categoria_id,
    });
    res.status(201).json(equipe);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao criar Equipe", error: error.message });
  }
};

// --- NOVO: ANÁLISE E APROVAÇÃO DE ATLETAS ---

/**
 * @desc    Admin visualiza todos os atletas que os técnicos enviaram documentos
 */
export const getInscricoesPendentes = async (req, res) => {
  try {
    const pendentes = await Inscricao.aggregate([
      // 1. Filtrar apenas pendentes
      { $match: { status: "pendente" } },

      // 2. Trazer dados do Atleta
      {
        $lookup: {
          from: "atletas",
          localField: "atleta_id",
          foreignField: "_id",
          as: "atleta",
        },
      },
      { $unwind: "$atleta" },

      // 3. Trazer dados da Equipe (para pegar a categoria_id dela)
      {
        $lookup: {
          from: "equipes",
          localField: "equipe_id",
          foreignField: "_id",
          as: "equipe",
        },
      },
      { $unwind: "$equipe" },

      // 4. Trazer dados da Competição (para pegar os nomes das categorias no array)
      {
        $lookup: {
          from: "competicaos",
          localField: "competicao_id",
          foreignField: "_id",
          as: "competicao",
        },
      },
      { $unwind: "$competicao" },

      // 5. Resolver o nome da categoria comparando categoria_id da equipe com o array da competição
      {
        $addFields: {
          categoria_info: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$competicao.categorias",
                  as: "cat",
                  cond: { $eq: ["$$cat._id", "$equipe.categoria_id"] },
                },
              },
              0,
            ],
          },
        },
      },

      // 6. Formatar o JSON final para o Admin
      {
        $project: {
          _id: 1,
          status: 1,
          tipo: { $ifNull: ["$tipo", "inscricao"] }, // Fallback para inscrições antigas
          createdAt: 1,
          atleta: "$atleta",
          equipe: {
            _id: "$equipe._id",
            nome_equipe: "$equipe.nome_equipe",
          },
          competicao: {
            _id: "$competicao._id",
            nome: "$competicao.nome",
          },
          categoria_nome: "$categoria_info.nome",
        },
      },

      // 7. Ordenar por data (mais antigas primeiro para fila de análise)
      { $sort: { createdAt: 1 } },
    ]);

    res.json(pendentes);
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar inscrições pendentes",
      error: error.message,
    });
  }
};

export const analisarInscricao = async (req, res) => {
  const { id } = req.params;
  const { decisao, motivo_recusa } = req.body;

  try {
    const inscricao = await Inscricao.findById(id).populate("atleta_id");
    if (!inscricao)
      return res.status(404).json({ message: "Inscrição não encontrada" });

    const atleta = await Atleta.findById(inscricao.atleta_id._id);

    // 1. Atualizar o status da inscrição
    inscricao.status = decisao;
    if (decisao === "recusado") {
      inscricao.motivo_recusa = motivo_recusa;
    } else {
      atleta.verificado_pelo_admin = true;
    }

    // 2. Tentar apagar o ficheiro do disco APENAS APÓS ANÁLISE CONCLUÍDA (Segurança e Limpeza)
    if (
      atleta.url_documento &&
      atleta.url_documento !== "analisado_e_removido"
    ) {
      const filePath = path.join(
        process.cwd(),
        "uploads",
        atleta.url_documento,
      );

      fs.unlink(filePath, (err) => {
        if (err)
          console.error(
            `Erro ao apagar ficheiro: ${atleta.url_documento}`,
            err,
          );
        else
          console.log(
            `Ficheiro apagado com sucesso após análise: ${atleta.url_documento}`,
          );
      });

      // Limpar a referência no banco de dados, pois o ficheiro já não existe
      atleta.url_documento = "analisado_e_removido";
    }

    // 3. Se a inscrição foi recusada, verificar se o atleta tem outras inscrições
    // Se não tiver outras inscrições, deletar o atleta (foi criado especificamente para essa inscrição)
    if (decisao === "recusado") {
      const outrasInscricoes = await Inscricao.countDocuments({
        atleta_id: atleta._id,
        _id: { $ne: inscricao._id }, // Excluir a inscrição atual
      });

      if (outrasInscricoes === 0) {
        // Atleta só tinha essa inscrição, deletar o atleta
        await Atleta.findByIdAndDelete(atleta._id);
        await inscricao.save();

        return res.json({
          message: `Inscrição recusada, atleta deletado (sem outras inscrições) e documento removido do servidor.`,
        });
      }
    }

    await atleta.save();
    await inscricao.save();

    res.json({
      message: `Inscrição ${decisao} e documento removido do servidor.`,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao processar análise", error: error.message });
  }
};

/**
 * @desc    Rota especial para o Admin ver o documento (RG)
 * Evita que a pasta 'uploads' seja pública para todos.
 */
export const verDocumentoAtleta = async (req, res) => {
  let { filename } = req.params;

  // Sanitizar: pegar apenas o nome do arquivo (remove paths)
  filename = path.basename(filename);

  // Validar padrão: apenas caracteres alfanuméricos, hífens, pontos e underscores (sem espaços)
  if (!/^[a-zA-Z0-9\-_.]+$/.test(filename)) {
    return res.status(400).json({ message: "Nome de arquivo inválido" });
  }

  const filePath = path.join(process.cwd(), "uploads", filename);

  // Verificar se o arquivo resolvido está dentro da pasta 'uploads'
  const uploadsDir = path.resolve("uploads");
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(uploadsDir)) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res
      .status(404)
      .json({ message: "Documento não encontrado ou já foi removido." });
  }
};

// --- NOVO: GESTÃO DE JOGOS E RESULTADOS ---

export const getJogos = async (req, res) => {
  try {
    const jogos = await Jogo.find()
      .populate("equipe_a_id", "nome_equipe")
      .populate("equipe_b_id", "nome_equipe")
      .populate("arbitros_escalados.crew_chief_id", "nome email")
      .populate("arbitros_escalados.fiscal_1_id", "nome email")
      .populate("arbitros_escalados.fiscal_2_id", "nome email")
      .populate("arbitros_escalados.apontador_id", "nome email")
      .populate("arbitros_escalados.cronometrista_id", "nome email")
      .populate("arbitros_escalados.operador_24s_id", "nome email")
      .populate("arbitros_escalados.representante_id", "nome email");
    res.json(jogos);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar jogos", error: error.message });
  }
};

// --- ESCALAÇÃO DE ÁRBITROS NO JOGO ---
const CAMPOS_ARBITROS = [
  "crew_chief_id",
  "fiscal_1_id",
  "fiscal_2_id",
  "apontador_id",
  "cronometrista_id",
  "operador_24s_id",
  "representante_id",
];

export const escalarArbitros = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  try {
    const jogo = await Jogo.findById(id);
    if (!jogo) return res.status(404).json({ message: "Jogo não encontrado" });

    const escalados = {};
    for (const campo of CAMPOS_ARBITROS) {
      const val = body[campo];
      if (val === undefined) {
        escalados[campo] = jogo.arbitros_escalados?.[campo] || null;
        continue;
      }
      if (val === null || val === "") {
        escalados[campo] = null;
        continue;
      }

      const funcao = campo.replace(/_id$/, "");
      const arbitro = await Arbitro.findById(val).select("funcoes ativo");
      if (!arbitro || !arbitro.ativo) {
        return res
          .status(400)
          .json({ message: `Árbitro inválido para ${campo}` });
      }
      if (!arbitro.funcoes.includes(funcao)) {
        return res.status(400).json({
          message: `Árbitro não está habilitado na função ${funcao}`,
        });
      }
      escalados[campo] = val;
    }

    jogo.arbitros_escalados = escalados;
    await jogo.save();

    const populado = await Jogo.findById(id)
      .populate("arbitros_escalados.crew_chief_id", "nome email")
      .populate("arbitros_escalados.fiscal_1_id", "nome email")
      .populate("arbitros_escalados.fiscal_2_id", "nome email")
      .populate("arbitros_escalados.apontador_id", "nome email")
      .populate("arbitros_escalados.cronometrista_id", "nome email")
      .populate("arbitros_escalados.operador_24s_id", "nome email")
      .populate("arbitros_escalados.representante_id", "nome email");

    res.json({
      message: "Árbitros escalados",
      arbitros_escalados: populado.arbitros_escalados,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Erro ao escalar árbitros", error: err.message });
  }
};

export const criarJogo = async (req, res) => {
  const {
    competicao_id,
    categoria_id,
    equipe_a_id,
    equipe_b_id,
    data_jogo,
    local,
  } = req.body;
  try {
    const jogo = await Jogo.create({
      competicao_id,
      categoria_id,
      equipe_a_id,
      equipe_b_id,
      data_jogo,
      local,
      status: "agendado",
    });
    res.status(201).json(jogo);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao agendar jogo", error: error.message });
  }
};

/**
 * @desc    Atualiza placar e finaliza o jogo.
 * É aqui que a regra de 'ja_jogou' é disparada para todos os escalados.
 */
export const atualizarPlacar = async (req, res) => {
  const { id } = req.params;
  const { placar_a, placar_b, status } = req.body;

  try {
    const jogo = await Jogo.findByIdAndUpdate(
      id,
      { placar_a, placar_b, status },
      { new: true },
    );

    if (!jogo) return res.status(404).json({ message: "Jogo não encontrado" });

    if (status === "finalizado") {
      await marcarJaJogou(id, jogo.competicao_id);
    }

    res.json({ message: "Resultado atualizado e atletas vinculados!", jogo });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao atualizar placar", error: error.message });
  }
};

