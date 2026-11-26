const { randomBytes } = require("crypto");
const knex = require("../database/index.js");

const BOSS_IDS = ["monstroAreia", "tempoPerdido"];
const EXPERIENCE_PER_QUEST = 225;

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

async function guildSnapshot(membership, debugDate) {
    await applyOverdueTaskPenalties(membership.guildId, debugDate);

    await knex("guild_boards")
        .where("guild_id", membership.guildId)
        .where((query) => query.whereNull("boss_id").orWhere("boss_id", ""))
        .update({
            boss_id: knex.raw("CASE WHEN random() < 0.5 THEN 'monstroAreia' ELSE 'tempoPerdido' END"),
        });

    const membershipRows = await knex("guild_memberships")
        .join("users", "guild_memberships.user_id", "users.UserID")
        .select(
            "guild_memberships.user_id as userId",
            "users.name",
            "users.character_id as characterId",
            "guild_memberships.role",
            "users.experience",
            "guild_memberships.contribution_xp as contributionXP"
        )
        .where("guild_memberships.guild_id", membership.guildId)
        .orderBy("users.name");
    const members = membershipRows.map((member) => ({
        ...member,
        experience: Number(member.experience) || 0,
        contributionXP: Number(member.contributionXP) || 0,
    }));

    const boards = await knex("guild_boards")
        .select("id", "name", "boss_id as bossId", "closed_at as closedAt")
        .where("guild_id", membership.guildId)
        .orderBy("id");

    const tasks = await knex("guild_tasks")
        .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
        .select(
            "guild_tasks.id",
            "guild_tasks.board_id as boardId",
            "guild_tasks.text",
            "guild_tasks.column",
            "guild_tasks.boss_damage as bossDamage",
            "guild_tasks.due_date as dueDate"
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
                "users.name",
                "users.character_id as characterId"
            )
            .whereIn("guild_task_assignees.task_id", tasks.map((task) => task.id))
            .orderBy("users.name")
        : [];

    const tasksWithAssignees = tasks.map((task) => {
        const taskAssignees = assignees
            .filter((assignee) => assignee.taskId === task.id)
            .map(({ userId, name, characterId, completed }) => ({
                userId,
                name,
                characterId,
                completed,
            }));
        const allCompleted = taskAssignees.length > 0
            && taskAssignees.every((assignee) => assignee.completed);

        return {
            ...task,
            assignees: taskAssignees,
            column: allCompleted ? "done" : task.column,
        };
    });

    const boardsWithBossHealth = boards.map((board) => {
        const boardTasks = tasksWithAssignees.filter((task) => task.boardId === board.id);
        return {
            ...board,
            bossMaxHealth: boardTasks.reduce((total, task) => total + Number(task.bossDamage), 0),
            bossHealth: boardTasks
                .filter((task) => task.column !== "done")
                .reduce((total, task) => total + Number(task.bossDamage), 0),
        };
    });

    return {
        id: membership.guildId,
        name: membership.name,
        code: membership.code,
        members,
        boards: boardsWithBossHealth,
        tasks: tasksWithAssignees,
    };
}

function xpForNextLevel(experience) {
    let remaining = Math.max(0, Number(experience) || 0);
    let level = 1;
    let required = 75;
    while (remaining >= required) {
        remaining -= required;
        level += 1;
        required = Math.floor(75 * level);
    }
    return required;
}

function daysBetween(start, end) {
    const startDate = start instanceof Date ? start.toISOString().slice(0, 10) : start;
    return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
}

