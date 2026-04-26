import express from "express";
import rateLimit from "express-rate-limit";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  criarSumula,
  getSumula,
  getSumulaPorJogo,
  listarSumulas,
  patchArbitragemMesa,
  patchEscalacao,
  patchNumeracao,
  patchTitulares,
  patchComissao,
  iniciarSumula,
  registrarEvento,
  cancelarEvento,
  hardDeletarEvento,
  editarEvento,
  inserirEventoEntre,
  finalizarSumula,
  gerarPdfSumula,
} from "../controllers/sumulaController.js";

const router = express.Router();

// Rate limit especifico para eventos em tempo real (pico ~10-15 eventos/min num jogo)
const eventoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "Muitos eventos em sequencia. Aguarde alguns segundos.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * tags:
 *   name: Sumula
 *   description: Sumula eletronica (mesario)
 */

/**
 * @swagger
 * /api/sumula:
 *   post:
 *     summary: Cria sumula a partir de um jogo agendado
 *     tags: [Sumula]
 *     security:
 *       - bearerAuth: []
 */
router.post("/", protect, admin, criarSumula);

/**
 * @swagger
 * /api/sumula:
 *   get:
 *     summary: Lista sumulas (filtro por status, competicao_id, jogo_id)
 *     tags: [Sumula]
 *     security:
 *       - bearerAuth: []
 */
router.get("/", protect, admin, listarSumulas);

/**
 * @swagger
 * /api/sumula/por-jogo/{jogoId}:
 *   get:
 *     summary: Busca sumula pelo ID do jogo
 *     tags: [Sumula]
 *     security:
 *       - bearerAuth: []
 */
router.get("/por-jogo/:jogoId", protect, admin, getSumulaPorJogo);

/**
 * @swagger
 * /api/sumula/{id}:
 *   get:
 *     summary: Busca sumula completa (com eventos e estado computado)
 *     tags: [Sumula]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id", protect, admin, getSumula);

// --- Etapas do pre-jogo ---
router.patch("/:id/arbitragem-mesa", protect, admin, patchArbitragemMesa);
router.patch("/:id/escalacao", protect, admin, patchEscalacao);
router.patch("/:id/numeracao", protect, admin, patchNumeracao);
router.patch("/:id/titulares", protect, admin, patchTitulares);
router.patch("/:id/comissao", protect, admin, patchComissao);
router.post("/:id/iniciar", protect, admin, iniciarSumula);

// --- Durante o jogo ---
router.post("/:id/evento", protect, admin, eventoLimiter, registrarEvento);
router.patch(
  "/:id/evento/:eventoId/cancelar",
  protect,
  admin,
  eventoLimiter,
  cancelarEvento
);
router.patch("/:id/evento/:eventoId", protect, admin, editarEvento);
router.delete("/:id/evento/:eventoId", protect, admin, hardDeletarEvento);
router.post("/:id/evento-entre", protect, admin, inserirEventoEntre);

// --- Pos-jogo ---
router.post("/:id/finalizar", protect, admin, finalizarSumula);

// --- PDF ---
/**
 * @swagger
 * /api/sumula/{id}/pdf:
 *   get:
 *     summary: Gera PDF (3 paginas) da sumula
 *     tags: [Sumula]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id/pdf", protect, admin, gerarPdfSumula);

export default router;
