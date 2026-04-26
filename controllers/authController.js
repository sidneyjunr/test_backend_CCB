import jwt from "jsonwebtoken";
import { Usuario } from "../models/Usuario.js";


//isso aqui gera o token jwt
const generateToken = (id, tipo_usuario) => {
  return jwt.sign({ id, tipo_usuario }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

// Gera um novo token a partir de um já válido. Usado pela tela de
// registro de eventos da súmula que pode permanecer aberta por horas
// e precisa renovar o token periodicamente para evitar 401 em meio
// ao jogo (B.7 — operações de mesário não podem ser interrompidas).
export const refreshToken = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Não autorizado" });
    }
    const token = generateToken(req.user._id, req.user.tipo_usuario);
    res.json({
      _id: req.user._id,
      nome: req.user.nome,
      email: req.user.email,
      tipo_usuario: req.user.tipo_usuario,
      token,
    });
  } catch (err) {
    console.error("[auth] Erro no refresh:", err);
    res.status(500).json({ message: "Erro ao renovar token" });
  }
};


//Logida de Login 

export const loginUsuario = async(req, res)=>{
    const {email,senha} = req.body

    try{
        const usuario = await Usuario.findOne({email})

        if(usuario && (await usuario.matchPassword(senha))){
            res.json({
                _id: usuario._id,
                nome: usuario.nome,
                email: usuario.email,
                tipo_usuario: usuario.tipo_usuario,
                token: generateToken(usuario._id, usuario.tipo_usuario)
            

            })
        }else{
            res.status(401).json({message: 'Email ou Senha inválidos'})
        }
    }catch(err){
        console.error('[auth] Erro no login:', err);
        res.status(500).json({message: 'Erro no Servidor'})

    }

}