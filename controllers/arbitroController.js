import fs from "fs";
import path from "path";
import { Arbitro, FUNCOES_ARBITRO } from "../models/Arbitro.js";
import {
  uploadBufferToCloudinary,
  destroyCloudinaryAsset,
  isCloudinaryEnabled,
} from "../config/cloudinary.js";

const SENHA_REGEX = /^\d{6}$/;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

const assinaturasDir = path.resolve("uploads", "assinaturas");
if (!fs.existsSync(assinaturasDir)) {
  fs.mkdirSync(assinaturasDir, { recursive: true });
}

const CLOUDINARY_FOLDER = "ccb/assinaturas";

const sanitizeFuncoes = (funcoes) => {
  if (!Array.isArray(funcoes)) return [];
  return [...new Set(funcoes.filter((f) => FUNCOES_ARBITRO.includes(f)))];
};

// --- ADMIN CRUD ---

export const criarArbitro = async (req, res) => {
  const { nome, email, funcoes, senha_padrao } = req.body;

  if (!nome || !email || !senha_padrao) {
    return res
      .status(400)
      .json({ message: "Nome, email e senha_padrao são obrigatórios" });
  }
  if (!SENHA_REGEX.test(senha_padrao)) {
    return res
      .status(400)
      .json({ message: "senha_padrao deve ter exatamente 6 dígitos numéricos" });
  }

  try {
    const existe = await Arbitro.findOne({ email: email.toLowerCase() });
    if (existe) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    const arbitro = await Arbitro.create({
      nome,
      email,
      senha_hash: senha_padrao,
      funcoes: sanitizeFuncoes(funcoes),
    });

    res.status(201).json({
      _id: arbitro._id,
      nome: arbitro.nome,
      email: arbitro.email,
      funcoes: arbitro.funcoes,
      assinatura_definida: arbitro.assinatura_definida,
      senha_redefinida: arbitro.senha_redefinida,
      ativo: arbitro.ativo,
    });
  } catch (err) {
    console.error("[arbitro] criarArbitro:", err);
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Erro ao criar árbitro", error: err.message });
  }
};

export const listarArbitros = async (req, res) => {
  try {
    const filtro = {};
    if (req.query.funcao && FUNCOES_ARBITRO.includes(req.query.funcao)) {
      filtro.funcoes = req.query.funcao;
    }
    if (req.query.ativo !== undefined) {
      filtro.ativo = req.query.ativo === "true";
    }
    const lista = await Arbitro.find(filtro)
      .select("-senha_hash")
      .sort({ nome: 1 });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ message: "Erro ao listar árbitros", error: err.message });
  }
};

export const atualizarArbitro = async (req, res) => {
  const { id } = req.params;
  const { nome, email, funcoes, ativo, reset_senha_padrao } = req.body;

  try {
    const arbitro = await Arbitro.findById(id);
    if (!arbitro) {
      return res.status(404).json({ message: "Árbitro não encontrado" });
    }

    if (nome !== undefined) arbitro.nome = nome;
    if (email !== undefined) arbitro.email = email;
    if (funcoes !== undefined) arbitro.funcoes = sanitizeFuncoes(funcoes);
    if (ativo !== undefined) arbitro.ativo = !!ativo;

    if (reset_senha_padrao) {
      if (!SENHA_REGEX.test(reset_senha_padrao)) {
        return res
          .status(400)
          .json({ message: "reset_senha_padrao deve ter 6 dígitos numéricos" });
      }
      arbitro.senha_hash = reset_senha_padrao;
      arbitro.senha_redefinida = false;
      arbitro.tentativas_falhas = 0;
      arbitro.bloqueado_ate = null;
    }

    await arbitro.save();
    const obj = arbitro.toObject();
    delete obj.senha_hash;
    res.json(obj);
  } catch (err) {
    res.status(500).json({ message: "Erro ao atualizar árbitro", error: err.message });
  }
};

