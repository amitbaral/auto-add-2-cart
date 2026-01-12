import { createRequestHandler } from "@react-router/node";

// Import the server build
const build = await import("../build/server/index.js");

export default createRequestHandler({ build, mode: process.env.NODE_ENV });