function todayInBrazil() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${date.year}-${date.month}-${date.day}`;
}

function isValidISODate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function applyOverdueTaskPenalties(guildId, debugDate) {
    const today = isValidISODate(debugDate) ? debugDate : todayInBrazil();
    await knex.transaction(async (transaction) => {
        const tasks = await transaction("guild_tasks")
            .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
            .select(
                "guild_tasks.id",
                "guild_tasks.due_date as dueDate",
                "guild_tasks.penalty_days_applied as penaltyDaysApplied",
            )
            .where("guild_boards.guild_id", guildId)
            .whereNull("guild_boards.closed_at")
            .whereNotNull("guild_tasks.due_date")
            .where("guild_tasks.due_date", "<", today)
            .forUpdate("guild_tasks");

        for (const task of tasks) {
            const overdueDays = Math.max(0, daysBetween(task.dueDate, today));
            const appliedDays = Number(task.penaltyDaysApplied) || 0;
            if (overdueDays <= appliedDays) continue;

            const assignments = await transaction("guild_task_assignees")
                .select("user_id as userId", "completed")
                .where({ task_id: task.id });
            if (assignments.length > 0 && assignments.every((assignment) => assignment.completed)) continue;

            const assignmentsByUserId = new Map(
                assignments.map((assignment) => [Number(assignment.userId), assignment])
            );
            const guildMembers = await transaction("guild_memberships")
                .join("users", "guild_memberships.user_id", "users.UserID")
                .select(
                    "guild_memberships.user_id as userId",
                    "users.experience",
                )
                .where("guild_memberships.guild_id", guildId);

            for (const member of guildMembers) {
                const assignment = assignmentsByUserId.get(Number(member.userId));
                if (assignment?.completed) continue;
                let experience = Number(member.experience) || 0;
                for (let day = appliedDays + 1; day <= overdueDays; day += 1) {
                    const percentage = assignment
                        ? (day === 1 ? 0.5 : 0.1)
                        : 0.05;
                    const penalty = Math.floor(xpForNextLevel(experience) * percentage);
                    if (penalty > 0) {
                        experience = Math.max(0, experience - penalty);
                        await transaction("users")
                            .where("UserID", member.userId)
                            .update({ experience });
                    }
                }
            }
            await transaction("guild_tasks")
                .where({ id: task.id })
                .update({ penalty_days_applied: overdueDays });
        }
    });
}

function normalizeName(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

module.exports = {
    async getGuild(req, res) {
        try {
            const membership = await getMembership(Number(req.auth.userId));
            if (!membership) return res.status(200).send({ guild: null });
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
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
                }, req.query.debugDate),
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
                }, req.query.debugDate),
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
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
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
                guild: await guildSnapshot(membership, req.query.debugDate),
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
            const bossId = BOSS_IDS[Math.floor(Math.random() * BOSS_IDS.length)];
            await knex("guild_boards").insert({ guild_id: membership.guildId, name, boss_id: bossId });
            return res.status(201).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
        } catch (error) {
            return databaseError(res, "criar o quadro", error);
        }
    },

    async finishBoard(req, res) {
        const boardId = Number(req.params.boardId);
        if (!Number.isSafeInteger(boardId) || boardId <= 0) {
            return res.status(400).send({ message: "Quadro inválido" });
        }

        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;

            const result = await knex.transaction(async (transaction) => {
                const board = await transaction("guild_boards")
                    .where({ id: boardId, guild_id: membership.guildId })
                    .forUpdate()
                    .first();
                if (!board) return { status: "missing" };
                if (board.closed_at) return { status: "closed" };

                const tasks = await transaction("guild_tasks")
                    .select("id")
                    .where({ board_id: boardId });
                if (!tasks.length) return { status: "empty" };

                const assignees = await transaction("guild_task_assignees")
                    .select("task_id", "user_id", "completed")
                    .whereIn("task_id", tasks.map((task) => task.id));
                const assignmentsByTask = new Map();
                for (const assignee of assignees) {
                    const taskAssignments = assignmentsByTask.get(assignee.task_id) || [];
                    taskAssignments.push(assignee);
                    assignmentsByTask.set(assignee.task_id, taskAssignments);
                }

                if (tasks.some((task) => {
                    const taskAssignments = assignmentsByTask.get(task.id) || [];
                    return !taskAssignments.length || taskAssignments.some((assignee) => !assignee.completed);
                })) {
                    return { status: "incomplete" };
                }

                const questCounts = new Map();
                for (const assignee of assignees) {
                    questCounts.set(
                        assignee.user_id,
                        (questCounts.get(assignee.user_id) || 0) + 1,
                    );
                }
                for (const [userId, completedQuestCount] of questCounts) {
                    await transaction("users")
                        .where({ UserID: userId })
                        .increment("experience", completedQuestCount * EXPERIENCE_PER_QUEST);
                    await transaction("guild_memberships")
                        .where({ guild_id: membership.guildId, user_id: userId })
                        .increment("contribution_xp", completedQuestCount * EXPERIENCE_PER_QUEST);
                }

                await transaction("guild_boards")
                    .where({ id: boardId })
                    .update({ closed_at: transaction.fn.now() });
                return {
                    status: "finished",
                    questCount: tasks.length,
                    totalExperience: [...questCounts.values()].reduce(
                        (total, count) => total + count * EXPERIENCE_PER_QUEST,
                        0,
                    ),
                };
            });

            if (result.status === "missing") return res.status(404).send({ message: "Quadro não encontrado" });
            if (result.status === "closed") return res.status(409).send({ message: "Esse quadro já foi finalizado" });
            if (result.status === "empty") {
                return res.status(409).send({ message: "Adicione ao menos uma quest antes de finalizar o quadro" });
            }
            if (result.status === "incomplete") {
                return res.status(409).send({ message: "Conclua todas as quests antes de finalizar o quadro" });
            }

            return res.status(200).send({
                guild: await guildSnapshot(membership, req.query.debugDate),
                message: `Boss derrotado! ${result.totalExperience} XP distribuídos por ${result.questCount} quests.`,
            });
        } catch (error) {
            return databaseError(res, "finalizar o quadro", error);
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
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
        } catch (error) {
            return databaseError(res, "excluir o quadro", error);
        }
    },

    async createTask(req, res) {
        const text = normalizeName(req.body?.text, 240);
        const dueDate = typeof req.body?.dueDate === "string" ? req.body.dueDate : "";
        const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
            ? new Date(`${dueDate}T00:00:00Z`)
            : null;
        const boardId = Number(req.params.boardId);
        const assigneeIds = req.body?.assigneeIds;
        if (!Number.isSafeInteger(boardId) || boardId <= 0 || !text) {
            return res.status(400).send({ message: "Informe um título válido para a tarefa" });
        }
        if (!parsedDueDate || Number.isNaN(parsedDueDate.getTime())
            || parsedDueDate.toISOString().slice(0, 10) !== dueDate) {
            return res.status(400).send({ message: "Informe um prazo válido para a tarefa" });
        }
        if (!Array.isArray(assigneeIds) || assigneeIds.length === 0
            || assigneeIds.some((id) => !Number.isSafeInteger(Number(id)))) {
            return res.status(400).send({ message: "Selecione pelo menos um membro responsável pela tarefa" });
        }

        const uniqueAssigneeIds = [...new Set(assigneeIds.map(Number))];
        try {
            const membership = await requireAdmin(req, res);
            if (!membership) return;

            const validMembers = await knex("guild_memberships")
                .where({ guild_id: membership.guildId })
                .whereIn("user_id", uniqueAssigneeIds)
                .count("user_id as count")
                .first();
            if (Number(validMembers.count) !== uniqueAssigneeIds.length) {
                return res.status(400).send({ message: "Todas as pessoas atribuídas devem pertencer à guilda" });
            }

            const result = await knex.transaction(async (transaction) => {
                const board = await transaction("guild_boards")
                    .where({ id: boardId, guild_id: membership.guildId })
                    .forUpdate()
                    .first();
                if (!board) return "missing";
                if (board.closed_at) return "closed";

                const [task] = await transaction("guild_tasks")
                    .insert({
                        board_id: board.id,
                        text,
                        due_date: dueDate,
                        boss_damage: Math.floor(Math.random() * 800000001) + 200000000,
                    })
                    .returning("id");
                const taskId = typeof task === "object" ? task.id : task;
                await transaction("guild_task_assignees").insert(
                    uniqueAssigneeIds.map((userId) => ({ task_id: taskId, user_id: userId }))
                );
                return "created";
            });

            if (result === "missing") return res.status(404).send({ message: "Quadro não encontrado" });
            if (result === "closed") return res.status(409).send({ message: "Não é possível adicionar quests a um quadro finalizado" });
            return res.status(201).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
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
            await applyOverdueTaskPenalties(membership.guildId, req.query.debugDate);
            const result = await knex.transaction(async (transaction) => {
                const task = await transaction("guild_tasks")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_tasks.id": taskId,
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_boards.id as boardId")
                .first();
                if (!task) return "missing";

                const board = await transaction("guild_boards")
                    .where({ id: task.boardId })
                    .forUpdate()
                    .first();
                if (board.closed_at) return "closed";

                const assignment = await transaction("guild_task_assignees")
                    .where({ task_id: taskId, user_id: Number(req.auth.userId) })
                    .first();
                if (!assignment) return "unassigned";

                await transaction("guild_task_assignees")
                    .where({ id: assignment.id })
                .update({
                    completed: req.body.completed,
                    completed_at: req.body.completed ? knex.fn.now() : null,
                });
                return "updated";
            });

            if (result === "missing") return res.status(404).send({ message: "Tarefa não encontrada" });
            if (result === "closed") return res.status(409).send({ message: "Esse quadro já foi finalizado" });
            if (result === "unassigned") {
                return res.status(403).send({ message: "Você não está atribuído a essa tarefa" });
            }
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
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
            const result = await knex.transaction(async (transaction) => {
                const task = await transaction("guild_tasks")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_tasks.id": taskId,
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_boards.id as boardId")
                .first();
                if (!task) return "missing";
                const board = await transaction("guild_boards")
                    .where({ id: task.boardId })
                    .forUpdate()
                    .first();
                if (board.closed_at) return "closed";
                await transaction("guild_tasks").where({ id: taskId }).update({ column });
                return "moved";
            });
            if (result === "missing") return res.status(404).send({ message: "Tarefa não encontrada" });
            if (result === "closed") return res.status(409).send({ message: "Esse quadro já foi finalizado" });
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
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
            const result = await knex.transaction(async (transaction) => {
                const task = await transaction("guild_tasks")
                .join("guild_boards", "guild_tasks.board_id", "guild_boards.id")
                .where({
                    "guild_tasks.id": taskId,
                    "guild_boards.guild_id": membership.guildId,
                })
                .select("guild_boards.id as boardId")
                .first();
                if (!task) return "missing";
                const board = await transaction("guild_boards")
                    .where({ id: task.boardId })
                    .forUpdate()
                    .first();
                if (board.closed_at) return "closed";
                await transaction("guild_tasks").where({ id: taskId }).del();
                return "deleted";
            });
            if (result === "missing") return res.status(404).send({ message: "Tarefa não encontrada" });
            if (result === "closed") {
                return res.status(409).send({ message: "Não é possível excluir quests de um quadro finalizado" });
            }
            return res.status(200).send({ guild: await guildSnapshot(membership, req.query.debugDate) });
        } catch (error) {
            return databaseError(res, "excluir a tarefa", error);
        }
    },
};