export const deletarArbitro = async (req, res) => {
  const { id } = req.params;
  try {
    const arbitro = await Arbitro.findByIdAndDelete(id);
    if (!arbitro) {
      return res.status(404).json({ message: "Árbitro não encontrado" });
    }
    if (arbitro.assinatura_public_id) {
      await destroyCloudinaryAsset(arbitro.assinatura_public_id);
    } else if (arbitro.assinatura_path) {
      const abs = path.resolve(arbitro.assinatura_path);
      if (abs.startsWith(assinaturasDir) && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }
    res.json({ message: "Árbitro removido" });
  } catch (err) {
    res.status(500).json({ message: "Erro ao remover árbitro", error: err.message });
  }
};

// --- FLUXO DE SÚMULA: verificação de senha + primeiro uso ---

export const verificarSenha = async (req, res) => {
  const { arbitro_id, email, senha } = req.body;
  if ((!arbitro_id && !email) || !senha) {
    return res.status(400).json({ message: "arbitro_id (ou email) e senha obrigatórios" });
  }
  if (!SENHA_REGEX.test(senha)) {
    return res.status(400).json({ message: "Senha deve ter 6 dígitos" });
  }

  try {
    const arbitro = arbitro_id
      ? await Arbitro.findById(arbitro_id)
      : await Arbitro.findOne({ email: email.toLowerCase() });
    if (!arbitro || !arbitro.ativo) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    if (arbitro.bloqueado_ate && arbitro.bloqueado_ate > new Date()) {
      return res.status(429).json({
        message: "Árbitro temporariamente bloqueado",
        bloqueado_ate: arbitro.bloqueado_ate,
      });
    }

    const ok = await arbitro.matchSenha(senha);
    if (!ok) {
      arbitro.tentativas_falhas += 1;
      if (arbitro.tentativas_falhas >= MAX_TENTATIVAS) {
        arbitro.bloqueado_ate = new Date(Date.now() + BLOQUEIO_MINUTOS * 60 * 1000);
        arbitro.tentativas_falhas = 0;
      }
      await arbitro.save();
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    arbitro.tentativas_falhas = 0;
    arbitro.bloqueado_ate = null;
    await arbitro.save();

    res.json({
      arbitro_id: arbitro._id,
      nome: arbitro.nome,
      funcoes: arbitro.funcoes,
      precisa_redefinir: !arbitro.senha_redefinida,
      precisa_assinatura: !arbitro.assinatura_definida,
      assinatura_definida: arbitro.assinatura_definida,
    });
  } catch (err) {
    res.status(500).json({ message: "Erro na verificação", error: err.message });
  }
};

export const redefinirSenha = async (req, res) => {
  const { id } = req.params;
  const { senha_atual, nova_senha } = req.body;

  if (!senha_atual || !nova_senha) {
    return res
      .status(400)
      .json({ message: "senha_atual e nova_senha obrigatórios" });
  }
  if (!SENHA_REGEX.test(nova_senha)) {
    return res.status(400).json({ message: "Nova senha deve ter 6 dígitos" });
  }

  try {
    const arbitro = await Arbitro.findById(id);
    if (!arbitro || !arbitro.ativo) {
      return res.status(404).json({ message: "Árbitro não encontrado" });
    }

    const ok = await arbitro.matchSenha(senha_atual);
    if (!ok) {
      return res.status(401).json({ message: "Senha atual inválida" });
    }

    arbitro.senha_hash = nova_senha;
    arbitro.senha_redefinida = true;
    await arbitro.save();

    res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    res.status(500).json({ message: "Erro ao redefinir senha", error: err.message });
  }
};

// Valida magic bytes PNG/JPG
const isPng = (buf) =>
  buf.length >= 8 &&
  buf[0] === 0x89 &&
  buf[1] === 0x50 &&
  buf[2] === 0x4e &&
  buf[3] === 0x47;

const isJpg = (buf) =>
  buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

export const uploadAssinatura = async (req, res) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "Arquivo ausente" });
  }

  try {
    const arbitro = await Arbitro.findById(id);
    if (!arbitro || !arbitro.ativo) {
      return res.status(404).json({ message: "Árbitro não encontrado" });
    }

    const senha = req.body.senha;
    if (!senha || !(await arbitro.matchSenha(senha))) {
      return res.status(401).json({ message: "Senha inválida" });
    }

    const buf = file.buffer;
    if (!isPng(buf) && !isJpg(buf)) {
      return res.status(400).json({ message: "Formato inválido (PNG/JPG)" });
    }

    if (!isCloudinaryEnabled()) {
      return res
        .status(500)
        .json({ message: "Cloudinary não configurado no servidor" });
    }

    if (arbitro.assinatura_public_id) {
      await destroyCloudinaryAsset(arbitro.assinatura_public_id);
    } else if (arbitro.assinatura_path && !/^https?:\/\//i.test(arbitro.assinatura_path)) {
      const abs = path.resolve(arbitro.assinatura_path);
      if (abs.startsWith(assinaturasDir) && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }

    const publicId = `arb-${id}-${Date.now()}`;
    const result = await uploadBufferToCloudinary(buf, {
      folder: CLOUDINARY_FOLDER,
      public_id: publicId,
    });

    arbitro.assinatura_path = result.secure_url;
    arbitro.assinatura_public_id = result.public_id;
    arbitro.assinatura_definida = true;
    await arbitro.save();

    res.json({
      message: "Assinatura salva",
      assinatura_path: arbitro.assinatura_path,
    });
  } catch (err) {
    console.error("[arbitro] uploadAssinatura:", err);
    res.status(500).json({ message: "Erro ao salvar assinatura", error: err.message });
  }
};

export const getAssinatura = async (req, res) => {
  const { id } = req.params;
  try {
    const arbitro = await Arbitro.findById(id).select("assinatura_path");
    if (!arbitro || !arbitro.assinatura_path) {
      return res.status(404).json({ message: "Assinatura não encontrada" });
    }
    if (/^https?:\/\//i.test(arbitro.assinatura_path)) {
      return res.redirect(arbitro.assinatura_path);
    }
    const abs = path.resolve(arbitro.assinatura_path);
    if (!abs.startsWith(assinaturasDir) || !fs.existsSync(abs)) {
      return res.status(404).json({ message: "Arquivo ausente" });
    }
    res.sendFile(abs);
  } catch (err) {
    res.status(500).json({ message: "Erro", error: err.message });
  }
};
