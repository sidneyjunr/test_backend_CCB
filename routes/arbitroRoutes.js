import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  criarArbitro,
  listarArbitros,
  atualizarArbitro,
  deletarArbitro,
  verificarSenha,
  redefinirSenha,
  uploadAssinatura,
  getAssinatura,
} from "../controllers/arbitroController.js";

const router = express.Router();

const MAX_ASSINATURA_BYTES = 500 * 1024;

const fileFilter = (req, file, cb) => {
  if (!/\.(png|jpg|jpeg)$/i.test(file.originalname)) {
    return cb(new Error("Extensão inválida (PNG/JPG)"));
  }
  if (!["image/png", "image/jpeg"].includes(file.mimetype)) {
    return cb(new Error("MIME inválido"));
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ASSINATURA_BYTES },
  fileFilter,
});

// Rate limit agressivo na verificação de senha (6 dígitos é fraco)
const senhaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Muitas tentativas. Aguarde.",
});

// --- ADMIN (painel de árbitros) ---
router.get("/", protect, admin, listarArbitros);
router.post("/", protect, admin, criarArbitro);
router.patch("/:id", protect, admin, atualizarArbitro);
router.delete("/:id", protect, admin, deletarArbitro);
router.get("/:id/assinatura", protect, admin, getAssinatura);

// --- FLUXO SÚMULA (autenticação via senha 6 dígitos) ---
// Obs.: protegido por protect (admin/tecnico logado na mesa) + rate limit.
router.post("/verificar", protect, senhaLimiter, verificarSenha);
router.patch("/:id/senha", protect, redefinirSenha);
router.post(
  "/:id/assinatura",
  protect,
  upload.single("assinatura"),
  uploadAssinatura
);

export default router;
