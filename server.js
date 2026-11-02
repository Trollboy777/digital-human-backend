import "dotenv/config";
import express from "express";
import db from "./database.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { authenticateToken } from "./middleware/auth.js";

const app = express();
const port = process.env.PORT || 8000;
const ollamaUrl =
    process.env.OLLAMA_URL || "http://localhost:11434";
const jwtSecret = process.env.JWT_SECRET;


const systemMessage = {
    role: "system",
    content:
        "Je bent een behulpzame Digital Human. Antwoord duidelijk en in het Nederlands."
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/", (req, res) => {
    res.status(200).json({
        status: 200,
        message: "Digital Human is active!"
    });
});

app.post("/register", async (req, res) => {
    try {
        const { name, last_name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof last_name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !last_name.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Vul alle verplichte velden in."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (
            normalizedEmail.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
            return res.status(400).json({
                message: "Vul een geldig e-mailadres in."
            });
        }



        const existingUser = db.prepare(`
            SELECT id
            FROM users
            WHERE email = ?
        `).get(normalizedEmail);

        if (existingUser) {
            return res.status(409).json({
                message: "Er bestaat al een account met dit e-mailadres."
            });
        }


        const passwordHash = await bcrypt.hash(password, 12);
        const userId = randomUUID();

        db.prepare(`
            INSERT INTO users (
                id,
                name,
                last_name,
                email,
                password_hash
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            userId,
            name.trim(),
            last_name.trim(),
            normalizedEmail,
            passwordHash
        );

        const token = jwt.sign(
            { sub: userId },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
        );

        return res.status(201).json({
            message: "Account succesvol aangemaakt.",
            token,
            user: {
                id: userId,
                name: name.trim(),
                last_name: last_name.trim(),
                email: normalizedEmail,
            }
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                message: "Er bestaat al een account met dit e-mailadres."
            });
        }

        console.error("Registratiefout:", error);

        return res.status(500).json({
            message: "Er ging iets mis bij het aanmaken van het account."
        });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Vul je e-mailadres en wachtwoord in."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();


        const user = db.prepare(`
            SELECT id, name, last_name, email, password_hash
            FROM users
            WHERE email = ?
        `).get(normalizedEmail);

        if (!user) {
            return res.status(401).json({
                message: "E-mailadres of wachtwoord is onjuist."
            });
        }


        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "E-mailadres of wachtwoord is onjuist."
            });
        }

        const token = jwt.sign(
            { sub: user.id },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
        );

        return res.status(200).json({
            message: "Succesvol ingelogd.",
            token,
            user: {
                id: user.id,
                name: user.name,
                last_name: user.last_name,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Loginfout:", error);

        return res.status(500).json({
            message: "Er ging iets mis bij het inloggen."
        });
    }
});

app.post("/chat", authenticateToken, async (req, res) => {
    let userMessageId;

    try {
        const userId = req.user.id;
        const { conversationId, message } = req.body;

        if (!conversationId || typeof conversationId !== "string") {
            return res.status(400).json({
                status: 400,
                message: "A valid conversation id is required"
            })
        }

        if (!message || typeof message !== "string") {
            return res.status(400).json({
                status: 400,
                message: "A valid message is required"
            });
        }

        let conversation = db.prepare(`
            SELECT id
            FROM conversations
            WHERE id = ? AND user_id = ?
        `).get(conversationId, userId);


        if (!conversation) {
            const existingConversation = db.prepare(`
                SELECT id
                FROM conversations
                WHERE id = ?
            `).get(conversationId);

            if (existingConversation) {
                return res.status(403).json({
                    status: 403,
                    message: "Conversation does not belong to this user"
                });
            }

            db.prepare(`
                INSERT INTO conversations (id, user_id)
                VALUES (?, ?)
            `).run(conversationId, userId);
        }


        const insertUserMessage = db.prepare(`
            INSERT INTO messages (conversation_id, role, content)
            VALUES (?, 'user', ?)
        `);

        const insertResult = insertUserMessage.run(
            conversationId,
            message
        );

        userMessageId = Number(insertResult.lastInsertRowid);


        const history = db.prepare(`
            SELECT role, content
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
        `).all(conversationId);

        const payload = {
            model: "qwen3:8b",
            messages: [systemMessage, ...history],
            stream: false
        };

        const ollamaResponse = await fetch(
            `${ollamaUrl}/api/chat`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text();

            console.error(
                `Ollama returned status ${ollamaResponse.status}:`,
                errorText
            );


            db.prepare(`
                DELETE FROM messages WHERE id = ?
            `).run(userMessageId);

            return res.status(502).json({
                status: 502,
                message: "Ollama kon de aanvraag niet verwerken"
            });
        }

        const data = await ollamaResponse.json();
        const assistantMessage = data.message?.content;

        if (typeof assistantMessage !== "string") {
            db.prepare(`
                DELETE FROM messages WHERE id = ?
            `).run(userMessageId);

            return res.status(502).json({
                status: 502,
                message: "Ollama gaf geen geldig antwoord terug"
            });
        }


        db.prepare(`
            INSERT INTO messages (conversation_id, role, content)
            VALUES (?, 'assistant', ?)
        `).run(conversationId, assistantMessage);

        return res.status(200).json({
            status: 200,
            userId,
            conversationId,
            response: assistantMessage
        });

    } catch (error) {
        console.error("Backend error:", error);

        if (userMessageId !== undefined) {
            try {
                db.prepare(`
                    DELETE FROM messages WHERE id = ?
                `).run(userMessageId);
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
        }

        return res.status(500).json({
            status: 500,
            message: "Er ging iets mis met de backend"
        });
    }
});

app.get("/history/:userId/:conversationId",authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const conversation = db.prepare(`
        SELECT id
        FROM conversations
        WHERE id = ? AND user_id = ?
    `).get(conversationId, userId);

    if (!conversation) {
        return res.status(404).json({
            status: 404,
            message: "Conversation not found"
        });
    }

    const messages = db.prepare(`
        SELECT role, content
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC
    `).all(conversationId);

    return res.status(200).json({
        status: 200,
        userId,
        conversationId,
        history: [systemMessage, ...messages]
    });
});

app.delete("/history/:userId/:conversationId", authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const conversation = db.prepare(`
        SELECT id
        FROM conversations
        WHERE id = ? AND user_id = ?
    `).get(conversationId, userId);

    if (!conversation) {
        return res.status(404).json({
            status: 404,
            message: "Conversation not found"
        });
    }

    db.prepare(`
        DELETE FROM conversations
        WHERE id = ? AND user_id = ?
    `).run(conversationId, userId);

    return res.status(200).json({
        status: 200,
        message: "Conversation deleted"
    });
});

app.listen(port, () => {
    console.log(`Server draait op http://localhost:${port}`);
});