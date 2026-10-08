const { randomBytes } = require("crypto");
const knex = require("../database/index.js");

function databaseError(res, action, error) {
    console.error(`Erro ao ${action}:`, error);
    return res.status(500).send({ message: `Erro ao ${action}` });
}

async function getMembership(userId, executor = knex) {
    return executor("guild_memberships")
        .join("guilds", "guild_memberships.guild_id", "guilds.id")
        .select(
            "guild_memberships.guild_id as guildId",
            "guild_memberships.user_id as userId",
            "guild_memberships.role",
            "guilds.name",
            "guilds.code",
            "guilds.created_by as createdBy"
        )
        .where("guild_memberships.user_id", userId)
        .first();
}

async function requireMembership(req, res) {
    const membership = await getMembership(Number(req.auth.userId));
    if (!membership) {
        res.status(404).send({ message: "Você ainda não está em uma guilda" });
        return null;
    }
    return membership;
}

async function requireAdmin(req, res) {
    const membership = await requireMembership(req, res);
    if (membership && membership.role !== "admin") {
        res.status(403).send({ message: "Apenas administradores podem realizar esta ação" });
        return null;
    }
    return membership;
}

async function guildSnapshot(membership) {
    const members = await knex("guild_memberships")
        .join("users", "guild_memberships.user_id", "users.UserID")
        .select(
            "guild_memberships.user_id as userId",
            "users.name",
            "guild_memberships.role"
        )
        .where("guild_memberships.guild_id", membership.guildId)
        .orderBy("users.name");

    const boards = await knex("guild_boards")
        .select("id", "name")
        .where("guild_id", membership.guildId)
        .orderBy("id");

    const tasks = await knex("guild_tasks")
        .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
        .select(
            "guild_tasks.id",
            "guild_tasks.board_id as boardId",
            "guild_tasks.text",
            "guild_tasks.column"
        )
        .where("guild_boards.guild_id", membership.guildId)
        .orderBy("guild_tasks.id");

    const assignees = tasks.length
        ? await knex("guild_task_assignees")
            .join("users", "guild_task_assignees.user_id", "users.UserID")
            .select(
                "guild_task_assignees.task_id as taskId",
                "guild_task_assignees.user_id as userId",
                "guild_task_assignees.completed",
                "users.name"
            )
            .whereIn("guild_task_assignees.task_id", tasks.map((task) => task.id))
            .orderBy("users.name")
        : [];

    const tasksWithAssignees = tasks.map((task) => {
        const taskAssignees = assignees
            .filter((assignee) => assignee.taskId === task.id)
            .map(({ userId, name, completed }) => ({ userId, name, completed }));
        const allCompleted = taskAssignees.length > 0
            && taskAssignees.every((assignee) => assignee.completed);

        return {
            ...task,
            assignees: taskAssignees,
            column: allCompleted ? "done" : task.column,
        };
    });

    return {
        id: membership.guildId,
        name: membership.name,
        code: membership.code,
        members,
        boards,
        tasks: tasksWithAssignees,
    };
}

