# Backend FocoQuest

## Executar localmente

1. Instale as dependências com `npm install`.
2. Crie o arquivo `.env` nesta pasta usando `.env.example` como referência.
3. Configure um banco PostgreSQL. Você pode usar uma instância local ou preencher `DATABASE_URL` com a URL de um banco existente.
4. Inicie a API com `npm start` (ou `npm run bd`, mantido por compatibilidade).

A API fica disponível em `http://localhost:6900`; verifique a conexão em `http://localhost:6900/health`. Na primeira inicialização, o backend cria/alinha as tabelas necessárias.

Por padrão, o CORS permite o frontend em `http://localhost:5173` e `http://127.0.0.1:5173`. Para publicar novamente, defina `CORS_ORIGIN` no ambiente do backend com a origem do frontend publicado. Se houver mais de uma origem, separe-as por vírgula.