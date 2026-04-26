import jwt from "jsonwebtoken";
import { Usuario } from "../models/Usuario.js";

export const protect = async (req, res, next) => {
  let token;

  // Extrair token do header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  // Verificar se token existe
  if (!token) {
    return res
      .status(401)
      .json({ message: "Não autorizado, token não encontrado" });
  }

  try {
    // Verificar validade do token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await Usuario.findById(decoded.id).select("-senha_hash");

    if (!req.user) {
      return res.status(401).json({ message: "Usuário não encontrado" });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Token inválido ou expirado" });
  }
};

export const admin = (req, res, next) => {
  if (req.user && req.user.tipo_usuario === "admin") {
    next();
  } else {
    return res
      .status(403)
      .json({ message: "Acesso negado. Rota somente para admins." });
  }
};