function normalizeName(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

module.exports = {
    async getGuild(req, res) {
        try {
            const membership = await getMembership(Number(req.auth.userId));
            if (!membership) return res.status(200).send({ guild: null });
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "carregar a guilda", error);
        }
    },

    async createGuild(req, res) {
        const name = normalizeName(req.body?.name, 80);
        if (!name) return res.status(400).send({ message: "Informe o nome da guilda" });

        try {
            if (await getMembership(Number(req.auth.userId))) {
                return res.status(409).send({ message: "Você já participa de uma guilda" });
            }

            const guild = await knex.transaction(async (transaction) => {
                let code;
                let exists;
                do {
                    code = randomBytes(5).toString("hex").toUpperCase();
                    exists = await transaction("guilds").where({ code }).first();
                } while (exists);

                const [created] = await transaction("guilds")
                    .insert({ name, code, created_by: Number(req.auth.userId) })
                    .returning(["id", "name", "code"]);
                await transaction("guild_memberships").insert({
                    guild_id: created.id,
                    user_id: Number(req.auth.userId),
                    role: "admin",
                });
                return created;
            });

            return res.status(201).send({
                guild: await guildSnapshot({
                    guildId: guild.id,
                    name: guild.name,
                    code: guild.code,
                }),
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).send({ message: "Você já participa de uma guilda" });
            }
            return databaseError(res, "criar a guilda", error);
        }
    },

    async joinGuild(req, res) {
        const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
        if (!/^[A-F0-9]{10}$/.test(code)) {
            return res.status(400).send({ message: "O código da guilda é inválido" });
        }

        try {
            const existingMembership = await getMembership(Number(req.auth.userId));
            if (existingMembership) {
                return res.status(409).send({ message: "Você já participa de uma guilda" });
            }

            const guild = await knex("guilds").where({ code }).first();
            if (!guild) return res.status(404).send({ message: "Nenhuma guilda foi encontrada com esse código" });

            await knex("guild_memberships").insert({
                guild_id: guild.id,
                user_id: Number(req.auth.userId),
                role: "member",
            });
            return res.status(200).send({
                guild: await guildSnapshot({
                    guildId: guild.id,
                    name: guild.name,
                    code: guild.code,
                }),
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).send({ message: "Você já participa de uma guilda" });
            }
            return databaseError(res, "entrar na guilda", error);
        }
    },

    async updateMemberRole(req, res) {
        const role = req.body?.role;
        const targetUserId = Number(req.params.userId);
        if (!Number.isSafeInteger(targetUserId) || !["admin", "member"].includes(role)) {
            return res.status(400).send({ message: "Membro ou permissão inválidos" });
        }

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;

            const result = await knex.transaction(async (transaction) => {
                await transaction("guilds")
                    .where({ id: membership.guildId })
                    .forUpdate()
                    .first();
                const target = await transaction("guild_memberships")
                    .where({ guild_id: membership.guildId, user_id: targetUserId })
                    .forUpdate()
                    .first();
                if (!target) return "missing";

                if (target.role === "admin" && role === "member") {
                    const admins = await transaction("guild_memberships")
                        .where({ guild_id: membership.guildId, role: "admin" })
                        .count("id as count")
                        .first();
                    if (Number(admins.count) <= 1) return "last-admin";
                }

                await transaction("guild_memberships")
                    .where({ guild_id: membership.guildId, user_id: targetUserId })
                    .update({ role });
                return "updated";
            });

            if (result === "missing") return res.status(404).send({ message: "Membro não encontrado" });
            if (result === "last-admin") {
                return res.status(409).send({ message: "A guilda precisa ter pelo menos um administrador" });
            }
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "alterar a permissão do membro", error);
        }
    },

    async removeMember(req, res) {
        const targetUserId = Number(req.params.userId);
        if (!Number.isSafeInteger(targetUserId)) {
            return res.status(400).send({ message: "Membro inválido" });
        }

        try {
            const membership = await requireMembership(req, res);
            if (!membership) return;

            const isSelf = targetUserId === Number(req.auth.userId);
            if (!isSelf && membership.role !== "admin") {
                return res.status(403).send({ message: "Apenas administradores podem remover outros membros" });
            }

            const result = await knex.transaction(async (transaction) => {
                await transaction("guilds")
                    .where({ id: membership.guildId })
                    .forUpdate()
                    .first();
                const target = await transaction("guild_memberships")
                    .where({ guild_id: membership.guildId, user_id: targetUserId })
                    .forUpdate()
                    .first();
                if (!target) return "missing";

                if (target.role === "admin") {
                    const admins = await transaction("guild_memberships")
                        .where({ guild_id: membership.guildId, role: "admin" })
                        .count("id as count")
                        .first();
                    if (Number(admins.count) <= 1) return "last-admin";
                }

                await transaction("guild_memberships")
                    .where({ guild_id: membership.guildId, user_id: targetUserId })
                    .del();
                return "removed";
            });

            if (result === "missing") return res.status(404).send({ message: "Membro não encontrado" });
            if (result === "last-admin") {
                return res.status(409).send({ message: "Promova outro administrador antes de sair da guilda" });
            }
            if (isSelf) {
                return res.status(200).send({ guild: null, message: "Você saiu da guilda" });
            }
            return res.status(200).send({
                guild: await guildSnapshot(membership),
                message: "Membro removido da guilda",
            });
        } catch (error) {
            return databaseError(res, "remover o membro da guilda", error);
        }
    },

    async createBoard(req, res) {
        const name = normalizeName(req.body?.name, 100);
        if (!name) return res.status(400).send({ message: "Informe o nome do quadro" });

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;
            await knex("guild_boards").insert({ guild_id: membership.guildId, name });
            return res.status(201).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "criar o quadro", error);
        }
    },

    async deleteBoard(req, res) {
        const boardId = Number(req.params.boardId);
        if (!Number.isSafeInteger(boardId) || boardId <= 0) {
            return res.status(400).send({ message: "Quadro inválido" });
        }

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;
            const deleted = await knex("guild_boards")
                .where({ id: boardId, guild_id: membership.guildId })
                .del();
            if (!deleted) return res.status(404).send({ message: "Quadro não encontrado" });
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "excluir o quadro", error);
        }
    },

    async createTask(req, res) {
        const text = normalizeName(req.body?.text, 240);
        const boardId = Number(req.params.boardId);
        const assigneeIds = req.body?.assigneeIds;
        if (!Number.isSafeInteger(boardId) || boardId <= 0 || !text
            || !Array.isArray(assigneeIds) || assigneeIds.length === 0
            || assigneeIds.some((id) => !Number.isSafeInteger(Number(id)))) {
            return res.status(400).send({ message: "Informe o título e pelo menos um membro responsável" });
        }

        const uniqueAssigneeIds = [...new Set(assigneeIds.map(Number))];
        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;

            const board = await knex("guild_boards")
                .where({ id: boardId, guild_id: membership.guildId })
                .first();
            if (!board) return res.status(404).send({ message: "Quadro não encontrado" });

            const validMembers = await knex("guild_memberships")
                .where({ guild_id: membership.guildId })
                .whereIn("user_id", uniqueAssigneeIds)
                .count("user_id as count")
                .first();
            if (Number(validMembers.count) !== uniqueAssigneeIds.length) {
                return res.status(400).send({ message: "Todas as pessoas atribuídas devem pertencer à guilda" });
            }

            await knex.transaction(async (transaction) => {
                const [task] = await transaction("guild_tasks")
                    .insert({ board_id: board.id, text })
                    .returning("id");
                const taskId = typeof task === "object" ? task.id : task;
                await transaction("guild_task_assignees").insert(
                    uniqueAssigneeIds.map((userId) => ({ task_id: taskId, user_id: userId }))
                );
            });

            return res.status(201).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "criar a tarefa", error);
        }
    },

    async setTaskCompletion(req, res) {
        const taskId = Number(req.params.taskId);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) {
            return res.status(400).send({ message: "Tarefa inválida" });
        }
        if (typeof req.body?.completed !== "boolean") {
            return res.status(400).send({ message: "O estado de conclusão é inválido" });
        }

        try {
            const membership = await requireMembership(req, res);
            if (!membership) return;
            const assignment = await knex("guild_task_assignees")
                .join("guild_tasks", "guild_task_assignees.task_id", "guild_tasks.id")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_task_assignees.task_id": taskId,
                    "guild_task_assignees.user_id": Number(req.auth.userId),
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_task_assignees.id")
                .first();
            if (!assignment) {
                return res.status(403).send({ message: "Você não está atribuído a essa tarefa" });
            }

            await knex("guild_task_assignees")
                .where({ id: assignment.id })
                .update({
                    completed: req.body.completed,
                    completed_at: req.body.completed ? knex.fn.now() : null,
                });
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "atualizar a conclusão da tarefa", error);
        }
    },

    async moveTask(req, res) {
        const taskId = Number(req.params.taskId);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) {
            return res.status(400).send({ message: "Tarefa inválida" });
        }
        const column = req.body?.column;
        if (!["todo", "doing"].includes(column)) {
            return res.status(400).send({ message: "Coluna inválida" });
        }

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;
            const task = await knex("guild_tasks")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_tasks.id": taskId,
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_tasks.id")
                .first();
            if (!task) return res.status(404).send({ message: "Tarefa não encontrada" });
            await knex("guild_tasks").where({ id: taskId }).update({ column });
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "mover a tarefa", error);
        }
    },

    async deleteTask(req, res) {
        const taskId = Number(req.params.taskId);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) {
            return res.status(400).send({ message: "Tarefa inválida" });
        }

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;
            const task = await knex("guild_tasks")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_tasks.id": taskId,
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_tasks.id")
                .first();
            if (!task) return res.status(404).send({ message: "Tarefa não encontrada" });
            await knex("guild_tasks").where({ id: taskId }).del();
            return res.status(200).send({ guild: await guildSnapshot(membership) });
        } catch (error) {
            return databaseError(res, "excluir a tarefa", error);
        }
    },
};
