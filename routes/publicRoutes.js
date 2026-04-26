import express from "express";
import {
  getEquipes,
  getAtletasEquipePublic,
  getResultadosHome,
  getEscalacaoJogo,
  getClassificacao,
  getEstatisticas,
  getPontosAtleta,
  getScoutJogo,
  getCompeticoesPublic,
  getSumulaPublic,
} from "../controllers/publicController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Public
 *   description: Rotas acessíveis sem autenticação para o site principal
 */

/**
 * @swagger
 * /api/public/resultados:
 *   get:
 *     summary: Busca os últimos resultados de jogos para o carrossel da Home
 *     description: Retorna os últimos 10 jogos com status 'finalizado' para exibição pública.
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Lista de jogos finalizados retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   equipe_a_id:
 *                     type: object
 *                     properties:
 *                       nome_equipe:
 *                         type: string
 *                   equipe_b_id:
 *                     type: object
 *                     properties:
 *                       nome_equipe:
 *                         type: string
 *                   placar_a:
 *                     type: number
 *                   placar_b:
 *                     type: number
 *                   data_jogo:
 *                     type: string
 *                     format: date-time
 *                   local:
 *                     type: string
 *                   status:
 *                     type: string
 *       500:
 *         description: Erro interno no servidor
 */
router.get("/resultados", getResultadosHome);
/**
 * @swagger
 * /api/public/equipes:
 *   get:
 *     summary: Busca todas as equipes com detalhes de técnico, competição e categoria
 *     description: Retorna a lista de equipes com seus respectivos técnicos, competições e categorias detalhadas.
 *     tags: [Public]
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
 *                     description: ID da equipe
 *                   nome_equipe:
 *                     type: string
 *                     description: Nome da equipe
 *                   tecnico_id:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         description: ID do técnico
 *                       nome:
 *                         type: string
 *                         description: Nome do técnico
 *                   competicao_id:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         description: ID da competição
 *                       nome:
 *                         type: string
 *                         description: Nome da competição
 *                       ano:
 *                         type: integer
 *                         description: Ano da competição
 *                   categoria_id:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         description: ID da categoria
 *                       nome:
 *                         type: string
 *                         description: Nome da categoria
 *       404:
 *         description: Nenhuma equipe encontrada
 *       500:
 *         description: Erro interno no servidor
 */
router.get("/equipes", getEquipes);
/**
 * @swagger
 * /api/public/escalacao/{jogoId}:
 *   get:
 *     summary: Busca a escalação de um jogo específico
 *     description: Retorna os 12 atletas escalados para um jogo. Qualquer pessoa pode visualizar.
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: jogoId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do jogo
 *     responses:
 *       200:
 *         description: Escalação do jogo retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jogo_id:
 *                   type: string
 *                 equipe_id:
 *                   type: string
 *                 atletas_selecionados:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       nome_completo:
 *                         type: string
 *       404:
 *         description: Escalação não encontrada
 *       500:
 *         description: Erro interno no servidor
 */
router.get("/escalacao/:jogoId", getEscalacaoJogo);

/**
 * @swagger
 * /api/public/classificacao:
 *   get:
 *     summary: Busca a classificação dos times por categoria
 *     description: Retorna a tabela de classificação com estatísticas dos times.
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: categoria
 *         required: true
 *         schema:
 *           type: string
 *         description: Nome da categoria (ex Sub-16 Masculino)
 *     responses:
 *       200:
 *         description: Classificação retornada com sucesso
 *       400:
 *         description: Categoria obrigatória
 *       404:
 *         description: Categoria não encontrada
 *       500:
 *         description: Erro interno no servidor
 */
router.get("/classificacao", getClassificacao);

/**
 * @swagger
 * /api/public/equipe/{id}/atletas:
 *   get:
 *     summary: Busca os atletas de uma equipe específica
 *     description: Retorna todos os atletas inscritos em uma equipe para visualização pública.
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da equipe
 *     responses:
 *       200:
 *         description: Atletas da equipe retornados com sucesso
 *       500:
 *         description: Erro interno no servidor
 */
router.get("/equipe/:id/atletas", getAtletasEquipePublic);

router.get("/estatisticas", getEstatisticas);

router.get("/atleta/:id/pontos", getPontosAtleta);

router.get("/jogo/:id/scout", getScoutJogo);

router.get("/competicoes", getCompeticoesPublic);

router.get("/sumula/:jogoId", getSumulaPublic);

export default router;
