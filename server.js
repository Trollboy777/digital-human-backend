import express from "express";

const app = express();
const port = 8000;

const users = {}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/", (req, res) => {
    res.status(200).json({
        status: 200,
        message: "Digital Human is active!"
    });
});

app.post("/chat", async (req, res) => {
    try {
        const { userId,conversationId, message } = req.body;

        if (!userId || typeof userId !== "string") {
            return res.status(400).json({
                status: 400,
                message: "A valid user id is required"
            });
        }

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

        if (!users[userId]) {
            users[userId] = {
                conversations: {}
            };
        }

        if (!users[userId].conversations[conversationId]) {
            users[userId].conversations[conversationId] = [
                {
                    role: "system",
                    content:
                        "Je bent een behulpzame Digital Human. Antwoord duidelijk en in het Nederlands."
                }
            ];
        }

        const conversationHistory =
            users[userId].conversations[conversationId];

        conversationHistory.push({
            role: "user",
            content: message
        });

        const payload = {
            model: "qwen3:8b",
            messages: conversationHistory,
            stream: false
        };

        const ollamaResponse = await fetch(
            "http://localhost:11434/api/chat",
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

            return res.status(502).json({
                status: 502,
                message: "Ollama kon de aanvraag niet verwerken"
            });
        }

        const data = await ollamaResponse.json();

        const assistantMessage = data.message.content
        conversationHistory.push({
            role: "assistant",
            content: assistantMessage
        })

        return res.status(200).json({
            status: 200,
            userId: userId,
            conversationId: conversationId,
            response: assistantMessage
        });

    } catch (error) {
        console.error("Backend error:", error);

        return res.status(500).json({
            status: 500,
            message: "Er ging iets mis met Ollama"
        });
    }
});

app.get("/history/:userId/:conversationId", (req, res) => {
    const { userId, conversationId } = req.params;

    if (!users[userId]) {
        return res.status(404).json({
            status: 404,
            message: "User not found"
        });
    }

    if (!users[userId].conversations[conversationId]) {
        return res.status(404).json({
            status: 404,
            message: "Conversation not found"
        });
    }

    return res.status(200).json({
        status: 200,
        userId: userId,
        conversationId: conversationId,
        history: users[userId].conversations[conversationId]
    });
});

app.delete("/history/:userId/:conversationId", (req, res) => {
    const { userId, conversationId } = req.params;

    if (!users[userId]) {
        return res.status(404).json({
            status: 404,
            message: "User not found"
        });
    }

    if (!users[userId].conversations[conversationId]) {
        return res.status(404).json({
            status: 404,
            message: "Conversation not found"
        });
    }

    delete users[userId].conversations[conversationId];

    return res.status(200).json({
        status: 200,
        message: "Conversation deleted"
    });
});

app.listen(port, () => {
    console.log(`Server draait op http://localhost:${port}`);
});