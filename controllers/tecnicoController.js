import fs from "fs";
import path from "path";
import { Tecnico } from "../models/Tecnico.js";
import { Equipe } from "../models/Equipe.js";
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

const serialize = (tec) => {
  const obj = tec.toObject ? tec.toObject() : tec;
  delete obj.senha_hash;
  return obj;
};

// --- ADMIN CRUD ---

export const criarTecnico = async (req, res) => {
  const { nome, email, equipe_id, is_assistente, senha_padrao } = req.body;

  if (!nome || !email || !equipe_id) {
    return res
      .status(400)
      .json({ message: "Nome, email e equipe_id são obrigatórios" });
  }

  const assistente = !!is_assistente;
  if (!assistente) {
    if (!senha_padrao) {
      return res
        .status(400)
        .json({ message: "senha_padrao obrigatória para técnico principal" });
    }
    if (!SENHA_REGEX.test(senha_padrao)) {
      return res
        .status(400)
        .json({ message: "senha_padrao deve ter exatamente 6 dígitos numéricos" });
    }
  }

  try {
    const equipe = await Equipe.findById(equipe_id);
    if (!equipe) {
      return res.status(404).json({ message: "Equipe não encontrada" });
    }

    const existe = await Tecnico.findOne({ email: email.toLowerCase() });
    if (existe) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    const tecnico = await Tecnico.create({
      nome,
      email,
      equipe_id,
      is_assistente: assistente,
      senha_hash: assistente ? undefined : senha_padrao,
    });

    res.status(201).json(serialize(tecnico));
  } catch (err) {
    console.error("[tecnico] criarTecnico:", err);
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Erro ao criar técnico", error: err.message });
  }
};

export const listarTecnicos = async (req, res) => {
  try {
    const filtro = {};
    if (req.query.equipe_id) filtro.equipe_id = req.query.equipe_id;
    if (req.query.ativo !== undefined) {
      filtro.ativo = req.query.ativo === "true";
    }
    const lista = await Tecnico.find(filtro)
      .select("-senha_hash")
      .sort({ is_assistente: 1, nome: 1 });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ message: "Erro ao listar técnicos", error: err.message });
  }
};

export const listarTecnicosPorEquipe = async (req, res) => {
  const { equipe_id } = req.params;
  try {
    const lista = await Tecnico.find({ equipe_id })
      .select("-senha_hash")
      .sort({ is_assistente: 1, nome: 1 });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ message: "Erro ao listar técnicos", error: err.message });
  }
};

export const atualizarTecnico = async (req, res) => {
  const { id } = req.params;
  const { nome, email, ativo, reset_senha_padrao } = req.body;

  try {
    const tecnico = await Tecnico.findById(id);
    if (!tecnico) {
      return res.status(404).json({ message: "Técnico não encontrado" });
    }

    if (nome !== undefined) tecnico.nome = nome;
    if (email !== undefined) tecnico.email = email;
    if (ativo !== undefined) tecnico.ativo = !!ativo;

    if (reset_senha_padrao) {
      if (tecnico.is_assistente) {
        return res
          .status(400)
          .json({ message: "Assistente técnico não possui senha" });
      }
      if (!SENHA_REGEX.test(reset_senha_padrao)) {
        return res
          .status(400)
          .json({ message: "reset_senha_padrao deve ter 6 dígitos numéricos" });
      }
      tecnico.senha_hash = reset_senha_padrao;
      tecnico.senha_redefinida = false;
      tecnico.tentativas_falhas = 0;
      tecnico.bloqueado_ate = null;
      tecnico.assinatura_definida = false;
      if (tecnico.assinatura_public_id) {
        try {
          await destroyCloudinaryAsset(tecnico.assinatura_public_id);
        } catch {}
      } else if (tecnico.assinatura_path && !/^https?:\/\//i.test(tecnico.assinatura_path)) {
        const abs = path.resolve(tecnico.assinatura_path);
        if (abs.startsWith(assinaturasDir) && fs.existsSync(abs)) {
          try { fs.unlinkSync(abs); } catch {}
        }
      }
      tecnico.assinatura_path = null;
      tecnico.assinatura_public_id = null;
    }

    await tecnico.save();
    res.json(serialize(tecnico));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }
    res.status(500).json({ message: "Erro ao atualizar técnico", error: err.message });
  }
};

