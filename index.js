import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import fs from "fs";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import equipeRoutes from "./routes/equipeRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import sumulaRoutes from "./routes/sumulaRoutes.js";
import arbitroRoutes from "./routes/arbitroRoutes.js";
import tecnicoRoutes from "./routes/tecnicoRoutes.js";

import cors from "cors";

import swaggerUi from "swagger-ui-express";
import { specs } from "./swagger.js";

//Configuração do dotenv para ele parar de falar quantas coisas tem no .env
dotenv.config({ quiet: true });

// Validar variáveis de ambiente obrigatórias antes de iniciar
const requiredEnvVars = ["MONGO_URI", "JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`ERRO: Variáveis de ambiente obrigatórias não configuradas: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Headers de segurança HTTP
app.use(helmet());

// Configurar CORS com origins específicos
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3000",
  "http://localhost:3001",
];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());

// Confiar em proxy (necessário para Render e outros provedores)
app.set('trust proxy', 1);

// Rate limiting geral para todas as rotas da API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,
  message: "Muitas requisições. Tente novamente em alguns minutos.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting mais restrito para login (brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 tentativas por janela
  message: "Muitas tentativas de login. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", loginLimiter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

//Conectado ao banco de dados de forma simples, aquele mongo_uri veio do .env
const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Conectado ao Banco de Dados com sucesso");
  } catch (error) {
    console.log("Erro ao se Conectar ao Banco de Dados MongoDB", error);
    process.exit(1); //Sai do processo se não conseguir se conectar
  }
};

// Listeners de conexão MongoDB
mongoose.connection.on("disconnected", () => {
  console.warn("Desconectado do MongoDB");
});

mongoose.connection.on("error", (error) => {
  console.error("Erro na conexão MongoDB:", error);
});

connectToDatabase();

//ROTAS QUE USAREI

//rota para login de tecnico e admin
app.use("/api/auth", authRoutes);

//rota para admin ter autorização
app.use("/api/admin", adminRoutes);

app.use("/api/equipes", equipeRoutes);

app.use("/api/sumula", sumulaRoutes);

app.use("/api/arbitro", arbitroRoutes);

app.use("/api/tecnico", tecnicoRoutes);

app.use("/api/public", publicRoutes);

// Health check para monitoramento do servidor
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

//Primeira Rota Get padrão do programa
app.get("/", (req, res) => {
  res.send("API da CCB está no ar. Documentação disponível em: /api-docs");
});

app.listen(PORT, () => {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  console.log(`🚀 Servidor rodando em porta ${PORT} (${NODE_ENV})`);
  console.log(`📚 Documentação Swagger: /api-docs`);
});
