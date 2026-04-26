import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  adicionarCategoria,
  analisarInscricao,
  atualizarPlacar,
  criarCompeticao,
  criarEquipe,
  criarJogo,
  criarUsuarioTecnico,
  escalarArbitros,
  getAtletasEquipe,
  getCompeticoes,
  getEquipes,
  getInscricoesPendentes,
  getJogos,
  getTecnicos,
  updateCompeticao,
  verDocumentoAtleta,
} from "../controllers/adminController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Operações exclusivas para administradores da CCB
 */

/**
 * @swagger
 * /api/admin/usuario:
 *   post:
 *     summary: Cria um novo usuário do tipo Técnico
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nome
 *               - email
 *               - senha
 *             properties:
 *               nome:
 *                 type: string
 *                 example: João Silva
 *               email:
 *                 type: string
 *                 example: joao@email.com
 *               senha:
 *                 type: string
 *                 example: 123456
 *     responses:
 *       201:
 *         description: Técnico criado com sucesso
 */
router.post("/usuario", protect, admin, criarUsuarioTecnico);

/**
 * @swagger
 * /api/admin/competicao:
 *   get:
 *     summary: "Lista todas as competições cadastradas"
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de competições retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   nome:
 *                     type: string
 *                   ano:
 *                     type: number
 *                   categorias:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         nome:
 *                           type: string
 */

router.get("/competicao", protect, admin, getCompeticoes);

/**
 * @swagger
 * /api/admin/competicao/{id}/categoria:
 *   post:
 *     summary: Adiciona uma nova categoria a uma competição existente (via PUSH)
 *     description: >
 *       Esta rota adiciona apenas uma categoria por vez ao array 'categorias'.
 *       É mais segura que o PATCH, pois não exige o envio dos IDs existentes.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           description: ID da competição (deve ser um ObjectId válido)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *                 example: "Sub-17 Masculino"
 *             required:
 *               - nome
 *     responses:
 *       201:
 *         description: Categoria adicionada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Categoria adicionada com sucesso!"
 *                 categorias:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       nome:
 *                         type: string
 *                         example: "Sub-17 Masculino"
 *       400:
 *         description: Nome da categoria é obrigatório ou categoria já existe
 *       404:
 *         description: Competição não encontrada
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro interno do servidor
 */

router.post("/competicao/:id/categoria", protect, admin, adicionarCategoria);

/**
 * @swagger
 * /api/admin/competicao:
 *   post:
 *     summary: Cria uma nova competição (Copa)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nome
 *               - ano
 *             properties:
 *               nome:
 *                 type: string
 *                 example: Copa CCB
 *               ano:
 *                 type: number
 *                 example: 2025
 *               categorias:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     nome:
 *                       type: string
 *                       example: Sub-15
 *     responses:
 *       201:
 *         description: Competição criada com sucesso
 */
router.post("/competicao", protect, admin, criarCompeticao);

/**
 * @swagger
 * /api/admin/competicao/{id}:
 *   patch:
 *     summary: "Atualiza dados de uma competição (ex: Adicionar ou Editar categoria)"
 *     description: |
 *       Para adicionar categorias sem alterar as existentes, envie o array completo
 *       contendo as categorias atuais (com seus respectivos _id) e os novos objetos sem _id.
 *       Se uma categoria existente for enviada sem o _id, ela será recriada com um novo ID,
 *       o que quebrará os vínculos das equipes.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da competição
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               ano:
 *                 type: number
 *               categorias:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       description: "ID da categoria existente (obrigatório para não gerar novo ID)"
 *                     nome:
 *                       type: string
 *                       description: "Nome da categoria"
 *     responses:
 *       200:
 *         description: Competição atualizada com sucesso
 *       404:
 *         description: Competição não encontrada
 */

router.patch("/competicao/:id", protect, admin, updateCompeticao);

/**
 * @swagger
 * /api/admin/tecnicos:
 *   get:
 *     summary: Lista todos os técnicos
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de técnicos retornada com sucesso
 */
router.get("/tecnicos", protect, admin, getTecnicos);

router.get("/equipe", protect, admin, getEquipes);

/**
 * @swagger
 * /api/admin/equipe:
 *   post:
 *     summary: Cria uma nova equipe
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome_equipe:
 *                 type: string
 *                 example: Equipe Azul
 *               tecnico_id:
 *                 type: string
 *                 format: objectId
 *                 example: 123id_tecnico12cs
 *               competicao_id:
 *                 type: string
 *                 format: objectId
 *                 example: 123id_competicaoo12cs
 *               categoria_id:
 *                 type: string
 *                 format: objectId
 *                 example: 123id_catego12cs
 *     responses:
 *       201:
 *         description: "Equipe criada com sucesso"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                   format: objectId
 *                   description: "ID da equipe criada"
 *                   example: 60d5f4b2d5e78c4d8cd64d0e
 *                 nome_equipe:
 *                   type: string
 *                   example: Equipe Azul
 *                 tecnico_id:
 *                   type: string
 *                   format: objectId
 *                   example: "123id_tecnico12cs"
 *                 competicao_id:
 *                   type: string
 *                   format: objectId
 *                   example: "123id_competicaoo12cs"
 *                 categoria_id:
 *                   type: string
 *                   format: objectId
 *                   example: "123id_catego12cs"
 *       500:
 *         description: "Erro ao tentar criar a equipe"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Erro ao tentar criar a equipe"
 */

