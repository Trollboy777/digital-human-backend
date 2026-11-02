import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET;

export function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Je moet ingelogd zijn om deze actie uit te voeren."
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, jwtSecret);

        req.user = {
            id: decoded.sub
        };

        next();
    } catch (error) {
        return res.status(401).json({
            error: "Ongeldig of verlopen token."
        });
    }
}