export const deletarTecnico = async (req, res) => {
  const { id } = req.params;
  try {
    const tecnico = await Tecnico.findByIdAndDelete(id);
    if (!tecnico) {
      return res.status(404).json({ message: "Técnico não encontrado" });
    }
    if (tecnico.assinatura_public_id) {
      await destroyCloudinaryAsset(tecnico.assinatura_public_id);
    } else if (tecnico.assinatura_path && !/^https?:\/\//i.test(tecnico.assinatura_path)) {
      const abs = path.resolve(tecnico.assinatura_path);
      if (abs.startsWith(assinaturasDir) && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }
    res.json({ message: "Técnico removido" });
  } catch (err) {
    res.status(500).json({ message: "Erro ao remover técnico", error: err.message });
  }
};

// --- FLUXO SÚMULA: verificação de senha (por id) ---

export const verificarSenha = async (req, res) => {
  const { tecnico_id, senha } = req.body;
  if (!tecnico_id || !senha) {
    return res.status(400).json({ message: "tecnico_id e senha obrigatórios" });
  }
  if (!SENHA_REGEX.test(senha)) {
    return res.status(400).json({ message: "Senha deve ter 6 dígitos" });
  }

  try {
    const tecnico = await Tecnico.findById(tecnico_id);
    if (!tecnico || !tecnico.ativo) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }
    if (tecnico.is_assistente) {
      return res.status(400).json({ message: "Assistente técnico não autentica" });
    }

    if (tecnico.bloqueado_ate && tecnico.bloqueado_ate > new Date()) {
      return res.status(429).json({
        message: "Técnico temporariamente bloqueado",
        bloqueado_ate: tecnico.bloqueado_ate,
      });
    }

    const ok = await tecnico.matchSenha(senha);
    if (!ok) {
      tecnico.tentativas_falhas += 1;
      if (tecnico.tentativas_falhas >= MAX_TENTATIVAS) {
        tecnico.bloqueado_ate = new Date(Date.now() + BLOQUEIO_MINUTOS * 60 * 1000);
        tecnico.tentativas_falhas = 0;
      }
      await tecnico.save();
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    tecnico.tentativas_falhas = 0;
    tecnico.bloqueado_ate = null;
    await tecnico.save();

    res.json({
      tecnico_id: tecnico._id,
      nome: tecnico.nome,
      equipe_id: tecnico.equipe_id,
      precisa_redefinir: !tecnico.senha_redefinida,
      precisa_assinatura: !tecnico.assinatura_definida,
      assinatura_definida: tecnico.assinatura_definida,
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
    const tecnico = await Tecnico.findById(id);
    if (!tecnico || !tecnico.ativo || tecnico.is_assistente) {
      return res.status(404).json({ message: "Técnico não encontrado" });
    }

    const ok = await tecnico.matchSenha(senha_atual);
    if (!ok) {
      return res.status(401).json({ message: "Senha atual inválida" });
    }

    tecnico.senha_hash = nova_senha;
    tecnico.senha_redefinida = true;
    await tecnico.save();

    res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    res.status(500).json({ message: "Erro ao redefinir senha", error: err.message });
  }
};

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
    const tecnico = await Tecnico.findById(id);
    if (!tecnico || !tecnico.ativo || tecnico.is_assistente) {
      return res.status(404).json({ message: "Técnico não encontrado" });
    }

    const senha = req.body.senha;
    if (!senha || !(await tecnico.matchSenha(senha))) {
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

    if (tecnico.assinatura_public_id) {
      await destroyCloudinaryAsset(tecnico.assinatura_public_id);
    } else if (tecnico.assinatura_path && !/^https?:\/\//i.test(tecnico.assinatura_path)) {
      const abs = path.resolve(tecnico.assinatura_path);
      if (abs.startsWith(assinaturasDir) && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }

    const publicId = `tec-${id}-${Date.now()}`;
    const result = await uploadBufferToCloudinary(buf, {
      folder: CLOUDINARY_FOLDER,
      public_id: publicId,
    });

    tecnico.assinatura_path = result.secure_url;
    tecnico.assinatura_public_id = result.public_id;
    tecnico.assinatura_definida = true;
    await tecnico.save();

    res.json({
      message: "Assinatura salva",
      assinatura_path: tecnico.assinatura_path,
    });
  } catch (err) {
    console.error("[tecnico] uploadAssinatura:", err);
    res.status(500).json({ message: "Erro ao salvar assinatura", error: err.message });
  }
};

export const getAssinatura = async (req, res) => {
  const { id } = req.params;
  try {
    const tecnico = await Tecnico.findById(id).select("assinatura_path");
    if (!tecnico || !tecnico.assinatura_path) {
      return res.status(404).json({ message: "Assinatura não encontrada" });
    }
    if (/^https?:\/\//i.test(tecnico.assinatura_path)) {
      return res.redirect(tecnico.assinatura_path);
    }
    const abs = path.resolve(tecnico.assinatura_path);
    if (!abs.startsWith(assinaturasDir) || !fs.existsSync(abs)) {
      return res.status(404).json({ message: "Arquivo ausente" });
    }
    res.sendFile(abs);
  } catch (err) {
    res.status(500).json({ message: "Erro", error: err.message });
  }
};