router.post("/equipe", protect, admin, criarEquipe);

/**
 * @swagger
 * /api/admin/equipe/{id}/atletas:
 *   get:
 *     summary: "Lista todos os atletas de uma equipe específica"
 *     tags:
 *       - Admin
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
 *         description: Lista de atletas da equipe retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   atleta_id:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       nome_completo:
 *                         type: string
 *                       data_nascimento:
 *                         type: string
 *                       documento_id:
 *                         type: string
 *                       rg:
 *                         type: string
 *                       verificado_pelo_admin:
 *                         type: boolean
 *                   status:
 *                     type: string
 *                     enum: [pendente, aprovado, rejeitado]
 *                   createdAt:
 *                     type: string
 *                   updatedAt:
 *                     type: string
 */

router.get("/equipe/:id/atletas", protect, admin, getAtletasEquipe);

/**
 * @swagger
 * /api/admin/jogo:
 *   post:
 *     summary: "Cria um novo jogo de basquete"
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - competicao_id
 *               - categoria_id
 *               - equipe_a_id
 *               - equipe_b_id
 *               - data_jogo
 *             properties:
 *               competicao_id:
 *                 type: string
 *                 description: ID da competição
 *               categoria_id:
 *                 type: string
 *                 description: ID da categoria
 *               equipe_a_id:
 *                 type: string
 *                 description: ID da equipe A
 *               equipe_b_id:
 *                 type: string
 *                 description: ID da equipe B
 *               data_jogo:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-01-08T19:30:00Z"
 *               placar_a:
 *                 type: number
 *                 example: 0
 *               placar_b:
 *                 type: number
 *                 example: 0
 *               status:
 *                 type: string
 *                 enum: [agendado, em andamento, finalizado, cancelado]
 *     responses:
 *       201:
 *         description: Jogo criado com sucesso
 */

router.get("/jogo", protect, admin, getJogos);

router.post("/jogo", protect, admin, criarJogo);

/**
 * @swagger
 * /api/admin/jogo/{id}:
 *   patch:
 *     summary: "Atualiza o placar e o status de um jogo de basquete"
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do jogo
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               placar_a:
 *                 type: number
 *                 example: 78
 *                 description: Pontuação da equipe A
 *               placar_b:
 *                 type: number
 *                 example: 65
 *                 description: Pontuação da equipe B
 *               status:
 *                 type: string
 *                 example: finalizado
 *                 enum: [agendado, em andamento, finalizado, cancelado]
 *     responses:
 *       200:
 *         description: Placar atualizado com sucesso e atletas vinculados
 *       404:
 *         description: Jogo não encontrado
 *       500:
 *         description: Erro ao atualizar placar
 */

router.patch("/jogo/:id", protect, admin, atualizarPlacar);

router.patch("/jogo/:id/arbitros", protect, admin, escalarArbitros);

/**
 * @swagger
 * /api/admin/inscricoes/pendentes:
 *   get:
 *     summary: Lista atletas que aguardam aprovação de documentos
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de inscrições pendentes com dados do atleta e equipe
 */
router.get("/inscricoes/pendentes", protect, admin, getInscricoesPendentes);

/**
 * @swagger
 * /api/admin/inscricoes/{id}/analisar:
 *   patch:
 *     summary: Aprova ou recusa a inscrição de um atleta e remove o documento
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da inscrição
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decisao
 *             properties:
 *               decisao:
 *                 type: string
 *                 enum: [aprovado, recusado]
 *               motivo_recusa:
 *                 type: string
 *                 example: RG ilegível
 *     responses:
 *       200:
 *         description: Inscrição analisada com sucesso
 *       404:
 *         description: Inscrição não encontrada
 */
router.patch("/inscricoes/:id/analisar", protect, admin, analisarInscricao);

/**
 * @swagger
 * /api/admin/documento/{filename}:
 *   get:
 *     summary: Visualiza o arquivo do documento do atleta (Acesso restrito Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Nome do arquivo salvo no banco
 *     responses:
 *       200:
 *         description: Documento retornado com sucesso
 *       404:
 *         description: Documento não encontrado
 */
router.get("/documento/:filename", protect, admin, verDocumentoAtleta);

export default router;
