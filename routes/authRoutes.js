import express from 'express';
import { loginUsuario, refreshToken } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Autenticação
 *   description: Login e gerenciamento de tokens
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Realiza o login de um usuário (Admin ou Técnico)
 *     tags: [Autenticação]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - senha
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: tecnico@exemplo.com
 *               senha:
 *                 type: string
 *                 format: password
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login realizado com sucesso. Retorna o perfil e o Token JWT.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 nome:
 *                   type: string
 *                 tipo_usuario:
 *                   type: string
 *                   enum: [admin, tecnico]
 *                 token:
 *                   type: string
 *       401:
 *         description: Credenciais inválidas (email ou senha incorretos).
 *       500:
 *         description: Erro interno no servidor.
 */
router.post('/login', loginUsuario);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Renova o token JWT do usuário autenticado
 *     tags: [Autenticação]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token renovado com sucesso
 *       401:
 *         description: Token inválido ou expirado
 */
router.post('/refresh', protect, refreshToken);

export default router;
