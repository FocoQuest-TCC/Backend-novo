const express = require("express");
const userControllers = require("./Controllers/userControllers.js");
const guildControllers = require("./Controllers/guildControllers.js");
const { authenticate, sameUser } = require("./middleware/auth.js");

const routes = express.Router();

routes.post("/login", userControllers.login);
routes.post("/users", userControllers.createUser);
routes.post("/auth/google", userControllers.googleAuth);

routes.use(authenticate);
routes.get("/guild", guildControllers.getGuild);
routes.post("/guild", guildControllers.createGuild);
routes.post("/guild/join", guildControllers.joinGuild);
routes.patch("/guild/members/:userId/role", guildControllers.updateMemberRole);
routes.delete("/guild/members/:userId", guildControllers.removeMember);
routes.post("/guild/boards", guildControllers.createBoard);
routes.post("/guild/boards/:boardId/finish", guildControllers.finishBoard);
routes.delete("/guild/boards/:boardId", guildControllers.deleteBoard);
routes.post("/guild/boards/:boardId/tasks", guildControllers.createTask);
routes.patch("/guild/tasks/:taskId/completion", guildControllers.setTaskCompletion);
routes.patch("/guild/tasks/:taskId/column", guildControllers.moveTask);
routes.delete("/guild/tasks/:taskId", guildControllers.deleteTask);
routes.get("/users", userControllers.getAllUsers);
routes.get("/users/:id", userControllers.getUserById);
routes.put("/users/:id", sameUser, userControllers.updateUser);
routes.patch("/users/:id/character", sameUser, userControllers.updateCharacter);
routes.delete("/users/:id", sameUser, userControllers.deleteUser);
routes.get("/users/:id/data", sameUser, userControllers.getUserData);
routes.patch("/users/:id/data", sameUser, userControllers.updateUserData);
routes.put("/users/:id/data", sameUser, userControllers.updateUserData);

module.exports = routes;