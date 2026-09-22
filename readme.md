# Backend FocoQuest

API Express/Knex/PostgreSQL responsável por autenticação e persistência dos dados do jogador.

## Configuração

Crie um arquivo `.env` nesta pasta com as credenciais do PostgreSQL:

```env
DATABASE_URL=postgresql://usuario:senha@host.neon.tech/neondb?sslmode=require
PG_HOST=localhost
PG_DATABASE=focoquest
PG_USER=postgres
PG_PASSWORD=sua_senha
PG_SSL=false
PORT=6900
JWT_SECRET=troque-por-uma-chave-longa-e-secreta
```

Use `PG_SSL=true` quando o provedor do banco exigir conexão SSL.
No Neon, prefira `DATABASE_URL`, usando a connection string copiada no painel do projeto.

## Executar

```bash
npm install
npm run migrate
npm run bd
```

`npm run migrate` adiciona a coluna `users.app_data` como `jsonb`. Execute-a uma vez antes de iniciar uma versão que use a sincronização. O `JWT_SECRET` deve ser uma chave longa e exclusiva em produção.

O frontend espera a API em `http://localhost:6900`. Para usar outra URL, defina `VITE_API_URL` no frontend.

## Autenticação e segurança

- `POST /users` recebe a senha original somente no request e grava apenas um hash bcrypt com 12 rounds. A senha nunca é devolvida pela API.
- `POST /login` usa `bcrypt.compare`, devolve um JWT com validade de 7 dias e o usuário sem a senha.
- Contas antigas que ainda tenham senha em texto puro são migradas para bcrypt automaticamente no primeiro login válido.
- O middleware `src/middleware/auth.js` exige `Authorization: Bearer <token>` nas rotas protegidas e impede que um token acesse o `id` de outro usuário.

## Dados persistidos

`GET /users/:id/data` e `PUT /users/:id/data` trabalham com um snapshot JSON no campo `app_data`:

```json
{
	"tasks": [],
	"habits": [],
	"boards": [],
	"kanbanTasks": [],
	"inventory": [],
	"gold": 0,
	"gems": 0
}
```

Depois do login, o frontend salva o token em `localStorage`, carrega o snapshot do usuário e envia atualizações quando tarefas, hábitos, Kanban, inventário ou moedas mudam. O `localStorage` continua sendo um cache separado por `UserID`; a fonte compartilhável entre dispositivos é o PostgreSQL.

Endpoints principais: `POST /users` para cadastro, `POST /login` para login e `GET /users` para listar usuários.
