#!/bin/bash

# ========================================
# Script de Verificação Pré-Deploy
# ========================================

echo "🔍 Checklist de Deploy do Backend"
echo "=================================="

# Verificar Node version
echo ""
echo "✓ Verificando Node.js..."
node --version

# Verificar se package.json tem script start
echo ""
echo "✓ Verificando package.json..."
if grep -q '"start"' package.json; then
  echo "  ✅ Script 'start' encontrado"
else
  echo "  ❌ Script 'start' não encontrado"
fi

# Verificar se .env.production existe
echo ""
echo "✓ Verificando arquivos de ambiente..."
if [ -f ".env.production" ]; then
  echo "  ✅ .env.production existe"
else
  echo "  ❌ .env.production não encontrado"
fi

# Verificar se .gitignore está configurado
echo ""
echo "✓ Verificando .gitignore..."
if grep -q ".env" .gitignore; then
  echo "  ✅ .env está no .gitignore"
else
  echo "  ❌ .env não está no .gitignore"
fi

# Verificar dependências críticas
echo ""
echo "✓ Verificando dependências críticas..."
REQUIRED_PACKAGES=("express" "mongoose" "dotenv" "cors" "jsonwebtoken")
for package in "${REQUIRED_PACKAGES[@]}"; do
  if grep -q "\"$package\"" package.json; then
    echo "  ✅ $package encontrado"
  else
    echo "  ❌ $package não encontrado"
  fi
done

# Verificar conexão com MongoDB
echo ""
echo "✓ Verificando conexão com MongoDB..."
if grep -q "MONGO_URI" .env.production; then
  echo "  ✅ MONGO_URI configurado"
else
  echo "  ❌ MONGO_URI não configurado"
fi

echo ""
echo "=================================="
echo "✅ Checklist completo!"
echo ""
echo "Próximos passos:"
echo "1. Fazer commit: git add . && git commit -m 'Deploy prep'"
echo "2. Fazer push: git push origin main"
echo "3. Acessar Render e criar novo Web Service"
echo "4. Adicionar variáveis de ambiente conforme .env.production"
