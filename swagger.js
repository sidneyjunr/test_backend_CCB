import swaggerJSDoc from 'swagger-jsdoc';

const serverUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API CCB - Copa Cearense de Basquete',
      version: '1.0.0',
      description: 'Documentação oficial das rotas do sistema de gestão da CCB. Aqui podes testar o login, a criação de competições e a inscrição de atletas.',
    },
    servers: [
      {
        url: serverUrl,
        description: process.env.NODE_ENV === 'production' ? 'Servidor de Produção' : 'Servidor Local',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  // O Swagger vai procurar por comentários JSDoc nestes ficheiros para montar a doc
  apis: ['./routes/*.js'], 
};

export const specs = swaggerJSDoc(options);