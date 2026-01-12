import { createRequestHandler } from "@react-router/node";

export const config = {
    runtime: "nodejs20.x"
};

let build;

export default async function handler(req, res) {
    if (!build) {
        try {
            build = await import("../build/server/index.js");
        } catch (error) {
            console.error("Failed to load build:", error);
            return res.status(500).json({ error: "Failed to load app", details: error.message });
        }
    }

    try {
        const requestHandler = createRequestHandler({ build, mode: process.env.NODE_ENV || "production" });
        return requestHandler(req, res);
    } catch (error) {
        console.error("Request handler error:", error);
        return res.status(500).json({ error: "Request failed", details: error.message });
    }
}
