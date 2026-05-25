import { Usuario } from "../models/Usuario.js";
import { Competicao } from "../models/Competicao.js";
import { Equipe } from "../models/Equipe.js";
import { Inscricao } from "../models/Inscricao.js";
import { Atleta } from "../models/Atleta.js";
import { Jogo } from "../models/Jogo.js";
import { Escalacao } from "../models/Escalacao.js";
import { Arbitro, FUNCOES_ARBITRO } from "../models/Arbitro.js";
import Ponto from "../models/Ponto.js";

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
          grupo_id: 1,
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

// Exclui uma competição. Bloqueia se houver jogos ou equipes vinculados.
export const excluirCompeticao = async (req, res) => {
  const { id } = req.params;
  try {
    const competicao = await Competicao.findById(id);
    if (!competicao) {
      return res.status(404).json({ message: "Competição não encontrada" });
    }

    const [jogos, equipes] = await Promise.all([
      Jogo.countDocuments({ competicao_id: id }),
      Equipe.countDocuments({ competicao_id: id }),
    ]);
    if (jogos > 0 || equipes > 0) {
      return res.status(409).json({
        message: `Não é possível excluir: ${jogos} jogo(s) e ${equipes} equipe(s) vinculados.`,
      });
    }

    await competicao.deleteOne();
    res.json({ message: "Competição excluída com sucesso!" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao excluir competição", error: error.message });
  }
};

// Edita uma categoria: nome, formato, grupos, critérios e pontuação.
export const editarCategoria = async (req, res) => {
  const { id, categoriaId } = req.params;
  const {
    nome,
    formato,
    grupos,
    criterios_classificacao,
    pontos_vitoria,
    pontos_derrota,
  } = req.body;
  try {
    const competicao = await Competicao.findById(id);
    if (!competicao) {
      return res.status(404).json({ message: "Competição não encontrada" });
    }
    const categoria = competicao.categorias.id(categoriaId);
    if (!categoria) {
      return res.status(404).json({ message: "Categoria não encontrada" });
    }

    if (nome !== undefined) categoria.nome = nome;
    if (formato !== undefined) categoria.formato = formato;
    if (grupos !== undefined) categoria.grupos = grupos;
    if (criterios_classificacao !== undefined) {
      categoria.criterios_classificacao = criterios_classificacao;
    }
    if (pontos_vitoria !== undefined) categoria.pontos_vitoria = pontos_vitoria;
    if (pontos_derrota !== undefined) categoria.pontos_derrota = pontos_derrota;

    await competicao.save();
    res.json({ message: "Categoria atualizada com sucesso!", categoria });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao atualizar categoria", error: error.message });
  }
};

// Exclui uma categoria. Bloqueia se houver jogos ou equipes vinculados.
export const excluirCategoria = async (req, res) => {
  const { id, categoriaId } = req.params;
  try {
    const competicao = await Competicao.findById(id);
    if (!competicao) {
      return res.status(404).json({ message: "Competição não encontrada" });
    }
    const categoria = competicao.categorias.id(categoriaId);
    if (!categoria) {
      return res.status(404).json({ message: "Categoria não encontrada" });
    }

    const [jogos, equipes] = await Promise.all([
      Jogo.countDocuments({ categoria_id: categoriaId }),
      Equipe.countDocuments({ categoria_id: categoriaId }),
    ]);
    if (jogos > 0 || equipes > 0) {
      return res.status(409).json({
        message: `Não é possível excluir: ${jogos} jogo(s) e ${equipes} equipe(s) vinculados.`,
      });
    }

    competicao.categorias.pull(categoriaId);
    await competicao.save();
    res.json({
      message: "Categoria excluída com sucesso!",
      categorias: competicao.categorias,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao excluir categoria", error: error.message });
  }
};

// --- GESTÃO DE EQUIPES ---

// Atribui (ou remove, com grupo_id null) o grupo de uma equipe.
export const atribuirGrupoEquipe = async (req, res) => {
  const { id } = req.params;
  const { grupo_id } = req.body;
  try {
    const equipe = await Equipe.findByIdAndUpdate(
      id,
      { grupo_id: grupo_id || null },
      { new: true, runValidators: true },
    );
    if (!equipe) {
      return res.status(404).json({ message: "Equipe não encontrada" });
    }
    res.json({ message: "Grupo da equipe atualizado!", equipe });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao atribuir grupo", error: error.message });
  }
};

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
      .sort({ data_jogo: -1 }) // jogos mais recentes primeiro (por data do jogo)
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

/**
 * @desc    Finaliza o jogo via Scout — recebe todos os pontos individuais,
 *          calcula o placar, salva os Pontos e marca ja_jogou. Fluxo manual,
 *          alternativo à súmula eletrônica completa (sem ao vivo).
 */
export const finalizarScout = async (req, res) => {
  const { id } = req.params;
  const { pin, pontos, atletas_ausentes, jersey_mappings } = req.body;

  try {
    // Validar PIN
    const pinCorreto = process.env.SCOUT_PIN || "123456";
    if (pin !== pinCorreto) {
      return res.status(403).json({ message: "PIN incorreto" });
    }

    // Validar jogo
    const jogo = await Jogo.findById(id);
    if (!jogo) return res.status(404).json({ message: "Jogo não encontrado" });
    if (jogo.status === "finalizado") {
      return res.status(400).json({ message: "Jogo já foi finalizado" });
    }

    if (!Array.isArray(pontos) || pontos.length === 0) {
      return res.status(400).json({ message: "Nenhum ponto enviado" });
    }

    // Preparar documentos para inserção
    const pontosParaSalvar = pontos.map((p) => ({
      atleta_id: p.atleta_id,
      jogo_id: id,
      equipe_id: p.equipe_id,
      quarto: p.quarto,
      numero_camisa: p.numero_camisa,
      tipo_cesta: p.tipo_cesta,
    }));

    await Ponto.insertMany(pontosParaSalvar);

    // Calcular placar a partir dos pontos
    const equipeAId = jogo.equipe_a_id.toString();
    const equipeBId = jogo.equipe_b_id.toString();

    let placar_a = 0;
    let placar_b = 0;

    for (const p of pontos) {
      if (p.equipe_id === equipeAId) {
        placar_a += p.tipo_cesta;
      } else if (p.equipe_id === equipeBId) {
        placar_b += p.tipo_cesta;
      }
    }

    // Atualizar jogo
    jogo.placar_a = placar_a;
    jogo.placar_b = placar_b;
    jogo.status = "finalizado";
    jogo.finalizado_por = "scout";
    await jogo.save();

    // Salvar mapeamento de camisas nas escalações
    if (Array.isArray(jersey_mappings) && jersey_mappings.length > 0) {
      const camisasPorEquipe = new Map();
      for (const jm of jersey_mappings) {
        const key = jm.equipe_id.toString();
        if (!camisasPorEquipe.has(key)) camisasPorEquipe.set(key, []);
        camisasPorEquipe.get(key).push({
          atleta_id: jm.atleta_id,
          numero_camisa: jm.numero_camisa,
        });
      }
      for (const [equipeId, camisas] of camisasPorEquipe) {
        await Escalacao.findOneAndUpdate(
          { jogo_id: id, equipe_id: equipeId },
          { camisas },
        );
      }
    }

    // Marcar ja_jogou (excluindo atletas ausentes)
    await marcarJaJogou(id, jogo.competicao_id, atletas_ausentes || []);

    res.json({
      message: "Scout finalizado com sucesso!",
      jogo,
      total_pontos: pontos.length,
      placar_a,
      placar_b,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao finalizar scout", error: error.message });
  }
};

/**
 * @desc    Reseta o scout de um jogo finalizado: apaga pontos, reverte
 *          ja_jogou, limpa camisas e volta o jogo para 'agendado'.
 */
export const resetarScout = async (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;

  try {
    // Validar PIN
    const pinCorreto = process.env.SCOUT_PIN || "123456";
    if (pin !== pinCorreto) {
      return res.status(403).json({ message: "PIN incorreto" });
    }

    // Validar jogo
    const jogo = await Jogo.findById(id);
    if (!jogo) return res.status(404).json({ message: "Jogo não encontrado" });
    if (jogo.status !== "finalizado") {
      return res
        .status(400)
        .json({ message: "Este jogo não possui scout finalizado" });
    }

    // 1. Reverter ja_jogou dos atletas escalados
    const escalacoes = await Escalacao.find({ jogo_id: id });
    for (const esc of escalacoes) {
      const idsAtletas = esc.atletas_selecionados || [];
      if (idsAtletas.length === 0) continue;

      // Verificar se o atleta jogou em OUTRO jogo (com pontos) antes de reverter
      for (const atletaId of idsAtletas) {
        const outrosJogos = await Ponto.findOne({
          atleta_id: atletaId,
          jogo_id: { $ne: id },
        });
        if (!outrosJogos) {
          // Só reverte se não jogou em nenhum outro jogo
          await Inscricao.updateMany(
            {
              atleta_id: atletaId,
              equipe_id: esc.equipe_id,
              competicao_id: jogo.competicao_id,
            },
            { ja_jogou: false },
          );
        }
      }

      // Limpar camisas da escalação
      esc.camisas = [];
      await esc.save();
    }

    // 2. Deletar todos os pontos do jogo
    await Ponto.deleteMany({ jogo_id: id });

    // 3. Resetar placar e status do jogo
    jogo.placar_a = 0;
    jogo.placar_b = 0;
    jogo.status = "agendado";
    jogo.finalizado_por = null;
    await jogo.save();

    res.json({
      message: "Scout resetado com sucesso! O jogo voltou ao estado inicial.",
      jogo,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao resetar scout", error: error.message });
  }
};

