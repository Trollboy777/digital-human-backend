import express from "express";

const app = express();
const port = 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const conversationHistory = [
    {
        role: "system",
        content:
            "Je bent een behulpzame Digital Human. Antwoord duidelijk en in het Nederlands."
    }
];

app.get("/", (req, res) => {
    res.status(200).json({
        status: 200,
        message: "Digital Human is active!"
    });
});

app.post("/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== "string") {
            return res.status(400).json({
                status: 400,
                message: "A valid message is required"
            });
        }

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

app.get("/history", (req, res) => {
    res.json({
        history: conversationHistory
    });
});

app.delete("/history", (req, res) => {
    conversationHistory.splice(1);

    res.json({
        status: 200,
        message: "Conversation history cleared"
    });
});

app.listen(port, () => {
    console.log(`Server draait op http://localhost:${port}`);
});