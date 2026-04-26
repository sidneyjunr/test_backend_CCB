import express from "express";
import path from "path";
import { protect } from "../middleware/authMiddleware.js";
import {
  getInscricoesEquipe,
  getJogosProximos,
  getMinhasEquipes,
  inscreverAtleta,
  salvarEscalacao,
  desvincularAtleta,
  buscarAtletas,
  criarSolicitacaoAgregamento,
} from "../controllers/equipeController.js";
import multer from "multer";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const router = express.Router();

// Configurar diskStorage para salvar arquivos no servidor
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// MIME types permitidos (validação real do conteúdo, não só extensão)
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// Validar tipo de arquivo por MIME type e extensão
const fileFilter = (req, file, cb) => {
  const allowedExt = /\.(jpg|jpeg|png|pdf|doc|docx)$/i;
  if (!allowedExt.test(file.originalname)) {
    return cb(new Error("Extensão de arquivo não permitida. Use: jpg, jpeg, png, pdf, doc, docx"));
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Tipo de arquivo não permitido."));
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: fileFilter,
});

/**
 * @swagger
 * tags:
 *   name: Equipes
 *   description: Gestão de elencos, inscrições e escalações para técnicos
 */

/**
 * @swagger
 * /api/equipes/minhas:
 *   get:
 *     summary: Lista as equipes vinculadas ao técnico logado
 *     tags: [Equipes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de equipes retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   nome_equipe:
 *                     type: string
 *                   competicao_id:
 *                     type: object
 *                     properties:
 *                       nome:
 *                         type: string
 *                       ano:
 *                         type: number
 */

router.get("/minhas", protect, getMinhasEquipes);

/**
 * @swagger
 * /api/equipes/inscrever:
 *   post:
 *     summary: Inscreve um atleta e faz upload do documento
 *     tags: [Equipes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               documento:
 *                 type: string
 *                 format: binary
 *                 description: Documento do atleta (PDF, imagem, etc.)
 *               nome_completo:
 *                 type: string
 *                 description: Nome completo do atleta
 *               data_nascimento:
 *                 type: string
 *                 format: date
 *                 description: Data de nascimento (YYYY-MM-DD)
 *               documento_id:
 *                 type: string
 *                 description: ID do documento (CPF/CNH)
 *               equipe_id:
 *                 type: string
 *                 description: ID da equipe
 *             required:
 *               - documento
 *               - nome_completo
 *               - data_nascimento
 *               - documento_id
 *               - equipe_id
 *     responses:
 *       201:
 *         description: Atleta inscrito com sucesso
 *       400:
 *         description: Dados inválidos ou arquivo não permitido
 *       401:
 *         description: Não autorizado
 */
// Usamos o 'upload.single' para capturar o campo 'documento' que vem do FormData
router.post("/inscrever", protect, upload.single("documento"), inscreverAtleta);

/**
 * @swagger
 * /api/equipes/jogos/{equipe_id}:
 *   get:
 *     summary: Lista os próximos jogos de uma equipe específica
 *     tags: [Equipes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: equipe_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da equipe para buscar os jogos
 *     responses:
 *       200:
 *         description: Lista de jogos encontrados
 */
router.get("/jogos/:equipe_id", protect, getJogosProximos);

/**
 * @swagger
 * /api/equipes/escalar:
 *   post:
 *     summary: Define os 12 atletas escalados para uma partida (Súmula)
 *     tags: [Equipes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jogo_id
 *               - equipe_id
 *               - atletas_selecionados
 *             properties:
 *               jogo_id:
 *                 type: string
 *               equipe_id:
 *                 type: string
 *               atletas_selecionados:
 *                 type: array
 *                 maxItems: 12
 *                 items:
 *                   type: object
 *                   properties:
 *                     atleta_id:
 *                       type: string
 *                     numero_camisa:
 *                       type: string
 *     responses:
 *       200:
 *         description: Escalação salva com sucesso
 *       400:
 *         description: Limite de 12 atletas excedido
 */
router.post("/escalar", protect, salvarEscalacao);
router.patch("/escalar", protect, salvarEscalacao);

/**
 * @swagger
 * /api/equipes/{id}/inscricoes:
 *   get:
 *     summary: Lista todas as inscrições de uma equipe (Pendente, Aprovado, Recusado)
 *     tags: [Equipes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da equipe
 *     responses:
 *       200:
 *         description: Lista de inscrições da equipe
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro ao buscar inscrições
 */

router.get("/:id/inscricoes", protect, getInscricoesEquipe);

router.patch("/inscricoes/:id", protect, desvincularAtleta);

router.get("/buscar/atletas", protect, buscarAtletas);

router.post("/solicitacao-agregamento", protect, criarSolicitacaoAgregamento);

export default router;
