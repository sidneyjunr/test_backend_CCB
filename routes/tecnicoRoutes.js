import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  criarTecnico,
  listarTecnicos,
  listarTecnicosPorEquipe,
  atualizarTecnico,
  deletarTecnico,
  verificarSenha,
  redefinirSenha,
  uploadAssinatura,
  getAssinatura,
} from "../controllers/tecnicoController.js";

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

const senhaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Muitas tentativas. Aguarde.",
});

// --- ADMIN ---
router.get("/", protect, admin, listarTecnicos);
router.get("/equipe/:equipe_id", protect, admin, listarTecnicosPorEquipe);
router.post("/", protect, admin, criarTecnico);
router.patch("/:id", protect, admin, atualizarTecnico);
router.delete("/:id", protect, admin, deletarTecnico);
router.get("/:id/assinatura", protect, admin, getAssinatura);

// --- FLUXO SÚMULA ---
router.post("/verificar", protect, senhaLimiter, verificarSenha);
router.patch("/:id/senha", protect, redefinirSenha);
router.post(
  "/:id/assinatura",
  protect,
  upload.single("assinatura"),
  uploadAssinatura
);

export default router;
